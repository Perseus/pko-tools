use anyhow::{anyhow, Result};
use base64::prelude::BASE64_STANDARD;
use base64::Engine;
use image::{DynamicImage, ImageBuffer, ImageFormat, Rgba};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::Cursor;
use std::sync::Arc;

use super::area_set::AreaDefinition;
use super::rbo::RboSummary;
use super::terrain::{
    decode_obj_height, default_missing_tile, get_tile, rgb565_to_float, tile_height, MapTile,
    ParsedMap,
};
use super::MapPlacementRecord;

pub const DEFAULT_CHUNK_SIZE: i32 = 128;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ParsedMapCacheKey {
    pub project_id: uuid::Uuid,
    pub map_name: String,
    pub modified_ms: u64,
    pub file_len: u64,
    pub content_sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct MapPlacementCacheKey {
    pub project_id: uuid::Uuid,
    pub map_name: String,
    pub obj_modified_ms: u64,
    pub obj_file_len: u64,
    pub obj_content_sha256: String,
    pub scene_obj_info_modified_ms: u64,
    pub scene_obj_info_file_len: u64,
    pub scene_obj_info_content_sha256: String,
    pub scene_effect_info_modified_ms: u64,
    pub scene_effect_info_file_len: u64,
    pub scene_effect_info_content_sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct AreaSetCacheKey {
    pub project_id: uuid::Uuid,
    pub table_name: String,
    pub modified_ms: u64,
    pub file_len: u64,
    pub content_sha256: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MapWorkbenchLayer {
    TerrainColor,
    TextureBase,
    TextureRaw,
    TextureLayers,
    Height,
    Collision,
    ObjectHeight,
    Region,
    Island,
    Placements,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceFileInfo {
    pub map_modified_ms: u64,
    pub map_file_len: u64,
    pub content_sha256: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MapWorkbenchManifest {
    pub name: String,
    pub width: i32,
    pub height: i32,
    pub section_width: i32,
    pub section_height: i32,
    pub section_count_x: i32,
    pub section_count_y: i32,
    pub total_sections: u32,
    pub non_empty_sections: u32,
    pub chunk_size: i32,
    pub chunk_count_x: i32,
    pub chunk_count_y: i32,
    pub available_layers: Vec<MapWorkbenchLayer>,
    pub terrain_texture_status: MapTerrainTextureStatus,
    pub placement_count: u32,
    pub coordinate_system: String,
    pub source: SourceFileInfo,
    pub placement_source: SourceFileInfo,
    pub rbo_source: SourceFileInfo,
    pub rbo_summary: RboSummary,
    pub recommended_overview_max_size: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MapTerrainTextureStatus {
    pub available: bool,
    pub message: Option<String>,
    pub referenced_count: u32,
    pub loaded_count: u32,
    pub missing_count: u32,
    pub alpha_atlas_available: bool,
}

impl MapTerrainTextureStatus {
    pub fn available() -> Self {
        Self {
            available: true,
            message: None,
            referenced_count: 0,
            loaded_count: 0,
            missing_count: 0,
            alpha_atlas_available: false,
        }
    }

    pub fn available_with_counts(
        referenced_count: u32,
        loaded_count: u32,
        missing_count: u32,
        alpha_atlas_available: bool,
        message: Option<String>,
    ) -> Self {
        Self {
            available: true,
            message,
            referenced_count,
            loaded_count,
            missing_count,
            alpha_atlas_available,
        }
    }

    pub fn unavailable(message: impl Into<String>) -> Self {
        Self::unavailable_with_counts(0, 0, 0, false, message)
    }

    pub fn unavailable_with_counts(
        referenced_count: u32,
        loaded_count: u32,
        missing_count: u32,
        alpha_atlas_available: bool,
        message: impl Into<String>,
    ) -> Self {
        Self {
            available: false,
            message: Some(message.into()),
            referenced_count,
            loaded_count,
            missing_count,
            alpha_atlas_available,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MapChunkRequest {
    pub chunk_x: i32,
    pub chunk_y: i32,
    #[serde(default)]
    pub chunk_size: Option<i32>,
    pub layer: MapWorkbenchLayer,
    pub zoom_bucket: u8,
    pub include_numeric_payload: bool,
    #[serde(default)]
    pub source_guard: Option<SourceFileInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MapChunkPayload {
    pub chunk_x: i32,
    pub chunk_y: i32,
    pub layer: MapWorkbenchLayer,
    pub tile_x: i32,
    pub tile_y: i32,
    pub tile_width: i32,
    pub tile_height: i32,
    pub sample_width: u32,
    pub sample_height: u32,
    pub image_data_uri: String,
    pub numeric_format: Option<String>,
    pub numeric_payload: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MapOverviewLayer {
    pub layer: MapWorkbenchLayer,
    pub map_width: i32,
    pub map_height: i32,
    pub sample_width: u32,
    pub sample_height: u32,
    pub image_data_uri: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MapTileTexturePreview {
    pub tile_x: i32,
    pub tile_y: i32,
    pub sample_width: u32,
    pub sample_height: u32,
    pub raw_image_data_uri: String,
    pub client_image_data_uri: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MapNativeTileFields {
    pub dw_tile_info: u32,
    pub bt_tile_info: u8,
    pub s_color: i16,
    pub c_height: i8,
    pub s_region: i16,
    pub bt_island: u8,
    pub bt_block: [u8; 4],
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MapTextureLayerInfo {
    pub slot: u8,
    pub texture_id: u8,
    pub alpha: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MapSubtileInspection {
    pub index: u8,
    pub blocked: bool,
    pub raw: u8,
    pub object_height: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MapTileAreaInfo {
    pub area_id: u32,
    pub name: String,
    pub color: [u8; 4],
    pub music: i32,
    pub env_color: [u8; 3],
    pub light_color: [u8; 3],
    pub light_dir: [f32; 3],
    pub zone_type: u8,
    pub zone_label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MapTileInspection {
    pub tile_x: i32,
    pub tile_y: i32,
    pub is_empty_section: bool,
    pub section_x: i32,
    pub section_y: i32,
    pub local_x: i32,
    pub local_y: i32,
    pub native: MapNativeTileFields,
    pub texture_layers: Vec<MapTextureLayerInfo>,
    pub color_rgb: [u8; 3],
    pub terrain_height: f32,
    pub region_flags: Vec<String>,
    pub island: u8,
    pub area: Option<MapTileAreaInfo>,
    pub subtiles: Vec<MapSubtileInspection>,
    pub nearby_placements: Vec<MapPlacementRecord>,
}

pub fn build_manifest(
    map: &ParsedMap,
    name: &str,
    chunk_size: i32,
    placement_count: usize,
    source: SourceFileInfo,
    placement_source: SourceFileInfo,
    rbo_source: SourceFileInfo,
    rbo_summary: RboSummary,
    terrain_texture_status: MapTerrainTextureStatus,
) -> MapWorkbenchManifest {
    let chunk_size = chunk_size.max(1);
    let total_sections = map.sections.len() as u32;
    let non_empty_sections = map
        .sections
        .iter()
        .filter(|section| section.is_some())
        .count() as u32;

    MapWorkbenchManifest {
        name: name.to_string(),
        width: map.header.n_width,
        height: map.header.n_height,
        section_width: map.header.n_section_width,
        section_height: map.header.n_section_height,
        section_count_x: map.section_cnt_x,
        section_count_y: map.section_cnt_y,
        total_sections,
        non_empty_sections,
        chunk_size,
        chunk_count_x: div_ceil_i32(map.header.n_width, chunk_size),
        chunk_count_y: div_ceil_i32(map.header.n_height, chunk_size),
        available_layers: manifest_layers(&terrain_texture_status),
        terrain_texture_status,
        placement_count: placement_count as u32,
        coordinate_system: "PKO tile coordinates, origin at map northwest, x east, y south"
            .to_string(),
        source,
        placement_source,
        rbo_source,
        rbo_summary,
        recommended_overview_max_size: 1024,
    }
}

fn manifest_layers(texture_status: &MapTerrainTextureStatus) -> Vec<MapWorkbenchLayer> {
    let mut layers = vec![MapWorkbenchLayer::TerrainColor];
    if texture_status.available {
        layers.push(MapWorkbenchLayer::TextureBase);
        layers.push(MapWorkbenchLayer::TextureRaw);
    }
    layers.extend([
        MapWorkbenchLayer::TextureLayers,
        MapWorkbenchLayer::Height,
        MapWorkbenchLayer::Collision,
        MapWorkbenchLayer::ObjectHeight,
        MapWorkbenchLayer::Region,
        MapWorkbenchLayer::Island,
    ]);
    layers
}

pub fn build_overview_layer(
    map: &ParsedMap,
    layer: MapWorkbenchLayer,
    max_size: u32,
    areas: Option<&HashMap<u32, AreaDefinition>>,
) -> Result<MapOverviewLayer> {
    if layer == MapWorkbenchLayer::Placements {
        return Err(anyhow!(
            "Placement layer is served by placement bounds queries"
        ));
    }

    let max_size = max_size.clamp(16, 4096);
    let map_w = map.header.n_width.max(1) as u32;
    let map_h = map.header.n_height.max(1) as u32;
    let scale = (max_size as f32 / map_w.max(map_h) as f32).min(1.0);
    let sample_width = ((map_w as f32 * scale).ceil() as u32).max(1);
    let sample_height = ((map_h as f32 * scale).ceil() as u32).max(1);
    let mut image = ImageBuffer::<Rgba<u8>, Vec<u8>>::new(sample_width, sample_height);

    for py in 0..sample_height {
        for px in 0..sample_width {
            let tx = ((px as f32 / sample_width as f32) * map_w as f32).floor() as i32;
            let ty = ((py as f32 / sample_height as f32) * map_h as f32).floor() as i32;
            image.put_pixel(px, py, overview_sample_color(map, tx, ty, layer, areas));
        }
    }

    Ok(MapOverviewLayer {
        layer,
        map_width: map.header.n_width,
        map_height: map.header.n_height,
        sample_width,
        sample_height,
        image_data_uri: encode_png_data_uri(image)?,
    })
}

pub fn build_chunk_payload(
    map: &ParsedMap,
    request: MapChunkRequest,
    chunk_size: i32,
    areas: Option<&HashMap<u32, AreaDefinition>>,
) -> Result<MapChunkPayload> {
    if request.layer == MapWorkbenchLayer::Placements {
        return Err(anyhow!(
            "Placement layer is served by placement bounds queries"
        ));
    }

    if chunk_size <= 0 {
        return Err(anyhow!("Chunk size must be positive"));
    }

    let chunk_count_x = div_ceil_i32(map.header.n_width, chunk_size);
    let chunk_count_y = div_ceil_i32(map.header.n_height, chunk_size);
    if request.chunk_x < 0
        || request.chunk_y < 0
        || request.chunk_x >= chunk_count_x
        || request.chunk_y >= chunk_count_y
    {
        return Err(anyhow!(
            "Invalid chunk ({}, {}) for {} x {} chunk map",
            request.chunk_x,
            request.chunk_y,
            chunk_count_x,
            chunk_count_y
        ));
    }

    let tile_x = request.chunk_x * chunk_size;
    let tile_y = request.chunk_y * chunk_size;
    let tile_width = (map.header.n_width - tile_x).min(chunk_size);
    let tile_height_count = (map.header.n_height - tile_y).min(chunk_size);
    let samples_per_tile = samples_per_tile(request.layer);
    let sample_width = (tile_width * samples_per_tile) as u32;
    let sample_height = (tile_height_count * samples_per_tile) as u32;
    let mut image = ImageBuffer::<Rgba<u8>, Vec<u8>>::new(sample_width, sample_height);
    let mut numeric = Vec::new();

    for sy in 0..sample_height {
        for sx in 0..sample_width {
            let local_tile_x = (sx as i32) / samples_per_tile;
            let local_tile_y = (sy as i32) / samples_per_tile;
            let subtile = ((sy as i32 % samples_per_tile) * samples_per_tile
                + (sx as i32 % samples_per_tile)) as usize;
            let tx = tile_x + local_tile_x;
            let ty = tile_y + local_tile_y;
            let color = sample_color(map, tx, ty, subtile.min(3), request.layer, areas);
            image.put_pixel(sx, sy, color);

            if request.include_numeric_payload {
                push_numeric_sample(&mut numeric, map, tx, ty, subtile.min(3), request.layer);
            }
        }
    }

    let (numeric_format, numeric_payload) = if request.include_numeric_payload {
        (
            Some(numeric_format(request.layer).to_string()),
            Some(BASE64_STANDARD.encode(numeric)),
        )
    } else {
        (None, None)
    };

    Ok(MapChunkPayload {
        chunk_x: request.chunk_x,
        chunk_y: request.chunk_y,
        layer: request.layer,
        tile_x,
        tile_y,
        tile_width,
        tile_height: tile_height_count,
        sample_width,
        sample_height,
        image_data_uri: encode_png_data_uri(image)?,
        numeric_format,
        numeric_payload,
    })
}

pub fn inspect_tile(
    map: &ParsedMap,
    tile_x: i32,
    tile_y: i32,
    placements: &[MapPlacementRecord],
    areas: Option<&HashMap<u32, AreaDefinition>>,
) -> Result<MapTileInspection> {
    if tile_x < 0 || tile_y < 0 || tile_x >= map.header.n_width || tile_y >= map.header.n_height {
        return Err(anyhow!("Invalid tile coordinates ({tile_x}, {tile_y})"));
    }

    let default_tile;
    let (tile, is_empty_section) = match get_tile(map, tile_x, tile_y) {
        Some(tile) => (tile, false),
        None => {
            default_tile = default_missing_tile();
            (&default_tile, true)
        }
    };
    let section_x = tile_x / map.header.n_section_width;
    let section_y = tile_y / map.header.n_section_height;
    let local_x = tile_x % map.header.n_section_width;
    let local_y = tile_y % map.header.n_section_height;
    let native = MapNativeTileFields {
        dw_tile_info: tile.dw_tile_info,
        bt_tile_info: tile.bt_tile_info,
        s_color: tile.s_color,
        c_height: tile.c_height,
        s_region: tile.s_region,
        bt_island: tile.bt_island,
        bt_block: tile.bt_block,
    };
    let subtiles = tile
        .bt_block
        .iter()
        .enumerate()
        .map(|(index, raw)| MapSubtileInspection {
            index: index as u8,
            blocked: raw & 0x80 != 0,
            raw: *raw,
            object_height: decode_obj_height(*raw),
        })
        .collect();

    Ok(MapTileInspection {
        tile_x,
        tile_y,
        is_empty_section,
        section_x,
        section_y,
        local_x,
        local_y,
        native,
        texture_layers: decode_texture_layers(tile.bt_tile_info, tile.dw_tile_info),
        color_rgb: rgb565_bytes(tile.s_color),
        terrain_height: tile_height(tile),
        region_flags: region_flags(tile.s_region),
        island: tile.bt_island,
        area: area_info_for_island(tile.bt_island, areas),
        subtiles,
        nearby_placements: placements_in_bounds(
            placements,
            tile_x as f32,
            tile_y as f32,
            tile_x as f32 + 1.0,
            tile_y as f32 + 1.0,
            32,
        ),
    })
}

fn area_info_for_island(
    island: u8,
    areas: Option<&HashMap<u32, AreaDefinition>>,
) -> Option<MapTileAreaInfo> {
    let area = areas?.get(&(island as u32))?;
    Some(MapTileAreaInfo {
        area_id: area.area_id,
        name: area.name.clone(),
        color: area.color,
        music: area.music,
        env_color: area.env_color,
        light_color: area.light_color,
        light_dir: area.light_dir,
        zone_type: area.zone_type,
        zone_label: zone_type_label(area.zone_type).to_string(),
    })
}

fn zone_type_label(zone_type: u8) -> &'static str {
    match zone_type {
        1 => "City",
        0 => "Wilderness",
        _ => "Unknown",
    }
}

pub fn placements_in_bounds(
    placements: &[MapPlacementRecord],
    min_x: f32,
    min_y: f32,
    max_x: f32,
    max_y: f32,
    limit: usize,
) -> Vec<MapPlacementRecord> {
    placements_in_bounds_with_total(placements, min_x, min_y, max_x, max_y, limit).1
}

pub fn placements_in_bounds_with_total(
    placements: &[MapPlacementRecord],
    min_x: f32,
    min_y: f32,
    max_x: f32,
    max_y: f32,
    limit: usize,
) -> (usize, Vec<MapPlacementRecord>) {
    if min_x >= max_x
        || min_y >= max_y
        || ![min_x, min_y, max_x, max_y]
            .iter()
            .all(|value| value.is_finite())
    {
        return (0, Vec::new());
    }

    let mut total = 0usize;
    let mut items = Vec::new();

    for placement in placements.iter().filter(|placement| {
        placement.world_x >= min_x
            && placement.world_y >= min_y
            && placement.world_x < max_x
            && placement.world_y < max_y
    }) {
        total += 1;
        if items.len() < limit {
            items.push(placement.clone());
        }
    }

    (total, items)
}

#[derive(Debug)]
pub struct PlacementSpatialIndex {
    placements: Arc<Vec<MapPlacementRecord>>,
    cell_size: f32,
    cells: HashMap<(i32, i32), Vec<usize>>,
    cell_bounds: Option<(i32, i32, i32, i32)>,
}

impl PlacementSpatialIndex {
    pub fn new(placements: Arc<Vec<MapPlacementRecord>>, cell_size: f32) -> Self {
        let cell_size = cell_size.max(1.0);
        let mut cells: HashMap<(i32, i32), Vec<usize>> = HashMap::new();
        let mut cell_bounds: Option<(i32, i32, i32, i32)> = None;

        for (index, placement) in placements.iter().enumerate() {
            let cell = Self::cell_for(placement.world_x, placement.world_y, cell_size);
            cells.entry(cell).or_default().push(index);
            cell_bounds = Some(match cell_bounds {
                Some((min_x, min_y, max_x, max_y)) => (
                    min_x.min(cell.0),
                    min_y.min(cell.1),
                    max_x.max(cell.0),
                    max_y.max(cell.1),
                ),
                None => (cell.0, cell.1, cell.0, cell.1),
            });
        }

        Self {
            placements,
            cell_size,
            cells,
            cell_bounds,
        }
    }

    pub fn query_bounds(
        &self,
        min_x: f32,
        min_y: f32,
        max_x: f32,
        max_y: f32,
        limit: usize,
    ) -> (usize, Vec<MapPlacementRecord>) {
        let matched = self.query_bounds_indices_matching(min_x, min_y, max_x, max_y, |_| true);
        let total = matched.len();
        let items = matched
            .into_iter()
            .take(limit)
            .map(|index| self.placements[index].clone())
            .collect();

        (total, items)
    }

    pub fn query_bounds_indices_matching<F>(
        &self,
        min_x: f32,
        min_y: f32,
        max_x: f32,
        max_y: f32,
        mut matches: F,
    ) -> Vec<usize>
    where
        F: FnMut(&MapPlacementRecord) -> bool,
    {
        if min_x >= max_x
            || min_y >= max_y
            || ![min_x, min_y, max_x, max_y]
                .iter()
                .all(|value| value.is_finite())
        {
            return Vec::new();
        }

        let Some((occupied_min_x, occupied_min_y, occupied_max_x, occupied_max_y)) =
            self.cell_bounds
        else {
            return Vec::new();
        };

        let min_cell = Self::cell_for(min_x, min_y, self.cell_size);
        let max_cell = Self::max_exclusive_cell_for(max_x, max_y, self.cell_size);
        let min_cell_x = min_cell.0.max(occupied_min_x);
        let min_cell_y = min_cell.1.max(occupied_min_y);
        let max_cell_x = max_cell.0.min(occupied_max_x);
        let max_cell_y = max_cell.1.min(occupied_max_y);
        if min_cell_x > max_cell_x || min_cell_y > max_cell_y {
            return Vec::new();
        }

        let mut matched = Vec::new();
        let span_x = i64::from(max_cell_x) - i64::from(min_cell_x) + 1;
        let span_y = i64::from(max_cell_y) - i64::from(min_cell_y) + 1;
        let requested_cell_count = span_x.saturating_mul(span_y);
        let populated_scan_threshold = (self.cells.len() as i64).saturating_mul(4).max(4096);

        if requested_cell_count > populated_scan_threshold {
            for indices in self.cells.values() {
                self.push_matching_indices(
                    indices,
                    min_x,
                    min_y,
                    max_x,
                    max_y,
                    &mut matched,
                    &mut matches,
                );
            }
        } else {
            for cell_y in min_cell_y..=max_cell_y {
                for cell_x in min_cell_x..=max_cell_x {
                    if let Some(indices) = self.cells.get(&(cell_x, cell_y)) {
                        self.push_matching_indices(
                            indices,
                            min_x,
                            min_y,
                            max_x,
                            max_y,
                            &mut matched,
                            &mut matches,
                        );
                    }
                }
            }
        }

        matched.sort_unstable();
        matched
    }

    pub fn record_at(&self, index: usize) -> Option<&MapPlacementRecord> {
        self.placements.get(index)
    }

    fn cell_for(x: f32, y: f32, cell_size: f32) -> (i32, i32) {
        (
            (x / cell_size).floor() as i32,
            (y / cell_size).floor() as i32,
        )
    }

    fn max_exclusive_cell_for(x: f32, y: f32, cell_size: f32) -> (i32, i32) {
        (
            (x / cell_size).ceil() as i32 - 1,
            (y / cell_size).ceil() as i32 - 1,
        )
    }

    fn push_matching_indices<F>(
        &self,
        indices: &[usize],
        min_x: f32,
        min_y: f32,
        max_x: f32,
        max_y: f32,
        matched: &mut Vec<usize>,
        matches: &mut F,
    ) where
        F: FnMut(&MapPlacementRecord) -> bool,
    {
        for index in indices {
            let placement = &self.placements[*index];
            if placement.world_x >= min_x
                && placement.world_y >= min_y
                && placement.world_x < max_x
                && placement.world_y < max_y
                && matches(placement)
            {
                matched.push(*index);
            }
        }
    }
}

fn div_ceil_i32(value: i32, divisor: i32) -> i32 {
    if value <= 0 {
        0
    } else {
        (value + divisor - 1) / divisor
    }
}

fn samples_per_tile(layer: MapWorkbenchLayer) -> i32 {
    match layer {
        MapWorkbenchLayer::Collision | MapWorkbenchLayer::ObjectHeight => 2,
        _ => 1,
    }
}

fn numeric_format(layer: MapWorkbenchLayer) -> &'static str {
    match layer {
        MapWorkbenchLayer::TerrainColor => "rgb8",
        MapWorkbenchLayer::TextureBase | MapWorkbenchLayer::TextureRaw => "u8",
        MapWorkbenchLayer::TextureLayers => "texture_alpha_pairs_u8",
        MapWorkbenchLayer::Height => "i16_mm",
        MapWorkbenchLayer::Collision => "u8",
        MapWorkbenchLayer::ObjectHeight => "i16_mm",
        MapWorkbenchLayer::Region => "i16",
        MapWorkbenchLayer::Island => "u8",
        MapWorkbenchLayer::Placements => "u8",
    }
}

fn with_tile_or_default<T>(
    map: &ParsedMap,
    tx: i32,
    ty: i32,
    callback: impl FnOnce(&MapTile) -> T,
) -> T {
    match get_tile(map, tx, ty) {
        Some(tile) => callback(tile),
        None => {
            let default_tile = default_missing_tile();
            callback(&default_tile)
        }
    }
}

fn push_numeric_sample(
    out: &mut Vec<u8>,
    map: &ParsedMap,
    tx: i32,
    ty: i32,
    subtile: usize,
    layer: MapWorkbenchLayer,
) {
    with_tile_or_default(map, tx, ty, |tile| match layer {
        MapWorkbenchLayer::TerrainColor => out.extend_from_slice(&rgb565_bytes(tile.s_color)),
        MapWorkbenchLayer::TextureBase | MapWorkbenchLayer::TextureRaw => {
            out.push(tile.bt_tile_info)
        }
        MapWorkbenchLayer::TextureLayers => {
            let layers = decode_texture_layers(tile.bt_tile_info, tile.dw_tile_info);
            for slot in 0..4 {
                let layer = layers.get(slot);
                out.push(layer.map(|layer| layer.texture_id).unwrap_or(0));
                out.push(layer.map(|layer| layer.alpha).unwrap_or(0));
            }
        }
        MapWorkbenchLayer::Height => {
            let mm = (tile_height(tile) * 1000.0).round() as i16;
            out.extend_from_slice(&mm.to_le_bytes());
        }
        MapWorkbenchLayer::Collision => {
            let blocked = u8::from(tile.bt_block[subtile] & 0x80 != 0);
            out.push(blocked);
        }
        MapWorkbenchLayer::ObjectHeight => {
            let mm = (decode_obj_height(tile.bt_block[subtile]) * 1000.0).round() as i16;
            out.extend_from_slice(&mm.to_le_bytes());
        }
        MapWorkbenchLayer::Region => {
            out.extend_from_slice(&tile.s_region.to_le_bytes());
        }
        MapWorkbenchLayer::Island => out.push(tile.bt_island),
        MapWorkbenchLayer::Placements => out.push(0),
    });
}

fn sample_color(
    map: &ParsedMap,
    tx: i32,
    ty: i32,
    subtile: usize,
    layer: MapWorkbenchLayer,
    areas: Option<&HashMap<u32, AreaDefinition>>,
) -> Rgba<u8> {
    with_tile_or_default(map, tx, ty, |tile| match layer {
        MapWorkbenchLayer::TerrainColor => {
            let [r, g, b] = rgb565_bytes(tile.s_color);
            Rgba([r, g, b, 255])
        }
        MapWorkbenchLayer::TextureBase | MapWorkbenchLayer::TextureRaw => {
            palette(tile.bt_tile_info)
        }
        MapWorkbenchLayer::TextureLayers => {
            let strength = decode_texture_layers(tile.bt_tile_info, tile.dw_tile_info)
                .iter()
                .map(|layer| layer.alpha)
                .sum::<u8>();
            Rgba([strength.saturating_mul(4), 120, 220, 210])
        }
        MapWorkbenchLayer::Height => {
            let normalized = (tile.c_height as i16 + 128).clamp(0, 255) as u8;
            Rgba([normalized, 80, 255u8.saturating_sub(normalized), 220])
        }
        MapWorkbenchLayer::Collision => {
            let blocked = tile.bt_block[subtile] & 0x80 != 0;
            if blocked {
                Rgba([239, 68, 68, 220])
            } else {
                Rgba([34, 197, 94, 40])
            }
        }
        MapWorkbenchLayer::ObjectHeight => {
            let height = decode_obj_height(tile.bt_block[subtile]);
            object_height_color(height)
        }
        MapWorkbenchLayer::Region => palette(tile.s_region as u8),
        MapWorkbenchLayer::Island => area_color_or_palette(tile.bt_island, areas),
        MapWorkbenchLayer::Placements => Rgba([0, 0, 0, 0]),
    })
}

fn overview_sample_color(
    map: &ParsedMap,
    tx: i32,
    ty: i32,
    layer: MapWorkbenchLayer,
    areas: Option<&HashMap<u32, AreaDefinition>>,
) -> Rgba<u8> {
    match layer {
        MapWorkbenchLayer::Collision => {
            let blocked = with_tile_or_default(map, tx, ty, |tile| {
                tile.bt_block.iter().any(|raw| raw & 0x80 != 0)
            });
            if blocked {
                Rgba([239, 68, 68, 220])
            } else {
                Rgba([34, 197, 94, 40])
            }
        }
        MapWorkbenchLayer::ObjectHeight => {
            let height = with_tile_or_default(map, tx, ty, |tile| {
                tile.bt_block
                    .iter()
                    .map(|raw| decode_obj_height(*raw))
                    .max_by(|a, b| {
                        a.abs()
                            .partial_cmp(&b.abs())
                            .unwrap_or(std::cmp::Ordering::Equal)
                    })
                    .unwrap_or(0.0)
            });
            object_height_color(height)
        }
        _ => sample_color(map, tx, ty, 0, layer, areas),
    }
}

fn object_height_color(height: f32) -> Rgba<u8> {
    let magnitude = ((height.abs() / 3.15) * 255.0).round().clamp(0.0, 255.0) as u8;
    if height < 0.0 {
        Rgba([59, 130, 246, magnitude.max(60)])
    } else {
        Rgba([245, 158, 11, magnitude.max(60)])
    }
}

fn rgb565_bytes(color: i16) -> [u8; 3] {
    let (r, g, b) = rgb565_to_float(color);
    [
        (r * 255.0).round().clamp(0.0, 255.0) as u8,
        (g * 255.0).round().clamp(0.0, 255.0) as u8,
        (b * 255.0).round().clamp(0.0, 255.0) as u8,
    ]
}

fn palette(value: u8) -> Rgba<u8> {
    let r = value.wrapping_mul(53).wrapping_add(71);
    let g = value.wrapping_mul(97).wrapping_add(43);
    let b = value.wrapping_mul(193).wrapping_add(29);
    Rgba([r, g, b, 230])
}

fn area_color_or_palette(island: u8, areas: Option<&HashMap<u32, AreaDefinition>>) -> Rgba<u8> {
    if let Some(area) = areas.and_then(|areas| areas.get(&(island as u32))) {
        return Rgba(area.color);
    }

    palette(island)
}

fn region_flags(region: i16) -> Vec<String> {
    let bits = region as u16;
    let mut flags = Vec::new();
    if bits & 0x0001 != 0 {
        flags.push("land".to_string());
    }
    if bits & 0x0002 != 0 {
        flags.push("not_fight".to_string());
    }
    if bits & 0x0004 != 0 {
        flags.push("pk".to_string());
    }
    if bits & 0x0008 != 0 {
        flags.push("bridge".to_string());
    }
    if bits & 0x0010 != 0 {
        flags.push("no_monster".to_string());
    }
    if bits & 0x0020 != 0 {
        flags.push("mining".to_string());
    }
    if bits & 0x0040 != 0 {
        flags.push("fight_ask".to_string());
    }
    flags
}

fn decode_texture_layers(bt_tile_info: u8, dw_tile_info: u32) -> Vec<MapTextureLayerInfo> {
    vec![
        MapTextureLayerInfo {
            slot: 0,
            texture_id: bt_tile_info,
            alpha: 15,
        },
        MapTextureLayerInfo {
            slot: 1,
            texture_id: ((dw_tile_info >> 26) & 0x3f) as u8,
            alpha: ((dw_tile_info >> 22) & 0x0f) as u8,
        },
        MapTextureLayerInfo {
            slot: 2,
            texture_id: ((dw_tile_info >> 16) & 0x3f) as u8,
            alpha: ((dw_tile_info >> 12) & 0x0f) as u8,
        },
        MapTextureLayerInfo {
            slot: 3,
            texture_id: ((dw_tile_info >> 6) & 0x3f) as u8,
            alpha: ((dw_tile_info >> 2) & 0x0f) as u8,
        },
    ]
}

fn encode_png_data_uri(image: ImageBuffer<Rgba<u8>, Vec<u8>>) -> Result<String> {
    let mut bytes = Vec::new();
    let dynamic = DynamicImage::ImageRgba8(image);
    dynamic.write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png)?;
    Ok(format!(
        "data:image/png;base64,{}",
        BASE64_STANDARD.encode(bytes)
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::map::area_set::AreaDefinition;
    use crate::map::terrain::{MapHeader, MapSection, MapTile, ParsedMap};
    use base64::Engine;
    use std::sync::Arc;

    fn tile(
        dw_tile_info: u32,
        bt_tile_info: u8,
        s_color: i16,
        c_height: i8,
        s_region: i16,
        bt_island: u8,
        bt_block: [u8; 4],
    ) -> MapTile {
        MapTile {
            dw_tile_info,
            bt_tile_info,
            s_color,
            c_height,
            s_region,
            bt_island,
            bt_block,
        }
    }

    fn map_4x4() -> ParsedMap {
        let encoded_layers = (21u32 << 26)
            | (5u32 << 22)
            | (33u32 << 16)
            | (7u32 << 12)
            | (12u32 << 6)
            | (9u32 << 2);
        ParsedMap {
            header: MapHeader {
                n_map_flag: 780627,
                n_width: 4,
                n_height: 4,
                n_section_width: 2,
                n_section_height: 2,
            },
            section_cnt_x: 2,
            section_cnt_y: 2,
            section_offsets: vec![20, 80, 140, 200],
            sections: vec![
                Some(MapSection {
                    tiles: vec![
                        tile(
                            encoded_layers,
                            7,
                            0x001f,
                            10,
                            0x0007,
                            2,
                            [0x80, 0x01, 0x41, 0xc1],
                        ),
                        tile(0x0000_0000, 8, 0x07e0, 0, 0, 0, [0, 0, 0, 0]),
                        tile(0x0000_0000, 9, 0xf800u16 as i16, -5, 0, 1, [0, 0, 0, 0]),
                        tile(
                            0x0000_0000,
                            10,
                            0xffffu16 as i16,
                            20,
                            0x0010,
                            3,
                            [0, 0x80, 0, 0],
                        ),
                    ],
                }),
                Some(MapSection {
                    tiles: vec![tile(0, 11, 0, 1, 0, 0, [0; 4]); 4],
                }),
                Some(MapSection {
                    tiles: vec![tile(0, 12, 0, 2, 0, 0, [0; 4]); 4],
                }),
                None,
            ],
        }
    }

    #[test]
    fn manifest_reports_chunk_counts_and_layers() {
        let manifest = build_manifest(
            &map_4x4(),
            "puzzle",
            2,
            5,
            SourceFileInfo {
                map_modified_ms: 123,
                map_file_len: 456,
                content_sha256: "map-hash".to_string(),
            },
            SourceFileInfo {
                map_modified_ms: 789,
                map_file_len: 321,
                content_sha256: "obj-hash".to_string(),
            },
            SourceFileInfo {
                map_modified_ms: 987,
                map_file_len: 654,
                content_sha256: "rbo-hash".to_string(),
            },
            crate::map::rbo::RboSummary::missing(),
            MapTerrainTextureStatus::available(),
        );
        assert_eq!(manifest.name, "puzzle");
        assert_eq!(manifest.width, 4);
        assert_eq!(manifest.height, 4);
        assert_eq!(manifest.chunk_size, 2);
        assert_eq!(manifest.chunk_count_x, 2);
        assert_eq!(manifest.chunk_count_y, 2);
        assert_eq!(manifest.total_sections, 4);
        assert_eq!(manifest.non_empty_sections, 3);
        assert_eq!(manifest.placement_count, 5);
        assert_eq!(manifest.source.map_modified_ms, 123);
        assert_eq!(manifest.placement_source.map_modified_ms, 789);
        assert_eq!(manifest.rbo_source.map_modified_ms, 987);
        assert!(manifest
            .available_layers
            .contains(&MapWorkbenchLayer::Collision));
        assert!(manifest
            .available_layers
            .contains(&MapWorkbenchLayer::TextureRaw));
        assert!(!manifest
            .available_layers
            .contains(&MapWorkbenchLayer::Placements));
    }

    #[test]
    fn manifest_omits_real_texture_layers_when_assets_are_unavailable() {
        let manifest = build_manifest(
            &map_4x4(),
            "puzzle",
            2,
            5,
            SourceFileInfo {
                map_modified_ms: 123,
                map_file_len: 456,
                content_sha256: "map-hash".to_string(),
            },
            SourceFileInfo {
                map_modified_ms: 789,
                map_file_len: 321,
                content_sha256: "obj-hash".to_string(),
            },
            SourceFileInfo {
                map_modified_ms: 987,
                map_file_len: 654,
                content_sha256: "rbo-hash".to_string(),
            },
            crate::map::rbo::RboSummary::missing(),
            MapTerrainTextureStatus::unavailable("TerrainInfo.bin was not found"),
        );

        assert!(!manifest.terrain_texture_status.available);
        assert_eq!(
            manifest.terrain_texture_status.message.as_deref(),
            Some("TerrainInfo.bin was not found"),
        );
        assert!(!manifest
            .available_layers
            .contains(&MapWorkbenchLayer::TextureBase));
        assert!(!manifest
            .available_layers
            .contains(&MapWorkbenchLayer::TextureRaw));
        assert!(manifest
            .available_layers
            .contains(&MapWorkbenchLayer::TextureLayers));
    }

    #[test]
    fn chunk_request_deserializes_source_guard() {
        let request: MapChunkRequest = serde_json::from_value(serde_json::json!({
            "chunk_x": 1,
            "chunk_y": 2,
            "chunk_size": 64,
            "layer": "collision",
            "zoom_bucket": 3,
            "include_numeric_payload": true,
            "source_guard": {
                "map_modified_ms": 111,
                "map_file_len": 222,
                "content_sha256": "map-hash"
            }
        }))
        .unwrap();

        let source_guard = request.source_guard.unwrap();
        assert_eq!(request.chunk_x, 1);
        assert_eq!(request.chunk_size, Some(64));
        assert_eq!(request.layer, MapWorkbenchLayer::Collision);
        assert_eq!(source_guard.map_modified_ms, 111);
        assert_eq!(source_guard.map_file_len, 222);
        assert_eq!(source_guard.content_sha256, "map-hash");
    }

    #[test]
    fn manifest_reports_rbo_summary() {
        let rbo_bytes = b"26 10 20 0 -180 0 0 0 5\n316 30 40 2 75 0 0 0 9\n";
        let rbo_summary = crate::map::rbo::summarize_rbo_bytes(rbo_bytes, rbo_bytes.len() as u64);

        let manifest = build_manifest(
            &map_4x4(),
            "puzzle",
            2,
            5,
            SourceFileInfo {
                map_modified_ms: 123,
                map_file_len: 456,
                content_sha256: "map-hash".to_string(),
            },
            SourceFileInfo {
                map_modified_ms: 789,
                map_file_len: 321,
                content_sha256: "obj-hash".to_string(),
            },
            SourceFileInfo {
                map_modified_ms: 987,
                map_file_len: 654,
                content_sha256: "rbo-hash".to_string(),
            },
            rbo_summary.clone(),
            MapTerrainTextureStatus::available(),
        );

        assert_eq!(manifest.rbo_summary, rbo_summary);
    }

    #[test]
    fn manifest_clamps_non_positive_chunk_size() {
        let manifest = build_manifest(
            &map_4x4(),
            "puzzle",
            0,
            0,
            SourceFileInfo {
                map_modified_ms: 123,
                map_file_len: 456,
                content_sha256: "map-hash".to_string(),
            },
            SourceFileInfo {
                map_modified_ms: 0,
                map_file_len: 0,
                content_sha256: String::new(),
            },
            SourceFileInfo {
                map_modified_ms: 0,
                map_file_len: 0,
                content_sha256: String::new(),
            },
            crate::map::rbo::RboSummary::missing(),
            MapTerrainTextureStatus::available(),
        );

        assert_eq!(manifest.chunk_size, 1);
        assert_eq!(manifest.chunk_count_x, 4);
        assert_eq!(manifest.chunk_count_y, 4);
    }

    #[test]
    fn decode_tile_exposes_native_and_derived_fields() {
        let decoded = inspect_tile(&map_4x4(), 0, 0, &[], None).unwrap();
        assert_eq!(decoded.tile_x, 0);
        assert_eq!(decoded.tile_y, 0);
        assert!(!decoded.is_empty_section);
        assert_eq!(decoded.section_x, 0);
        assert_eq!(decoded.section_y, 0);
        assert_eq!(decoded.local_x, 0);
        assert_eq!(decoded.local_y, 0);
        assert_eq!(decoded.native.bt_tile_info, 7);
        assert_eq!(decoded.native.c_height, 10);
        assert!((decoded.terrain_height - 1.0).abs() < 0.001);
        assert_eq!(decoded.color_rgb, [248, 0, 0]);
        assert_eq!(decoded.region_flags, vec!["land", "not_fight", "pk"]);
        assert_eq!(decoded.texture_layers[0].texture_id, 7);
        assert_eq!(decoded.texture_layers[0].alpha, 15);
        assert_eq!(decoded.texture_layers[1].texture_id, 21);
        assert_eq!(decoded.texture_layers[1].alpha, 5);
        assert_eq!(decoded.texture_layers[2].texture_id, 33);
        assert_eq!(decoded.texture_layers[2].alpha, 7);
        assert_eq!(decoded.texture_layers[3].texture_id, 12);
        assert_eq!(decoded.texture_layers[3].alpha, 9);
        assert_eq!(decoded.subtiles[0].blocked, true);
        assert_eq!(decoded.subtiles[0].object_height, 0.0);
        assert_eq!(decoded.subtiles[1].blocked, false);
        assert!((decoded.subtiles[1].object_height - 0.05).abs() < 0.001);
        assert!((decoded.subtiles[2].object_height + 0.05).abs() < 0.001);
        assert!(decoded.subtiles[3].blocked);
    }

    #[test]
    fn decode_tile_uses_default_underwater_tile_for_empty_sections() {
        let decoded = inspect_tile(&map_4x4(), 2, 2, &[], None).unwrap();

        assert!(decoded.is_empty_section);
        assert_eq!(decoded.section_x, 1);
        assert_eq!(decoded.section_y, 1);
        assert_eq!(decoded.local_x, 0);
        assert_eq!(decoded.local_y, 0);
        assert_eq!(decoded.native.dw_tile_info, 0);
        assert_eq!(decoded.native.bt_tile_info, 22);
        assert_eq!(decoded.native.s_color, -1);
        assert_eq!(decoded.native.c_height, -20);
        assert_eq!(decoded.native.s_region, 0);
        assert_eq!(decoded.native.bt_island, 0);
        assert_eq!(decoded.native.bt_block, [0, 0, 0, 0]);
        assert_eq!(decoded.texture_layers[0].texture_id, 22);
        assert_eq!(decoded.texture_layers[0].alpha, 15);
        assert!(decoded.texture_layers[1..]
            .iter()
            .all(|layer| layer.texture_id == 0 && layer.alpha == 0));
        assert_eq!(decoded.color_rgb, [248, 252, 248]);
        assert!((decoded.terrain_height + 2.0).abs() < 0.001);
        assert!(decoded.region_flags.is_empty());
        assert!(decoded.subtiles.iter().all(|subtile| !subtile.blocked));
    }

    #[test]
    fn decode_tile_enriches_island_from_area_set() {
        let mut areas = HashMap::new();
        areas.insert(2, test_area_definition([32, 96, 192, 255]));

        let decoded = inspect_tile(&map_4x4(), 0, 0, &[], Some(&areas)).unwrap();

        let area = decoded
            .area
            .expect("tile island 2 should resolve to area 2");
        assert_eq!(area.area_id, 2);
        assert_eq!(area.name, "Argent City");
        assert_eq!(area.color, [32, 96, 192, 255]);
        assert_eq!(area.music, 7);
        assert_eq!(area.env_color, [12, 24, 36]);
        assert_eq!(area.light_color, [48, 60, 72]);
        assert_eq!(area.light_dir, [-1.0, -0.5, 0.25]);
        assert_eq!(area.zone_type, 1);
        assert_eq!(area.zone_label, "City");
    }

    #[test]
    fn decode_tile_keeps_missing_area_set_entry_null() {
        let areas = HashMap::new();

        let decoded = inspect_tile(&map_4x4(), 0, 0, &[], Some(&areas)).unwrap();

        assert_eq!(decoded.island, 2);
        assert!(decoded.area.is_none());
    }

    #[test]
    fn chunk_payload_clamps_at_map_edges() {
        let payload = build_chunk_payload(
            &map_4x4(),
            MapChunkRequest {
                chunk_x: 1,
                chunk_y: 1,
                chunk_size: None,
                layer: MapWorkbenchLayer::TextureBase,
                zoom_bucket: 1,
                include_numeric_payload: true,
                source_guard: None,
            },
            3,
            None,
        )
        .unwrap();
        assert_eq!(payload.tile_x, 3);
        assert_eq!(payload.tile_y, 3);
        assert_eq!(payload.tile_width, 1);
        assert_eq!(payload.tile_height, 1);
        assert_eq!(payload.numeric_format.as_deref(), Some("u8"));
        assert!(!payload.image_data_uri.is_empty());
    }

    #[test]
    fn collision_chunk_uses_only_bit_seven() {
        let payload = build_chunk_payload(
            &map_4x4(),
            MapChunkRequest {
                chunk_x: 0,
                chunk_y: 0,
                chunk_size: None,
                layer: MapWorkbenchLayer::Collision,
                zoom_bucket: 2,
                include_numeric_payload: true,
                source_guard: None,
            },
            2,
            None,
        )
        .unwrap();
        let raw = base64::prelude::BASE64_STANDARD
            .decode(payload.numeric_payload.unwrap())
            .unwrap();
        assert_eq!(payload.sample_width, 4);
        assert_eq!(payload.sample_height, 4);
        assert_eq!(raw[0], 1);
        assert_eq!(raw[1], 0);
        assert_eq!(raw[4], 0);
        assert_eq!(raw[5], 1);
    }

    #[test]
    fn island_chunk_uses_area_set_minimap_colors_when_available() {
        let mut areas = HashMap::new();
        areas.insert(
            2,
            AreaDefinition {
                area_id: 2,
                name: "Argent City".to_string(),
                color: [32, 96, 192, 255],
                music: 7,
                env_color: [12, 24, 36],
                light_color: [48, 60, 72],
                light_dir: [-1.0, -0.5, 0.25],
                zone_type: 1,
            },
        );

        let payload = build_chunk_payload(
            &map_4x4(),
            MapChunkRequest {
                chunk_x: 0,
                chunk_y: 0,
                chunk_size: None,
                layer: MapWorkbenchLayer::Island,
                zoom_bucket: 1,
                include_numeric_payload: true,
                source_guard: None,
            },
            2,
            Some(&areas),
        )
        .unwrap();

        assert_eq!(
            decode_png_pixel(&payload.image_data_uri, 0, 0),
            [32, 96, 192, 255]
        );

        let raw = base64::prelude::BASE64_STANDARD
            .decode(payload.numeric_payload.unwrap())
            .unwrap();
        assert_eq!(raw[0], 2);
    }

    #[test]
    fn island_chunk_falls_back_to_palette_when_area_entry_is_missing() {
        let payload = build_chunk_payload(
            &map_4x4(),
            MapChunkRequest {
                chunk_x: 0,
                chunk_y: 0,
                chunk_size: None,
                layer: MapWorkbenchLayer::Island,
                zoom_bucket: 1,
                include_numeric_payload: false,
                source_guard: None,
            },
            2,
            Some(&HashMap::new()),
        )
        .unwrap();

        assert_eq!(
            decode_png_pixel(&payload.image_data_uri, 0, 0),
            palette(2).0
        );
    }

    #[test]
    fn texture_layers_numeric_payload_preserves_texture_alpha_pairs() {
        let payload = build_chunk_payload(
            &map_4x4(),
            MapChunkRequest {
                chunk_x: 0,
                chunk_y: 0,
                chunk_size: None,
                layer: MapWorkbenchLayer::TextureLayers,
                zoom_bucket: 0,
                include_numeric_payload: true,
                source_guard: None,
            },
            1,
            None,
        )
        .unwrap();
        let raw = base64::prelude::BASE64_STANDARD
            .decode(payload.numeric_payload.unwrap())
            .unwrap();

        assert_eq!(
            payload.numeric_format.as_deref(),
            Some("texture_alpha_pairs_u8")
        );
        assert_eq!(raw, vec![7, 15, 21, 5, 33, 7, 12, 9]);
    }

    #[test]
    fn texture_chunk_uses_default_underwater_tile_for_empty_sections() {
        let payload = build_chunk_payload(
            &map_4x4(),
            MapChunkRequest {
                chunk_x: 1,
                chunk_y: 1,
                chunk_size: None,
                layer: MapWorkbenchLayer::TextureBase,
                zoom_bucket: 0,
                include_numeric_payload: true,
                source_guard: None,
            },
            2,
            None,
        )
        .unwrap();
        let raw = base64::prelude::BASE64_STANDARD
            .decode(payload.numeric_payload.unwrap())
            .unwrap();

        assert_eq!(raw, vec![22, 22, 22, 22]);
        assert_eq!(
            decode_png_pixel(&payload.image_data_uri, 0, 0),
            palette(22).0
        );
    }

    #[test]
    fn height_chunk_uses_default_underwater_height_for_empty_sections() {
        let payload = build_chunk_payload(
            &map_4x4(),
            MapChunkRequest {
                chunk_x: 1,
                chunk_y: 1,
                chunk_size: None,
                layer: MapWorkbenchLayer::Height,
                zoom_bucket: 0,
                include_numeric_payload: true,
                source_guard: None,
            },
            2,
            None,
        )
        .unwrap();
        let raw = base64::prelude::BASE64_STANDARD
            .decode(payload.numeric_payload.unwrap())
            .unwrap();
        let first_height = i16::from_le_bytes(raw[0..2].try_into().unwrap());

        assert_eq!(first_height, -2000);
        assert_eq!(
            decode_png_pixel(&payload.image_data_uri, 0, 0),
            [108, 80, 147, 220]
        );
    }

    #[test]
    fn collision_overview_aggregates_all_subtiles() {
        let color = overview_sample_color(&map_4x4(), 1, 1, MapWorkbenchLayer::Collision, None);

        assert_eq!(color.0, [239, 68, 68, 220]);
    }

    #[test]
    fn island_overview_uses_area_set_minimap_colors_when_available() {
        let mut areas = HashMap::new();
        areas.insert(2, test_area_definition([32, 96, 192, 255]));

        let overview =
            build_overview_layer(&map_4x4(), MapWorkbenchLayer::Island, 4, Some(&areas)).unwrap();

        assert_eq!(
            decode_png_pixel(&overview.image_data_uri, 0, 0),
            [32, 96, 192, 255]
        );
    }

    fn test_area_definition(color: [u8; 4]) -> AreaDefinition {
        AreaDefinition {
            area_id: 2,
            name: "Argent City".to_string(),
            color,
            music: 7,
            env_color: [12, 24, 36],
            light_color: [48, 60, 72],
            light_dir: [-1.0, -0.5, 0.25],
            zone_type: 1,
        }
    }

    fn decode_png_pixel(data_uri: &str, x: u32, y: u32) -> [u8; 4] {
        let encoded = data_uri
            .strip_prefix("data:image/png;base64,")
            .expect("PNG data URI prefix");
        let bytes = base64::prelude::BASE64_STANDARD
            .decode(encoded)
            .expect("valid PNG base64");
        let image = image::load_from_memory(&bytes)
            .expect("valid PNG image")
            .to_rgba8();
        image.get_pixel(x, y).0
    }

    #[test]
    fn invalid_chunk_coordinates_are_rejected() {
        let err = build_chunk_payload(
            &map_4x4(),
            MapChunkRequest {
                chunk_x: 9,
                chunk_y: 0,
                chunk_size: None,
                layer: MapWorkbenchLayer::Height,
                zoom_bucket: 0,
                include_numeric_payload: false,
                source_guard: None,
            },
            2,
            None,
        )
        .unwrap_err();
        assert!(err.to_string().contains("Invalid chunk"));
    }

    #[test]
    fn placement_layer_chunks_are_rejected() {
        let err = build_chunk_payload(
            &map_4x4(),
            MapChunkRequest {
                chunk_x: 0,
                chunk_y: 0,
                chunk_size: None,
                layer: MapWorkbenchLayer::Placements,
                zoom_bucket: 0,
                include_numeric_payload: false,
                source_guard: None,
            },
            2,
            None,
        )
        .unwrap_err();

        assert!(err.to_string().contains("placement bounds queries"));
    }

    #[test]
    fn placement_spatial_index_reports_total_and_caps_items() {
        let placements = Arc::new(vec![
            placement(1, 10.0, 10.0),
            placement(2, 12.0, 12.0),
            placement(3, 20.0, 20.0),
        ]);
        let index = PlacementSpatialIndex::new(Arc::clone(&placements), 8.0);

        let (total, items) = index.query_bounds(10.0, 10.0, 20.0, 20.0, 1);

        assert_eq!(total, 2);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].index, 1);
    }

    #[test]
    fn placement_spatial_index_handles_huge_finite_bounds() {
        let placements = Arc::new(vec![
            placement(1, 10.0, 10.0),
            placement(2, 12.0, 12.0),
            placement(3, 20.0, 20.0),
        ]);
        let index = PlacementSpatialIndex::new(Arc::clone(&placements), 8.0);

        let (total, items) =
            index.query_bounds(-1_000_000.0, -1_000_000.0, 1_000_000.0, 1_000_000.0, 10);

        assert_eq!(total, 3);
        assert_eq!(items.len(), 3);
    }

    #[test]
    fn placement_spatial_index_prefilters_matching_indices() {
        let placements = Arc::new(vec![
            placement(1, 10.0, 10.0),
            placement(2, 12.0, 12.0),
            placement(3, 20.0, 20.0),
        ]);
        let index = PlacementSpatialIndex::new(Arc::clone(&placements), 8.0);

        let matched = index.query_bounds_indices_matching(10.0, 10.0, 20.0, 20.0, |placement| {
            placement.index == 2
        });

        assert_eq!(matched, vec![1]);
        assert_eq!(index.record_at(matched[0]).unwrap().index, 2);
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
}
