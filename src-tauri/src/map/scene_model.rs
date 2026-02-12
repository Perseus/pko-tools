//! LMO → glTF conversion for scene building models.
//!
//! Three entry points:
//! - `build_gltf_from_lmo` — standalone building viewer (single LMO → complete glTF)
//! - `build_gltf_from_lmo_roundtrip` — export for editing (preserves PKO extras for re-import)
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
use serde::{Deserialize, Serialize};
use serde_json::value::RawValue;

use crate::item::model::decode_pko_texture;

use super::lmo::{self, LmoGeomObject, LmoModel, LmoTexInfo, RenderStateAtom};
use super::scene_obj::SceneObject;
use super::scene_obj_info::SceneObjModelInfo;

// ============================================================================
// PKO extras structs — stored in glTF node/mesh extras for round-trip
// ============================================================================

/// Node-level extras: per-geometry-object header fields.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PkoLmoExtras {
    /// Marker to identify this as an LMO building node.
    pub pko_lmo_geom: bool,
    pub geom_id: u32,
    pub parent_id: u32,
    pub obj_type: u32,
    /// mat_local stored as flat 16-element array (row-major 4×4).
    pub mat_local: [f32; 16],
    /// lwRenderCtrlCreateInfo — 16 bytes, base64-encoded.
    pub rcci: String,
    /// lwStateCtrl — 8 bytes, base64-encoded.
    pub state_ctrl: String,
    pub fvf: u32,
    pub pt_type: u32,
    #[serde(default)]
    pub bone_infl_factor: u32,
    #[serde(default)]
    pub vertex_element_num: u32,
    /// Raw vertex elements blob, base64-encoded.
    #[serde(default)]
    pub vertex_elements_blob: String,
    /// Mesh render state set: 8 atoms.
    pub mesh_rs_set: Vec<RenderStateAtom>,
    /// Helper section as raw bytes, base64-encoded.
    pub helper_blob: String,
    /// Animation section as raw bytes (normalized to v0x1005), base64-encoded.
    pub raw_anim_blob: String,
    /// Vertex colors (D3DCOLOR u32 array), if present.
    #[serde(default)]
    pub vertex_colors: Vec<u32>,
    /// Subset definitions for this geometry object.
    #[serde(default)]
    pub subsets: Vec<PkoLmoSubsetExtras>,
}

/// Subset info stored in extras for exact round-trip of subset boundaries.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PkoLmoSubsetExtras {
    pub primitive_num: u32,
    pub start_index: u32,
    pub vertex_num: u32,
    pub min_index: u32,
}

/// Mesh-level extras: per-material data for all materials in the geometry object.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PkoLmoMaterialExtras {
    pub pko_lmo_materials: Vec<PkoLmoMaterialInfo>,
}

/// Per-material properties stored in glTF extras.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PkoLmoMaterialInfo {
    pub opacity: f32,
    pub transp_type: u32,
    pub diffuse: [f32; 4],
    pub ambient: [f32; 4],
    pub specular: [f32; 4],
    pub emissive: [f32; 4],
    pub power: f32,
    pub rs_set: Vec<RenderStateAtom>,
    pub tex_infos: Vec<PkoLmoTexStageInfo>,
}

/// Per-texture-stage metadata stored in glTF extras.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PkoLmoTexStageInfo {
    pub stage: u32,
    pub level: u32,
    pub usage: u32,
    pub d3d_format: u32,
    pub d3d_pool: u32,
    pub byte_alignment_flag: u32,
    pub tex_type: u32,
    pub width: u32,
    pub height: u32,
    pub colorkey_type: u32,
    pub colorkey: u32,
    pub filename: String,
    pub data: u32,
    pub tss_set: Vec<RenderStateAtom>,
}

impl From<&LmoTexInfo> for PkoLmoTexStageInfo {
    fn from(t: &LmoTexInfo) -> Self {
        Self {
            stage: t.stage,
            level: t.level,
            usage: t.usage,
            d3d_format: t.d3d_format,
            d3d_pool: t.d3d_pool,
            byte_alignment_flag: t.byte_alignment_flag,
            tex_type: t.tex_type,
            width: t.width,
            height: t.height,
            colorkey_type: t.colorkey_type,
            colorkey: t.colorkey,
            filename: t.filename.clone(),
            data: t.data,
            tss_set: t.tss_set.clone(),
        }
    }
}

/// Flatten a 4×4 row-major matrix to a 16-element array.
fn mat44_to_flat(m: &[[f32; 4]; 4]) -> [f32; 16] {
    [
        m[0][0], m[0][1], m[0][2], m[0][3],
        m[1][0], m[1][1], m[1][2], m[1][3],
        m[2][0], m[2][1], m[2][2], m[2][3],
        m[3][0], m[3][1], m[3][2], m[3][3],
    ]
}

/// Unflatten a 16-element array to a 4×4 row-major matrix.
pub fn flat_to_mat44(f: &[f32; 16]) -> [[f32; 4]; 4] {
    [
        [f[0], f[1], f[2], f[3]],
        [f[4], f[5], f[6], f[7]],
        [f[8], f[9], f[10], f[11]],
        [f[12], f[13], f[14], f[15]],
    ]
}

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
        project_dir
            .join("model")
            .join(filename.to_lowercase()),
    ];
    candidates.into_iter().find(|p| p.exists())
}

// ============================================================================
// Coordinate transform: Game Z-up → glTF Y-up
// (x, y, z) → (x, z, -y)
// ============================================================================

fn transform_position(p: [f32; 3]) -> [f32; 3] {
    [p[0], p[2], -p[1]]
}

fn transform_normal(n: [f32; 3]) -> [f32; 3] {
    [n[0], n[2], -n[1]]
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

    let dirs = ["texture/scene", "texture/model", "texture/item", "texture/character", "texture"];
    let exts = ["bmp", "tga", "dds", "png"];

    for dir in &dirs {
        for ext in &exts {
            let candidate = project_dir.join(dir).join(format!("{}.{}", stem, ext));
            if candidate.exists() {
                return Some(candidate);
            }
            // Try lowercase
            let candidate_lc = project_dir.join(dir).join(format!("{}.{}", stem.to_lowercase(), ext));
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
            eprintln!("Warning: failed to decode texture {}: {}", path.display(), e);
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

fn build_lmo_material(
    builder: &mut GltfBuilder,
    mat: &lmo::LmoMaterial,
    name: &str,
    project_dir: &Path,
    load_textures: bool,
) {
    let base_color = [
        mat.diffuse[0].clamp(0.0, 1.0),
        mat.diffuse[1].clamp(0.0, 1.0),
        mat.diffuse[2].clamp(0.0, 1.0),
        mat.opacity.clamp(0.0, 1.0),
    ];

    let alpha_mode = if mat.opacity < 0.99 {
        Checked::Valid(gltf_json::material::AlphaMode::Blend)
    } else {
        Checked::Valid(gltf_json::material::AlphaMode::Opaque)
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

    builder.materials.push(gltf_json::Material {
        alpha_cutoff: None,
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
        emissive_factor: gltf_json::material::EmissiveFactor([0.0, 0.0, 0.0]),
        extensions: None,
        extras: None,
        name: Some(name.to_string()),
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
        let uv_data: Vec<f32> = geom.texcoords.iter().flat_map(|t| t.iter().copied()).collect();
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

    // Build primitives per subset (each subset maps to a material)
    if geom.subsets.is_empty() {
        // No subsets — single primitive with all indices
        let idx_acc = builder.add_index_accessor(&geom.indices, &format!("{}_idx", prefix));

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

            let sub_indices: Vec<u32> = geom.indices[start..end].to_vec();
            let idx_acc = builder.add_index_accessor(
                &sub_indices,
                &format!("{}_idx_s{}", prefix, si),
            );

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
        let translations: Vec<f32> = anim.translations.iter()
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
        let rotations: Vec<f32> = anim.rotations.iter()
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
                &lmo::LmoMaterial::new_simple(
                    [0.7, 0.7, 0.7, 1.0],
                    [0.3, 0.3, 0.3, 1.0],
                    1.0,
                    None,
                ),
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
            &mut builder, geom, &prefix, material_base_idx, has_animation,
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

// ============================================================================
// PKO Z-up mat_local → glTF Y-up node matrix conversion
// ============================================================================

/// Convert a PKO Z-up 4×4 matrix to glTF Y-up column-major matrix for node transform.
///
/// PKO mat_local is row-major in Z-up space. glTF node matrix is column-major in Y-up.
/// We apply the coordinate change: (x,y,z) → (x,z,-y) to the rotation/scale and translation.
fn mat_local_to_gltf_matrix(m: &[[f32; 4]; 4]) -> [f32; 16] {
    // Coordinate change matrix C: maps Z-up → Y-up
    //   C = | 1  0  0 |
    //       | 0  0  1 |
    //       | 0 -1  0 |
    //
    // The 3x3 rotation/scale part R' = C * R * C^-1 where C^-1 = C^T
    // Translation t' = C * t
    //
    // R is the upper-left 3×3 of mat_local (rows 0-2, cols 0-2)
    // t is (m[3][0], m[3][1], m[3][2])

    // C * R * C^T (where C swaps Y↔Z and negates new Z)
    // Row 0 of R = (m[0][0], m[0][1], m[0][2])
    // Row 1 of R = (m[1][0], m[1][1], m[1][2])
    // Row 2 of R = (m[2][0], m[2][1], m[2][2])
    //
    // C * R:
    //   row0: (m[0][0], m[0][1], m[0][2])     // x stays
    //   row1: (m[2][0], m[2][1], m[2][2])     // z→y
    //   row2: (-m[1][0], -m[1][1], -m[1][2]) // -y→z
    //
    // (C * R) * C^T  (C^T swaps cols 1,2 and negates col 2):
    //   R'[0][0] = m[0][0], R'[0][1] = m[0][2], R'[0][2] = -m[0][1]
    //   R'[1][0] = m[2][0], R'[1][1] = m[2][2], R'[1][2] = -m[2][1]
    //   R'[2][0] = -m[1][0], R'[2][1] = -m[1][2], R'[2][2] = m[1][1]

    let r00 = m[0][0]; let r01 = m[0][2]; let r02 = -m[0][1];
    let r10 = m[2][0]; let r11 = m[2][2]; let r12 = -m[2][1];
    let r20 = -m[1][0]; let r21 = -m[1][2]; let r22 = m[1][1];

    // Translation: C * (tx, ty, tz) = (tx, tz, -ty)
    let tx = m[3][0];
    let ty = m[3][2];
    let tz = -m[3][1];

    // glTF uses column-major: column 0 is [r00, r10, r20, 0], etc.
    [
        r00, r10, r20, 0.0,  // column 0
        r01, r11, r21, 0.0,  // column 1
        r02, r12, r22, 0.0,  // column 2
        tx,  ty,  tz,  1.0,  // column 3 (translation)
    ]
}

// ============================================================================
// Public API: export for round-trip editing (with PKO extras)
// ============================================================================

/// Build a complete glTF JSON string for round-trip editing of an LMO building.
///
/// Unlike `build_gltf_from_lmo`, this function:
/// - Does NOT bake `mat_local` into vertex positions — stores it as a glTF node matrix
/// - Stores all PKO metadata in glTF node/mesh extras for lossless re-import
/// - Includes vertex colors as extras (glTF COLOR_0 could be added but extras are simpler)
pub fn build_gltf_from_lmo_roundtrip(lmo_path: &Path, project_dir: &Path) -> Result<String> {
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

        // Add materials (with textures for standalone editing)
        if geom.materials.is_empty() {
            build_lmo_material(
                &mut builder,
                &lmo::LmoMaterial::new_simple(
                    [0.7, 0.7, 0.7, 1.0],
                    [0.3, 0.3, 0.3, 1.0],
                    1.0,
                    None,
                ),
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

        // Build primitives WITHOUT baking mat_local (skip_local_transform=true always).
        // Animated objects also skip local transform (same as viewer).
        let primitives = build_geom_primitives(
            &mut builder, geom, &prefix, material_base_idx, true, // always skip local transform
        );

        if primitives.is_empty() {
            continue;
        }

        // Build material extras
        let mat_extras = PkoLmoMaterialExtras {
            pko_lmo_materials: geom.materials.iter().map(|mat| {
                PkoLmoMaterialInfo {
                    opacity: mat.opacity,
                    transp_type: mat.transp_type,
                    diffuse: mat.diffuse,
                    ambient: mat.ambient,
                    specular: mat.specular,
                    emissive: mat.emissive,
                    power: mat.power,
                    rs_set: mat.rs_set.clone(),
                    tex_infos: mat.tex_infos.iter().map(PkoLmoTexStageInfo::from).collect(),
                }
            }).collect(),
        };
        let mat_extras_json = serde_json::to_string(&mat_extras)?;

        let mesh_idx = builder.meshes.len() as u32;
        builder.meshes.push(gltf_json::Mesh {
            name: Some(format!("geom_{}", gi)),
            primitives,
            weights: None,
            extensions: None,
            extras: Some(RawValue::from_string(mat_extras_json)?),
        });

        // Build node extras with all PKO header fields
        let node_extras = PkoLmoExtras {
            pko_lmo_geom: true,
            geom_id: geom.id,
            parent_id: geom.parent_id,
            obj_type: geom.obj_type,
            mat_local: mat44_to_flat(&geom.mat_local),
            rcci: BASE64_STANDARD.encode(&geom.rcci),
            state_ctrl: BASE64_STANDARD.encode(&geom.state_ctrl),
            fvf: geom.fvf,
            pt_type: geom.pt_type,
            bone_infl_factor: geom.bone_infl_factor,
            vertex_element_num: geom.vertex_element_num,
            vertex_elements_blob: if geom.vertex_elements_blob.is_empty() {
                String::new()
            } else {
                BASE64_STANDARD.encode(&geom.vertex_elements_blob)
            },
            mesh_rs_set: geom.mesh_rs_set.clone(),
            helper_blob: if geom.helper_blob.is_empty() {
                String::new()
            } else {
                BASE64_STANDARD.encode(&geom.helper_blob)
            },
            raw_anim_blob: if geom.raw_anim_blob.is_empty() {
                String::new()
            } else {
                BASE64_STANDARD.encode(&geom.raw_anim_blob)
            },
            vertex_colors: geom.vertex_colors.clone(),
            subsets: geom.subsets.iter().map(|s| PkoLmoSubsetExtras {
                primitive_num: s.primitive_num,
                start_index: s.start_index,
                vertex_num: s.vertex_num,
                min_index: s.min_index,
            }).collect(),
        };
        let node_extras_json = serde_json::to_string(&node_extras)?;

        // Use glTF node matrix for the mat_local transform (converted to Y-up)
        let has_animation = geom.animation.is_some();
        let node_matrix = if !has_animation && !is_identity(&geom.mat_local) {
            Some(mat_local_to_gltf_matrix(&geom.mat_local))
        } else {
            None
        };

        let node_idx = builder.nodes.len() as u32;
        let mut node = gltf_json::Node {
            mesh: Some(gltf_json::Index::new(mesh_idx)),
            name: Some(format!("geom_node_{}", gi)),
            extras: Some(RawValue::from_string(node_extras_json)?),
            ..Default::default()
        };
        if let Some(mat) = node_matrix {
            node.matrix = Some(mat);
        }
        builder.nodes.push(node);
        child_indices.push(gltf_json::Index::new(node_idx));

        if has_animation {
            animated_nodes.push((node_idx, geom));
        }
    }

    if child_indices.is_empty() {
        return Err(anyhow!("No renderable geometry in LMO file"));
    }

    let animations = build_animations(&mut builder, &animated_nodes);

    // Root node (no extras on root)
    let root_idx = builder.nodes.len() as u32;
    builder.nodes.push(gltf_json::Node {
        name: Some("building_root".to_string()),
        children: Some(child_indices),
        ..Default::default()
    });

    let root = gltf_json::Root {
        asset: gltf_json::Asset {
            version: "2.0".to_string(),
            generator: Some("pko-tools-roundtrip".to_string()),
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
        add_model_to_builder(&mut builder, &mut model_mesh_map, obj_id, &model, project_dir);
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
                &lmo::LmoMaterial::new_simple(
                    [0.7, 0.7, 0.7, 1.0],
                    [0.3, 0.3, 0.3, 1.0],
                    1.0,
                    None,
                ),
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
                rcci: [0u8; 16],
                state_ctrl: [0u8; 8],
                fvf: 0x112, // XYZ | NORMAL | TEX1
                pt_type: 4,
                bone_infl_factor: 0,
                vertex_element_num: 0,
                vertex_elements_blob: vec![],
                mesh_rs_set: vec![lmo::RenderStateAtom::default(); 8],
                vertices: vec![
                    [0.0, 0.0, 0.0],
                    [1.0, 0.0, 0.0],
                    [0.0, 1.0, 0.0],
                ],
                normals: vec![
                    [0.0, 0.0, 1.0],
                    [0.0, 0.0, 1.0],
                    [0.0, 0.0, 1.0],
                ],
                texcoords: vec![[0.0, 0.0], [1.0, 0.0], [0.0, 1.0]],
                vertex_colors: vec![],
                indices: vec![0, 1, 2],
                subsets: vec![lmo::LmoSubset {
                    primitive_num: 1,
                    start_index: 0,
                    vertex_num: 3,
                    min_index: 0,
                }],
                materials: vec![lmo::LmoMaterial::new_simple(
                    [0.8, 0.2, 0.1, 1.0],
                    [0.3, 0.3, 0.3, 1.0],
                    1.0,
                    Some("wall.bmp".to_string()),
                )],
                helper_blob: vec![],
                raw_anim_blob: vec![],
                animation: None,
                mtl_format_version: lmo::MtlFormatVersion::Current,
            }],
            non_geom_entries: vec![],
        }
    }

    #[test]
    fn coordinate_transform_z_up_to_y_up() {
        // Game: Z-up → glTF: Y-up: (x, y, z) → (x, z, -y)
        assert_eq!(transform_position([1.0, 2.0, 3.0]), [1.0, 3.0, -2.0]);
        assert_eq!(transform_position([0.0, 0.0, 0.0]), [0.0, 0.0, 0.0]);
        assert_eq!(transform_normal([0.0, 0.0, 1.0]), [0.0, 1.0, 0.0]);
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
        let mat = lmo::LmoMaterial::new_simple(
            [0.5, 0.6, 0.7, 1.0],
            [0.1, 0.1, 0.1, 1.0],
            1.0,
            None,
        );
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
        let mat = lmo::LmoMaterial::new_simple(
            [0.5, 0.6, 0.7, 1.0],
            [0.1, 0.1, 0.1, 1.0],
            0.5,
            None,
        );
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
        assert!(result.model_mesh_map.is_empty(), "effects should be skipped");

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
        push_zeros(&mut buf, 8);  // state_ctrl
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
                for &c in &mat.diffuse { push_f32(&mut buf, c); }
                for &c in &mat.ambient { push_f32(&mut buf, c); }
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
            for &c in v { push_f32(&mut buf, c); }
        }
        if has_normals {
            for n in &geom.normals {
                for &c in n { push_f32(&mut buf, c); }
            }
        }
        if has_texcoords {
            for t in &geom.texcoords {
                for &c in t { push_f32(&mut buf, c); }
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
        let lmo_path = project_dir.join("model").join("scene").join("by-bd014-1.lmo");
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
            assert!(
                !imgs.is_empty(),
                "version-0 LMO should have texture images"
            );
        }
    }

    // ====================================================================
    // Roundtrip export tests
    // ====================================================================

    #[test]
    fn roundtrip_export_has_node_extras() {
        let model = make_test_model();
        // Write model to temp file, then export roundtrip
        let temp_dir = std::env::temp_dir().join("pko_roundtrip_test");
        let _ = std::fs::create_dir_all(&temp_dir);
        let lmo_path = temp_dir.join("test_rt.lmo");

        // Write LMO binary using the writer
        let data = crate::map::lmo_writer::write_lmo(&model);
        std::fs::write(&lmo_path, &data).unwrap();

        let json = build_gltf_from_lmo_roundtrip(&lmo_path, &temp_dir).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        // Find node with extras
        let nodes = parsed["nodes"].as_array().unwrap();
        let geom_node = nodes.iter().find(|n| {
            n.get("extras")
                .and_then(|e| e.get("pko_lmo_geom"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false)
        });
        assert!(geom_node.is_some(), "should have a node with pko_lmo_geom extras");

        let extras = &geom_node.unwrap()["extras"];
        assert_eq!(extras["geom_id"].as_u64().unwrap(), 1);
        assert_eq!(extras["fvf"].as_u64().unwrap(), 0x112);
        assert_eq!(extras["pt_type"].as_u64().unwrap(), 4);
        assert!(extras["pko_lmo_geom"].as_bool().unwrap());

        // mat_local should be flat 16-element array
        let mat_local = extras["mat_local"].as_array().unwrap();
        assert_eq!(mat_local.len(), 16);

        // rcci and state_ctrl should be base64 strings
        assert!(extras["rcci"].is_string());
        assert!(extras["state_ctrl"].is_string());

        // mesh_rs_set should be array of 8 atoms
        let mesh_rs = extras["mesh_rs_set"].as_array().unwrap();
        assert_eq!(mesh_rs.len(), 8);

        // subsets should be present
        let subsets = extras["subsets"].as_array().unwrap();
        assert_eq!(subsets.len(), 1);
        assert_eq!(subsets[0]["primitive_num"].as_u64().unwrap(), 1);

        // Clean up
        let _ = std::fs::remove_file(&lmo_path);
    }

    #[test]
    fn roundtrip_export_has_material_extras() {
        let model = make_test_model();
        let temp_dir = std::env::temp_dir().join("pko_roundtrip_test2");
        let _ = std::fs::create_dir_all(&temp_dir);
        let lmo_path = temp_dir.join("test_rt2.lmo");

        let data = crate::map::lmo_writer::write_lmo(&model);
        std::fs::write(&lmo_path, &data).unwrap();

        let json = build_gltf_from_lmo_roundtrip(&lmo_path, &temp_dir).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        // Find mesh with material extras
        let meshes = parsed["meshes"].as_array().unwrap();
        let mesh = &meshes[0];
        let extras = mesh.get("extras").expect("mesh should have extras");
        let materials = extras["pko_lmo_materials"].as_array().unwrap();
        assert_eq!(materials.len(), 1);

        let mat = &materials[0];
        assert!((mat["opacity"].as_f64().unwrap() - 1.0).abs() < 0.01);
        assert_eq!(mat["tex_infos"].as_array().unwrap().len(), 4);

        // Diffuse should match
        let diffuse = mat["diffuse"].as_array().unwrap();
        assert!((diffuse[0].as_f64().unwrap() - 0.8).abs() < 0.01);

        // Texture filename should be in tex_infos[0]
        let tex0 = &mat["tex_infos"].as_array().unwrap()[0];
        assert_eq!(tex0["filename"].as_str().unwrap(), "wall.bmp");

        let _ = std::fs::remove_file(&lmo_path);
    }

    #[test]
    fn roundtrip_export_extras_serde_roundtrip() {
        // Test that PkoLmoExtras can be serialized and deserialized losslessly
        let extras = PkoLmoExtras {
            pko_lmo_geom: true,
            geom_id: 42,
            parent_id: 0xFFFFFFFF,
            obj_type: 0,
            mat_local: [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 10.0, 20.0, 30.0, 1.0],
            rcci: BASE64_STANDARD.encode([1u8, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
            state_ctrl: BASE64_STANDARD.encode([0xAAu8, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF, 0x11, 0x22]),
            fvf: 0x112,
            pt_type: 4,
            bone_infl_factor: 0,
            vertex_element_num: 0,
            vertex_elements_blob: String::new(),
            mesh_rs_set: vec![lmo::RenderStateAtom { state: 7, value0: 42, value1: 0 }; 8],
            helper_blob: String::new(),
            raw_anim_blob: String::new(),
            vertex_colors: vec![0xFFFF0000, 0xFF00FF00, 0xFF0000FF],
            subsets: vec![PkoLmoSubsetExtras { primitive_num: 1, start_index: 0, vertex_num: 3, min_index: 0 }],
        };

        let json = serde_json::to_string(&extras).unwrap();
        let parsed: PkoLmoExtras = serde_json::from_str(&json).unwrap();

        assert_eq!(parsed.geom_id, 42);
        assert_eq!(parsed.parent_id, 0xFFFFFFFF);
        assert_eq!(parsed.fvf, 0x112);
        assert_eq!(parsed.mat_local[12], 10.0); // translation X
        assert_eq!(parsed.vertex_colors.len(), 3);
        assert_eq!(parsed.subsets.len(), 1);

        // Decode rcci back
        let rcci_bytes = BASE64_STANDARD.decode(&parsed.rcci).unwrap();
        assert_eq!(rcci_bytes, vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
    }

    #[test]
    fn roundtrip_export_material_extras_backward_compat() {
        // Test that missing optional fields deserialize with defaults
        let json = r#"{"pko_lmo_materials":[{"opacity":1.0,"transp_type":0,"diffuse":[0.8,0.2,0.1,1.0],"ambient":[0.3,0.3,0.3,1.0],"specular":[0.0,0.0,0.0,1.0],"emissive":[0.0,0.0,0.0,0.0],"power":0.0,"rs_set":[],"tex_infos":[]}]}"#;
        let parsed: PkoLmoMaterialExtras = serde_json::from_str(json).unwrap();
        assert_eq!(parsed.pko_lmo_materials.len(), 1);
        assert!((parsed.pko_lmo_materials[0].opacity - 1.0).abs() < 0.01);
    }

    #[test]
    fn mat_local_to_gltf_matrix_identity() {
        let id = [
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
        ];
        let gltf_mat = mat_local_to_gltf_matrix(&id);
        // Identity in any coordinate system should remain identity
        let expected = [
            1.0, 0.0, 0.0, 0.0,
            0.0, 1.0, 0.0, 0.0,
            0.0, 0.0, 1.0, 0.0,
            0.0, 0.0, 0.0, 1.0,
        ];
        for i in 0..16 {
            assert!((gltf_mat[i] - expected[i]).abs() < 1e-5, "element {} mismatch: {} vs {}", i, gltf_mat[i], expected[i]);
        }
    }

    #[test]
    fn mat_local_to_gltf_matrix_translation() {
        // PKO Z-up translation (tx=10, ty=20, tz=30)
        // Should become glTF Y-up: (10, 30, -20)
        let m = [
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [10.0, 20.0, 30.0, 1.0],
        ];
        let gltf_mat = mat_local_to_gltf_matrix(&m);
        // Column 3 (translation) = elements [12, 13, 14, 15]
        assert!((gltf_mat[12] - 10.0).abs() < 1e-5, "tx");
        assert!((gltf_mat[13] - 30.0).abs() < 1e-5, "ty");
        assert!((gltf_mat[14] - (-20.0)).abs() < 1e-5, "tz");
    }

    #[test]
    fn roundtrip_export_does_not_bake_mat_local() {
        // Verify that roundtrip export doesn't bake mat_local into vertices
        let mut model = make_test_model();
        model.geom_objects[0].mat_local[3][0] = 100.0; // translation X=100

        let temp_dir = std::env::temp_dir().join("pko_roundtrip_nobake");
        let _ = std::fs::create_dir_all(&temp_dir);
        let lmo_path = temp_dir.join("test_nobake.lmo");
        let data = crate::map::lmo_writer::write_lmo(&model);
        std::fs::write(&lmo_path, &data).unwrap();

        let json = build_gltf_from_lmo_roundtrip(&lmo_path, &temp_dir).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        // The node should have a matrix transform (not identity, since mat_local is not identity)
        let nodes = parsed["nodes"].as_array().unwrap();
        let geom_node = nodes.iter().find(|n| {
            n.get("extras")
                .and_then(|e| e.get("pko_lmo_geom"))
                .is_some()
        }).unwrap();
        assert!(geom_node.get("matrix").is_some(), "node should have a matrix transform");

        // Vertices should NOT have the 100.0 translation baked in
        // The original vertex at (0,0,0) should still be near origin in glTF space
        // (after Z-up→Y-up: (0,0,0) → (0,0,0))
        let accessors = parsed["accessors"].as_array().unwrap();
        let pos_acc = accessors.iter().find(|a| {
            a["name"].as_str().map(|n| n.contains("pos")).unwrap_or(false)
        }).unwrap();
        let min_val = pos_acc["min"].as_array().unwrap();
        // If mat_local were baked, min X would be ~100. Since it's not, it should be ~0.
        let min_x = min_val[0].as_f64().unwrap();
        assert!(min_x.abs() < 1.0, "vertex X should not have mat_local translation baked in, got {}", min_x);

        let _ = std::fs::remove_file(&lmo_path);
    }

    #[test]
    fn roundtrip_export_real_lmo() {
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
                        .map(|e| e.path().extension().map(|ext| ext.to_ascii_lowercase() == "lmo").unwrap_or(false))
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
        let json = build_gltf_from_lmo_roundtrip(&lmo_path, project_dir).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        // Should have generator = pko-tools-roundtrip
        assert_eq!(parsed["asset"]["generator"].as_str().unwrap(), "pko-tools-roundtrip");

        // Should have node extras
        let nodes = parsed["nodes"].as_array().unwrap();
        let geom_nodes: Vec<_> = nodes.iter().filter(|n| {
            n.get("extras")
                .and_then(|e| e.get("pko_lmo_geom"))
                .is_some()
        }).collect();
        assert!(!geom_nodes.is_empty(), "should have at least one node with PKO extras");

        // Should have mesh extras
        let meshes = parsed["meshes"].as_array().unwrap();
        let mesh_with_extras = meshes.iter().find(|m| {
            m.get("extras")
                .and_then(|e| e.get("pko_lmo_materials"))
                .is_some()
        });
        assert!(mesh_with_extras.is_some(), "should have at least one mesh with material extras");
    }
}
