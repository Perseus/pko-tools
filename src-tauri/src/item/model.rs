use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use base64::{prelude::BASE64_STANDARD, Engine};
use ::gltf::json::{
    accessor::{ComponentType, GenericComponentType},
    image::MimeType,
    material::{PbrBaseColorFactor, PbrMetallicRoughness, StrengthFactor},
    validation::{Checked, USize64},
    Accessor, Index,
};
use ::gltf::json as gltf;
use ::gltf::Semantic;
use serde_json::value::RawValue;

use crate::animation::character::LW_INVALID_INDEX;
use crate::character::{
    mesh::CharacterMeshInfo,
    model::CharacterGeometricModel,
    texture::CharMaterialTextureInfo,
    GLTFFieldsToAggregate,
};

use super::{Item, ItemMetadata};

impl Item {
    /// Get glTF JSON for a specific model variant of this item.
    /// Item models are static meshes (no skeleton/skinning). Textures may be in
    /// a non-standard format, so we handle texture loading with fallback.
    pub fn get_gltf_json(&self, project_dir: &Path, model_id: &str) -> anyhow::Result<String> {
        if model_id == "0" || model_id.is_empty() {
            return Err(anyhow::anyhow!("No model available for this variant"));
        }

        let model_path = resolve_item_model_path(project_dir, model_id)
            .ok_or_else(|| anyhow::anyhow!("Item model file not found: {}.lgo", model_id))?;

        let geom = CharacterGeometricModel::from_file(model_path)?;

        let mesh_info = geom
            .mesh_info
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Item model has no mesh data"))?;

        let mut fields = GLTFFieldsToAggregate {
            buffer: vec![],
            buffer_view: vec![],
            accessor: vec![],
            image: vec![],
            texture: vec![],
            material: vec![],
            sampler: vec![],
            animation: vec![],
            skin: vec![],
            nodes: vec![],
        };

        let materials_vec = geom.material_seq.as_ref().map(|v| v.as_slice()).unwrap_or(&[]);

        // Split subsets: main weapon primitives (non-overlay) and glow overlay (subset 1)
        let (main_primitives, overlay_primitives) = build_item_primitives_split(
            project_dir,
            mesh_info,
            materials_vec,
            &mut fields,
        );

        let mut meshes = vec![];
        let mut all_nodes = vec![];
        let mut scene_nodes = vec![];

        // Main weapon mesh (subset 0 + any non-overlay subsets)
        meshes.push(gltf::Mesh {
            name: Some(model_id.to_string()),
            primitives: main_primitives,
            weights: None,
            extensions: None,
            extras: None,
        });
        all_nodes.push(gltf::Node {
            mesh: Some(gltf::Index::new(0)),
            name: Some(format!("Item_{}", model_id)),
            ..Default::default()
        });
        scene_nodes.push(gltf::Index::new(0));

        // Glow overlay mesh (subset 1) — separate node so extras propagate reliably
        if !overlay_primitives.is_empty() {
            let overlay_mesh_idx = meshes.len() as u32;
            meshes.push(gltf::Mesh {
                name: Some("glow_overlay_mesh".to_string()),
                primitives: overlay_primitives,
                weights: None,
                extensions: None,
                extras: None,
            });

            let overlay_node_idx = all_nodes.len() as u32;
            all_nodes.push(gltf::Node {
                mesh: Some(gltf::Index::new(overlay_mesh_idx)),
                name: Some("glow_overlay".to_string()),
                extras: Some(
                    RawValue::from_string(r#"{"glowOverlay":true}"#.to_string()).unwrap(),
                ),
                ..Default::default()
            });
            scene_nodes.push(gltf::Index::new(overlay_node_idx));
        }

        // Add helper nodes (dummy points, bounding spheres)
        let helper_nodes = geom.get_gltf_helper_nodes_for_mesh(0);
        let helper_start = all_nodes.len() as u32;
        for i in 0..helper_nodes.len() {
            scene_nodes.push(gltf::Index::new(helper_start + i as u32));
        }
        all_nodes.extend(helper_nodes);

        let scene = gltf::Scene {
            nodes: scene_nodes,
            name: Some("ItemScene".to_string()),
            extensions: None,
            extras: None,
        };

        let root = gltf::Root {
            asset: gltf::Asset {
                version: "2.0".to_string(),
                generator: Some("pko-tools".to_string()),
                ..Default::default()
            },
            nodes: all_nodes,
            scenes: vec![scene],
            scene: Some(gltf::Index::new(0)),
            accessors: fields.accessor,
            buffers: fields.buffer,
            buffer_views: fields.buffer_view,
            meshes,
            images: fields.image,
            textures: fields.texture,
            materials: fields.material,
            samplers: fields.sampler,
            ..Default::default()
        };

        let gltf_json = serde_json::to_string_pretty(&root)?;
        Ok(gltf_json)
    }

    /// Get metadata for this item's model
    pub fn get_metadata(&self, project_dir: &Path, model_id: &str) -> anyhow::Result<ItemMetadata> {
        let mut vertex_count = 0u32;
        let mut triangle_count = 0u32;
        let mut material_count = 0u32;
        let mut dummy_count = 0u32;
        let mut bspheres = 0u32;
        let mut bboxes = 0u32;

        if model_id != "0" && !model_id.is_empty() {
            if let Some(model_path) = resolve_item_model_path(project_dir, model_id) {
                if let Ok(geom) = CharacterGeometricModel::from_file(model_path) {
                    if let Some(ref mesh_info) = geom.mesh_info {
                        vertex_count = mesh_info.header.vertex_num;
                        triangle_count = mesh_info.header.index_num / 3;
                    }
                    if let Some(ref material_seq) = geom.material_seq {
                        material_count = material_seq.len() as u32;
                    }
                    if let Some(ref helper_data) = geom.helper_data {
                        dummy_count = helper_data.dummy_num;
                        bspheres = helper_data.bsphere_num;
                        bboxes = helper_data.bbox_num;
                    }
                }
            }
        }

        let mut available_models = vec![];
        let variants = [
            ("Ground", &self.model_ground),
            ("Lance", &self.model_lance),
            ("Carsise", &self.model_carsise),
            ("Phyllis", &self.model_phyllis),
            ("Ami", &self.model_ami),
        ];
        for (label, id) in variants {
            if id != "0" && !id.is_empty() {
                available_models.push(format!("{}: {}", label, id));
            }
        }

        Ok(ItemMetadata {
            item_id: self.id,
            item_name: self.name.clone(),
            item_type: self.item_type,
            model_id: model_id.to_string(),
            vertex_count,
            triangle_count,
            material_count,
            dummy_count,
            bounding_spheres: bspheres,
            bounding_boxes: bboxes,
            available_models,
        })
    }
}

/// Build glTF primitives for an item mesh, split into main primitives and glow overlay.
///
/// Returns `(main_primitives, overlay_primitives)`:
/// - `main_primitives`: all subsets except index 1 (the glow overlay)
/// - `overlay_primitives`: subset 1 only (empty if no subset 1 exists)
///
/// In the game, subset 1 is the glow overlay mesh (blade overlay), hidden by default
/// via `CSceneItem::LitUnresetTexture()` → `SetRenderFlag(FALSE)`. It only becomes
/// visible when a lit effect is applied. We separate it so the frontend can manage it
/// as a distinct node with reliable extras propagation.
fn build_item_primitives_split(
    project_dir: &Path,
    mesh_info: &CharacterMeshInfo,
    materials_vec: &[CharMaterialTextureInfo],
    fields: &mut GLTFFieldsToAggregate,
) -> (Vec<gltf::mesh::Primitive>, Vec<gltf::mesh::Primitive>) {
    // Shared vertex data (positions, normals, UVs) — created once, referenced by all primitives
    let pos_idx = mesh_info.get_vertex_position_accessor(fields);
    let norm_idx = mesh_info.get_vertex_normal_accessor(fields);
    let tc_idx = if !mesh_info.texcoord_seq[0].is_empty() {
        Some(mesh_info.get_vertex_texcoord_accessor(fields, 0))
    } else {
        None
    };

    let mode = match &mesh_info.header.pt_type {
        crate::d3d::D3DPrimitiveType::TriangleList => gltf::mesh::Mode::Triangles,
        crate::d3d::D3DPrimitiveType::TriangleStrip => gltf::mesh::Mode::TriangleStrip,
        _ => gltf::mesh::Mode::Triangles,
    };

    let build_attributes = || {
        let mut attrs = BTreeMap::from([
            (Checked::Valid(Semantic::Positions), Index::new(pos_idx as u32)),
            (Checked::Valid(Semantic::Normals), Index::new(norm_idx as u32)),
        ]);
        if let Some(tc) = tc_idx {
            attrs.insert(Checked::Valid(Semantic::TexCoords(0)), Index::new(tc as u32));
        }
        attrs
    };

    if mesh_info.subset_seq.is_empty() {
        // No subsets — single primitive with all indices and first material
        let idx_acc = mesh_info.get_vertex_index_accessor(fields);
        let mat_idx = build_single_material(project_dir, materials_vec.first(), fields);
        return (vec![gltf::mesh::Primitive {
            attributes: build_attributes(),
            indices: Some(Index::new(idx_acc as u32)),
            material: Some(Index::new(mat_idx as u32)),
            mode: Checked::Valid(mode),
            targets: None,
            extensions: None,
            extras: None,
        }], vec![]);
    }

    let mut main_prims = Vec::new();
    let mut overlay_prims = Vec::new();

    for (si, subset) in mesh_info.subset_seq.iter().enumerate() {
        let start = subset.start_index as usize;
        let count = (subset.primitive_num * 3) as usize;
        let end = (start + count).min(mesh_info.index_seq.len());
        let subset_indices = &mesh_info.index_seq[start..end];

        let idx_acc = create_index_accessor(subset_indices, si, fields);
        let is_glow_overlay = si == 1;

        // For glow overlay (subset 1), use material 0's texture instead of
        // its placeholder. The game replaces the texture at runtime with the
        // lit texture from item.lit.
        let mat = if is_glow_overlay {
            materials_vec.first()
        } else {
            materials_vec.get(si)
        };
        let mat_idx = build_single_material(project_dir, mat, fields);

        let prim = gltf::mesh::Primitive {
            attributes: build_attributes(),
            indices: Some(Index::new(idx_acc as u32)),
            material: Some(Index::new(mat_idx as u32)),
            mode: Checked::Valid(mode),
            targets: None,
            extensions: None,
            extras: None,
        };

        if is_glow_overlay {
            overlay_prims.push(prim);
        } else {
            main_prims.push(prim);
        }
    }

    (main_prims, overlay_prims)
}

/// Create a glTF index accessor for a slice of indices.
fn create_index_accessor(
    indices: &[u32],
    label: usize,
    fields: &mut GLTFFieldsToAggregate,
) -> usize {
    let buffer_index = fields.buffer.len();
    let buffer_view_index = fields.buffer_view.len();
    let accessor_index = fields.accessor.len();

    let mut data = Vec::with_capacity(indices.len() * 4);
    for idx in indices {
        data.extend_from_slice(&idx.to_le_bytes());
    }

    fields.buffer.push(gltf::Buffer {
        byte_length: USize64(data.len() as u64),
        extensions: None,
        extras: None,
        name: Some(format!("indices_buffer_{}", label)),
        uri: Some(format!(
            "data:application/octet-stream;base64,{}",
            BASE64_STANDARD.encode(&data)
        )),
    });

    fields.buffer_view.push(gltf::buffer::View {
        buffer: Index::new(buffer_index as u32),
        byte_length: USize64(data.len() as u64),
        byte_offset: Some(USize64(0)),
        target: Some(Checked::Valid(gltf::buffer::Target::ElementArrayBuffer)),
        byte_stride: None,
        extensions: None,
        extras: None,
        name: Some(format!("indices_view_{}", label)),
    });

    fields.accessor.push(Accessor {
        buffer_view: Some(Index::new(buffer_view_index as u32)),
        byte_offset: Some(USize64(0)),
        component_type: Checked::Valid(GenericComponentType(ComponentType::U32)),
        count: USize64(indices.len() as u64),
        extensions: None,
        extras: None,
        max: None,
        min: None,
        name: Some(format!("indices_accessor_{}", label)),
        normalized: false,
        sparse: None,
        type_: Checked::Valid(gltf::accessor::Type::Scalar),
    });

    accessor_index
}

/// Build a glTF material from a single CharMaterialTextureInfo.
/// Tries to load the texture from disk; falls back to color-only material.
fn build_single_material(
    project_dir: &Path,
    mat_info: Option<&CharMaterialTextureInfo>,
    fields: &mut GLTFFieldsToAggregate,
) -> usize {
    let material_index = fields.material.len();

    // Extract texture file name from the first valid texture slot
    let texture_file_name = mat_info.and_then(|mat| {
        mat.tex_seq
            .iter()
            .find(|tex| tex.stage != LW_INVALID_INDEX)
            .map(|tex| {
                let mut name = String::new();
                for &b in tex.file_name.iter() {
                    if b == 0 || b == b'.' {
                        break;
                    }
                    name.push(b as char);
                }
                name
            })
    });

    // Try to find and load the texture
    let mut texture_loaded = false;
    if let Some(ref tex_name) = texture_file_name {
        if !tex_name.is_empty() {
            let dirs = ["texture/item", "texture"];
            let exts = ["bmp", "tga", "dds", "png"];

            'search: for dir in &dirs {
                for ext in &exts {
                    let candidate = project_dir.join(dir).join(tex_name).with_extension(ext);
                    if !candidate.exists() {
                        continue;
                    }
                    if let Ok(raw_bytes) = std::fs::read(&candidate) {
                        let decoded = decode_pko_texture(&raw_bytes);
                        if let Ok(img) = image::load_from_memory(&decoded) {
                            let mut png_data = Vec::new();
                            let mut cursor = std::io::Cursor::new(&mut png_data);
                            if img
                                .write_to(&mut cursor, image::ImageFormat::Png)
                                .is_ok()
                            {
                                let data_uri = format!(
                                    "data:image/png;base64,{}",
                                    BASE64_STANDARD.encode(&png_data)
                                );

                                let image_index = fields.image.len();
                                fields.image.push(gltf::Image {
                                    name: Some(tex_name.clone()),
                                    buffer_view: None,
                                    extensions: None,
                                    mime_type: Some(MimeType("image/png".to_string())),
                                    extras: None,
                                    uri: Some(data_uri),
                                });

                                let sampler_index = fields.sampler.len();
                                fields.sampler.push(gltf::texture::Sampler {
                                    mag_filter: Some(Checked::Valid(
                                        ::gltf::texture::MagFilter::Linear,
                                    )),
                                    min_filter: Some(Checked::Valid(
                                        gltf::texture::MinFilter::LinearMipmapLinear,
                                    )),
                                    wrap_s: Checked::Valid(
                                        gltf::texture::WrappingMode::Repeat,
                                    ),
                                    wrap_t: Checked::Valid(
                                        gltf::texture::WrappingMode::Repeat,
                                    ),
                                    ..Default::default()
                                });

                                let texture_index = fields.texture.len();
                                fields.texture.push(gltf::Texture {
                                    name: Some(tex_name.clone()),
                                    sampler: Some(Index::new(sampler_index as u32)),
                                    source: Index::new(image_index as u32),
                                    extensions: None,
                                    extras: None,
                                });

                                let (base_color, emissive) = extract_material_colors(mat_info);

                                fields.material.push(gltf::Material {
                                    pbr_metallic_roughness: PbrMetallicRoughness {
                                        base_color_factor: PbrBaseColorFactor(base_color),
                                        base_color_texture: Some(gltf::texture::Info {
                                            index: Index::new(texture_index as u32),
                                            tex_coord: 0,
                                            extensions: None,
                                            extras: None,
                                        }),
                                        metallic_factor: StrengthFactor(0.0),
                                        roughness_factor: StrengthFactor(0.8),
                                        metallic_roughness_texture: None,
                                        extensions: None,
                                        extras: None,
                                    },
                                    emissive_factor: gltf::material::EmissiveFactor(emissive),
                                    ..Default::default()
                                });

                                texture_loaded = true;
                                break 'search;
                            }
                        }
                    }
                }
            }
        }
    }

    // Fallback: color-only material
    if !texture_loaded {
        let (base_color, emissive) = extract_material_colors(mat_info);
        fields.material.push(gltf::Material {
            pbr_metallic_roughness: PbrMetallicRoughness {
                base_color_factor: PbrBaseColorFactor(base_color),
                base_color_texture: None,
                metallic_factor: StrengthFactor(0.0),
                roughness_factor: StrengthFactor(0.8),
                metallic_roughness_texture: None,
                extensions: None,
                extras: None,
            },
            emissive_factor: gltf::material::EmissiveFactor(emissive),
            ..Default::default()
        });
    }

    material_index
}

/// Extract base color and emissive factor from material info.
fn extract_material_colors(mat_info: Option<&CharMaterialTextureInfo>) -> ([f32; 4], [f32; 3]) {
    mat_info
        .map(|mat| {
            let dif = &mat.material.dif;
            let emi = mat.material.emi.as_ref();
            (
                [dif.r, dif.g, dif.b, dif.a],
                emi.map(|e| [e.r, e.g, e.b]).unwrap_or([0.0, 0.0, 0.0]),
            )
        })
        .unwrap_or(([0.7, 0.7, 0.7, 1.0], [0.0, 0.0, 0.0]))
}

/// Decode a PKO-encoded texture file.
/// PKO uses a simple obfuscation: swap the first 44 bytes with the last 44 bytes,
/// then append a 4-byte "mp.x" marker. If the marker is present, reverse the process
/// to recover the original BMP/TGA/DDS data.
fn decode_pko_texture(data: &[u8]) -> Vec<u8> {
    const MARKER: &[u8; 4] = b"mp.x";
    const SWAP_SIZE: usize = 44;

    if data.len() > SWAP_SIZE + MARKER.len() && &data[data.len() - 4..] == MARKER {
        // Remove the 4-byte marker, then swap first/last 44 bytes
        let trimmed = &data[..data.len() - 4];
        let mut decoded = trimmed.to_vec();
        let len = decoded.len();
        if len >= SWAP_SIZE * 2 {
            let (first, rest) = decoded.split_at_mut(SWAP_SIZE);
            let last_start = rest.len() - SWAP_SIZE;
            let last = &mut rest[last_start..];
            // Swap in place
            for i in 0..SWAP_SIZE {
                std::mem::swap(&mut first[i], &mut last[i]);
            }
        }
        decoded
    } else {
        data.to_vec()
    }
}

/// Resolve an item model .lgo path with case-insensitive matching.
fn resolve_item_model_path(project_dir: &Path, model_id: &str) -> Option<PathBuf> {
    let target = format!("{}.lgo", model_id).to_lowercase();

    // Check model/item/ directory
    let item_dir = project_dir.join("model/item");
    if item_dir.exists() {
        for entry in std::fs::read_dir(&item_dir).ok()?.flatten() {
            if let Some(file_name) = entry.file_name().to_str() {
                if file_name.to_lowercase() == target {
                    return Some(entry.path());
                }
            }
        }
    }

    // Fallback: check model/character/ directory (some items share character models)
    let char_dir = project_dir.join("model/character");
    if char_dir.exists() {
        let padded_target = format!("{:0>10}.lgo", model_id).to_lowercase();
        for entry in std::fs::read_dir(&char_dir).ok()?.flatten() {
            if let Some(file_name) = entry.file_name().to_str() {
                let lower = file_name.to_lowercase();
                if lower == target || lower == padded_target {
                    return Some(entry.path());
                }
            }
        }
    }

    None
}
