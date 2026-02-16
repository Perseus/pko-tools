use std::str::FromStr;

use serde::Serialize;

use crate::projects::project::Project;

#[tauri::command]
pub async fn check_model_id_available(project_id: String, model_id: u32) -> Result<bool, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    super::is_model_id_available(project.project_directory.as_ref(), model_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_next_available_model_id(project_id: String) -> Result<u32, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    super::get_next_available_model_id(project.project_directory.as_ref())
        .map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct RegisterResult {
    pub character_id: u32,
}

#[tauri::command]
pub async fn register_imported_character(
    project_id: String,
    model_id: u32,
    name: String,
) -> Result<RegisterResult, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    let character_id =
        super::register_character(project.project_directory.as_ref(), model_id, &name)
            .map_err(|e| e.to_string())?;

    Ok(RegisterResult { character_id })
}
