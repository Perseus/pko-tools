//! LMO → glTF conversion for scene building models.
//!
//! Two entry points:
//! - `build_gltf_from_lmo` — standalone building viewer (single LMO → complete glTF)
//! - `load_scene_models` — map integration (batch load unique models, return glTF components)

use std::collections::HashMap;
use std::path::Path;

use anyhow::{anyhow, Result};
use base64::prelude::BASE64_STANDARD;
use base64::Engine;
use gltf::json as gltf_json;
use gltf_json::{
    accessor::{ComponentType, GenericComponentType},
    animation::{Channel, Sampler, Target},
    validation::{Checked, USize64},
};

use crate::item::model::decode_pko_texture;

use super::lmo::{self, LmoGeomObject, LmoModel};
use super::scene_obj::SceneObject;
use super::scene_obj_info::SceneObjModelInfo;

/// Search for an LMO file in the standard model directories.
/// PKO clients store scene models in `model/scene/`, but some may be in `model/`.
/// Also tries case-insensitive fallback.
pub fn find_lmo_path(project_dir: &Path, filename: &str) -> Option<std::path::PathBuf> {
    let candidates = [
        project_dir.join("model").join("scene").join(filename),
        project_dir.join("model").join(filename),
        project_dir
            .join("model")
            .join("scene")
            .join(filename.to_lowercase()),
        project_dir.join("model").join(filename.to_lowercase()),
    ];
    candidates.into_iter().find(|p| p.exists())
}

// ============================================================================
// Coordinate transform: Game Z-up → glTF Y-up
// (x, y, z) → (x, z, y)
//
// Terrain uses Z = +tileY (south = positive). Building meshes must match:
// PKO Y (south) → glTF Z (positive), no negation.
// ============================================================================

fn transform_position(p: [f32; 3]) -> [f32; 3] {
    [p[0], p[2], p[1]]
}

fn transform_normal(n: [f32; 3]) -> [f32; 3] {
    [n[0], n[2], n[1]]
}

/// Reverse triangle winding order: (i0, i1, i2) → (i0, i2, i1).
/// Required because the Y-up transform `(x,y,z)→(x,z,y)` is a reflection
/// (det = -1), which flips triangle facing. Reversing winding restores
/// correct front-face orientation in glTF (CCW).
fn reverse_winding(indices: &[u32]) -> Vec<u32> {
    let mut out = indices.to_vec();
    for tri in out.chunks_exact_mut(3) {
        tri.swap(1, 2);
    }
    out
}

/// Check if a 4x4 matrix is identity.
fn is_identity(mat: &[[f32; 4]; 4]) -> bool {
    for r in 0..4 {
        for c in 0..4 {
            let expected = if r == c { 1.0 } else { 0.0 };
            if (mat[r][c] - expected).abs() > 1e-5 {
                return false;
            }
        }
    }
    true
}

/// Apply a 4x4 transform matrix to a position (affine transform).
fn transform_by_matrix(pos: [f32; 3], mat: &[[f32; 4]; 4]) -> [f32; 3] {
    [
        pos[0] * mat[0][0] + pos[1] * mat[1][0] + pos[2] * mat[2][0] + mat[3][0],
        pos[0] * mat[0][1] + pos[1] * mat[1][1] + pos[2] * mat[2][1] + mat[3][1],
        pos[0] * mat[0][2] + pos[1] * mat[1][2] + pos[2] * mat[2][2] + mat[3][2],
    ]
}

/// Apply a 4x4 transform matrix to a normal (rotation only, no translation).
fn transform_normal_by_matrix(n: [f32; 3], mat: &[[f32; 4]; 4]) -> [f32; 3] {
    let r = [
        n[0] * mat[0][0] + n[1] * mat[1][0] + n[2] * mat[2][0],
        n[0] * mat[0][1] + n[1] * mat[1][1] + n[2] * mat[2][1],
        n[0] * mat[0][2] + n[1] * mat[1][2] + n[2] * mat[2][2],
    ];
    let len = (r[0] * r[0] + r[1] * r[1] + r[2] * r[2]).sqrt();
    if len > 1e-8 {
        [r[0] / len, r[1] / len, r[2] / len]
    } else {
        [0.0, 1.0, 0.0]
    }
}

// ============================================================================
// glTF helper: add buffer/view/accessor
// ============================================================================

struct GltfBuilder {
    buffers: Vec<gltf_json::Buffer>,
    buffer_views: Vec<gltf_json::buffer::View>,
    accessors: Vec<gltf_json::Accessor>,
    meshes: Vec<gltf_json::Mesh>,
    materials: Vec<gltf_json::Material>,
    nodes: Vec<gltf_json::Node>,
    images: Vec<gltf_json::Image>,
    samplers: Vec<gltf_json::texture::Sampler>,
    textures: Vec<gltf_json::Texture>,
}

impl GltfBuilder {
    fn new() -> Self {
        Self {
            buffers: Vec::new(),
            buffer_views: Vec::new(),
            accessors: Vec::new(),
            meshes: Vec::new(),
            materials: Vec::new(),
            nodes: Vec::new(),
            images: Vec::new(),
            samplers: Vec::new(),
            textures: Vec::new(),
        }
    }

    fn add_accessor_f32(
        &mut self,
        data: &[f32],
        name: &str,
        acc_type: gltf_json::accessor::Type,
        components_per_element: usize,
        min: Option<serde_json::Value>,
        max: Option<serde_json::Value>,
    ) -> u32 {
        let buf_idx = self.buffers.len();
        let bv_idx = self.buffer_views.len();
        let acc_idx = self.accessors.len();

        let bytes: Vec<u8> = data.iter().flat_map(|f| f.to_le_bytes()).collect();
        let count = data.len() / components_per_element;

        self.buffers.push(gltf_json::Buffer {
            byte_length: USize64(bytes.len() as u64),
            extensions: None,
            extras: None,
            name: Some(format!("{}_buffer", name)),
            uri: Some(format!(
                "data:application/octet-stream;base64,{}",
                BASE64_STANDARD.encode(&bytes)
            )),
        });

        self.buffer_views.push(gltf_json::buffer::View {
            buffer: gltf_json::Index::new(buf_idx as u32),
            byte_length: USize64(bytes.len() as u64),
            byte_offset: Some(USize64(0)),
            target: Some(Checked::Valid(gltf_json::buffer::Target::ArrayBuffer)),
            byte_stride: None,
            extensions: None,
            extras: None,
            name: Some(format!("{}_view", name)),
        });

        self.accessors.push(gltf_json::Accessor {
            buffer_view: Some(gltf_json::Index::new(bv_idx as u32)),
            byte_offset: Some(USize64(0)),
            component_type: Checked::Valid(GenericComponentType(ComponentType::F32)),
            count: USize64(count as u64),
            extensions: None,
            extras: None,
            max,
            min,
            name: Some(format!("{}_accessor", name)),
            normalized: false,
            sparse: None,
            type_: Checked::Valid(acc_type),
        });

        acc_idx as u32
    }

    fn add_index_accessor(&mut self, indices: &[u32], name: &str) -> u32 {
        let buf_idx = self.buffers.len();
        let bv_idx = self.buffer_views.len();
        let acc_idx = self.accessors.len();

        // Use u16 if possible for smaller buffers
        let (bytes, comp_type) = if indices.iter().all(|&i| i <= u16::MAX as u32) {
            let b: Vec<u8> = indices
                .iter()
                .flat_map(|&i| (i as u16).to_le_bytes())
                .collect();
            (b, ComponentType::U16)
        } else {
            let b: Vec<u8> = indices.iter().flat_map(|i| i.to_le_bytes()).collect();
            (b, ComponentType::U32)
        };

        self.buffers.push(gltf_json::Buffer {
            byte_length: USize64(bytes.len() as u64),
            extensions: None,
            extras: None,
            name: Some(format!("{}_buffer", name)),
            uri: Some(format!(
                "data:application/octet-stream;base64,{}",
                BASE64_STANDARD.encode(&bytes)
            )),
        });

        self.buffer_views.push(gltf_json::buffer::View {
            buffer: gltf_json::Index::new(buf_idx as u32),
            byte_length: USize64(bytes.len() as u64),
            byte_offset: Some(USize64(0)),
            target: Some(Checked::Valid(
                gltf_json::buffer::Target::ElementArrayBuffer,
            )),
            byte_stride: None,
            extensions: None,
            extras: None,
            name: Some(format!("{}_view", name)),
        });

        self.accessors.push(gltf_json::Accessor {
            buffer_view: Some(gltf_json::Index::new(bv_idx as u32)),
            byte_offset: Some(USize64(0)),
            component_type: Checked::Valid(GenericComponentType(comp_type)),
            count: USize64(indices.len() as u64),
            extensions: None,
            extras: None,
            max: None,
            min: None,
            name: Some(format!("{}_accessor", name)),
            normalized: false,
            sparse: None,
            type_: Checked::Valid(gltf_json::accessor::Type::Scalar),
        });

        acc_idx as u32
    }
}

// ============================================================================
// Build glTF material from LMO material data (with texture loading)
// ============================================================================

/// Try to find a texture file from the PKO project directory.
/// Scene model textures can be in several directories.
fn find_texture_file(project_dir: &Path, tex_name: &str) -> Option<std::path::PathBuf> {
    // Strip extension from the material's texture filename
    let stem = tex_name
        .rfind('.')
        .map(|i| &tex_name[..i])
        .unwrap_or(tex_name);

    let dirs = [
        "texture/scene",
        "texture/model",
        "texture/item",
        "texture/character",
        "texture",
    ];
    let exts = ["bmp", "tga", "dds", "png"];

    for dir in &dirs {
        for ext in &exts {
            let candidate = project_dir.join(dir).join(format!("{}.{}", stem, ext));
            if candidate.exists() {
                return Some(candidate);
            }
            // Try lowercase
            let candidate_lc =
                project_dir
                    .join(dir)
                    .join(format!("{}.{}", stem.to_lowercase(), ext));
            if candidate_lc.exists() {
                return Some(candidate_lc);
            }
        }
    }
    None
}

/// Load a texture from disk, decode PKO encoding, convert to PNG, return base64 data URI.
fn load_texture_as_data_uri(path: &Path) -> Option<String> {
    let raw_bytes = std::fs::read(path).ok()?;
    let decoded = decode_pko_texture(&raw_bytes);
    let img = match image::load_from_memory(&decoded) {
        Ok(img) => img,
        Err(e) => {
            eprintln!(
                "Warning: failed to decode texture {}: {}",
                path.display(),
                e
            );
            return None;
        }
    };
    let mut png_data = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut png_data);
    img.write_to(&mut cursor, image::ImageFormat::Png).ok()?;
    Some(format!(
        "data:image/png;base64,{}",
        BASE64_STANDARD.encode(&png_data)
    ))
}

/// D3D blend constants matching D3DBLEND enum values used in LMO render states.
const D3DBLEND_ZERO: u32 = 1;
const D3DBLEND_ONE: u32 = 2;
const D3DBLEND_SRCCOLOR: u32 = 3;
const D3DBLEND_INVSRCCOLOR: u32 = 4;
const D3DBLEND_SRCALPHA: u32 = 5;
const D3DBLEND_DESTALPHA: u32 = 7;

/// Returns the expected D3D SrcBlend value for a given transp_type, or None for type 0.
fn default_src_blend_for_transp_type(transp_type: u32) -> Option<u32> {
    match transp_type {
        0 => None,                      // FILTER: no blend set
        1 => Some(D3DBLEND_ONE),        // ADDITIVE: One/One
        2 => Some(D3DBLEND_SRCCOLOR),   // ADDITIVE1: SrcColor/One
        3 => Some(D3DBLEND_SRCCOLOR),   // ADDITIVE2: SrcColor/InvSrcColor
        4 => Some(D3DBLEND_SRCALPHA),   // ADDITIVE3: SrcAlpha/DestAlpha
        5 => Some(D3DBLEND_ZERO),       // SUBTRACTIVE: Zero/InvSrcColor
        _ => Some(D3DBLEND_ONE),        // 6-8 fall through to ONE/ONE
    }
}

/// Returns the expected D3D DstBlend value for a given transp_type, or None for type 0.
fn default_dst_blend_for_transp_type(transp_type: u32) -> Option<u32> {
    match transp_type {
        0 => None,
        1 => Some(D3DBLEND_ONE),
        2 => Some(D3DBLEND_ONE),
        3 => Some(D3DBLEND_INVSRCCOLOR),
        4 => Some(D3DBLEND_DESTALPHA),
        5 => Some(D3DBLEND_INVSRCCOLOR),
        _ => Some(D3DBLEND_ONE),
    }
}

fn build_lmo_material(
    builder: &mut GltfBuilder,
    mat: &lmo::LmoMaterial,
    name: &str,
    project_dir: &Path,
    load_textures: bool,
) {
    // Canonicalize types 6-8 to type 1 (they fall through to ONE/ONE in engine)
    // Types > 8 are unknown/corrupt — warn and remap to type 1
    let effective_transp = match mat.transp_type {
        0..=5 => mat.transp_type,
        6..=8 => 1,
        other => {
            eprintln!(
                "WARN: material '{}' has unknown transp_type={}, remapping to type 1",
                name, other
            );
            1
        }
    };
    let is_effect = effective_transp != lmo::TRANSP_FILTER;

    let base_color = [
        mat.diffuse[0].clamp(0.0, 1.0),
        mat.diffuse[1].clamp(0.0, 1.0),
        mat.diffuse[2].clamp(0.0, 1.0),
        mat.opacity.clamp(0.0, 1.0),
    ];

    // Effect materials (types 1-5): Unity shader handles blending, use Opaque alpha mode
    // UNLESS alpha test is also enabled — then use Mask so glTF importers respect the cutoff.
    // Non-effect (type 0): use existing alpha test / opacity logic.
    let alpha_mode = if is_effect {
        if mat.alpha_test_enabled {
            Checked::Valid(gltf_json::material::AlphaMode::Mask)
        } else {
            Checked::Valid(gltf_json::material::AlphaMode::Opaque)
        }
    } else if mat.alpha_test_enabled {
        Checked::Valid(gltf_json::material::AlphaMode::Mask)
    } else if mat.opacity < 0.99 {
        Checked::Valid(gltf_json::material::AlphaMode::Blend)
    } else {
        Checked::Valid(gltf_json::material::AlphaMode::Opaque)
    };

    let alpha_cutoff = if mat.alpha_test_enabled {
        let ref_value = if mat.alpha_ref == 0 { 129u8 } else { mat.alpha_ref };
        Some(gltf_json::material::AlphaCutoff(
            (ref_value as f32 / 255.0).clamp(0.0, 1.0),
        ))
    } else {
        None
    };

    // Warn if per-material blend overrides differ from engine defaults for this type
    if let Some(sb) = mat.src_blend {
        let default_src = default_src_blend_for_transp_type(effective_transp);
        if let Some(ds) = default_src {
            if sb != ds {
                eprintln!(
                    "WARN: material '{}' has src_blend={} but type {} defaults to {}",
                    name, sb, effective_transp, ds
                );
            }
        }
    }
    if let Some(db) = mat.dest_blend {
        let default_dst = default_dst_blend_for_transp_type(effective_transp);
        if let Some(dd) = default_dst {
            if db != dd {
                eprintln!(
                    "WARN: material '{}' has dest_blend={} but type {} defaults to {}",
                    name, db, effective_transp, dd
                );
            }
        }
    }

    // Structured material name suffix for blend mode signaling to Unity
    // Encode: T=transp_type, A=alpha_ref (0 if no alpha test), O=opacity as byte 0-255
    // Engine overrides ALPHAREF to 129 at runtime (RenderStateMgr.cpp _rsa_sceneobj),
    // so materials with alpha_test_enabled=true but alpha_ref=0 effectively use 129.
    let material_name = if is_effect || mat.alpha_test_enabled {
        let alpha_ref = if mat.alpha_test_enabled {
            let raw = mat.alpha_ref as u32;
            if raw == 0 { 129 } else { raw } // Engine default ALPHAREF=129
        } else {
            0
        };
        let opacity_byte = (mat.opacity.clamp(0.0, 1.0) * 255.0).round() as u32;
        format!(
            "{}__PKO_T{}_A{}_O{}",
            name, effective_transp, alpha_ref, opacity_byte
        )
    } else {
        name.to_string()
    };

    // Try to load and embed the texture (skipped for map batch loading)
    let base_color_texture = if !load_textures {
        None
    } else {
        mat.tex_filename
            .as_deref()
            .filter(|f| !f.is_empty())
            .and_then(|tex_name| find_texture_file(project_dir, tex_name))
            .and_then(|tex_path| {
                let data_uri = load_texture_as_data_uri(&tex_path)?;
                let tex_stem = tex_path
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_else(|| name.to_string());

                let image_index = builder.images.len() as u32;
                builder.images.push(gltf_json::Image {
                    name: Some(tex_stem.clone()),
                    buffer_view: None,
                    extensions: None,
                    mime_type: Some(gltf_json::image::MimeType("image/png".to_string())),
                    extras: None,
                    uri: Some(data_uri),
                });

                let sampler_index = builder.samplers.len() as u32;
                builder.samplers.push(gltf_json::texture::Sampler {
                    mag_filter: Some(Checked::Valid(gltf_json::texture::MagFilter::Linear)),
                    min_filter: Some(Checked::Valid(
                        gltf_json::texture::MinFilter::LinearMipmapLinear,
                    )),
                    wrap_s: Checked::Valid(gltf_json::texture::WrappingMode::Repeat),
                    wrap_t: Checked::Valid(gltf_json::texture::WrappingMode::Repeat),
                    ..Default::default()
                });

                let texture_index = builder.textures.len() as u32;
                builder.textures.push(gltf_json::Texture {
                    name: Some(tex_stem),
                    sampler: Some(gltf_json::Index::new(sampler_index)),
                    source: gltf_json::Index::new(image_index),
                    extensions: None,
                    extras: None,
                });

                Some(gltf_json::texture::Info {
                    index: gltf_json::Index::new(texture_index),
                    tex_coord: 0,
                    extensions: None,
                    extras: None,
                })
            })
    };

    // Emissive factor — clamp to [0,1] for glTF spec compliance
    let emissive = [
        mat.emissive[0].clamp(0.0, 1.0),
        mat.emissive[1].clamp(0.0, 1.0),
        mat.emissive[2].clamp(0.0, 1.0),
    ];

    builder.materials.push(gltf_json::Material {
        alpha_cutoff,
        alpha_mode,
        double_sided: true,
        pbr_metallic_roughness: gltf_json::material::PbrMetallicRoughness {
            base_color_factor: gltf_json::material::PbrBaseColorFactor(base_color),
            base_color_texture,
            metallic_factor: gltf_json::material::StrengthFactor(0.0),
            roughness_factor: gltf_json::material::StrengthFactor(0.8),
            metallic_roughness_texture: None,
            extensions: None,
            extras: None,
        },
        normal_texture: None,
        occlusion_texture: None,
        emissive_texture: None,
        emissive_factor: gltf_json::material::EmissiveFactor(emissive),
        extensions: None,
        extras: None,
        name: Some(material_name),
    });
}

// ============================================================================
// Build glTF primitives for a single geometry object
// ============================================================================

fn build_geom_primitives(
    builder: &mut GltfBuilder,
    geom: &LmoGeomObject,
    prefix: &str,
    material_base_idx: u32,
    skip_local_transform: bool,
) -> Vec<gltf_json::mesh::Primitive> {
    if geom.vertices.is_empty() || geom.indices.is_empty() {
        return vec![];
    }

    // Apply mat_local transform if not identity — skip for animated objects
    // (animated objects get their transform from animation keyframes instead)
    let use_local_mat = !skip_local_transform && !is_identity(&geom.mat_local);

    let positions: Vec<f32> = geom
        .vertices
        .iter()
        .flat_map(|v| {
            let p = if use_local_mat {
                transform_by_matrix(*v, &geom.mat_local)
            } else {
                *v
            };
            let t = transform_position(p);
            t.into_iter()
        })
        .collect();

    let normals: Vec<f32> = if !geom.normals.is_empty() {
        geom.normals
            .iter()
            .flat_map(|n| {
                let n2 = if use_local_mat {
                    transform_normal_by_matrix(*n, &geom.mat_local)
                } else {
                    *n
                };
                let t = transform_normal(n2);
                t.into_iter()
            })
            .collect()
    } else {
        Vec::new()
    };

    // Compute bounds
    let vertex_count = geom.vertices.len();
    let mut pos_min = [f32::MAX; 3];
    let mut pos_max = [f32::MIN; 3];
    for i in 0..vertex_count {
        for c in 0..3 {
            let v = positions[i * 3 + c];
            pos_min[c] = pos_min[c].min(v);
            pos_max[c] = pos_max[c].max(v);
        }
    }

    let pos_acc = builder.add_accessor_f32(
        &positions,
        &format!("{}_pos", prefix),
        gltf_json::accessor::Type::Vec3,
        3,
        Some(serde_json::to_value(pos_min).unwrap()),
        Some(serde_json::to_value(pos_max).unwrap()),
    );

    let norm_acc = if !normals.is_empty() {
        Some(builder.add_accessor_f32(
            &normals,
            &format!("{}_norm", prefix),
            gltf_json::accessor::Type::Vec3,
            3,
            None,
            None,
        ))
    } else {
        None
    };

    let uv_acc = if !geom.texcoords.is_empty() {
        let uv_data: Vec<f32> = geom
            .texcoords
            .iter()
            .flat_map(|t| t.iter().copied())
            .collect();
        Some(builder.add_accessor_f32(
            &uv_data,
            &format!("{}_uv", prefix),
            gltf_json::accessor::Type::Vec2,
            2,
            None,
            None,
        ))
    } else {
        None
    };

    // Export vertex colors (COLOR_0) if present.
    // D3DCOLOR is packed as 0xAARRGGBB — extract in correct byte order.
    let color_acc = if !geom.vertex_colors.is_empty() {
        let color_data: Vec<f32> = geom
            .vertex_colors
            .iter()
            .flat_map(|&c| {
                let r = ((c >> 16) & 0xFF) as f32 / 255.0;
                let g = ((c >> 8) & 0xFF) as f32 / 255.0;
                let b = (c & 0xFF) as f32 / 255.0;
                let a = ((c >> 24) & 0xFF) as f32 / 255.0;
                [r, g, b, a]
            })
            .collect();
        Some(builder.add_accessor_f32(
            &color_data,
            &format!("{}_color", prefix),
            gltf_json::accessor::Type::Vec4,
            4,
            None,
            None,
        ))
    } else {
        None
    };

    // Build primitives per subset (each subset maps to a material)
    if geom.subsets.is_empty() {
        // No subsets — single primitive with all indices
        let reversed = reverse_winding(&geom.indices);
        let idx_acc = builder.add_index_accessor(&reversed, &format!("{}_idx", prefix));

        let mut attributes = std::collections::BTreeMap::new();
        attributes.insert(
            Checked::Valid(gltf_json::mesh::Semantic::Positions),
            gltf_json::Index::new(pos_acc),
        );
        if let Some(na) = norm_acc {
            attributes.insert(
                Checked::Valid(gltf_json::mesh::Semantic::Normals),
                gltf_json::Index::new(na),
            );
        }
        if let Some(ua) = uv_acc {
            attributes.insert(
                Checked::Valid(gltf_json::mesh::Semantic::TexCoords(0)),
                gltf_json::Index::new(ua),
            );
        }
        if let Some(ca) = color_acc {
            attributes.insert(
                Checked::Valid(gltf_json::mesh::Semantic::Colors(0)),
                gltf_json::Index::new(ca),
            );
        }

        vec![gltf_json::mesh::Primitive {
            attributes,
            indices: Some(gltf_json::Index::new(idx_acc)),
            material: Some(gltf_json::Index::new(material_base_idx)),
            mode: Checked::Valid(gltf_json::mesh::Mode::Triangles),
            targets: None,
            extensions: None,
            extras: None,
        }]
    } else {
        // One primitive per subset
        let mut primitives = Vec::new();
        for (si, subset) in geom.subsets.iter().enumerate() {
            let start = subset.start_index as usize;
            let count = subset.primitive_num as usize * 3; // triangles × 3
            let end = (start + count).min(geom.indices.len());

            if start >= geom.indices.len() || start >= end {
                continue;
            }

            let sub_indices = reverse_winding(&geom.indices[start..end]);
            let idx_acc =
                builder.add_index_accessor(&sub_indices, &format!("{}_idx_s{}", prefix, si));

            let mut attributes = std::collections::BTreeMap::new();
            attributes.insert(
                Checked::Valid(gltf_json::mesh::Semantic::Positions),
                gltf_json::Index::new(pos_acc),
            );
            if let Some(na) = norm_acc {
                attributes.insert(
                    Checked::Valid(gltf_json::mesh::Semantic::Normals),
                    gltf_json::Index::new(na),
                );
            }
            if let Some(ua) = uv_acc {
                attributes.insert(
                    Checked::Valid(gltf_json::mesh::Semantic::TexCoords(0)),
                    gltf_json::Index::new(ua),
                );
            }
            if let Some(ca) = color_acc {
                attributes.insert(
                    Checked::Valid(gltf_json::mesh::Semantic::Colors(0)),
                    gltf_json::Index::new(ca),
                );
            }

            // Material index: use subset index if we have enough materials
            let mat_idx = if si < geom.materials.len() {
                material_base_idx + si as u32
            } else {
                material_base_idx
            };

            primitives.push(gltf_json::mesh::Primitive {
                attributes,
                indices: Some(gltf_json::Index::new(idx_acc)),
                material: Some(gltf_json::Index::new(mat_idx)),
                mode: Checked::Valid(gltf_json::mesh::Mode::Triangles),
                targets: None,
                extensions: None,
                extras: None,
            });
        }
        primitives
    }
}

// ============================================================================
// Animation: convert LMO matrix keyframes → glTF animation tracks
// ============================================================================

const FRAME_RATE: f32 = 30.0;

/// Transform a position vector from Z-up game space to Y-up glTF space.
fn z_up_to_y_up_vec3(v: [f32; 3]) -> [f32; 3] {
    [v[0], v[2], -v[1]]
}

/// Transform a quaternion from Z-up game space to Y-up glTF space.
/// Input/output in glTF [x, y, z, w] order.
fn z_up_to_y_up_quat(q: [f32; 4]) -> [f32; 4] {
    [q[0], q[2], -q[1], q[3]]
}

/// Build glTF animations for animated geometry objects.
///
/// Each animated object gets translation + rotation channels targeting its node.
/// Returns a vec of animations (empty if none are animated).
fn build_animations(
    builder: &mut GltfBuilder,
    animated_nodes: &[(u32, &LmoGeomObject)],
) -> Vec<gltf_json::Animation> {
    if animated_nodes.is_empty() {
        return vec![];
    }

    let mut channels: Vec<Channel> = Vec::new();
    let mut samplers: Vec<Sampler> = Vec::new();

    for &(node_idx, geom) in animated_nodes {
        let anim = match &geom.animation {
            Some(a) => a,
            None => continue,
        };

        let frame_num = anim.frame_num as usize;
        if frame_num == 0 {
            continue;
        }

        // Build keyframe timings: [0, 1/30, 2/30, ..., (N-1)/30]
        let timings: Vec<f32> = (0..frame_num).map(|f| f as f32 / FRAME_RATE).collect();
        let time_min = 0.0f32;
        let time_max = timings.last().copied().unwrap_or(0.0);

        let time_acc_idx = builder.add_accessor_f32(
            &timings,
            &format!("anim_time_node{}", node_idx),
            gltf_json::accessor::Type::Scalar,
            1,
            Some(serde_json::json!([time_min])),
            Some(serde_json::json!([time_max])),
        );

        // Build translation output: Vec3 per frame with Z→Y coordinate transform
        let translations: Vec<f32> = anim
            .translations
            .iter()
            .flat_map(|t| {
                let yt = z_up_to_y_up_vec3(*t);
                yt.into_iter()
            })
            .collect();

        let trans_acc_idx = builder.add_accessor_f32(
            &translations,
            &format!("anim_trans_node{}", node_idx),
            gltf_json::accessor::Type::Vec3,
            3,
            None,
            None,
        );

        // Build rotation output: Vec4 quaternion per frame with Z→Y transform
        let rotations: Vec<f32> = anim
            .rotations
            .iter()
            .flat_map(|r| {
                let yr = z_up_to_y_up_quat(*r);
                yr.into_iter()
            })
            .collect();

        let rot_acc_idx = builder.add_accessor_f32(
            &rotations,
            &format!("anim_rot_node{}", node_idx),
            gltf_json::accessor::Type::Vec4,
            4,
            None,
            None,
        );

        // Samplers: translation + rotation
        let trans_sampler_idx = samplers.len() as u32;
        samplers.push(Sampler {
            input: gltf_json::Index::new(time_acc_idx),
            interpolation: Checked::Valid(gltf_json::animation::Interpolation::Linear),
            output: gltf_json::Index::new(trans_acc_idx),
            extensions: None,
            extras: None,
        });

        let rot_sampler_idx = samplers.len() as u32;
        samplers.push(Sampler {
            input: gltf_json::Index::new(time_acc_idx),
            interpolation: Checked::Valid(gltf_json::animation::Interpolation::Linear),
            output: gltf_json::Index::new(rot_acc_idx),
            extensions: None,
            extras: None,
        });

        // Channels targeting the geometry object's node
        channels.push(Channel {
            sampler: gltf_json::Index::new(trans_sampler_idx),
            target: Target {
                node: gltf_json::Index::new(node_idx),
                path: Checked::Valid(gltf_json::animation::Property::Translation),
                extensions: None,
                extras: None,
            },
            extensions: None,
            extras: None,
        });

        channels.push(Channel {
            sampler: gltf_json::Index::new(rot_sampler_idx),
            target: Target {
                node: gltf_json::Index::new(node_idx),
                path: Checked::Valid(gltf_json::animation::Property::Rotation),
                extensions: None,
                extras: None,
            },
            extensions: None,
            extras: None,
        });
    }

    if channels.is_empty() {
        return vec![];
    }

    vec![gltf_json::Animation {
        name: Some("BuildingAnimation".to_string()),
        channels,
        samplers,
        extensions: None,
        extras: None,
    }]
}

// ============================================================================
// Public API: build glTF from a single LMO file (standalone building viewer)
// ============================================================================

/// Build a complete glTF JSON string for a single LMO building model.
pub fn build_gltf_from_lmo(lmo_path: &Path, project_dir: &Path) -> Result<String> {
    let model = lmo::load_lmo(lmo_path)?;

    if model.geom_objects.is_empty() {
        return Err(anyhow!("LMO file has no geometry objects"));
    }

    let mut builder = GltfBuilder::new();
    let mut child_indices = Vec::new();
    let mut animated_nodes: Vec<(u32, &LmoGeomObject)> = Vec::new();

    for (gi, geom) in model.geom_objects.iter().enumerate() {
        let prefix = format!("geom{}", gi);
        let material_base_idx = builder.materials.len() as u32;

        // Add materials for this geometry object (with textures for standalone viewer)
        if geom.materials.is_empty() {
            // Default material
            build_lmo_material(
                &mut builder,
                &lmo::LmoMaterial {
                    diffuse: [0.7, 0.7, 0.7, 1.0],
                    ambient: [0.3, 0.3, 0.3, 1.0],
                    emissive: [0.0, 0.0, 0.0, 0.0],
                    opacity: 1.0,
                    transp_type: 0,
                    alpha_test_enabled: false,
                    alpha_ref: 0,
                    src_blend: None,
                    dest_blend: None,
                    tex_filename: None,
                },
                &format!("{}_default_mat", prefix),
                project_dir,
                true,
            );
        } else {
            for (mi, mat) in geom.materials.iter().enumerate() {
                build_lmo_material(
                    &mut builder,
                    mat,
                    &format!("{}_mat{}", prefix, mi),
                    project_dir,
                    true,
                );
            }
        }

        let has_animation = geom.animation.is_some();
        let primitives = build_geom_primitives(
            &mut builder,
            geom,
            &prefix,
            material_base_idx,
            has_animation,
        );

        if primitives.is_empty() {
            continue;
        }

        let mesh_idx = builder.meshes.len() as u32;
        builder.meshes.push(gltf_json::Mesh {
            name: Some(format!("geom_{}", gi)),
            primitives,
            weights: None,
            extensions: None,
            extras: None,
        });

        let node_idx = builder.nodes.len() as u32;
        builder.nodes.push(gltf_json::Node {
            mesh: Some(gltf_json::Index::new(mesh_idx)),
            name: Some(format!("geom_node_{}", gi)),
            ..Default::default()
        });
        child_indices.push(gltf_json::Index::new(node_idx));

        // Track animated objects for glTF animation generation
        if has_animation {
            animated_nodes.push((node_idx, geom));
        }
    }

    if child_indices.is_empty() {
        return Err(anyhow!("No renderable geometry in LMO file"));
    }

    // Build animation if any objects are animated
    let animations = build_animations(&mut builder, &animated_nodes);

    // Root node
    let root_idx = builder.nodes.len() as u32;
    builder.nodes.push(gltf_json::Node {
        name: Some("building_root".to_string()),
        children: Some(child_indices),
        ..Default::default()
    });

    let root = gltf_json::Root {
        asset: gltf_json::Asset {
            version: "2.0".to_string(),
            generator: Some("pko-tools".to_string()),
            ..Default::default()
        },
        nodes: builder.nodes,
        scenes: vec![gltf_json::Scene {
            nodes: vec![gltf_json::Index::new(root_idx)],
            name: Some("BuildingScene".to_string()),
            extensions: None,
            extras: None,
        }],
        scene: Some(gltf_json::Index::new(0)),
        accessors: builder.accessors,
        buffers: builder.buffers,
        buffer_views: builder.buffer_views,
        meshes: builder.meshes,
        materials: builder.materials,
        images: builder.images,
        samplers: builder.samplers,
        textures: builder.textures,
        animations,
        ..Default::default()
    };

    let json = serde_json::to_string_pretty(&root)?;
    Ok(json)
}

/// Build a GLB-ready building model: returns (glTF JSON string, binary buffer).
/// Uses the same mesh/material/animation logic as `build_gltf_from_lmo`, but
/// packs all buffer data into a single binary buffer for GLB writing.
pub fn build_glb_from_lmo(lmo_path: &Path, project_dir: &Path) -> Result<(String, Vec<u8>)> {
    let model = lmo::load_lmo(lmo_path)?;

    if model.geom_objects.is_empty() {
        return Err(anyhow!("LMO file has no geometry objects"));
    }

    // Build using the same GltfBuilder approach as build_gltf_from_lmo
    let mut builder = GltfBuilder::new();
    let mut child_indices = Vec::new();
    let mut animated_nodes: Vec<(u32, &LmoGeomObject)> = Vec::new();

    for (gi, geom) in model.geom_objects.iter().enumerate() {
        let prefix = format!("geom{}", gi);
        let material_base_idx = builder.materials.len() as u32;

        if geom.materials.is_empty() {
            build_lmo_material(
                &mut builder,
                &lmo::LmoMaterial {
                    diffuse: [0.7, 0.7, 0.7, 1.0],
                    ambient: [0.3, 0.3, 0.3, 1.0],
                    emissive: [0.0, 0.0, 0.0, 0.0],
                    opacity: 1.0,
                    transp_type: 0,
                    alpha_test_enabled: false,
                    alpha_ref: 0,
                    src_blend: None,
                    dest_blend: None,
                    tex_filename: None,
                },
                &format!("{}_default_mat", prefix),
                project_dir,
                true,
            );
        } else {
            for (mi, mat) in geom.materials.iter().enumerate() {
                build_lmo_material(
                    &mut builder,
                    mat,
                    &format!("{}_mat{}", prefix, mi),
                    project_dir,
                    true,
                );
            }
        }

        let has_animation = geom.animation.is_some();
        let primitives = build_geom_primitives(
            &mut builder,
            geom,
            &prefix,
            material_base_idx,
            has_animation,
        );

        if primitives.is_empty() {
            continue;
        }

        let mesh_idx = builder.meshes.len() as u32;
        builder.meshes.push(gltf_json::Mesh {
            name: Some(format!("geom_{}", gi)),
            primitives,
            weights: None,
            extensions: None,
            extras: None,
        });

        let node_idx = builder.nodes.len() as u32;
        builder.nodes.push(gltf_json::Node {
            mesh: Some(gltf_json::Index::new(mesh_idx)),
            name: Some(format!("geom_node_{}", gi)),
            ..Default::default()
        });
        child_indices.push(gltf_json::Index::new(node_idx));

        if has_animation {
            animated_nodes.push((node_idx, geom));
        }
    }

    if child_indices.is_empty() {
        return Err(anyhow!("No renderable geometry in LMO file"));
    }

    let animations = build_animations(&mut builder, &animated_nodes);

    let root_idx = builder.nodes.len() as u32;
    builder.nodes.push(gltf_json::Node {
        name: Some("building_root".to_string()),
        children: Some(child_indices),
        ..Default::default()
    });

    // Convert data-URI buffers into a single GLB binary buffer, then append
    // image data as additional buffer views.
    let (mut bin, _single_buffer, mut buffer_views_out) =
        merge_data_uri_buffers(&builder.buffers, &builder.buffer_views)?;

    let mut images_out = Vec::new();
    for img in &builder.images {
        if let Some(ref uri) = img.uri {
            if let Some((mime, data)) = decode_data_uri_with_mime(uri) {
                let pad = (4 - (bin.len() % 4)) % 4;
                bin.extend(std::iter::repeat(0u8).take(pad));
                let offset = bin.len();
                bin.extend_from_slice(&data);

                let bv_idx = buffer_views_out.len();
                buffer_views_out.push(gltf_json::buffer::View {
                    buffer: gltf_json::Index::new(0),
                    byte_length: USize64(data.len() as u64),
                    byte_offset: Some(USize64(offset as u64)),
                    target: None,
                    byte_stride: None,
                    extensions: None,
                    extras: None,
                    name: img.name.as_ref().map(|n| format!("{}_view", n)),
                });

                images_out.push(gltf_json::Image {
                    buffer_view: Some(gltf_json::Index::new(bv_idx as u32)),
                    mime_type: Some(gltf_json::image::MimeType(mime)),
                    uri: None,
                    name: img.name.clone(),
                    extensions: None,
                    extras: None,
                });
            } else {
                // Keep as-is (shouldn't happen for our generated data)
                images_out.push(img.clone());
            }
        } else {
            images_out.push(img.clone());
        }
    }

    let final_buffer = gltf_json::Buffer {
        byte_length: USize64(bin.len() as u64),
        extensions: None,
        extras: None,
        name: Some("building_buffer".into()),
        uri: None,
    };

    let root = gltf_json::Root {
        asset: gltf_json::Asset {
            version: "2.0".to_string(),
            generator: Some("pko-tools".to_string()),
            ..Default::default()
        },
        nodes: builder.nodes,
        scenes: vec![gltf_json::Scene {
            nodes: vec![gltf_json::Index::new(root_idx)],
            name: Some("BuildingScene".to_string()),
            extensions: None,
            extras: None,
        }],
        scene: Some(gltf_json::Index::new(0)),
        accessors: builder.accessors,
        buffers: vec![final_buffer],
        buffer_views: buffer_views_out,
        meshes: builder.meshes,
        materials: builder.materials,
        images: images_out,
        samplers: builder.samplers,
        textures: builder.textures,
        animations,
        ..Default::default()
    };

    let json = serde_json::to_string(&root)?;
    Ok((json, bin))
}

/// Decode a data URI (e.g., "data:application/octet-stream;base64,...") to bytes.
fn decode_data_uri(uri: &str) -> Option<Vec<u8>> {
    let prefix = "data:";
    if !uri.starts_with(prefix) {
        return None;
    }
    let rest = &uri[prefix.len()..];
    let base64_marker = ";base64,";
    let base64_pos = rest.find(base64_marker)?;
    let encoded = &rest[base64_pos + base64_marker.len()..];
    BASE64_STANDARD.decode(encoded).ok()
}

/// Decode a data URI returning (mime_type, bytes).
fn decode_data_uri_with_mime(uri: &str) -> Option<(String, Vec<u8>)> {
    let prefix = "data:";
    if !uri.starts_with(prefix) {
        return None;
    }
    let rest = &uri[prefix.len()..];
    let base64_marker = ";base64,";
    let base64_pos = rest.find(base64_marker)?;
    let mime = rest[..base64_pos].to_string();
    let encoded = &rest[base64_pos + base64_marker.len()..];
    let data = BASE64_STANDARD.decode(encoded).ok()?;
    Some((mime, data))
}

/// Merge multiple data-URI buffers into a single binary buffer.
/// Returns (merged_bytes, single_buffer, adjusted_buffer_views).
/// All buffer views are re-indexed to reference buffer 0.
fn merge_data_uri_buffers(
    buffers: &[gltf_json::Buffer],
    views: &[gltf_json::buffer::View],
) -> Result<(Vec<u8>, gltf_json::Buffer, Vec<gltf_json::buffer::View>)> {
    // Decode each buffer's data URI to bytes, track offsets
    let mut merged = Vec::new();
    let mut buffer_offsets: Vec<usize> = Vec::new();

    for buf in buffers {
        let data = buf
            .uri
            .as_ref()
            .and_then(|u| decode_data_uri(u))
            .unwrap_or_default();

        // Pad to 4-byte alignment
        let pad = (4 - (merged.len() % 4)) % 4;
        merged.extend(std::iter::repeat(0u8).take(pad));
        buffer_offsets.push(merged.len());
        merged.extend_from_slice(&data);
    }

    // Adjust buffer views to reference single buffer 0 with global offsets
    let mut new_views = Vec::with_capacity(views.len());
    for bv in views {
        let buf_idx = bv.buffer.value() as usize;
        let base_offset = buffer_offsets.get(buf_idx).copied().unwrap_or(0);
        let local_offset = bv.byte_offset.map(|o| o.0 as usize).unwrap_or(0);

        let mut new_bv = bv.clone();
        new_bv.buffer = gltf_json::Index::new(0);
        new_bv.byte_offset = Some(USize64((base_offset + local_offset) as u64));
        new_views.push(new_bv);
    }

    let single_buffer = gltf_json::Buffer {
        byte_length: USize64(merged.len() as u64),
        extensions: None,
        extras: None,
        name: Some("merged_buffer".into()),
        uri: None,
    };

    Ok((merged, single_buffer, new_views))
}

// ============================================================================
// Public API: batch load scene models for map integration
// ============================================================================

/// Loaded scene model data for map integration.
pub struct LoadedSceneModels {
    /// glTF meshes for each unique model.
    pub meshes: Vec<gltf_json::Mesh>,
    /// Materials used by the models.
    pub materials: Vec<gltf_json::Material>,
    /// Accessors for model data.
    pub accessors: Vec<gltf_json::Accessor>,
    /// Buffer views for model data.
    pub buffer_views: Vec<gltf_json::buffer::View>,
    /// Buffers for model data.
    pub buffers: Vec<gltf_json::Buffer>,
    /// Images for model textures.
    pub images: Vec<gltf_json::Image>,
    /// Texture samplers.
    pub samplers: Vec<gltf_json::texture::Sampler>,
    /// Textures referencing images and samplers.
    pub textures: Vec<gltf_json::Texture>,
    /// Maps obj_id → mesh index within this struct's meshes array.
    pub model_mesh_map: HashMap<u32, usize>,
}

/// Load unique scene models referenced by map objects.
///
/// Only loads models for type-0 (building) objects. Skips failures gracefully.
pub fn load_scene_models(
    project_dir: &Path,
    obj_info: &HashMap<u32, SceneObjModelInfo>,
    objects: &[SceneObject],
) -> Result<LoadedSceneModels> {
    // Collect unique obj_ids for type-0 objects
    let mut unique_ids: Vec<u32> = objects
        .iter()
        .filter(|o| o.obj_type == 0)
        .map(|o| o.obj_id as u32)
        .collect();
    unique_ids.sort_unstable();
    unique_ids.dedup();

    let mut builder = GltfBuilder::new();
    let mut model_mesh_map = HashMap::new();

    for obj_id in unique_ids {
        let info = match obj_info.get(&obj_id) {
            Some(i) => i,
            None => continue,
        };

        let lmo_path = match find_lmo_path(project_dir, &info.filename) {
            Some(p) => p,
            None => continue,
        };

        let model = match lmo::load_lmo_no_animation(&lmo_path) {
            Ok(m) => m,
            Err(_) => continue,
        };
        add_model_to_builder(
            &mut builder,
            &mut model_mesh_map,
            obj_id,
            &model,
            project_dir,
        );
    }

    Ok(LoadedSceneModels {
        meshes: builder.meshes,
        materials: builder.materials,
        accessors: builder.accessors,
        buffer_views: builder.buffer_views,
        buffers: builder.buffers,
        images: builder.images,
        samplers: builder.samplers,
        textures: builder.textures,
        model_mesh_map,
    })
}

fn add_model_to_builder(
    builder: &mut GltfBuilder,
    model_mesh_map: &mut HashMap<u32, usize>,
    obj_id: u32,
    model: &LmoModel,
    project_dir: &Path,
) {
    // Merge all geometry objects into a single mesh with multiple primitives
    let mut all_primitives = Vec::new();

    for (gi, geom) in model.geom_objects.iter().enumerate() {
        let prefix = format!("obj{}_{}", obj_id, gi);
        let material_base_idx = builder.materials.len() as u32;

        if geom.materials.is_empty() {
            build_lmo_material(
                builder,
                &lmo::LmoMaterial {
                    diffuse: [0.7, 0.7, 0.7, 1.0],
                    ambient: [0.3, 0.3, 0.3, 1.0],
                    emissive: [0.0, 0.0, 0.0, 0.0],
                    opacity: 1.0,
                    transp_type: 0,
                    alpha_test_enabled: false,
                    alpha_ref: 0,
                    src_blend: None,
                    dest_blend: None,
                    tex_filename: None,
                },
                &format!("{}_mat", prefix),
                project_dir,
                false, // skip textures for map batch loading
            );
        } else {
            for (mi, mat) in geom.materials.iter().enumerate() {
                build_lmo_material(
                    builder,
                    mat,
                    &format!("{}_mat{}", prefix, mi),
                    project_dir,
                    false, // skip textures for map batch loading
                );
            }
        }

        let prims = build_geom_primitives(builder, geom, &prefix, material_base_idx, false);
        all_primitives.extend(prims);
    }

    if all_primitives.is_empty() {
        return;
    }

    let mesh_idx = builder.meshes.len();
    builder.meshes.push(gltf_json::Mesh {
        name: Some(format!("building_{}", obj_id)),
        primitives: all_primitives,
        weights: None,
        extensions: None,
        extras: None,
    });

    model_mesh_map.insert(obj_id, mesh_idx);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a minimal LmoModel with a single triangle for testing glTF export.
    fn make_test_model() -> LmoModel {
        LmoModel {
            version: 0x1005,
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
                vertices: vec![[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]],
                normals: vec![[0.0, 0.0, 1.0], [0.0, 0.0, 1.0], [0.0, 0.0, 1.0]],
                texcoords: vec![[0.0, 0.0], [1.0, 0.0], [0.0, 1.0]],
                vertex_colors: vec![],
                indices: vec![0, 1, 2],
                subsets: vec![lmo::LmoSubset {
                    primitive_num: 1,
                    start_index: 0,
                    vertex_num: 3,
                    min_index: 0,
                }],
                materials: vec![lmo::LmoMaterial {
                    diffuse: [0.8, 0.2, 0.1, 1.0],
                    ambient: [0.3, 0.3, 0.3, 1.0],
                    emissive: [0.0, 0.0, 0.0, 0.0],
                    opacity: 1.0,
                    transp_type: 0,
                    alpha_test_enabled: false,
                    alpha_ref: 0,
                    src_blend: None,
                    dest_blend: None,
                    tex_filename: Some("wall.bmp".to_string()),
                }],
                animation: None,
            }],
        }
    }

    #[test]
    fn coordinate_transform_z_up_to_y_up() {
        // Game: Z-up → glTF: Y-up: (x, y, z) → (x, z, y)
        // Y is NOT negated so building Z matches terrain Z (south = positive).
        assert_eq!(transform_position([1.0, 2.0, 3.0]), [1.0, 3.0, 2.0]);
        assert_eq!(transform_position([0.0, 0.0, 0.0]), [0.0, 0.0, 0.0]);
        assert_eq!(transform_normal([0.0, 0.0, 1.0]), [0.0, 1.0, 0.0]);
    }

    #[test]
    fn reverse_winding_swaps_triangle_indices() {
        let indices = vec![0, 1, 2, 3, 4, 5];
        let reversed = reverse_winding(&indices);
        assert_eq!(reversed, vec![0, 2, 1, 3, 5, 4]);
    }

    #[test]
    fn identity_matrix_detection() {
        let id = [
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
        ];
        assert!(is_identity(&id));

        let mut non_id = id;
        non_id[3][0] = 5.0; // translation
        assert!(!is_identity(&non_id));
    }

    #[test]
    fn matrix_transform_identity_is_noop() {
        let id = [
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
        ];
        let p = [3.0, 4.0, 5.0];
        let result = transform_by_matrix(p, &id);
        for i in 0..3 {
            assert!((result[i] - p[i]).abs() < 1e-6);
        }
    }

    #[test]
    fn matrix_transform_translation() {
        let mat = [
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [10.0, 20.0, 30.0, 1.0],
        ];
        let p = [1.0, 2.0, 3.0];
        let result = transform_by_matrix(p, &mat);
        assert!((result[0] - 11.0).abs() < 1e-6);
        assert!((result[1] - 22.0).abs() < 1e-6);
        assert!((result[2] - 33.0).abs() < 1e-6);
    }

    #[test]
    fn build_material_opaque() {
        let mat = lmo::LmoMaterial {
            diffuse: [0.5, 0.6, 0.7, 1.0],
            ambient: [0.1, 0.1, 0.1, 1.0],
            emissive: [0.0, 0.0, 0.0, 0.0],
            opacity: 1.0,
            transp_type: 0,
            alpha_test_enabled: false,
            alpha_ref: 0,
            src_blend: None,
            dest_blend: None,
            tex_filename: None,
        };
        let mut builder = GltfBuilder::new();
        let tmp = std::env::temp_dir();
        build_lmo_material(&mut builder, &mat, "test", &tmp, false);
        let gltf_mat = &builder.materials[0];
        assert_eq!(
            gltf_mat.alpha_mode,
            Checked::Valid(gltf_json::material::AlphaMode::Opaque)
        );
        let bc = gltf_mat.pbr_metallic_roughness.base_color_factor.0;
        assert!((bc[0] - 0.5).abs() < 0.01);
        assert!((bc[3] - 1.0).abs() < 0.01);
    }

    #[test]
    fn build_material_transparent() {
        let mat = lmo::LmoMaterial {
            diffuse: [0.5, 0.6, 0.7, 1.0],
            ambient: [0.1, 0.1, 0.1, 1.0],
            emissive: [0.0, 0.0, 0.0, 0.0],
            opacity: 0.5,
            transp_type: 0,
            alpha_test_enabled: false,
            alpha_ref: 0,
            src_blend: None,
            dest_blend: None,
            tex_filename: None,
        };
        let mut builder = GltfBuilder::new();
        let tmp = std::env::temp_dir();
        build_lmo_material(&mut builder, &mat, "test", &tmp, false);
        let gltf_mat = &builder.materials[0];
        assert_eq!(
            gltf_mat.alpha_mode,
            Checked::Valid(gltf_json::material::AlphaMode::Blend)
        );
        let bc = gltf_mat.pbr_metallic_roughness.base_color_factor.0;
        assert!((bc[3] - 0.5).abs() < 0.01);
    }

    #[test]
    fn build_material_alpha_mask_from_alpha_test() {
        let mat = lmo::LmoMaterial {
            diffuse: [0.5, 0.6, 0.7, 1.0],
            ambient: [0.1, 0.1, 0.1, 1.0],
            emissive: [0.0, 0.0, 0.0, 0.0],
            opacity: 1.0,
            transp_type: 0,
            alpha_test_enabled: true,
            alpha_ref: 129,
            src_blend: None,
            dest_blend: None,
            tex_filename: None,
        };
        let mut builder = GltfBuilder::new();
        let tmp = std::env::temp_dir();
        build_lmo_material(&mut builder, &mat, "test", &tmp, false);
        let gltf_mat = &builder.materials[0];

        assert_eq!(
            gltf_mat.alpha_mode,
            Checked::Valid(gltf_json::material::AlphaMode::Mask)
        );

        let cutoff = gltf_mat
            .alpha_cutoff
            .expect("alpha cutoff should be set for alpha-test materials")
            .0;
        assert!((cutoff - (129.0 / 255.0)).abs() < 1e-6);
    }

    #[test]
    fn build_material_type9_remapped_to_type1() {
        // Unknown transp_type > 8 should be remapped to type 1 (additive)
        let mat = lmo::LmoMaterial {
            diffuse: [1.0, 1.0, 1.0, 1.0],
            ambient: [0.1, 0.1, 0.1, 1.0],
            emissive: [0.0, 0.0, 0.0, 0.0],
            opacity: 1.0,
            transp_type: 9,
            alpha_test_enabled: false,
            alpha_ref: 0,
            src_blend: None,
            dest_blend: None,
            tex_filename: None,
        };
        let mut builder = GltfBuilder::new();
        let tmp = std::env::temp_dir();
        build_lmo_material(&mut builder, &mat, "test_type9", &tmp, false);
        let gltf_mat = &builder.materials[0];
        // Type 9 → remapped to 1 → is_effect=true → Opaque alpha mode (no alpha test)
        assert_eq!(
            gltf_mat.alpha_mode,
            Checked::Valid(gltf_json::material::AlphaMode::Opaque)
        );
        // Name should have T1 (remapped), not T9
        assert!(
            gltf_mat.name.as_ref().unwrap().contains("__PKO_T1_"),
            "type 9 should be remapped to T1 in suffix"
        );
    }

    #[test]
    fn build_material_alpha_ref_zero_gets_engine_default_129() {
        // Materials with alpha_test_enabled=true but alpha_ref=0 should use
        // the engine's default ALPHAREF=129, not encode A0 (which Unity reads as "no alpha test")
        let mat = lmo::LmoMaterial {
            diffuse: [0.5, 0.6, 0.7, 1.0],
            ambient: [0.1, 0.1, 0.1, 1.0],
            emissive: [0.0, 0.0, 0.0, 0.0],
            opacity: 1.0,
            transp_type: 0,
            alpha_test_enabled: true,
            alpha_ref: 0, // Engine overrides to 129 at runtime
            src_blend: None,
            dest_blend: None,
            tex_filename: None,
        };
        let mut builder = GltfBuilder::new();
        let tmp = std::env::temp_dir();
        build_lmo_material(&mut builder, &mat, "tree_leaf", &tmp, false);
        let gltf_mat = &builder.materials[0];

        // Should be Mask (alpha test enabled)
        assert_eq!(
            gltf_mat.alpha_mode,
            Checked::Valid(gltf_json::material::AlphaMode::Mask)
        );

        // Suffix should have A129 (engine default), not A0
        let name = gltf_mat.name.as_ref().unwrap();
        assert!(
            name.contains("_A129_"),
            "alpha_ref=0 with alpha_test should encode as A129 (engine default), got: {}",
            name
        );

        // Cutoff should be 129/255 ≈ 0.506
        let cutoff = gltf_mat.alpha_cutoff.as_ref().unwrap().0;
        assert!(
            (cutoff - 129.0 / 255.0).abs() < 1e-6,
            "cutoff should be 129/255, got: {}",
            cutoff
        );
    }

    #[test]
    fn build_gltf_from_synthetic_model() {
        let model = make_test_model();

        // Write temporary LMO file
        // Instead of going through file I/O, test the internal builder directly
        let mut builder = GltfBuilder::new();

        let tmp = std::env::temp_dir();
        let geom = &model.geom_objects[0];
        let mat_base = builder.materials.len() as u32;
        for (mi, mat) in geom.materials.iter().enumerate() {
            build_lmo_material(&mut builder, mat, &format!("mat{}", mi), &tmp, false);
        }

        let prims = build_geom_primitives(&mut builder, geom, "test", mat_base, false);
        assert_eq!(prims.len(), 1, "should have 1 primitive for 1 subset");

        // Verify accessor was created for positions
        assert!(!builder.accessors.is_empty());
        assert!(!builder.buffers.is_empty());
        assert!(!builder.buffer_views.is_empty());

        // Check position accessor count = 3 vertices
        let pos_acc = &builder.accessors[0];
        assert_eq!(pos_acc.count.0, 3);

        // Primitive should reference the material
        assert_eq!(prims[0].material.unwrap().value(), 0);
    }

    #[test]
    fn build_gltf_json_from_synthetic_model_is_valid() {
        let model = make_test_model();

        // Write model to a temp file and use build_gltf_from_lmo
        let tmp_dir = std::env::temp_dir().join("pko_tools_test_lmo");
        let _ = std::fs::create_dir_all(&tmp_dir);
        let lmo_path = tmp_dir.join("test.lmo");

        // Build actual LMO binary using the test helpers from lmo::tests
        // Since we can't easily call the private test helpers, write the binary manually
        let mut data = Vec::new();
        // version
        data.extend_from_slice(&0x1005u32.to_le_bytes());
        // obj_num = 1
        data.extend_from_slice(&1u32.to_le_bytes());

        // We'll build the geom blob, then write the header entry pointing to it
        let geom_blob = build_test_geom_blob(&model.geom_objects[0]);
        let header_size = 4 + 4 + 12;
        // header entry
        data.extend_from_slice(&1u32.to_le_bytes()); // type = GEOMETRY
        data.extend_from_slice(&(header_size as u32).to_le_bytes()); // addr
        data.extend_from_slice(&(geom_blob.len() as u32).to_le_bytes()); // size
        data.extend_from_slice(&geom_blob);

        std::fs::write(&lmo_path, &data).unwrap();

        let json = build_gltf_from_lmo(&lmo_path, &tmp_dir).unwrap();

        // Verify glTF JSON structure
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["asset"]["version"], "2.0");
        assert!(parsed["meshes"].as_array().unwrap().len() >= 1);
        assert!(parsed["materials"].as_array().unwrap().len() >= 1);
        assert!(parsed["nodes"].as_array().unwrap().len() >= 2); // geom node + root
        assert!(parsed["accessors"].as_array().unwrap().len() >= 2); // pos + idx at minimum
        assert!(parsed["buffers"].as_array().unwrap().len() >= 2);

        // Verify all buffer URIs are data URIs
        for buf in parsed["buffers"].as_array().unwrap() {
            let uri = buf["uri"].as_str().unwrap();
            assert!(
                uri.starts_with("data:application/octet-stream;base64,"),
                "buffer URI should be a data URI"
            );
        }

        // Cleanup
        let _ = std::fs::remove_dir_all(&tmp_dir);
    }

    #[test]
    fn build_gltf_empty_model_errors() {
        let tmp_dir = std::env::temp_dir().join("pko_tools_test_lmo_empty");
        let _ = std::fs::create_dir_all(&tmp_dir);
        let lmo_path = tmp_dir.join("empty.lmo");

        let mut data = Vec::new();
        data.extend_from_slice(&0x1005u32.to_le_bytes());
        data.extend_from_slice(&0u32.to_le_bytes());
        std::fs::write(&lmo_path, &data).unwrap();

        let result = build_gltf_from_lmo(&lmo_path, &tmp_dir);
        assert!(result.is_err(), "empty model should error");

        let _ = std::fs::remove_dir_all(&tmp_dir);
    }

    #[test]
    fn load_scene_models_unknown_ids_skipped() {
        let obj_info = HashMap::new(); // empty — no known models
        let objects = vec![SceneObject {
            raw_type_id: 0,
            obj_type: 0,
            obj_id: 999,
            world_x: 0.0,
            world_y: 0.0,
            world_z: 0.0,
            yaw_angle: 0,
            scale: 100,
        }];

        let tmp_dir = std::env::temp_dir().join("pko_tools_test_scene");
        let _ = std::fs::create_dir_all(&tmp_dir);

        let result = load_scene_models(&tmp_dir, &obj_info, &objects).unwrap();
        assert!(result.meshes.is_empty());
        assert!(result.model_mesh_map.is_empty());

        let _ = std::fs::remove_dir_all(&tmp_dir);
    }

    #[test]
    fn load_scene_models_effects_ignored() {
        let mut obj_info = HashMap::new();
        obj_info.insert(
            1,
            SceneObjModelInfo {
                id: 1,
                filename: "test.lmo".to_string(),
            },
        );
        // Object is type 1 (effect) — should be skipped
        let objects = vec![SceneObject {
            raw_type_id: 0,
            obj_type: 1, // effect, not model
            obj_id: 1,
            world_x: 0.0,
            world_y: 0.0,
            world_z: 0.0,
            yaw_angle: 0,
            scale: 100,
        }];

        let tmp_dir = std::env::temp_dir().join("pko_tools_test_scene2");
        let _ = std::fs::create_dir_all(&tmp_dir);

        let result = load_scene_models(&tmp_dir, &obj_info, &objects).unwrap();
        assert!(
            result.model_mesh_map.is_empty(),
            "effects should be skipped"
        );

        let _ = std::fs::remove_dir_all(&tmp_dir);
    }

    /// Build an LMO geom blob from an LmoGeomObject (for test file writing).
    fn build_test_geom_blob(geom: &LmoGeomObject) -> Vec<u8> {
        let mut buf = Vec::new();
        let push_u32 = |buf: &mut Vec<u8>, v: u32| buf.extend_from_slice(&v.to_le_bytes());
        let push_f32 = |buf: &mut Vec<u8>, v: f32| buf.extend_from_slice(&v.to_le_bytes());
        let push_zeros = |buf: &mut Vec<u8>, n: usize| buf.extend(std::iter::repeat(0u8).take(n));

        // FVF constants (same as lmo.rs)
        const FVF_NORMAL: u32 = 0x010;
        const FVF_DIFFUSE: u32 = 0x040;
        const FVF_TEXCOUNT_SHIFT: u32 = 8;
        const MESH_RS_NUM: usize = 8;

        let has_normals = !geom.normals.is_empty();
        let has_texcoords = !geom.texcoords.is_empty();
        let has_colors = !geom.vertex_colors.is_empty();
        let tex_count: u32 = if has_texcoords { 1 } else { 0 };

        let fvf = 0x002u32
            | if has_normals { FVF_NORMAL } else { 0 }
            | if has_colors { FVF_DIFFUSE } else { 0 }
            | (tex_count << FVF_TEXCOUNT_SHIFT);

        // Pre-compute sizes for the header
        let mat_entry_size = 4 + 4 + 68 + 8 * 12 + 4 * (11 * 4 + 64 + 4 + 8 * 12);
        let mtl_size = if !geom.materials.is_empty() {
            4 + geom.materials.len() * mat_entry_size
        } else {
            0
        };

        let mesh_header_size = 32 + MESH_RS_NUM * 12;
        let vn = geom.vertices.len();
        let in_ = geom.indices.len();
        let sn = geom.subsets.len();
        let mesh_data_size = vn * 12
            + if has_normals { vn * 12 } else { 0 }
            + tex_count as usize * vn * 8
            + if has_colors { vn * 4 } else { 0 }
            + in_ * 4
            + sn * 16;
        let mesh_size = mesh_header_size + mesh_data_size;

        // Geom header (116 bytes)
        push_u32(&mut buf, geom.id);
        push_u32(&mut buf, geom.parent_id);
        push_u32(&mut buf, geom.obj_type);
        for row in &geom.mat_local {
            for &v in row {
                push_f32(&mut buf, v);
            }
        }
        push_zeros(&mut buf, 16); // rcci
        push_zeros(&mut buf, 8); // state_ctrl
        push_u32(&mut buf, mtl_size as u32);
        push_u32(&mut buf, mesh_size as u32);
        push_u32(&mut buf, 0); // helper_size
        push_u32(&mut buf, 0); // anim_size

        // Materials
        if !geom.materials.is_empty() {
            push_u32(&mut buf, geom.materials.len() as u32);
            for mat in &geom.materials {
                push_f32(&mut buf, mat.opacity);
                push_u32(&mut buf, 0); // transp_type
                for &c in &mat.diffuse {
                    push_f32(&mut buf, c);
                }
                for &c in &mat.ambient {
                    push_f32(&mut buf, c);
                }
                push_zeros(&mut buf, 16); // specular
                push_zeros(&mut buf, 16); // emissive
                push_f32(&mut buf, 0.0); // power
                push_zeros(&mut buf, 8 * 12); // rs_set
                                              // tex_seq[4]
                for ti in 0..4 {
                    push_zeros(&mut buf, 11 * 4); // stage..colorkey
                    let mut fname = [0u8; 64];
                    if ti == 0 {
                        if let Some(ref name) = mat.tex_filename {
                            let bytes = name.as_bytes();
                            let len = bytes.len().min(63);
                            fname[..len].copy_from_slice(&bytes[..len]);
                        }
                    }
                    buf.extend_from_slice(&fname);
                    push_u32(&mut buf, 0); // data
                    push_zeros(&mut buf, 8 * 12); // tss_set
                }
            }
        }

        // Mesh
        push_u32(&mut buf, fvf);
        push_u32(&mut buf, 4); // TRIANGLELIST
        push_u32(&mut buf, vn as u32);
        push_u32(&mut buf, in_ as u32);
        push_u32(&mut buf, sn as u32);
        push_u32(&mut buf, 0); // bone_index_num
        push_u32(&mut buf, 0); // bone_infl_factor
        push_u32(&mut buf, 0); // vertex_element_num
        push_zeros(&mut buf, MESH_RS_NUM * 12);

        for v in &geom.vertices {
            for &c in v {
                push_f32(&mut buf, c);
            }
        }
        if has_normals {
            for n in &geom.normals {
                for &c in n {
                    push_f32(&mut buf, c);
                }
            }
        }
        if has_texcoords {
            for t in &geom.texcoords {
                for &c in t {
                    push_f32(&mut buf, c);
                }
            }
        }
        if has_colors {
            for &c in &geom.vertex_colors {
                push_u32(&mut buf, c);
            }
        }
        for &idx in &geom.indices {
            push_u32(&mut buf, idx);
        }
        for s in &geom.subsets {
            push_u32(&mut buf, s.primitive_num);
            push_u32(&mut buf, s.start_index);
            push_u32(&mut buf, s.vertex_num);
            push_u32(&mut buf, s.min_index);
        }

        buf
    }

    // ====================================================================
    // Real-data test (skipped if top-client not present)
    // ====================================================================

    #[test]
    fn build_gltf_from_real_lmo() {
        let scene_dir = std::path::Path::new("../top-client/model/scene");
        let model_dir = std::path::Path::new("../top-client/model");
        let search_dir = if scene_dir.exists() {
            scene_dir
        } else if model_dir.exists() {
            model_dir
        } else {
            return;
        };

        let lmo_file = std::fs::read_dir(search_dir)
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
        let json = build_gltf_from_lmo(&lmo_path, project_dir).unwrap();
        assert!(json.contains("\"asset\""));
        assert!(json.contains("building_root"));

        // Verify it parses as valid JSON and has expected structure
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(parsed["meshes"].as_array().unwrap().len() >= 1);
        assert!(parsed["nodes"].as_array().unwrap().len() >= 2);
    }

    #[test]
    fn load_dds_texture_as_data_uri() {
        // Test that DDS textures (common in scene models) can be loaded and converted
        let project_dir = std::path::Path::new("../top-client");
        if !project_dir.exists() {
            return;
        }

        // Find a .dds file in texture/scene/
        let tex_dir = project_dir.join("texture").join("scene");
        if !tex_dir.exists() {
            return;
        }

        let dds_file = std::fs::read_dir(&tex_dir)
            .ok()
            .and_then(|mut dir| {
                dir.find(|e| {
                    e.as_ref()
                        .ok()
                        .map(|e| {
                            e.path()
                                .extension()
                                .map(|ext| ext.to_ascii_lowercase() == "dds")
                                .unwrap_or(false)
                        })
                        .unwrap_or(false)
                })
            })
            .and_then(|e| e.ok())
            .map(|e| e.path());

        let dds_path = match dds_file {
            Some(p) => p,
            None => return,
        };

        let result = load_texture_as_data_uri(&dds_path);
        assert!(
            result.is_some(),
            "DDS texture should load successfully: {}",
            dds_path.display()
        );
        let uri = result.unwrap();
        assert!(uri.starts_with("data:image/png;base64,"));
    }

    #[test]
    fn build_gltf_from_version0_lmo_with_textures() {
        // Test building glTF from a version-0 LMO file that has textures
        let project_dir = std::path::Path::new("../top-client");
        if !project_dir.exists() {
            return;
        }

        // by-bd014-1 is a known version-0 file with MTLTEX_VERSION0000
        let lmo_path = project_dir
            .join("model")
            .join("scene")
            .join("by-bd014-1.lmo");
        if !lmo_path.exists() {
            return;
        }

        let json = build_gltf_from_lmo(&lmo_path, project_dir).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        // Should have at least one mesh
        assert!(parsed["meshes"].as_array().unwrap().len() >= 1);

        // Check if textures are present (they should be if DDS loading works)
        let images = parsed["images"].as_array();
        if let Some(imgs) = images {
            eprintln!("Version-0 LMO generated {} texture images", imgs.len());
            assert!(!imgs.is_empty(), "version-0 LMO should have texture images");
        }
    }

    // ================================================================
    // Phase 3: Structured suffix + blend mode tests
    // ================================================================

    #[test]
    fn default_blend_for_all_transp_types() {
        // Type 0 (FILTER): no blend set
        assert_eq!(default_src_blend_for_transp_type(0), None);
        assert_eq!(default_dst_blend_for_transp_type(0), None);

        // Type 1 (ADDITIVE): One/One
        assert_eq!(default_src_blend_for_transp_type(1), Some(D3DBLEND_ONE));
        assert_eq!(default_dst_blend_for_transp_type(1), Some(D3DBLEND_ONE));

        // Type 2 (ADDITIVE1): SrcColor/One
        assert_eq!(default_src_blend_for_transp_type(2), Some(D3DBLEND_SRCCOLOR));
        assert_eq!(default_dst_blend_for_transp_type(2), Some(D3DBLEND_ONE));

        // Type 3 (ADDITIVE2): SrcColor/InvSrcColor
        assert_eq!(default_src_blend_for_transp_type(3), Some(D3DBLEND_SRCCOLOR));
        assert_eq!(
            default_dst_blend_for_transp_type(3),
            Some(D3DBLEND_INVSRCCOLOR)
        );

        // Type 4 (ADDITIVE3): SrcAlpha/DestAlpha
        assert_eq!(default_src_blend_for_transp_type(4), Some(D3DBLEND_SRCALPHA));
        assert_eq!(
            default_dst_blend_for_transp_type(4),
            Some(D3DBLEND_DESTALPHA)
        );

        // Type 5 (SUBTRACTIVE): Zero/InvSrcColor
        assert_eq!(default_src_blend_for_transp_type(5), Some(D3DBLEND_ZERO));
        assert_eq!(
            default_dst_blend_for_transp_type(5),
            Some(D3DBLEND_INVSRCCOLOR)
        );

        // Types 6-8: fall through to One/One (same as type 1)
        for t in 6..=8 {
            assert_eq!(
                default_src_blend_for_transp_type(t),
                Some(D3DBLEND_ONE),
                "type {} src",
                t
            );
            assert_eq!(
                default_dst_blend_for_transp_type(t),
                Some(D3DBLEND_ONE),
                "type {} dst",
                t
            );
        }
    }

    #[test]
    fn types_6_through_8_canonicalize_to_type_1() {
        let tmp = std::env::temp_dir();
        for transp_type in [6, 7, 8] {
            let mat = lmo::LmoMaterial {
                diffuse: [0.5, 0.6, 0.7, 1.0],
                ambient: [0.1, 0.1, 0.1, 1.0],
                emissive: [0.0, 0.0, 0.0, 0.0],
                opacity: 1.0,
                transp_type,
                alpha_test_enabled: false,
                alpha_ref: 0,
                src_blend: None,
                dest_blend: None,
                tex_filename: None,
            };
            let mut builder = GltfBuilder::new();
            build_lmo_material(&mut builder, &mat, "test", &tmp, false);
            let gltf_mat = &builder.materials[0];
            // Name should contain T1, not T6/T7/T8
            assert!(
                gltf_mat
                    .name
                    .as_ref()
                    .unwrap()
                    .contains("__PKO_T1_A0_O255"),
                "type {} should canonicalize to T1 in name, got: {}",
                transp_type,
                gltf_mat.name.as_ref().unwrap()
            );
        }
    }

    #[test]
    fn build_material_type3_produces_correct_suffix() {
        let mat = lmo::LmoMaterial {
            diffuse: [0.5, 0.6, 0.7, 1.0],
            ambient: [0.1, 0.1, 0.1, 1.0],
            emissive: [0.0, 0.0, 0.0, 0.0],
            opacity: 0.75,
            transp_type: 3,
            alpha_test_enabled: false,
            alpha_ref: 0,
            src_blend: None,
            dest_blend: None,
            tex_filename: None,
        };
        let mut builder = GltfBuilder::new();
        let tmp = std::env::temp_dir();
        build_lmo_material(&mut builder, &mat, "glow", &tmp, false);
        let gltf_mat = &builder.materials[0];
        let name = gltf_mat.name.as_ref().unwrap();
        // opacity 0.75 * 255 = 191.25 → 191
        assert!(
            name.contains("__PKO_T3_A0_O191"),
            "expected T3_A0_O191 suffix, got: {}",
            name
        );
    }

    #[test]
    fn build_material_additive_with_alpha_test_uses_mask() {
        // Previously forced to Opaque when additive — now should be Mask
        let mat = lmo::LmoMaterial {
            diffuse: [0.5, 0.6, 0.7, 1.0],
            ambient: [0.1, 0.1, 0.1, 1.0],
            emissive: [0.0, 0.0, 0.0, 0.0],
            opacity: 1.0,
            transp_type: 1,
            alpha_test_enabled: true,
            alpha_ref: 129,
            src_blend: None,
            dest_blend: None,
            tex_filename: None,
        };
        let mut builder = GltfBuilder::new();
        let tmp = std::env::temp_dir();
        build_lmo_material(&mut builder, &mat, "sparkle", &tmp, false);
        let gltf_mat = &builder.materials[0];

        assert_eq!(
            gltf_mat.alpha_mode,
            Checked::Valid(gltf_json::material::AlphaMode::Mask),
            "additive + alpha test should produce Mask alpha mode"
        );

        let cutoff = gltf_mat
            .alpha_cutoff
            .expect("alpha cutoff should be set")
            .0;
        assert!((cutoff - (129.0 / 255.0)).abs() < 1e-6);

        let name = gltf_mat.name.as_ref().unwrap();
        assert!(
            name.contains("__PKO_T1_A129_O255"),
            "expected T1_A129_O255, got: {}",
            name
        );
    }

    #[test]
    fn build_material_type0_no_suffix_when_no_alpha_test() {
        // Type 0 with no alpha test and full opacity → no suffix
        let mat = lmo::LmoMaterial {
            diffuse: [0.5, 0.6, 0.7, 1.0],
            ambient: [0.1, 0.1, 0.1, 1.0],
            emissive: [0.0, 0.0, 0.0, 0.0],
            opacity: 1.0,
            transp_type: 0,
            alpha_test_enabled: false,
            alpha_ref: 0,
            src_blend: None,
            dest_blend: None,
            tex_filename: None,
        };
        let mut builder = GltfBuilder::new();
        let tmp = std::env::temp_dir();
        build_lmo_material(&mut builder, &mat, "wall", &tmp, false);
        let gltf_mat = &builder.materials[0];
        let name = gltf_mat.name.as_ref().unwrap();
        assert!(
            !name.contains("__PKO_"),
            "type 0 opaque should have no PKO suffix, got: {}",
            name
        );
    }

    #[test]
    fn build_material_type0_with_alpha_test_gets_suffix() {
        // Type 0 with alpha test → should get suffix for cutout routing
        let mat = lmo::LmoMaterial {
            diffuse: [0.5, 0.6, 0.7, 1.0],
            ambient: [0.1, 0.1, 0.1, 1.0],
            emissive: [0.0, 0.0, 0.0, 0.0],
            opacity: 1.0,
            transp_type: 0,
            alpha_test_enabled: true,
            alpha_ref: 129,
            src_blend: None,
            dest_blend: None,
            tex_filename: None,
        };
        let mut builder = GltfBuilder::new();
        let tmp = std::env::temp_dir();
        build_lmo_material(&mut builder, &mat, "tree", &tmp, false);
        let gltf_mat = &builder.materials[0];
        let name = gltf_mat.name.as_ref().unwrap();
        assert!(
            name.contains("__PKO_T0_A129_O255"),
            "type 0 with alpha test should have suffix, got: {}",
            name
        );
    }

    #[test]
    fn build_material_subtractive_type5() {
        let mat = lmo::LmoMaterial {
            diffuse: [0.3, 0.3, 0.3, 1.0],
            ambient: [0.1, 0.1, 0.1, 1.0],
            emissive: [0.0, 0.0, 0.0, 0.0],
            opacity: 1.0,
            transp_type: 5,
            alpha_test_enabled: false,
            alpha_ref: 0,
            src_blend: None,
            dest_blend: None,
            tex_filename: None,
        };
        let mut builder = GltfBuilder::new();
        let tmp = std::env::temp_dir();
        build_lmo_material(&mut builder, &mat, "shadow", &tmp, false);
        let gltf_mat = &builder.materials[0];
        let name = gltf_mat.name.as_ref().unwrap();
        assert!(
            name.contains("__PKO_T5_A0_O255"),
            "type 5 should have T5 suffix, got: {}",
            name
        );
        // Subtractive is effect → Opaque alpha mode (shader handles blend)
        assert_eq!(
            gltf_mat.alpha_mode,
            Checked::Valid(gltf_json::material::AlphaMode::Opaque)
        );
    }
}
