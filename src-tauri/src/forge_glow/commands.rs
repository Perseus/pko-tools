use std::str::FromStr;

use crate::item::commands::{resolve_forge_combination, ForgeTraceGemInput};
use crate::item::info::{get_all_items, get_item};
use crate::item::refine::{self, StoneInfoTable};
use crate::projects::project::Project;
use serde::Serialize;

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

fn model_id_for_char_type(item: &crate::item::Item, char_type: u32) -> String {
    match char_type {
        0 => item.model_lance.clone(),
        1 => item.model_carsise.clone(),
        2 => item.model_phyllis.clone(),
        3 => item.model_ami.clone(),
        _ => item.model_lance.clone(),
    }
}

fn hydrate_weapon_model_id(project_id: uuid::Uuid, draft: &mut ForgeGlowDraft) {
    if !draft.source_recipe.weapon_model_id.trim().is_empty() {
        return;
    }

    if let Ok(item) = get_item(project_id, draft.source_recipe.weapon_item_id) {
        draft.source_recipe.weapon_model_id =
            model_id_for_char_type(&item, draft.source_recipe.char_type);
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForgeGlowGemOption {
    pub item_id: u32,
    pub item_name: String,
    pub stone_info_id: i32,
    pub stone_type: i32,
    pub equip_pos: Vec<i32>,
    pub hint_func: String,
}

pub(crate) fn build_forge_glow_gem_options(
    stone_info: &StoneInfoTable,
    items: &[crate::item::Item],
) -> Vec<ForgeGlowGemOption> {
    let item_names = items
        .iter()
        .map(|item| (item.id, item.name.clone()))
        .collect::<std::collections::HashMap<_, _>>();

    let mut options = stone_info
        .by_item_id
        .values()
        .filter_map(|stone| {
            let item_id = u32::try_from(stone.item_id).ok()?;
            let item_name = item_names.get(&item_id)?;
            Some(ForgeGlowGemOption {
                item_id,
                item_name: item_name.clone(),
                stone_info_id: stone.id,
                stone_type: stone.stone_type,
                equip_pos: stone.equip_pos.clone(),
                hint_func: stone.hint_func.clone(),
            })
        })
        .collect::<Vec<_>>();

    options.sort_by_key(|option| option.item_id);
    options
}

#[tauri::command]
pub async fn list_forge_glow_gems(project_id: String) -> Result<Vec<ForgeGlowGemOption>, String> {
    let (uuid, project) = project_from_id(&project_id)?;
    let stone_info =
        refine::load_stone_info(project.project_directory.as_ref()).map_err(|e| e.to_string())?;
    let items = get_all_items(uuid).map_err(|e| e.to_string())?;
    Ok(build_forge_glow_gem_options(&stone_info, &items))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::item::refine::StoneInfoEntry;
    use std::collections::HashMap;

    fn item(id: u32, name: &str) -> crate::item::Item {
        crate::item::Item {
            id,
            name: name.to_string(),
            icon_name: String::new(),
            model_ground: "0".to_string(),
            model_lance: "0".to_string(),
            model_carsise: "0".to_string(),
            model_phyllis: "0".to_string(),
            model_ami: "0".to_string(),
            item_type: 0,
            display_effect: "0".to_string(),
            bind_effect: "0".to_string(),
            bind_effect_2: "0".to_string(),
            description: String::new(),
        }
    }

    #[test]
    fn builds_sorted_gem_options_from_stone_info_and_item_info() {
        let mut by_item_id = HashMap::new();
        by_item_id.insert(
            2002,
            StoneInfoEntry {
                id: 22,
                item_id: 2002,
                equip_pos: vec![1, 2, 3],
                stone_type: 7,
                hint_func: "HintB".to_string(),
            },
        );
        by_item_id.insert(
            1001,
            StoneInfoEntry {
                id: 11,
                item_id: 1001,
                equip_pos: vec![4, 5, 6],
                stone_type: 3,
                hint_func: "HintA".to_string(),
            },
        );
        by_item_id.insert(
            9999,
            StoneInfoEntry {
                id: 99,
                item_id: 9999,
                equip_pos: vec![],
                stone_type: 1,
                hint_func: "MissingItem".to_string(),
            },
        );

        let options = build_forge_glow_gem_options(
            &StoneInfoTable { by_item_id },
            &[item(2002, "Gem B"), item(1001, "Gem A")],
        );

        assert_eq!(
            options,
            vec![
                ForgeGlowGemOption {
                    item_id: 1001,
                    item_name: "Gem A".to_string(),
                    stone_info_id: 11,
                    stone_type: 3,
                    equip_pos: vec![4, 5, 6],
                    hint_func: "HintA".to_string(),
                },
                ForgeGlowGemOption {
                    item_id: 2002,
                    item_name: "Gem B".to_string(),
                    stone_info_id: 22,
                    stone_type: 7,
                    equip_pos: vec![1, 2, 3],
                    hint_func: "HintB".to_string(),
                },
            ],
        );
    }
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
    let (uuid, project) = project_from_id(&project_id)?;
    let mut draft = storage::load_draft(project.project_directory.as_ref(), &draft_id)
        .map_err(|e| e.to_string())?;
    hydrate_weapon_model_id(uuid, &mut draft);
    Ok(draft)
}

#[tauri::command]
pub async fn save_forge_glow_draft(
    project_id: String,
    mut draft: ForgeGlowDraft,
) -> Result<ForgeGlowDraft, String> {
    let (uuid, project) = project_from_id(&project_id)?;
    hydrate_weapon_model_id(uuid, &mut draft);
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
    let (uuid, project) = project_from_id(&project_id)?;
    let mut draft = storage::load_draft(project.project_directory.as_ref(), &draft_id)
        .map_err(|e| e.to_string())?;
    hydrate_weapon_model_id(uuid, &mut draft);
    export::export_package(project.project_directory.as_ref(), &draft, &variant_ids)
        .map_err(|e| e.to_string())
}
