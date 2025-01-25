use std::str::FromStr;

use super::{info::get_all_characters, Character, get_character_gltf_json};

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
pub async fn load_character(project_id: String, character_id: u32) -> Result<String, String> {
    println!("Loading character: {} in project: {}", character_id, project_id);
    let project_id = uuid::Uuid::from_str(&project_id).unwrap();
    let char_gltf_json = get_character_gltf_json(project_id, character_id);
    if char_gltf_json.is_err() {
        return Err(char_gltf_json.err().unwrap().to_string());
    }
    Ok(char_gltf_json.unwrap())
}
