use std::str::FromStr;

use crate::projects::project::Project;

use super::building_import::BuildingImportResult;
use super::building_workbench::{self, BuildingWorkbenchState};
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

/// Export a building with PKO extras for round-trip editing in Blender.
#[tauri::command]
pub async fn export_building_for_editing(
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

    let gltf_json = super::scene_model::build_gltf_from_lmo_roundtrip(
        &lmo_path,
        project.project_directory.as_ref(),
    )
    .map_err(|e| e.to_string())?;

    let out_dir = project
        .project_directory
        .join("pko-tools")
        .join("exports")
        .join("buildings")
        .join("editing");
    std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;

    let stem = info
        .filename
        .strip_suffix(".lmo")
        .or_else(|| info.filename.strip_suffix(".LMO"))
        .unwrap_or(&info.filename);
    let gltf_path = out_dir.join(format!("{}.gltf", stem));
    std::fs::write(&gltf_path, gltf_json.as_bytes()).map_err(|e| e.to_string())?;

    Ok(gltf_path.to_string_lossy().to_string())
}

/// Import a glTF/GLB file as a PKO building LMO.
#[tauri::command]
pub async fn import_building_from_gltf(
    project_id: String,
    building_id: String,
    file_path: String,
    scale_factor: f32,
) -> Result<BuildingImportResult, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    let output_dir = project.project_directory.join("pko-tools");

    super::building_import::import_building_from_gltf(
        std::path::Path::new(&file_path),
        &building_id,
        &output_dir,
        scale_factor,
    )
    .map_err(|e| e.to_string())
}

// ============================================================================
// Building workbench commands
// ============================================================================

#[tauri::command]
pub async fn rescale_building(
    project_id: String,
    lmo_path: String,
    factor: f32,
) -> Result<String, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    building_workbench::rescale_building(
        std::path::Path::new(&lmo_path),
        factor,
        project.project_directory.as_ref(),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rotate_building(
    project_id: String,
    lmo_path: String,
    x_deg: f32,
    y_deg: f32,
    z_deg: f32,
) -> Result<String, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    building_workbench::rotate_building(
        std::path::Path::new(&lmo_path),
        x_deg,
        y_deg,
        z_deg,
        project.project_directory.as_ref(),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn export_building_to_game(
    lmo_path: String,
    import_dir: String,
    export_dir: String,
    building_id: String,
) -> Result<String, String> {
    building_workbench::export_building(
        std::path::Path::new(&lmo_path),
        std::path::Path::new(&import_dir),
        std::path::Path::new(&export_dir),
        &building_id,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_building_workbench(
    project_id: String,
    state: BuildingWorkbenchState,
) -> Result<(), String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    let db = project.db_arc();
    let conn = db.lock().map_err(|e| e.to_string())?;
    building_workbench::save_workbench(&conn, &state).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn load_building_workbench(
    project_id: String,
    building_id: String,
) -> Result<Option<BuildingWorkbenchState>, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    let db = project.db_arc();
    let conn = db.lock().map_err(|e| e.to_string())?;
    building_workbench::load_workbench(&conn, &building_id).map_err(|e| e.to_string())
}
