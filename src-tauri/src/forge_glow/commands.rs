use std::str::FromStr;

use crate::item::commands::{resolve_forge_combination, ForgeTraceGemInput};
use crate::projects::project::Project;

use super::export;
use super::model::{
    ForgeGlowDraft, ForgeGlowDraftSummary, ForgeGlowExportResult, ForgeRecipeInputs,
    ResolvedForgeRecipe,
};
use super::storage;

fn now_stamp() -> String {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    secs.to_string()
}

fn project_from_id(project_id: &str) -> Result<(uuid::Uuid, Project), String> {
    let uuid = uuid::Uuid::from_str(project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(uuid).map_err(|e| e.to_string())?;
    Ok((uuid, project))
}

fn trace_gems(inputs: &ForgeRecipeInputs) -> Vec<ForgeTraceGemInput> {
    inputs
        .gems
        .iter()
        .map(|gem| ForgeTraceGemInput {
            item_id: gem.item_id,
            level: gem.level,
        })
        .collect()
}

#[tauri::command]
pub async fn resolve_forge_glow_recipe(
    project_id: String,
    inputs: ForgeRecipeInputs,
) -> Result<ResolvedForgeRecipe, String> {
    let (uuid, project) = project_from_id(&project_id)?;
    let trace = resolve_forge_combination(
        uuid,
        project.project_directory.as_ref(),
        inputs.weapon_item_id,
        inputs.char_type,
        trace_gems(&inputs),
    )?;

    Ok(ResolvedForgeRecipe::from_trace(trace))
}

#[tauri::command]
pub async fn create_forge_glow_draft(
    project_id: String,
    name: String,
    inputs: ForgeRecipeInputs,
) -> Result<ForgeGlowDraft, String> {
    let (uuid, project) = project_from_id(&project_id)?;
    let trace = resolve_forge_combination(
        uuid,
        project.project_directory.as_ref(),
        inputs.weapon_item_id,
        inputs.char_type,
        trace_gems(&inputs),
    )?;
    let recipe = ResolvedForgeRecipe::from_trace(trace);
    let timestamp = now_stamp();
    let draft_id = format!("{}-{}", storage::sanitize_slug(&name), timestamp);
    let draft = ForgeGlowDraft::new(draft_id, name, timestamp, recipe);

    storage::save_draft(project.project_directory.as_ref(), &draft).map_err(|e| e.to_string())?;
    Ok(draft)
}

#[tauri::command]
pub async fn list_forge_glow_drafts(
    project_id: String,
) -> Result<Vec<ForgeGlowDraftSummary>, String> {
    let (_, project) = project_from_id(&project_id)?;
    storage::list_drafts(project.project_directory.as_ref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn load_forge_glow_draft(
    project_id: String,
    draft_id: String,
) -> Result<ForgeGlowDraft, String> {
    let (_, project) = project_from_id(&project_id)?;
    storage::load_draft(project.project_directory.as_ref(), &draft_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_forge_glow_draft(
    project_id: String,
    mut draft: ForgeGlowDraft,
) -> Result<ForgeGlowDraft, String> {
    let (_, project) = project_from_id(&project_id)?;
    draft.modified_at = now_stamp();
    storage::save_draft(project.project_directory.as_ref(), &draft).map_err(|e| e.to_string())?;
    Ok(draft)
}

#[tauri::command]
pub async fn delete_forge_glow_draft(project_id: String, draft_id: String) -> Result<(), String> {
    let (_, project) = project_from_id(&project_id)?;
    storage::delete_draft(project.project_directory.as_ref(), &draft_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn export_forge_glow_package(
    project_id: String,
    draft_id: String,
    variant_ids: Vec<String>,
) -> Result<ForgeGlowExportResult, String> {
    let (_, project) = project_from_id(&project_id)?;
    let draft = storage::load_draft(project.project_directory.as_ref(), &draft_id)
        .map_err(|e| e.to_string())?;
    export::export_package(project.project_directory.as_ref(), &draft, &variant_ids)
        .map_err(|e| e.to_string())
}
