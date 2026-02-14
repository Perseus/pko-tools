use std::str::FromStr;

use crate::projects::project::Project;

use super::terrain;
use super::{BuildingEntry, MapEntry, MapExportResult, MapForUnityExportResult, MapMetadata};

#[tauri::command]
pub async fn get_map_list(project_id: String) -> Result<Vec<MapEntry>, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    terrain::scan_maps(project.project_directory.as_ref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn load_map_terrain(
    project_id: String,
    map_name: String,
) -> Result<String, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    terrain::build_map_viewer_gltf(project.project_directory.as_ref(), &map_name)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_map_metadata(
    project_id: String,
    map_name: String,
) -> Result<MapMetadata, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    terrain::get_metadata(project.project_directory.as_ref(), &map_name)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn export_map_to_gltf(
    project_id: String,
    map_name: String,
) -> Result<MapExportResult, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    let exports_dir = project
        .project_directory
        .join("pko-tools")
        .join("exports")
        .join("map");

    terrain::export_terrain_gltf(
        project.project_directory.as_ref(),
        &map_name,
        &exports_dir,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn export_map_for_unity(
    project_id: String,
    map_name: String,
) -> Result<MapForUnityExportResult, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    let exports_dir = project
        .project_directory
        .join("pko-tools")
        .join("exports")
        .join("map")
        .join(&map_name);

    terrain::export_map_for_unity(
        project.project_directory.as_ref(),
        &map_name,
        &exports_dir,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn batch_export_maps_for_unity(
    project_id: String,
) -> Result<super::terrain::BatchExportResult, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    let output_base_dir = project
        .project_directory
        .join("pko-tools")
        .join("exports")
        .join("map");

    terrain::batch_export_for_unity(project.project_directory.as_ref(), &output_base_dir)
        .map_err(|e| e.to_string())
}

// ============================================================================
// Building commands
// ============================================================================

#[tauri::command]
pub async fn get_building_list(project_id: String) -> Result<Vec<BuildingEntry>, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    let obj_info =
        super::scene_obj_info::load_scene_obj_info(project.project_directory.as_ref())
            .map_err(|e| e.to_string())?;

    let mut entries: Vec<BuildingEntry> = obj_info
        .into_values()
        .map(|info| {
            let display_name = info
                .filename
                .strip_suffix(".lmo")
                .or_else(|| info.filename.strip_suffix(".LMO"))
                .unwrap_or(&info.filename)
                .to_string();

            BuildingEntry {
                id: info.id,
                filename: info.filename,
                display_name,
            }
        })
        .collect();

    entries.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(entries)
}

#[tauri::command]
pub async fn load_building_model(
    project_id: String,
    building_id: u32,
) -> Result<String, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    let obj_info =
        super::scene_obj_info::load_scene_obj_info(project.project_directory.as_ref())
            .map_err(|e| e.to_string())?;

    let info = obj_info
        .get(&building_id)
        .ok_or_else(|| format!("Building ID {} not found in sceneobjinfo", building_id))?;

    let lmo_path = super::scene_model::find_lmo_path(
        project.project_directory.as_ref(),
        &info.filename,
    )
    .ok_or_else(|| format!("LMO file not found: {}", info.filename))?;

    super::scene_model::build_gltf_from_lmo(&lmo_path, project.project_directory.as_ref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn export_building_to_gltf(
    project_id: String,
    building_id: u32,
    output_dir: String,
) -> Result<String, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    let obj_info =
        super::scene_obj_info::load_scene_obj_info(project.project_directory.as_ref())
            .map_err(|e| e.to_string())?;

    let info = obj_info
        .get(&building_id)
        .ok_or_else(|| format!("Building ID {} not found in sceneobjinfo", building_id))?;

    let lmo_path = super::scene_model::find_lmo_path(
        project.project_directory.as_ref(),
        &info.filename,
    )
    .ok_or_else(|| format!("LMO file not found: {}", info.filename))?;

    let gltf_json =
        super::scene_model::build_gltf_from_lmo(&lmo_path, project.project_directory.as_ref())
            .map_err(|e| e.to_string())?;

    let out_dir = std::path::Path::new(&output_dir);
    std::fs::create_dir_all(out_dir).map_err(|e| e.to_string())?;

    let stem = info
        .filename
        .strip_suffix(".lmo")
        .or_else(|| info.filename.strip_suffix(".LMO"))
        .unwrap_or(&info.filename);
    let gltf_path = out_dir.join(format!("{}.gltf", stem));
    std::fs::write(&gltf_path, gltf_json.as_bytes()).map_err(|e| e.to_string())?;

    Ok(gltf_path.to_string_lossy().to_string())
}
