use crate::AppState;

use super::project::{Project};

#[tauri::command]
pub fn get_projects_list() -> Vec<Project> {
    if let Ok(projects) = Project::get_projects_list() {
        return projects;
    }

    Vec::new()
}

#[tauri::command]
pub fn get_current_project(state: tauri::State<AppState>) -> Option<Project> {
    let preferences = &state.preferences;
    let project_id = preferences.get_current_project()?;

    let project_id = uuid::Uuid::parse_str(&project_id);
    if project_id.is_err() {
        return None;
    }

    let project_uuid = project_id.unwrap();
    let project = Project::get_project(project_uuid);

    if project.is_err() {
        return None;
    }

    let project = project.unwrap();
    Some(project)
}

#[tauri::command]
pub fn create_project(project_name: String, project_directory: String) -> Result<String, String> {
    let mut err = "Could not create project: ".to_owned() + &project_name;
    match Project::create_new(project_name, project_directory) {
        Ok(project) => {
            let project_id = project.id.to_string();
            return Ok(project_id);
        }

        Err(e) => {
            err.push_str(". Error: ");
            err.push_str(&e.to_string());
        }
    }

    Err(err.to_owned())
}

#[tauri::command]
pub async fn get_animation_files(project_id: String) -> Vec<String> {
    let project_id = uuid::Uuid::parse_str(&project_id);
    if project_id.is_err() {
        return Vec::new();
    }

    let project_id = project_id.unwrap();
    let project = Project::get_project(project_id);

    if project.is_err() {
        return Vec::new();
    }

    let project = project.unwrap();
    let animation_files = project.get_animation_files();

    if animation_files.is_err() {
        return Vec::new();
    }

    animation_files.unwrap()
}

#[tauri::command]
pub fn select_project(state: tauri::State<AppState>, project_id: String) -> Result<(), String> {
    let project_id = uuid::Uuid::parse_str(&project_id);
    if project_id.is_err() {
        return Err("Invalid project ID".to_owned());
    }

    let project_id = project_id.unwrap();
    state.preferences.set_current_project(project_id.to_string());

    Ok(())
}
