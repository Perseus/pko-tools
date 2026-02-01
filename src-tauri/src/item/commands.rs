use std::str::FromStr;

use serde::Serialize;

use crate::{preferences, projects::project::Project, AppState};

use super::{
    info::{get_all_items, get_item},
    lit,
    refine,
    sceneffect,
    Item, ItemMetadata,
};

#[tauri::command]
pub async fn get_item_list(project_id: String) -> Result<Vec<Item>, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;

    get_all_items(project_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn load_item_model(
    project_id: String,
    model_id: String,
) -> Result<String, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    // We need any Item to call get_gltf_json, but the model loading only uses project_dir + model_id.
    // Create a minimal Item just to call the method.
    let dummy_item = Item {
        id: 0,
        name: String::new(),
        icon_name: String::new(),
        model_ground: model_id.clone(),
        model_lance: "0".to_string(),
        model_carsise: "0".to_string(),
        model_phyllis: "0".to_string(),
        model_ami: "0".to_string(),
        item_type: 0,
        display_effect: "0".to_string(),
        bind_effect: "0".to_string(),
        bind_effect_2: "0".to_string(),
        description: String::new(),
    };

    dummy_item
        .get_gltf_json(project.project_directory.as_ref(), &model_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_item_lit_info(
    project_id: String,
    item_id: u32,
) -> Result<Option<lit::ItemLitInfo>, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    lit::get_item_lit_info(project.project_directory.as_ref(), item_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn load_lit_texture_bytes(
    project_id: String,
    texture_name: String,
) -> Result<String, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    let texture_path = project.project_directory.join("texture/lit").join(&texture_name);

    // Case-insensitive file lookup
    let resolved = resolve_case_insensitive(texture_path.to_str().unwrap_or(""))
        .unwrap_or(texture_path);

    let bytes = std::fs::read(&resolved)
        .map_err(|e| format!("Failed to read lit texture {}: {}", resolved.display(), e))?;

    Ok(base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        bytes,
    ))
}

#[tauri::command]
pub async fn get_refine_effects(project_id: String) -> Result<refine::RefineEffectTable, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    refine::load_refine_effects(project.project_directory.as_ref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_item_metadata(
    project_id: String,
    item_id: u32,
    model_id: String,
) -> Result<ItemMetadata, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    let item = get_item(project_id, item_id).map_err(|e| e.to_string())?;

    item.get_metadata(project.project_directory.as_ref(), &model_id)
        .map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct ItemExportResult {
    pub file_path: String,
    pub folder_path: String,
}

#[tauri::command]
pub async fn export_item_to_gltf(
    app_state: tauri::State<'_, AppState>,
    item_id: u32,
    model_id: String,
) -> Result<ItemExportResult, String> {
    let current_project = app_state.preferences.get_current_project();
    if current_project.is_none() {
        return Err("No project selected".to_string());
    }

    let project_id = current_project.unwrap();
    let project_uuid =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project =
        Project::get_project(project_uuid).map_err(|e| format!("Failed to get project: {}", e))?;

    let exports_dir = project
        .project_directory
        .join("pko-tools")
        .join("exports")
        .join("item");
    std::fs::create_dir_all(&exports_dir)
        .map_err(|e| format!("Failed to create exports directory: {}", e))?;

    let item = get_item(project_uuid, item_id).map_err(|e| e.to_string())?;

    let gltf_json = item
        .get_gltf_json(project.project_directory.as_ref(), &model_id)
        .map_err(|e| e.to_string())?;

    let file_path = exports_dir.join(format!("item_{}_{}.gltf", item_id, model_id));
    std::fs::write(&file_path, gltf_json.as_bytes())
        .map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(ItemExportResult {
        file_path: file_path.to_string_lossy().to_string(),
        folder_path: exports_dir.to_string_lossy().to_string(),
    })
}

// ============================================================================
// Forge effect preview
// ============================================================================

#[derive(Serialize)]
pub struct ParticleEffectInfo {
    pub par_file: String,
    pub dummy_id: i32,
    pub scale: f32,
    pub effect_id: u32,
}

#[derive(Serialize)]
pub struct ForgeEffectPreview {
    pub lit_id: Option<i32>,
    pub lit_entry: Option<lit::ItemLitEntry>,
    pub particles: Vec<ParticleEffectInfo>,
    pub effect_level: u32,
    pub alpha: f32,
}

/// Compute the alpha (opacity multiplier) for a given total stone level.
/// Ported from SItemForge::GetAlpha in UIItemCommand.cpp.
pub(crate) fn compute_forge_alpha(total_level: u32) -> f32 {
    let level_alpha: [f32; 4] = [80.0, 140.0, 200.0, 255.0];
    let level_base: [f32; 4] = [
        level_alpha[1] - level_alpha[0],
        level_alpha[2] - level_alpha[1],
        level_alpha[3] - level_alpha[2],
        0.0,
    ];

    if total_level <= 1 {
        return level_alpha[0] / 255.0;
    }
    if total_level >= 13 {
        return 1.0;
    }

    let tl = total_level - 1;
    let tier = (tl / 4) as usize;
    let frac = (tl % 4) as f32 / 4.0;
    (level_alpha[tier] + frac * level_base[tier]) / 255.0
}

/// Resolve the full forge effect chain for a given item.
///
/// Chain: item_type → ItemRefineInfo → ItemRefineEffectInfo → sceneffectinfo → resolved filenames
///
/// Parameters:
/// - `item_type`: The item's type ID (used to look up ItemRefineInfo)
/// - `refine_level`: Total stone level sum (0-12), determines effect tier and alpha
/// - `char_type`: Character class (0=Lance, 1=Carsise, 2=Phyllis, 3=Ami)
/// - `effect_category`: Stone combination category (0-13, from Item_Stoneeffect)
#[tauri::command]
pub async fn get_forge_effect_preview(
    project_id: String,
    item_type: u32,
    refine_level: u32,
    char_type: u32,
    effect_category: u32,
) -> Result<ForgeEffectPreview, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;
    let project_dir = project.project_directory.as_ref();

    // Compute effect level (0-3 tier) from refine level
    let effect_level = if refine_level >= 1 {
        ((refine_level - 1) / 4).min(3)
    } else {
        0
    };

    let alpha = compute_forge_alpha(refine_level);

    // The C++ code does: nEffectID = Item_Stoneeffect() - 1 (0-indexed into Value[14])
    // effect_category is already 0-based from the frontend (the Lua function returns 1-based,
    // but we use the direct category index here)
    if effect_category == 0 || refine_level == 0 {
        return Ok(ForgeEffectPreview {
            lit_id: None,
            lit_entry: None,
            particles: vec![],
            effect_level,
            alpha,
        });
    }

    // C++ does: nEffectID-- (convert from 1-based Lua return to 0-based index)
    let effect_idx = (effect_category - 1) as usize;
    if effect_idx >= 14 {
        return Ok(ForgeEffectPreview {
            lit_id: None,
            lit_entry: None,
            particles: vec![],
            effect_level,
            alpha,
        });
    }

    // Step 1: Look up ItemRefineInfo by item_type
    let refine_info_table =
        refine::load_item_refine_info(project_dir).map_err(|e| e.to_string())?;
    let refine_info = match refine_info_table.entries.get(&(item_type as i32)) {
        Some(info) => info,
        None => {
            return Ok(ForgeEffectPreview {
                lit_id: None,
                lit_entry: None,
                particles: vec![],
                effect_level,
                alpha,
            });
        }
    };

    // Step 2: Get refine_effect_id from Value[effect_idx]
    let refine_effect_id = refine_info.values.get(effect_idx).copied().unwrap_or(0);
    if refine_effect_id <= 0 {
        return Ok(ForgeEffectPreview {
            lit_id: None,
            lit_entry: None,
            particles: vec![],
            effect_level,
            alpha,
        });
    }

    // Step 3: Look up ItemRefineEffectInfo by refine_effect_id
    let refine_effect_table =
        refine::load_refine_effects(project_dir).map_err(|e| e.to_string())?;
    let effect_entry = refine_effect_table
        .entries
        .iter()
        .find(|e| e.id == refine_effect_id as i32);
    let effect_entry = match effect_entry {
        Some(e) => e,
        None => {
            return Ok(ForgeEffectPreview {
                lit_id: None,
                lit_entry: None,
                particles: vec![],
                effect_level,
                alpha,
            });
        }
    };

    // Step 4: Resolve lit glow
    let lit_id = if effect_entry.light_id != 0 {
        Some(effect_entry.light_id)
    } else {
        None
    };

    let lit_entry = if let Some(lid) = lit_id {
        let lit_info =
            lit::get_item_lit_info(project_dir, lid as u32).map_err(|e| e.to_string())?;
        lit_info.and_then(|info| {
            // Select lit entry by effect level/tier
            let tier = effect_level as usize;
            info.lits.get(tier).cloned().or_else(|| info.lits.first().cloned())
        })
    } else {
        None
    };

    // Step 5: Resolve particle effects via sceneffectinfo
    let scene_effects =
        sceneffect::load_scene_effect_info(project_dir).map_err(|e| e.to_string())?;

    let char_idx = (char_type as usize).min(3);
    let cha_scale = refine_info
        .cha_effect_scale
        .get(char_idx)
        .copied()
        .unwrap_or(1.0);
    let cha_scale = if cha_scale <= 0.0 { 1.0 } else { cha_scale };

    let mut particles = Vec::new();

    // sEffectID is [cha_type][tier] flattened as [c0t0, c0t1, c0t2, c0t3, c1t0, ...]
    // For a given char_type, iterate over tiers 0..effect_num
    // The game uses: nEffectID = sEffectID[nCharID][i] * 10 + Level
    for tier in 0..4 {
        let flat_idx = char_idx * 4 + tier;
        let base_id = effect_entry
            .effect_ids
            .get(flat_idx)
            .copied()
            .unwrap_or(0);
        if base_id == 0 {
            continue;
        }

        // Only include effects up to the current effect level
        if tier > effect_level as usize {
            break;
        }

        let scene_effect_id = (base_id as i32) * 10 + (effect_level as i32);
        let dummy_id = effect_entry.dummy_ids.get(tier).copied().unwrap_or(0) as i32;

        if let Some(scene_eff) = scene_effects.get(&(scene_effect_id as u32)) {
            particles.push(ParticleEffectInfo {
                par_file: scene_eff.filename.clone(),
                dummy_id,
                scale: cha_scale,
                effect_id: scene_effect_id as u32,
            });
        }
    }

    Ok(ForgeEffectPreview {
        lit_id,
        lit_entry,
        particles,
        effect_level,
        alpha,
    })
}

/// Resolve a file path using case-insensitive matching on the filename component.
fn resolve_case_insensitive(path: &str) -> Option<std::path::PathBuf> {
    let p = std::path::Path::new(path);
    if p.exists() {
        return Some(p.to_path_buf());
    }

    let parent = p.parent()?;
    let file_name = p.file_name()?.to_str()?.to_lowercase();
    let entries = std::fs::read_dir(parent).ok()?;

    for entry in entries.flatten() {
        if let Some(name) = entry.file_name().to_str() {
            if name.to_lowercase() == file_name {
                return Some(entry.path());
            }
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn forge_alpha_level_zero() {
        // Level 0 and 1 both return base alpha = 80/255
        let a = compute_forge_alpha(0);
        assert!((a - 80.0 / 255.0).abs() < 1e-6);
    }

    #[test]
    fn forge_alpha_level_one() {
        let a = compute_forge_alpha(1);
        assert!((a - 80.0 / 255.0).abs() < 1e-6);
    }

    #[test]
    fn forge_alpha_level_thirteen_or_above() {
        assert!((compute_forge_alpha(13) - 1.0).abs() < 1e-6);
        assert!((compute_forge_alpha(14) - 1.0).abs() < 1e-6);
        assert!((compute_forge_alpha(100) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn forge_alpha_tier_boundaries() {
        // Level 5 → tl=4, tier=1, frac=0 → level_alpha[1] = 140/255
        let a5 = compute_forge_alpha(5);
        assert!((a5 - 140.0 / 255.0).abs() < 1e-6);

        // Level 9 → tl=8, tier=2, frac=0 → level_alpha[2] = 200/255
        let a9 = compute_forge_alpha(9);
        assert!((a9 - 200.0 / 255.0).abs() < 1e-6);
    }

    #[test]
    fn forge_alpha_mid_tier_interpolation() {
        // Level 3 → tl=2, tier=0, frac=2/4=0.5
        // alpha = (80 + 0.5 * (140-80)) / 255 = (80 + 30) / 255 = 110/255
        let a3 = compute_forge_alpha(3);
        assert!((a3 - 110.0 / 255.0).abs() < 1e-6);
    }

    #[test]
    fn forge_alpha_monotonically_increasing() {
        let mut prev = compute_forge_alpha(0);
        for level in 1..=12 {
            let cur = compute_forge_alpha(level);
            assert!(cur >= prev, "alpha should increase: level {} ({}) >= level {} ({})", level, cur, level - 1, prev);
            prev = cur;
        }
    }
}
