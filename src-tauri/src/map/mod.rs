pub mod area_set;
pub mod commands;
pub mod glb;
pub mod grid_images;
pub mod lmo;
pub mod mapinfo;
pub mod scene_model;
pub mod scene_obj;
pub mod scene_obj_info;
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
pub struct MapForUnityExportResult {
    pub output_dir: String,
    pub terrain_gltf_path: String,
    pub building_gltf_paths: Vec<BuildingExportEntry>,
    pub manifest_path: String,
    pub total_buildings_exported: u32,
    pub total_placements: u32,
    pub total_effect_placements: u32,
    pub total_effect_definitions: u32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BuildingExportEntry {
    pub obj_id: u32,
    pub filename: String,
    pub gltf_path: String,
}

/// Options controlling the map export format.
#[derive(Debug, Clone)]
pub struct ExportOptions {
    /// Manifest version: 2 = legacy binary grids + JSON glTF,
    /// 3 = PNG grids + GLB terrain/buildings + slim manifest.
    pub manifest_version: u32,
}

impl Default for ExportOptions {
    fn default() -> Self {
        Self {
            manifest_version: 3,
        }
    }
}
