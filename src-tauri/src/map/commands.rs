use std::sync::Arc;
use std::str::FromStr;

use tauri::State;

use crate::AppState;
use crate::projects::project::Project;

use super::terrain;
use super::lmo_types::BuildingMetadata;
use super::{BuildingEntry, MapEntry, MapExportResult, MapMetadata, MapPlacementPage, MapPlacementRecord, MapPlacementSummary};

fn load_map_placements_cached(
    app_state: &AppState,
    project_id: uuid::Uuid,
    project_dir: &std::path::Path,
    map_name: &str,
) -> Result<Arc<Vec<MapPlacementRecord>>, String> {
    let cache_key = (project_id, map_name.to_string());

    {
        let cache = app_state
            .map_placement_cache
            .lock()
            .map_err(|e| e.to_string())?;
        if let Some(cached) = cache.get(&cache_key) {
            return Ok(Arc::clone(cached));
        }
    }

    let obj_path = project_dir.join("map").join(format!("{map_name}.obj"));
    if !obj_path.exists() {
        return Ok(Arc::new(Vec::new()));
    }

    let data = std::fs::read(&obj_path).map_err(|e| e.to_string())?;
    let parsed = super::obj_loader::load_obj(&data).map_err(|e| e.to_string())?;
    let building_info = super::scene_obj_info::load_scene_obj_info(project_dir)
        .map_err(|e| e.to_string())?;
    let effect_info = crate::item::sceneffect::load_scene_effect_info(project_dir)
        .map_err(|e| e.to_string())?;

    let mut placements = Vec::with_capacity(parsed.objects.len());
    for (index, obj) in parsed.objects.iter().enumerate() {
        let (kind, display_name, asset_name, attach_effect_id) = match obj.obj_type {
            0 => {
                let info = building_info.get(&(obj.obj_id as u32));
                (
                    "building".to_string(),
                    info.and_then(|v| (!v.display_name.is_empty()).then(|| v.display_name.clone())),
                    info.map(|v| v.filename.clone()),
                    info.map(|v| v.attach_effect_id),
                )
            }
            1 => {
                let info = effect_info.get(&(obj.obj_id as u32));
                (
                    "effect".to_string(),
                    info.and_then(|v| (!v.display_name.is_empty()).then(|| v.display_name.clone())),
                    info.map(|v| v.filename.clone()),
                    None,
                )
            }
            _ => ("unknown".to_string(), None, None, None),
        };

        placements.push(MapPlacementRecord {
            index: index as u32,
            obj_type: obj.obj_type,
            obj_id: obj.obj_id as u32,
            kind,
            world_x: obj.world_x,
            world_y: obj.world_y,
            world_z: obj.world_z,
            yaw_angle: obj.yaw_angle,
            scale: obj.scale,
            display_name,
            asset_name,
            attach_effect_id,
            distance: None,
        });
    }

    let placements = Arc::new(placements);
    let mut cache = app_state
        .map_placement_cache
        .lock()
        .map_err(|e| e.to_string())?;
    cache.insert(cache_key, Arc::clone(&placements));
    Ok(placements)
}

#[tauri::command]
pub async fn get_map_placement_summary(
    app_state: State<'_, AppState>,
    project_id: String,
    map_name: String,
) -> Result<MapPlacementSummary, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;
    let placements = load_map_placements_cached(
        app_state.inner(),
        project_id,
        project.project_directory.as_ref(),
        &map_name,
    )?;

    let mut building_count = 0u32;
    let mut effect_count = 0u32;
    for placement in placements.iter() {
        match placement.obj_type {
            0 => building_count += 1,
            1 => effect_count += 1,
            _ => {}
        }
    }

    Ok(MapPlacementSummary {
        total: placements.len() as u32,
        building_count,
        effect_count,
    })
}

#[tauri::command]
pub async fn query_map_placements(
    app_state: State<'_, AppState>,
    project_id: String,
    map_name: String,
    query: Option<String>,
    placement_type: Option<String>,
    near_x: Option<f32>,
    near_y: Option<f32>,
    near_radius: Option<f32>,
    offset: Option<u32>,
    limit: Option<u32>,
) -> Result<MapPlacementPage, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;
    let placements = load_map_placements_cached(
        app_state.inner(),
        project_id,
        project.project_directory.as_ref(),
        &map_name,
    )?;

    let query = query.unwrap_or_default().trim().to_ascii_lowercase();
    let placement_type = placement_type.unwrap_or_else(|| "all".to_string());
    let near_center = match (near_x, near_y) {
        (Some(x), Some(y)) => Some((x, y)),
        _ => None,
    };
    let near_radius = near_radius.unwrap_or(50.0).max(0.0);
    let offset = offset.unwrap_or(0) as usize;
    let limit = limit.unwrap_or(200).clamp(1, 500) as usize;

    let mut filtered: Vec<MapPlacementRecord> = placements
        .iter()
        .filter(|placement| match placement_type.as_str() {
            "building" => placement.obj_type == 0,
            "effect" => placement.obj_type == 1,
            _ => true,
        })
        .filter(|placement| {
            if query.is_empty() {
                return true;
            }

            let id_matches = placement.obj_id.to_string().contains(&query)
                || placement.index.to_string().contains(&query);
            let display_matches = placement
                .display_name
                .as_deref()
                .map(|v| v.to_ascii_lowercase().contains(&query))
                .unwrap_or(false);
            let asset_matches = placement
                .asset_name
                .as_deref()
                .map(|v| v.to_ascii_lowercase().contains(&query))
                .unwrap_or(false);

            id_matches || display_matches || asset_matches || placement.kind.contains(&query)
        })
        .filter_map(|placement| {
            if let Some((x, y)) = near_center {
                let dx = placement.world_x - x;
                let dy = placement.world_y - y;
                let distance = (dx * dx + dy * dy).sqrt();
                if distance > near_radius {
                    return None;
                }

                let mut placement = placement.clone();
                placement.distance = Some(distance);
                Some(placement)
            } else {
                Some(placement.clone())
            }
        })
        .collect();

    if near_center.is_some() {
        filtered.sort_by(|a, b| {
            a.distance
                .unwrap_or(f32::MAX)
                .partial_cmp(&b.distance.unwrap_or(f32::MAX))
                .unwrap_or(std::cmp::Ordering::Equal)
        });
    }

    let total = filtered.len() as u32;
    let items = filtered
        .into_iter()
        .skip(offset)
        .take(limit)
        .collect();

    Ok(MapPlacementPage {
        total,
        offset: offset as u32,
        limit: limit as u32,
        items,
    })
}

#[tauri::command]
pub async fn get_map_list(project_id: String) -> Result<Vec<MapEntry>, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    terrain::scan_maps(project.project_directory.as_ref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn load_map_terrain(project_id: String, map_name: String) -> Result<String, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    terrain::build_map_viewer_gltf(project.project_directory.as_ref(), &map_name)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_map_metadata(project_id: String, map_name: String) -> Result<MapMetadata, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    terrain::get_metadata(project.project_directory.as_ref(), &map_name).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn export_map_to_gltf(
    project_id: String,
    map_name: String,
) -> Result<MapExportResult, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    let exports_dir = project
        .project_directory
        .join("pko-tools")
        .join("exports")
        .join("map");

    terrain::export_terrain_gltf(project.project_directory.as_ref(), &map_name, &exports_dir)
        .map_err(|e| e.to_string())
}

// ============================================================================
// Shared asset export
// ============================================================================

#[tauri::command]
pub async fn export_shared_assets(
    project_id: String,
    output_dir: Option<String>,
) -> Result<super::shared::SharedExportResult, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    let out_dir = match output_dir {
        Some(dir) => std::path::PathBuf::from(dir),
        None => project
            .project_directory
            .join("pko-tools")
            .join("exports")
            .join("Shared"),
    };

    super::shared::export_shared_assets(project.project_directory.as_ref(), &out_dir)
        .map_err(|e| e.to_string())
}

// ============================================================================
// Building commands
// ============================================================================

#[tauri::command]
pub async fn get_building_list(project_id: String) -> Result<Vec<BuildingEntry>, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    let obj_info = super::scene_obj_info::load_scene_obj_info(project.project_directory.as_ref())
        .map_err(|e| e.to_string())?;

    let mut entries: Vec<BuildingEntry> = obj_info
        .into_values()
        .map(|info| {
            let display_name = info
                .filename
                .strip_suffix(".lmo")
                .or_else(|| info.filename.strip_suffix(".LMO"))
                .unwrap_or(&info.filename)
                .to_string();

            BuildingEntry {
                id: info.id,
                filename: info.filename,
                display_name,
            }
        })
        .collect();

    entries.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(entries)
}

#[tauri::command]
pub async fn load_building_model(project_id: String, building_id: u32) -> Result<String, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    let obj_info = super::scene_obj_info::load_scene_obj_info(project.project_directory.as_ref())
        .map_err(|e| e.to_string())?;

    let info = obj_info
        .get(&building_id)
        .ok_or_else(|| format!("Building ID {} not found in sceneobjinfo", building_id))?;

    let lmo_path =
        super::scene_model::find_lmo_path(project.project_directory.as_ref(), &info.filename)
            .ok_or_else(|| format!("LMO file not found: {}", info.filename))?;

    super::scene_model::build_gltf_from_lmo(&lmo_path, project.project_directory.as_ref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn export_building_to_gltf(
    project_id: String,
    building_id: u32,
    output_dir: String,
) -> Result<String, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    let obj_info = super::scene_obj_info::load_scene_obj_info(project.project_directory.as_ref())
        .map_err(|e| e.to_string())?;

    let info = obj_info
        .get(&building_id)
        .ok_or_else(|| format!("Building ID {} not found in sceneobjinfo", building_id))?;

    let lmo_path =
        super::scene_model::find_lmo_path(project.project_directory.as_ref(), &info.filename)
            .ok_or_else(|| format!("LMO file not found: {}", info.filename))?;

    let gltf_json =
        super::scene_model::build_gltf_from_lmo(&lmo_path, project.project_directory.as_ref())
            .map_err(|e| e.to_string())?;

    let out_dir = std::path::Path::new(&output_dir);
    std::fs::create_dir_all(out_dir).map_err(|e| e.to_string())?;

    let stem = info
        .filename
        .strip_suffix(".lmo")
        .or_else(|| info.filename.strip_suffix(".LMO"))
        .unwrap_or(&info.filename);
    let gltf_path = out_dir.join(format!("{}.gltf", stem));
    std::fs::write(&gltf_path, gltf_json.as_bytes()).map_err(|e| e.to_string())?;

    Ok(gltf_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn get_building_metadata(
    project_id: String,
    building_id: u32,
) -> Result<BuildingMetadata, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    let obj_info = super::scene_obj_info::load_scene_obj_info(project.project_directory.as_ref())
        .map_err(|e| e.to_string())?;

    let info = obj_info
        .get(&building_id)
        .ok_or_else(|| format!("Building ID {} not found in sceneobjinfo", building_id))?;

    let lmo_path =
        super::scene_model::find_lmo_path(project.project_directory.as_ref(), &info.filename)
            .ok_or_else(|| format!("LMO file not found: {}", info.filename))?;

    let lmo = super::lmo_loader::load_lmo(&lmo_path).map_err(|e| e.to_string())?;

    Ok(super::lmo_types::build_metadata(&lmo, building_id, &info.filename))
}
