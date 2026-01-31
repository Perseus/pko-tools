use std::str::FromStr;

use crate::projects::project::Project;

use super::{model::EffFile, scan_effects_directory};

#[tauri::command]
pub async fn list_effects(project_id: String) -> Result<Vec<String>, String> {
    let project_id = uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    scan_effects_directory(project.project_directory.as_ref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn load_effect(project_id: String, effect_name: String) -> Result<EffFile, String> {
    let project_id = uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;
    let effect_path = effect_file_path(project.project_directory.as_ref(), &effect_name);

    let bytes = std::fs::read(&effect_path)
        .map_err(|e| format!("Failed to read effect file {}: {}", effect_path.display(), e))?;
    EffFile::from_bytes(&bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_effect(
    project_id: String,
    effect_name: String,
    effect: EffFile,
) -> Result<(), String> {
    let project_id = uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;
    let effect_path = effect_file_path(project.project_directory.as_ref(), &effect_name);

    if let Some(parent) = effect_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create effect directory: {}", e))?;
    }

    let bytes = effect.to_bytes().map_err(|e| e.to_string())?;
    std::fs::write(&effect_path, bytes)
        .map_err(|e| format!("Failed to write effect file {}: {}", effect_path.display(), e))?;

    Ok(())
}

fn effect_file_path(project_dir: &std::path::Path, effect_name: &str) -> std::path::PathBuf {
    let file_name = if effect_name.ends_with(".eff") {
        effect_name.to_string()
    } else {
        format!("{}.eff", effect_name)
    };

    project_dir.join("effect").join(file_name)
}
