use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::State;

use crate::client_paths;
use crate::item::sceneffect::SceneEffectInfo;
use crate::projects::project::Project;
use crate::AppState;

use super::lmo_types::BuildingMetadata;
use super::{area_set, map_writer, obj_writer, rbo, server_writer, terrain, texture, workbench};
use super::{
    BuildingEntry, MapEntry, MapPlacementPage, MapPlacementRecord, MapPlacementSummary,
    SceneEffectEntry, TerrainTextureEntry,
};

const MAX_WORKBENCH_MAP_CACHE_ENTRIES: usize = 4;
const MAP_EDIT_BACKUP_MANIFEST_FILE: &str = "pko-tools-map-backup.json";
const MAP_EDIT_BACKUP_MANIFEST_VERSION: u32 = 1;
const MAP_HEADER_SIZE: usize = 20;
const MAP_TILE_SIZE: usize = 15;
const TILE_TEXTURE_PREVIEW_SAMPLES_PER_AXIS: i32 = 64;

#[derive(Debug, Clone, Serialize)]
pub struct MapEditExportResult {
    pub map_name: String,
    pub map_path: String,
    pub obj_path: String,
    pub rbo_path: Option<String>,
    pub atr_path: String,
    pub blk_path: String,
    pub tile_patch_count: u32,
    pub placement_edit_count: u32,
    pub map_bytes_written: u64,
    pub obj_bytes_written: u64,
    pub rbo_bytes_written: u64,
    pub rbo_preserved_from_source: bool,
    pub rbo_may_be_stale: bool,
    pub atr_bytes_written: u64,
    pub blk_bytes_written: u64,
    pub map_sha256: String,
    pub obj_sha256: String,
    pub rbo_sha256: Option<String>,
    pub atr_sha256: String,
    pub blk_sha256: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MapEditClientPackage {
    pub map_path: String,
    pub obj_path: String,
    pub rbo_path: Option<String>,
    pub map_bytes: u64,
    pub obj_bytes: u64,
    pub rbo_bytes: u64,
    pub map_sha256: String,
    pub obj_sha256: String,
    pub rbo_sha256: Option<String>,
}

impl MapEditClientPackage {
    fn from_export_result(result: &MapEditExportResult) -> Self {
        Self {
            map_path: result.map_path.clone(),
            obj_path: result.obj_path.clone(),
            rbo_path: result.rbo_path.clone(),
            map_bytes: result.map_bytes_written,
            obj_bytes: result.obj_bytes_written,
            rbo_bytes: result.rbo_bytes_written,
            map_sha256: result.map_sha256.clone(),
            obj_sha256: result.obj_sha256.clone(),
            rbo_sha256: result.rbo_sha256.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct MapEditClientFileBackup {
    pub label: String,
    pub source_path: String,
    pub backup_path: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct MapEditClientApplyResult {
    pub map_name: String,
    pub backup_dir: String,
    pub map_path: String,
    pub obj_path: String,
    pub rbo_path: Option<String>,
    pub map_bytes_written: u64,
    pub obj_bytes_written: u64,
    pub rbo_bytes_written: u64,
    pub backups: Vec<MapEditClientFileBackup>,
}

#[derive(Debug, Clone, Serialize)]
pub struct MapEditClientRestoreResult {
    pub map_name: String,
    pub backup_dir: String,
    pub restore_backup_dir: String,
    pub map_path: String,
    pub obj_path: Option<String>,
    pub rbo_path: Option<String>,
    pub map_bytes_restored: u64,
    pub obj_bytes_restored: u64,
    pub rbo_bytes_restored: u64,
    pub current_backups: Vec<MapEditClientFileBackup>,
    pub removed_paths: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BuildingSceneInfo {
    pub building_id: u32,
    pub filename: String,
    pub display_name: String,
    pub scene_obj_type: i32,
    pub shade_flag: bool,
    pub enable_point_light: bool,
    pub enable_env_light: bool,
    pub attach_effect_id: i32,
    pub style: i32,
    pub flag: i32,
    pub size_flag: i32,
    pub anim_ctrl_id: i32,
    pub is_really_big: bool,
    pub point_color: [u8; 3],
    pub env_color: [u8; 3],
    pub point_range: i32,
    pub point_attenuation: f32,
    pub fade_obj_num: i32,
    pub fade_obj_seq: Vec<i32>,
    pub fade_coefficient: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct MapEditClientBackupManifest {
    version: u32,
    map_name: String,
    files: Vec<MapEditClientBackupManifestFile>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct MapEditClientBackupManifestFile {
    label: String,
    file_name: String,
    existed: bool,
    bytes: u64,
    sha256: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MapEditSourceGuard {
    pub map_source: workbench::SourceFileInfo,
    pub obj_source: workbench::SourceFileInfo,
    pub rbo_source: workbench::SourceFileInfo,
}

struct TableSourceFile {
    name: String,
    data: Vec<u8>,
    source: workbench::SourceFileInfo,
}

struct TableSourceMetadata {
    name: String,
    data: Vec<u8>,
    modified_ms: u64,
    file_len: u64,
    content_sha256: String,
}

#[derive(Debug, Clone, Copy)]
enum MapSourceValidationWindow {
    Chunk {
        chunk_x: i32,
        chunk_y: i32,
        chunk_size: i32,
        extra_positive_tile_border: i32,
    },
    Tile {
        tile_x: i32,
        tile_y: i32,
    },
}

fn load_map_placements_cached(
    app_state: &AppState,
    project_id: uuid::Uuid,
    project_dir: &std::path::Path,
    map_name: &str,
) -> Result<Arc<Vec<MapPlacementRecord>>, String> {
    load_map_placements_with_source_cached(app_state, project_id, project_dir, map_name)
        .map(|(placements, _, _)| placements)
}

fn load_map_placements_with_source_cached(
    app_state: &AppState,
    project_id: uuid::Uuid,
    project_dir: &std::path::Path,
    map_name: &str,
) -> Result<
    (
        Arc<Vec<MapPlacementRecord>>,
        workbench::SourceFileInfo,
        workbench::MapPlacementCacheKey,
    ),
    String,
> {
    let obj_path = client_paths::asset_file(project_dir, "map", format!("{map_name}.obj"));
    let source_obj = read_optional_source_file(&obj_path)?;
    let obj_source = source_obj
        .as_ref()
        .map(|(_, source)| source.clone())
        .unwrap_or_else(empty_source_file_info);
    let scene_obj_source = read_first_existing_table_source_file(
        project_dir,
        &["sceneobjinfo.bin", "SceneObjInfo.bin"],
    )?;
    let scene_effect_source = read_first_existing_table_source_file(
        project_dir,
        &["sceneffectinfo.bin", "sceneffectinfo.txt"],
    )?;
    let cache_key = placement_cache_key(
        project_id,
        map_name,
        obj_source.clone(),
        table_source_info(&scene_obj_source),
        table_source_info(&scene_effect_source),
    );

    {
        let cache = app_state
            .map_placement_cache
            .lock()
            .map_err(|e| e.to_string())?;
        if let Some(cached) = cache.get(&cache_key) {
            return Ok((Arc::clone(cached), obj_source, cache_key));
        }
    }

    let Some((data, _)) = source_obj else {
        return Ok((Arc::new(Vec::new()), obj_source, cache_key));
    };

    let parsed = super::obj_loader::load_obj(&data).map_err(|e| e.to_string())?;
    let building_info = parse_scene_obj_table_source(&scene_obj_source)?;
    let effect_info = parse_scene_effect_table_source(&scene_effect_source)?;

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
    cache.retain(|key, _| !(key.project_id == project_id && key.map_name == map_name));
    cache.insert(cache_key.clone(), Arc::clone(&placements));
    Ok((placements, obj_source, cache_key))
}

fn load_map_placement_index_cached(
    app_state: &AppState,
    project_id: uuid::Uuid,
    project_dir: &Path,
    map_name: &str,
) -> Result<Arc<workbench::PlacementSpatialIndex>, String> {
    let (placements, _, cache_key) =
        load_map_placements_with_source_cached(app_state, project_id, project_dir, map_name)?;

    {
        let cache = app_state
            .map_placement_spatial_cache
            .lock()
            .map_err(|e| e.to_string())?;
        if let Some(cached) = cache.get(&cache_key) {
            return Ok(Arc::clone(cached));
        }
    }

    let index = Arc::new(workbench::PlacementSpatialIndex::new(placements, 64.0));
    let mut cache = app_state
        .map_placement_spatial_cache
        .lock()
        .map_err(|e| e.to_string())?;
    cache.retain(|key, _| !(key.project_id == project_id && key.map_name == map_name));
    cache.insert(cache_key, Arc::clone(&index));
    Ok(index)
}

fn parsed_map_source_from_cache_key(
    cache_key: &workbench::ParsedMapCacheKey,
) -> workbench::SourceFileInfo {
    workbench::SourceFileInfo {
        map_modified_ms: cache_key.modified_ms,
        map_file_len: cache_key.file_len,
        content_sha256: cache_key.content_sha256.clone(),
    }
}

fn cached_parsed_map_for_expected_source(
    cache: &HashMap<workbench::ParsedMapCacheKey, Arc<terrain::ParsedMap>>,
    project_id: uuid::Uuid,
    map_name: &str,
    expected_source: &workbench::SourceFileInfo,
) -> Option<(Arc<terrain::ParsedMap>, workbench::SourceFileInfo)> {
    cache
        .iter()
        .find(|(key, _)| {
            key.project_id == project_id
                && key.map_name == map_name
                && key.modified_ms == expected_source.map_modified_ms
                && key.file_len == expected_source.map_file_len
                && key.content_sha256 == expected_source.content_sha256
        })
        .map(|(key, parsed)| (Arc::clone(parsed), parsed_map_source_from_cache_key(key)))
}

fn load_parsed_map_cached(
    app_state: &AppState,
    project_id: uuid::Uuid,
    project_dir: &Path,
    map_name: &str,
    expected_source: Option<&workbench::SourceFileInfo>,
    validation_window: Option<MapSourceValidationWindow>,
) -> Result<(Arc<terrain::ParsedMap>, workbench::SourceFileInfo), String> {
    let map_path = client_paths::asset_file(project_dir, "map", format!("{map_name}.map"));
    if let (Some(expected_source), Some(validation_window)) = (expected_source, validation_window) {
        // Chunk and tile inspection calls already carry the manifest source hash.
        // Use cheap metadata as the first gate, then only reuse a parsed map keyed
        // by that exact hash after checking the requested sections on disk.
        // Cache misses fall back to a full read/hash below.
        let metadata_source = read_source_file_metadata(&map_path)?;
        if metadata_source.map_modified_ms == expected_source.map_modified_ms
            && metadata_source.map_file_len == expected_source.map_file_len
        {
            let cached = {
                let cache = app_state
                    .map_workbench_cache
                    .lock()
                    .map_err(|e| e.to_string())?;
                cached_parsed_map_for_expected_source(&cache, project_id, map_name, expected_source)
            };
            if let Some((cached_map, cached_source)) = cached {
                validate_cached_map_window_current(
                    &map_path,
                    cached_map.as_ref(),
                    validation_window,
                )?;
                return Ok((cached_map, cached_source));
            }
        }
    }

    let (data, source) = read_source_file(&map_path)?;
    if let Some(expected_source) = expected_source {
        validate_source_info_unchanged("MAP", &source, expected_source)?;
    }
    let cache_key = workbench::ParsedMapCacheKey {
        project_id,
        map_name: map_name.to_string(),
        modified_ms: source.map_modified_ms,
        file_len: source.map_file_len,
        content_sha256: source.content_sha256.clone(),
    };

    {
        let cache = app_state
            .map_workbench_cache
            .lock()
            .map_err(|e| e.to_string())?;
        if let Some(cached) = cache.get(&cache_key) {
            return Ok((Arc::clone(cached), source));
        }
    }

    let parsed = Arc::new(super::map_loader::load_map(&data).map_err(|e| e.to_string())?);

    let mut cache = app_state
        .map_workbench_cache
        .lock()
        .map_err(|e| e.to_string())?;
    cache.retain(|key, _| !(key.project_id == project_id && key.map_name == map_name));
    while cache.len() >= MAX_WORKBENCH_MAP_CACHE_ENTRIES {
        let Some(oldest_key) = cache.keys().next().cloned() else {
            break;
        };
        cache.remove(&oldest_key);
    }
    cache.insert(cache_key, Arc::clone(&parsed));

    Ok((parsed, source))
}

fn load_terrain_texture_sampler_cached(
    app_state: &AppState,
    project_id: uuid::Uuid,
    project_dir: &Path,
    map_name: &str,
    map: &terrain::ParsedMap,
    map_source: &workbench::SourceFileInfo,
    verify_texture_assets: bool,
) -> Result<Option<Arc<texture::TerrainTextureSampler>>, String> {
    let terrain_info_path = client_paths::table_file(project_dir, "TerrainInfo.bin");
    let Some((terrain_info_data, terrain_info_source)) =
        read_optional_source_file(&terrain_info_path)?
    else {
        return Ok(None);
    };
    let mut cache = app_state
        .map_texture_sampler_cache
        .lock()
        .map_err(|e| e.to_string())?;
    if !verify_texture_assets {
        if let Some((_, cached)) = cache.iter().find(|(key, _)| {
            terrain_texture_sampler_key_matches_source(
                key,
                project_id,
                map_name,
                map_source,
                &terrain_info_source,
            )
        }) {
            return Ok(cached.as_ref().map(Arc::clone));
        }
    }

    let Some(texture_asset_content_sha256) =
        texture::terrain_texture_asset_fingerprint(project_dir, map, &terrain_info_data)
            .map_err(|e| e.to_string())?
    else {
        return Ok(None);
    };
    let cache_key = texture::TerrainTextureSamplerCacheKey {
        project_id,
        map_name: map_name.to_string(),
        map_modified_ms: map_source.map_modified_ms,
        map_file_len: map_source.map_file_len,
        map_content_sha256: map_source.content_sha256.clone(),
        terrain_info_modified_ms: terrain_info_source.map_modified_ms,
        terrain_info_file_len: terrain_info_source.map_file_len,
        terrain_info_content_sha256: terrain_info_source.content_sha256,
        texture_asset_content_sha256,
    };

    if let Some(cached) = cache.get(&cache_key) {
        return Ok(cached.as_ref().map(Arc::clone));
    }

    let sampler_result =
        match texture::TerrainTextureSampler::load_for_map(project_dir, map, &terrain_info_data) {
            Ok(Some(sampler)) => Some(Arc::new(sampler)),
            Ok(None) => None,
            Err(error) => {
                eprintln!("Failed to load terrain textures for {map_name}: {error}");
                None
            }
        };

    cache.retain(|key, _| !(key.project_id == project_id && key.map_name == map_name));
    while cache.len() >= MAX_WORKBENCH_MAP_CACHE_ENTRIES {
        let Some(oldest_key) = cache.keys().next().cloned() else {
            break;
        };
        cache.remove(&oldest_key);
    }
    cache.insert(cache_key, sampler_result.as_ref().map(Arc::clone));
    Ok(sampler_result)
}

fn terrain_texture_status_for_map(
    app_state: &AppState,
    project_id: uuid::Uuid,
    project_dir: &Path,
    map_name: &str,
    map: &terrain::ParsedMap,
    map_source: &workbench::SourceFileInfo,
) -> Result<workbench::MapTerrainTextureStatus, String> {
    let terrain_info_path = client_paths::table_file(project_dir, "TerrainInfo.bin");
    if !terrain_info_path.is_file() {
        return Ok(terrain_texture_missing_table_status(
            map,
            &terrain_info_path,
        ));
    }

    let sampler = match load_terrain_texture_sampler_cached(
        app_state,
        project_id,
        project_dir,
        map_name,
        map,
        map_source,
        true,
    ) {
        Ok(sampler) => sampler,
        Err(error) => return Ok(terrain_texture_load_error_status(map, &error)),
    };

    let referenced_count = texture::collect_referenced_tex_ids(map).len() as u32;
    if let Some(sampler) = sampler {
        let loaded_count = sampler.loaded_texture_count() as u32;
        let missing_count = referenced_count.saturating_sub(loaded_count);
        let alpha_atlas_available = sampler.alpha_atlas_available();
        let mut messages = Vec::new();
        if missing_count > 0 {
            messages.push(format!(
                "Loaded {} of {} referenced terrain textures; {} missing",
                loaded_count, referenced_count, missing_count
            ));
        }
        if !alpha_atlas_available {
            messages.push(
                "Alpha atlas total.tga is missing, so blend masks use fallback opacity".to_string(),
            );
        }

        return Ok(workbench::MapTerrainTextureStatus::available_with_counts(
            referenced_count,
            loaded_count,
            missing_count,
            alpha_atlas_available,
            (!messages.is_empty()).then(|| messages.join(". ")),
        ));
    }

    let message = if referenced_count == 0 {
        "The map does not reference any terrain texture ids".to_string()
    } else {
        format!(
            "TerrainInfo.bin was found, but no referenced terrain texture files could be loaded (0 of {})",
            referenced_count
        )
    };
    Ok(workbench::MapTerrainTextureStatus::unavailable_with_counts(
        referenced_count,
        0,
        referenced_count,
        false,
        message,
    ))
}

fn terrain_texture_missing_table_status(
    map: &terrain::ParsedMap,
    terrain_info_path: &Path,
) -> workbench::MapTerrainTextureStatus {
    let referenced_count = texture::collect_referenced_tex_ids(map).len() as u32;
    workbench::MapTerrainTextureStatus::unavailable_with_counts(
        referenced_count,
        0,
        referenced_count,
        false,
        format!(
            "TerrainInfo.bin was not found at {}",
            terrain_info_path.display()
        ),
    )
}

fn terrain_texture_load_error_status(
    map: &terrain::ParsedMap,
    error: &str,
) -> workbench::MapTerrainTextureStatus {
    let referenced_count = texture::collect_referenced_tex_ids(map).len() as u32;
    workbench::MapTerrainTextureStatus::unavailable_with_counts(
        referenced_count,
        0,
        referenced_count,
        false,
        format!("Terrain texture assets could not be loaded: {error}"),
    )
}

fn terrain_texture_sampler_key_matches_source(
    key: &texture::TerrainTextureSamplerCacheKey,
    project_id: uuid::Uuid,
    map_name: &str,
    map_source: &workbench::SourceFileInfo,
    terrain_info_source: &workbench::SourceFileInfo,
) -> bool {
    key.project_id == project_id
        && key.map_name == map_name
        && key.map_modified_ms == map_source.map_modified_ms
        && key.map_file_len == map_source.map_file_len
        && key.map_content_sha256 == map_source.content_sha256
        && key.terrain_info_modified_ms == terrain_info_source.map_modified_ms
        && key.terrain_info_file_len == terrain_info_source.map_file_len
        && key.terrain_info_content_sha256 == terrain_info_source.content_sha256
}

fn load_area_set_cached(
    app_state: &AppState,
    project_id: uuid::Uuid,
    project_dir: &Path,
) -> Result<Arc<HashMap<u32, area_set::AreaDefinition>>, String> {
    let source = read_first_existing_table_metadata(project_dir, &["AreaSet.bin", "areaset.bin"])?;
    let cache_key = area_set_cache_key(project_id, source.as_ref());

    {
        let cache = app_state
            .map_area_set_cache
            .lock()
            .map_err(|e| e.to_string())?;
        if let Some(cached) = cache.get(&cache_key) {
            return Ok(Arc::clone(cached));
        }
    }

    let areas = match source.as_ref() {
        Some(source) => area_set::parse_area_set_bin(&source.data).unwrap_or_default(),
        None => HashMap::new(),
    };
    let areas = Arc::new(areas);

    let mut cache = app_state
        .map_area_set_cache
        .lock()
        .map_err(|e| e.to_string())?;
    cache.retain(|key, _| key.project_id != project_id);
    cache.insert(cache_key, Arc::clone(&areas));
    Ok(areas)
}

fn export_map_tile_edits_to_dir(
    project_dir: &Path,
    map_name: &str,
    patches: &[map_writer::MapTilePatch],
    output_dir: &Path,
    source_guard: &workbench::SourceFileInfo,
) -> Result<map_writer::MapTileEditExportResult, String> {
    let map_name = validate_map_name_stem(map_name)?;
    let map_path = client_paths::asset_file(project_dir, "map", format!("{map_name}.map"));
    let (data, map_source) = read_source_file(&map_path)?;
    validate_source_info_unchanged("MAP", &map_source, source_guard)?;
    let mut parsed = super::map_loader::load_map(&data).map_err(|e| e.to_string())?;
    map_writer::apply_tile_patches(&mut parsed, patches).map_err(|e| e.to_string())?;
    let exported = map_writer::serialize_map(&parsed).map_err(|e| e.to_string())?;
    let exported_atr = server_writer::serialize_atr(&parsed).map_err(|e| e.to_string())?;
    let exported_blk = server_writer::serialize_blk(&parsed).map_err(|e| e.to_string())?;
    let atr_sha256 = sha256_hex(&exported_atr);
    let blk_sha256 = sha256_hex(&exported_blk);

    std::fs::create_dir_all(output_dir)
        .map_err(|e| format!("Failed to create {}: {e}", output_dir.display()))?;
    let out_path = output_dir.join(format!("{map_name}.map"));
    std::fs::write(&out_path, &exported)
        .map_err(|e| format!("Failed to write {}: {e}", out_path.display()))?;
    let atr_path = output_dir.join(format!("{map_name}.atr"));
    std::fs::write(&atr_path, &exported_atr)
        .map_err(|e| format!("Failed to write {}: {e}", atr_path.display()))?;
    let blk_path = output_dir.join(format!("{map_name}.blk"));
    std::fs::write(&blk_path, &exported_blk)
        .map_err(|e| format!("Failed to write {}: {e}", blk_path.display()))?;

    Ok(map_writer::MapTileEditExportResult {
        map_name: map_name.to_string(),
        map_path: out_path.to_string_lossy().to_string(),
        atr_path: atr_path.to_string_lossy().to_string(),
        blk_path: blk_path.to_string_lossy().to_string(),
        patch_count: patches.len() as u32,
        bytes_written: exported.len() as u64,
        atr_bytes_written: exported_atr.len() as u64,
        blk_bytes_written: exported_blk.len() as u64,
        atr_sha256,
        blk_sha256,
    })
}

fn export_map_placement_edits_to_dir(
    project_dir: &Path,
    map_name: &str,
    edits: &[obj_writer::MapPlacementEdit],
    output_dir: &Path,
    source_guard: &workbench::SourceFileInfo,
) -> Result<obj_writer::MapPlacementEditExportResult, String> {
    let map_name = validate_map_name_stem(map_name)?;
    let obj_path = client_paths::asset_file(project_dir, "map", format!("{map_name}.obj"));
    let (data, obj_source) = read_source_file(&obj_path)?;
    validate_source_info_unchanged("OBJ", &obj_source, source_guard)?;
    let mut parsed = super::obj_loader::load_obj(&data).map_err(|e| e.to_string())?;
    obj_writer::apply_placement_edits(&mut parsed, edits).map_err(|e| e.to_string())?;
    let exported = obj_writer::serialize_obj(&parsed).map_err(|e| e.to_string())?;

    std::fs::create_dir_all(output_dir)
        .map_err(|e| format!("Failed to create {}: {e}", output_dir.display()))?;
    let out_path = output_dir.join(format!("{map_name}.obj"));
    std::fs::write(&out_path, &exported)
        .map_err(|e| format!("Failed to write {}: {e}", out_path.display()))?;

    Ok(obj_writer::MapPlacementEditExportResult {
        map_name: map_name.to_string(),
        obj_path: out_path.to_string_lossy().to_string(),
        patch_count: edits.len() as u32,
        bytes_written: exported.len() as u64,
    })
}

fn export_map_edits_to_dir(
    project_dir: &Path,
    map_name: &str,
    tile_patches: &[map_writer::MapTilePatch],
    placement_edits: &[obj_writer::MapPlacementEdit],
    output_dir: &Path,
    source_guard: &MapEditSourceGuard,
) -> Result<MapEditExportResult, String> {
    let map_name = validate_map_name_stem(map_name)?;
    let map_path = client_paths::asset_file(project_dir, "map", format!("{map_name}.map"));
    let obj_path = client_paths::asset_file(project_dir, "map", format!("{map_name}.obj"));
    let rbo_path = client_paths::asset_file(project_dir, "map", format!("{map_name}.rbo"));
    let (source_map, map_source) = read_source_file(&map_path)?;
    validate_source_info_unchanged("MAP", &map_source, &source_guard.map_source)?;
    let source_obj = read_optional_source_file(&obj_path)?;
    let obj_source = source_obj
        .as_ref()
        .map(|(_, source)| source.clone())
        .unwrap_or_else(empty_source_file_info);
    validate_source_info_unchanged("OBJ", &obj_source, &source_guard.obj_source)?;
    let source_rbo = read_optional_source_file(&rbo_path)?;
    let rbo_source = source_rbo
        .as_ref()
        .map(|(_, source)| source.clone())
        .unwrap_or_else(empty_source_file_info);
    validate_source_info_unchanged("RBO", &rbo_source, &source_guard.rbo_source)?;

    let mut parsed_map = super::map_loader::load_map(&source_map).map_err(|e| e.to_string())?;
    if !tile_patches.is_empty() {
        map_writer::apply_tile_patches(&mut parsed_map, tile_patches).map_err(|e| e.to_string())?;
    }
    let exported_map = if tile_patches.is_empty() {
        source_map
    } else {
        map_writer::serialize_map(&parsed_map).map_err(|e| e.to_string())?
    };
    let exported_atr = server_writer::serialize_atr(&parsed_map).map_err(|e| e.to_string())?;
    let exported_blk = server_writer::serialize_blk(&parsed_map).map_err(|e| e.to_string())?;

    let exported_obj = match source_obj {
        Some((source_obj, _)) if placement_edits.is_empty() => source_obj,
        Some((source_obj, _)) => {
            let mut parsed_obj =
                super::obj_loader::load_obj(&source_obj).map_err(|e| e.to_string())?;
            obj_writer::apply_placement_edits(&mut parsed_obj, placement_edits)
                .map_err(|e| e.to_string())?;
            obj_writer::serialize_obj(&parsed_obj).map_err(|e| e.to_string())?
        }
        None => {
            let mut parsed_obj = empty_obj_for_map(&parsed_map);
            if !placement_edits.is_empty() {
                obj_writer::apply_placement_edits(&mut parsed_obj, placement_edits)
                    .map_err(|e| e.to_string())?;
            }
            obj_writer::serialize_obj(&parsed_obj).map_err(|e| e.to_string())?
        }
    };
    let exported_rbo = source_rbo.map(|(bytes, _)| bytes);
    let rbo_preserved_from_source = exported_rbo.is_some();
    let rbo_may_be_stale = !placement_edits.is_empty()
        && exported_rbo
            .as_ref()
            .map(|bytes| !bytes.is_empty())
            .unwrap_or(false);
    let map_sha256 = sha256_hex(&exported_map);
    let obj_sha256 = sha256_hex(&exported_obj);
    let rbo_sha256 = exported_rbo.as_ref().map(|bytes| sha256_hex(bytes));
    let atr_sha256 = sha256_hex(&exported_atr);
    let blk_sha256 = sha256_hex(&exported_blk);

    std::fs::create_dir_all(output_dir)
        .map_err(|e| format!("Failed to create {}: {e}", output_dir.display()))?;
    let out_map_path = output_dir.join(format!("{map_name}.map"));
    std::fs::write(&out_map_path, &exported_map)
        .map_err(|e| format!("Failed to write {}: {e}", out_map_path.display()))?;
    let out_obj_path = output_dir.join(format!("{map_name}.obj"));
    std::fs::write(&out_obj_path, &exported_obj)
        .map_err(|e| format!("Failed to write {}: {e}", out_obj_path.display()))?;
    let (out_rbo_path, rbo_bytes_written) = if let Some(exported_rbo) = exported_rbo.as_ref() {
        let out_path = output_dir.join(format!("{map_name}.rbo"));
        std::fs::write(&out_path, exported_rbo)
            .map_err(|e| format!("Failed to write {}: {e}", out_path.display()))?;
        (
            Some(out_path.to_string_lossy().to_string()),
            exported_rbo.len() as u64,
        )
    } else {
        (None, 0)
    };
    let atr_path = output_dir.join(format!("{map_name}.atr"));
    std::fs::write(&atr_path, &exported_atr)
        .map_err(|e| format!("Failed to write {}: {e}", atr_path.display()))?;
    let blk_path = output_dir.join(format!("{map_name}.blk"));
    std::fs::write(&blk_path, &exported_blk)
        .map_err(|e| format!("Failed to write {}: {e}", blk_path.display()))?;

    Ok(MapEditExportResult {
        map_name: map_name.to_string(),
        map_path: out_map_path.to_string_lossy().to_string(),
        obj_path: out_obj_path.to_string_lossy().to_string(),
        rbo_path: out_rbo_path,
        atr_path: atr_path.to_string_lossy().to_string(),
        blk_path: blk_path.to_string_lossy().to_string(),
        tile_patch_count: tile_patches.len() as u32,
        placement_edit_count: placement_edits.len() as u32,
        map_bytes_written: exported_map.len() as u64,
        obj_bytes_written: exported_obj.len() as u64,
        rbo_bytes_written,
        rbo_preserved_from_source,
        rbo_may_be_stale,
        atr_bytes_written: exported_atr.len() as u64,
        blk_bytes_written: exported_blk.len() as u64,
        map_sha256,
        obj_sha256,
        rbo_sha256,
        atr_sha256,
        blk_sha256,
    })
}

fn apply_map_edit_client_package_to_dir(
    project_dir: &Path,
    map_name: &str,
    package: &MapEditClientPackage,
    package_root: &Path,
    backup_root: &Path,
    source_guard: &MapEditSourceGuard,
) -> Result<MapEditClientApplyResult, String> {
    let map_name = validate_map_name_stem(map_name)?;
    let client_map_path = client_paths::asset_file(project_dir, "map", format!("{map_name}.map"));
    let client_obj_path = client_paths::asset_file(project_dir, "map", format!("{map_name}.obj"));
    let client_rbo_path = client_paths::asset_file(project_dir, "map", format!("{map_name}.rbo"));

    let (current_map, current_map_source) = read_source_file(&client_map_path)?;
    validate_source_info_unchanged("MAP", &current_map_source, &source_guard.map_source)?;
    let current_obj = read_optional_source_file(&client_obj_path)?;
    let current_obj_source = current_obj
        .as_ref()
        .map(|(_, source)| source.clone())
        .unwrap_or_else(empty_source_file_info);
    validate_source_info_unchanged("OBJ", &current_obj_source, &source_guard.obj_source)?;
    let current_rbo = read_optional_source_file(&client_rbo_path)?;
    let current_rbo_source = current_rbo
        .as_ref()
        .map(|(_, source)| source.clone())
        .unwrap_or_else(empty_source_file_info);
    validate_source_info_unchanged("RBO", &current_rbo_source, &source_guard.rbo_source)?;

    let package_map = read_validated_package_file(
        "MAP",
        &package.map_path,
        &format!("{map_name}.map"),
        package_root,
        &client_map_path,
        package.map_bytes,
        &package.map_sha256,
    )?;
    let package_obj = read_validated_package_file(
        "OBJ",
        &package.obj_path,
        &format!("{map_name}.obj"),
        package_root,
        &client_obj_path,
        package.obj_bytes,
        &package.obj_sha256,
    )?;
    let rbo_source_exists = source_info_has_file(&source_guard.rbo_source);
    let package_rbo = match package.rbo_path.as_deref() {
        Some(_) if !rbo_source_exists => {
            return Err(
                "RBO package cannot be installed for a map loaded without RBO data".to_string(),
            );
        }
        Some(rbo_path) => {
            let rbo_sha256 = package
                .rbo_sha256
                .as_deref()
                .ok_or_else(|| "RBO package hash is missing".to_string())?;
            Some(read_validated_package_file(
                "RBO",
                rbo_path,
                &format!("{map_name}.rbo"),
                package_root,
                &client_rbo_path,
                package.rbo_bytes,
                rbo_sha256,
            )?)
        }
        None if rbo_source_exists => {
            return Err(
                "RBO package file missing for a map that was loaded with RBO data".to_string(),
            );
        }
        None if package.rbo_bytes > 0 || package.rbo_sha256.is_some() => {
            return Err("RBO package metadata was provided without an RBO file".to_string());
        }
        None => None,
    };

    let backup_dir = unique_map_backup_dir(backup_root, map_name);
    std::fs::create_dir_all(&backup_dir).map_err(|e| {
        format!(
            "Failed to create backup directory {}: {e}",
            backup_dir.display()
        )
    })?;

    let mut backups = Vec::new();
    backups.push(write_client_file_backup(
        "MAP",
        &client_map_path,
        &current_map,
        &backup_dir,
    )?);
    if let Some((current_obj, _)) = current_obj.as_ref() {
        backups.push(write_client_file_backup(
            "OBJ",
            &client_obj_path,
            current_obj,
            &backup_dir,
        )?);
    }
    if let Some((current_rbo, _)) = current_rbo.as_ref() {
        backups.push(write_client_file_backup(
            "RBO",
            &client_rbo_path,
            current_rbo,
            &backup_dir,
        )?);
    }
    write_map_backup_manifest(
        &backup_dir,
        map_name,
        Some(&current_map),
        current_obj.as_ref().map(|(bytes, _)| bytes.as_slice()),
        current_rbo.as_ref().map(|(bytes, _)| bytes.as_slice()),
    )?;

    let mut writes = vec![
        ClientInstallWrite {
            label: "MAP",
            path: &client_map_path,
            bytes: &package_map,
            original: Some(&current_map),
        },
        ClientInstallWrite {
            label: "OBJ",
            path: &client_obj_path,
            bytes: &package_obj,
            original: current_obj.as_ref().map(|(bytes, _)| bytes.as_slice()),
        },
    ];
    if let Some(package_rbo) = package_rbo.as_ref() {
        writes.push(ClientInstallWrite {
            label: "RBO",
            path: &client_rbo_path,
            bytes: package_rbo,
            original: current_rbo.as_ref().map(|(bytes, _)| bytes.as_slice()),
        });
    }
    write_client_package_files(&writes)?;

    let (rbo_path, rbo_bytes_written) = package_rbo
        .as_ref()
        .map(|bytes| {
            (
                Some(client_rbo_path.to_string_lossy().to_string()),
                bytes.len() as u64,
            )
        })
        .unwrap_or((None, 0));

    Ok(MapEditClientApplyResult {
        map_name: map_name.to_string(),
        backup_dir: backup_dir.to_string_lossy().to_string(),
        map_path: client_map_path.to_string_lossy().to_string(),
        obj_path: client_obj_path.to_string_lossy().to_string(),
        rbo_path,
        map_bytes_written: package_map.len() as u64,
        obj_bytes_written: package_obj.len() as u64,
        rbo_bytes_written,
        backups,
    })
}

fn restore_map_edit_client_backup_to_dir(
    project_dir: &Path,
    map_name: &str,
    backup_dir: &str,
    backup_root: &Path,
) -> Result<MapEditClientRestoreResult, String> {
    let map_name = validate_map_name_stem(map_name)?;
    let client_map_path = client_paths::asset_file(project_dir, "map", format!("{map_name}.map"));
    let client_obj_path = client_paths::asset_file(project_dir, "map", format!("{map_name}.obj"));
    let client_rbo_path = client_paths::asset_file(project_dir, "map", format!("{map_name}.rbo"));
    let backup_dir = resolve_map_backup_dir(backup_dir, backup_root, map_name)?;
    let backup_manifest = read_map_backup_manifest(&backup_dir, map_name)?;

    let backup_map = read_manifest_backup_file(
        "MAP",
        &backup_manifest,
        &backup_dir,
        &format!("{map_name}.map"),
    )?
    .ok_or_else(|| "MAP backup file is missing".to_string())?;
    let backup_obj = read_manifest_backup_file(
        "OBJ",
        &backup_manifest,
        &backup_dir,
        &format!("{map_name}.obj"),
    )?;
    let backup_rbo = read_manifest_backup_file(
        "RBO",
        &backup_manifest,
        &backup_dir,
        &format!("{map_name}.rbo"),
    )?;

    let current_map = read_optional_bytes(&client_map_path)?;
    let current_obj = read_optional_bytes(&client_obj_path)?;
    let current_rbo = read_optional_bytes(&client_rbo_path)?;

    let restore_backup_dir = unique_map_backup_dir(backup_root, &format!("{map_name}-pre-restore"));
    std::fs::create_dir_all(&restore_backup_dir).map_err(|e| {
        format!(
            "Failed to create pre-restore backup directory {}: {e}",
            restore_backup_dir.display()
        )
    })?;

    let mut current_backups = Vec::new();
    if let Some(current_map) = current_map.as_ref() {
        current_backups.push(write_client_file_backup(
            "MAP",
            &client_map_path,
            current_map,
            &restore_backup_dir,
        )?);
    }
    if let Some(current_obj) = current_obj.as_ref() {
        current_backups.push(write_client_file_backup(
            "OBJ",
            &client_obj_path,
            current_obj,
            &restore_backup_dir,
        )?);
    }
    if let Some(current_rbo) = current_rbo.as_ref() {
        current_backups.push(write_client_file_backup(
            "RBO",
            &client_rbo_path,
            current_rbo,
            &restore_backup_dir,
        )?);
    }
    write_map_backup_manifest(
        &restore_backup_dir,
        map_name,
        current_map.as_deref(),
        current_obj.as_deref(),
        current_rbo.as_deref(),
    )?;

    let restore_actions = [
        ClientRestoreAction {
            label: "MAP",
            path: &client_map_path,
            desired: Some(backup_map.as_slice()),
            original: current_map.as_deref(),
        },
        ClientRestoreAction {
            label: "OBJ",
            path: &client_obj_path,
            desired: backup_obj.as_deref(),
            original: current_obj.as_deref(),
        },
        ClientRestoreAction {
            label: "RBO",
            path: &client_rbo_path,
            desired: backup_rbo.as_deref(),
            original: current_rbo.as_deref(),
        },
    ];
    apply_client_restore_actions(&restore_actions)?;

    let removed_paths = [
        (
            &client_obj_path,
            backup_obj.is_none(),
            current_obj.is_some(),
        ),
        (
            &client_rbo_path,
            backup_rbo.is_none(),
            current_rbo.is_some(),
        ),
    ]
    .iter()
    .filter_map(|(path, had_no_backup, existed_before_restore)| {
        (*had_no_backup && *existed_before_restore).then(|| path.to_string_lossy().to_string())
    })
    .collect();

    Ok(MapEditClientRestoreResult {
        map_name: map_name.to_string(),
        backup_dir: backup_dir.to_string_lossy().to_string(),
        restore_backup_dir: restore_backup_dir.to_string_lossy().to_string(),
        map_path: client_map_path.to_string_lossy().to_string(),
        obj_path: backup_obj
            .as_ref()
            .map(|_| client_obj_path.to_string_lossy().to_string()),
        rbo_path: backup_rbo
            .as_ref()
            .map(|_| client_rbo_path.to_string_lossy().to_string()),
        map_bytes_restored: backup_map.len() as u64,
        obj_bytes_restored: backup_obj
            .as_ref()
            .map(|bytes| bytes.len() as u64)
            .unwrap_or(0),
        rbo_bytes_restored: backup_rbo
            .as_ref()
            .map(|bytes| bytes.len() as u64)
            .unwrap_or(0),
        current_backups,
        removed_paths,
    })
}

struct ClientInstallWrite<'a> {
    label: &'a str,
    path: &'a Path,
    bytes: &'a [u8],
    original: Option<&'a [u8]>,
}

struct ClientRestoreAction<'a> {
    label: &'a str,
    path: &'a Path,
    desired: Option<&'a [u8]>,
    original: Option<&'a [u8]>,
}

fn source_info_has_file(source: &workbench::SourceFileInfo) -> bool {
    source.map_modified_ms > 0 || !source.content_sha256.is_empty()
}

fn resolve_map_backup_dir(
    backup_dir: &str,
    backup_root: &Path,
    map_name: &str,
) -> Result<PathBuf, String> {
    let backup_root = backup_root.canonicalize().map_err(|e| {
        format!(
            "Failed to resolve backup directory {}: {e}",
            backup_root.display()
        )
    })?;
    let backup_dir = Path::new(backup_dir)
        .canonicalize()
        .map_err(|e| format!("Failed to resolve map backup directory {backup_dir}: {e}"))?;
    if !backup_dir.starts_with(&backup_root) || backup_dir == backup_root {
        return Err(format!(
            "Map backup directory must be inside {}",
            backup_root.display()
        ));
    }
    if backup_dir.parent() != Some(backup_root.as_path()) {
        return Err(format!(
            "Map backup directory must be a direct child of {}",
            backup_root.display()
        ));
    }
    let expected_prefix = format!("{map_name}-");
    let actual_name = backup_dir
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");
    if !actual_name.starts_with(&expected_prefix) {
        return Err(format!(
            "Map backup directory {actual_name} does not match {map_name}"
        ));
    }
    Ok(backup_dir)
}

fn write_map_backup_manifest(
    backup_dir: &Path,
    map_name: &str,
    map_bytes: Option<&[u8]>,
    obj_bytes: Option<&[u8]>,
    rbo_bytes: Option<&[u8]>,
) -> Result<(), String> {
    let manifest = MapEditClientBackupManifest {
        version: MAP_EDIT_BACKUP_MANIFEST_VERSION,
        map_name: map_name.to_string(),
        files: vec![
            map_backup_manifest_file("MAP", &format!("{map_name}.map"), map_bytes),
            map_backup_manifest_file("OBJ", &format!("{map_name}.obj"), obj_bytes),
            map_backup_manifest_file("RBO", &format!("{map_name}.rbo"), rbo_bytes),
        ],
    };
    let manifest_path = backup_dir.join(MAP_EDIT_BACKUP_MANIFEST_FILE);
    let json = serde_json::to_vec_pretty(&manifest)
        .map_err(|e| format!("Failed to encode map backup manifest: {e}"))?;
    std::fs::write(&manifest_path, json).map_err(|e| {
        format!(
            "Failed to write map backup manifest {}: {e}",
            manifest_path.display()
        )
    })
}

fn map_backup_manifest_file(
    label: &str,
    file_name: &str,
    bytes: Option<&[u8]>,
) -> MapEditClientBackupManifestFile {
    MapEditClientBackupManifestFile {
        label: label.to_string(),
        file_name: file_name.to_string(),
        existed: bytes.is_some(),
        bytes: bytes.map(|bytes| bytes.len() as u64).unwrap_or(0),
        sha256: bytes.map(sha256_hex),
    }
}

fn read_map_backup_manifest(
    backup_dir: &Path,
    map_name: &str,
) -> Result<MapEditClientBackupManifest, String> {
    let manifest_path = backup_dir.join(MAP_EDIT_BACKUP_MANIFEST_FILE);
    let json = std::fs::read(&manifest_path).map_err(|e| {
        format!(
            "Failed to read map backup manifest {}: {e}",
            manifest_path.display()
        )
    })?;
    let manifest: MapEditClientBackupManifest = serde_json::from_slice(&json).map_err(|e| {
        format!(
            "Failed to parse map backup manifest {}: {e}",
            manifest_path.display()
        )
    })?;
    if manifest.version != MAP_EDIT_BACKUP_MANIFEST_VERSION {
        return Err(format!(
            "Unsupported map backup manifest version {}",
            manifest.version
        ));
    }
    if manifest.map_name != map_name {
        return Err(format!(
            "Map backup manifest is for {}, not {map_name}",
            manifest.map_name
        ));
    }
    Ok(manifest)
}

fn read_manifest_backup_file(
    label: &str,
    manifest: &MapEditClientBackupManifest,
    backup_dir: &Path,
    expected_file_name: &str,
) -> Result<Option<Vec<u8>>, String> {
    let entry = manifest
        .files
        .iter()
        .find(|file| file.label == label)
        .ok_or_else(|| format!("{label} backup manifest entry is missing"))?;
    if entry.file_name != expected_file_name {
        return Err(format!(
            "{label} backup manifest expected {expected_file_name}, got {}",
            entry.file_name
        ));
    }
    if !entry.existed {
        return Ok(None);
    }

    let file_name = Path::new(&entry.file_name)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| *name == entry.file_name)
        .ok_or_else(|| format!("{label} backup file name is invalid"))?;
    let path = backup_dir.join(file_name);
    let bytes = match std::fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(format!("{label} backup file is missing"));
        }
        Err(error) => {
            return Err(format!(
                "Failed to read {label} backup file {}: {error}",
                path.display()
            ));
        }
    };
    let actual_sha256 = sha256_hex(&bytes);
    let expected_sha256 = entry
        .sha256
        .as_deref()
        .ok_or_else(|| format!("{label} backup hash is missing"))?;
    if bytes.len() as u64 != entry.bytes || actual_sha256 != expected_sha256 {
        return Err(format!("{label} backup file changed since install"));
    }
    Ok(Some(bytes))
}

fn read_optional_bytes(path: &Path) -> Result<Option<Vec<u8>>, String> {
    match std::fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("Failed to read {}: {error}", path.display())),
    }
}

fn read_validated_package_file(
    label: &str,
    path: &str,
    expected_file_name: &str,
    package_root: &Path,
    destination_path: &Path,
    expected_bytes: u64,
    expected_sha256: &str,
) -> Result<Vec<u8>, String> {
    if expected_sha256.is_empty() {
        return Err(format!("{label} package hash is missing"));
    }

    let package_root = package_root.canonicalize().map_err(|e| {
        format!(
            "Failed to resolve package directory {}: {e}",
            package_root.display()
        )
    })?;
    let package_path = Path::new(path)
        .canonicalize()
        .map_err(|e| format!("Failed to resolve {label} package file {path}: {e}"))?;
    let actual_file_name = package_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("");
    if actual_file_name != expected_file_name {
        return Err(format!(
            "{label} package file must be named {expected_file_name}, got {actual_file_name}"
        ));
    }
    if !package_path.starts_with(&package_root) {
        return Err(format!(
            "{label} package file must be inside {}",
            package_root.display()
        ));
    }
    if let Ok(destination_path) = destination_path.canonicalize() {
        if package_path == destination_path {
            return Err(format!(
                "{label} package file cannot be the selected client file"
            ));
        }
    }

    let bytes = std::fs::read(&package_path).map_err(|e| {
        format!(
            "Failed to read {label} package file {}: {e}",
            package_path.display()
        )
    })?;
    let actual_sha256 = sha256_hex(&bytes);
    if bytes.len() as u64 != expected_bytes || actual_sha256 != expected_sha256 {
        return Err(format!("{label} package file changed since export"));
    }
    Ok(bytes)
}

fn unique_map_backup_dir(backup_root: &Path, map_name: &str) -> PathBuf {
    let modified_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    let base_name = format!("{map_name}-{modified_ms}");
    let mut candidate = backup_root.join(&base_name);
    let mut suffix = 1usize;
    while candidate.exists() {
        candidate = backup_root.join(format!("{base_name}-{suffix}"));
        suffix += 1;
    }
    candidate
}

fn write_client_file_backup(
    label: &str,
    source_path: &Path,
    bytes: &[u8],
    backup_dir: &Path,
) -> Result<MapEditClientFileBackup, String> {
    let file_name = source_path
        .file_name()
        .ok_or_else(|| format!("Cannot back up {label}: source path has no file name"))?;
    let backup_path = backup_dir.join(file_name);
    std::fs::write(&backup_path, bytes).map_err(|e| {
        format!(
            "Failed to write {label} backup {}: {e}",
            backup_path.display()
        )
    })?;
    Ok(MapEditClientFileBackup {
        label: label.to_string(),
        source_path: source_path.to_string_lossy().to_string(),
        backup_path: backup_path.to_string_lossy().to_string(),
        bytes: bytes.len() as u64,
    })
}

fn write_client_package_files(writes: &[ClientInstallWrite<'_>]) -> Result<(), String> {
    let mut temp_paths = Vec::with_capacity(writes.len());
    for (index, write) in writes.iter().enumerate() {
        let temp_path = unique_install_temp_path(write.path, index);
        if let Err(error) = std::fs::write(&temp_path, write.bytes) {
            cleanup_temp_paths(&temp_paths);
            return Err(format!(
                "Failed to stage {} install file {}: {error}",
                write.label,
                temp_path.display()
            ));
        }
        temp_paths.push(temp_path);
    }

    let mut applied_indices = Vec::with_capacity(writes.len());
    for (index, write) in writes.iter().enumerate() {
        if write.path.exists() {
            if let Err(error) = std::fs::remove_file(write.path) {
                cleanup_temp_paths(&temp_paths[index..]);
                let rollback_error = rollback_client_writes(writes, &applied_indices);
                return Err(format!(
                    "Failed to prepare {} install target {}: {error}{rollback_error}",
                    write.label,
                    write.path.display()
                ));
            }
        }

        if let Err(error) = std::fs::rename(&temp_paths[index], write.path) {
            let _ = match write.original {
                Some(original) => std::fs::write(write.path, original),
                None => std::fs::remove_file(write.path),
            };
            cleanup_temp_paths(&temp_paths[index..]);
            let rollback_error = rollback_client_writes(writes, &applied_indices);
            return Err(format!(
                "Failed to install {} file {}: {error}{rollback_error}",
                write.label,
                write.path.display()
            ));
        }
        applied_indices.push(index);
    }

    Ok(())
}

fn apply_client_restore_actions(actions: &[ClientRestoreAction<'_>]) -> Result<(), String> {
    let mut temp_paths: Vec<Option<PathBuf>> = vec![None; actions.len()];
    for (index, action) in actions.iter().enumerate() {
        if let Some(bytes) = action.desired {
            let temp_path = unique_install_temp_path(action.path, index);
            if let Err(error) = std::fs::write(&temp_path, bytes) {
                cleanup_optional_temp_paths(&temp_paths);
                return Err(format!(
                    "Failed to stage {} restore file {}: {error}",
                    action.label,
                    temp_path.display()
                ));
            }
            temp_paths[index] = Some(temp_path);
        }
    }

    let mut applied_indices = Vec::with_capacity(actions.len());
    for (index, action) in actions.iter().enumerate() {
        if action.path.exists() {
            if let Err(error) = std::fs::remove_file(action.path) {
                cleanup_optional_temp_paths(&temp_paths);
                let rollback_error = rollback_client_restore_actions(actions, &applied_indices);
                return Err(format!(
                    "Failed to prepare {} restore target {}: {error}{rollback_error}",
                    action.label,
                    action.path.display()
                ));
            }
        }

        if action.desired.is_some() {
            let temp_path = temp_paths[index]
                .as_ref()
                .ok_or_else(|| format!("{} restore temp file is missing", action.label))?;
            if let Err(error) = std::fs::rename(temp_path, action.path) {
                let _ = match action.original {
                    Some(original) => std::fs::write(action.path, original),
                    None => std::fs::remove_file(action.path),
                };
                cleanup_optional_temp_paths(&temp_paths);
                let rollback_error = rollback_client_restore_actions(actions, &applied_indices);
                return Err(format!(
                    "Failed to restore {} file {}: {error}{rollback_error}",
                    action.label,
                    action.path.display()
                ));
            }
        }

        applied_indices.push(index);
    }

    Ok(())
}

fn unique_install_temp_path(destination: &Path, index: usize) -> PathBuf {
    let parent = destination.parent().unwrap_or_else(|| Path::new("."));
    let file_name = destination
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("map-file");
    let modified_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    let base_name = format!(".{file_name}.pko-tools-install-{modified_ms}-{index}.tmp");
    let mut candidate = parent.join(&base_name);
    let mut suffix = 1usize;
    while candidate.exists() {
        candidate = parent.join(format!("{base_name}-{suffix}"));
        suffix += 1;
    }
    candidate
}

fn cleanup_temp_paths(paths: &[PathBuf]) {
    for path in paths {
        let _ = std::fs::remove_file(path);
    }
}

fn cleanup_optional_temp_paths(paths: &[Option<PathBuf>]) {
    for path in paths.iter().flatten() {
        let _ = std::fs::remove_file(path);
    }
}

fn rollback_client_restore_actions(
    actions: &[ClientRestoreAction<'_>],
    applied_indices: &[usize],
) -> String {
    let mut errors = Vec::new();
    for index in applied_indices.iter().rev() {
        let action = &actions[*index];
        let result = match action.original {
            Some(original) => std::fs::write(action.path, original),
            None => {
                if action.path.exists() {
                    std::fs::remove_file(action.path)
                } else {
                    Ok(())
                }
            }
        };
        if let Err(error) = result {
            errors.push(format!("{} restore rollback failed: {error}", action.label));
        }
    }
    if errors.is_empty() {
        String::new()
    } else {
        format!("; {}", errors.join("; "))
    }
}

fn rollback_client_writes(writes: &[ClientInstallWrite<'_>], applied_indices: &[usize]) -> String {
    let mut errors = Vec::new();
    for index in applied_indices.iter().rev() {
        let write = &writes[*index];
        let result = match write.original {
            Some(original) => std::fs::write(write.path, original),
            None => std::fs::remove_file(write.path),
        };
        if let Err(error) = result {
            errors.push(format!("{} rollback failed: {error}", write.label));
        }
    }
    if errors.is_empty() {
        String::new()
    } else {
        format!("; {}", errors.join("; "))
    }
}

fn empty_obj_for_map(map: &terrain::ParsedMap) -> super::scene_obj::ParsedObjFile {
    super::scene_obj::ParsedObjFile {
        section_cnt_x: map.section_cnt_x,
        section_cnt_y: map.section_cnt_y,
        section_width: map.header.n_section_width,
        section_height: map.header.n_section_height,
        section_obj_num: 25,
        objects: Vec::new(),
        raw_records: Vec::new(),
        object_raw_indices: Vec::new(),
        dirty_object_indices: Default::default(),
    }
}

fn validate_map_name_stem(map_name: &str) -> Result<&str, String> {
    let trimmed = map_name.trim();
    if trimmed.is_empty()
        || trimmed == "."
        || trimmed == ".."
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains(':')
    {
        return Err("Invalid map name".to_string());
    }

    Ok(trimmed)
}

fn read_source_file(path: &Path) -> Result<(Vec<u8>, workbench::SourceFileInfo), String> {
    let data =
        std::fs::read(path).map_err(|e| format!("Failed to read {}: {e}", path.display()))?;
    let metadata = std::fs::metadata(path)
        .map_err(|e| format!("Failed to read metadata for {}: {e}", path.display()))?;
    let source = source_file_info_from_parts(
        data.len() as u64,
        metadata.modified().ok(),
        sha256_hex(&data),
    );
    Ok((data, source))
}

fn read_source_file_metadata(path: &Path) -> Result<workbench::SourceFileInfo, String> {
    let metadata = std::fs::metadata(path)
        .map_err(|e| format!("Failed to read metadata for {}: {e}", path.display()))?;
    Ok(source_file_info_from_parts(
        metadata.len(),
        metadata.modified().ok(),
        String::new(),
    ))
}

fn validate_cached_map_window_current(
    path: &Path,
    map: &terrain::ParsedMap,
    window: MapSourceValidationWindow,
) -> Result<(), String> {
    let sections = validation_window_sections(map, window)?;
    let mut file =
        std::fs::File::open(path).map_err(|e| format!("Failed to read {}: {e}", path.display()))?;
    let offsets = read_current_map_offsets(&mut file, map)?;
    let tiles_per_section = checked_i32_product_to_usize(
        map.header.n_section_width,
        map.header.n_section_height,
        "MAP tiles per section",
    )?;

    for section_index in sections {
        let current_offset = offsets
            .get(section_index)
            .copied()
            .ok_or_else(map_source_changed_error)?;
        let cached_offset = map
            .section_offsets
            .get(section_index)
            .copied()
            .ok_or_else(map_source_changed_error)?;
        let cached_section = map
            .sections
            .get(section_index)
            .ok_or_else(map_source_changed_error)?;

        match (current_offset, cached_offset, cached_section) {
            (0, 0, None) => {}
            (current_offset, cached_offset, Some(section)) if current_offset == cached_offset => {
                if section.tiles.len() != tiles_per_section {
                    return Err(map_source_changed_error());
                }
                let byte_len = tiles_per_section
                    .checked_mul(MAP_TILE_SIZE)
                    .ok_or_else(map_source_changed_error)?;
                let mut current_bytes = vec![0u8; byte_len];
                file.seek(SeekFrom::Start(u64::from(current_offset)))
                    .map_err(|_| map_source_changed_error())?;
                file.read_exact(&mut current_bytes)
                    .map_err(|_| map_source_changed_error())?;

                let mut cached_bytes = Vec::with_capacity(byte_len);
                for tile in &section.tiles {
                    append_map_tile_bytes(&mut cached_bytes, tile);
                }
                if current_bytes != cached_bytes {
                    return Err(map_source_changed_error());
                }
            }
            _ => return Err(map_source_changed_error()),
        }
    }

    Ok(())
}

fn read_current_map_offsets(
    file: &mut std::fs::File,
    map: &terrain::ParsedMap,
) -> Result<Vec<u32>, String> {
    file.seek(SeekFrom::Start(0))
        .map_err(|_| map_source_changed_error())?;
    let mut header = [0u8; MAP_HEADER_SIZE];
    file.read_exact(&mut header)
        .map_err(|_| map_source_changed_error())?;

    let n_map_flag = read_i32_le(&header, 0);
    let n_width = read_i32_le(&header, 4);
    let n_height = read_i32_le(&header, 8);
    let n_section_width = read_i32_le(&header, 12);
    let n_section_height = read_i32_le(&header, 16);
    if n_map_flag != map.header.n_map_flag
        || n_width != map.header.n_width
        || n_height != map.header.n_height
        || n_section_width != map.header.n_section_width
        || n_section_height != map.header.n_section_height
    {
        return Err(map_source_changed_error());
    }

    let section_count =
        checked_i32_product_to_usize(map.section_cnt_x, map.section_cnt_y, "MAP section count")?;
    if map.section_offsets.len() != section_count || map.sections.len() != section_count {
        return Err(map_source_changed_error());
    }

    let offset_byte_len = section_count
        .checked_mul(std::mem::size_of::<u32>())
        .ok_or_else(map_source_changed_error)?;
    let mut offset_bytes = vec![0u8; offset_byte_len];
    file.read_exact(&mut offset_bytes)
        .map_err(|_| map_source_changed_error())?;

    Ok(offset_bytes
        .chunks_exact(4)
        .map(|chunk| u32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect())
}

fn validation_window_sections(
    map: &terrain::ParsedMap,
    window: MapSourceValidationWindow,
) -> Result<Vec<usize>, String> {
    let (tile_x, tile_y, tile_width, tile_height) = match window {
        MapSourceValidationWindow::Tile { tile_x, tile_y } => {
            if tile_x < 0
                || tile_y < 0
                || tile_x >= map.header.n_width
                || tile_y >= map.header.n_height
            {
                return Err(format!("Invalid tile coordinates ({tile_x}, {tile_y})"));
            }
            (tile_x, tile_y, 1, 1)
        }
        MapSourceValidationWindow::Chunk {
            chunk_x,
            chunk_y,
            chunk_size,
            extra_positive_tile_border,
        } => {
            if chunk_size <= 0 {
                return Err("Chunk size must be positive".to_string());
            }
            if extra_positive_tile_border < 0 {
                return Err("Extra tile border must not be negative".to_string());
            }
            let chunk_count_x = div_ceil_i32(map.header.n_width, chunk_size);
            let chunk_count_y = div_ceil_i32(map.header.n_height, chunk_size);
            if chunk_x < 0 || chunk_y < 0 || chunk_x >= chunk_count_x || chunk_y >= chunk_count_y {
                return Err(format!(
                    "Invalid chunk ({chunk_x}, {chunk_y}) for {chunk_count_x} x {chunk_count_y} chunk map"
                ));
            }
            let tile_x = chunk_x * chunk_size;
            let tile_y = chunk_y * chunk_size;
            let base_tile_width = (map.header.n_width - tile_x).min(chunk_size);
            let base_tile_height = (map.header.n_height - tile_y).min(chunk_size);
            (
                tile_x,
                tile_y,
                (map.header.n_width - tile_x).min(base_tile_width + extra_positive_tile_border),
                (map.header.n_height - tile_y).min(base_tile_height + extra_positive_tile_border),
            )
        }
    };

    let start_section_x = tile_x / map.header.n_section_width;
    let start_section_y = tile_y / map.header.n_section_height;
    let end_section_x = (tile_x + tile_width - 1) / map.header.n_section_width;
    let end_section_y = (tile_y + tile_height - 1) / map.header.n_section_height;
    let mut sections = Vec::new();
    for section_y in start_section_y..=end_section_y {
        for section_x in start_section_x..=end_section_x {
            sections.push((section_y * map.section_cnt_x + section_x) as usize);
        }
    }
    Ok(sections)
}

fn append_map_tile_bytes(out: &mut Vec<u8>, tile: &terrain::MapTile) {
    out.extend_from_slice(&tile.dw_tile_info.to_le_bytes());
    out.push(tile.bt_tile_info);
    out.extend_from_slice(&tile.s_color.to_le_bytes());
    out.push(tile.c_height as u8);
    out.extend_from_slice(&tile.s_region.to_le_bytes());
    out.push(tile.bt_island);
    out.extend_from_slice(&tile.bt_block);
}

fn read_i32_le(bytes: &[u8], offset: usize) -> i32 {
    i32::from_le_bytes([
        bytes[offset],
        bytes[offset + 1],
        bytes[offset + 2],
        bytes[offset + 3],
    ])
}

fn checked_i32_product_to_usize(lhs: i32, rhs: i32, label: &str) -> Result<usize, String> {
    let value = i64::from(lhs)
        .checked_mul(i64::from(rhs))
        .ok_or_else(|| format!("{label} overflows"))?;
    usize::try_from(value).map_err(|_| format!("{label} is negative or too large"))
}

fn div_ceil_i32(value: i32, divisor: i32) -> i32 {
    (value + divisor - 1) / divisor
}

fn map_source_changed_error() -> String {
    "MAP source changed since this map was loaded. Reload the map before exporting edits."
        .to_string()
}

fn read_optional_source_file(
    path: &Path,
) -> Result<Option<(Vec<u8>, workbench::SourceFileInfo)>, String> {
    let data = match std::fs::read(path) {
        Ok(data) => data,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("Failed to read {}: {error}", path.display())),
    };
    let metadata = std::fs::metadata(path)
        .map_err(|e| format!("Failed to read metadata for {}: {e}", path.display()))?;
    let source = source_file_info_from_parts(
        data.len() as u64,
        metadata.modified().ok(),
        sha256_hex(&data),
    );
    Ok(Some((data, source)))
}

fn empty_source_file_info() -> workbench::SourceFileInfo {
    workbench::SourceFileInfo {
        map_modified_ms: 0,
        map_file_len: 0,
        content_sha256: String::new(),
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut hex = String::with_capacity(digest.len() * 2);
    for byte in digest {
        use std::fmt::Write;
        let _ = write!(hex, "{byte:02x}");
    }
    hex
}

#[cfg(test)]
fn source_file_info(path: &Path) -> Result<workbench::SourceFileInfo, String> {
    read_source_file(path).map(|(_, source)| source)
}

#[cfg(test)]
fn optional_source_file_info(path: &Path) -> Result<workbench::SourceFileInfo, String> {
    read_optional_source_file(path).map(|source| {
        source
            .map(|(_, source)| source)
            .unwrap_or_else(empty_source_file_info)
    })
}

fn read_first_existing_table_source_file(
    project_dir: &Path,
    candidates: &[&str],
) -> Result<Option<TableSourceFile>, String> {
    for candidate in candidates {
        let path = client_paths::table_file(project_dir, candidate);
        if let Some((data, source)) = read_optional_source_file(&path)? {
            return Ok(Some(TableSourceFile {
                name: candidate.to_string(),
                data,
                source,
            }));
        }
    }

    Ok(None)
}

fn read_first_existing_table_metadata(
    project_dir: &Path,
    candidates: &[&str],
) -> Result<Option<TableSourceMetadata>, String> {
    for candidate in candidates {
        let path = client_paths::table_file(project_dir, candidate);
        let Some((data, source)) = read_optional_source_file(&path)? else {
            continue;
        };
        return Ok(Some(TableSourceMetadata {
            name: candidate.to_string(),
            data,
            modified_ms: source.map_modified_ms,
            file_len: source.map_file_len,
            content_sha256: source.content_sha256,
        }));
    }

    Ok(None)
}

fn table_source_info(source: &Option<TableSourceFile>) -> workbench::SourceFileInfo {
    source
        .as_ref()
        .map(|source| source.source.clone())
        .unwrap_or_else(empty_source_file_info)
}

fn parse_scene_obj_table_source(
    source: &Option<TableSourceFile>,
) -> Result<HashMap<u32, super::scene_obj_info::SceneObjModelInfo>, String> {
    match source {
        Some(source) => {
            super::scene_obj_info::parse_scene_obj_info_bin(&source.data).map_err(|e| e.to_string())
        }
        None => Ok(HashMap::new()),
    }
}

fn parse_scene_effect_table_source(
    source: &Option<TableSourceFile>,
) -> Result<HashMap<u32, SceneEffectInfo>, String> {
    let Some(source) = source else {
        return Ok(HashMap::new());
    };

    if source.name.eq_ignore_ascii_case("sceneffectinfo.bin") {
        return crate::item::sceneffect::parse_scene_effect_info_bin(&source.data)
            .map_err(|e| e.to_string());
    }

    let text = std::str::from_utf8(&source.data).map_err(|e| e.to_string())?;
    Ok(crate::item::sceneffect::parse_scene_effect_info(text))
}

#[cfg(test)]
fn validate_source_unchanged(
    label: &str,
    path: &Path,
    expected: &workbench::SourceFileInfo,
) -> Result<(), String> {
    let current = optional_source_file_info(path)?;
    validate_source_info_unchanged(label, &current, expected)
}

fn validate_source_info_unchanged(
    label: &str,
    current: &workbench::SourceFileInfo,
    expected: &workbench::SourceFileInfo,
) -> Result<(), String> {
    if current.map_modified_ms == expected.map_modified_ms
        && current.map_file_len == expected.map_file_len
        && current.content_sha256 == expected.content_sha256
    {
        return Ok(());
    }

    Err(format!(
        "{label} source changed since this map was loaded. Reload the map before exporting edits."
    ))
}

fn placement_cache_key(
    project_id: uuid::Uuid,
    map_name: &str,
    obj_source: workbench::SourceFileInfo,
    scene_obj_source: workbench::SourceFileInfo,
    scene_effect_source: workbench::SourceFileInfo,
) -> workbench::MapPlacementCacheKey {
    workbench::MapPlacementCacheKey {
        project_id,
        map_name: map_name.to_string(),
        obj_modified_ms: obj_source.map_modified_ms,
        obj_file_len: obj_source.map_file_len,
        obj_content_sha256: obj_source.content_sha256,
        scene_obj_info_modified_ms: scene_obj_source.map_modified_ms,
        scene_obj_info_file_len: scene_obj_source.map_file_len,
        scene_obj_info_content_sha256: scene_obj_source.content_sha256,
        scene_effect_info_modified_ms: scene_effect_source.map_modified_ms,
        scene_effect_info_file_len: scene_effect_source.map_file_len,
        scene_effect_info_content_sha256: scene_effect_source.content_sha256,
    }
}

fn invalidate_map_caches(
    app_state: &AppState,
    project_id: uuid::Uuid,
    map_name: &str,
) -> Result<(), String> {
    {
        let mut cache = app_state
            .map_workbench_cache
            .lock()
            .map_err(|e| e.to_string())?;
        cache.retain(|key, _| !(key.project_id == project_id && key.map_name == map_name));
    }
    {
        let mut cache = app_state
            .map_placement_cache
            .lock()
            .map_err(|e| e.to_string())?;
        cache.retain(|key, _| !(key.project_id == project_id && key.map_name == map_name));
    }
    {
        let mut cache = app_state
            .map_placement_spatial_cache
            .lock()
            .map_err(|e| e.to_string())?;
        cache.retain(|key, _| !(key.project_id == project_id && key.map_name == map_name));
    }
    {
        let mut cache = app_state
            .map_texture_sampler_cache
            .lock()
            .map_err(|e| e.to_string())?;
        cache.retain(|key, _| !(key.project_id == project_id && key.map_name == map_name));
    }
    Ok(())
}

#[cfg(test)]
fn placement_source_from_cache_key(
    cache_key: &workbench::MapPlacementCacheKey,
) -> workbench::SourceFileInfo {
    workbench::SourceFileInfo {
        map_modified_ms: cache_key.obj_modified_ms,
        map_file_len: cache_key.obj_file_len,
        content_sha256: cache_key.obj_content_sha256.clone(),
    }
}

fn area_set_cache_key(
    project_id: uuid::Uuid,
    source: Option<&TableSourceMetadata>,
) -> workbench::AreaSetCacheKey {
    match source {
        Some(source) => workbench::AreaSetCacheKey {
            project_id,
            table_name: source.name.clone(),
            modified_ms: source.modified_ms,
            file_len: source.file_len,
            content_sha256: source.content_sha256.clone(),
        },
        None => workbench::AreaSetCacheKey {
            project_id,
            table_name: String::new(),
            modified_ms: 0,
            file_len: 0,
            content_sha256: String::new(),
        },
    }
}

fn source_file_info_from_parts(
    file_len: u64,
    modified: Option<SystemTime>,
    content_sha256: String,
) -> workbench::SourceFileInfo {
    let map_modified_ms = modified
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis().min(u64::MAX as u128) as u64)
        .unwrap_or(0);

    workbench::SourceFileInfo {
        map_modified_ms,
        map_file_len: file_len,
        content_sha256,
    }
}

#[cfg(test)]
fn placement_bounds_page(
    placements: &[MapPlacementRecord],
    min_x: f32,
    min_y: f32,
    max_x: f32,
    max_y: f32,
    limit: u32,
) -> MapPlacementPage {
    let limit = limit.clamp(1, 5000) as usize;
    let (total, items) =
        workbench::placements_in_bounds_with_total(placements, min_x, min_y, max_x, max_y, limit);

    MapPlacementPage {
        total: total.min(u32::MAX as usize) as u32,
        offset: 0,
        limit: limit as u32,
        items,
    }
}

fn placement_bounds_page_from_index(
    index: &workbench::PlacementSpatialIndex,
    min_x: f32,
    min_y: f32,
    max_x: f32,
    max_y: f32,
    limit: u32,
) -> MapPlacementPage {
    let limit = limit.clamp(1, 5000) as usize;
    let (total, items) = index.query_bounds(min_x, min_y, max_x, max_y, limit);

    MapPlacementPage {
        total: total.min(u32::MAX as usize) as u32,
        offset: 0,
        limit: limit as u32,
        items,
    }
}

fn rbo_records_bounds_page(
    parsed: &rbo::RboParseResult,
    min_x: f32,
    min_y: f32,
    max_x: f32,
    max_y: f32,
    limit: u32,
) -> rbo::RboRecordPage {
    let limit = limit.clamp(1, 5000) as usize;
    let bounds = (
        min_x.min(max_x),
        min_y.min(max_y),
        min_x.max(max_x),
        min_y.max(max_y),
    );
    let mut total = 0usize;
    let mut items = Vec::new();

    for record in &parsed.records {
        if record.x >= bounds.0
            && record.x < bounds.2
            && record.y >= bounds.1
            && record.y < bounds.3
        {
            total += 1;
            if items.len() < limit {
                items.push(*record);
            }
        }
    }

    rbo::RboRecordPage {
        total: total.min(u32::MAX as usize) as u32,
        offset: 0,
        limit: limit as u32,
        warning_count: parsed.warnings.len().min(u32::MAX as usize) as u32,
        first_warning: parsed.warnings.first().cloned(),
        items,
    }
}

fn normalize_optional_placement_viewport_bounds(
    min_x: Option<f32>,
    min_y: Option<f32>,
    max_x: Option<f32>,
    max_y: Option<f32>,
) -> Result<Option<(f32, f32, f32, f32)>, String> {
    if min_x.is_none() && min_y.is_none() && max_x.is_none() && max_y.is_none() {
        return Ok(None);
    }

    let (Some(min_x), Some(min_y), Some(max_x), Some(max_y)) = (min_x, min_y, max_x, max_y) else {
        return Err("Placement viewport bounds must be complete".to_string());
    };

    if ![min_x, min_y, max_x, max_y]
        .iter()
        .all(|value| value.is_finite())
    {
        return Err("Placement viewport bounds must be finite".to_string());
    }

    Ok(Some((
        min_x.min(max_x),
        min_y.min(max_y),
        min_x.max(max_x),
        min_y.max(max_y),
    )))
}

fn placement_matches_type(placement: &MapPlacementRecord, placement_type: &str) -> bool {
    match placement_type {
        "building" => placement.obj_type == 0,
        "effect" => placement.obj_type == 1,
        _ => true,
    }
}

fn placement_matches_search(placement: &MapPlacementRecord, query: &str) -> bool {
    if query.is_empty() {
        return true;
    }

    let id_matches =
        placement.obj_id.to_string().contains(query) || placement.index.to_string().contains(query);
    let display_matches = placement
        .display_name
        .as_deref()
        .map(|v| v.to_ascii_lowercase().contains(query))
        .unwrap_or(false);
    let asset_matches = placement
        .asset_name
        .as_deref()
        .map(|v| v.to_ascii_lowercase().contains(query))
        .unwrap_or(false);

    id_matches || display_matches || asset_matches || placement.kind.contains(query)
}

fn placement_distance(placement: &MapPlacementRecord, near_center: (f32, f32)) -> f32 {
    let dx = placement.world_x - near_center.0;
    let dy = placement.world_y - near_center.1;
    (dx * dx + dy * dy).sqrt()
}

fn placement_near_distance(
    placement: &MapPlacementRecord,
    near_center: Option<(f32, f32)>,
    near_radius: f32,
) -> Option<Option<f32>> {
    let Some(center) = near_center else {
        return Some(None);
    };

    let distance = placement_distance(placement, center);
    if distance > near_radius {
        return None;
    }

    Some(Some(distance))
}

fn query_placement_page(
    placements: &[MapPlacementRecord],
    query: &str,
    placement_type: &str,
    near_center: Option<(f32, f32)>,
    near_radius: f32,
    viewport_bounds: Option<(f32, f32, f32, f32)>,
    offset: u32,
    limit: u32,
) -> MapPlacementPage {
    let query = query.trim().to_ascii_lowercase();
    let near_radius = near_radius.max(0.0);
    let offset = offset as usize;
    let limit = limit.clamp(1, 5000) as usize;

    let mut filtered: Vec<MapPlacementRecord> = placements
        .iter()
        .filter(|placement| placement_matches_type(placement, placement_type))
        .filter(|placement| {
            if let Some((min_x, min_y, max_x, max_y)) = viewport_bounds {
                placement.world_x >= min_x
                    && placement.world_x < max_x
                    && placement.world_y >= min_y
                    && placement.world_y < max_y
            } else {
                true
            }
        })
        .filter(|placement| placement_matches_search(placement, &query))
        .filter_map(|placement| {
            let distance = placement_near_distance(placement, near_center, near_radius)?;
            let mut placement = placement.clone();
            placement.distance = distance;
            Some(placement)
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

    let total = filtered.len().min(u32::MAX as usize) as u32;
    let items = filtered.into_iter().skip(offset).take(limit).collect();

    MapPlacementPage {
        total,
        offset: offset as u32,
        limit: limit as u32,
        items,
    }
}

fn query_indexed_placement_page(
    index: &workbench::PlacementSpatialIndex,
    query: &str,
    placement_type: &str,
    near_center: Option<(f32, f32)>,
    near_radius: f32,
    viewport_bounds: (f32, f32, f32, f32),
    offset: u32,
    limit: u32,
) -> MapPlacementPage {
    let query = query.trim().to_ascii_lowercase();
    let near_radius = near_radius.max(0.0);
    let offset = offset as usize;
    let limit = limit.clamp(1, 5000) as usize;
    let matched = index.query_bounds_indices_matching(
        viewport_bounds.0,
        viewport_bounds.1,
        viewport_bounds.2,
        viewport_bounds.3,
        |placement| {
            placement_matches_type(placement, placement_type)
                && placement_matches_search(placement, &query)
                && placement_near_distance(placement, near_center, near_radius).is_some()
        },
    );

    let total = matched.len().min(u32::MAX as usize) as u32;
    let items = if let Some(center) = near_center {
        let mut ranked: Vec<(f32, usize)> = matched
            .into_iter()
            .filter_map(|record_index| {
                index
                    .record_at(record_index)
                    .map(|placement| (placement_distance(placement, center), record_index))
            })
            .collect();

        ranked.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));

        ranked
            .into_iter()
            .skip(offset)
            .take(limit)
            .filter_map(|(distance, record_index)| {
                let mut placement = index.record_at(record_index)?.clone();
                placement.distance = Some(distance);
                Some(placement)
            })
            .collect()
    } else {
        matched
            .into_iter()
            .skip(offset)
            .take(limit)
            .filter_map(|record_index| {
                let mut placement = index.record_at(record_index)?.clone();
                placement.distance = None;
                Some(placement)
            })
            .collect()
    };

    MapPlacementPage {
        total,
        offset: offset as u32,
        limit: limit as u32,
        items,
    }
}

#[tauri::command]
pub async fn get_map_workbench_manifest(
    app_state: State<'_, AppState>,
    project_id: String,
    map_name: String,
) -> Result<workbench::MapWorkbenchManifest, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;
    let (map, source) = load_parsed_map_cached(
        app_state.inner(),
        project_id,
        project.project_directory.as_ref(),
        &map_name,
        None,
        None,
    )?;
    let terrain_texture_status = terrain_texture_status_for_map(
        app_state.inner(),
        project_id,
        project.project_directory.as_ref(),
        &map_name,
        map.as_ref(),
        &source,
    )?;
    let (placements, placement_source, _) = load_map_placements_with_source_cached(
        app_state.inner(),
        project_id,
        project.project_directory.as_ref(),
        &map_name,
    )?;
    let rbo_path = client_paths::asset_file(
        project.project_directory.as_ref(),
        "map",
        format!("{map_name}.rbo"),
    );
    let (rbo_source, rbo_summary) = match read_optional_source_file(&rbo_path)? {
        Some((bytes, source)) => {
            let summary = rbo::summarize_rbo_bytes(&bytes, bytes.len() as u64);
            (source, summary)
        }
        None => (empty_source_file_info(), rbo::RboSummary::missing()),
    };

    Ok(workbench::build_manifest(
        map.as_ref(),
        &map_name,
        workbench::DEFAULT_CHUNK_SIZE,
        placements.len(),
        source,
        placement_source,
        rbo_source,
        rbo_summary,
        terrain_texture_status,
    ))
}

#[tauri::command]
pub async fn get_map_overview(
    app_state: State<'_, AppState>,
    project_id: String,
    map_name: String,
    layer: workbench::MapWorkbenchLayer,
    max_size: Option<u32>,
) -> Result<workbench::MapOverviewLayer, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;
    let (map, map_source) = load_parsed_map_cached(
        app_state.inner(),
        project_id,
        project.project_directory.as_ref(),
        &map_name,
        None,
        None,
    )?;

    if matches!(
        layer,
        workbench::MapWorkbenchLayer::TextureBase | workbench::MapWorkbenchLayer::TextureRaw
    ) {
        if let Some(sampler) = load_terrain_texture_sampler_cached(
            app_state.inner(),
            project_id,
            project.project_directory.as_ref(),
            &map_name,
            map.as_ref(),
            &map_source,
            true,
        )? {
            return texture::build_textured_overview_layer(
                map.as_ref(),
                sampler.as_ref(),
                layer,
                max_size.unwrap_or(1024),
            )
            .map_err(|e| e.to_string());
        }
        return Err(
            "Terrain texture assets are unavailable for this map; use the manifest status for details"
                .to_string(),
        );
    }

    let areas = if layer == workbench::MapWorkbenchLayer::Island {
        Some(
            load_area_set_cached(
                app_state.inner(),
                project_id,
                project.project_directory.as_ref(),
            )
            .unwrap_or_else(|_| Arc::new(HashMap::new())),
        )
    } else {
        None
    };

    workbench::build_overview_layer(
        map.as_ref(),
        layer,
        max_size.unwrap_or(1024),
        areas.as_deref(),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_map_chunk(
    app_state: State<'_, AppState>,
    project_id: String,
    map_name: String,
    request: workbench::MapChunkRequest,
) -> Result<workbench::MapChunkPayload, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;
    let chunk_size = request
        .chunk_size
        .unwrap_or(workbench::DEFAULT_CHUNK_SIZE)
        .clamp(1, workbench::DEFAULT_CHUNK_SIZE);
    let (map, map_source) = load_parsed_map_cached(
        app_state.inner(),
        project_id,
        project.project_directory.as_ref(),
        &map_name,
        request.source_guard.as_ref(),
        Some(MapSourceValidationWindow::Chunk {
            chunk_x: request.chunk_x,
            chunk_y: request.chunk_y,
            chunk_size,
            extra_positive_tile_border: if matches!(
                request.layer,
                workbench::MapWorkbenchLayer::TextureBase
                    | workbench::MapWorkbenchLayer::TextureRaw
            ) {
                1
            } else {
                0
            },
        }),
    )?;

    if matches!(
        request.layer,
        workbench::MapWorkbenchLayer::TextureBase | workbench::MapWorkbenchLayer::TextureRaw
    ) && !request.include_numeric_payload
    {
        if let Some(sampler) = load_terrain_texture_sampler_cached(
            app_state.inner(),
            project_id,
            project.project_directory.as_ref(),
            &map_name,
            map.as_ref(),
            &map_source,
            false,
        )? {
            return texture::build_textured_chunk_payload(
                map.as_ref(),
                sampler.as_ref(),
                request,
                chunk_size,
            )
            .map_err(|e| e.to_string());
        }
        return Err(
            "Terrain texture assets are unavailable for this map; use the manifest status for details"
                .to_string(),
        );
    }

    let areas = if request.layer == workbench::MapWorkbenchLayer::Island {
        Some(
            load_area_set_cached(
                app_state.inner(),
                project_id,
                project.project_directory.as_ref(),
            )
            .unwrap_or_else(|_| Arc::new(HashMap::new())),
        )
    } else {
        None
    };

    workbench::build_chunk_payload(map.as_ref(), request, chunk_size, areas.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn inspect_map_tile(
    app_state: State<'_, AppState>,
    project_id: String,
    map_name: String,
    tile_x: i32,
    tile_y: i32,
    include_placements: Option<bool>,
    source_guard: Option<workbench::SourceFileInfo>,
) -> Result<workbench::MapTileInspection, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;
    let (map, _) = load_parsed_map_cached(
        app_state.inner(),
        project_id,
        project.project_directory.as_ref(),
        &map_name,
        source_guard.as_ref(),
        Some(MapSourceValidationWindow::Tile { tile_x, tile_y }),
    )?;
    let placements = if include_placements.unwrap_or(true) {
        load_map_placements_cached(
            app_state.inner(),
            project_id,
            project.project_directory.as_ref(),
            &map_name,
        )?
    } else {
        Arc::new(Vec::new())
    };
    let areas = load_area_set_cached(
        app_state.inner(),
        project_id,
        project.project_directory.as_ref(),
    )
    .unwrap_or_else(|_| Arc::new(HashMap::new()));

    workbench::inspect_tile(
        map.as_ref(),
        tile_x,
        tile_y,
        placements.as_ref(),
        Some(areas.as_ref()),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_map_tile_texture_preview(
    app_state: State<'_, AppState>,
    project_id: String,
    map_name: String,
    tile_x: i32,
    tile_y: i32,
    source_guard: Option<workbench::SourceFileInfo>,
) -> Result<Option<workbench::MapTileTexturePreview>, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;
    let (map, map_source) = load_parsed_map_cached(
        app_state.inner(),
        project_id,
        project.project_directory.as_ref(),
        &map_name,
        source_guard.as_ref(),
        Some(MapSourceValidationWindow::Tile { tile_x, tile_y }),
    )?;

    let Some(sampler) = load_terrain_texture_sampler_cached(
        app_state.inner(),
        project_id,
        project.project_directory.as_ref(),
        &map_name,
        map.as_ref(),
        &map_source,
        false,
    )?
    else {
        return Ok(None);
    };

    texture::build_tile_texture_preview(
        map.as_ref(),
        sampler.as_ref(),
        tile_x,
        tile_y,
        TILE_TEXTURE_PREVIEW_SAMPLES_PER_AXIS,
    )
    .map(Some)
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn query_map_placements_in_bounds(
    app_state: State<'_, AppState>,
    project_id: String,
    map_name: String,
    min_x: f32,
    min_y: f32,
    max_x: f32,
    max_y: f32,
    limit: Option<u32>,
) -> Result<MapPlacementPage, String> {
    if ![min_x, min_y, max_x, max_y]
        .iter()
        .all(|value| value.is_finite())
    {
        return Err("Placement bounds must be finite".to_string());
    }

    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;
    let index = load_map_placement_index_cached(
        app_state.inner(),
        project_id,
        project.project_directory.as_ref(),
        &map_name,
    )?;

    Ok(placement_bounds_page_from_index(
        index.as_ref(),
        min_x,
        min_y,
        max_x,
        max_y,
        limit.unwrap_or(500),
    ))
}

#[tauri::command]
pub async fn query_map_rbo_records_in_bounds(
    project_id: String,
    map_name: String,
    min_x: f32,
    min_y: f32,
    max_x: f32,
    max_y: f32,
    limit: Option<u32>,
) -> Result<rbo::RboRecordPage, String> {
    if ![min_x, min_y, max_x, max_y]
        .iter()
        .all(|value| value.is_finite())
    {
        return Err("RBO bounds must be finite".to_string());
    }

    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;
    let rbo_path = client_paths::asset_file(
        project.project_directory.as_ref(),
        "map",
        format!("{map_name}.rbo"),
    );
    let parsed = match read_optional_source_file(&rbo_path)? {
        Some((bytes, _source)) => rbo::parse_rbo_records(&bytes),
        None => rbo::RboParseResult {
            records: Vec::new(),
            warnings: Vec::new(),
        },
    };

    Ok(rbo_records_bounds_page(
        &parsed,
        min_x,
        min_y,
        max_x,
        max_y,
        limit.unwrap_or(500),
    ))
}

#[tauri::command]
pub async fn export_map_tile_edits(
    project_id: String,
    map_name: String,
    patches: Vec<map_writer::MapTilePatch>,
    source_guard: workbench::SourceFileInfo,
) -> Result<map_writer::MapTileEditExportResult, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;
    let output_dir = project
        .project_directory
        .join("pko-tools")
        .join("exports")
        .join("map-edits");

    export_map_tile_edits_to_dir(
        project.project_directory.as_ref(),
        &map_name,
        &patches,
        &output_dir,
        &source_guard,
    )
}

#[tauri::command]
pub async fn export_map_placement_edits(
    project_id: String,
    map_name: String,
    patches: Vec<obj_writer::MapPlacementEdit>,
    source_guard: workbench::SourceFileInfo,
) -> Result<obj_writer::MapPlacementEditExportResult, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;
    let output_dir = project
        .project_directory
        .join("pko-tools")
        .join("exports")
        .join("map-edits");

    export_map_placement_edits_to_dir(
        project.project_directory.as_ref(),
        &map_name,
        &patches,
        &output_dir,
        &source_guard,
    )
}

#[tauri::command]
pub async fn export_map_edits(
    project_id: String,
    map_name: String,
    tile_patches: Vec<map_writer::MapTilePatch>,
    placement_edits: Vec<obj_writer::MapPlacementEdit>,
    source_guard: MapEditSourceGuard,
) -> Result<MapEditExportResult, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;
    let output_dir = project
        .project_directory
        .join("pko-tools")
        .join("exports")
        .join("map-edits");

    export_map_edits_to_dir(
        project.project_directory.as_ref(),
        &map_name,
        &tile_patches,
        &placement_edits,
        &output_dir,
        &source_guard,
    )
}

#[tauri::command]
pub async fn apply_map_edit_client_package(
    app_state: State<'_, AppState>,
    project_id: String,
    map_name: String,
    package: MapEditClientPackage,
    source_guard: MapEditSourceGuard,
) -> Result<MapEditClientApplyResult, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;
    let backup_root = project
        .project_directory
        .join("pko-tools")
        .join("backups")
        .join("map-edits");
    let package_root = project
        .project_directory
        .join("pko-tools")
        .join("exports")
        .join("map-edits");

    let result = apply_map_edit_client_package_to_dir(
        project.project_directory.as_ref(),
        &map_name,
        &package,
        &package_root,
        &backup_root,
        &source_guard,
    )?;
    invalidate_map_caches(app_state.inner(), project_id, &map_name)?;
    Ok(result)
}

#[tauri::command]
pub async fn restore_map_edit_client_backup(
    app_state: State<'_, AppState>,
    project_id: String,
    map_name: String,
    backup_dir: String,
) -> Result<MapEditClientRestoreResult, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;
    let backup_root = project
        .project_directory
        .join("pko-tools")
        .join("backups")
        .join("map-edits");

    let result = restore_map_edit_client_backup_to_dir(
        project.project_directory.as_ref(),
        &map_name,
        &backup_dir,
        &backup_root,
    )?;
    if let Err(error) = invalidate_map_caches(app_state.inner(), project_id, &map_name) {
        eprintln!("Failed to invalidate map caches after restore: {error}");
    }
    Ok(result)
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

fn scene_effect_entries_from_info(
    effect_info: HashMap<u32, SceneEffectInfo>,
) -> Vec<SceneEffectEntry> {
    let mut entries: Vec<SceneEffectEntry> = effect_info
        .into_values()
        .map(|info| {
            let fallback_name = info
                .filename
                .strip_suffix(".par")
                .or_else(|| info.filename.strip_suffix(".PAR"))
                .unwrap_or(&info.filename)
                .to_string();
            let display_name = if info.display_name.trim().is_empty() {
                fallback_name
            } else {
                info.display_name
            };

            SceneEffectEntry {
                id: info.id,
                filename: info.filename,
                display_name,
                effect_type: info.eff_type,
                object_type: info.obj_type,
                play_time: info.play_time,
                base_size: info.base_size,
            }
        })
        .collect();

    entries.sort_by(|a, b| a.id.cmp(&b.id));
    entries
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
    viewport_min_x: Option<f32>,
    viewport_min_y: Option<f32>,
    viewport_max_x: Option<f32>,
    viewport_max_y: Option<f32>,
) -> Result<MapPlacementPage, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    let query = query.unwrap_or_default();
    let placement_type = placement_type.unwrap_or_else(|| "all".to_string());
    let near_center = match (near_x, near_y) {
        (Some(x), Some(y)) => Some((x, y)),
        _ => None,
    };
    let viewport_bounds = normalize_optional_placement_viewport_bounds(
        viewport_min_x,
        viewport_min_y,
        viewport_max_x,
        viewport_max_y,
    )?;

    if let Some(bounds) = viewport_bounds {
        let index = load_map_placement_index_cached(
            app_state.inner(),
            project_id,
            project.project_directory.as_ref(),
            &map_name,
        )?;

        return Ok(query_indexed_placement_page(
            index.as_ref(),
            &query,
            &placement_type,
            near_center,
            near_radius.unwrap_or(50.0),
            bounds,
            offset.unwrap_or(0),
            limit.unwrap_or(200),
        ));
    }

    let placements = load_map_placements_cached(
        app_state.inner(),
        project_id,
        project.project_directory.as_ref(),
        &map_name,
    )?;

    Ok(query_placement_page(
        placements.as_ref(),
        &query,
        &placement_type,
        near_center,
        near_radius.unwrap_or(50.0),
        viewport_bounds,
        offset.unwrap_or(0),
        limit.unwrap_or(200),
    ))
}

#[tauri::command]
pub async fn get_map_list(project_id: String) -> Result<Vec<MapEntry>, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    terrain::scan_maps(project.project_directory.as_ref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_scene_effect_list(project_id: String) -> Result<Vec<SceneEffectEntry>, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    let effect_info =
        crate::item::sceneffect::load_scene_effect_info(project.project_directory.as_ref())
            .map_err(|e| e.to_string())?;

    Ok(scene_effect_entries_from_info(effect_info))
}

#[tauri::command]
pub async fn get_terrain_texture_catalog(
    project_id: String,
) -> Result<Vec<TerrainTextureEntry>, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    texture::terrain_texture_catalog(project.project_directory.as_ref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_terrain_texture_preview(
    project_id: String,
    texture_id: u8,
) -> Result<Option<String>, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    texture::terrain_texture_preview_data_uri(project.project_directory.as_ref(), texture_id)
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

fn building_scene_info_from_model_info(
    info: &super::scene_obj_info::SceneObjModelInfo,
) -> BuildingSceneInfo {
    let display_name = if info.display_name.trim().is_empty() {
        info.filename
            .strip_suffix(".lmo")
            .or_else(|| info.filename.strip_suffix(".LMO"))
            .unwrap_or(&info.filename)
            .to_string()
    } else {
        info.display_name.clone()
    };

    BuildingSceneInfo {
        building_id: info.id,
        filename: info.filename.clone(),
        display_name,
        scene_obj_type: info.obj_type,
        shade_flag: info.shade_flag,
        enable_point_light: info.enable_point_light,
        enable_env_light: info.enable_env_light,
        attach_effect_id: info.attach_effect_id,
        style: info.style,
        flag: info.flag,
        size_flag: info.size_flag,
        anim_ctrl_id: info.anim_ctrl_id,
        is_really_big: info.is_really_big,
        point_color: info.point_color,
        env_color: info.env_color,
        point_range: info.point_range,
        point_attenuation: info.point_attenuation,
        fade_obj_num: info.fade_obj_num,
        fade_obj_seq: info.fade_obj_seq.clone(),
        fade_coefficient: info.fade_coefficient,
    }
}

#[tauri::command]
pub async fn get_building_scene_info(
    project_id: String,
    building_id: u32,
) -> Result<Option<BuildingSceneInfo>, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    let obj_info = super::scene_obj_info::load_scene_obj_info(project.project_directory.as_ref())
        .map_err(|e| e.to_string())?;

    Ok(obj_info
        .get(&building_id)
        .map(building_scene_info_from_model_info))
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

    Ok(super::lmo_types::build_metadata(
        &lmo,
        building_id,
        &info.filename,
    ))
}

#[cfg(test)]
mod workbench_command_tests {
    use super::*;
    use crate::item::sceneffect::SceneEffectInfo;
    use crate::map::map_loader::load_map;
    use crate::map::map_writer::{serialize_map, MapTilePatch};
    use crate::map::obj_loader::load_obj;
    use crate::map::obj_writer::{serialize_obj, MapPlacementEdit};
    use crate::map::scene_obj::{ParsedObjFile, SceneObject};
    use crate::map::terrain::{MapHeader, MapSection, MapTile, ParsedMap};
    use std::collections::HashMap;
    use std::fs;
    use std::path::Path;
    use std::sync::Arc;
    use std::time::{Duration, UNIX_EPOCH};

    #[test]
    fn source_file_info_uses_len_and_modified_ms() {
        let info = source_file_info_from_parts(
            1234,
            Some(UNIX_EPOCH + Duration::from_millis(5678)),
            "hash".to_string(),
        );
        assert_eq!(info.map_file_len, 1234);
        assert_eq!(info.map_modified_ms, 5678);
        assert_eq!(info.content_sha256, "hash");
    }

    #[test]
    fn validate_source_unchanged_rejects_same_metadata_with_different_hash() {
        let temp_dir = tempfile::tempdir().unwrap();
        let source_path = temp_dir.path().join("source.map");
        fs::write(&source_path, b"same length one").unwrap();
        let current = source_file_info(&source_path).unwrap();
        let expected = workbench::SourceFileInfo {
            map_file_len: current.map_file_len,
            map_modified_ms: current.map_modified_ms,
            content_sha256: "different".to_string(),
        };

        let error = validate_source_unchanged("MAP", &source_path, &expected).unwrap_err();

        assert!(error.contains("MAP source changed since this map was loaded"));
    }

    #[test]
    fn missing_terrain_info_status_counts_referenced_textures() {
        let map = one_section_map();
        let status =
            terrain_texture_missing_table_status(&map, Path::new("scripts/table/TerrainInfo.bin"));

        assert!(!status.available);
        assert_eq!(status.loaded_count, 0);
        assert!(status.referenced_count > 0);
        assert_eq!(status.missing_count, status.referenced_count);
        assert!(!status.alpha_atlas_available);
        assert!(status
            .message
            .unwrap()
            .contains("TerrainInfo.bin was not found"));
    }

    #[test]
    fn terrain_texture_load_error_status_keeps_manifest_loadable() {
        let map = one_section_map();
        let status =
            terrain_texture_load_error_status(&map, "TerrainInfo.bin unexpected struct size: 4");

        assert!(!status.available);
        assert_eq!(status.loaded_count, 0);
        assert!(status.referenced_count > 0);
        assert_eq!(status.missing_count, status.referenced_count);
        assert!(status
            .message
            .unwrap()
            .contains("Terrain texture assets could not be loaded"));
    }

    #[test]
    fn placement_source_comes_from_placement_cache_key_obj_metadata() {
        let cache_key = workbench::MapPlacementCacheKey {
            project_id: uuid::Uuid::nil(),
            map_name: "garner".to_string(),
            obj_modified_ms: 111,
            obj_file_len: 222,
            obj_content_sha256: "obj-hash".to_string(),
            scene_obj_info_modified_ms: 333,
            scene_obj_info_file_len: 444,
            scene_obj_info_content_sha256: "scene-obj-hash".to_string(),
            scene_effect_info_modified_ms: 555,
            scene_effect_info_file_len: 666,
            scene_effect_info_content_sha256: "scene-effect-hash".to_string(),
        };

        let source = placement_source_from_cache_key(&cache_key);

        assert_eq!(source.map_modified_ms, 111);
        assert_eq!(source.map_file_len, 222);
        assert_eq!(source.content_sha256, "obj-hash");
    }

    #[test]
    fn parsed_map_cache_can_hit_from_expected_source_without_rehashing() {
        let project_id = uuid::Uuid::new_v4();
        let map = Arc::new(one_section_map());
        let expected_source = workbench::SourceFileInfo {
            map_modified_ms: 111,
            map_file_len: 222,
            content_sha256: "map-hash".to_string(),
        };
        let cache_key = workbench::ParsedMapCacheKey {
            project_id,
            map_name: "garner".to_string(),
            modified_ms: expected_source.map_modified_ms,
            file_len: expected_source.map_file_len,
            content_sha256: expected_source.content_sha256.clone(),
        };
        let mut cache = HashMap::new();
        cache.insert(cache_key, Arc::clone(&map));

        let (cached, source) =
            cached_parsed_map_for_expected_source(&cache, project_id, "garner", &expected_source)
                .unwrap();

        assert!(Arc::ptr_eq(&cached, &map));
        assert_eq!(source.map_modified_ms, 111);
        assert_eq!(source.map_file_len, 222);
        assert_eq!(source.content_sha256, "map-hash");
    }

    #[test]
    fn parsed_map_cache_misses_when_expected_source_hash_differs() {
        let project_id = uuid::Uuid::new_v4();
        let cache_key = workbench::ParsedMapCacheKey {
            project_id,
            map_name: "garner".to_string(),
            modified_ms: 111,
            file_len: 222,
            content_sha256: "old-map-hash".to_string(),
        };
        let expected_source = workbench::SourceFileInfo {
            map_modified_ms: 111,
            map_file_len: 222,
            content_sha256: "new-map-hash".to_string(),
        };
        let mut cache = HashMap::new();
        cache.insert(cache_key, Arc::new(one_section_map()));

        let cached =
            cached_parsed_map_for_expected_source(&cache, project_id, "garner", &expected_source);

        assert!(cached.is_none());
    }

    #[test]
    fn cached_map_window_validation_rejects_changed_requested_section() {
        let temp_dir = tempfile::tempdir().unwrap();
        let map_path = temp_dir.path().join("garner.map");
        let cached_map = one_section_map();
        let cached_bytes = serialize_map(&cached_map).unwrap();
        let cached_map = load_map(&cached_bytes).unwrap();

        let mut changed_map = one_section_map();
        changed_map.sections[0].as_mut().unwrap().tiles[0].c_height = 99;
        let changed_bytes = serialize_map(&changed_map).unwrap();
        assert_eq!(changed_bytes.len(), cached_bytes.len());
        fs::write(&map_path, changed_bytes).unwrap();

        let error = validate_cached_map_window_current(
            &map_path,
            &cached_map,
            MapSourceValidationWindow::Tile {
                tile_x: 0,
                tile_y: 0,
            },
        )
        .unwrap_err();

        assert!(error.contains("MAP source changed since this map was loaded"));
    }

    #[test]
    fn texture_chunk_window_validation_includes_positive_neighbor_border() {
        let temp_dir = tempfile::tempdir().unwrap();
        let map_path = temp_dir.path().join("garner.map");
        let cached_map = two_section_map();
        let cached_bytes = serialize_map(&cached_map).unwrap();
        let cached_map = load_map(&cached_bytes).unwrap();

        let mut changed_map = two_section_map();
        changed_map.sections[1].as_mut().unwrap().tiles[0].s_color = 0x07e0;
        let changed_bytes = serialize_map(&changed_map).unwrap();
        assert_eq!(changed_bytes.len(), cached_bytes.len());
        fs::write(&map_path, changed_bytes).unwrap();

        let error = validate_cached_map_window_current(
            &map_path,
            &cached_map,
            MapSourceValidationWindow::Chunk {
                chunk_x: 0,
                chunk_y: 0,
                chunk_size: 2,
                extra_positive_tile_border: 1,
            },
        )
        .unwrap_err();

        assert!(error.contains("MAP source changed since this map was loaded"));
    }

    #[test]
    fn building_scene_info_preserves_scene_object_flags() {
        let model = crate::map::scene_obj_info::SceneObjModelInfo {
            id: 26,
            filename: "nml-bd151.lmo".to_string(),
            display_name: "Volcano 01".to_string(),
            obj_type: 3,
            shade_flag: true,
            enable_point_light: true,
            enable_env_light: true,
            attach_effect_id: 88,
            style: 7,
            flag: 9,
            size_flag: 1,
            anim_ctrl_id: 12,
            is_really_big: true,
            point_color: [255, 128, 64],
            env_color: [16, 32, 48],
            point_range: 1200,
            point_attenuation: 0.5,
            fade_obj_num: 2,
            fade_obj_seq: vec![4, 5],
            fade_coefficient: 0.35,
        };

        let info = building_scene_info_from_model_info(&model);

        assert_eq!(info.building_id, 26);
        assert_eq!(info.filename, "nml-bd151.lmo");
        assert_eq!(info.display_name, "Volcano 01");
        assert_eq!(info.scene_obj_type, 3);
        assert!(info.shade_flag);
        assert!(info.enable_point_light);
        assert!(info.enable_env_light);
        assert_eq!(info.attach_effect_id, 88);
        assert_eq!(info.style, 7);
        assert_eq!(info.flag, 9);
        assert_eq!(info.size_flag, 1);
        assert_eq!(info.anim_ctrl_id, 12);
        assert!(info.is_really_big);
        assert_eq!(info.point_color, [255, 128, 64]);
        assert_eq!(info.env_color, [16, 32, 48]);
        assert_eq!(info.point_range, 1200);
        assert_eq!(info.point_attenuation, 0.5);
        assert_eq!(info.fade_obj_num, 2);
        assert_eq!(info.fade_obj_seq, vec![4, 5]);
        assert_eq!(info.fade_coefficient, 0.35);
    }

    #[test]
    fn placement_bounds_include_min_exclude_max_and_report_uncapped_total() {
        let placements = vec![
            placement(1, 10.0, 10.0),
            placement(2, 12.0, 12.0),
            placement(3, 20.0, 20.0),
        ];

        let page = placement_bounds_page(&placements, 10.0, 10.0, 20.0, 20.0, 1);

        assert_eq!(page.total, 2);
        assert_eq!(page.limit, 1);
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].index, 1);
    }

    #[test]
    fn rbo_bounds_include_min_exclude_max_and_preserve_parse_warnings() {
        let parsed = rbo::parse_rbo_records(
            b"bad line\n26 10 10 0 -180 0 0 0 1\n316 12 12 0 75 0 0 0 2\n248 20 20 0 0 0 0 0 3\n",
        );

        let page = rbo_records_bounds_page(&parsed, 10.0, 10.0, 20.0, 20.0, 1);

        assert_eq!(page.total, 2);
        assert_eq!(page.limit, 1);
        assert_eq!(page.warning_count, 1);
        assert_eq!(
            page.first_warning.as_deref(),
            Some("line 1 has 2 fields; expected 9")
        );
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].index, 0);
        assert_eq!(page.items[0].type_id, 26);
    }

    #[test]
    fn placement_query_combines_viewport_bounds_with_near_radius() {
        let placements = vec![
            placement(1, 12.0, 12.0),
            placement(2, 14.0, 14.0),
            placement(3, 60.0, 60.0),
            placement(4, 18.0, 30.0),
        ];

        let page = query_placement_page(
            &placements,
            "",
            "all",
            Some((15.0, 15.0)),
            10.0,
            Some((10.0, 10.0, 20.0, 20.0)),
            0,
            200,
        );

        assert_eq!(page.total, 2);
        assert_eq!(
            page.items
                .iter()
                .map(|placement| placement.index)
                .collect::<Vec<_>>(),
            vec![2, 1],
        );
        assert!(page
            .items
            .iter()
            .all(|placement| placement.distance.is_some()));
    }

    #[test]
    fn indexed_placement_query_filters_viewport_candidates() {
        let placements = Arc::new(vec![
            placement(1, 12.0, 12.0),
            placement(2, 14.0, 14.0),
            placement_with_name(3, 60.0, 60.0, "Volcano 01"),
            placement_with_name(4, 18.0, 18.0, "Volcano 02"),
        ]);
        let index = workbench::PlacementSpatialIndex::new(Arc::clone(&placements), 8.0);

        let page = query_indexed_placement_page(
            &index,
            "volcano",
            "all",
            Some((15.0, 15.0)),
            10.0,
            (10.0, 10.0, 20.0, 20.0),
            0,
            200,
        );

        assert_eq!(page.total, 1);
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].index, 4);
        assert!(page.items[0].distance.is_some());
    }

    #[test]
    fn indexed_placement_query_sorts_near_matches_before_paging() {
        let placements = Arc::new(vec![
            placement_with_name(1, 18.0, 18.0, "Volcano Far"),
            placement_with_name(2, 14.0, 14.0, "Volcano Near"),
            placement_with_name(3, 60.0, 60.0, "Volcano Outside"),
        ]);
        let index = workbench::PlacementSpatialIndex::new(Arc::clone(&placements), 8.0);

        let page = query_indexed_placement_page(
            &index,
            "volcano",
            "all",
            Some((15.0, 15.0)),
            10.0,
            (10.0, 10.0, 20.0, 20.0),
            1,
            1,
        );

        assert_eq!(page.total, 2);
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.items[0].index, 1);
        assert!(page.items[0].distance.unwrap() > 4.0);
    }

    #[test]
    fn placement_query_allows_large_marker_overlay_limits() {
        let placements = (0..600)
            .map(|index| placement(index, index as f32, 10.0))
            .collect::<Vec<_>>();

        let page = query_placement_page(&placements, "", "all", None, 50.0, None, 0, 600);

        assert_eq!(page.total, 600);
        assert_eq!(page.items.len(), 600);
        assert_eq!(page.limit, 600);
    }

    #[test]
    fn placement_cache_key_changes_when_obj_file_appears() {
        let temp_dir = tempfile::tempdir().unwrap();
        fs::create_dir(temp_dir.path().join("map")).unwrap();
        let project_id = uuid::Uuid::new_v4();

        let missing_source =
            optional_source_file_info(&temp_dir.path().join("map").join("garner.obj")).unwrap();
        let missing_key = placement_cache_key(
            project_id,
            "garner",
            missing_source,
            empty_source_file_info(),
            empty_source_file_info(),
        );
        fs::write(
            temp_dir.path().join("map").join("garner.obj"),
            [1u8, 2, 3, 4],
        )
        .unwrap();
        let present_source =
            optional_source_file_info(&temp_dir.path().join("map").join("garner.obj")).unwrap();
        let present_key = placement_cache_key(
            project_id,
            "garner",
            present_source,
            empty_source_file_info(),
            empty_source_file_info(),
        );

        assert_eq!(missing_key.obj_file_len, 0);
        assert_eq!(present_key.obj_file_len, 4);
        assert_ne!(missing_key, present_key);
    }

    #[test]
    fn area_set_cache_key_changes_when_area_set_file_appears() {
        let temp_dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(temp_dir.path().join("scripts").join("table")).unwrap();
        let project_id = uuid::Uuid::new_v4();

        let missing_source =
            read_first_existing_table_metadata(temp_dir.path(), &["AreaSet.bin", "areaset.bin"])
                .unwrap();
        let missing_key = area_set_cache_key(project_id, missing_source.as_ref());

        fs::write(
            temp_dir
                .path()
                .join("scripts")
                .join("table")
                .join("AreaSet.bin"),
            [1u8, 2, 3, 4],
        )
        .unwrap();
        let present_source =
            read_first_existing_table_metadata(temp_dir.path(), &["AreaSet.bin", "areaset.bin"])
                .unwrap();
        let present_key = area_set_cache_key(project_id, present_source.as_ref());

        assert_eq!(missing_key.file_len, 0);
        assert_eq!(present_key.file_len, 4);
        assert_eq!(present_key.table_name, "AreaSet.bin");
        assert_ne!(missing_key, present_key);
    }

    #[test]
    fn area_set_cache_key_changes_when_area_set_content_changes_without_size_change() {
        let temp_dir = tempfile::tempdir().unwrap();
        let table_dir = temp_dir.path().join("scripts").join("table");
        fs::create_dir_all(&table_dir).unwrap();
        let area_set_path = table_dir.join("AreaSet.bin");
        let project_id = uuid::Uuid::new_v4();

        fs::write(&area_set_path, [1u8, 2, 3, 4]).unwrap();
        let first_source =
            read_first_existing_table_metadata(temp_dir.path(), &["AreaSet.bin", "areaset.bin"])
                .unwrap()
                .expect("AreaSet.bin should be detected");
        let first_key = area_set_cache_key(project_id, Some(&first_source));

        fs::write(&area_set_path, [4u8, 3, 2, 1]).unwrap();
        let second_source =
            read_first_existing_table_metadata(temp_dir.path(), &["AreaSet.bin", "areaset.bin"])
                .unwrap()
                .expect("AreaSet.bin should still be detected");
        let second_key = area_set_cache_key(project_id, Some(&second_source));

        assert_eq!(first_source.file_len, second_source.file_len);
        assert_ne!(first_source.content_sha256, second_source.content_sha256);
        assert_ne!(first_key, second_key);
    }

    #[test]
    fn area_set_metadata_uses_next_candidate_when_first_candidate_is_missing() {
        let temp_dir = tempfile::tempdir().unwrap();
        let table_dir = temp_dir.path().join("scripts").join("table");
        fs::create_dir_all(&table_dir).unwrap();
        fs::write(table_dir.join("areaset.bin"), [9u8, 8, 7, 6]).unwrap();

        let source = read_first_existing_table_metadata(
            temp_dir.path(),
            &["missing-areaset.bin", "areaset.bin"],
        )
        .unwrap()
        .expect("second candidate should be detected");

        assert_eq!(source.name, "areaset.bin");
        assert_eq!(source.file_len, 4);
        assert!(!source.content_sha256.is_empty());
    }

    #[test]
    fn scene_effect_entries_are_sorted_and_use_filename_fallback() {
        let mut effects = HashMap::new();
        effects.insert(
            20,
            SceneEffectInfo {
                id: 20,
                filename: "portal.par".to_string(),
                display_name: "".to_string(),
                photo_name: "portal".to_string(),
                eff_type: 8,
                obj_type: 1,
                dummy_list: vec![1, 2],
                dummy2: -1,
                height_off: 0.0,
                play_time: 1.25,
                light_id: 0,
                base_size: -1,
            },
        );
        effects.insert(
            10,
            SceneEffectInfo {
                id: 10,
                filename: "fire.par".to_string(),
                display_name: "Fire Burst".to_string(),
                photo_name: "fire".to_string(),
                eff_type: 3,
                obj_type: 1,
                dummy_list: vec![],
                dummy2: -1,
                height_off: 0.0,
                play_time: 2.5,
                light_id: 0,
                base_size: 120,
            },
        );

        let entries = scene_effect_entries_from_info(effects);

        assert_eq!(entries[0].id, 10);
        assert_eq!(entries[0].display_name, "Fire Burst");
        assert_eq!(entries[0].effect_type, 3);
        assert_eq!(entries[1].id, 20);
        assert_eq!(entries[1].display_name, "portal");
    }

    #[test]
    fn export_map_tile_edits_writes_patched_copy_without_touching_source() {
        let temp_dir = tempfile::tempdir().unwrap();
        fs::create_dir(temp_dir.path().join("map")).unwrap();
        let source_path = temp_dir.path().join("map").join("garner.map");
        let source_bytes = serialize_map(&one_section_map()).unwrap();
        fs::write(&source_path, &source_bytes).unwrap();
        let source_guard = source_file_info(&source_path).unwrap();

        let out_dir = temp_dir.path().join("pko-tools").join("exports-test");
        let result = export_map_tile_edits_to_dir(
            temp_dir.path(),
            "garner",
            &[MapTilePatch {
                tile_x: 1,
                tile_y: 1,
                dw_tile_info: None,
                bt_tile_info: None,
                s_color: None,
                c_height: Some(7),
                s_region: Some(0x0004),
                bt_island: None,
                bt_block: Some([0, 0x80, 2, 3]),
            }],
            &out_dir,
            &source_guard,
        )
        .unwrap();

        assert_eq!(result.map_name, "garner");
        assert_eq!(result.patch_count, 1);
        assert_eq!(fs::read(&source_path).unwrap(), source_bytes);

        let exported_bytes = fs::read(&result.map_path).unwrap();
        assert_eq!(result.bytes_written, exported_bytes.len() as u64);
        let exported = load_map(&exported_bytes).unwrap();
        let patched = &exported.sections[0].as_ref().unwrap().tiles[5];
        assert_eq!(patched.c_height, 7);
        assert_eq!(patched.s_region, 0x0004);
        assert_eq!(patched.bt_block, [0, 0x80, 2, 3]);

        let atr_bytes = fs::read(&result.atr_path).unwrap();
        assert_eq!(result.atr_bytes_written, atr_bytes.len() as u64);
        assert_eq!(result.atr_sha256, sha256_hex(&atr_bytes));
        assert_eq!(i32::from_le_bytes(atr_bytes[0..4].try_into().unwrap()), 4);
        assert_eq!(i32::from_le_bytes(atr_bytes[4..8].try_into().unwrap()), 2);
        assert_eq!(&atr_bytes[23..26], &[0x04, 0x00, 0]);

        let blk_bytes = fs::read(&result.blk_path).unwrap();
        assert_eq!(result.blk_bytes_written, blk_bytes.len() as u64);
        assert_eq!(result.blk_sha256, sha256_hex(&blk_bytes));
        assert_eq!(i32::from_le_bytes(blk_bytes[0..4].try_into().unwrap()), 8);
        assert_eq!(i32::from_le_bytes(blk_bytes[4..8].try_into().unwrap()), 4);
        assert_eq!(&blk_bytes[8..12], &[0x00, 0x00, 0x10, 0x00]);
    }

    #[test]
    fn export_map_tile_edits_rejects_stale_map_source() {
        let temp_dir = tempfile::tempdir().unwrap();
        fs::create_dir(temp_dir.path().join("map")).unwrap();
        let source_path = temp_dir.path().join("map").join("garner.map");
        let source_bytes = serialize_map(&one_section_map()).unwrap();
        fs::write(&source_path, &source_bytes).unwrap();
        let source_guard = source_file_info(&source_path).unwrap();

        let mut changed_map = one_section_map();
        changed_map.sections[0].as_mut().unwrap().tiles[0].c_height = 9;
        fs::write(&source_path, serialize_map(&changed_map).unwrap()).unwrap();

        let out_dir = temp_dir.path().join("pko-tools").join("exports-test");
        let error = export_map_tile_edits_to_dir(
            temp_dir.path(),
            "garner",
            &[MapTilePatch {
                tile_x: 1,
                tile_y: 1,
                dw_tile_info: None,
                bt_tile_info: None,
                s_color: None,
                c_height: Some(7),
                s_region: None,
                bt_island: None,
                bt_block: None,
            }],
            &out_dir,
            &source_guard,
        )
        .unwrap_err();

        assert!(
            error.contains("MAP source changed since this map was loaded"),
            "{error}"
        );
    }

    #[test]
    fn export_map_placement_edits_writes_patched_copy_without_touching_source() {
        let temp_dir = tempfile::tempdir().unwrap();
        fs::create_dir(temp_dir.path().join("map")).unwrap();
        let source_path = temp_dir.path().join("map").join("garner.obj");
        let source_bytes = serialize_obj(&one_section_obj()).unwrap();
        fs::write(&source_path, &source_bytes).unwrap();
        let source_guard = source_file_info(&source_path).unwrap();

        let out_dir = temp_dir.path().join("pko-tools").join("exports-test");
        let result = export_map_placement_edits_to_dir(
            temp_dir.path(),
            "garner",
            &[MapPlacementEdit::Update {
                index: 0,
                obj_type: Some(1),
                obj_id: Some(9),
                world_x: Some(3.25),
                world_y: Some(1.5),
                world_z: Some(0.75),
                yaw_angle: Some(400),
                scale: Some(90),
            }],
            &out_dir,
            &source_guard,
        )
        .unwrap();

        assert_eq!(result.map_name, "garner");
        assert_eq!(result.patch_count, 1);
        assert_eq!(fs::read(&source_path).unwrap(), source_bytes);

        let exported_bytes = fs::read(&result.obj_path).unwrap();
        assert_eq!(result.bytes_written, exported_bytes.len() as u64);
        let exported = load_obj(&exported_bytes).unwrap();
        assert_eq!(exported.objects.len(), 1);
        assert_eq!(exported.objects[0].obj_type, 1);
        assert_eq!(exported.objects[0].obj_id, 9);
        assert!((exported.objects[0].world_x - 3.25).abs() < 0.001);
        assert!((exported.objects[0].world_y - 1.5).abs() < 0.001);
        assert!((exported.objects[0].world_z - 0.75).abs() < 0.001);
        assert_eq!(exported.objects[0].yaw_angle, 400);
        assert_eq!(exported.objects[0].scale, 90);
    }

    #[test]
    fn export_map_placement_edits_rejects_stale_obj_source() {
        let temp_dir = tempfile::tempdir().unwrap();
        fs::create_dir(temp_dir.path().join("map")).unwrap();
        let source_path = temp_dir.path().join("map").join("garner.obj");
        let source_bytes = serialize_obj(&one_section_obj()).unwrap();
        fs::write(&source_path, &source_bytes).unwrap();
        let source_guard = source_file_info(&source_path).unwrap();

        let mut changed_obj = one_section_obj();
        changed_obj.objects[0].world_x = 2.0;
        fs::write(&source_path, serialize_obj(&changed_obj).unwrap()).unwrap();

        let out_dir = temp_dir.path().join("pko-tools").join("exports-test");
        let error = export_map_placement_edits_to_dir(
            temp_dir.path(),
            "garner",
            &[MapPlacementEdit::Update {
                index: 0,
                obj_type: None,
                obj_id: None,
                world_x: Some(3.25),
                world_y: None,
                world_z: None,
                yaw_angle: None,
                scale: None,
            }],
            &out_dir,
            &source_guard,
        )
        .unwrap_err();

        assert!(
            error.contains("OBJ source changed since this map was loaded"),
            "{error}"
        );
    }

    #[test]
    fn export_map_placement_edits_applies_update_add_and_delete_without_touching_source() {
        let temp_dir = tempfile::tempdir().unwrap();
        fs::create_dir(temp_dir.path().join("map")).unwrap();
        let source_path = temp_dir.path().join("map").join("garner.obj");
        let mut source = one_section_obj();
        source.objects.push(SceneObject {
            raw_type_id: 8,
            obj_type: 0,
            obj_id: 8,
            world_x: 2.0,
            world_y: 2.0,
            world_z: 0.0,
            yaw_angle: 0,
            scale: 100,
        });
        let source_bytes = serialize_obj(&source).unwrap();
        fs::write(&source_path, &source_bytes).unwrap();
        let source_guard = source_file_info(&source_path).unwrap();

        let out_dir = temp_dir.path().join("pko-tools").join("exports-test");
        let result = export_map_placement_edits_to_dir(
            temp_dir.path(),
            "garner",
            &[
                MapPlacementEdit::Update {
                    index: 0,
                    obj_type: None,
                    obj_id: None,
                    world_x: Some(3.25),
                    world_y: Some(1.5),
                    world_z: Some(0.75),
                    yaw_angle: Some(400),
                    scale: Some(90),
                },
                MapPlacementEdit::Add {
                    obj_type: 1,
                    obj_id: 9,
                    world_x: 4.5,
                    world_y: 4.25,
                    world_z: -0.5,
                    yaw_angle: -90,
                    scale: 100,
                },
                MapPlacementEdit::Delete { index: 1 },
            ],
            &out_dir,
            &source_guard,
        )
        .unwrap();

        assert_eq!(result.patch_count, 3);
        assert_eq!(fs::read(&source_path).unwrap(), source_bytes);

        let exported = load_obj(&fs::read(&result.obj_path).unwrap()).unwrap();
        assert_eq!(exported.objects.len(), 2);
        assert_eq!(exported.objects[0].obj_id, 7);
        assert!((exported.objects[0].world_x - 3.25).abs() < 0.001);
        assert_eq!(exported.objects[0].yaw_angle, 400);
        assert!(exported
            .objects
            .iter()
            .any(|object| object.obj_type == 1 && object.obj_id == 9));
        assert!(!exported.objects.iter().any(|object| object.obj_id == 8));
    }

    #[test]
    fn export_map_edits_writes_complete_package_for_tile_only_edits() {
        let temp_dir = tempfile::tempdir().unwrap();
        fs::create_dir(temp_dir.path().join("map")).unwrap();
        let source_map_path = temp_dir.path().join("map").join("garner.map");
        let source_obj_path = temp_dir.path().join("map").join("garner.obj");
        let source_map_bytes = serialize_map(&one_section_map()).unwrap();
        let source_obj_bytes = serialize_obj(&one_section_obj()).unwrap();
        fs::write(&source_map_path, &source_map_bytes).unwrap();
        fs::write(&source_obj_path, &source_obj_bytes).unwrap();

        let out_dir = temp_dir.path().join("pko-tools").join("exports-test");
        let result = export_map_edits_to_dir(
            temp_dir.path(),
            "garner",
            &[MapTilePatch {
                tile_x: 1,
                tile_y: 1,
                dw_tile_info: None,
                bt_tile_info: None,
                s_color: None,
                c_height: Some(7),
                s_region: Some(0x0004),
                bt_island: None,
                bt_block: Some([0, 0x80, 2, 3]),
            }],
            &[],
            &out_dir,
            &source_guard_for_paths(&source_map_path, &source_obj_path),
        )
        .unwrap();

        assert_eq!(result.map_name, "garner");
        assert_eq!(result.tile_patch_count, 1);
        assert_eq!(result.placement_edit_count, 0);
        assert_eq!(fs::read(&source_map_path).unwrap(), source_map_bytes);
        assert_eq!(fs::read(&source_obj_path).unwrap(), source_obj_bytes);

        let exported_map = load_map(&fs::read(&result.map_path).unwrap()).unwrap();
        let patched = &exported_map.sections[0].as_ref().unwrap().tiles[5];
        assert_eq!(patched.c_height, 7);
        assert_eq!(patched.s_region, 0x0004);
        assert_eq!(patched.bt_block, [0, 0x80, 2, 3]);
        assert_eq!(fs::read(&result.obj_path).unwrap(), source_obj_bytes);
        assert!(fs::metadata(&result.atr_path).unwrap().len() > 0);
        assert!(fs::metadata(&result.blk_path).unwrap().len() > 0);
    }

    #[test]
    fn export_map_edits_writes_complete_package_for_placement_only_edits() {
        let temp_dir = tempfile::tempdir().unwrap();
        fs::create_dir(temp_dir.path().join("map")).unwrap();
        let source_map_path = temp_dir.path().join("map").join("garner.map");
        let source_obj_path = temp_dir.path().join("map").join("garner.obj");
        let source_map_bytes = serialize_map(&one_section_map()).unwrap();
        let source_obj_bytes = serialize_obj(&one_section_obj()).unwrap();
        fs::write(&source_map_path, &source_map_bytes).unwrap();
        fs::write(&source_obj_path, &source_obj_bytes).unwrap();

        let out_dir = temp_dir.path().join("pko-tools").join("exports-test");
        let result = export_map_edits_to_dir(
            temp_dir.path(),
            "garner",
            &[],
            &[MapPlacementEdit::Update {
                index: 0,
                obj_type: None,
                obj_id: None,
                world_x: Some(3.25),
                world_y: Some(1.5),
                world_z: Some(0.75),
                yaw_angle: Some(400),
                scale: Some(90),
            }],
            &out_dir,
            &source_guard_for_paths(&source_map_path, &source_obj_path),
        )
        .unwrap();

        assert_eq!(result.tile_patch_count, 0);
        assert_eq!(result.placement_edit_count, 1);
        assert_eq!(fs::read(&source_map_path).unwrap(), source_map_bytes);
        assert_eq!(fs::read(&source_obj_path).unwrap(), source_obj_bytes);
        assert_eq!(fs::read(&result.map_path).unwrap(), source_map_bytes);

        let exported_obj = load_obj(&fs::read(&result.obj_path).unwrap()).unwrap();
        assert_eq!(exported_obj.objects.len(), 1);
        assert!((exported_obj.objects[0].world_x - 3.25).abs() < 0.001);
        assert_eq!(exported_obj.objects[0].yaw_angle, 400);

        let atr_bytes = fs::read(&result.atr_path).unwrap();
        let blk_bytes = fs::read(&result.blk_path).unwrap();
        assert_eq!(result.atr_bytes_written, atr_bytes.len() as u64);
        assert_eq!(result.blk_bytes_written, blk_bytes.len() as u64);
    }

    #[test]
    fn export_map_edits_writes_complete_package_for_tile_and_placement_edits() {
        let temp_dir = tempfile::tempdir().unwrap();
        fs::create_dir(temp_dir.path().join("map")).unwrap();
        let source_map_path = temp_dir.path().join("map").join("garner.map");
        let source_obj_path = temp_dir.path().join("map").join("garner.obj");
        let source_map_bytes = serialize_map(&one_section_map()).unwrap();
        let source_obj_bytes = serialize_obj(&one_section_obj()).unwrap();
        fs::write(&source_map_path, &source_map_bytes).unwrap();
        fs::write(&source_obj_path, &source_obj_bytes).unwrap();

        let out_dir = temp_dir.path().join("pko-tools").join("exports-test");
        let result = export_map_edits_to_dir(
            temp_dir.path(),
            "garner",
            &[MapTilePatch {
                tile_x: 1,
                tile_y: 1,
                dw_tile_info: None,
                bt_tile_info: None,
                s_color: None,
                c_height: Some(7),
                s_region: Some(0x0004),
                bt_island: None,
                bt_block: Some([0, 0x80, 2, 3]),
            }],
            &[MapPlacementEdit::Update {
                index: 0,
                obj_type: None,
                obj_id: None,
                world_x: Some(3.25),
                world_y: Some(1.5),
                world_z: Some(0.75),
                yaw_angle: Some(400),
                scale: Some(90),
            }],
            &out_dir,
            &source_guard_for_paths(&source_map_path, &source_obj_path),
        )
        .unwrap();

        assert_eq!(result.tile_patch_count, 1);
        assert_eq!(result.placement_edit_count, 1);
        assert_eq!(fs::read(&source_map_path).unwrap(), source_map_bytes);
        assert_eq!(fs::read(&source_obj_path).unwrap(), source_obj_bytes);

        let exported_map_bytes = fs::read(&result.map_path).unwrap();
        assert_eq!(result.map_bytes_written, exported_map_bytes.len() as u64);
        let exported_map = load_map(&exported_map_bytes).unwrap();
        let patched = &exported_map.sections[0].as_ref().unwrap().tiles[5];
        assert_eq!(patched.c_height, 7);
        assert_eq!(patched.s_region, 0x0004);
        assert_eq!(patched.bt_block, [0, 0x80, 2, 3]);

        let exported_obj_bytes = fs::read(&result.obj_path).unwrap();
        assert_eq!(result.obj_bytes_written, exported_obj_bytes.len() as u64);
        let exported_obj = load_obj(&exported_obj_bytes).unwrap();
        assert_eq!(exported_obj.objects.len(), 1);
        assert!((exported_obj.objects[0].world_x - 3.25).abs() < 0.001);
        assert!((exported_obj.objects[0].world_y - 1.5).abs() < 0.001);
        assert!((exported_obj.objects[0].world_z - 0.75).abs() < 0.001);
        assert_eq!(exported_obj.objects[0].yaw_angle, 400);
        assert_eq!(exported_obj.objects[0].scale, 90);

        let atr_bytes = fs::read(&result.atr_path).unwrap();
        assert_eq!(result.atr_bytes_written, atr_bytes.len() as u64);
        assert_eq!(i32::from_le_bytes(atr_bytes[0..4].try_into().unwrap()), 4);
        assert_eq!(i32::from_le_bytes(atr_bytes[4..8].try_into().unwrap()), 2);
        assert_eq!(&atr_bytes[23..26], &[0x04, 0x00, 0]);

        let blk_bytes = fs::read(&result.blk_path).unwrap();
        assert_eq!(result.blk_bytes_written, blk_bytes.len() as u64);
        assert_eq!(i32::from_le_bytes(blk_bytes[0..4].try_into().unwrap()), 8);
        assert_eq!(i32::from_le_bytes(blk_bytes[4..8].try_into().unwrap()), 4);
        assert_eq!(&blk_bytes[8..12], &[0x00, 0x00, 0x10, 0x00]);
    }

    #[test]
    fn export_map_edits_copies_rbo_when_present() {
        let temp_dir = tempfile::tempdir().unwrap();
        fs::create_dir(temp_dir.path().join("map")).unwrap();
        let source_map_path = temp_dir.path().join("map").join("garner.map");
        let source_obj_path = temp_dir.path().join("map").join("garner.obj");
        let source_rbo_path = temp_dir.path().join("map").join("garner.rbo");
        let source_map_bytes = serialize_map(&one_section_map()).unwrap();
        let source_obj_bytes = serialize_obj(&one_section_obj()).unwrap();
        let source_rbo_bytes = vec![0x52, 0x42, 0x4f, 0x00, 1, 2, 3, 4, 5];
        fs::write(&source_map_path, &source_map_bytes).unwrap();
        fs::write(&source_obj_path, &source_obj_bytes).unwrap();
        fs::write(&source_rbo_path, &source_rbo_bytes).unwrap();

        let out_dir = temp_dir.path().join("pko-tools").join("exports-test");
        let result = export_map_edits_to_dir(
            temp_dir.path(),
            "garner",
            &[MapTilePatch {
                tile_x: 1,
                tile_y: 1,
                dw_tile_info: None,
                bt_tile_info: None,
                s_color: None,
                c_height: Some(7),
                s_region: None,
                bt_island: None,
                bt_block: None,
            }],
            &[],
            &out_dir,
            &source_guard_for_paths(&source_map_path, &source_obj_path),
        )
        .unwrap();

        let rbo_path = result
            .rbo_path
            .as_ref()
            .expect("RBO path should be exported");
        assert_eq!(fs::read(rbo_path).unwrap(), source_rbo_bytes);
        assert_eq!(result.rbo_bytes_written, source_rbo_bytes.len() as u64);
    }

    #[test]
    fn export_map_edits_flags_preserved_rbo_as_stale_when_placements_change() {
        let temp_dir = tempfile::tempdir().unwrap();
        fs::create_dir(temp_dir.path().join("map")).unwrap();
        let source_map_path = temp_dir.path().join("map").join("garner.map");
        let source_obj_path = temp_dir.path().join("map").join("garner.obj");
        let source_rbo_path = temp_dir.path().join("map").join("garner.rbo");
        let source_map_bytes = serialize_map(&one_section_map()).unwrap();
        let source_obj_bytes = serialize_obj(&one_section_obj()).unwrap();
        let source_rbo_bytes = vec![0x52, 0x42, 0x4f, 0x00, 1, 2, 3, 4, 5];
        fs::write(&source_map_path, &source_map_bytes).unwrap();
        fs::write(&source_obj_path, &source_obj_bytes).unwrap();
        fs::write(&source_rbo_path, &source_rbo_bytes).unwrap();

        let out_dir = temp_dir.path().join("pko-tools").join("exports-test");
        let result = export_map_edits_to_dir(
            temp_dir.path(),
            "garner",
            &[],
            &[MapPlacementEdit::Update {
                index: 0,
                obj_type: None,
                obj_id: None,
                world_x: Some(3.25),
                world_y: None,
                world_z: None,
                yaw_angle: None,
                scale: None,
            }],
            &out_dir,
            &source_guard_for_paths(&source_map_path, &source_obj_path),
        )
        .unwrap();

        let value = serde_json::to_value(&result).unwrap();
        assert_eq!(value["rbo_preserved_from_source"], true);
        assert_eq!(value["rbo_may_be_stale"], true);
        assert_eq!(
            fs::read(result.rbo_path.as_ref().unwrap()).unwrap(),
            source_rbo_bytes
        );
    }

    #[test]
    fn export_map_edits_rejects_stale_map_source() {
        let temp_dir = tempfile::tempdir().unwrap();
        fs::create_dir(temp_dir.path().join("map")).unwrap();
        let source_map_path = temp_dir.path().join("map").join("garner.map");
        let source_obj_path = temp_dir.path().join("map").join("garner.obj");
        let source_map_bytes = serialize_map(&one_section_map()).unwrap();
        let source_obj_bytes = serialize_obj(&one_section_obj()).unwrap();
        fs::write(&source_map_path, &source_map_bytes).unwrap();
        fs::write(&source_obj_path, &source_obj_bytes).unwrap();
        let source_guard = source_guard_for_paths(&source_map_path, &source_obj_path);

        let mut changed_map_bytes = source_map_bytes.clone();
        changed_map_bytes.push(0);
        fs::write(&source_map_path, changed_map_bytes).unwrap();

        let out_dir = temp_dir.path().join("pko-tools").join("exports-test");
        let error = export_map_edits_to_dir(
            temp_dir.path(),
            "garner",
            &[MapTilePatch {
                tile_x: 1,
                tile_y: 1,
                dw_tile_info: None,
                bt_tile_info: None,
                s_color: None,
                c_height: Some(7),
                s_region: None,
                bt_island: None,
                bt_block: None,
            }],
            &[],
            &out_dir,
            &source_guard,
        )
        .unwrap_err();

        assert!(error.contains("MAP source changed since this map was loaded"));
        assert!(!out_dir.exists());
    }

    #[test]
    fn export_map_edits_rejects_stale_obj_source() {
        let temp_dir = tempfile::tempdir().unwrap();
        fs::create_dir(temp_dir.path().join("map")).unwrap();
        let source_map_path = temp_dir.path().join("map").join("garner.map");
        let source_obj_path = temp_dir.path().join("map").join("garner.obj");
        let source_map_bytes = serialize_map(&one_section_map()).unwrap();
        let source_obj_bytes = serialize_obj(&one_section_obj()).unwrap();
        fs::write(&source_map_path, &source_map_bytes).unwrap();
        fs::write(&source_obj_path, &source_obj_bytes).unwrap();
        let source_guard = source_guard_for_paths(&source_map_path, &source_obj_path);

        let mut changed_obj_bytes = source_obj_bytes.clone();
        changed_obj_bytes.push(0);
        fs::write(&source_obj_path, changed_obj_bytes).unwrap();

        let out_dir = temp_dir.path().join("pko-tools").join("exports-test");
        let error = export_map_edits_to_dir(
            temp_dir.path(),
            "garner",
            &[],
            &[MapPlacementEdit::Update {
                index: 0,
                obj_type: None,
                obj_id: None,
                world_x: Some(3.25),
                world_y: None,
                world_z: None,
                yaw_angle: None,
                scale: None,
            }],
            &out_dir,
            &source_guard,
        )
        .unwrap_err();

        assert!(error.contains("OBJ source changed since this map was loaded"));
        assert!(!out_dir.exists());
    }

    #[test]
    fn export_map_edits_rejects_stale_rbo_source() {
        let temp_dir = tempfile::tempdir().unwrap();
        fs::create_dir(temp_dir.path().join("map")).unwrap();
        let source_map_path = temp_dir.path().join("map").join("garner.map");
        let source_obj_path = temp_dir.path().join("map").join("garner.obj");
        let source_rbo_path = temp_dir.path().join("map").join("garner.rbo");
        let source_map_bytes = serialize_map(&one_section_map()).unwrap();
        let source_obj_bytes = serialize_obj(&one_section_obj()).unwrap();
        fs::write(&source_map_path, &source_map_bytes).unwrap();
        fs::write(&source_obj_path, &source_obj_bytes).unwrap();
        fs::write(&source_rbo_path, [1u8, 2, 3, 4]).unwrap();
        let source_guard = source_guard_for_paths(&source_map_path, &source_obj_path);

        fs::write(&source_rbo_path, [4u8, 3, 2, 1]).unwrap();

        let out_dir = temp_dir.path().join("pko-tools").join("exports-test");
        let error = export_map_edits_to_dir(
            temp_dir.path(),
            "garner",
            &[MapTilePatch {
                tile_x: 1,
                tile_y: 1,
                dw_tile_info: None,
                bt_tile_info: None,
                s_color: None,
                c_height: Some(7),
                s_region: None,
                bt_island: None,
                bt_block: None,
            }],
            &[],
            &out_dir,
            &source_guard,
        )
        .unwrap_err();

        assert!(error.contains("RBO source changed since this map was loaded"));
        assert!(!out_dir.exists());
    }

    #[test]
    fn export_map_edits_writes_empty_obj_when_source_obj_is_missing() {
        let temp_dir = tempfile::tempdir().unwrap();
        fs::create_dir(temp_dir.path().join("map")).unwrap();
        let source_map_path = temp_dir.path().join("map").join("garner.map");
        let source_obj_path = temp_dir.path().join("map").join("garner.obj");
        let source_map_bytes = serialize_map(&one_section_map()).unwrap();
        fs::write(&source_map_path, &source_map_bytes).unwrap();

        let out_dir = temp_dir.path().join("pko-tools").join("exports-test");
        let result = export_map_edits_to_dir(
            temp_dir.path(),
            "garner",
            &[MapTilePatch {
                tile_x: 1,
                tile_y: 1,
                dw_tile_info: None,
                bt_tile_info: None,
                s_color: None,
                c_height: Some(7),
                s_region: None,
                bt_island: None,
                bt_block: None,
            }],
            &[],
            &out_dir,
            &source_guard_for_paths(&source_map_path, &source_obj_path),
        )
        .unwrap();

        let exported_obj = load_obj(&fs::read(&result.obj_path).unwrap()).unwrap();
        assert_eq!(exported_obj.section_cnt_x, 1);
        assert_eq!(exported_obj.section_cnt_y, 1);
        assert_eq!(exported_obj.section_width, 4);
        assert_eq!(exported_obj.section_height, 2);
        assert!(exported_obj.objects.is_empty());
        assert!(result.obj_bytes_written > 0);
    }

    #[test]
    fn apply_map_edit_client_package_backs_up_and_installs_client_files() {
        let temp_dir = tempfile::tempdir().unwrap();
        fs::create_dir(temp_dir.path().join("map")).unwrap();
        let source_map_path = temp_dir.path().join("map").join("garner.map");
        let source_obj_path = temp_dir.path().join("map").join("garner.obj");
        let source_rbo_path = temp_dir.path().join("map").join("garner.rbo");
        let source_map_bytes = serialize_map(&one_section_map()).unwrap();
        let source_obj_bytes = serialize_obj(&one_section_obj()).unwrap();
        let source_rbo_bytes = vec![0x52, 0x42, 0x4f, 0x00, 1, 2, 3, 4, 5];
        fs::write(&source_map_path, &source_map_bytes).unwrap();
        fs::write(&source_obj_path, &source_obj_bytes).unwrap();
        fs::write(&source_rbo_path, &source_rbo_bytes).unwrap();
        let source_guard = source_guard_for_paths(&source_map_path, &source_obj_path);

        let export_dir = temp_dir.path().join("pko-tools").join("exports-test");
        let exported = export_map_edits_to_dir(
            temp_dir.path(),
            "garner",
            &[MapTilePatch {
                tile_x: 1,
                tile_y: 1,
                dw_tile_info: None,
                bt_tile_info: None,
                s_color: None,
                c_height: Some(7),
                s_region: None,
                bt_island: None,
                bt_block: None,
            }],
            &[MapPlacementEdit::Update {
                index: 0,
                obj_type: None,
                obj_id: None,
                world_x: Some(3.25),
                world_y: None,
                world_z: None,
                yaw_angle: None,
                scale: None,
            }],
            &export_dir,
            &source_guard,
        )
        .unwrap();

        let apply_result = apply_map_edit_client_package_to_dir(
            temp_dir.path(),
            "garner",
            &MapEditClientPackage::from_export_result(&exported),
            &export_dir,
            &temp_dir.path().join("pko-tools").join("backups-test"),
            &source_guard,
        )
        .unwrap();

        assert_eq!(
            fs::read(&source_map_path).unwrap(),
            fs::read(&exported.map_path).unwrap()
        );
        assert_eq!(
            fs::read(&source_obj_path).unwrap(),
            fs::read(&exported.obj_path).unwrap()
        );
        assert_eq!(
            fs::read(&source_rbo_path).unwrap(),
            fs::read(exported.rbo_path.as_ref().unwrap()).unwrap()
        );
        assert_eq!(apply_result.map_path, source_map_path.to_string_lossy());
        assert_eq!(apply_result.obj_path, source_obj_path.to_string_lossy());
        assert_eq!(
            apply_result.rbo_path.as_deref(),
            Some(source_rbo_path.to_string_lossy().as_ref())
        );
        assert_eq!(apply_result.backups.len(), 3);
        assert!(apply_result.backup_dir.contains("garner"));
        assert!(apply_result.backups.iter().any(|backup| {
            backup.label == "MAP" && fs::read(&backup.backup_path).unwrap() == source_map_bytes
        }));
        assert!(apply_result.backups.iter().any(|backup| {
            backup.label == "OBJ" && fs::read(&backup.backup_path).unwrap() == source_obj_bytes
        }));
        assert!(apply_result.backups.iter().any(|backup| {
            backup.label == "RBO" && fs::read(&backup.backup_path).unwrap() == source_rbo_bytes
        }));
    }

    #[test]
    fn apply_map_edit_client_package_rejects_stale_client_sources() {
        let temp_dir = tempfile::tempdir().unwrap();
        fs::create_dir(temp_dir.path().join("map")).unwrap();
        let source_map_path = temp_dir.path().join("map").join("garner.map");
        let source_obj_path = temp_dir.path().join("map").join("garner.obj");
        let source_map_bytes = serialize_map(&one_section_map()).unwrap();
        let source_obj_bytes = serialize_obj(&one_section_obj()).unwrap();
        fs::write(&source_map_path, &source_map_bytes).unwrap();
        fs::write(&source_obj_path, &source_obj_bytes).unwrap();
        let source_guard = source_guard_for_paths(&source_map_path, &source_obj_path);

        let export_dir = temp_dir.path().join("pko-tools").join("exports-test");
        let exported = export_map_edits_to_dir(
            temp_dir.path(),
            "garner",
            &[],
            &[],
            &export_dir,
            &source_guard,
        )
        .unwrap();

        let mut changed_map_bytes = source_map_bytes.clone();
        changed_map_bytes.push(0);
        fs::write(&source_map_path, changed_map_bytes).unwrap();

        let error = apply_map_edit_client_package_to_dir(
            temp_dir.path(),
            "garner",
            &MapEditClientPackage::from_export_result(&exported),
            &export_dir,
            &temp_dir.path().join("pko-tools").join("backups-test"),
            &source_guard,
        )
        .unwrap_err();

        assert!(error.contains("MAP source changed since this map was loaded"));
        assert!(!temp_dir
            .path()
            .join("pko-tools")
            .join("backups-test")
            .exists());
    }

    #[test]
    fn apply_map_edit_client_package_rejects_package_outside_export_dir() {
        let temp_dir = tempfile::tempdir().unwrap();
        fs::create_dir(temp_dir.path().join("map")).unwrap();
        let source_map_path = temp_dir.path().join("map").join("garner.map");
        let source_obj_path = temp_dir.path().join("map").join("garner.obj");
        fs::write(&source_map_path, serialize_map(&one_section_map()).unwrap()).unwrap();
        fs::write(&source_obj_path, serialize_obj(&one_section_obj()).unwrap()).unwrap();
        let source_guard = source_guard_for_paths(&source_map_path, &source_obj_path);

        let export_dir = temp_dir.path().join("pko-tools").join("exports-test");
        let exported = export_map_edits_to_dir(
            temp_dir.path(),
            "garner",
            &[],
            &[],
            &export_dir,
            &source_guard,
        )
        .unwrap();
        let outside_dir = temp_dir.path().join("outside-package");
        fs::create_dir(&outside_dir).unwrap();
        let outside_map_path = outside_dir.join("garner.map");
        let outside_obj_path = outside_dir.join("garner.obj");
        fs::copy(&exported.map_path, &outside_map_path).unwrap();
        fs::copy(&exported.obj_path, &outside_obj_path).unwrap();
        let mut package = MapEditClientPackage::from_export_result(&exported);
        package.map_path = outside_map_path.to_string_lossy().to_string();
        package.obj_path = outside_obj_path.to_string_lossy().to_string();

        let error = apply_map_edit_client_package_to_dir(
            temp_dir.path(),
            "garner",
            &package,
            &export_dir,
            &temp_dir.path().join("pko-tools").join("backups-test"),
            &source_guard,
        )
        .unwrap_err();

        assert!(error.contains("package file must be inside"));
        assert!(!temp_dir
            .path()
            .join("pko-tools")
            .join("backups-test")
            .exists());
    }

    #[test]
    fn apply_map_edit_client_package_rejects_tampered_package_file() {
        let temp_dir = tempfile::tempdir().unwrap();
        fs::create_dir(temp_dir.path().join("map")).unwrap();
        let source_map_path = temp_dir.path().join("map").join("garner.map");
        let source_obj_path = temp_dir.path().join("map").join("garner.obj");
        fs::write(&source_map_path, serialize_map(&one_section_map()).unwrap()).unwrap();
        fs::write(&source_obj_path, serialize_obj(&one_section_obj()).unwrap()).unwrap();
        let source_guard = source_guard_for_paths(&source_map_path, &source_obj_path);

        let export_dir = temp_dir.path().join("pko-tools").join("exports-test");
        let exported = export_map_edits_to_dir(
            temp_dir.path(),
            "garner",
            &[],
            &[],
            &export_dir,
            &source_guard,
        )
        .unwrap();
        let mut tampered_map = fs::read(&exported.map_path).unwrap();
        tampered_map.push(0);
        fs::write(&exported.map_path, tampered_map).unwrap();

        let error = apply_map_edit_client_package_to_dir(
            temp_dir.path(),
            "garner",
            &MapEditClientPackage::from_export_result(&exported),
            &export_dir,
            &temp_dir.path().join("pko-tools").join("backups-test"),
            &source_guard,
        )
        .unwrap_err();

        assert!(error.contains("MAP package file changed since export"));
        assert!(!temp_dir
            .path()
            .join("pko-tools")
            .join("backups-test")
            .exists());
    }

    #[test]
    fn apply_map_edit_client_package_rejects_new_rbo_when_source_had_none() {
        let temp_dir = tempfile::tempdir().unwrap();
        fs::create_dir(temp_dir.path().join("map")).unwrap();
        let source_map_path = temp_dir.path().join("map").join("garner.map");
        let source_obj_path = temp_dir.path().join("map").join("garner.obj");
        fs::write(&source_map_path, serialize_map(&one_section_map()).unwrap()).unwrap();
        fs::write(&source_obj_path, serialize_obj(&one_section_obj()).unwrap()).unwrap();
        let source_guard = source_guard_for_paths(&source_map_path, &source_obj_path);

        let export_dir = temp_dir.path().join("pko-tools").join("exports-test");
        let exported = export_map_edits_to_dir(
            temp_dir.path(),
            "garner",
            &[],
            &[],
            &export_dir,
            &source_guard,
        )
        .unwrap();
        let rbo_bytes = vec![1, 2, 3, 4];
        let rbo_path = export_dir.join("garner.rbo");
        fs::write(&rbo_path, &rbo_bytes).unwrap();
        let mut package = MapEditClientPackage::from_export_result(&exported);
        package.rbo_path = Some(rbo_path.to_string_lossy().to_string());
        package.rbo_bytes = rbo_bytes.len() as u64;
        package.rbo_sha256 = Some(sha256_hex(&rbo_bytes));

        let error = apply_map_edit_client_package_to_dir(
            temp_dir.path(),
            "garner",
            &package,
            &export_dir,
            &temp_dir.path().join("pko-tools").join("backups-test"),
            &source_guard,
        )
        .unwrap_err();

        assert!(error.contains("loaded without RBO data"));
        assert!(!temp_dir
            .path()
            .join("pko-tools")
            .join("backups-test")
            .exists());
    }

    #[test]
    fn restore_map_edit_client_backup_restores_original_files_and_removes_generated_obj() {
        let temp_dir = tempfile::tempdir().unwrap();
        fs::create_dir(temp_dir.path().join("map")).unwrap();
        let source_map_path = temp_dir.path().join("map").join("garner.map");
        let source_obj_path = temp_dir.path().join("map").join("garner.obj");
        let source_map_bytes = serialize_map(&one_section_map()).unwrap();
        fs::write(&source_map_path, &source_map_bytes).unwrap();
        let source_guard = source_guard_for_paths(&source_map_path, &source_obj_path);

        let export_dir = temp_dir.path().join("pko-tools").join("exports-test");
        let backup_root = temp_dir.path().join("pko-tools").join("backups-test");
        let exported = export_map_edits_to_dir(
            temp_dir.path(),
            "garner",
            &[MapTilePatch {
                tile_x: 1,
                tile_y: 1,
                dw_tile_info: None,
                bt_tile_info: None,
                s_color: None,
                c_height: Some(7),
                s_region: None,
                bt_island: None,
                bt_block: None,
            }],
            &[],
            &export_dir,
            &source_guard,
        )
        .unwrap();

        let apply_result = apply_map_edit_client_package_to_dir(
            temp_dir.path(),
            "garner",
            &MapEditClientPackage::from_export_result(&exported),
            &export_dir,
            &backup_root,
            &source_guard,
        )
        .unwrap();
        assert_ne!(fs::read(&source_map_path).unwrap(), source_map_bytes);
        assert!(source_obj_path.exists());

        let restore_result = restore_map_edit_client_backup_to_dir(
            temp_dir.path(),
            "garner",
            &apply_result.backup_dir,
            &backup_root,
        )
        .unwrap();

        assert_eq!(fs::read(&source_map_path).unwrap(), source_map_bytes);
        assert!(!source_obj_path.exists());
        assert_eq!(restore_result.map_path, source_map_path.to_string_lossy());
        assert_eq!(restore_result.obj_path, None);
        assert_eq!(
            restore_result.map_bytes_restored,
            source_map_bytes.len() as u64
        );
        assert_eq!(restore_result.obj_bytes_restored, 0);
        assert_eq!(
            restore_result.removed_paths,
            vec![source_obj_path.to_string_lossy().to_string()]
        );
        assert!(restore_result
            .current_backups
            .iter()
            .any(|backup| backup.label == "MAP"));
        assert!(restore_result
            .current_backups
            .iter()
            .any(|backup| backup.label == "OBJ"));
    }

    #[test]
    fn restore_map_edit_client_backup_rejects_backup_outside_backup_root() {
        let temp_dir = tempfile::tempdir().unwrap();
        fs::create_dir(temp_dir.path().join("map")).unwrap();
        let source_map_path = temp_dir.path().join("map").join("garner.map");
        let source_map_bytes = serialize_map(&one_section_map()).unwrap();
        fs::write(&source_map_path, &source_map_bytes).unwrap();
        let backup_root = temp_dir.path().join("pko-tools").join("backups-test");
        fs::create_dir_all(&backup_root).unwrap();
        let outside_backup_dir = temp_dir.path().join("outside").join("garner-1000");
        fs::create_dir_all(&outside_backup_dir).unwrap();
        fs::write(outside_backup_dir.join("garner.map"), b"outside").unwrap();

        let error = restore_map_edit_client_backup_to_dir(
            temp_dir.path(),
            "garner",
            &outside_backup_dir.to_string_lossy(),
            &backup_root,
        )
        .unwrap_err();

        assert!(error.contains("Map backup directory must be inside"));
        assert_eq!(fs::read(&source_map_path).unwrap(), source_map_bytes);
    }

    #[test]
    fn restore_map_edit_client_backup_rejects_missing_optional_backup_that_existed() {
        let temp_dir = tempfile::tempdir().unwrap();
        fs::create_dir(temp_dir.path().join("map")).unwrap();
        let source_map_path = temp_dir.path().join("map").join("garner.map");
        let source_obj_path = temp_dir.path().join("map").join("garner.obj");
        let source_map_bytes = serialize_map(&one_section_map()).unwrap();
        let source_obj_bytes = serialize_obj(&one_section_obj()).unwrap();
        fs::write(&source_map_path, &source_map_bytes).unwrap();
        fs::write(&source_obj_path, &source_obj_bytes).unwrap();
        let source_guard = source_guard_for_paths(&source_map_path, &source_obj_path);

        let export_dir = temp_dir.path().join("pko-tools").join("exports-test");
        let backup_root = temp_dir.path().join("pko-tools").join("backups-test");
        let exported = export_map_edits_to_dir(
            temp_dir.path(),
            "garner",
            &[MapTilePatch {
                tile_x: 1,
                tile_y: 1,
                dw_tile_info: None,
                bt_tile_info: None,
                s_color: None,
                c_height: Some(7),
                s_region: None,
                bt_island: None,
                bt_block: None,
            }],
            &[],
            &export_dir,
            &source_guard,
        )
        .unwrap();
        let apply_result = apply_map_edit_client_package_to_dir(
            temp_dir.path(),
            "garner",
            &MapEditClientPackage::from_export_result(&exported),
            &export_dir,
            &backup_root,
            &source_guard,
        )
        .unwrap();
        let installed_obj_bytes = fs::read(&source_obj_path).unwrap();
        fs::remove_file(Path::new(&apply_result.backup_dir).join("garner.obj")).unwrap();

        let error = restore_map_edit_client_backup_to_dir(
            temp_dir.path(),
            "garner",
            &apply_result.backup_dir,
            &backup_root,
        )
        .unwrap_err();

        assert!(error.contains("OBJ backup file is missing"));
        assert_eq!(fs::read(&source_obj_path).unwrap(), installed_obj_bytes);
    }

    fn placement(index: u32, world_x: f32, world_y: f32) -> MapPlacementRecord {
        MapPlacementRecord {
            index,
            obj_type: 0,
            obj_id: 10 + index,
            kind: "building".to_string(),
            world_x,
            world_y,
            world_z: 0.0,
            yaw_angle: 0,
            scale: 100,
            display_name: None,
            asset_name: None,
            attach_effect_id: None,
            distance: None,
        }
    }

    fn placement_with_name(
        index: u32,
        world_x: f32,
        world_y: f32,
        display_name: &str,
    ) -> MapPlacementRecord {
        MapPlacementRecord {
            display_name: Some(display_name.to_string()),
            ..placement(index, world_x, world_y)
        }
    }

    fn one_section_map() -> ParsedMap {
        ParsedMap {
            header: MapHeader {
                n_map_flag: 780627,
                n_width: 4,
                n_height: 2,
                n_section_width: 4,
                n_section_height: 2,
            },
            section_cnt_x: 1,
            section_cnt_y: 1,
            section_offsets: vec![20],
            sections: vec![Some(MapSection {
                tiles: (0..8)
                    .map(|idx| MapTile {
                        dw_tile_info: 0x0100 + idx,
                        bt_tile_info: 10 + idx as u8,
                        s_color: -1,
                        c_height: idx as i8,
                        s_region: 0,
                        bt_island: 0,
                        bt_block: [0; 4],
                    })
                    .collect(),
            })],
        }
    }

    fn two_section_map() -> ParsedMap {
        ParsedMap {
            header: MapHeader {
                n_map_flag: 780627,
                n_width: 4,
                n_height: 2,
                n_section_width: 2,
                n_section_height: 2,
            },
            section_cnt_x: 2,
            section_cnt_y: 1,
            section_offsets: vec![0, 0],
            sections: vec![
                Some(MapSection {
                    tiles: (0..4)
                        .map(|idx| MapTile {
                            dw_tile_info: 0x0100 + idx,
                            bt_tile_info: 10 + idx as u8,
                            s_color: -1,
                            c_height: idx as i8,
                            s_region: 0,
                            bt_island: 0,
                            bt_block: [0; 4],
                        })
                        .collect(),
                }),
                Some(MapSection {
                    tiles: (0..4)
                        .map(|idx| MapTile {
                            dw_tile_info: 0x0200 + idx,
                            bt_tile_info: 20 + idx as u8,
                            s_color: -1,
                            c_height: (idx + 4) as i8,
                            s_region: 0,
                            bt_island: 0,
                            bt_block: [0; 4],
                        })
                        .collect(),
                }),
            ],
        }
    }

    fn one_section_obj() -> ParsedObjFile {
        ParsedObjFile {
            section_cnt_x: 1,
            section_cnt_y: 1,
            section_width: 8,
            section_height: 8,
            section_obj_num: 25,
            objects: vec![SceneObject {
                raw_type_id: 7,
                obj_type: 0,
                obj_id: 7,
                world_x: 1.0,
                world_y: 1.0,
                world_z: 0.0,
                yaw_angle: 0,
                scale: 100,
            }],
            raw_records: Vec::new(),
            object_raw_indices: Vec::new(),
            dirty_object_indices: Default::default(),
        }
    }

    fn source_guard_for_paths(map_path: &Path, obj_path: &Path) -> MapEditSourceGuard {
        MapEditSourceGuard {
            map_source: source_file_info(map_path).unwrap(),
            obj_source: optional_source_file_info(obj_path).unwrap(),
            rbo_source: optional_source_file_info(&map_path.with_extension("rbo")).unwrap(),
        }
    }
}
