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
pub fn get_current_project(state: tauri::State<AppState>) -> Option<String> {
    let preferences = &state.preferences;
    preferences.get_current_project()
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
