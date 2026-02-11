use std::str::FromStr;

use serde::Serialize;

use crate::{projects::project::Project, AppState};

use super::{
    info::{get_all_items, get_item},
    lit,
    model,
    refine,
    sceneffect,
    workbench,
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

#[derive(Serialize)]
pub struct ItemImportResult {
    pub lgo_file: String,
    pub texture_files: Vec<String>,
    pub import_dir: String,
}

#[tauri::command]
pub async fn import_item_from_gltf(
    app_state: tauri::State<'_, AppState>,
    model_id: String,
    file_path: String,
    scale_factor: Option<f32>,
) -> Result<ItemImportResult, String> {
    let current_project = app_state.preferences.get_current_project();
    if current_project.is_none() {
        return Err("No project selected".to_string());
    }

    let project_id = current_project.unwrap();
    let project_uuid =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project =
        Project::get_project(project_uuid).map_err(|e| format!("Failed to get project: {}", e))?;

    let import_dir = project
        .project_directory
        .join("pko-tools")
        .join("imports")
        .join("item");

    let gltf_path = std::path::Path::new(&file_path);
    if !gltf_path.exists() {
        return Err(format!("File not found: {}", file_path));
    }

    let result = model::import_item_from_gltf(gltf_path, &model_id, &import_dir, scale_factor.unwrap_or(1.0))
        .map_err(|e| format!("Import failed: {}", e))?;

    Ok(ItemImportResult {
        lgo_file: result.lgo_file.to_string_lossy().to_string(),
        texture_files: result
            .texture_files
            .iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect(),
        import_dir: import_dir.to_string_lossy().to_string(),
    })
}

// ============================================================================
// Model preview from file path
// ============================================================================

#[tauri::command]
pub async fn load_model_preview(lgo_path: String, has_overlay: Option<bool>) -> Result<String, String> {
  let path = std::path::Path::new(&lgo_path);
  if !path.exists() {
    return Err(format!("LGO file not found: {}", lgo_path));
  }

    // Use the LGO's grandparent directory as texture search dir.
    // For imports at `imports/item/model/{id}.lgo`, textures are at
    // `imports/item/texture/{name}.bmp` — build_single_material searches
    // `project_dir/texture/` which matches this layout when project_dir = `imports/item/`.
    let texture_search_dir = path
        .parent()  // imports/item/model/
        .and_then(|p| p.parent())  // imports/item/
        .unwrap_or(path);

  let use_overlay = has_overlay.unwrap_or(false);
  if use_overlay {
    model::build_gltf_from_lgo_with_overlay(path, texture_search_dir, true).map_err(|e| e.to_string())
  } else {
    model::build_gltf_from_lgo(path, texture_search_dir).map_err(|e| e.to_string())
  }
}

// ============================================================================
// Category availability
// ============================================================================

#[derive(Serialize)]
pub struct CategorySummary {
    pub category: u32,
    pub available: bool,
    pub lit_id: i32,
    pub has_particles: bool,
}

#[derive(Serialize)]
pub struct ItemCategoryAvailability {
    pub item_id: u32,
    pub categories: Vec<CategorySummary>,
}

#[tauri::command]
pub async fn get_item_category_availability(
    project_id: String,
    item_id: u32,
) -> Result<ItemCategoryAvailability, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;
    let project_dir = project.project_directory.as_ref();

    let refine_info_table =
        refine::load_item_refine_info(project_dir).map_err(|e| e.to_string())?;
    let refine_effect_table =
        refine::load_refine_effects(project_dir).map_err(|e| e.to_string())?;

    let refine_info = refine_info_table.entries.get(&(item_id as i32));

    let mut categories = Vec::with_capacity(14);

    for idx in 0..14u32 {
        let refine_effect_id = refine_info
            .and_then(|info| info.values.get(idx as usize).copied())
            .unwrap_or(0);

        let available = refine_effect_id != 0;

        let (lit_id, has_particles) = if available {
            let effect_entry = refine_effect_table
                .entries
                .iter()
                .find(|e| e.id == refine_effect_id as i32);

            match effect_entry {
                Some(entry) => {
                    let has_particles = entry.effect_ids.iter().any(|&eid| eid != 0);
                    (entry.light_id, has_particles)
                }
                None => (0, false),
            }
        } else {
            (0, false)
        };

        categories.push(CategorySummary {
            category: idx + 1,
            available,
            lit_id,
            has_particles,
        });
    }

    Ok(ItemCategoryAvailability {
        item_id,
        categories,
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
/// Chain: item_id → ItemRefineInfo → ItemRefineEffectInfo → sceneffectinfo → resolved filenames
///
/// The game's C++ code calls `GetItemRefineInfo(nItemID)` where `nItemID` is the item's
/// database ID (e.g. 5001 for "Sword of Azure Flame"), NOT the item_type.
/// The CRawDataSet performs a direct array lookup: `_RawDataArray[nID - _nIDStart]`.
///
/// Parameters:
/// - `item_id`: The item's database ID (nID from ItemInfo.txt column 0)
/// - `refine_level`: Total stone level sum (0-12), determines effect tier and alpha
/// - `char_type`: Character class (0=Lance, 1=Carsise, 2=Phyllis, 3=Ami)
/// - `effect_category`: Stone combination category (0-13, from Item_Stoneeffect)
#[tauri::command]
pub async fn get_forge_effect_preview(
    project_id: String,
    item_id: u32,
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

    // Step 1: Look up ItemRefineInfo by item_id (the item's database ID)
    let refine_info_table =
        refine::load_item_refine_info(project_dir).map_err(|e| e.to_string())?;
    let refine_info = match refine_info_table.entries.get(&(item_id as i32)) {
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

    // The game iterates ALL tiers (0..GetEffectNum) regardless of refine level.
    // sEffectID[nCharID][tier] * 10 + Level gives the scene_effect_id.
    // The progressive reveal comes from sceneffectinfo: at lower levels, some
    // scene_effect_ids don't exist in the table, so those tiers silently don't render.
    // At higher levels more entries exist → more tiers appear.
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

// ============================================================================
// Table decompile commands
// ============================================================================

#[tauri::command]
pub async fn decompile_item_refine_info(
    project_id: String,
) -> Result<crate::decompiler::DecompileResult, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;
    let project_dir = project.project_directory.as_ref();

    let input_path = project_dir.join("scripts/table/ItemRefineInfo.bin");
    let output_path = project_dir
        .join("pko-tools")
        .join("exports")
        .join("tables")
        .join("ItemRefineInfo.txt");

    let structure = crate::decompiler::create_item_refine_info();
    crate::decompiler::decompile_rawdataset_to_tsv(&input_path, &output_path, &structure)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn decompile_item_refine_effect_info(
    project_id: String,
) -> Result<crate::decompiler::DecompileResult, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;
    let project_dir = project.project_directory.as_ref();

    let input_path = project_dir.join("scripts/table/ItemRefineEffectInfo.bin");
    let output_path = project_dir
        .join("pko-tools")
        .join("exports")
        .join("tables")
        .join("ItemRefineEffectInfo.txt");

    let structure = crate::decompiler::create_item_refine_effect_info();
    crate::decompiler::decompile_rawdataset_to_tsv(&input_path, &output_path, &structure)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn decompile_scene_effect_info(
    project_id: String,
) -> Result<crate::decompiler::DecompileResult, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;
    let project_dir = project.project_directory.as_ref();

    let input_path = project_dir.join("scripts/table/sceneffectinfo.bin");
    let output_path = project_dir
        .join("pko-tools")
        .join("exports")
        .join("tables")
        .join("sceneffectinfo.txt");

    let structure = crate::decompiler::create_scene_effect_info();
    crate::decompiler::decompile_rawdataset_to_tsv(&input_path, &output_path, &structure)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn decompile_stone_info(
    project_id: String,
) -> Result<crate::decompiler::DecompileResult, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;
    let project_dir = project.project_directory.as_ref();

    let input_path = project_dir.join("scripts/table/StoneInfo.bin");
    let output_path = project_dir
        .join("pko-tools")
        .join("exports")
        .join("tables")
        .join("StoneInfo.txt");

    let structure = crate::decompiler::create_stone_info();
    crate::decompiler::decompile_rawdataset_to_tsv(&input_path, &output_path, &structure)
        .map_err(|e| e.to_string())
}

// ============================================================================
// Workbench commands
// ============================================================================

#[tauri::command]
pub async fn add_glow_overlay(lgo_path: String) -> Result<String, String> {
    let path = std::path::Path::new(&lgo_path);
    if !path.exists() {
        return Err(format!("LGO file not found: {}", lgo_path));
    }

    workbench::add_glow_overlay(path).map_err(|e| e.to_string())?;

    // Return regenerated glTF preview
    let texture_search_dir = path
        .parent()
        .and_then(|p| p.parent())
        .unwrap_or(path);

    model::build_gltf_from_lgo_with_overlay(path, texture_search_dir, true)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn export_item(
    project_id: String,
    lgo_path: String,
    target_model_id: String,
) -> Result<workbench::ExportResult, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    let path = std::path::Path::new(&lgo_path);
    if !path.exists() {
        return Err(format!("LGO file not found: {}", lgo_path));
    }

    workbench::export_item(
        project.project_directory.as_ref(),
        path,
        &target_model_id,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rotate_item(
    lgo_path: String,
    x_deg: f32,
    y_deg: f32,
    z_deg: f32,
) -> Result<String, String> {
    let path = std::path::Path::new(&lgo_path);
    if !path.exists() {
        return Err(format!("LGO file not found: {}", lgo_path));
    }

    workbench::rotate_lgo(path, x_deg, y_deg, z_deg).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rescale_item(
    project_id: String,
    model_id: String,
    lgo_path: String,
    factor: f32,
) -> Result<String, String> {
    let path = std::path::Path::new(&lgo_path);
    if !path.exists() {
        return Err(format!("LGO file not found: {}", lgo_path));
    }

    let gltf_json = workbench::rescale_lgo(path, factor).map_err(|e| e.to_string())?;

    // Update scale_factor in the database (cumulative)
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    let db = project.db_arc();
    let conn = db.lock().map_err(|_| "Could not lock database".to_string())?;

    conn.execute(
        "UPDATE workbenches SET scale_factor = scale_factor * ?1, modified_at = ?2 WHERE model_id = ?3",
        rusqlite::params![
            factor as f64,
            {
                let secs = std::time::SystemTime::now()
                    .duration_since(std::time::SystemTime::UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs();
                format!("{}", secs)
            },
            model_id
        ],
    ).map_err(|e| e.to_string())?;

    Ok(gltf_json)
}

#[tauri::command]
pub async fn create_workbench(
    project_id: String,
    model_id: String,
    item_name: String,
    item_type: u32,
    source_file: Option<String>,
    scale_factor: f32,
    lgo_path: String,
) -> Result<(), String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    let db = project.db_arc();
    let conn = db.lock().map_err(|_| "Could not lock database".to_string())?;

    workbench::create_workbench(
        &conn,
        &model_id,
        &item_name,
        item_type,
        source_file.as_deref(),
        scale_factor,
        &lgo_path,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn load_workbench(
    project_id: String,
    model_id: String,
) -> Result<workbench::WorkbenchState, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    let db = project.db_arc();
    let conn = db.lock().map_err(|_| "Could not lock database".to_string())?;

    workbench::load_workbench(&conn, &model_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_workbench(
    project_id: String,
    state: workbench::WorkbenchState,
) -> Result<(), String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    let db = project.db_arc();
    let conn = db.lock().map_err(|_| "Could not lock database".to_string())?;

    workbench::save_workbench(&conn, &state).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_workbenches(
    project_id: String,
) -> Result<Vec<workbench::WorkbenchSummary>, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    let db = project.db_arc();
    let conn = db.lock().map_err(|_| "Could not lock database".to_string())?;

    workbench::list_workbenches(&conn).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn delete_workbench(
    project_id: String,
    model_id: String,
) -> Result<(), String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    let db = project.db_arc();
    let conn = db.lock().map_err(|_| "Could not lock database".to_string())?;

    workbench::delete_workbench(&conn, &model_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_dummies(
    project_id: String,
    model_id: String,
    lgo_path: String,
    dummies: Vec<workbench::WorkbenchDummy>,
) -> Result<String, String> {
    let path = std::path::Path::new(&lgo_path);
    if !path.exists() {
        return Err(format!("LGO file not found: {}", lgo_path));
    }

    // Update LGO and get regenerated glTF
    let gltf_json = workbench::update_dummies(path, dummies.clone())
        .map_err(|e| e.to_string())?;

    // Also persist dummies to database
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    let db = project.db_arc();
    let conn = db.lock().map_err(|_| "Could not lock database".to_string())?;

    // Update dummies in the database
    conn.execute(
        "DELETE FROM workbench_dummies WHERE model_id = ?1",
        rusqlite::params![model_id],
    ).map_err(|e| e.to_string())?;

    for dummy in &dummies {
        conn.execute(
            "INSERT INTO workbench_dummies (id, model_id, label, position_x, position_y, position_z)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                dummy.id,
                model_id,
                dummy.label,
                dummy.position[0],
                dummy.position[1],
                dummy.position[2],
            ],
        ).map_err(|e| e.to_string())?;
    }

    // Update has_glow_overlay flag based on current LGO state
    let now = {
        let secs = std::time::SystemTime::now()
            .duration_since(std::time::SystemTime::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        format!("{}", secs)
    };
    conn.execute(
        "UPDATE workbenches SET modified_at = ?1 WHERE model_id = ?2",
        rusqlite::params![now, model_id],
    ).map_err(|e| e.to_string())?;

    Ok(gltf_json)
}

#[tauri::command]
pub async fn generate_item_info_entry(
    project_id: String,
    model_id: String,
    requested_id: Option<u32>,
) -> Result<workbench::ItemInfoPreview, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    let db = project.db_arc();
    let conn = db.lock().map_err(|_| "Could not lock database".to_string())?;

    let state = workbench::load_workbench(&conn, &model_id).map_err(|e| e.to_string())?;

    workbench::generate_item_info_entry(project.project_directory.as_ref(), &state, requested_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn register_item(
    project_id: String,
    model_id: String,
    tsv_line: String,
    assigned_id: u32,
) -> Result<(), String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    let db = project.db_arc();
    let conn = db.lock().map_err(|_| "Could not lock database".to_string())?;

    workbench::register_item(
        project.project_directory.as_ref(),
        &conn,
        &model_id,
        &tsv_line,
        assigned_id,
    )
    .map_err(|e| e.to_string())
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

    #[test]
    fn particle_chain_resolves_for_real_data() {
        use std::path::PathBuf;

        let project_dir = PathBuf::from("../top-client");
        if !project_dir.join("scripts/table/ItemRefineInfo.bin").exists() {
            return;
        }

        // Item 5001, category 7, refine 12, Lance
        let item_id: i32 = 5001;
        let effect_category: u32 = 7;
        let refine_level: u32 = 12;
        let char_type: u32 = 0;

        let effect_level = ((refine_level - 1) / 4).min(3);
        let effect_idx = (effect_category - 1) as usize;

        let refine_info_table = refine::load_item_refine_info(&project_dir).unwrap();
        let refine_info = refine_info_table.entries.get(&item_id).unwrap();
        let refine_effect_id = refine_info.values[effect_idx];
        assert!(refine_effect_id > 0, "category should be available");

        let refine_effect_table = refine::load_refine_effects(&project_dir).unwrap();
        let effect_entry = refine_effect_table
            .entries
            .iter()
            .find(|e| e.id == refine_effect_id as i32)
            .unwrap();

        let scene_effects = sceneffect::load_scene_effect_info(&project_dir).unwrap();
        assert!(scene_effects.len() > 100, "sceneffectinfo.bin should load");

        let char_idx = char_type as usize;
        let base_id = effect_entry.effect_ids[char_idx * 4];
        assert!(base_id > 0, "should have particle effect for tier 0");

        let scene_effect_id = (base_id as u32) * 10 + effect_level;
        let resolved = scene_effects.get(&scene_effect_id);
        assert!(resolved.is_some(), "scene effect {} should exist", scene_effect_id);
        assert!(resolved.unwrap().filename.ends_with(".par"));
    }

    #[test]
    fn eff_file_parses_for_forge_effect() {
        use crate::effect::model::EffFile;
        use std::path::PathBuf;

        let project_dir = PathBuf::from("../top-client");
        let eff_path = project_dir.join("effect/jjyb03.eff");
        if !eff_path.exists() {
            return;
        }

        let bytes = std::fs::read(&eff_path).unwrap();
        let eff = EffFile::from_bytes(&bytes).unwrap();
        assert!(eff.sub_effects.len() > 0, "should have sub-effects");
        // Verify texName contains actual texture names (not effectName labels)
        assert!(!eff.sub_effects[0].tex_name.is_empty());
        // Verify colors are in 0-1 range
        let color = &eff.sub_effects[0].frame_colors[0];
        assert!(color[0] <= 1.0 && color[1] <= 1.0 && color[2] <= 1.0 && color[3] <= 1.0);

        // Verify rotation fields are present and serializable
        // The .eff file should have rotating = true for forge effects (swirly animation)
        let json = serde_json::to_value(&eff).unwrap();
        assert!(json.get("rotating").is_some(), "rotating field should serialize");
        assert!(json.get("rotaVec").is_some(), "rotaVec field should serialize");
        assert!(json.get("rotaVel").is_some(), "rotaVel field should serialize");

        // Check sub-effect rotation fields
        let sub_json = &json["subEffects"][0];
        assert!(sub_json.get("rotaLoop").is_some(), "rotaLoop field should serialize");
        assert!(sub_json.get("rotaLoopVec").is_some(), "rotaLoopVec field should serialize");

        // Dump full sub-effect keyframe data for debugging
        eprintln!("eff rotating={}, rotaVec={:?}, rotaVel={}, subEffects={}",
            eff.rotating, eff.rota_vec, eff.rota_vel, eff.sub_effects.len());
        for (i, sub) in eff.sub_effects.iter().enumerate() {
            eprintln!("  sub[{}]: model='{}' tex='{}' type={} bb={} rb={} rl={}",
                i, sub.model_name, sub.tex_name, sub.effect_type,
                sub.billboard, sub.rota_board, sub.rota_loop);
            if sub.frame_count > 0 {
                eprintln!("    pos[0]={:?} scale[0]={:?} angle[0]={:?} color[0]={:?}",
                    sub.frame_positions[0], sub.frame_sizes[0],
                    sub.frame_angles[0], sub.frame_colors[0]);
            }
            if sub.rota_loop {
                eprintln!("    rotaLoopVec={:?}", sub.rota_loop_vec);
            }
            eprintln!("    cylinder: segs={} h={:.2} topR={:.2} botR={:.2}",
                sub.segments, sub.height, sub.top_radius, sub.bot_radius);
        }
    }

    #[test]
    fn weapon_model_dummy_points() {
        use crate::character::model::CharacterGeometricModel;
        use std::path::PathBuf;

        // Item 5001 uses Lance model 01010027
        let project_dir = PathBuf::from("../top-client");
        let model_path = project_dir.join("model/item/01010027.lgo");
        if !model_path.exists() {
            return;
        }

        let geom = CharacterGeometricModel::from_file(model_path).unwrap();
        let helper = geom.helper_data.as_ref().expect("should have helper data");

        eprintln!("Dummy points for item model 01010027:");
        for dummy in &helper.dummy_seq {
            let m = &dummy.mat;
            eprintln!("  Dummy {}: parent_type={} parent_id={}", dummy.id, dummy.parent_type, dummy.parent_id);
            eprintln!("    mat row0: [{:.3}, {:.3}, {:.3}, {:.3}]", m.0.x.x, m.0.x.y, m.0.x.z, m.0.x.w);
            eprintln!("    mat row1: [{:.3}, {:.3}, {:.3}, {:.3}]", m.0.y.x, m.0.y.y, m.0.y.z, m.0.y.w);
            eprintln!("    mat row2: [{:.3}, {:.3}, {:.3}, {:.3}]", m.0.z.x, m.0.z.y, m.0.z.z, m.0.z.w);
            eprintln!("    mat row3: [{:.3}, {:.3}, {:.3}, {:.3}]", m.0.w.x, m.0.w.y, m.0.w.z, m.0.w.w);
        }
    }
}
