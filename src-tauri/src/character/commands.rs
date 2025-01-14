use std::str::FromStr;

use super::{info::get_all_characters, Character};

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
pub async fn open_character(project_id: String, character_id: u32) {}
