//! LMO domain types — shared between `lmo.rs` (native parser) and `lmo_loader.rs` (Kaitai adapter).
//!
//! Extracted from `lmo.rs` so that `lmo.rs` can be deleted once the Kaitai adapter
//! achieves full parity (PR 8b).

use cgmath::{InnerSpace, Matrix3, Matrix4, Quaternion, Vector3};
use serde::{Deserialize, Serialize};

// ============================================================================
// D3D render state constants used by PKO scene materials/meshes
// ============================================================================

pub(crate) const D3DRS_ALPHATESTENABLE: u32 = 15;
pub(crate) const D3DRS_SRCBLEND: u32 = 19;
pub(crate) const D3DRS_DESTBLEND: u32 = 20;
pub(crate) const D3DRS_ALPHAREF: u32 = 24;
pub(crate) const D3DRS_CULLMODE: u32 = 22;
pub(crate) const D3DRS_ALPHAFUNC: u32 = 25;
pub(crate) const D3DCMP_GREATER: u32 = 5;
pub(crate) const LW_INVALID_INDEX: u32 = 0xFFFFFFFF;

// D3DCULL values
pub const D3DCULL_NONE: u32 = 1;
#[allow(dead_code)]
pub const D3DCULL_CCW: u32 = 2;

/// Transparency type enum matching lwMtlTexInfoTransparencyTypeEnum.
pub const TRANSP_FILTER: u32 = 0;
pub const TRANSP_ADDITIVE: u32 = 1;
pub const TRANSP_ADDITIVE1: u32 = 2; // SrcColor/One — high-brightness additive
pub const TRANSP_ADDITIVE2: u32 = 3; // SrcColor/InvSrcColor — soft/low additive
pub const TRANSP_ADDITIVE3: u32 = 4; // SrcAlpha/DestAlpha — alpha-weighted additive
pub const TRANSP_SUBTRACTIVE: u32 = 5; // Zero/InvSrcColor — darkening/shadow
// Types 6-8 fall through to ONE/ONE in engine — identical to type 1

// ============================================================================
// Domain types
// ============================================================================

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize)]
pub(crate) struct MaterialRenderState {
    pub(crate) alpha_enabled: bool,
    pub(crate) alpha_ref: Option<u8>,
    pub(crate) alpha_func: Option<u32>,
    pub(crate) src_blend: Option<u32>,
    pub(crate) dest_blend: Option<u32>,
    pub(crate) cull_mode: Option<u32>,
}

impl MaterialRenderState {
    pub(crate) fn normalized_alpha_enabled(self) -> bool {
        self.alpha_enabled && self.alpha_func.map(|f| f == D3DCMP_GREATER).unwrap_or(true)
    }

    pub(crate) fn effective_alpha_ref(self) -> u8 {
        self.alpha_ref.unwrap_or(129)
    }
}

/// Animation data for a geometry object — decomposed from matrix keyframes.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LmoAnimData {
    pub frame_num: u32,
    pub translations: Vec<[f32; 3]>, // per-frame translation (Z-up game space)
    pub rotations: Vec<[f32; 4]>,    // per-frame quaternion [x,y,z,w] (Z-up game space)
}

/// Bone animation key type — matches PKO BONE_KEY_TYPE_* constants.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub enum BoneKeyType {
    Mat43 = 1,
    Mat44 = 2,
    Quat = 3,
}

/// A single bone in the skeleton hierarchy.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LmoBoneInfo {
    pub name: String,
    pub id: u32,
    pub parent_id: u32,
}

/// Per-bone animation keyframes, decomposed to translation + rotation.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LmoBoneKeyframes {
    pub translations: Vec<[f32; 3]>, // per-frame translation (Z-up game space)
    pub rotations: Vec<[f32; 4]>,    // per-frame quaternion [x,y,z,w] (Z-up game space)
}

/// Bone animation data embedded in an LMO geometry object.
/// Matches lwAnimDataBone from the PKO engine.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LmoBoneAnimData {
    pub bone_num: u32,
    pub frame_num: u32,
    pub dummy_num: u32,
    pub key_type: BoneKeyType,
    pub bones: Vec<LmoBoneInfo>,
    pub inv_bind_matrices: Vec<[[f32; 4]; 4]>,
    pub keyframes: Vec<LmoBoneKeyframes>, // one per bone
}

/// UV animation data — per-frame 4×4 texture coordinate transform matrix.
/// Stored per (subset_index, stage_index).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LmoTexUvAnim {
    pub subset: usize,
    pub stage: usize,
    pub frame_num: u32,
    pub matrices: Vec<[[f32; 4]; 4]>, // per-frame 4×4 UV transform matrix
}

/// Texture image animation — frame-by-frame texture swap.
/// Stored per (subset_index, stage_index).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LmoTexImgAnim {
    pub subset: usize,
    pub stage: usize,
    pub textures: Vec<String>, // texture filenames per frame
}

/// Material opacity keyframe — sparse keyed float.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LmoOpacityKeyframe {
    pub frame: u32,
    pub opacity: f32,
}

/// Material opacity animation — sparse keyframes for a single subset.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LmoMtlOpacAnim {
    pub subset: usize,
    pub keyframes: Vec<LmoOpacityKeyframe>,
}

/// A single geometry object within an LMO file.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LmoGeomObject {
    pub id: u32,
    pub parent_id: u32,
    pub obj_type: u32,
    pub mat_local: [[f32; 4]; 4],
    pub vertices: Vec<[f32; 3]>,
    pub normals: Vec<[f32; 3]>,
    pub texcoords: Vec<[f32; 2]>,
    pub vertex_colors: Vec<u32>,
    pub indices: Vec<u32>,
    pub subsets: Vec<LmoSubset>,
    pub materials: Vec<LmoMaterial>,
    pub animation: Option<LmoAnimData>,
    pub bone_animation: Option<LmoBoneAnimData>,
    pub blend_weights: Vec<[f32; 4]>,
    pub bone_indices: Vec<[u8; 4]>,
    pub texuv_anims: Vec<LmoTexUvAnim>,
    pub teximg_anims: Vec<LmoTexImgAnim>,
    pub mtlopac_anims: Vec<LmoMtlOpacAnim>,
}

/// A mesh subset — defines a range of indices rendered with a specific material.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LmoSubset {
    pub primitive_num: u32,
    pub start_index: u32,
    pub vertex_num: u32,
    pub min_index: u32,
}

/// Material info extracted from an LMO geometry object.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LmoMaterial {
    pub diffuse: [f32; 4],
    pub ambient: [f32; 4],
    pub emissive: [f32; 4],
    pub opacity: f32,
    pub transp_type: u32,
    pub alpha_test_enabled: bool,
    pub alpha_ref: u8,
    pub src_blend: Option<u32>,
    pub dest_blend: Option<u32>,
    pub cull_mode: Option<u32>,
    pub tex_filename: Option<String>,
}

/// A parsed LMO model containing multiple geometry objects.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LmoModel {
    pub version: u32,
    pub geom_objects: Vec<LmoGeomObject>,
}

// ============================================================================
// Building metadata types (for debug panel)
// ============================================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BuildingMetadata {
    pub building_id: u32,
    pub filename: String,
    pub version: u32,
    pub geom_objects: Vec<GeomObjectInfo>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct GeomObjectInfo {
    pub index: usize,
    pub id: u32,
    pub parent_id: u32,
    pub vertex_count: usize,
    pub triangle_count: usize,
    pub subset_count: usize,
    pub has_vertex_colors: bool,
    pub has_animation: bool,
    pub animation_frame_count: Option<u32>,
    pub has_bone_animation: bool,
    pub bone_animation_frame_count: Option<u32>,
    pub bone_count: Option<u32>,
    pub has_blend_weights: bool,
    pub has_texuv_anim: bool,
    pub has_teximg_anim: bool,
    pub has_opacity_anim: bool,
    pub materials: Vec<MaterialInfo>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MaterialInfo {
    pub index: usize,
    pub diffuse: [f32; 4],
    pub ambient: [f32; 4],
    pub emissive: [f32; 4],
    pub opacity: f32,
    pub transp_type: u32,
    pub transp_type_name: String,
    pub alpha_test_enabled: bool,
    pub alpha_ref: u8,
    pub src_blend: Option<u32>,
    pub dest_blend: Option<u32>,
    pub cull_mode: Option<u32>,
    pub tex_filename: Option<String>,
}

/// Human-readable name for a transparency type constant.
pub fn transp_type_name(t: u32) -> &'static str {
    match t {
        TRANSP_FILTER => "Filter",
        TRANSP_ADDITIVE => "Additive",
        TRANSP_ADDITIVE1 => "Additive1 (SrcColor/One)",
        TRANSP_ADDITIVE2 => "Additive2 (SrcColor/InvSrc)",
        TRANSP_ADDITIVE3 => "Additive3 (SrcAlpha/DestAlpha)",
        TRANSP_SUBTRACTIVE => "Subtractive",
        _ => "Unknown",
    }
}

/// Build `BuildingMetadata` from a parsed `LmoModel`.
pub fn build_metadata(lmo: &LmoModel, building_id: u32, filename: &str) -> BuildingMetadata {
    let geom_objects = lmo
        .geom_objects
        .iter()
        .enumerate()
        .map(|(i, g)| {
            let materials = g
                .materials
                .iter()
                .enumerate()
                .map(|(mi, m)| MaterialInfo {
                    index: mi,
                    diffuse: m.diffuse,
                    ambient: m.ambient,
                    emissive: m.emissive,
                    opacity: m.opacity,
                    transp_type: m.transp_type,
                    transp_type_name: transp_type_name(m.transp_type).to_string(),
                    alpha_test_enabled: m.alpha_test_enabled,
                    alpha_ref: m.alpha_ref,
                    src_blend: m.src_blend,
                    dest_blend: m.dest_blend,
                    cull_mode: m.cull_mode,
                    tex_filename: m.tex_filename.clone(),
                })
                .collect();

            GeomObjectInfo {
                index: i,
                id: g.id,
                parent_id: g.parent_id,
                vertex_count: g.vertices.len(),
                triangle_count: g.indices.len() / 3,
                subset_count: g.subsets.len(),
                has_vertex_colors: !g.vertex_colors.is_empty(),
                has_animation: g.animation.is_some(),
                animation_frame_count: g.animation.as_ref().map(|a| a.frame_num),
                has_bone_animation: g.bone_animation.is_some(),
                bone_animation_frame_count: g.bone_animation.as_ref().map(|a| a.frame_num),
                bone_count: g.bone_animation.as_ref().map(|a| a.bone_num),
                has_blend_weights: !g.blend_weights.is_empty(),
                has_texuv_anim: !g.texuv_anims.is_empty(),
                has_teximg_anim: !g.teximg_anims.is_empty(),
                has_opacity_anim: !g.mtlopac_anims.is_empty(),
                materials,
            }
        })
        .collect();

    BuildingMetadata {
        building_id,
        filename: filename.to_string(),
        version: lmo.version,
        geom_objects,
    }
}

// ============================================================================
// Utility functions
// ============================================================================

/// Decompose a 4×3 row-major matrix (12 floats) into translation [x,y,z] and
/// quaternion [x,y,z,w] in Z-up game coordinate space.
pub(crate) fn decompose_matrix43(raw: &[f32; 12]) -> ([f32; 3], [f32; 4]) {
    // Construct column-major Matrix4 (same layout as LwMatrix43's br(map)):
    // Column 0: [raw[0], raw[1], raw[2], 0]
    // Column 1: [raw[3], raw[4], raw[5], 0]
    // Column 2: [raw[6], raw[7], raw[8], 0]
    // Column 3: [raw[9], raw[10], raw[11], 1]
    let mat = Matrix4::new(
        raw[0], raw[1], raw[2], 0.0, raw[3], raw[4], raw[5], 0.0, raw[6], raw[7], raw[8], 0.0,
        raw[9], raw[10], raw[11], 1.0,
    );

    // Translation = 4th column
    let translation = [mat.w.x, mat.w.y, mat.w.z];

    // Extract column vectors for rotation
    let mut col0 = Vector3::new(mat.x.x, mat.x.y, mat.x.z);
    let mut col1 = Vector3::new(mat.y.x, mat.y.y, mat.y.z);
    let mut col2 = Vector3::new(mat.z.x, mat.z.y, mat.z.z);

    let scale_x = col0.magnitude();
    let scale_y = col1.magnitude();
    let scale_z = col2.magnitude();

    if scale_x > 1e-8 {
        col0 /= scale_x;
    }
    if scale_y > 1e-8 {
        col1 /= scale_y;
    }
    if scale_z > 1e-8 {
        col2 /= scale_z;
    }

    let rotation_matrix = Matrix3::from_cols(col0, col1, col2);
    let q = Quaternion::from(rotation_matrix);

    // glTF quaternion order: [x, y, z, w]
    let rotation = [q.v.x, q.v.y, q.v.z, q.s];

    (translation, rotation)
}
