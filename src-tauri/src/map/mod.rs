pub mod area_set;
pub mod commands;
pub mod glb;
pub mod grid_images;
pub mod lit;
pub mod lmo_loader;
pub mod lmo_types;
pub mod map_loader;
pub mod mapinfo;
pub mod obj_loader;
pub mod scene_model;
pub mod scene_obj;
pub mod scene_obj_info;
pub mod shared;
pub mod terrain;
pub mod texture;

use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MapEntry {
    pub name: String,
    pub display_name: String,
    pub map_file: String,
    pub has_obj: bool,
    pub has_rbo: bool,
    pub width: i32,
    pub height: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BuildingEntry {
    pub id: u32,
    pub filename: String,
    pub display_name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MapMetadata {
    pub name: String,
    pub width: i32,
    pub height: i32,
    pub section_width: i32,
    pub section_height: i32,
    pub total_sections: u32,
    pub non_empty_sections: u32,
    pub total_tiles: u32,
    pub object_count: u32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MapExportResult {
    pub gltf_path: String,
    pub bin_path: String,
    pub map_name: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BuildingExportEntry {
    pub obj_id: u32,
    pub filename: String,
    pub gltf_path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MapPlacementRecord {
    pub index: u32,
    pub obj_type: u8,
    pub obj_id: u32,
    pub kind: String,
    pub world_x: f32,
    pub world_y: f32,
    pub world_z: f32,
    pub yaw_angle: i16,
    pub scale: i16,
    pub display_name: Option<String>,
    pub asset_name: Option<String>,
    pub attach_effect_id: Option<i32>,
    pub distance: Option<f32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MapPlacementSummary {
    pub total: u32,
    pub building_count: u32,
    pub effect_count: u32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MapPlacementPage {
    pub total: u32,
    pub offset: u32,
    pub limit: u32,
    pub items: Vec<MapPlacementRecord>,
}
