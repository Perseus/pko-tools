use std::{fs::File, io::Write, str::FromStr};

use tauri::{AppHandle, Emitter, State};

use crate::{broadcast::get_broadcaster, AppState};

use super::{get_character_gltf_json, info::get_all_characters, Character};

#[tauri::command]
pub async fn get_character_list(project_id: String) -> Result<Vec<Character>, String> {
    if let Ok(proj_id) = uuid::Uuid::from_str(&project_id) {
        match get_all_characters(proj_id) {
            Ok(characters) => Ok(characters),
            Err(e) => Err(e.to_string()),
        }
    } else {
        Err("Invalid project id".to_string())
    }
}

#[tauri::command]
pub async fn load_character(
    app: AppHandle,
    project_id: String,
    character_id: u32,
) -> Result<String, String> {
    let project_id = uuid::Uuid::from_str(&project_id).unwrap();

    let mut receiver = get_broadcaster().subscribe();

    tauri::async_runtime::spawn(async move {
        while let Ok(message) = receiver.recv().await {
            app.emit("load_character_update", message)
                .unwrap_or_else(|e| eprintln!("Error emitting load_character_update: {}", e));
        }
    });

    let char_gltf_json = get_character_gltf_json(project_id, character_id);
    if char_gltf_json.is_err() {
        return Err(char_gltf_json.err().unwrap().to_string());
    }
    Ok(char_gltf_json.unwrap())
}

#[tauri::command]
pub async fn export_to_gltf(
    app: AppHandle,
    app_state: tauri::State<'_, AppState>,
    character_id: u32,
    target_path: String,
) -> Result<(), String> {
    let current_project = app_state.preferences.get_current_project();
    if current_project.is_none() {
        return Err("No project selected".to_string());
    }

    let project_id = current_project.unwrap();
    if let Ok(project_uuid) = uuid::Uuid::from_str(&project_id) {
        let mut receiver = get_broadcaster().subscribe();

        tauri::async_runtime::spawn(async move {
            while let Ok(message) = receiver.recv().await {
                app.emit("export_to_gltf_update", message)
                    .unwrap_or_else(|e| eprintln!("Error emitting export_to_gltf_update: {}", e));
            }
        });

        let character = get_character_gltf_json(project_uuid, character_id);
        if character.is_err() {
            return Err(character.err().unwrap().to_string());
        }

        let gltf_json = character.unwrap();
        let path = target_path + "/" + &character_id.to_string() + ".gltf";
        let file = File::create(path);
        if let Ok(mut file) = file {
            file.write_all(gltf_json.as_bytes()).unwrap();
        }

        return Ok(());
    }

    Err("Invalid project id".to_string())
}
