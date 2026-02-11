/// Engine-enforced and recommended limits for PKO models.

/// Maximum number of bones in a skeleton.
pub const LW_MAX_BONE_NUM: u32 = 25;

/// Maximum number of sub-skins (mesh parts per character).
pub const LW_MAX_SUBSKIN_NUM: u32 = 10;

/// Maximum number of subsets (material groups per mesh).
pub const LW_MAX_SUBSET_NUM: u32 = 16;

/// Maximum number of blend weights per vertex.
pub const LW_MAX_BLENDWEIGHT_NUM: u32 = 4;

/// Maximum number of texture stages per material.
pub const LW_MAX_TEXTURESTAGE_NUM: u32 = 4;

/// Maximum number of bounding spheres per model.
pub const LW_MAX_BOUNDING_SPHERE_NUM: u32 = 8;

/// Maximum texture dimension (width or height).
pub const MAX_TEXTURE_DIMENSION: u32 = 2048;

/// Recommended maximum triangle count for performance.
pub const RECOMMENDED_MAX_TRIANGLES: u32 = 3000;
