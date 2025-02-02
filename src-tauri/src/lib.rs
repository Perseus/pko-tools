// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

mod animation;
mod character;
mod d3d;
mod db;
mod preferences;
mod projects;
mod broadcast;

use tauri::Manager;

struct AppState {
    current_project: Option<projects::project::Project>,
    preferences: preferences::Preferences,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let preferences = preferences::Preferences::new();
            let mut state = AppState {
                current_project: None,
                preferences,
            };

            if let Some(current_project_id) = &state.preferences.get_current_project() {
                if let Ok(current_project_id) = uuid::Uuid::parse_str(current_project_id) {
                    if let Ok(current_project) =
                        projects::project::Project::get_project(current_project_id)
                    {
                        state.current_project = Some(current_project);
                    }
                }
            }

            app.manage(state);
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            projects::commands::get_projects_list,
            projects::commands::get_current_project,
            projects::commands::select_project,
            projects::commands::create_project,
            projects::commands::get_animation_files,
            character::commands::get_character_list,
            character::commands::load_character,
            character::commands::export_to_gltf,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
