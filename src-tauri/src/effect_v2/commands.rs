use std::str::FromStr;

use crate::projects::project::Project;

use super::magic_single_loader::load_magic_single;
use super::model::MagicSingleTable;

/// Health-check command to verify the v2 effects module is wired up.
#[tauri::command]
pub fn effect_v2_ping() -> String {
    "effect_v2 ok".to_string()
}

/// Load and parse the MagicSingleinfo.bin table from the project's scripts/table/ directory.
#[tauri::command]
pub async fn load_magic_single_table(project_id: String) -> Result<MagicSingleTable, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    let path = project
        .project_directory
        .as_ref()
        .join("scripts")
        .join("table")
        .join("MagicSingleinfo.bin");

    let bytes = std::fs::read(&path).map_err(|e| {
        format!(
            "Failed to read MagicSingleinfo.bin at {}: {}",
            path.display(),
            e
        )
    })?;

    load_magic_single(&bytes).map_err(|e| e.to_string())
}
