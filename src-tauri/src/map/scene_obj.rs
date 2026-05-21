use std::collections::BTreeSet;

use serde::Serialize;

// ============================================================================
// .obj scene object domain types
// ============================================================================

/// A scene object placed on the map.
#[derive(Debug, Clone, Serialize)]
pub struct SceneObject {
    /// Raw sTypeID field.
    pub raw_type_id: i16,
    /// Object type: 0 = model, 1 = effect (top 2 bits of sTypeID)
    pub obj_type: u8,
    /// Object ID (lower 14 bits of sTypeID)
    pub obj_id: u16,
    /// Absolute world X position in world units (centimeters / 100)
    pub world_x: f32,
    /// Absolute world Y position in world units
    pub world_y: f32,
    /// Height offset (world units)
    pub world_z: f32,
    /// Yaw angle in degrees
    pub yaw_angle: i16,
    /// Scale (unused in most files)
    pub scale: i16,
}

/// A raw 20-byte SSceneObjInfo record kept so patched exports can preserve
/// records that are not surfaced as editable placements.
#[derive(Debug, Clone)]
pub struct RawSceneObjectRecord {
    pub section_no: usize,
    pub bytes: [u8; 20],
}

/// Parsed .obj scene object file.
#[derive(Debug, Serialize)]
pub struct ParsedObjFile {
    pub section_cnt_x: i32,
    pub section_cnt_y: i32,
    pub section_width: i32,
    pub section_height: i32,
    pub section_obj_num: i32,
    pub objects: Vec<SceneObject>,
    #[serde(skip)]
    pub raw_records: Vec<RawSceneObjectRecord>,
    #[serde(skip)]
    pub object_raw_indices: Vec<usize>,
    #[serde(skip)]
    pub dirty_object_indices: BTreeSet<usize>,
}
