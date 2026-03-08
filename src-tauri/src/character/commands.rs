use std::{
    fs::File,
    io::Write,
    path::{Path, PathBuf},
    str::FromStr,
};

use gltf::import;
use tauri::{AppHandle, Emitter};

use crate::{broadcast::get_broadcaster, AppState};

use super::{
    get_character_gltf_json, get_character_gltf_json_with_options, get_character_metadata,
    info::get_all_characters, Character, CharacterMetadata,
};

#[derive(serde::Serialize)]
pub struct CharacterAction {
    pub action_id: u16,
    pub name: String,
    pub start_frame: u32,
    pub end_frame: u32,
    pub key_frames: Vec<u32>,
    pub weapon_mode: Option<String>,
}

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
    app_state: tauri::State<'_, AppState>,
    project_id: String,
    character_id: u32,
) -> Result<String, String> {
    let project_id = uuid::Uuid::from_str(&project_id).map_err(|e| e.to_string())?;

    // Check cache first
    {
        let cache = app_state
            .character_gltf_cache
            .lock()
            .map_err(|e| e.to_string())?;
        if let Some(cached) = cache.get(&(project_id, character_id)) {
            return Ok(cached.clone());
        }
    }

    let mut receiver = get_broadcaster().subscribe();

    tauri::async_runtime::spawn(async move {
        while let Ok(message) = receiver.recv().await {
            app.emit("load_character_update", message)
                .unwrap_or_else(|e| eprintln!("Error emitting load_character_update: {}", e));
        }
    });

    let char_gltf_json =
        get_character_gltf_json(project_id, character_id).map_err(|e| e.to_string())?;

    // Store in cache
    {
        let mut cache = app_state
            .character_gltf_cache
            .lock()
            .map_err(|e| e.to_string())?;
        cache.insert((project_id, character_id), char_gltf_json.clone());
    }

    Ok(char_gltf_json)
}

#[derive(serde::Serialize)]
pub struct ExportResult {
    pub file_path: String,
    pub folder_path: String,
}

#[tauri::command]
pub async fn export_to_gltf(
    app: AppHandle,
    app_state: tauri::State<'_, AppState>,
    character_id: u32,
    y_up: Option<bool>,
) -> Result<ExportResult, String> {
    let y_up = y_up.unwrap_or(false);
    let current_project = app_state.preferences.get_current_project();
    if current_project.is_none() {
        return Err("No project selected".to_string());
    }

    let project_id = current_project.unwrap();
    let project_uuid =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;

    // Get the project to access its directory
    let project = crate::projects::project::Project::get_project(project_uuid)
        .map_err(|e| format!("Failed to get project: {}", e))?;

    // Create exports directory in the game client folder
    let exports_dir = project
        .project_directory
        .join("pko-tools")
        .join("exports")
        .join("gltf");
    std::fs::create_dir_all(&exports_dir)
        .map_err(|e| format!("Failed to create exports directory: {}", e))?;

    let mut receiver = get_broadcaster().subscribe();

    tauri::async_runtime::spawn(async move {
        while let Ok(message) = receiver.recv().await {
            app.emit("export_to_gltf_update", message)
                .unwrap_or_else(|e| eprintln!("Error emitting export_to_gltf_update: {}", e));
        }
    });

    let character = get_character_gltf_json_with_options(project_uuid, character_id, y_up);
    if character.is_err() {
        return Err(character.err().unwrap().to_string());
    }

    let gltf_json = character.unwrap();
    let file_path = exports_dir.join(format!("{}.gltf", character_id));
    let file = File::create(file_path.clone());
    if let Ok(mut file) = file {
        file.write_all(gltf_json.as_bytes()).unwrap();
    }

    Ok(ExportResult {
        file_path: file_path.to_string_lossy().to_string(),
        folder_path: exports_dir.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub async fn import_character_from_gltf(
    app: AppHandle,
    app_state: tauri::State<'_, AppState>,
    model_id: u32,
    file_path: String,
) -> Result<String, String> {
    let current_project = app_state.preferences.get_current_project();
    if current_project.is_none() {
        return Err("No project selected".to_string());
    }

    let project_id = current_project.unwrap();
    if let Ok(project_uuid) = uuid::Uuid::from_str(&project_id) {
        let mut receiver = get_broadcaster().subscribe();

        tauri::async_runtime::spawn(async move {
            while let Ok(message) = receiver.recv().await {
                app.emit("import_character_from_gltf_update", message)
                    .unwrap_or_else(|e| {
                        eprintln!("Error emitting import_character_from_gltf_update: {}", e)
                    });
            }
        });

        let file = File::open(file_path.clone());
        if file.is_err() {
            return Err(format!(
                "Failed to open file: {}, error: {}",
                file_path,
                file.err().unwrap()
            ));
        }

        let gltf_data = import(PathBuf::from(file_path));
        if gltf_data.is_err() {
            return Err(format!(
                "Failed to import glTF data: {}",
                gltf_data.err().unwrap()
            ));
        }

        let (gltf, buffers, images) = gltf_data.unwrap();

        let character = Character::import_gltf_with_char_id(gltf, buffers, images, model_id);
        if character.is_err() {
            return Err(format!(
                "Something failed while parsing the glTF file: {}",
                character.err().unwrap()
            ));
        }

        let (animation_file_name, mesh_file_name) = character.unwrap();
        return Ok(format!(
            "glTF data imported successfully. Animation file: {}, Mesh file: {}",
            animation_file_name, mesh_file_name
        ));
    }

    Err("Invalid project id".to_string())
}

#[tauri::command]
pub async fn invalidate_character_cache(
    app_state: tauri::State<'_, AppState>,
    project_id: Option<String>,
    character_id: Option<u32>,
) -> Result<(), String> {
    let mut cache = app_state
        .character_gltf_cache
        .lock()
        .map_err(|e| e.to_string())?;

    match (project_id, character_id) {
        (Some(pid), Some(cid)) => {
            let uuid = uuid::Uuid::from_str(&pid).map_err(|e| e.to_string())?;
            cache.remove(&(uuid, cid));
        }
        _ => {
            cache.clear();
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn get_character_actions(
    app_state: tauri::State<'_, AppState>,
    project_id: String,
    char_type_id: u16,
) -> Result<Vec<CharacterAction>, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = crate::projects::project::Project::get_project(project_id)
        .map_err(|e| e.to_string())?;
    let project_dir = project.project_directory.as_ref();

    let action_table_path = project_dir.join("scripts/txt/CharacterAction.tx");
    let poseinfo_path = project_dir.join("scripts/table/characterposeinfo.bin");

    let action_table = crate::animation::action_table::load_action_table(&action_table_path)
        .map_err(|e| e.to_string())?;
    let pose_table = crate::animation::pose_info::load_poseinfo(&poseinfo_path)
        .map_err(|e| e.to_string())?;

    let actions = action_table
        .get(&char_type_id)
        .cloned()
        .unwrap_or_default();

    let result: Vec<CharacterAction> = actions
        .into_iter()
        .filter(|a| !(a.start_frame == 0 && a.end_frame == 0))
        .map(|a| {
            let (name, weapon_mode) =
                if let Some((entry, weapon_idx)) = pose_table.get_base_pose(a.action_id) {
                    let base = entry.name.clone();
                    let wm = if entry.weapon_variants.iter().filter(|&&v| v != 0).count() > 1 {
                        Some(crate::animation::pose_info::WEAPON_MODES[weapon_idx].to_string())
                    } else {
                        None
                    };
                    (base, wm)
                } else if let Some(name) = pose_table.get_pose_name(a.action_id) {
                    (name.to_string(), None)
                } else {
                    (format!("Action {}", a.action_id), None)
                };

            CharacterAction {
                action_id: a.action_id,
                name,
                start_frame: a.start_frame,
                end_frame: a.end_frame,
                key_frames: a.key_frames,
                weapon_mode,
            }
        })
        .collect();

    Ok(result)
}

#[tauri::command]
pub async fn get_character_metadata_cmd(
    project_id: String,
    character_id: u32,
) -> Result<CharacterMetadata, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;

    let metadata = get_character_metadata(project_id, character_id).map_err(|e| e.to_string())?;

    Ok(metadata)
}
