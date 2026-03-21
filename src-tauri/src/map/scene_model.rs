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

use super::lmo_types::{self as lmo, D3DCULL_NONE, LmoGeomObject, LmoModel};
use super::lmo_loader;
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

    /// Add an accessor backed by u8 data (e.g. for JOINTS_0).
    fn add_accessor_u8(
        &mut self,
        data: &[u8],
        name: &str,
        acc_type: gltf_json::accessor::Type,
        components_per_element: usize,
    ) -> u32 {
        let buf_idx = self.buffers.len();
        let bv_idx = self.buffer_views.len();
        let acc_idx = self.accessors.len();

        let count = data.len() / components_per_element;

        self.buffers.push(gltf_json::Buffer {
            byte_length: USize64(data.len() as u64),
            extensions: None,
            extras: None,
            name: Some(format!("{}_buffer", name)),
            uri: Some(format!(
                "data:application/octet-stream;base64,{}",
                BASE64_STANDARD.encode(data)
            )),
        });

        self.buffer_views.push(gltf_json::buffer::View {
            buffer: gltf_json::Index::new(buf_idx as u32),
            byte_length: USize64(data.len() as u64),
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
            component_type: Checked::Valid(GenericComponentType(ComponentType::U8)),
            count: USize64(count as u64),
            extensions: None,
            extras: None,
            max: None,
            min: None,
            name: Some(format!("{}_accessor", name)),
            normalized: false,
            sparse: None,
            type_: Checked::Valid(acc_type),
        });

        acc_idx as u32
    }
}

// ============================================================================
// Build glTF material from LMO material data (with texture loading)
// ============================================================================

/// Try to find a texture file from the PKO project directory.
/// Scene model textures can be in several directories.
pub fn find_texture_file(project_dir: &Path, tex_name: &str) -> Option<std::path::PathBuf> {
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

/// DDS FourCC constants.
const DDS_MAGIC: &[u8; 4] = b"DDS ";
const FOURCC_DXT1: u32 = u32::from_le_bytes(*b"DXT1");
const FOURCC_DXT3: u32 = u32::from_le_bytes(*b"DXT3");
const FOURCC_DXT5: u32 = u32::from_le_bytes(*b"DXT5");

/// Decode raw texture bytes into an RGBA8 `DynamicImage`, preserving DXT1 punch-through alpha.
///
/// The `image` crate (v0.25) decodes DXT1 as Rgb8, permanently discarding the 1-bit alpha.
/// This function detects DXT1 DDS files and uses `texture2ddecoder::decode_bc1a()` which
/// correctly preserves punch-through alpha (transparent pixels where color0 <= color1).
///
/// For DXT3/DXT5 and non-DDS formats, falls through to the `image` crate.
pub(crate) fn decode_dds_with_alpha(data: &[u8]) -> Option<image::DynamicImage> {
    // Check DDS magic (4 bytes) + minimum header size (124 bytes) + pixelformat
    if data.len() >= 128 && &data[0..4] == DDS_MAGIC {
        // DDS_PIXELFORMAT.dwFlags at offset 76+4=80 from file start
        // (header starts at offset 4, pixelformat at offset 76 within header)
        let pf_flags = u32::from_le_bytes([data[80], data[81], data[82], data[83]]);
        let has_fourcc = pf_flags & 0x4 != 0; // DDPF_FOURCC

        if has_fourcc {
            let fourcc = u32::from_le_bytes([data[84], data[85], data[86], data[87]]);

            if fourcc == FOURCC_DXT1 {
                // Parse dimensions from header
                let height = u32::from_le_bytes([data[12], data[13], data[14], data[15]]) as usize;
                let width = u32::from_le_bytes([data[16], data[17], data[18], data[19]]) as usize;

                if width == 0 || height == 0 {
                    return None;
                }

                // Compressed data starts at offset 128 (4 magic + 124 header)
                let compressed = &data[128..];
                let mut pixels = vec![0u32; width * height];

                if texture2ddecoder::decode_bc1a(compressed, width, height, &mut pixels).is_err() {
                    return None;
                }

                // Convert u32 pixels to ImageRgba8
                // texture2ddecoder outputs pixels as u32 where LE bytes = [B, G, R, A]
                let mut rgba_bytes = Vec::with_capacity(width * height * 4);
                for pixel in &pixels {
                    let [b, g, r, a] = pixel.to_le_bytes();
                    rgba_bytes.extend_from_slice(&[r, g, b, a]);
                }

                let img_buf = image::RgbaImage::from_raw(width as u32, height as u32, rgba_bytes)?;
                return Some(image::DynamicImage::ImageRgba8(img_buf));
            }
            // DXT3/DXT5: fall through to image crate (handles alpha correctly)
        }
    }

    // Non-DDS or non-DXT1: use image crate as before
    image::load_from_memory(data).ok()
}

/// Load a texture from disk, decode PKO encoding, convert to PNG, return base64 data URI.
/// Uses `decode_dds_with_alpha` to preserve DXT1 punch-through alpha.
fn load_texture_as_data_uri(path: &Path) -> Option<String> {
    let raw_bytes = std::fs::read(path).ok()?;
    let decoded = decode_pko_texture(&raw_bytes);
    let img = match decode_dds_with_alpha(&decoded) {
        Some(img) => img,
        None => {
            eprintln!(
                "Warning: failed to decode texture {}",
                path.display(),
            );
            return None;
        }
    };
    let rgba = img.to_rgba8();
    let mut png_data = Vec::new();
    let mut cursor = std::io::Cursor::new(&mut png_data);
    image::DynamicImage::ImageRgba8(rgba)
        .write_to(&mut cursor, image::ImageFormat::Png)
        .ok()?;
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

/// How to handle textures in material export.
#[derive(Clone, Copy, PartialEq)]
enum TextureMode {
    /// Don't load textures at all (batch map loading).
    Skip,
    /// Load, decode, and embed as data URI (current behavior for individual building export).
    Embed,
    /// Write external URI reference to shared texture directory (new pipeline).
    /// The URI is relative to the GLB's location: `../textures/scene/{stem}.dds`
    ExternalUri,
}

fn build_lmo_material(
    builder: &mut GltfBuilder,
    mat: &lmo::LmoMaterial,
    name: &str,
    project_dir: &Path,
    texture_mode: TextureMode,
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
    //
    // C2 fix: Also emit suffix for type-0 (FILTER) with partial opacity (opacity < 1.0).
    // Without the suffix, Unity falls through to opaque TOP/StaticMesh — glass, fences,
    // and translucent surfaces render as solid.
    let has_partial_opacity = mat.opacity < 0.99;
    let needs_suffix = is_effect || mat.alpha_test_enabled || has_partial_opacity;
    let material_name = if needs_suffix {
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

    // Try to load/reference the texture based on mode
    let base_color_texture = if texture_mode == TextureMode::Skip {
        None
    } else {
        mat.tex_filename
            .as_deref()
            .filter(|f| !f.is_empty())
            .and_then(|tex_name| {
                // Get texture stem (filename without extension)
                let stem = tex_name
                    .rfind('.')
                    .map(|i| &tex_name[..i])
                    .unwrap_or(tex_name);

                match texture_mode {
                    TextureMode::Embed => {
                        // Original path: find file, decode, embed as data URI
                        let tex_path = find_texture_file(project_dir, tex_name)?;
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
                    }
                    TextureMode::ExternalUri => {
                        // New path: external URI reference to shared KTX2 texture
                        // URI is relative to the GLB location (buildings/textures/)
                        // Must be a subdirectory — glTFast doesn't resolve ../ in URIs
                        // Uses KTX2 format: glTFast supports .ktx2 but NOT .dds
                        let uri = format!("textures/{}.png", stem.to_lowercase());

                        let image_index = builder.images.len() as u32;
                        builder.images.push(gltf_json::Image {
                            name: Some(stem.to_lowercase()),
                            buffer_view: None,
                            extensions: None,
                            mime_type: None, // Let the importer determine MIME from file
                            extras: None,
                            uri: Some(uri),
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
                            name: Some(stem.to_lowercase()),
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
                    }
                    TextureMode::Skip => unreachable!(),
                }
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
        // D3D default is D3DCULL_CCW (back-face culling). Only D3DCULL_NONE means double-sided.
        double_sided: mat.cull_mode == Some(D3DCULL_NONE),
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
    // (animated objects get their transform from animation keyframes instead).
    let use_local_mat = !skip_local_transform && !is_identity(&geom.mat_local);
    // The Z-up→Y-up mapping (x,y,z)→(x,z,y) is a reflection (det=-1),
    // so winding must always be reversed to restore correct front-face (CCW).
    let should_reverse_winding = true;

    let positions: Vec<f32> = geom
        .vertices
        .iter()
        .flat_map(|v| {
            let p = if use_local_mat {
                transform_by_matrix(*v, &geom.mat_local)
            } else {
                *v
            };
            transform_position(p).into_iter()
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
                transform_normal(n2).into_iter()
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

    // Export skinning data (JOINTS_0, WEIGHTS_0) if present.
    let joints_acc = if !geom.bone_indices.is_empty() {
        let joints_data: Vec<u8> = geom
            .bone_indices
            .iter()
            .flat_map(|bi| bi.iter().copied())
            .collect();
        Some(builder.add_accessor_u8(
            &joints_data,
            &format!("{}_joints", prefix),
            gltf_json::accessor::Type::Vec4,
            4,
        ))
    } else {
        None
    };

    let weights_acc = if !geom.blend_weights.is_empty() {
        let weights_data: Vec<f32> = geom
            .blend_weights
            .iter()
            .flat_map(|w| w.iter().copied())
            .collect();
        Some(builder.add_accessor_f32(
            &weights_data,
            &format!("{}_weights", prefix),
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
        let prim_indices = if should_reverse_winding {
            reverse_winding(&geom.indices)
        } else {
            geom.indices.clone()
        };
        let idx_acc = builder.add_index_accessor(&prim_indices, &format!("{}_idx", prefix));

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
        if let Some(ja) = joints_acc {
            attributes.insert(
                Checked::Valid(gltf_json::mesh::Semantic::Joints(0)),
                gltf_json::Index::new(ja),
            );
        }
        if let Some(wa) = weights_acc {
            attributes.insert(
                Checked::Valid(gltf_json::mesh::Semantic::Weights(0)),
                gltf_json::Index::new(wa),
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

            let sub_indices = if should_reverse_winding {
                reverse_winding(&geom.indices[start..end])
            } else {
                geom.indices[start..end].to_vec()
            };
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
            if let Some(ja) = joints_acc {
                attributes.insert(
                    Checked::Valid(gltf_json::mesh::Semantic::Joints(0)),
                    gltf_json::Index::new(ja),
                );
            }
            if let Some(wa) = weights_acc {
                attributes.insert(
                    Checked::Valid(gltf_json::mesh::Semantic::Weights(0)),
                    gltf_json::Index::new(wa),
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
// Texture/opacity animation → glTF node extras
// ============================================================================

/// Build glTF node extras JSON for texuv/teximg/mtlopac/transform animation data.
/// Returns None if the geom object has no animations of any kind.
fn build_anim_extras(geom: &LmoGeomObject, geom_index: usize) -> gltf_json::extras::Extras {
    let has_property_anims = !geom.texuv_anims.is_empty()
        || !geom.teximg_anims.is_empty()
        || !geom.mtlopac_anims.is_empty();
    let has_transform_anim = geom
        .animation
        .as_ref()
        .map_or(false, |a| a.frame_num > 0);
    if !has_property_anims && !has_transform_anim {
        return None;
    }

    let mut extras = serde_json::Map::new();

    // Stable geometry index for animation binding (matches node name "geom_node_{gi}")
    extras.insert("geom_index".to_string(), serde_json::json!(geom_index));

    // texuv: array of { subset, stage, frame_num, matrices: [[16 floats]...] }
    if !geom.texuv_anims.is_empty() {
        let texuv_arr: Vec<serde_json::Value> = geom
            .texuv_anims
            .iter()
            .map(|uv| {
                // Flatten each 4×4 matrix to 16 floats (row-major)
                let matrices: Vec<serde_json::Value> = uv
                    .matrices
                    .iter()
                    .map(|m| {
                        let flat: Vec<f32> = m.iter().flat_map(|row| row.iter().copied()).collect();
                        serde_json::json!(flat)
                    })
                    .collect();
                serde_json::json!({
                    "subset": uv.subset,
                    "stage": uv.stage,
                    "frame_num": uv.frame_num,
                    "matrices": matrices,
                })
            })
            .collect();
        extras.insert("texuv_anims".to_string(), serde_json::json!(texuv_arr));
    }

    // teximg: array of { subset, stage, textures: ["file1.tga", ...] }
    if !geom.teximg_anims.is_empty() {
        let teximg_arr: Vec<serde_json::Value> = geom
            .teximg_anims
            .iter()
            .map(|ti| {
                serde_json::json!({
                    "subset": ti.subset,
                    "stage": ti.stage,
                    "textures": ti.textures,
                })
            })
            .collect();
        extras.insert("teximg_anims".to_string(), serde_json::json!(teximg_arr));
    }

    // mtlopac: array of { subset, keyframes: [{ frame, opacity }...] }
    if !geom.mtlopac_anims.is_empty() {
        let mtlopac_arr: Vec<serde_json::Value> = geom
            .mtlopac_anims
            .iter()
            .map(|mo| {
                let kfs: Vec<serde_json::Value> = mo
                    .keyframes
                    .iter()
                    .map(|kf| {
                        serde_json::json!({
                            "frame": kf.frame,
                            "opacity": kf.opacity,
                        })
                    })
                    .collect();
                serde_json::json!({
                    "subset": mo.subset,
                    "keyframes": kfs,
                })
            })
            .collect();
        extras.insert("mtlopac_anims".to_string(), serde_json::json!(mtlopac_arr));
    }

    // transform_anim: { frame_num, translations: [[x,y,z]...], rotations: [[x,y,z,w]...] }
    // Values are in glTF Y-up space (same transform build_animations() used to apply).
    if let Some(anim) = &geom.animation {
        if anim.frame_num > 0 {
            let translations: Vec<serde_json::Value> = anim
                .translations
                .iter()
                .map(|t| {
                    let yt = z_up_to_y_up_vec3(*t);
                    serde_json::json!([yt[0], yt[1], yt[2]])
                })
                .collect();
            let rotations: Vec<serde_json::Value> = anim
                .rotations
                .iter()
                .map(|r| {
                    let yr = z_up_to_y_up_quat(*r);
                    serde_json::json!([yr[0], yr[1], yr[2], yr[3]])
                })
                .collect();
            extras.insert(
                "transform_anim".to_string(),
                serde_json::json!({
                    "frame_num": anim.frame_num,
                    "frame_rate": FRAME_RATE,
                    "translations": translations,
                    "rotations": rotations,
                }),
            );
        }
    }

    let json_str = serde_json::to_string(&extras).ok()?;
    serde_json::value::RawValue::from_string(json_str).ok()
}

/// Build glTF node extras combining animation data + pko_primitive_id.
/// The primitive ID maps this mesh node to the PKO LMO subset index, used by
/// Unity to identify which mesh pieces should fade (overhead roof fade system).
fn build_node_extras(geom: &LmoGeomObject, geom_index: usize) -> gltf_json::extras::Extras {
    let anim_extras = build_anim_extras(geom, geom_index);

    // Start with existing anim extras or empty map
    let mut extras: serde_json::Map<String, serde_json::Value> = match &anim_extras {
        Some(raw) => serde_json::from_str(raw.get()).unwrap_or_default(),
        None => serde_json::Map::new(),
    };

    // Always write pko_primitive_id so Unity can map subset indices
    extras.insert(
        "pko_primitive_id".to_string(),
        serde_json::json!(geom_index),
    );

    let json_str = serde_json::to_string(&extras).ok()?;
    serde_json::value::RawValue::from_string(json_str).ok()
}

// ============================================================================
// Coordinate helpers (used by build_anim_extras and build_animations)
// ============================================================================

const FRAME_RATE: f32 = 30.0;

/// Transform a position vector from Z-up game space to Y-up glTF space.
/// Uses the same mapping as `transform_position`: (x,y,z) → (x,z,y).
fn z_up_to_y_up_vec3(v: [f32; 3]) -> [f32; 3] {
    [v[0], v[2], v[1]]
}

/// Transform a quaternion from Z-up game space to Y-up glTF space.
/// Input/output in glTF [x, y, z, w] order.
///
/// The Y↔Z axis swap is a reflection (det = -1). For quaternions representing
/// rotations, this means: swap Y↔Z components AND negate the rotation angle.
/// Negating the angle negates the vector part: (qx,qy,qz,qw) → (-qx,-qz,-qy,qw).
fn z_up_to_y_up_quat(q: [f32; 4]) -> [f32; 4] {
    [-q[0], -q[2], -q[1], q[3]]
}

// ============================================================================
// Animation: convert LMO matrix keyframes → glTF animation tracks
// ============================================================================

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
// Bone skinning: joint hierarchy, Skin, and bone animation channels
// ============================================================================

/// Result of building bone skinning data for a geometry object.
struct BoneSkinData {
    /// glTF Skin object referencing joint nodes and inverse bind matrices.
    skin: gltf_json::Skin,
    /// Node indices of the joint nodes (in bone order).
    joint_node_indices: Vec<u32>,
    /// Bone animation samplers and channels (to be merged into a single Animation).
    bone_samplers: Vec<Sampler>,
    bone_channels: Vec<Channel>,
}

/// Build glTF skinning data for a geometry object with bone animation.
///
/// Creates joint nodes in the builder's node list, arranged in parent-child
/// hierarchy matching the PKO bone tree. Creates inverse bind matrix accessor
/// and per-bone animation channels (translation + rotation at 30fps).
///
/// PKO bone keyframes are LOCAL-space transforms (relative to parent bone),
/// which matches glTF's joint animation channel semantics exactly.
fn build_bone_skin(
    builder: &mut GltfBuilder,
    geom: &LmoGeomObject,
    prefix: &str,
) -> Option<BoneSkinData> {
    let bone_anim = geom.bone_animation.as_ref()?;
    if bone_anim.bones.is_empty() {
        return None;
    }

    let bone_num = bone_anim.bone_num as usize;

    // Create joint nodes. We need to track their indices in the global node list.
    let first_joint_node_idx = builder.nodes.len() as u32;
    let mut joint_node_indices: Vec<u32> = Vec::with_capacity(bone_num);

    // First pass: create all joint nodes (without children, we'll set those after)
    for (bi, bone) in bone_anim.bones.iter().enumerate() {
        let node_idx = builder.nodes.len() as u32;
        joint_node_indices.push(node_idx);

        // Set initial transform from frame 0 keyframes (if available)
        let (translation, rotation) = if bi < bone_anim.keyframes.len()
            && !bone_anim.keyframes[bi].translations.is_empty()
        {
            let t = z_up_to_y_up_vec3(bone_anim.keyframes[bi].translations[0]);
            let r = z_up_to_y_up_quat(bone_anim.keyframes[bi].rotations[0]);
            (Some(t), Some(r))
        } else {
            (None, None)
        };

        builder.nodes.push(gltf_json::Node {
            name: Some(format!("{}_{}", prefix, bone.name)),
            translation: translation.map(|t| t.into()),
            rotation: rotation.map(|r| gltf_json::scene::UnitQuaternion(r)),
            ..Default::default()
        });

        let _ = bone;
    }

    // Second pass: set up parent-child relationships
    // Build children lists per bone
    let mut children_map: Vec<Vec<u32>> = vec![vec![]; bone_num];
    for (bi, bone) in bone_anim.bones.iter().enumerate() {
        if bone.parent_id != 0xFFFFFFFF {
            let parent_idx = bone.parent_id as usize;
            if parent_idx < bone_num {
                children_map[parent_idx].push(first_joint_node_idx + bi as u32);
            }
        }
    }

    for (bi, children) in children_map.iter().enumerate() {
        if !children.is_empty() {
            let node_idx = (first_joint_node_idx + bi as u32) as usize;
            builder.nodes[node_idx].children = Some(
                children
                    .iter()
                    .map(|&c| gltf_json::Index::new(c))
                    .collect(),
            );
        }
    }

    // Build inverse bind matrices accessor.
    // PKO IBMs are 4×4 row-major, row-vector convention (v' = v * M) in Z-up.
    // glTF IBMs are 4×4 column-major, column-vector convention (v' = M * v) in Y-up.
    // Conversion: IBM_gltf = S * IBM_pko^T * S, where S swaps Y↔Z.
    // In element form: IBM_gltf[row][col] = IBM_pko[ymap[col]][ymap[row]]
    // Writing column-major: iterate col outer, row inner.
    let ymap = [0usize, 2, 1, 3]; // Y↔Z swap index mapping
    let mut ibm_data: Vec<f32> = Vec::with_capacity(bone_num * 16);
    for ibm in &bone_anim.inv_bind_matrices {
        for col in 0..4 {
            for row in 0..4 {
                ibm_data.push(ibm[ymap[col]][ymap[row]]);
            }
        }
    }

    let ibm_acc = builder.add_accessor_f32(
        &ibm_data,
        &format!("{}_ibm", prefix),
        gltf_json::accessor::Type::Mat4,
        16,
        None,
        None,
    );

    let skin = gltf_json::Skin {
        inverse_bind_matrices: Some(gltf_json::Index::new(ibm_acc)),
        joints: joint_node_indices
            .iter()
            .map(|&i| gltf_json::Index::new(i))
            .collect(),
        skeleton: Some(gltf_json::Index::new(first_joint_node_idx)),
        extensions: None,
        extras: None,
        name: Some(format!("{}_skin", prefix)),
    };

    // Build bone animation channels
    let (bone_samplers, bone_channels) = if bone_anim.frame_num > 1 {
        let frame_num = bone_anim.frame_num as usize;
        let mut channels: Vec<Channel> = Vec::new();
        let mut samplers: Vec<Sampler> = Vec::new();

        // Shared time accessor for all bones
        let timings: Vec<f32> = (0..frame_num).map(|f| f as f32 / FRAME_RATE).collect();
        let time_max = timings.last().copied().unwrap_or(0.0);
        let time_acc = builder.add_accessor_f32(
            &timings,
            &format!("{}_bone_time", prefix),
            gltf_json::accessor::Type::Scalar,
            1,
            Some(serde_json::json!([0.0f32])),
            Some(serde_json::json!([time_max])),
        );

        for (bi, kf) in bone_anim.keyframes.iter().enumerate() {
            if bi >= bone_num {
                break;
            }
            let joint_node = joint_node_indices[bi];

            // Translation channel
            let trans_data: Vec<f32> = kf
                .translations
                .iter()
                .flat_map(|t| z_up_to_y_up_vec3(*t).into_iter())
                .collect();
            let trans_acc = builder.add_accessor_f32(
                &trans_data,
                &format!("{}_bone{}_trans", prefix, bi),
                gltf_json::accessor::Type::Vec3,
                3,
                None,
                None,
            );

            let trans_sampler_idx = samplers.len() as u32;
            samplers.push(Sampler {
                input: gltf_json::Index::new(time_acc),
                interpolation: Checked::Valid(gltf_json::animation::Interpolation::Linear),
                output: gltf_json::Index::new(trans_acc),
                extensions: None,
                extras: None,
            });
            channels.push(Channel {
                sampler: gltf_json::Index::new(trans_sampler_idx),
                target: Target {
                    node: gltf_json::Index::new(joint_node),
                    path: Checked::Valid(gltf_json::animation::Property::Translation),
                    extensions: None,
                    extras: None,
                },
                extensions: None,
                extras: None,
            });

            // Rotation channel
            let rot_data: Vec<f32> = kf
                .rotations
                .iter()
                .flat_map(|r| z_up_to_y_up_quat(*r).into_iter())
                .collect();
            let rot_acc = builder.add_accessor_f32(
                &rot_data,
                &format!("{}_bone{}_rot", prefix, bi),
                gltf_json::accessor::Type::Vec4,
                4,
                None,
                None,
            );

            let rot_sampler_idx = samplers.len() as u32;
            samplers.push(Sampler {
                input: gltf_json::Index::new(time_acc),
                interpolation: Checked::Valid(gltf_json::animation::Interpolation::Linear),
                output: gltf_json::Index::new(rot_acc),
                extensions: None,
                extras: None,
            });
            channels.push(Channel {
                sampler: gltf_json::Index::new(rot_sampler_idx),
                target: Target {
                    node: gltf_json::Index::new(joint_node),
                    path: Checked::Valid(gltf_json::animation::Property::Rotation),
                    extensions: None,
                    extras: None,
                },
                extensions: None,
                extras: None,
            });
        }

        (samplers, channels)
    } else {
        (Vec::new(), Vec::new())
    };

    Some(BoneSkinData {
        skin,
        joint_node_indices,
        bone_samplers,
        bone_channels,
    })
}

// ============================================================================
// Shared geometry processing for both glTF and GLB export paths
// ============================================================================

/// Intermediate result from processing all geometry objects in an LMO model.
struct LmoGeomResult {
    /// Root node index (building_root).
    root_idx: u32,
    /// All glTF animations (matrix + bone).
    animations: Vec<gltf_json::Animation>,
    /// All glTF skins (one per skinned geometry object).
    skins: Vec<gltf_json::Skin>,
}

/// Process all geometry objects from an LMO model into the GltfBuilder.
/// Shared by both `build_gltf_from_lmo` and `build_glb_from_lmo`.
fn process_lmo_geometry<'a>(
    builder: &mut GltfBuilder,
    model: &'a LmoModel,
    project_dir: &Path,
    texture_mode: TextureMode,
) -> Result<LmoGeomResult> {
    let mut child_indices = Vec::new();
    let mut animated_nodes: Vec<(u32, &'a LmoGeomObject)> = Vec::new();
    let mut skins: Vec<gltf_json::Skin> = Vec::new();
    let mut all_bone_samplers: Vec<Sampler> = Vec::new();
    let mut all_bone_channels: Vec<Channel> = Vec::new();

    for (gi, geom) in model.geom_objects.iter().enumerate() {
        let prefix = format!("geom{}", gi);
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
                    cull_mode: None,
                    tex_filename: None,
                },
                &format!("{}_default_mat", prefix),
                project_dir,
                texture_mode,
            );
        } else {
            for (mi, mat) in geom.materials.iter().enumerate() {
                build_lmo_material(
                    builder,
                    mat,
                    &format!("{}_mat{}", prefix, mi),
                    project_dir,
                    texture_mode,
                );
            }
        }

        let has_animation = geom.animation.is_some();
        let has_bone_animation = geom.bone_animation.is_some();
        let primitives = build_geom_primitives(
            builder,
            geom,
            &prefix,
            material_base_idx,
            has_animation || has_bone_animation,
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

        let skin_data = if has_bone_animation {
            build_bone_skin(builder, geom, &prefix)
        } else {
            None
        };

        let node_idx = builder.nodes.len() as u32;
        let node_extras = build_node_extras(geom, gi);
        builder.nodes.push(gltf_json::Node {
            mesh: Some(gltf_json::Index::new(mesh_idx)),
            name: Some(format!("geom_node_{}", gi)),
            extras: node_extras,
            skin: skin_data
                .as_ref()
                .map(|_| gltf_json::Index::new(skins.len() as u32)),
            ..Default::default()
        });
        child_indices.push(gltf_json::Index::new(node_idx));

        if let Some(ref sd) = skin_data {
            if let Some(ref bone_anim) = geom.bone_animation {
                let root_joints: Vec<gltf_json::Index<gltf_json::Node>> = bone_anim
                    .bones
                    .iter()
                    .enumerate()
                    .filter(|(_, b)| b.parent_id == 0xFFFFFFFF)
                    .map(|(bi, _)| gltf_json::Index::new(sd.joint_node_indices[bi]))
                    .collect();
                if !root_joints.is_empty() {
                    builder.nodes[node_idx as usize].children = Some(root_joints);
                }
            }
        }

        if has_animation {
            animated_nodes.push((node_idx, geom));
        }

        if let Some(sd) = skin_data {
            let sampler_offset = all_bone_samplers.len() as u32;
            all_bone_samplers.extend(sd.bone_samplers);
            for mut ch in sd.bone_channels {
                ch.sampler = gltf_json::Index::new(ch.sampler.value() as u32 + sampler_offset);
                all_bone_channels.push(ch);
            }
            skins.push(sd.skin);
        }
    }

    if child_indices.is_empty() {
        return Err(anyhow!("No renderable geometry in LMO file"));
    }

    let mut animations = build_animations(builder, &animated_nodes);

    if !all_bone_channels.is_empty() {
        animations.push(gltf_json::Animation {
            name: Some("BoneAnimation".to_string()),
            channels: all_bone_channels,
            samplers: all_bone_samplers,
            extensions: None,
            extras: None,
        });
    }

    let root_idx = builder.nodes.len() as u32;
    builder.nodes.push(gltf_json::Node {
        name: Some("building_root".to_string()),
        children: Some(child_indices),
        ..Default::default()
    });

    Ok(LmoGeomResult {
        root_idx,
        animations,
        skins,
    })
}

// ============================================================================
// Public API: build glTF from a single LMO file (standalone building viewer)
// ============================================================================

/// Build a complete glTF JSON string for a single LMO building model.
pub fn build_gltf_from_lmo(lmo_path: &Path, project_dir: &Path) -> Result<String> {
    let model = lmo_loader::load_lmo(lmo_path)?;

    if model.geom_objects.is_empty() {
        return Err(anyhow!("LMO file has no geometry objects"));
    }

    let mut builder = GltfBuilder::new();
    let geom_result = process_lmo_geometry(&mut builder, &model, project_dir, TextureMode::Embed)?;

    let root = gltf_json::Root {
        asset: gltf_json::Asset {
            version: "2.0".to_string(),
            generator: Some("pko-tools".to_string()),
            ..Default::default()
        },
        nodes: builder.nodes,
        scenes: vec![gltf_json::Scene {
            nodes: vec![gltf_json::Index::new(geom_result.root_idx)],
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
        animations: geom_result.animations,
        skins: geom_result.skins,
        ..Default::default()
    };

    let json = serde_json::to_string_pretty(&root)?;
    Ok(json)
}

/// Build a GLB-ready building model: returns (glTF JSON string, binary buffer).
/// Uses the same mesh/material/animation logic as `build_gltf_from_lmo`, but
/// packs all buffer data into a single binary buffer for GLB writing.
/// Build a GLB from an LMO file. When `embed_textures` is false, textures are
/// referenced via external `image.uri` paths (relative to `../textures/scene/`)
/// instead of being embedded in the GLB binary buffer.
pub fn build_glb_from_lmo(
    lmo_path: &Path,
    project_dir: &Path,
    embed_textures: bool,
) -> Result<(String, Vec<u8>)> {
    let model = lmo_loader::load_lmo(lmo_path)?;

    if model.geom_objects.is_empty() {
        return Err(anyhow!("LMO file has no geometry objects"));
    }

    let mut builder = GltfBuilder::new();
    let texture_mode = if embed_textures { TextureMode::Embed } else { TextureMode::ExternalUri };
    let geom_result = process_lmo_geometry(&mut builder, &model, project_dir, texture_mode)?;

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
            nodes: vec![gltf_json::Index::new(geom_result.root_idx)],
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
        animations: geom_result.animations,
        skins: geom_result.skins,
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

        let model = match lmo_loader::load_lmo_no_animation(&lmo_path) {
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
                    cull_mode: None,
                    tex_filename: None,
                },
                &format!("{}_mat", prefix),
                project_dir,
                TextureMode::Skip, // skip textures for map batch loading
            );
        } else {
            for (mi, mat) in geom.materials.iter().enumerate() {
                build_lmo_material(
                    builder,
                    mat,
                    &format!("{}_mat{}", prefix, mi),
                    project_dir,
                    TextureMode::Skip, // skip textures for map batch loading
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
                    cull_mode: None,
                    tex_filename: Some("wall.bmp".to_string()),
                }],
                animation: None,
                bone_animation: None,
                blend_weights: Vec::new(),
                bone_indices: Vec::new(),
                texuv_anims: Vec::new(),
                teximg_anims: Vec::new(),
                mtlopac_anims: Vec::new(),
            }],
        }
    }

    #[test]
    fn coordinate_transform_z_up_to_y_up() {
        // Game: Z-up → glTF: Y-up: (x, y, z) → (x, z, y)
        // Y is NOT negated so building Z matches terrain Z (south = positive).
        assert_eq!(transform_position([1.0, 2.0, 3.0]), [1.0, 3.0, 2.0]);
        // z_up_to_y_up_vec3 must match transform_position for consistency
        assert_eq!(z_up_to_y_up_vec3([1.0, 2.0, 3.0]), [1.0, 3.0, 2.0]);
        assert_eq!(transform_position([0.0, 0.0, 0.0]), [0.0, 0.0, 0.0]);
        assert_eq!(transform_normal([0.0, 0.0, 1.0]), [0.0, 1.0, 0.0]);
    }

    #[test]
    fn z_up_to_y_up_vec3_matches_static_transform() {
        // z_up_to_y_up_vec3 (used for animations) must produce the same Z component
        // as transform_position (used for static geometry) for any PKO Y value.
        for y in [-5.0f32, -1.0, 0.0, 1.0, 5.0, 100.0] {
            let p = [0.0, y, 0.0];
            assert_eq!(
                z_up_to_y_up_vec3(p)[2],
                transform_position(p)[2],
                "Z mismatch for PKO Y={y}"
            );
        }
    }

    #[test]
    fn animated_static_z_consistency() {
        // For a mixed model where animated and static geom share the same PKO Y offset,
        // the resulting glTF Z components must have the same sign.
        let pko_y = 5.0f32;
        let static_z = transform_position([0.0, pko_y, 0.0])[2];
        let anim_z = z_up_to_y_up_vec3([0.0, pko_y, 0.0])[2];
        assert_eq!(
            static_z.signum(),
            anim_z.signum(),
            "Static Z ({static_z}) and animated Z ({anim_z}) must have the same sign"
        );
        assert_eq!(static_z, anim_z, "Static and animated Z must be equal");
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
            cull_mode: None,
            tex_filename: None,
        };
        let mut builder = GltfBuilder::new();
        let tmp = std::env::temp_dir();
        build_lmo_material(&mut builder, &mat, "test", &tmp, TextureMode::Skip);
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
            cull_mode: None,
            tex_filename: None,
        };
        let mut builder = GltfBuilder::new();
        let tmp = std::env::temp_dir();
        build_lmo_material(&mut builder, &mat, "test", &tmp, TextureMode::Skip);
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
            cull_mode: None,
            tex_filename: None,
        };
        let mut builder = GltfBuilder::new();
        let tmp = std::env::temp_dir();
        build_lmo_material(&mut builder, &mat, "test", &tmp, TextureMode::Skip);
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
            cull_mode: None,
            tex_filename: None,
        };
        let mut builder = GltfBuilder::new();
        let tmp = std::env::temp_dir();
        build_lmo_material(&mut builder, &mat, "test_type9", &tmp, TextureMode::Skip);
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
            cull_mode: None,
            tex_filename: None,
        };
        let mut builder = GltfBuilder::new();
        let tmp = std::env::temp_dir();
        build_lmo_material(&mut builder, &mat, "tree_leaf", &tmp, TextureMode::Skip);
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
            build_lmo_material(&mut builder, mat, &format!("mat{}", mi), &tmp, TextureMode::Skip);
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
                ..Default::default()
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
    // Animation export tests
    // ====================================================================

    /// Create a test model with one static geom and one animated geom.
    fn make_animated_test_model() -> LmoModel {
        let static_geom = LmoGeomObject {
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
            normals: vec![[0.0, 0.0, 1.0]; 3],
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
                cull_mode: None,
                tex_filename: None,
            }],
            animation: None,
            bone_animation: None,
            blend_weights: Vec::new(),
            bone_indices: Vec::new(),
            texuv_anims: Vec::new(),
            teximg_anims: Vec::new(),
            mtlopac_anims: Vec::new(),
        };

        let mut animated_geom = static_geom.clone();
        animated_geom.id = 2;
        animated_geom.animation = Some(lmo::LmoAnimData {
            frame_num: 3,
            translations: vec![[0.0, 0.0, 0.0], [1.0, 0.0, 0.0], [2.0, 0.0, 0.0]],
            rotations: vec![[0.0, 0.0, 0.0, 1.0]; 3],
        });

        LmoModel {
            version: 0x1005,
            geom_objects: vec![static_geom, animated_geom],
        }
    }

    #[test]
    fn build_animations_produces_channels_for_animated_nodes() {
        let model = make_animated_test_model();
        let mut builder = GltfBuilder::new();

        // Simulate what build_gltf_from_lmo does: collect animated nodes
        let animated_nodes: Vec<(u32, &LmoGeomObject)> = model
            .geom_objects
            .iter()
            .enumerate()
            .filter(|(_, g)| g.animation.is_some())
            .map(|(i, g)| (i as u32, g))
            .collect();

        let anims = build_animations(&mut builder, &animated_nodes);

        assert_eq!(anims.len(), 1, "should produce exactly one Animation");
        let anim = &anims[0];
        // Each animated node gets 2 channels (translation + rotation)
        assert_eq!(anim.channels.len(), 2, "should have translation + rotation channels");
        assert_eq!(anim.samplers.len(), 2, "should have translation + rotation samplers");
    }

    #[test]
    fn build_animations_empty_for_static_only_model() {
        let mut builder = GltfBuilder::new();
        let animated_nodes: Vec<(u32, &LmoGeomObject)> = vec![];

        let anims = build_animations(&mut builder, &animated_nodes);
        assert!(anims.is_empty(), "static-only model should produce no animations");
    }

    #[test]
    fn build_anim_extras_includes_transform_anim_and_geom_index() {
        let model = make_animated_test_model();
        let animated_geom = &model.geom_objects[1];

        let extras = build_anim_extras(animated_geom, 5);
        assert!(extras.is_some(), "animated geom should produce extras");

        let json_str = extras.unwrap().to_string();
        let parsed: serde_json::Value = serde_json::from_str(&json_str).unwrap();

        assert_eq!(parsed["geom_index"], 5, "geom_index should match the gi parameter");
        assert!(parsed["transform_anim"].is_object(), "should have transform_anim");
        assert_eq!(parsed["transform_anim"]["frame_num"], 3);
        assert_eq!(parsed["transform_anim"]["frame_rate"], 30.0);
        assert_eq!(
            parsed["transform_anim"]["translations"].as_array().unwrap().len(),
            3
        );
        assert_eq!(
            parsed["transform_anim"]["rotations"].as_array().unwrap().len(),
            3
        );
    }

    #[test]
    fn build_anim_extras_none_for_static_geom() {
        let model = make_test_model();
        let static_geom = &model.geom_objects[0];

        let extras = build_anim_extras(static_geom, 0);
        assert!(extras.is_none(), "static geom with no anims should produce None");
    }

    #[test]
    fn build_node_extras_always_includes_primitive_id() {
        let model = make_test_model();
        let static_geom = &model.geom_objects[0];

        // Even a static geom with no anims should get pko_primitive_id
        let extras = build_node_extras(static_geom, 7);
        assert!(extras.is_some(), "node extras should always be Some (has pko_primitive_id)");

        let parsed: serde_json::Value = serde_json::from_str(&extras.unwrap().to_string()).unwrap();
        assert_eq!(parsed["pko_primitive_id"], 7);
    }

    #[test]
    fn build_node_extras_merges_anim_and_primitive_id() {
        let model = make_animated_test_model();
        let animated_geom = &model.geom_objects[1];

        let extras = build_node_extras(animated_geom, 3);
        assert!(extras.is_some());

        let parsed: serde_json::Value = serde_json::from_str(&extras.unwrap().to_string()).unwrap();
        // Should have both pko_primitive_id AND animation data
        assert_eq!(parsed["pko_primitive_id"], 3);
        assert!(parsed["transform_anim"].is_object(), "should still have transform_anim");
        assert_eq!(parsed["geom_index"], 3);
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
                cull_mode: None,
                tex_filename: None,
            };
            let mut builder = GltfBuilder::new();
            build_lmo_material(&mut builder, &mat, "test", &tmp, TextureMode::Skip);
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
            cull_mode: None,
            tex_filename: None,
        };
        let mut builder = GltfBuilder::new();
        let tmp = std::env::temp_dir();
        build_lmo_material(&mut builder, &mat, "glow", &tmp, TextureMode::Skip);
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
            cull_mode: None,
            tex_filename: None,
        };
        let mut builder = GltfBuilder::new();
        let tmp = std::env::temp_dir();
        build_lmo_material(&mut builder, &mat, "sparkle", &tmp, TextureMode::Skip);
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
            cull_mode: None,
            tex_filename: None,
        };
        let mut builder = GltfBuilder::new();
        let tmp = std::env::temp_dir();
        build_lmo_material(&mut builder, &mat, "wall", &tmp, TextureMode::Skip);
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
            cull_mode: None,
            tex_filename: None,
        };
        let mut builder = GltfBuilder::new();
        let tmp = std::env::temp_dir();
        build_lmo_material(&mut builder, &mat, "tree", &tmp, TextureMode::Skip);
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
            cull_mode: None,
            tex_filename: None,
        };
        let mut builder = GltfBuilder::new();
        let tmp = std::env::temp_dir();
        build_lmo_material(&mut builder, &mat, "shadow", &tmp, TextureMode::Skip);
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

    // ---- C2: Type 0 partial opacity tests ----

    #[test]
    fn build_material_type0_partial_opacity_gets_suffix() {
        // C2 fix: Type 0 (FILTER) with opacity < 1.0 should get __PKO_T0_A0_O{n}
        // so Unity routes it to TOP/Effect with SrcAlpha/InvSrcAlpha blend.
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
            cull_mode: None,
            tex_filename: None,
        };
        let mut builder = GltfBuilder::new();
        let tmp = std::env::temp_dir();
        build_lmo_material(&mut builder, &mat, "glass", &tmp, TextureMode::Skip);
        let gltf_mat = &builder.materials[0];
        let name = gltf_mat.name.as_ref().unwrap();
        // opacity 0.5 * 255 = 127.5 → 128
        assert!(
            name.contains("__PKO_T0_A0_O128"),
            "type 0 partial opacity should have suffix T0_A0_O128, got: {}",
            name
        );
        // Should use Blend alpha mode (not Opaque)
        assert_eq!(
            gltf_mat.alpha_mode,
            Checked::Valid(gltf_json::material::AlphaMode::Blend),
            "type 0 partial opacity should use Blend alpha mode"
        );
    }

    #[test]
    fn build_material_type0_partial_opacity_with_alpha_test() {
        // C2 + M4: Type 0 with both partial opacity AND alpha test
        // The ALPHAREF should be scaled: min(opacity * alphaRef, 129)
        let mat = lmo::LmoMaterial {
            diffuse: [0.5, 0.6, 0.7, 1.0],
            ambient: [0.1, 0.1, 0.1, 1.0],
            emissive: [0.0, 0.0, 0.0, 0.0],
            opacity: 0.7,
            transp_type: 0,
            alpha_test_enabled: true,
            alpha_ref: 129,
            src_blend: None,
            dest_blend: None,
            cull_mode: None,
            tex_filename: None,
        };
        let mut builder = GltfBuilder::new();
        let tmp = std::env::temp_dir();
        build_lmo_material(&mut builder, &mat, "fence", &tmp, TextureMode::Skip);
        let gltf_mat = &builder.materials[0];
        let name = gltf_mat.name.as_ref().unwrap();
        // opacity 0.7 * 255 = 178.5 → 179
        assert!(
            name.contains("__PKO_T0_A129_O179"),
            "type 0 with alpha test + partial opacity should encode both, got: {}",
            name
        );
    }

    #[test]
    fn build_material_type0_full_opacity_still_no_suffix() {
        // Regression: full opacity (1.0) type 0 without alpha test → no suffix
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
            cull_mode: None,
            tex_filename: None,
        };
        let mut builder = GltfBuilder::new();
        let tmp = std::env::temp_dir();
        build_lmo_material(&mut builder, &mat, "stone", &tmp, TextureMode::Skip);
        let gltf_mat = &builder.materials[0];
        let name = gltf_mat.name.as_ref().unwrap();
        assert!(
            !name.contains("__PKO_"),
            "type 0 full opacity should have no suffix, got: {}",
            name
        );
    }

    // ====================================================================
    // GLB index buffer integrity tests
    // ====================================================================

    /// Helper: write an LmoModel to a temp LMO file and return its path.
    fn write_temp_lmo(model: &LmoModel, dir: &Path, name: &str) -> std::path::PathBuf {
        let lmo_path = dir.join(name);
        let mut data = Vec::new();
        data.extend_from_slice(&model.version.to_le_bytes());
        let obj_count = model.geom_objects.len() as u32;
        data.extend_from_slice(&obj_count.to_le_bytes());

        // Build all geom blobs first to compute header entries
        let blobs: Vec<Vec<u8>> = model
            .geom_objects
            .iter()
            .map(|g| build_test_geom_blob(g))
            .collect();

        // Header table: 4 (version) + 4 (count) + obj_count * 12 (entries)
        let header_end = 4 + 4 + model.geom_objects.len() * 12;
        let mut offset = header_end;
        for blob in &blobs {
            data.extend_from_slice(&1u32.to_le_bytes()); // type = GEOMETRY
            data.extend_from_slice(&(offset as u32).to_le_bytes());
            data.extend_from_slice(&(blob.len() as u32).to_le_bytes());
            offset += blob.len();
        }
        for blob in &blobs {
            data.extend_from_slice(blob);
        }

        std::fs::write(&lmo_path, &data).unwrap();
        lmo_path
    }

    /// Helper: parse GLB binary, extract JSON and BIN chunks.
    fn parse_glb(glb: &[u8]) -> (serde_json::Value, Vec<u8>) {
        assert!(glb.len() >= 12, "GLB too short");
        assert_eq!(&glb[0..4], b"glTF", "not a GLB");
        let json_len = u32::from_le_bytes(glb[12..16].try_into().unwrap()) as usize;
        let json_data = &glb[20..20 + json_len];
        let bin_offset = 20 + json_len;
        let bin_len = u32::from_le_bytes(glb[bin_offset..bin_offset + 4].try_into().unwrap()) as usize;
        let bin_data = glb[bin_offset + 8..bin_offset + 8 + bin_len].to_vec();
        let parsed: serde_json::Value = serde_json::from_slice(json_data).unwrap();
        (parsed, bin_data)
    }

    /// Helper: extract index values from GLB binary using the accessor/bufferView metadata.
    fn extract_indices(json: &serde_json::Value, bin: &[u8], accessor_idx: usize) -> Vec<u32> {
        let acc = &json["accessors"][accessor_idx];
        let bv_idx = acc["bufferView"].as_u64().unwrap() as usize;
        let bv = &json["bufferViews"][bv_idx];
        let byte_offset = bv["byteOffset"].as_u64().unwrap_or(0) as usize
            + acc["byteOffset"].as_u64().unwrap_or(0) as usize;
        let count = acc["count"].as_u64().unwrap() as usize;
        let comp_type = acc["componentType"].as_u64().unwrap();

        match comp_type {
            5123 => {
                // UNSIGNED_SHORT
                (0..count)
                    .map(|i| {
                        let off = byte_offset + i * 2;
                        u16::from_le_bytes(bin[off..off + 2].try_into().unwrap()) as u32
                    })
                    .collect()
            }
            5125 => {
                // UNSIGNED_INT
                (0..count)
                    .map(|i| {
                        let off = byte_offset + i * 4;
                        u32::from_le_bytes(bin[off..off + 4].try_into().unwrap())
                    })
                    .collect()
            }
            _ => panic!("unexpected componentType {}", comp_type),
        }
    }

    /// Helper: serialize GLB from JSON string + binary data.
    fn build_glb_bytes(json_str: &str, bin: &[u8]) -> Vec<u8> {
        let json_bytes = json_str.as_bytes();
        // Pad JSON to 4-byte alignment
        let json_pad = (4 - (json_bytes.len() % 4)) % 4;
        let json_chunk_len = json_bytes.len() + json_pad;
        // Pad BIN to 4-byte alignment
        let bin_pad = (4 - (bin.len() % 4)) % 4;
        let bin_chunk_len = bin.len() + bin_pad;

        let total = 12 + 8 + json_chunk_len + 8 + bin_chunk_len;
        let mut out = Vec::with_capacity(total);
        out.extend_from_slice(b"glTF");
        out.extend_from_slice(&2u32.to_le_bytes());
        out.extend_from_slice(&(total as u32).to_le_bytes());
        // JSON chunk
        out.extend_from_slice(&(json_chunk_len as u32).to_le_bytes());
        out.extend_from_slice(&0x4E4F534Au32.to_le_bytes()); // "JSON"
        out.extend_from_slice(json_bytes);
        out.extend(std::iter::repeat(0x20u8).take(json_pad));
        // BIN chunk
        out.extend_from_slice(&(bin_chunk_len as u32).to_le_bytes());
        out.extend_from_slice(&0x004E4942u32.to_le_bytes()); // "BIN\0"
        out.extend_from_slice(bin);
        out.extend(std::iter::repeat(0u8).take(bin_pad));
        out
    }

    /// Make a test model with multiple geometry objects, optionally with vertex colors.
    fn make_multi_geom_model(geom_count: usize, with_vertex_colors: bool) -> LmoModel {
        let mut geom_objects = Vec::new();
        for gi in 0..geom_count {
            let vert_count = 4;
            let vertices = vec![
                [gi as f32, 0.0, 0.0],
                [gi as f32 + 1.0, 0.0, 0.0],
                [gi as f32, 1.0, 0.0],
                [gi as f32 + 1.0, 1.0, 0.0],
            ];
            let normals = vec![[0.0, 0.0, 1.0]; vert_count];
            let texcoords = vec![[0.0, 0.0], [1.0, 0.0], [0.0, 1.0], [1.0, 1.0]];
            let vertex_colors = if with_vertex_colors {
                // D3DCOLOR: 0xAARRGGBB
                vec![0xFFFF0000; vert_count] // opaque red
            } else {
                vec![]
            };
            // Two triangles: (0,1,2), (1,3,2)
            let indices = vec![0, 1, 2, 1, 3, 2];

            geom_objects.push(LmoGeomObject {
                id: (gi + 1) as u32,
                parent_id: 0xFFFFFFFF,
                obj_type: 0,
                mat_local: [
                    [1.0, 0.0, 0.0, 0.0],
                    [0.0, 1.0, 0.0, 0.0],
                    [0.0, 0.0, 1.0, 0.0],
                    [0.0, 0.0, 0.0, 1.0],
                ],
                vertices,
                normals,
                texcoords,
                vertex_colors,
                indices,
                subsets: vec![lmo::LmoSubset {
                    primitive_num: 2,
                    start_index: 0,
                    vertex_num: vert_count as u32,
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
                    cull_mode: None,
                    tex_filename: None,
                }],
                animation: None,
                bone_animation: None,
                blend_weights: Vec::new(),
                bone_indices: Vec::new(),
                texuv_anims: Vec::new(),
                teximg_anims: Vec::new(),
                mtlopac_anims: Vec::new(),
            });
        }
        LmoModel {
            version: 0x1005,
            geom_objects,
        }
    }

    /// Validate that all index values in a GLB are within vertex count bounds.
    /// Returns a list of (mesh_name, bad_index_value, vertex_count) for any failures.
    fn validate_glb_indices(json: &serde_json::Value, bin: &[u8]) -> Vec<(String, u32, u64)> {
        let mut errors = Vec::new();
        let meshes = json["meshes"].as_array().unwrap();
        for mesh in meshes {
            let mesh_name = mesh["name"].as_str().unwrap_or("?").to_string();
            for prim in mesh["primitives"].as_array().unwrap() {
                let idx_acc = prim["indices"].as_u64().unwrap() as usize;
                let pos_acc = prim["attributes"]["POSITION"].as_u64().unwrap() as usize;
                let vert_count = json["accessors"][pos_acc]["count"].as_u64().unwrap();

                let indices = extract_indices(json, bin, idx_acc);
                for &idx in &indices {
                    if idx as u64 >= vert_count {
                        errors.push((mesh_name.clone(), idx, vert_count));
                        break; // one error per mesh is enough
                    }
                }
            }
        }
        errors
    }

    #[test]
    fn glb_index_integrity_without_vertex_colors() {
        let tmp_dir = std::env::temp_dir().join("pko_test_glb_idx_no_color");
        let _ = std::fs::create_dir_all(&tmp_dir);

        let model = make_multi_geom_model(4, false);
        let lmo_path = write_temp_lmo(&model, &tmp_dir, "no_colors.lmo");

        let (json_str, bin) = build_glb_from_lmo(&lmo_path, &tmp_dir, true).unwrap();
        let glb = build_glb_bytes(&json_str, &bin);
        let (json, bin_data) = parse_glb(&glb);

        let errors = validate_glb_indices(&json, &bin_data);
        assert!(
            errors.is_empty(),
            "GLB without vertex colors should have valid indices, got errors: {:?}",
            errors
        );

        let _ = std::fs::remove_dir_all(&tmp_dir);
    }

    #[test]
    fn glb_index_integrity_with_vertex_colors() {
        let tmp_dir = std::env::temp_dir().join("pko_test_glb_idx_with_color");
        let _ = std::fs::create_dir_all(&tmp_dir);

        let model = make_multi_geom_model(4, true);
        let lmo_path = write_temp_lmo(&model, &tmp_dir, "with_colors.lmo");

        let (json_str, bin) = build_glb_from_lmo(&lmo_path, &tmp_dir, true).unwrap();
        let glb = build_glb_bytes(&json_str, &bin);
        let (json, bin_data) = parse_glb(&glb);

        let errors = validate_glb_indices(&json, &bin_data);
        assert!(
            errors.is_empty(),
            "GLB with vertex colors should have valid indices, got errors: {:?}",
            errors
        );

        let _ = std::fs::remove_dir_all(&tmp_dir);
    }

    #[test]
    fn glb_index_integrity_mixed_color_geoms() {
        // Model where some geom objects have vertex colors and others don't —
        // this is the pattern most likely to trigger buffer offset misalignment.
        let tmp_dir = std::env::temp_dir().join("pko_test_glb_idx_mixed");
        let _ = std::fs::create_dir_all(&tmp_dir);

        let mut model = make_multi_geom_model(4, false);
        // Add vertex colors to geom 1 and 3 only
        model.geom_objects[1].vertex_colors = vec![0xFFFF0000; 4];
        model.geom_objects[3].vertex_colors = vec![0xFF00FF00; 4];

        let lmo_path = write_temp_lmo(&model, &tmp_dir, "mixed_colors.lmo");

        let (json_str, bin) = build_glb_from_lmo(&lmo_path, &tmp_dir, true).unwrap();
        let glb = build_glb_bytes(&json_str, &bin);
        let (json, bin_data) = parse_glb(&glb);

        let errors = validate_glb_indices(&json, &bin_data);
        assert!(
            errors.is_empty(),
            "GLB with mixed vertex colors should have valid indices, got errors: {:?}",
            errors
        );

        let _ = std::fs::remove_dir_all(&tmp_dir);
    }

    /// Test against actual building GLB files on disk (skipped if not present).
    /// This test validates that the exporter produces correct index buffers.
    /// Any failure here means the GLB has corrupt indices — the index data region
    /// contains vertex float data instead of triangle indices.
    #[test]
    fn real_glb_buildings_have_valid_indices() {
        let buildings_dir = std::path::Path::new(
            "../../client-unity/pko-client/Assets/Maps/Shared/buildings",
        );
        if !buildings_dir.exists() {
            return; // skip if building files not available
        }

        let mut total = 0;
        let mut corrupt = Vec::new();

        for entry in std::fs::read_dir(buildings_dir).unwrap() {
            let entry = entry.unwrap();
            let path = entry.path();
            if path.extension().map(|e| e == "glb").unwrap_or(false) {
                total += 1;
                let glb = std::fs::read(&path).unwrap();
                if glb.len() < 20 || &glb[0..4] != b"glTF" {
                    continue;
                }
                let (json, bin_data) = parse_glb(&glb);
                let errors = validate_glb_indices(&json, &bin_data);
                if !errors.is_empty() {
                    let name = path.file_name().unwrap().to_string_lossy().to_string();
                    corrupt.push((name, errors));
                }
            }
        }

        assert!(
            corrupt.is_empty(),
            "Found {} corrupt GLBs out of {} total:\n{}",
            corrupt.len(),
            total,
            corrupt
                .iter()
                .map(|(name, errs)| format!(
                    "  {}: mesh '{}' has index {} but only {} vertices",
                    name, errs[0].0, errs[0].1, errs[0].2
                ))
                .collect::<Vec<_>>()
                .join("\n")
        );
    }

    /// Reproduce the index corruption bug by round-tripping a known-corrupt LMO
    /// through build_glb_from_lmo and checking the output (skipped if not present).
    #[test]
    fn real_lmo_roundtrip_produces_valid_glb_indices() {
        let lmo_candidates = [
            "../../top-client/model/scene/nml-bd167.lmo",
            "../top-client/model/scene/nml-bd167.lmo",
        ];
        let lmo_path = lmo_candidates
            .iter()
            .map(std::path::Path::new)
            .find(|p| p.exists());

        let Some(lmo_path) = lmo_path else {
            return; // skip if LMO source not available
        };

        let project_dir = lmo_path.parent().unwrap().parent().unwrap();
        let (json_str, bin) = build_glb_from_lmo(lmo_path, project_dir, true).unwrap();
        let glb = build_glb_bytes(&json_str, &bin);
        let (json, bin_data) = parse_glb(&glb);

        let errors = validate_glb_indices(&json, &bin_data);
        assert!(
            errors.is_empty(),
            "Round-tripped nml-bd167.lmo should produce valid GLB indices, got errors: {:?}",
            errors
        );
    }

    /// Verify that parsing nml-bd167.lmo (which has FVF=0x1118 with blend data)
    /// produces valid index values after the lwBlendInfo size fix.
    #[test]
    fn real_lmo_parse_produces_valid_indices() {
        let lmo_candidates = [
            "../../top-client/model/scene/nml-bd167.lmo",
            "../top-client/model/scene/nml-bd167.lmo",
        ];
        let lmo_path = lmo_candidates
            .iter()
            .map(std::path::Path::new)
            .find(|p| p.exists());

        let Some(lmo_path) = lmo_path else {
            return;
        };

        let model = super::lmo_loader::load_lmo(lmo_path).unwrap();
        for (gi, geom) in model.geom_objects.iter().enumerate() {
            let vert_count = geom.vertices.len();
            let max_idx = geom.indices.iter().copied().max().unwrap_or(0);
            assert!(
                (max_idx as usize) < vert_count,
                "geom[{}]: max index {} >= vertex count {} — LMO parser read indices from wrong offset",
                gi, max_idx, vert_count
            );
        }
    }

    // ========================================================================
    // DDS decode tests (DXT1 alpha preservation)
    // ========================================================================

    /// Build a minimal synthetic DDS file with DXT1 compression.
    /// `width` and `height` must be multiples of 4. `block_data` is the raw compressed blocks.
    fn build_dxt1_dds(width: u32, height: u32, block_data: &[u8]) -> Vec<u8> {
        build_dds(width, height, FOURCC_DXT1, block_data)
    }

    fn build_dds(width: u32, height: u32, fourcc: u32, block_data: &[u8]) -> Vec<u8> {
        let mut file = Vec::with_capacity(128 + block_data.len());

        // Magic
        file.extend_from_slice(b"DDS ");

        // DDS_HEADER (124 bytes)
        file.extend_from_slice(&124u32.to_le_bytes()); // dwSize
        file.extend_from_slice(&0x81007u32.to_le_bytes()); // dwFlags
        file.extend_from_slice(&height.to_le_bytes()); // dwHeight
        file.extend_from_slice(&width.to_le_bytes()); // dwWidth
        file.extend_from_slice(&(block_data.len() as u32).to_le_bytes()); // dwPitchOrLinearSize
        file.extend_from_slice(&0u32.to_le_bytes()); // dwDepth
        file.extend_from_slice(&1u32.to_le_bytes()); // dwMipMapCount
        // dwReserved1[11]
        for _ in 0..11 {
            file.extend_from_slice(&0u32.to_le_bytes());
        }
        // DDS_PIXELFORMAT (32 bytes)
        file.extend_from_slice(&32u32.to_le_bytes()); // dwSize
        file.extend_from_slice(&0x4u32.to_le_bytes()); // dwFlags = DDPF_FOURCC
        file.extend_from_slice(&fourcc.to_le_bytes()); // dwFourCC
        file.extend_from_slice(&0u32.to_le_bytes()); // dwRGBBitCount
        for _ in 0..4 {
            file.extend_from_slice(&0u32.to_le_bytes()); // RGBA masks
        }
        // Caps
        file.extend_from_slice(&0x1000u32.to_le_bytes()); // dwCaps = TEXTURE
        for _ in 0..4 {
            file.extend_from_slice(&0u32.to_le_bytes()); // dwCaps2-4 + dwReserved2
        }

        assert_eq!(file.len(), 128, "DDS header must be exactly 128 bytes");

        // Compressed data
        file.extend_from_slice(block_data);
        file
    }

    #[test]
    fn dxt1_alpha_preservation_punch_through() {
        // Build a single 4x4 DXT1 block with punch-through alpha.
        // When color0 <= color1, index 3 = transparent black.
        //
        // color0 = 0x0000 (black, RGB565)
        // color1 = 0xFFFF (white, RGB565)
        // Since color0 (0) < color1 (0xFFFF), this is punch-through mode.
        // Index bits: all 0b11 = index 3 = transparent for all 16 pixels.
        let mut block = [0u8; 8];
        block[0] = 0x00; block[1] = 0x00; // color0 = 0 (black)
        block[2] = 0xFF; block[3] = 0xFF; // color1 = 0xFFFF (white)
        // All pixels = index 3 (0b11 repeated 16 times = 0xFFFFFFFF)
        block[4] = 0xFF;
        block[5] = 0xFF;
        block[6] = 0xFF;
        block[7] = 0xFF;

        let dds = build_dxt1_dds(4, 4, &block);
        let img = decode_dds_with_alpha(&dds).expect("should decode DXT1 DDS");
        let rgba = img.to_rgba8();

        assert_eq!(rgba.width(), 4);
        assert_eq!(rgba.height(), 4);

        // All 16 pixels should have alpha=0 (transparent)
        let transparent_count = rgba.pixels().filter(|p| p.0[3] == 0).count();
        assert_eq!(
            transparent_count, 16,
            "all pixels with index 3 in punch-through mode should be transparent, got {} transparent",
            transparent_count
        );
    }

    #[test]
    fn dxt1_opaque_no_unexpected_holes() {
        // Build a 4x4 DXT1 block in opaque mode (color0 > color1).
        // All indices = 0 → all pixels = color0.
        //
        // color0 = 0xF800 (bright red, RGB565)
        // color1 = 0x001F (bright blue, RGB565)
        // Since color0 (0xF800) > color1 (0x001F), this is 4-color opaque mode.
        let mut block = [0u8; 8];
        block[0] = 0x00; block[1] = 0xF8; // color0 = 0xF800 (red)
        block[2] = 0x1F; block[3] = 0x00; // color1 = 0x001F (blue)
        // All pixels = index 0 → color0 (red)
        block[4] = 0x00;
        block[5] = 0x00;
        block[6] = 0x00;
        block[7] = 0x00;

        let dds = build_dxt1_dds(4, 4, &block);
        let img = decode_dds_with_alpha(&dds).expect("should decode opaque DXT1 DDS");
        let rgba = img.to_rgba8();

        // All 16 pixels should have alpha=255 (fully opaque)
        let opaque_count = rgba.pixels().filter(|p| p.0[3] == 255).count();
        assert_eq!(
            opaque_count, 16,
            "opaque DXT1 block should have all pixels alpha=255, got {} opaque",
            opaque_count
        );

        // First pixel should be red-ish (R high, G low, B low)
        let p = rgba.get_pixel(0, 0).0;
        assert!(p[0] > 200, "red channel should be high, got R={} G={} B={} A={}", p[0], p[1], p[2], p[3]);
        assert!(p[1] < 10, "green channel should be low, got {}", p[1]);
        assert!(p[2] < 10, "blue channel should be low, got {}", p[2]);
    }

    #[test]
    fn non_dds_falls_through_to_image_crate() {
        // Create a tiny 1x1 PNG in memory
        let mut png_data = Vec::new();
        let img = image::RgbaImage::from_pixel(1, 1, image::Rgba([255, 0, 128, 200]));
        image::DynamicImage::ImageRgba8(img)
            .write_to(
                &mut std::io::Cursor::new(&mut png_data),
                image::ImageFormat::Png,
            )
            .unwrap();

        let result = decode_dds_with_alpha(&png_data).expect("should decode PNG via fallback");
        let rgba = result.to_rgba8();
        let p = rgba.get_pixel(0, 0).0;
        assert_eq!(p, [255, 0, 128, 200], "PNG pixel should round-trip exactly");
    }

    #[test]
    fn truncated_dds_returns_none() {
        // DDS magic but truncated header
        let data = b"DDS short";
        assert!(
            decode_dds_with_alpha(data).is_none(),
            "truncated DDS should return None"
        );
    }

    #[test]
    fn dxt1_mixed_opaque_and_transparent_pixels() {
        // 4x4 block: top-left 4 pixels = opaque (index 0), bottom-right 4 = transparent (index 3)
        // Punch-through mode: color0 <= color1
        //
        // color0 = 0x07E0 (green, RGB565) = 0xE0, 0x07
        // color1 = 0xFFFF (white) = 0xFF, 0xFF
        // color0 (0x07E0) < color1 (0xFFFF) → punch-through mode
        //
        // Row layout (4 pixels per row, 2 bits each = 1 byte per row):
        // Row 0: 0,0,0,0 → 0b00_00_00_00 = 0x00
        // Row 1: 0,0,0,0 → 0x00
        // Row 2: 3,3,3,3 → 0b11_11_11_11 = 0xFF
        // Row 3: 3,3,3,3 → 0xFF
        let block: [u8; 8] = [
            0xE0, 0x07, // color0 = green
            0xFF, 0xFF, // color1 = white
            0x00, // row 0: all index 0 (color0 = green, opaque)
            0x00, // row 1: all index 0
            0xFF, // row 2: all index 3 (transparent)
            0xFF, // row 3: all index 3
        ];

        let dds = build_dxt1_dds(4, 4, &block);
        let img = decode_dds_with_alpha(&dds).expect("decode mixed block");
        let rgba = img.to_rgba8();

        // Top half: opaque
        for y in 0..2 {
            for x in 0..4 {
                let a = rgba.get_pixel(x, y).0[3];
                assert_eq!(a, 255, "pixel ({},{}) should be opaque, got alpha={}", x, y, a);
            }
        }
        // Bottom half: transparent
        for y in 2..4 {
            for x in 0..4 {
                let a = rgba.get_pixel(x, y).0[3];
                assert_eq!(a, 0, "pixel ({},{}) should be transparent, got alpha={}", x, y, a);
            }
        }
    }

    #[test]
    fn dxt3_falls_through_to_image_crate() {
        // DXT3 (BC2): 16 bytes per block = 8 bytes explicit alpha + 8 bytes DXT1 color
        // Build a 4x4 DXT3 DDS with half-alpha (0x88 per pixel = ~53% alpha)
        let mut block = [0u8; 16];
        // Alpha section: 4 bits per pixel, 16 pixels = 8 bytes
        // All pixels get alpha nibble 0x8 = 128/255 ≈ 50%
        for i in 0..8 {
            block[i] = 0x88; // two nibbles per byte, each 0x8
        }
        // Color section: color0 > color1 (opaque mode), all index 0 = white
        block[8] = 0xFF; block[9] = 0xFF; // color0 = white
        block[10] = 0x00; block[11] = 0x00; // color1 = black
        // All indices 0
        block[12] = 0x00; block[13] = 0x00; block[14] = 0x00; block[15] = 0x00;

        let dds = build_dds(4, 4, FOURCC_DXT3, &block);
        // DXT3 falls through to image crate — should decode with alpha preserved
        let img = decode_dds_with_alpha(&dds).expect("DXT3 should decode via image crate");
        let rgba = img.to_rgba8();
        assert_eq!(rgba.width(), 4);
        assert_eq!(rgba.height(), 4);

        // All pixels should have partial alpha (not 255, not 0)
        for pixel in rgba.pixels() {
            let a = pixel.0[3];
            assert!(
                a > 100 && a < 200,
                "DXT3 pixel alpha should be ~128, got {}",
                a
            );
        }
    }

    #[test]
    fn dxt5_falls_through_to_image_crate() {
        // DXT5 (BC3): 16 bytes per block = 2 bytes alpha endpoints + 6 bytes alpha indices + 8 bytes color
        // Build a 4x4 DXT5 DDS — alpha0=255, alpha1=0, all indices=0 → all alpha=255
        let mut block = [0u8; 16];
        block[0] = 255; // alpha0
        block[1] = 0;   // alpha1
        // Alpha indices: all 0 (3 bits each, 16 pixels = 48 bits = 6 bytes, all zero)
        // block[2..8] already zeroed
        // Color: white, all indices 0
        block[8] = 0xFF; block[9] = 0xFF; // color0 = white
        block[10] = 0x00; block[11] = 0x00; // color1 = black
        // Color indices: all 0
        block[12] = 0x00; block[13] = 0x00; block[14] = 0x00; block[15] = 0x00;

        let dds = build_dds(4, 4, FOURCC_DXT5, &block);
        let img = decode_dds_with_alpha(&dds).expect("DXT5 should decode via image crate");
        let rgba = img.to_rgba8();
        assert_eq!(rgba.width(), 4);
        assert_eq!(rgba.height(), 4);

        // All pixels should be fully opaque (alpha0=255, all indices point to alpha0)
        for pixel in rgba.pixels() {
            assert_eq!(
                pixel.0[3], 255,
                "DXT5 pixel with alpha0=255, idx=0 should be opaque, got alpha={}",
                pixel.0[3]
            );
        }
    }

    #[test]
    fn opaque_material_ignores_texture_alpha() {
        // Verify that build_lmo_material produces alphaMode: Opaque when
        // alpha_test_enabled=false, even if a texture might have alpha.
        // This ensures DXT1 garbage alpha in opaque materials is harmless.
        let mat = lmo::LmoMaterial {
            diffuse: [1.0, 1.0, 1.0, 1.0],
            ambient: [0.3, 0.3, 0.3, 1.0],
            emissive: [0.0, 0.0, 0.0, 0.0],
            opacity: 1.0,
            transp_type: 0,          // FILTER (non-effect)
            alpha_test_enabled: false, // NOT alpha tested
            alpha_ref: 0,
            src_blend: None,
            dest_blend: None,
            cull_mode: None,
            tex_filename: Some("might_have_alpha.dds".to_string()),
        };
        let mut builder = GltfBuilder::new();
        let tmp = std::env::temp_dir();
        build_lmo_material(&mut builder, &mat, "opaque_wall", &tmp, TextureMode::Skip);
        let gltf_mat = &builder.materials[0];

        assert_eq!(
            gltf_mat.alpha_mode,
            Checked::Valid(gltf_json::material::AlphaMode::Opaque),
            "opaque material (no alpha test, no effect, opacity=1) must be Opaque"
        );
        assert!(
            gltf_mat.alpha_cutoff.is_none(),
            "opaque material should have no alpha cutoff"
        );
    }

    #[test]
    fn synthetic_dxt1_deterministic_fixture() {
        // Deterministic 8x8 DXT1 image (4 blocks arranged in 2x2 grid).
        // Each block has a known pattern:
        //
        // Block (0,0) — top-left: opaque red (color0=red > color1=black, all idx 0)
        // Block (1,0) — top-right: opaque blue (color0=blue > color1=black, all idx 0)
        // Block (0,1) — bottom-left: all transparent (punch-through, all idx 3)
        // Block (1,1) — bottom-right: opaque green (color0=green > color1=black, all idx 0)

        let red_block: [u8; 8] = [
            0x00, 0xF8, // color0 = 0xF800 (red RGB565)
            0x00, 0x00, // color1 = 0x0000 (black)
            0x00, 0x00, 0x00, 0x00, // all index 0 → color0
        ];
        let blue_block: [u8; 8] = [
            0x1F, 0x00, // color0 = 0x001F (blue RGB565)
            0x00, 0x00, // color1 = 0x0000 (black)
            0x00, 0x00, 0x00, 0x00,
        ];
        let transparent_block: [u8; 8] = [
            0x00, 0x00, // color0 = 0
            0xFF, 0xFF, // color1 = 0xFFFF (color0 < color1 → punch-through)
            0xFF, 0xFF, 0xFF, 0xFF, // all index 3 → transparent
        ];
        let green_block: [u8; 8] = [
            0xE0, 0x07, // color0 = 0x07E0 (green RGB565)
            0x00, 0x00, // color1 = 0x0000
            0x00, 0x00, 0x00, 0x00,
        ];

        // DXT1 block layout for 8x8: blocks stored row-major
        // Row 0: block(0,0), block(1,0)
        // Row 1: block(0,1), block(1,1)
        let mut blocks = Vec::new();
        blocks.extend_from_slice(&red_block);
        blocks.extend_from_slice(&blue_block);
        blocks.extend_from_slice(&transparent_block);
        blocks.extend_from_slice(&green_block);

        let dds = build_dxt1_dds(8, 8, &blocks);
        let img = decode_dds_with_alpha(&dds).expect("decode 8x8 DXT1");
        let rgba = img.to_rgba8();

        assert_eq!(rgba.width(), 8);
        assert_eq!(rgba.height(), 8);

        // Top-left quadrant (0-3, 0-3): red, opaque
        let p = rgba.get_pixel(0, 0).0;
        assert!(p[0] > 200 && p[3] == 255, "top-left should be opaque red: {:?}", p);

        // Top-right quadrant (4-7, 0-3): blue, opaque
        let p = rgba.get_pixel(4, 0).0;
        assert!(p[2] > 200 && p[3] == 255, "top-right should be opaque blue: {:?}", p);

        // Bottom-left quadrant (0-3, 4-7): fully transparent
        let p = rgba.get_pixel(0, 4).0;
        assert_eq!(p[3], 0, "bottom-left should be transparent: {:?}", p);

        // Bottom-right quadrant (4-7, 4-7): green, opaque
        let p = rgba.get_pixel(4, 4).0;
        assert!(p[1] > 200 && p[3] == 255, "bottom-right should be opaque green: {:?}", p);

        // Count: exactly 16 transparent pixels (one 4x4 block)
        let transparent_count = rgba.pixels().filter(|p| p.0[3] == 0).count();
        assert_eq!(transparent_count, 16, "exactly one block should be transparent");
    }

    #[test]
    fn build_glb_with_bone_animation() {
        let lmo_path =
            std::path::Path::new("../top-client/model/scene/nml-bd199.lmo");
        if !lmo_path.exists() {
            eprintln!("Skipping bone animation test: nml-bd199.lmo not found");
            return;
        }
        let project_dir = std::path::Path::new("../top-client");
        let (json, bin) = build_glb_from_lmo(lmo_path, project_dir, true)
            .expect("GLB export should succeed for nml-bd199");

        let root: serde_json::Value = serde_json::from_str(&json).unwrap();

        // Should have 5 skins (one per butterfly geometry)
        let skins = root["skins"].as_array().expect("should have skins array");
        assert_eq!(skins.len(), 5, "bd199 has 5 butterflies = 5 skins");

        // Each skin should have 4 joints
        for (i, skin) in skins.iter().enumerate() {
            let joints = skin["joints"].as_array().unwrap();
            assert_eq!(joints.len(), 4, "skin {} should have 4 joints", i);
        }

        // Should have 1 merged bone animation with all channels
        let animations = root["animations"].as_array().expect("should have animations");
        assert_eq!(animations.len(), 1, "all bone animations merged into one");

        // Single animation should have 40 channels (5 butterflies × 4 bones × 2 properties)
        let channels = animations[0]["channels"].as_array().unwrap();
        assert_eq!(
            channels.len(),
            40,
            "merged animation should have 40 channels (5×4 bones × T+R)"
        );

        // Binary buffer should be non-trivial
        assert!(bin.len() > 10000, "binary buffer should have substantial data");
    }
}
