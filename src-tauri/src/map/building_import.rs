//! glTF → LMO import for scene building models.
//!
//! Two import paths:
//! - **Round-trip**: glTF exported by `build_gltf_from_lmo_roundtrip()` — PKO extras are present,
//!   all header fields, materials, and blobs are restored losslessly.
//! - **Fresh import**: External glTF/GLB from Blender — no PKO extras, sensible defaults applied,
//!   all mesh nodes merged into a single geometry object.

use std::collections::HashMap;
use std::io::Cursor;
use std::path::Path;

use anyhow::{anyhow, Result};
use base64::prelude::BASE64_STANDARD;
use base64::Engine;
use serde::{Deserialize, Serialize};

use super::lmo::{
    D3DFVF_NORMAL, D3DFVF_TEXCOUNT_SHIFT, LmoGeomObject, LmoMaterial, LmoModel,
    LmoSubset, LmoTexInfo, MtlFormatVersion, RenderStateAtom,
    EXP_OBJ_VERSION_1_0_0_5,
};
use super::lmo_writer::write_lmo;
use super::scene_model::{
    PkoLmoExtras, PkoLmoMaterialExtras, PkoLmoMaterialInfo, flat_to_mat44,
};

// ============================================================================
// Result type
// ============================================================================

#[derive(Debug, Serialize, Deserialize)]
pub struct BuildingImportResult {
    pub lmo_path: String,
    pub texture_paths: Vec<String>,
    pub import_dir: String,
    pub building_id: String,
}

// ============================================================================
// Coordinate transform: glTF Y-up → PKO Z-up
// (gx, gy, gz) → (gx, -gz, gy)
// ============================================================================

fn gltf_to_pko_position(p: [f32; 3]) -> [f32; 3] {
    [p[0], -p[2], p[1]]
}

fn gltf_to_pko_normal(n: [f32; 3]) -> [f32; 3] {
    let r = [n[0], -n[2], n[1]];
    let len = (r[0] * r[0] + r[1] * r[1] + r[2] * r[2]).sqrt();
    if len > 1e-8 {
        [r[0] / len, r[1] / len, r[2] / len]
    } else {
        [0.0, 0.0, 1.0]
    }
}

// ============================================================================
// glTF vertex data reading helpers
// ============================================================================

fn read_f32_le(buf: &[u8], offset: usize) -> f32 {
    f32::from_le_bytes([buf[offset], buf[offset + 1], buf[offset + 2], buf[offset + 3]])
}

fn read_u16_le(buf: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes([buf[offset], buf[offset + 1]])
}

fn read_u32_le(buf: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes([buf[offset], buf[offset + 1], buf[offset + 2], buf[offset + 3]])
}

/// Read vertex attributes (positions, normals, UVs) from a glTF primitive.
fn read_prim_vertices(
    prim: &::gltf::Primitive,
    buffers: &[::gltf::buffer::Data],
    positions: &mut Vec<[f32; 3]>,
    normals: &mut Vec<[f32; 3]>,
    texcoords: &mut Vec<[f32; 2]>,
) -> Result<()> {
    for (semantic, accessor) in prim.attributes() {
        let view = accessor.view().ok_or_else(|| anyhow!("accessor has no buffer view"))?;
        let buf = &buffers[view.buffer().index()].0;
        let base_offset = accessor.offset() + view.offset();
        let stride = view.stride().unwrap_or(accessor.size());

        match semantic {
            ::gltf::Semantic::Positions => {
                for i in 0..accessor.count() {
                    let off = base_offset + i * stride;
                    positions.push([
                        read_f32_le(buf, off),
                        read_f32_le(buf, off + 4),
                        read_f32_le(buf, off + 8),
                    ]);
                }
            }
            ::gltf::Semantic::Normals => {
                for i in 0..accessor.count() {
                    let off = base_offset + i * stride;
                    normals.push([
                        read_f32_le(buf, off),
                        read_f32_le(buf, off + 4),
                        read_f32_le(buf, off + 8),
                    ]);
                }
            }
            ::gltf::Semantic::TexCoords(0) => {
                for i in 0..accessor.count() {
                    let off = base_offset + i * stride;
                    texcoords.push([read_f32_le(buf, off), read_f32_le(buf, off + 4)]);
                }
            }
            _ => {} // Skip colors, joints, weights, etc.
        }
    }
    Ok(())
}

/// Read index data from a glTF primitive, adding a vertex offset.
fn read_prim_indices(
    prim: &::gltf::Primitive,
    buffers: &[::gltf::buffer::Data],
    vertex_offset: u32,
) -> Result<Vec<u32>> {
    let accessor = prim
        .indices()
        .ok_or_else(|| anyhow!("primitive has no indices"))?;
    let view = accessor
        .view()
        .ok_or_else(|| anyhow!("index accessor has no buffer view"))?;
    let buf = &buffers[view.buffer().index()].0;
    let base_offset = accessor.offset() + view.offset();
    let mut indices = Vec::with_capacity(accessor.count());

    match accessor.data_type() {
        ::gltf::accessor::DataType::U16 => {
            let stride = view.stride().unwrap_or(2);
            for i in 0..accessor.count() {
                let off = base_offset + i * stride;
                indices.push(read_u16_le(buf, off) as u32 + vertex_offset);
            }
        }
        ::gltf::accessor::DataType::U32 => {
            let stride = view.stride().unwrap_or(4);
            for i in 0..accessor.count() {
                let off = base_offset + i * stride;
                indices.push(read_u32_le(buf, off) + vertex_offset);
            }
        }
        dt => return Err(anyhow!("unsupported index data type: {:?}", dt)),
    }
    Ok(indices)
}

// ============================================================================
// Texture extraction
// ============================================================================

/// Extract a glTF image to BMP and write to disk.
fn extract_texture(
    img_data: &::gltf::image::Data,
    output_path: &Path,
) -> Result<()> {
    use image::{DynamicImage, ImageBuffer, Rgb, Rgba};

    let dyn_img = match img_data.format {
        ::gltf::image::Format::R8G8B8 => {
            let img = ImageBuffer::<Rgb<u8>, _>::from_raw(
                img_data.width,
                img_data.height,
                img_data.pixels.clone(),
            )
            .ok_or_else(|| anyhow!("failed to create RGB image"))?;
            DynamicImage::ImageRgb8(img)
        }
        ::gltf::image::Format::R8G8B8A8 => {
            let img = ImageBuffer::<Rgba<u8>, _>::from_raw(
                img_data.width,
                img_data.height,
                img_data.pixels.clone(),
            )
            .ok_or_else(|| anyhow!("failed to create RGBA image"))?;
            DynamicImage::ImageRgba8(img)
        }
        other => return Err(anyhow!("unsupported glTF image format: {:?}", other)),
    };

    let mut bmp_buf = Vec::new();
    dyn_img.write_to(&mut Cursor::new(&mut bmp_buf), image::ImageFormat::Bmp)?;
    std::fs::write(output_path, &bmp_buf)?;
    Ok(())
}

// ============================================================================
// Material reconstruction
// ============================================================================

/// Build an LmoMaterial from PKO extras (round-trip path).
fn material_from_extras(info: &PkoLmoMaterialInfo) -> LmoMaterial {
    let tex_infos: [LmoTexInfo; 4] = std::array::from_fn(|i| {
        if let Some(ti) = info.tex_infos.get(i) {
            LmoTexInfo {
                stage: ti.stage,
                level: ti.level,
                usage: ti.usage,
                d3d_format: ti.d3d_format,
                d3d_pool: ti.d3d_pool,
                byte_alignment_flag: ti.byte_alignment_flag,
                tex_type: ti.tex_type,
                width: ti.width,
                height: ti.height,
                colorkey_type: ti.colorkey_type,
                colorkey: ti.colorkey,
                filename: ti.filename.clone(),
                data: ti.data,
                tss_set: ti.tss_set.clone(),
            }
        } else {
            LmoTexInfo::default()
        }
    });

    let tex_filename = if tex_infos[0].filename.is_empty() {
        None
    } else {
        Some(tex_infos[0].filename.clone())
    };

    LmoMaterial {
        diffuse: info.diffuse,
        ambient: info.ambient,
        specular: info.specular,
        emissive: info.emissive,
        power: info.power,
        opacity: info.opacity,
        transp_type: info.transp_type,
        rs_set: info.rs_set.clone(),
        tex_infos,
        tex_filename,
    }
}

/// Build a default LmoMaterial from glTF PBR material (fresh import path).
fn material_from_gltf(
    gltf_mat: &::gltf::Material,
    tex_filename: Option<String>,
) -> LmoMaterial {
    let base_color = gltf_mat.pbr_metallic_roughness().base_color_factor();
    let alpha_mode = gltf_mat.alpha_mode();
    let opacity = match alpha_mode {
        ::gltf::material::AlphaMode::Opaque => 1.0,
        _ => base_color[3],
    };

    let mut mat = LmoMaterial::new_simple(
        [base_color[0], base_color[1], base_color[2], base_color[3]],
        [1.0, 1.0, 1.0, 1.0],
        opacity,
        tex_filename,
    );
    mat.transp_type = if opacity < 0.99 { 1 } else { 0 };
    mat
}

// ============================================================================
// Main import function
// ============================================================================

/// Import a glTF/GLB file as a PKO building LMO.
///
/// If the glTF was exported by `build_gltf_from_lmo_roundtrip()`, PKO extras are used
/// to reconstruct the original LmoModel losslessly. Otherwise, a fresh import with
/// sensible defaults is performed.
pub fn import_building_from_gltf(
    file_path: &Path,
    building_id: &str,
    output_dir: &Path,
    scale_factor: f32,
) -> Result<BuildingImportResult> {
    let (doc, buffers, images) = ::gltf::import(file_path)?;

    // Classify nodes: round-trip (has pko_lmo_geom extras) vs fresh
    let mut roundtrip_nodes: Vec<(::gltf::Node, PkoLmoExtras)> = Vec::new();
    let mut fresh_mesh_nodes: Vec<::gltf::Node> = Vec::new();

    for node in doc.nodes() {
        if node.mesh().is_none() {
            continue;
        }
        if let Some(extras) = node.extras() {
            if let Ok(pko) = serde_json::from_str::<PkoLmoExtras>(extras.get()) {
                if pko.pko_lmo_geom {
                    roundtrip_nodes.push((node, pko));
                    continue;
                }
            }
        }
        fresh_mesh_nodes.push(node);
    }

    let is_roundtrip = !roundtrip_nodes.is_empty();

    // Create output directories
    let import_dir = output_dir.join("imports").join("building").join(building_id);
    std::fs::create_dir_all(&import_dir)?;
    let texture_dir = import_dir.join("texture");
    std::fs::create_dir_all(&texture_dir)?;

    // Track written textures: glTF image index → (disk path, filename string)
    let mut written_textures: HashMap<usize, String> = HashMap::new();
    let mut texture_paths: Vec<String> = Vec::new();

    let model = if is_roundtrip {
        import_roundtrip(
            &doc,
            &buffers,
            &images,
            &roundtrip_nodes,
            &texture_dir,
            &mut written_textures,
            &mut texture_paths,
            scale_factor,
        )?
    } else {
        import_fresh(
            &doc,
            &buffers,
            &images,
            &fresh_mesh_nodes,
            &texture_dir,
            &mut written_textures,
            &mut texture_paths,
            scale_factor,
        )?
    };

    // Write LMO binary
    let lmo_data = write_lmo(&model);
    let lmo_path = import_dir.join(format!("{}.lmo", building_id));
    std::fs::write(&lmo_path, &lmo_data)?;

    Ok(BuildingImportResult {
        lmo_path: lmo_path.to_string_lossy().to_string(),
        texture_paths,
        import_dir: import_dir.to_string_lossy().to_string(),
        building_id: building_id.to_string(),
    })
}

// ============================================================================
// Round-trip import (PKO extras present)
// ============================================================================

#[allow(clippy::too_many_arguments)]
fn import_roundtrip(
    doc: &::gltf::Document,
    buffers: &[::gltf::buffer::Data],
    images: &[::gltf::image::Data],
    roundtrip_nodes: &[(::gltf::Node, PkoLmoExtras)],
    texture_dir: &Path,
    written_textures: &mut HashMap<usize, String>,
    texture_paths: &mut Vec<String>,
    scale_factor: f32,
) -> Result<LmoModel> {
    let mut geom_objects = Vec::new();

    for (node, pko) in roundtrip_nodes {
        let mesh = node.mesh().unwrap();

        // Read mesh-level material extras
        let mat_extras: Option<PkoLmoMaterialExtras> = mesh
            .extras()
            .as_ref()
            .and_then(|e| serde_json::from_str::<PkoLmoMaterialExtras>(e.get()).ok());

        // Read vertex data from all primitives
        let mut positions = Vec::new();
        let mut normals = Vec::new();
        let mut texcoords = Vec::new();
        let mut indices = Vec::new();

        // In round-trip exports, all primitives share the same vertex buffer
        // (one primitive per subset, same position/normal/UV accessor).
        // Read vertices from the first primitive only; read indices from all.
        let mut vertices_read = false;
        for prim in mesh.primitives() {
            if !vertices_read {
                read_prim_vertices(&prim, buffers, &mut positions, &mut normals, &mut texcoords)?;
                vertices_read = true;
            }
            // Indices don't need offset since all primitives share the same vertex buffer
            let prim_indices = read_prim_indices(&prim, buffers, 0)?;
            indices.extend(prim_indices);
        }

        // Reverse coordinate transform: glTF Y-up → PKO Z-up
        let vertices: Vec<[f32; 3]> = positions
            .iter()
            .map(|p| {
                let pko = gltf_to_pko_position(*p);
                [pko[0] * scale_factor, pko[1] * scale_factor, pko[2] * scale_factor]
            })
            .collect();
        let normals: Vec<[f32; 3]> = normals.iter().map(|n| gltf_to_pko_normal(*n)).collect();

        // Reconstruct materials from extras
        let materials = if let Some(ref me) = mat_extras {
            let mut mats: Vec<LmoMaterial> = me
                .pko_lmo_materials
                .iter()
                .map(material_from_extras)
                .collect();

            // Extract textures and update filenames if needed
            for (mi, mat) in mats.iter_mut().enumerate() {
                extract_material_textures(
                    doc,
                    images,
                    &mesh,
                    mi,
                    mat,
                    texture_dir,
                    written_textures,
                    texture_paths,
                )?;
            }
            mats
        } else {
            // Fallback: build materials from glTF PBR
            build_materials_from_gltf(
                doc,
                images,
                &mesh,
                texture_dir,
                written_textures,
                texture_paths,
            )?
        };

        // Reconstruct subsets from extras
        let subsets = if !pko.subsets.is_empty() {
            pko.subsets
                .iter()
                .map(|s| LmoSubset {
                    primitive_num: s.primitive_num,
                    start_index: s.start_index,
                    vertex_num: s.vertex_num,
                    min_index: s.min_index,
                })
                .collect()
        } else {
            // Build subsets from primitives
            build_subsets_from_primitives(&mesh, buffers)?
        };

        // Decode base64 blobs from extras
        let rcci = decode_b64_fixed::<16>(&pko.rcci);
        let state_ctrl = decode_b64_fixed::<8>(&pko.state_ctrl);
        let helper_blob = if pko.helper_blob.is_empty() {
            Vec::new()
        } else {
            BASE64_STANDARD.decode(&pko.helper_blob).unwrap_or_default()
        };
        let raw_anim_blob = if pko.raw_anim_blob.is_empty() {
            Vec::new()
        } else {
            BASE64_STANDARD.decode(&pko.raw_anim_blob).unwrap_or_default()
        };
        let vertex_elements_blob = if pko.vertex_elements_blob.is_empty() {
            Vec::new()
        } else {
            BASE64_STANDARD
                .decode(&pko.vertex_elements_blob)
                .unwrap_or_default()
        };

        // Reconstruct animation from raw blob (re-decompose for visualization)
        let animation = if !raw_anim_blob.is_empty() {
            // Re-parse as v0x1005 (blob was normalized during export)
            let mut cursor = Cursor::new(raw_anim_blob.as_slice());
            super::lmo::read_animation_from_blob(&mut cursor, raw_anim_blob.len())
                .ok()
                .flatten()
        } else {
            None
        };

        geom_objects.push(LmoGeomObject {
            id: pko.geom_id,
            parent_id: pko.parent_id,
            obj_type: pko.obj_type,
            mat_local: flat_to_mat44(&pko.mat_local),
            rcci,
            state_ctrl,
            fvf: pko.fvf,
            pt_type: pko.pt_type,
            bone_infl_factor: pko.bone_infl_factor,
            vertex_element_num: pko.vertex_element_num,
            vertex_elements_blob,
            mesh_rs_set: pko.mesh_rs_set.clone(),
            vertices,
            normals,
            texcoords,
            vertex_colors: pko.vertex_colors.clone(),
            indices,
            subsets,
            materials,
            helper_blob,
            raw_anim_blob,
            animation,
            mtl_format_version: MtlFormatVersion::Current,
        });
    }

    Ok(LmoModel {
        version: EXP_OBJ_VERSION_1_0_0_5,
        geom_objects,
        non_geom_entries: vec![],
    })
}

// ============================================================================
// Fresh import (no PKO extras — external model from Blender)
// ============================================================================

#[allow(clippy::too_many_arguments)]
fn import_fresh(
    doc: &::gltf::Document,
    buffers: &[::gltf::buffer::Data],
    images: &[::gltf::image::Data],
    mesh_nodes: &[::gltf::Node],
    texture_dir: &Path,
    written_textures: &mut HashMap<usize, String>,
    texture_paths: &mut Vec<String>,
    scale_factor: f32,
) -> Result<LmoModel> {
    // Merge all meshes into a single geometry object
    let mut all_positions = Vec::new();
    let mut all_normals = Vec::new();
    let mut all_texcoords = Vec::new();
    let mut all_indices = Vec::new();
    let mut all_materials: Vec<LmoMaterial> = Vec::new();
    let mut subsets = Vec::new();

    // Track material mapping: glTF material index → LMO material index
    let mut material_map: HashMap<Option<usize>, usize> = HashMap::new();

    for node in mesh_nodes {
        let mesh = match node.mesh() {
            Some(m) => m,
            None => continue,
        };

        for prim in mesh.primitives() {
            let voff = all_positions.len() as u32;
            let _ioff = all_indices.len() as u32;

            // Read vertices
            read_prim_vertices(
                &prim,
                buffers,
                &mut all_positions,
                &mut all_normals,
                &mut all_texcoords,
            )?;
            let prim_indices = read_prim_indices(&prim, buffers, voff)?;
            let tri_count = prim_indices.len() / 3;

            // Map material
            let gltf_mat_idx = prim.material().index();
            let lmo_mat_idx = if let Some(&existing) = material_map.get(&gltf_mat_idx) {
                existing
            } else {
                let idx = all_materials.len();
                let mat = if let Some(mi) = gltf_mat_idx {
                    let gltf_mat = doc.materials().nth(mi).unwrap();
                    let tex_name = extract_prim_texture(
                        &gltf_mat,
                        images,
                        texture_dir,
                        written_textures,
                        texture_paths,
                    )?;
                    material_from_gltf(&gltf_mat, tex_name)
                } else {
                    LmoMaterial::new_simple(
                        [0.7, 0.7, 0.7, 1.0],
                        [1.0, 1.0, 1.0, 1.0],
                        1.0,
                        None,
                    )
                };
                all_materials.push(mat);
                material_map.insert(gltf_mat_idx, idx);
                idx
            };

            // Build subset
            let vertex_count = (all_positions.len() as u32) - voff;
            subsets.push((
                LmoSubset {
                    primitive_num: tri_count as u32,
                    start_index: all_indices.len() as u32,
                    vertex_num: vertex_count,
                    min_index: voff,
                },
                lmo_mat_idx,
            ));

            all_indices.extend(prim_indices);
        }
    }

    if all_positions.is_empty() {
        return Err(anyhow!("no geometry found in glTF file"));
    }

    // Transform to PKO space and apply scale
    let vertices: Vec<[f32; 3]> = all_positions
        .iter()
        .map(|p| {
            let pko = gltf_to_pko_position(*p);
            [pko[0] * scale_factor, pko[1] * scale_factor, pko[2] * scale_factor]
        })
        .collect();
    let normals: Vec<[f32; 3]> = all_normals
        .iter()
        .map(|n| gltf_to_pko_normal(*n))
        .collect();

    // Compute FVF
    let has_normals = !normals.is_empty();
    let has_texcoords = !all_texcoords.is_empty();
    let mut fvf = 0x002u32; // D3DFVF_XYZ
    if has_normals {
        fvf |= D3DFVF_NORMAL;
    }
    if has_texcoords {
        fvf |= 1 << D3DFVF_TEXCOUNT_SHIFT; // TEX1
    }

    // Sort materials to match subset order — each subset references one material
    // Reorder materials so index i matches subsets that reference it
    let final_subsets: Vec<LmoSubset> = subsets.iter().map(|(s, _)| s.clone()).collect();

    // We need materials sorted by subset order
    // Since each subset already maps to a material, we just reorder
    let ordered_materials: Vec<LmoMaterial> = subsets
        .iter()
        .map(|(_, mat_idx)| all_materials[*mat_idx].clone())
        .collect();

    let geom = LmoGeomObject {
        id: 0,
        parent_id: 0xFFFFFFFF,
        obj_type: 0,
        mat_local: [
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
        ],
        rcci: [0u8; 16],
        state_ctrl: [0u8; 8],
        fvf,
        pt_type: 4, // TRIANGLELIST
        bone_infl_factor: 0,
        vertex_element_num: 0,
        vertex_elements_blob: vec![],
        mesh_rs_set: vec![RenderStateAtom::default(); 8],
        vertices,
        normals,
        texcoords: all_texcoords,
        vertex_colors: vec![],
        indices: all_indices,
        subsets: final_subsets,
        materials: ordered_materials,
        helper_blob: vec![],
        raw_anim_blob: vec![],
        animation: None,
        mtl_format_version: MtlFormatVersion::Current,
    };

    Ok(LmoModel {
        version: EXP_OBJ_VERSION_1_0_0_5,
        geom_objects: vec![geom],
        non_geom_entries: vec![],
    })
}

// ============================================================================
// Helpers
// ============================================================================

/// Decode a base64 string to a fixed-size byte array.
fn decode_b64_fixed<const N: usize>(s: &str) -> [u8; N] {
    let mut result = [0u8; N];
    if let Ok(decoded) = BASE64_STANDARD.decode(s) {
        let len = decoded.len().min(N);
        result[..len].copy_from_slice(&decoded[..len]);
    }
    result
}

/// Build materials from glTF PBR (fallback when round-trip material extras are missing).
fn build_materials_from_gltf(
    _doc: &::gltf::Document,
    images: &[::gltf::image::Data],
    mesh: &::gltf::Mesh,
    texture_dir: &Path,
    written_textures: &mut HashMap<usize, String>,
    texture_paths: &mut Vec<String>,
) -> Result<Vec<LmoMaterial>> {
    let mut materials = Vec::new();
    for prim in mesh.primitives() {
        let gltf_mat = prim.material();
        let tex_name = extract_prim_texture(
            &gltf_mat,
            images,
            texture_dir,
            written_textures,
            texture_paths,
        )?;
        materials.push(material_from_gltf(&gltf_mat, tex_name));
    }
    if materials.is_empty() {
        materials.push(LmoMaterial::new_simple(
            [0.7, 0.7, 0.7, 1.0],
            [1.0, 1.0, 1.0, 1.0],
            1.0,
            None,
        ));
    }
    Ok(materials)
}

/// Build subsets from glTF mesh primitives (when extras don't have subset info).
fn build_subsets_from_primitives(
    mesh: &::gltf::Mesh,
    _buffers: &[::gltf::buffer::Data],
) -> Result<Vec<LmoSubset>> {
    let mut subsets = Vec::new();
    let mut index_cursor = 0u32;
    let mut vertex_cursor = 0u32;

    for prim in mesh.primitives() {
        if let Some(idx_acc) = prim.indices() {
            let index_count = idx_acc.count() as u32;
            let tri_count = index_count / 3;

            // Count vertices from position accessor
            let vert_count = prim
                .attributes()
                .find(|(s, _)| *s == ::gltf::Semantic::Positions)
                .map(|(_, a)| a.count() as u32)
                .unwrap_or(0);

            subsets.push(LmoSubset {
                primitive_num: tri_count,
                start_index: index_cursor,
                vertex_num: vert_count,
                min_index: vertex_cursor,
            });

            index_cursor += index_count;
            vertex_cursor += vert_count;
        }
    }
    Ok(subsets)
}

/// Extract textures for a round-trip material (checks if the glTF texture changed).
#[allow(clippy::too_many_arguments)]
fn extract_material_textures(
    _doc: &::gltf::Document,
    images: &[::gltf::image::Data],
    mesh: &::gltf::Mesh,
    material_subset_idx: usize,
    mat: &mut LmoMaterial,
    texture_dir: &Path,
    written_textures: &mut HashMap<usize, String>,
    texture_paths: &mut Vec<String>,
) -> Result<()> {
    // Find the primitive that corresponds to this material index
    if let Some(prim) = mesh.primitives().nth(material_subset_idx) {
        let gltf_mat = prim.material();
        if let Some(tex_info) = gltf_mat.pbr_metallic_roughness().base_color_texture() {
            let img_idx = tex_info.texture().source().index();

            if let Some(existing) = written_textures.get(&img_idx) {
                // Already written — use existing filename
                mat.tex_filename = Some(existing.clone());
                mat.tex_infos[0].filename = existing.clone();
            } else if let Some(img_data) = images.get(img_idx) {
                // Extract texture
                let tex_name = mat
                    .tex_filename
                    .as_deref()
                    .filter(|n| !n.is_empty())
                    .map(|n| {
                        // Use original filename from extras, but change extension to .bmp
                        let stem = n.rfind('.').map(|i| &n[..i]).unwrap_or(n);
                        format!("{}.bmp", stem)
                    })
                    .unwrap_or_else(|| format!("tex_{}.bmp", img_idx));

                let tex_path = texture_dir.join(&tex_name);
                extract_texture(img_data, &tex_path)?;
                texture_paths.push(tex_path.to_string_lossy().to_string());
                written_textures.insert(img_idx, tex_name.clone());
                mat.tex_filename = Some(tex_name.clone());
                mat.tex_infos[0].filename = tex_name;
            }
        }
    }
    Ok(())
}

/// Extract texture from a glTF material for fresh import.
fn extract_prim_texture(
    gltf_mat: &::gltf::Material,
    images: &[::gltf::image::Data],
    texture_dir: &Path,
    written_textures: &mut HashMap<usize, String>,
    texture_paths: &mut Vec<String>,
) -> Result<Option<String>> {
    if let Some(tex_info) = gltf_mat.pbr_metallic_roughness().base_color_texture() {
        let img_source = tex_info.texture().source();
        let img_idx = img_source.index();

        if let Some(existing) = written_textures.get(&img_idx) {
            return Ok(Some(existing.clone()));
        }

        if let Some(img_data) = images.get(img_idx) {
            let tex_name = img_source
                .name()
                .map(|n| format!("{}.bmp", n))
                .unwrap_or_else(|| format!("tex_{}.bmp", img_idx));

            let tex_path = texture_dir.join(&tex_name);
            extract_texture(img_data, &tex_path)?;
            texture_paths.push(tex_path.to_string_lossy().to_string());
            written_textures.insert(img_idx, tex_name.clone());
            return Ok(Some(tex_name));
        }
    }
    Ok(None)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::map::lmo;

    #[test]
    fn coordinate_inverse_roundtrip() {
        // Z-up → Y-up → Z-up should be identity
        let original = [3.0f32, -7.5, 12.0];
        // PKO→glTF: (x, y, z) → (x, z, -y)
        let gltf = [original[0], original[2], -original[1]];
        // glTF→PKO: (gx, gy, gz) → (gx, -gz, gy)
        let back = gltf_to_pko_position(gltf);
        for i in 0..3 {
            assert!(
                (original[i] - back[i]).abs() < 1e-5,
                "coordinate[{}] mismatch: {} vs {}",
                i,
                original[i],
                back[i]
            );
        }
    }

    #[test]
    fn roundtrip_synthetic_gltf() {
        // Create a test model, export to glTF roundtrip, then import back
        let original = make_test_model();
        let temp_dir = std::env::temp_dir().join("pko_import_test_rt");
        let _ = std::fs::create_dir_all(&temp_dir);

        // Write LMO
        let lmo_data = crate::map::lmo_writer::write_lmo(&original);
        let lmo_path = temp_dir.join("test_import.lmo");
        std::fs::write(&lmo_path, &lmo_data).unwrap();

        // Export roundtrip glTF
        let json =
            crate::map::scene_model::build_gltf_from_lmo_roundtrip(&lmo_path, &temp_dir).unwrap();
        let gltf_path = temp_dir.join("test_import.gltf");
        std::fs::write(&gltf_path, &json).unwrap();

        // Import back
        let result =
            import_building_from_gltf(&gltf_path, "test_building", &temp_dir, 1.0).unwrap();

        // Read the imported LMO
        let imported = lmo::load_lmo(std::path::Path::new(&result.lmo_path)).unwrap();

        // Compare
        assert_eq!(imported.geom_objects.len(), original.geom_objects.len());
        let orig_geom = &original.geom_objects[0];
        let imp_geom = &imported.geom_objects[0];

        assert_eq!(imp_geom.id, orig_geom.id);
        assert_eq!(imp_geom.parent_id, orig_geom.parent_id);
        assert_eq!(imp_geom.fvf, orig_geom.fvf);
        assert_eq!(imp_geom.vertices.len(), orig_geom.vertices.len());
        assert_eq!(imp_geom.normals.len(), orig_geom.normals.len());
        assert_eq!(imp_geom.indices.len(), orig_geom.indices.len());
        assert_eq!(imp_geom.subsets.len(), orig_geom.subsets.len());
        assert_eq!(imp_geom.materials.len(), orig_geom.materials.len());

        // Verify vertices round-trip (Z-up → Y-up → Z-up)
        for (i, (ov, iv)) in orig_geom
            .vertices
            .iter()
            .zip(imp_geom.vertices.iter())
            .enumerate()
        {
            for c in 0..3 {
                assert!(
                    (ov[c] - iv[c]).abs() < 1e-4,
                    "vertex[{}][{}] mismatch: {} vs {}",
                    i,
                    c,
                    ov[c],
                    iv[c]
                );
            }
        }

        // Verify material round-trip
        let orig_mat = &orig_geom.materials[0];
        let imp_mat = &imp_geom.materials[0];
        assert!((orig_mat.opacity - imp_mat.opacity).abs() < 1e-5);
        for c in 0..4 {
            assert!((orig_mat.diffuse[c] - imp_mat.diffuse[c]).abs() < 1e-4);
        }

        // Clean up
        let _ = std::fs::remove_dir_all(temp_dir.join("imports"));
        let _ = std::fs::remove_file(&lmo_path);
        let _ = std::fs::remove_file(&gltf_path);
    }

    #[test]
    fn scale_factor_applied() {
        let original = make_test_model();
        let temp_dir = std::env::temp_dir().join("pko_import_test_scale");
        let _ = std::fs::create_dir_all(&temp_dir);

        let lmo_data = crate::map::lmo_writer::write_lmo(&original);
        let lmo_path = temp_dir.join("test_scale.lmo");
        std::fs::write(&lmo_path, &lmo_data).unwrap();

        let json =
            crate::map::scene_model::build_gltf_from_lmo_roundtrip(&lmo_path, &temp_dir).unwrap();
        let gltf_path = temp_dir.join("test_scale.gltf");
        std::fs::write(&gltf_path, &json).unwrap();

        // Import with 2x scale
        let result =
            import_building_from_gltf(&gltf_path, "test_scale", &temp_dir, 2.0).unwrap();

        let imported = lmo::load_lmo(std::path::Path::new(&result.lmo_path)).unwrap();
        let imp_geom = &imported.geom_objects[0];
        let orig_geom = &original.geom_objects[0];

        // Vertices should be 2x the original
        for (i, (ov, iv)) in orig_geom
            .vertices
            .iter()
            .zip(imp_geom.vertices.iter())
            .enumerate()
        {
            for c in 0..3 {
                assert!(
                    (ov[c] * 2.0 - iv[c]).abs() < 1e-4,
                    "scaled vertex[{}][{}] mismatch: {} * 2 vs {}",
                    i,
                    c,
                    ov[c],
                    iv[c]
                );
            }
        }

        let _ = std::fs::remove_dir_all(temp_dir.join("imports"));
        let _ = std::fs::remove_file(&lmo_path);
        let _ = std::fs::remove_file(&gltf_path);
    }

    #[test]
    fn full_roundtrip_real_lmo() {
        // Real LMO → export roundtrip glTF → import → compare
        let scene_dir = std::path::Path::new("../top-client/model/scene");
        if !scene_dir.exists() {
            return;
        }

        let lmo_file = std::fs::read_dir(scene_dir)
            .ok()
            .and_then(|mut dir| {
                dir.find(|e| {
                    e.as_ref()
                        .ok()
                        .map(|e| {
                            e.path()
                                .extension()
                                .map(|ext| ext.to_ascii_lowercase() == "lmo")
                                .unwrap_or(false)
                        })
                        .unwrap_or(false)
                })
            })
            .and_then(|e| e.ok())
            .map(|e| e.path());

        let lmo_path = match lmo_file {
            Some(p) => p,
            None => return,
        };

        let project_dir = std::path::Path::new("../top-client");
        let temp_dir = std::env::temp_dir().join("pko_full_rt_test");
        let _ = std::fs::create_dir_all(&temp_dir);

        // Export roundtrip
        let json =
            crate::map::scene_model::build_gltf_from_lmo_roundtrip(&lmo_path, project_dir)
                .unwrap();
        let gltf_path = temp_dir.join("full_rt.gltf");
        std::fs::write(&gltf_path, &json).unwrap();

        // Import back
        let result =
            import_building_from_gltf(&gltf_path, "full_rt_test", &temp_dir, 1.0).unwrap();

        // Re-parse the imported LMO
        let original = lmo::load_lmo(&lmo_path).unwrap();
        let imported = lmo::load_lmo(std::path::Path::new(&result.lmo_path)).unwrap();

        assert_eq!(
            imported.geom_objects.len(),
            original.geom_objects.len(),
            "geom object count mismatch"
        );

        for (i, (orig, imp)) in original
            .geom_objects
            .iter()
            .zip(imported.geom_objects.iter())
            .enumerate()
        {
            assert_eq!(orig.id, imp.id, "geom[{}] id mismatch", i);
            assert_eq!(
                orig.vertices.len(),
                imp.vertices.len(),
                "geom[{}] vertex count mismatch",
                i
            );
            assert_eq!(
                orig.indices.len(),
                imp.indices.len(),
                "geom[{}] index count mismatch",
                i
            );
            assert_eq!(
                orig.materials.len(),
                imp.materials.len(),
                "geom[{}] material count mismatch",
                i
            );
            assert_eq!(
                orig.helper_blob, imp.helper_blob,
                "geom[{}] helper blob mismatch",
                i
            );
            assert_eq!(
                orig.raw_anim_blob, imp.raw_anim_blob,
                "geom[{}] anim blob mismatch",
                i
            );
        }

        // Clean up
        let _ = std::fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn fresh_import_no_extras() {
        // Export a model using the viewer path (no PKO extras) → import should use fresh defaults
        let original = make_test_model();
        let temp_dir = std::env::temp_dir().join("pko_import_test_fresh");
        let _ = std::fs::create_dir_all(&temp_dir);

        // Write LMO first
        let lmo_data = crate::map::lmo_writer::write_lmo(&original);
        let lmo_path = temp_dir.join("test_fresh.lmo");
        std::fs::write(&lmo_path, &lmo_data).unwrap();

        // Export using the VIEWER path (no PKO extras)
        let json =
            crate::map::scene_model::build_gltf_from_lmo(&lmo_path, &temp_dir).unwrap();
        let gltf_path = temp_dir.join("test_fresh.gltf");
        std::fs::write(&gltf_path, &json).unwrap();

        // Import back — should take fresh path
        let result =
            import_building_from_gltf(&gltf_path, "test_fresh", &temp_dir, 1.0).unwrap();

        let imported = lmo::load_lmo(std::path::Path::new(&result.lmo_path)).unwrap();

        // Fresh import should produce exactly 1 geom object (merged)
        assert_eq!(imported.geom_objects.len(), 1, "fresh import should merge into 1 geom");

        let imp_geom = &imported.geom_objects[0];

        // Verify fresh defaults
        assert_eq!(imp_geom.id, 0, "fresh import should assign id=0");
        assert_eq!(imp_geom.parent_id, 0xFFFFFFFF, "fresh import parent_id");
        assert_eq!(imp_geom.obj_type, 0, "fresh import obj_type");
        assert_eq!(imp_geom.pt_type, 4, "fresh import pt_type (TRIANGLELIST)");
        assert_eq!(imp_geom.bone_infl_factor, 0, "fresh import bone_infl_factor");
        assert_eq!(imp_geom.vertex_element_num, 0, "fresh import vertex_element_num");
        assert!(imp_geom.helper_blob.is_empty(), "fresh import no helpers");
        assert!(imp_geom.raw_anim_blob.is_empty(), "fresh import no animation");

        // mat_local should be identity
        for r in 0..4 {
            for c in 0..4 {
                let expected = if r == c { 1.0 } else { 0.0 };
                assert!(
                    (imp_geom.mat_local[r][c] - expected).abs() < 1e-5,
                    "mat_local[{}][{}] expected {} got {}",
                    r, c, expected, imp_geom.mat_local[r][c]
                );
            }
        }

        // FVF should include at least XYZ
        assert!(imp_geom.fvf & 0x002 != 0, "FVF should include D3DFVF_XYZ");

        // Should have vertices (from the original triangle)
        assert!(imp_geom.vertices.len() >= 3, "should have at least 3 vertices");
        assert!(!imp_geom.indices.is_empty(), "should have indices");
        assert!(!imp_geom.subsets.is_empty(), "should have at least one subset");
        assert!(!imp_geom.materials.is_empty(), "should have at least one material");

        // Clean up
        let _ = std::fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn full_roundtrip_animated_building() {
        // Animated building (by-bd013 lighthouse) full round-trip: LMO → glTF → LMO
        // Verifies animation blobs are preserved through export/import
        let path = std::path::Path::new("../top-client/model/scene/by-bd013.lmo");
        if !path.exists() {
            return;
        }

        let project_dir = std::path::Path::new("../top-client");
        let temp_dir = std::env::temp_dir().join("pko_anim_rt_test");
        let _ = std::fs::create_dir_all(&temp_dir);

        // Parse original
        let original = lmo::load_lmo(path).unwrap();

        // Find geom objects with animation
        let animated_count = original
            .geom_objects
            .iter()
            .filter(|g| !g.raw_anim_blob.is_empty())
            .count();
        assert!(animated_count > 0, "by-bd013 should have animated objects");

        // Export roundtrip glTF
        let json =
            crate::map::scene_model::build_gltf_from_lmo_roundtrip(path, project_dir).unwrap();
        let gltf_path = temp_dir.join("anim_rt.gltf");
        std::fs::write(&gltf_path, &json).unwrap();

        // Import back
        let result =
            import_building_from_gltf(&gltf_path, "anim_rt_test", &temp_dir, 1.0).unwrap();

        // Re-parse
        let imported = lmo::load_lmo(std::path::Path::new(&result.lmo_path)).unwrap();

        assert_eq!(
            imported.geom_objects.len(),
            original.geom_objects.len(),
            "geom object count mismatch"
        );

        for (i, (orig, imp)) in original
            .geom_objects
            .iter()
            .zip(imported.geom_objects.iter())
            .enumerate()
        {
            assert_eq!(orig.id, imp.id, "geom[{}] id mismatch", i);

            // Animation blob should be exactly preserved
            assert_eq!(
                orig.raw_anim_blob.len(),
                imp.raw_anim_blob.len(),
                "geom[{}] anim blob size mismatch: {} vs {}",
                i,
                orig.raw_anim_blob.len(),
                imp.raw_anim_blob.len()
            );
            assert_eq!(
                orig.raw_anim_blob, imp.raw_anim_blob,
                "geom[{}] anim blob content mismatch",
                i
            );

            // Helper blob should also be preserved
            assert_eq!(
                orig.helper_blob, imp.helper_blob,
                "geom[{}] helper blob mismatch",
                i
            );

            // Vertex/index counts should match
            assert_eq!(
                orig.vertices.len(),
                imp.vertices.len(),
                "geom[{}] vertex count mismatch",
                i
            );
            assert_eq!(
                orig.indices.len(),
                imp.indices.len(),
                "geom[{}] index count mismatch",
                i
            );

            // Material count should match
            assert_eq!(
                orig.materials.len(),
                imp.materials.len(),
                "geom[{}] material count mismatch",
                i
            );

            // If original has animation data, verify it parses correctly
            if orig.animation.is_some() {
                assert!(
                    imp.animation.is_some(),
                    "geom[{}] should have parsed animation data",
                    i
                );
            }
        }

        // Clean up
        let _ = std::fs::remove_dir_all(temp_dir);
    }

    /// Create a minimal test model for import testing.
    fn make_test_model() -> LmoModel {
        LmoModel {
            version: EXP_OBJ_VERSION_1_0_0_5,
            geom_objects: vec![LmoGeomObject {
                id: 1,
                parent_id: 0xFFFFFFFF,
                obj_type: 0,
                mat_local: [
                    [1.0, 0.0, 0.0, 0.0],
                    [0.0, 1.0, 0.0, 0.0],
                    [0.0, 0.0, 1.0, 0.0],
                    [0.0, 0.0, 0.0, 1.0],
                ],
                rcci: [0u8; 16],
                state_ctrl: [0u8; 8],
                fvf: 0x112, // XYZ | NORMAL | TEX1
                pt_type: 4,
                bone_infl_factor: 0,
                vertex_element_num: 0,
                vertex_elements_blob: vec![],
                mesh_rs_set: vec![RenderStateAtom::default(); 8],
                vertices: vec![[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]],
                normals: vec![[0.0, 0.0, 1.0]; 3],
                texcoords: vec![[0.0, 0.0], [1.0, 0.0], [0.0, 1.0]],
                vertex_colors: vec![],
                indices: vec![0, 1, 2],
                subsets: vec![LmoSubset {
                    primitive_num: 1,
                    start_index: 0,
                    vertex_num: 3,
                    min_index: 0,
                }],
                materials: vec![LmoMaterial::new_simple(
                    [0.8, 0.2, 0.1, 1.0],
                    [0.3, 0.3, 0.3, 1.0],
                    1.0,
                    None,
                )],
                helper_blob: vec![],
                raw_anim_blob: vec![],
                animation: None,
                mtl_format_version: MtlFormatVersion::Current,
            }],
            non_geom_entries: vec![],
        }
    }
}
