use std::collections::{HashMap, HashSet};
use std::io::Cursor;
use std::path::Path;

use anyhow::Result;
use base64::prelude::BASE64_STANDARD;
use base64::Engine;
use image::{DynamicImage, GenericImageView, ImageBuffer, ImageFormat, Pixel, Rgba};
use sha2::{Digest, Sha256};

use super::terrain::{
    default_missing_tile, get_tile, rgb565_to_float, tile_height, ParsedMap, UNDERWATER_TEXNO,
};
use super::workbench::{
    MapChunkPayload, MapChunkRequest, MapOverviewLayer, MapTileTexturePreview, MapWorkbenchLayer,
};
use crate::client_paths;
use crate::item::model::decode_pko_texture;
use crate::text_encoding;

// ============================================================================
// TerrainInfo.bin parsing
// ============================================================================

const TERRAIN_ENTRY_SIZE: usize = 120;

/// Maximum atlas dimension in pixels. The per-tile resolution adapts to fit.
/// 8192 keeps JPEG size reasonable (~2-8 MB) while maximizing texture detail.
const MAX_ATLAS_DIM: u32 = 8192;
const LIVE_TEXTURE_MAX_SAMPLES_PER_TILE: i32 = 64;
const TEXTURED_OVERVIEW_DOWNSAMPLE_AXIS_SAMPLES: u32 = 2;

// MPMap::RenderSea uses D3DCOLOR_ARGB(0xcf, 140, 140, 220) once water is
// at least 0.5 native height units below sea level.
const CLIENT_SEA_TILE_SIZE: i32 = 4;
const CLIENT_SEA_LEVEL: f32 = 0.0;
const CLIENT_SEA_VISIBLE_DEPTH: f32 = 0.5;
const CLIENT_SEA_ALPHA: f32 = 0xcf as f32 / 255.0;
const CLIENT_SEA_RGB: [f32; 3] = [140.0, 140.0, 220.0];

fn div_ceil_i32(value: i32, divisor: i32) -> i32 {
    if value <= 0 {
        0
    } else {
        (value + divisor - 1) / divisor
    }
}

/// Compute pixels per tile based on map dimensions, capping the atlas at MAX_ATLAS_DIM.
fn atlas_tile_size(map_w: u32, map_h: u32) -> u32 {
    let largest = map_w.max(map_h);
    (MAX_ATLAS_DIM / largest).max(1)
}

#[derive(Debug)]
pub struct TerrainTextureInfo {
    pub id: u8,
    pub path: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct TerrainTextureSamplerCacheKey {
    pub project_id: uuid::Uuid,
    pub map_name: String,
    pub map_modified_ms: u64,
    pub map_file_len: u64,
    pub map_content_sha256: String,
    pub terrain_info_modified_ms: u64,
    pub terrain_info_file_len: u64,
    pub terrain_info_content_sha256: String,
    pub texture_asset_content_sha256: String,
}

pub struct TerrainTextureSampler {
    tex_images: HashMap<u8, DynamicImage>,
    alpha_atlas: Option<DynamicImage>,
    alpha_atlas_uses_color_mask: bool,
}

/// Parse `scripts/table/TerrainInfo.bin` to extract terrain texture entries.
/// Supported formats:
/// - 4-byte header (struct size = 120), then N × 120-byte entries.
/// - Native client raw table with N × 120-byte entries and no size header.
/// Each entry stores `nID` at offset 100. Map tiles reference terrain textures
/// by this primary ID, not by the record's array index.
pub fn parse_terrain_info(data: &[u8]) -> Result<HashMap<u8, TerrainTextureInfo>> {
    if data.len() < 4 {
        anyhow::bail!("TerrainInfo.bin too small");
    }

    let possible_struct_size = u32::from_le_bytes([data[0], data[1], data[2], data[3]]) as usize;
    let has_size_header = possible_struct_size == TERRAIN_ENTRY_SIZE
        && data
            .len()
            .checked_sub(4)
            .is_some_and(|len| len % TERRAIN_ENTRY_SIZE == 0);
    let entry_data = if has_size_header {
        &data[4..]
    } else if data.len() % TERRAIN_ENTRY_SIZE == 0 {
        data
    } else if data.len() < TERRAIN_ENTRY_SIZE {
        anyhow::bail!("TerrainInfo.bin too small");
    } else {
        anyhow::bail!(
            "TerrainInfo.bin unexpected struct size: {} (expected {})",
            possible_struct_size,
            TERRAIN_ENTRY_SIZE
        );
    };

    let mut entries = HashMap::new();
    let entry_count = entry_data.len() / TERRAIN_ENTRY_SIZE;

    for i in 0..entry_count {
        let offset = i * TERRAIN_ENTRY_SIZE;
        if offset + TERRAIN_ENTRY_SIZE > entry_data.len() {
            break;
        }

        let entry = &entry_data[offset..offset + TERRAIN_ENTRY_SIZE];

        let exists = u32::from_le_bytes([entry[0], entry[1], entry[2], entry[3]]) != 0;

        // szDataName at offset 8 (72 bytes, null-terminated)
        let name = text_encoding::decode_gbk_cstr(&entry[8..80]);

        // nID at offset 100 (4 bytes LE). This is the key passed to
        // MPTerrainSet::GetRawDataInfo by the client renderer.
        let n_id = i32::from_le_bytes([entry[100], entry[101], entry[102], entry[103]]);

        if !exists || name.is_empty() || n_id <= 0 || n_id > u8::MAX as i32 {
            continue;
        }

        let terrain_id = n_id as u8;
        entries.insert(
            terrain_id,
            TerrainTextureInfo {
                id: terrain_id,
                path: name,
            },
        );
    }

    Ok(entries)
}

pub fn terrain_texture_catalog(project_dir: &Path) -> Result<Vec<super::TerrainTextureEntry>> {
    let terrain_info_path = client_paths::table_file(project_dir, "TerrainInfo.bin");
    let terrain_info_data = std::fs::read(&terrain_info_path)
        .map_err(|e| anyhow::anyhow!("Failed to read TerrainInfo.bin: {}", e))?;
    let terrain_info = parse_terrain_info(&terrain_info_data)?;
    let mut entries: Vec<super::TerrainTextureEntry> = terrain_info
        .into_values()
        .map(|info| super::TerrainTextureEntry {
            id: info.id,
            file_name: terrain_texture_file_name(&info.path),
            preview_data_uri: None,
            path: info.path,
        })
        .collect();
    entries.sort_by_key(|entry| entry.id);
    Ok(entries)
}

fn terrain_texture_file_name(path: &str) -> String {
    path.rsplit(|character| character == '/' || character == '\\')
        .next()
        .filter(|file_name| !file_name.is_empty())
        .unwrap_or(path)
        .to_string()
}

pub fn terrain_texture_preview_data_uri(
    project_dir: &Path,
    texture_id: u8,
) -> Result<Option<String>> {
    let terrain_info_path = client_paths::table_file(project_dir, "TerrainInfo.bin");
    let terrain_info_data = std::fs::read(&terrain_info_path)
        .map_err(|e| anyhow::anyhow!("Failed to read TerrainInfo.bin: {}", e))?;
    let terrain_info = parse_terrain_info(&terrain_info_data)?;
    let Some(info) = terrain_info.get(&texture_id) else {
        return Ok(None);
    };

    Ok(terrain_texture_preview_data_uri_for_path(
        project_dir,
        &info.path,
    ))
}

fn terrain_texture_preview_data_uri_for_path(project_dir: &Path, rel_path: &str) -> Option<String> {
    let image = load_pko_image(project_dir, rel_path)?;
    let thumbnail = image.thumbnail(48, 48);
    encode_png_data_uri(&thumbnail).ok()
}

fn encode_png_data_uri(image: &DynamicImage) -> Result<String> {
    let mut png_data = Vec::new();
    image.write_to(&mut Cursor::new(&mut png_data), ImageFormat::Png)?;
    Ok(format!(
        "data:image/png;base64,{}",
        BASE64_STANDARD.encode(&png_data)
    ))
}

fn encode_rgba_png_data_uri(image: ImageBuffer<Rgba<u8>, Vec<u8>>) -> Result<String> {
    encode_png_data_uri(&DynamicImage::ImageRgba8(image))
}

fn digest_to_hex(digest: impl AsRef<[u8]>) -> String {
    let digest = digest.as_ref();
    let mut hex = String::with_capacity(digest.len() * 2);
    for byte in digest {
        use std::fmt::Write;
        let _ = write!(hex, "{byte:02x}");
    }
    hex
}

// ============================================================================
// Tile layer unpacking
// ============================================================================

#[derive(Debug, Clone, Copy)]
pub struct TileLayer {
    pub tex_id: u8,
    pub alpha: u8,
}

/// Unpack the 4 texture layers from a tile's bt_tile_info and dw_tile_info.
///
/// Layer 0 (base): tex = bt_tile_info, alpha = 15 (full)
/// Layer 1: tex = (dw_tile_info >> 26) & 0x3F, alpha = (dw_tile_info >> 22) & 0x0F
/// Layer 2: tex = (dw_tile_info >> 16) & 0x3F, alpha = (dw_tile_info >> 12) & 0x0F
/// Layer 3: tex = (dw_tile_info >> 6) & 0x3F, alpha = (dw_tile_info >> 2) & 0x0F
pub fn unpack_tile_layers(bt_tile_info: u8, dw_tile_info: u32) -> [TileLayer; 4] {
    [
        TileLayer {
            tex_id: bt_tile_info,
            alpha: 15,
        },
        TileLayer {
            tex_id: ((dw_tile_info >> 26) & 0x3F) as u8,
            alpha: ((dw_tile_info >> 22) & 0x0F) as u8,
        },
        TileLayer {
            tex_id: ((dw_tile_info >> 16) & 0x3F) as u8,
            alpha: ((dw_tile_info >> 12) & 0x0F) as u8,
        },
        TileLayer {
            tex_id: ((dw_tile_info >> 6) & 0x3F) as u8,
            alpha: ((dw_tile_info >> 2) & 0x0F) as u8,
        },
    ]
}

// ============================================================================
// Alpha mask UV lookup — matches client's AlphaNo2UV[16][2] in MPMap.cpp
// ============================================================================

/// The alpha mask atlas (total.tga) is a 4×4 grid. Each alpha ID (0-15)
/// maps to a UV offset in the atlas. The grid cell is 0.25×0.25.
const ALPHA_NO_2_UV: [[f32; 2]; 16] = [
    [0.0, 0.0],   // 0  (no mask / full)
    [0.0, 0.0],   // 1
    [0.25, 0.0],  // 2
    [0.5, 0.0],   // 3
    [0.75, 0.0],  // 4
    [0.0, 0.25],  // 5
    [0.25, 0.25], // 6
    [0.5, 0.25],  // 7
    [0.75, 0.25], // 8
    [0.0, 0.5],   // 9
    [0.25, 0.5],  // 10
    [0.5, 0.5],   // 11
    [0.75, 0.5],  // 12
    [0.0, 0.75],  // 13
    [0.25, 0.75], // 14
    [0.5, 0.75],  // 15
];

// ============================================================================
// Texture loading
// ============================================================================

/// Try to load a PKO texture file, trying both original and normalized paths.
fn read_pko_texture_bytes(project_dir: &Path, rel_path: &str) -> Option<Vec<u8>> {
    let normalized = rel_path.replace('\\', "/");
    let texture_relative_path = strip_path_prefix_case_insensitive(&normalized, "texture/")
        .or_else(|| strip_path_prefix_case_insensitive(&normalized, "Data/texture/"));
    let data_path =
        texture_relative_path.map(|path| client_paths::asset_file(project_dir, "texture", path));
    let terrain_path = (!normalized.contains('/')).then(|| {
        client_paths::asset_file(
            project_dir,
            "texture",
            Path::new("terrain").join(&normalized),
        )
    });

    data_path
        .as_ref()
        .map(std::fs::read)
        .transpose()
        .ok()
        .flatten()
        .or_else(|| std::fs::read(project_dir.join(rel_path)).ok())
        .or_else(|| std::fs::read(project_dir.join(&normalized)).ok())
        .or_else(|| {
            terrain_path
                .as_ref()
                .and_then(|path| std::fs::read(path).ok())
        })
        .or_else(|| std::fs::read(client_paths::asset_file(project_dir, "texture", rel_path)).ok())
}

fn strip_path_prefix_case_insensitive<'a>(path: &'a str, prefix: &str) -> Option<&'a str> {
    if path.len() >= prefix.len() && path[..prefix.len()].eq_ignore_ascii_case(prefix) {
        Some(&path[prefix.len()..])
    } else {
        None
    }
}

/// Try to load a PKO texture file, trying both original and normalized paths.
fn load_pko_image(project_dir: &Path, rel_path: &str) -> Option<DynamicImage> {
    let tex_data = read_pko_texture_bytes(project_dir, rel_path)?;
    let decoded = decode_pko_texture(&tex_data);
    // Try auto-detect first, then fall back to format hint from extension.
    // TGA has no magic number so load_from_memory can't auto-detect it.
    image::load_from_memory(&decoded).ok().or_else(|| {
        let ext = rel_path.rsplit('.').next()?.to_lowercase();
        let fmt = match ext.as_str() {
            "tga" => image::ImageFormat::Tga,
            "bmp" => image::ImageFormat::Bmp,
            "dds" => image::ImageFormat::Dds,
            _ => return None,
        };
        image::load_from_memory_with_format(&decoded, fmt).ok()
    })
}

/// Load terrain texture images for all referenced IDs.
fn load_terrain_images(
    project_dir: &Path,
    terrain_info: &HashMap<u8, TerrainTextureInfo>,
    referenced_ids: &HashSet<u8>,
) -> HashMap<u8, DynamicImage> {
    let mut images = HashMap::new();

    for &id in referenced_ids {
        let info = match terrain_info.get(&id) {
            Some(info) => info,
            None => continue,
        };

        if let Some(img) = load_pko_image(project_dir, &info.path) {
            images.insert(id, img);
        }
    }

    images
}

/// Load the alpha mask atlas from texture/terrain/alpha/total.tga.
fn load_alpha_atlas(project_dir: &Path) -> Option<DynamicImage> {
    load_pko_image(project_dir, "texture/terrain/alpha/total.tga")
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerrainTextureAssetReport {
    pub referenced_count: usize,
    pub loaded_count: usize,
    pub missing_count: usize,
    pub alpha_atlas_available: bool,
}

pub fn terrain_texture_asset_report(
    project_dir: &Path,
    parsed_map: &ParsedMap,
    terrain_info_data: &[u8],
) -> Result<TerrainTextureAssetReport> {
    let terrain_info = parse_terrain_info(terrain_info_data)?;
    let referenced_ids = collect_referenced_tex_ids(parsed_map);
    let loaded_count = referenced_ids
        .iter()
        .filter(|id| {
            terrain_info
                .get(id)
                .and_then(|info| load_pko_image(project_dir, &info.path))
                .is_some()
        })
        .count();
    let referenced_count = referenced_ids.len();

    Ok(TerrainTextureAssetReport {
        referenced_count,
        loaded_count,
        missing_count: referenced_count.saturating_sub(loaded_count),
        alpha_atlas_available: load_alpha_atlas(project_dir).is_some(),
    })
}

pub fn terrain_texture_asset_fingerprint(
    project_dir: &Path,
    parsed_map: &ParsedMap,
    terrain_info_data: &[u8],
) -> Result<Option<String>> {
    let terrain_info = parse_terrain_info(terrain_info_data)?;
    let referenced_ids = collect_referenced_tex_ids(parsed_map);
    if referenced_ids.is_empty() {
        return Ok(None);
    }

    let mut ids: Vec<u8> = referenced_ids.into_iter().collect();
    ids.sort_unstable();

    let mut hasher = Sha256::new();
    hasher.update(b"terrain-textures-v1");
    for id in ids {
        hasher.update([id]);
        let Some(info) = terrain_info.get(&id) else {
            hasher.update(b"missing-terrain-info-entry");
            continue;
        };
        hasher.update(info.path.as_bytes());
        if let Some(bytes) = read_pko_texture_bytes(project_dir, &info.path) {
            hasher.update(b"texture-present");
            hasher.update((bytes.len() as u64).to_le_bytes());
            hasher.update(&bytes);
        } else {
            hasher.update(b"texture-missing");
        }
    }

    if let Some(alpha_bytes) =
        read_pko_texture_bytes(project_dir, "texture/terrain/alpha/total.tga")
    {
        hasher.update(b"alpha-present");
        hasher.update((alpha_bytes.len() as u64).to_le_bytes());
        hasher.update(&alpha_bytes);
    } else {
        hasher.update(b"alpha-missing");
    }

    Ok(Some(digest_to_hex(hasher.finalize())))
}

// ============================================================================
// Texture sampling helpers
// ============================================================================

/// Sample a terrain texture at the given UV coordinate (wrapping).
/// Returns (r, g, b) as floats 0..255.
fn sample_texture(img: &DynamicImage, u: f32, v: f32) -> [f32; 3] {
    let (w, h) = img.dimensions();
    let sample = |x: i32, y: i32| -> [f32; 3] {
        let px = x.rem_euclid(w as i32) as u32;
        let py = y.rem_euclid(h as i32) as u32;
        let pixel = img.get_pixel(px, py).to_rgba();
        [pixel[0] as f32, pixel[1] as f32, pixel[2] as f32]
    };

    let u = u.rem_euclid(1.0);
    let v = v.rem_euclid(1.0);
    let x = u * w as f32 - 0.5;
    let y = v * h as f32 - 0.5;
    let x0 = x.floor() as i32;
    let y0 = y.floor() as i32;
    let x1 = x0 + 1;
    let y1 = y0 + 1;
    let wx = x - x0 as f32;
    let wy = y - y0 as f32;

    let c00 = sample(x0, y0);
    let c10 = sample(x1, y0);
    let c01 = sample(x0, y1);
    let c11 = sample(x1, y1);

    [
        c00[0] * (1.0 - wx) * (1.0 - wy)
            + c10[0] * wx * (1.0 - wy)
            + c01[0] * (1.0 - wx) * wy
            + c11[0] * wx * wy,
        c00[1] * (1.0 - wx) * (1.0 - wy)
            + c10[1] * wx * (1.0 - wy)
            + c01[1] * (1.0 - wx) * wy
            + c11[1] * wx * wy,
        c00[2] * (1.0 - wx) * (1.0 - wy)
            + c10[2] * wx * (1.0 - wy)
            + c01[2] * (1.0 - wx) * wy
            + c11[2] * wx * wy,
    ]
}

/// Sample alpha from the alpha mask atlas at a given UV.
/// Returns alpha as float 0..1.
fn sample_alpha(atlas: &DynamicImage, use_color_mask: bool, u: f32, v: f32) -> f32 {
    let (w, h) = atlas.dimensions();
    let sample = |x: i32, y: i32| -> f32 {
        let px = x.rem_euclid(w as i32) as u32;
        let py = y.rem_euclid(h as i32) as u32;
        let pixel = atlas.get_pixel(px, py).to_rgba();
        let mask = if use_color_mask { pixel[0] } else { pixel[3] };
        mask as f32 / 255.0
    };

    let u = u.rem_euclid(1.0);
    let v = v.rem_euclid(1.0);
    let x = u * w as f32 - 0.5;
    let y = v * h as f32 - 0.5;
    let x0 = x.floor() as i32;
    let y0 = y.floor() as i32;
    let x1 = x0 + 1;
    let y1 = y0 + 1;
    let wx = x - x0 as f32;
    let wy = y - y0 as f32;

    let a00 = sample(x0, y0);
    let a10 = sample(x1, y0);
    let a01 = sample(x0, y1);
    let a11 = sample(x1, y1);

    a00 * (1.0 - wx) * (1.0 - wy) + a10 * wx * (1.0 - wy) + a01 * (1.0 - wx) * wy + a11 * wx * wy
}

fn alpha_atlas_uses_color_mask(atlas: &DynamicImage) -> bool {
    let (w, h) = atlas.dimensions();
    for y in 0..h {
        for x in 0..w {
            if atlas.get_pixel(x, y).to_rgba()[3] != 255 {
                return false;
            }
        }
    }
    true
}

fn vertex_color(map: &ParsedMap, vx: i32, vy: i32) -> [f32; 3] {
    let default_tile;
    let tile = match get_tile(map, vx, vy) {
        Some(tile) => tile,
        None => {
            default_tile = default_missing_tile();
            &default_tile
        }
    };
    let (r, g, b) = rgb565_to_float(tile.s_color);
    [r, g, b]
}

fn sample_vertex_color(
    map: &ParsedMap,
    tile_x: i32,
    tile_y: i32,
    sub_u: f32,
    sub_v: f32,
) -> [f32; 3] {
    let u = sub_u.clamp(0.0, 1.0);
    let v = sub_v.clamp(0.0, 1.0);
    let c00 = vertex_color(map, tile_x, tile_y);
    let c10 = vertex_color(map, tile_x + 1, tile_y);
    let c01 = vertex_color(map, tile_x, tile_y + 1);
    let c11 = vertex_color(map, tile_x + 1, tile_y + 1);

    if u + v <= 1.0 {
        [
            c00[0] * (1.0 - u - v) + c10[0] * u + c01[0] * v,
            c00[1] * (1.0 - u - v) + c10[1] * u + c01[1] * v,
            c00[2] * (1.0 - u - v) + c10[2] * u + c01[2] * v,
        ]
    } else {
        [
            c10[0] * (1.0 - v) + c01[0] * (1.0 - u) + c11[0] * (u + v - 1.0),
            c10[1] * (1.0 - v) + c01[1] * (1.0 - u) + c11[1] * (u + v - 1.0),
            c10[2] * (1.0 - v) + c01[2] * (1.0 - u) + c11[2] * (u + v - 1.0),
        ]
    }
}

fn modulate_rgb(rgb: [u8; 3], tint: [f32; 3]) -> [u8; 3] {
    [
        (rgb[0] as f32 * tint[0]).round().clamp(0.0, 255.0) as u8,
        (rgb[1] as f32 * tint[1]).round().clamp(0.0, 255.0) as u8,
        (rgb[2] as f32 * tint[2]).round().clamp(0.0, 255.0) as u8,
    ]
}

fn apply_client_sea_tint(rgb: [u8; 3], alpha: f32) -> [u8; 3] {
    let alpha = alpha.clamp(0.0, CLIENT_SEA_ALPHA);
    if alpha <= f32::EPSILON {
        return rgb;
    }

    let keep = 1.0 - alpha;
    [
        (rgb[0] as f32 * keep + CLIENT_SEA_RGB[0] * alpha)
            .round()
            .clamp(0.0, 255.0) as u8,
        (rgb[1] as f32 * keep + CLIENT_SEA_RGB[1] * alpha)
            .round()
            .clamp(0.0, 255.0) as u8,
        (rgb[2] as f32 * keep + CLIENT_SEA_RGB[2] * alpha)
            .round()
            .clamp(0.0, 255.0) as u8,
    ]
}

fn client_sea_visible_at_height(height: f32) -> bool {
    CLIENT_SEA_LEVEL - height >= CLIENT_SEA_VISIBLE_DEPTH
}

fn client_sea_vertex_alpha(map: &ParsedMap, vx: i32, vy: i32) -> f32 {
    let default_tile;
    let tile = match get_tile(map, vx, vy) {
        Some(tile) => tile,
        None => {
            default_tile = default_missing_tile();
            &default_tile
        }
    };

    if client_sea_visible_at_height(tile_height(tile)) {
        CLIENT_SEA_ALPHA
    } else {
        0.0
    }
}

fn sample_client_sea_alpha(
    map: &ParsedMap,
    tile_x: i32,
    tile_y: i32,
    sub_u: f32,
    sub_v: f32,
) -> f32 {
    let sea_tile_size = CLIENT_SEA_TILE_SIZE as f32;
    let world_x = tile_x as f32 + sub_u.clamp(0.0, 1.0);
    let world_y = tile_y as f32 + sub_v.clamp(0.0, 1.0);
    let sea_x = (world_x / sea_tile_size).floor() as i32 * CLIENT_SEA_TILE_SIZE;
    let sea_y = (world_y / sea_tile_size).floor() as i32 * CLIENT_SEA_TILE_SIZE;
    let u = ((world_x - sea_x as f32) / sea_tile_size).clamp(0.0, 1.0);
    let v = ((world_y - sea_y as f32) / sea_tile_size).clamp(0.0, 1.0);

    let a00 = client_sea_vertex_alpha(map, sea_x, sea_y);
    let a10 = client_sea_vertex_alpha(map, sea_x + CLIENT_SEA_TILE_SIZE, sea_y);
    let a01 = client_sea_vertex_alpha(map, sea_x, sea_y + CLIENT_SEA_TILE_SIZE);
    let a11 = client_sea_vertex_alpha(
        map,
        sea_x + CLIENT_SEA_TILE_SIZE,
        sea_y + CLIENT_SEA_TILE_SIZE,
    );

    if u + v <= 1.0 {
        a00 * (1.0 - u - v) + a10 * u + a01 * v
    } else {
        a10 * (1.0 - v) + a01 * (1.0 - u) + a11 * (u + v - 1.0)
    }
}

impl TerrainTextureSampler {
    pub fn loaded_texture_count(&self) -> usize {
        self.tex_images.len()
    }

    pub fn alpha_atlas_available(&self) -> bool {
        self.alpha_atlas.is_some()
    }

    pub fn load_for_map(
        project_dir: &Path,
        parsed_map: &ParsedMap,
        terrain_info_data: &[u8],
    ) -> Result<Option<Self>> {
        let terrain_info = parse_terrain_info(terrain_info_data)?;
        let referenced_ids = collect_referenced_tex_ids(parsed_map);
        if referenced_ids.is_empty() {
            return Ok(None);
        }

        let tex_images = load_terrain_images(project_dir, &terrain_info, &referenced_ids);
        if tex_images.is_empty() {
            return Ok(None);
        }

        let alpha_atlas = load_alpha_atlas(project_dir);
        let use_alpha_color_mask = alpha_atlas
            .as_ref()
            .map_or(false, alpha_atlas_uses_color_mask);

        Ok(Some(Self {
            tex_images,
            alpha_atlas,
            alpha_atlas_uses_color_mask: use_alpha_color_mask,
        }))
    }

    pub fn sample_map_rgb(
        &self,
        parsed_map: &ParsedMap,
        tile_x: i32,
        tile_y: i32,
        sub_u: f32,
        sub_v: f32,
    ) -> Option<[u8; 3]> {
        let default_tile;
        let tile = match get_tile(parsed_map, tile_x, tile_y) {
            Some(tile) => tile,
            None => {
                default_tile = default_missing_tile();
                &default_tile
            }
        };
        let layers = unpack_tile_layers(tile.bt_tile_info, tile.dw_tile_info);
        let sea_alpha = sample_client_sea_alpha(parsed_map, tile_x, tile_y, sub_u, sub_v);
        self.sample_layers_rgb(&layers, tile_x, tile_y, sub_u, sub_v)
            .map(|rgb| {
                apply_client_sea_tint(
                    modulate_rgb(
                        rgb,
                        sample_vertex_color(parsed_map, tile_x, tile_y, sub_u, sub_v),
                    ),
                    sea_alpha,
                )
            })
            .or_else(|| {
                (sea_alpha > 0.0).then(|| apply_client_sea_tint([120, 120, 120], sea_alpha))
            })
    }

    pub fn sample_map_rgb_raw(
        &self,
        parsed_map: &ParsedMap,
        tile_x: i32,
        tile_y: i32,
        sub_u: f32,
        sub_v: f32,
    ) -> Option<[u8; 3]> {
        let default_tile;
        let tile = match get_tile(parsed_map, tile_x, tile_y) {
            Some(tile) => tile,
            None => {
                default_tile = default_missing_tile();
                &default_tile
            }
        };
        let layers = unpack_tile_layers(tile.bt_tile_info, tile.dw_tile_info);
        self.sample_layers_rgb(&layers, tile_x, tile_y, sub_u, sub_v)
    }

    fn sample_map_rgb_for_layer(
        &self,
        parsed_map: &ParsedMap,
        tile_x: i32,
        tile_y: i32,
        sub_u: f32,
        sub_v: f32,
        layer: MapWorkbenchLayer,
    ) -> Option<[u8; 3]> {
        match layer {
            MapWorkbenchLayer::TextureRaw => {
                self.sample_map_rgb_raw(parsed_map, tile_x, tile_y, sub_u, sub_v)
            }
            _ => self.sample_map_rgb(parsed_map, tile_x, tile_y, sub_u, sub_v),
        }
    }

    fn sample_layers_rgb(
        &self,
        layers: &[TileLayer; 4],
        tile_x: i32,
        tile_y: i32,
        sub_u: f32,
        sub_v: f32,
    ) -> Option<[u8; 3]> {
        let tex_u_base = tile_x.rem_euclid(4) as f32 * 0.25;
        let tex_v_base = tile_y.rem_euclid(4) as f32 * 0.25;
        let tex_u = tex_u_base + sub_u.clamp(0.0, 1.0) * 0.25;
        let tex_v = tex_v_base + sub_v.clamp(0.0, 1.0) * 0.25;
        let mut r = 0.0f32;
        let mut g = 0.0f32;
        let mut b = 0.0f32;
        let mut sampled = false;

        for (layer_idx, layer) in layers.iter().enumerate() {
            if layer_idx > 0 && (layer.alpha == 0 || layer.tex_id == 0) {
                break;
            }
            if layer.alpha == 0 {
                continue;
            }
            let Some(tex_img) = self.tex_images.get(&layer.tex_id) else {
                continue;
            };
            let color = sample_texture(tex_img, tex_u, tex_v);

            if layer_idx == 0 {
                r = color[0];
                g = color[1];
                b = color[2];
                sampled = true;
                continue;
            }

            let blend = if layer.alpha == 15 {
                1.0
            } else if let Some(alpha_img) = self.alpha_atlas.as_ref() {
                let alpha_id = layer.alpha as usize;
                if alpha_id > 0 {
                    let [au, av] = client_alpha_mask_uv(alpha_id, sub_u, sub_v);
                    sample_alpha(alpha_img, self.alpha_atlas_uses_color_mask, au, av)
                } else {
                    1.0
                }
            } else {
                0.5
            };

            r = r * (1.0 - blend) + color[0] * blend;
            g = g * (1.0 - blend) + color[1] * blend;
            b = b * (1.0 - blend) + color[2] * blend;
            sampled = true;
        }

        sampled.then(|| {
            [
                r.round().clamp(0.0, 255.0) as u8,
                g.round().clamp(0.0, 255.0) as u8,
                b.round().clamp(0.0, 255.0) as u8,
            ]
        })
    }
}

pub fn build_textured_overview_layer(
    map: &ParsedMap,
    sampler: &TerrainTextureSampler,
    layer: MapWorkbenchLayer,
    max_size: u32,
) -> Result<MapOverviewLayer> {
    let max_size = max_size.clamp(16, 4096);
    let map_w = map.header.n_width.max(1) as u32;
    let map_h = map.header.n_height.max(1) as u32;
    let scale = (max_size as f32 / map_w.max(map_h) as f32).min(1.0);
    let sample_width = ((map_w as f32 * scale).ceil() as u32).max(1);
    let sample_height = ((map_h as f32 * scale).ceil() as u32).max(1);
    let mut image = ImageBuffer::<Rgba<u8>, Vec<u8>>::new(sample_width, sample_height);

    for py in 0..sample_height {
        for px in 0..sample_width {
            let [r, g, b] = sample_textured_overview_pixel(
                map,
                sampler,
                layer,
                map_w,
                map_h,
                sample_width,
                sample_height,
                px,
                py,
            );
            image.put_pixel(px, py, Rgba([r, g, b, 255]));
        }
    }

    Ok(MapOverviewLayer {
        layer,
        map_width: map.header.n_width,
        map_height: map.header.n_height,
        sample_width,
        sample_height,
        image_data_uri: encode_rgba_png_data_uri(image)?,
    })
}

fn sample_textured_overview_pixel(
    map: &ParsedMap,
    sampler: &TerrainTextureSampler,
    layer: MapWorkbenchLayer,
    map_w: u32,
    map_h: u32,
    sample_width: u32,
    sample_height: u32,
    px: u32,
    py: u32,
) -> [u8; 3] {
    let x0 = px as f32 / sample_width as f32 * map_w as f32;
    let x1 = (px + 1) as f32 / sample_width as f32 * map_w as f32;
    let y0 = py as f32 / sample_height as f32 * map_h as f32;
    let y1 = (py + 1) as f32 / sample_height as f32 * map_h as f32;
    let samples_x = if x1 - x0 > 1.0 {
        TEXTURED_OVERVIEW_DOWNSAMPLE_AXIS_SAMPLES
    } else {
        1
    };
    let samples_y = if y1 - y0 > 1.0 {
        TEXTURED_OVERVIEW_DOWNSAMPLE_AXIS_SAMPLES
    } else {
        1
    };
    let mut r = 0.0f32;
    let mut g = 0.0f32;
    let mut b = 0.0f32;
    let mut count = 0.0f32;

    for sy in 0..samples_y {
        for sx in 0..samples_x {
            let map_x = x0 + ((sx as f32 + 0.5) / samples_x as f32) * (x1 - x0);
            let map_y = y0 + ((sy as f32 + 0.5) / samples_y as f32) * (y1 - y0);
            let tx = map_x.floor().clamp(0.0, (map_w - 1) as f32) as i32;
            let ty = map_y.floor().clamp(0.0, (map_h - 1) as f32) as i32;
            let sub_u = map_x.fract();
            let sub_v = map_y.fract();
            let [sr, sg, sb] = sampler
                .sample_map_rgb_for_layer(map, tx, ty, sub_u, sub_v, layer)
                .unwrap_or([120, 120, 120]);
            r += sr as f32;
            g += sg as f32;
            b += sb as f32;
            count += 1.0;
        }
    }

    [
        (r / count).round().clamp(0.0, 255.0) as u8,
        (g / count).round().clamp(0.0, 255.0) as u8,
        (b / count).round().clamp(0.0, 255.0) as u8,
    ]
}

pub fn build_textured_chunk_payload(
    map: &ParsedMap,
    sampler: &TerrainTextureSampler,
    request: MapChunkRequest,
    chunk_size: i32,
) -> Result<MapChunkPayload> {
    if chunk_size <= 0 {
        anyhow::bail!("Chunk size must be positive");
    }

    let chunk_count_x = div_ceil_i32(map.header.n_width, chunk_size);
    let chunk_count_y = div_ceil_i32(map.header.n_height, chunk_size);
    if request.chunk_x < 0
        || request.chunk_y < 0
        || request.chunk_x >= chunk_count_x
        || request.chunk_y >= chunk_count_y
    {
        anyhow::bail!(
            "Invalid chunk ({}, {}) for {} x {} chunk map",
            request.chunk_x,
            request.chunk_y,
            chunk_count_x,
            chunk_count_y
        );
    }

    let tile_x = request.chunk_x * chunk_size;
    let tile_y = request.chunk_y * chunk_size;
    let tile_width = (map.header.n_width - tile_x).min(chunk_size);
    let tile_height = (map.header.n_height - tile_y).min(chunk_size);
    let samples_per_tile = live_texture_samples_per_tile(request.zoom_bucket);
    let sample_width = (tile_width * samples_per_tile) as u32;
    let sample_height = (tile_height * samples_per_tile) as u32;
    let mut image = ImageBuffer::<Rgba<u8>, Vec<u8>>::new(sample_width, sample_height);

    for local_tile_y in 0..tile_height {
        for local_tile_x in 0..tile_width {
            let tx = tile_x + local_tile_x;
            let ty = tile_y + local_tile_y;
            for sample_y in 0..samples_per_tile {
                for sample_x in 0..samples_per_tile {
                    let sub_u = (sample_x as f32 + 0.5) / samples_per_tile as f32;
                    let sub_v = (sample_y as f32 + 0.5) / samples_per_tile as f32;
                    let [r, g, b] = sampler
                        .sample_map_rgb_for_layer(map, tx, ty, sub_u, sub_v, request.layer)
                        .unwrap_or([120, 120, 120]);
                    image.put_pixel(
                        (local_tile_x * samples_per_tile + sample_x) as u32,
                        (local_tile_y * samples_per_tile + sample_y) as u32,
                        Rgba([r, g, b, 255]),
                    );
                }
            }
        }
    }

    Ok(MapChunkPayload {
        chunk_x: request.chunk_x,
        chunk_y: request.chunk_y,
        layer: request.layer,
        tile_x,
        tile_y,
        tile_width,
        tile_height,
        sample_width,
        sample_height,
        image_data_uri: encode_rgba_png_data_uri(image)?,
        numeric_format: None,
        numeric_payload: None,
    })
}

pub fn build_tile_texture_preview(
    map: &ParsedMap,
    sampler: &TerrainTextureSampler,
    tile_x: i32,
    tile_y: i32,
    samples_per_axis: i32,
) -> Result<MapTileTexturePreview> {
    if tile_x < 0 || tile_y < 0 || tile_x >= map.header.n_width || tile_y >= map.header.n_height {
        anyhow::bail!(
            "Invalid tile coordinates ({tile_x}, {tile_y}) for {} x {} map",
            map.header.n_width,
            map.header.n_height
        );
    }

    let samples_per_axis = samples_per_axis.clamp(1, 64) as u32;
    let mut raw_image = ImageBuffer::<Rgba<u8>, Vec<u8>>::new(samples_per_axis, samples_per_axis);
    let mut client_image =
        ImageBuffer::<Rgba<u8>, Vec<u8>>::new(samples_per_axis, samples_per_axis);

    for sample_y in 0..samples_per_axis {
        for sample_x in 0..samples_per_axis {
            let sub_u = (sample_x as f32 + 0.5) / samples_per_axis as f32;
            let sub_v = (sample_y as f32 + 0.5) / samples_per_axis as f32;
            let raw_rgb = sampler
                .sample_map_rgb_raw(map, tile_x, tile_y, sub_u, sub_v)
                .unwrap_or([120, 120, 120]);
            let client_rgb = sampler
                .sample_map_rgb(map, tile_x, tile_y, sub_u, sub_v)
                .unwrap_or([120, 120, 120]);
            raw_image.put_pixel(
                sample_x,
                sample_y,
                Rgba([raw_rgb[0], raw_rgb[1], raw_rgb[2], 255]),
            );
            client_image.put_pixel(
                sample_x,
                sample_y,
                Rgba([client_rgb[0], client_rgb[1], client_rgb[2], 255]),
            );
        }
    }

    Ok(MapTileTexturePreview {
        tile_x,
        tile_y,
        sample_width: samples_per_axis,
        sample_height: samples_per_axis,
        raw_image_data_uri: encode_rgba_png_data_uri(raw_image)?,
        client_image_data_uri: encode_rgba_png_data_uri(client_image)?,
    })
}

fn live_texture_samples_per_tile(zoom_bucket: u8) -> i32 {
    match zoom_bucket {
        0 => 1,
        1 => 2,
        2 => 4,
        3 => 8,
        4 => 16,
        5 => 32,
        _ => LIVE_TEXTURE_MAX_SAMPLES_PER_TILE,
    }
}

fn client_alpha_mask_uv(alpha_id: usize, sub_u: f32, sub_v: f32) -> [f32; 2] {
    const CLIENT_ALPHA_EDGE_INSET: f32 = 0.01;
    const CLIENT_ALPHA_CELL_SIZE: f32 = 0.25;

    let alpha_id = alpha_id.min(ALPHA_NO_2_UV.len() - 1);
    let u = sub_u.clamp(0.0, 1.0);
    let v = sub_v.clamp(0.0, 1.0);
    let cell_span = CLIENT_ALPHA_CELL_SIZE - (CLIENT_ALPHA_EDGE_INSET * 2.0);

    [
        ALPHA_NO_2_UV[alpha_id][0] + CLIENT_ALPHA_EDGE_INSET + u * cell_span,
        ALPHA_NO_2_UV[alpha_id][1] + CLIENT_ALPHA_EDGE_INSET + v * cell_span,
    ]
}

// ============================================================================
// Atlas baking — high resolution with actual texture sampling
// ============================================================================

/// Bake a terrain texture atlas with actual texture sampling.
///
/// Each tile gets tile_sz × tile_sz pixels, sampled from
/// the real terrain textures using the game's 4×4 repeating UV pattern.
/// Layers are composited using the alpha mask atlas (total.tga).
pub fn bake_terrain_atlas(
    parsed_map: &ParsedMap,
    tex_images: &HashMap<u8, DynamicImage>,
    alpha_atlas: Option<&DynamicImage>,
) -> image::RgbImage {
    let map_w = parsed_map.header.n_width as u32;
    let map_h = parsed_map.header.n_height as u32;
    let tile_sz = atlas_tile_size(map_w, map_h);
    let atlas_w = map_w * tile_sz;
    let atlas_h = map_h * tile_sz;
    let use_alpha_color_mask = alpha_atlas.map_or(false, alpha_atlas_uses_color_mask);

    let mut atlas = image::RgbImage::new(atlas_w, atlas_h);

    for ty in 0..map_h {
        for tx in 0..map_w {
            let layers = match super::terrain::get_tile(parsed_map, tx as i32, ty as i32) {
                Some(tile) => unpack_tile_layers(tile.bt_tile_info, tile.dw_tile_info),
                // Match original client default tile for missing sections.
                None => [
                    TileLayer {
                        tex_id: UNDERWATER_TEXNO,
                        alpha: 15,
                    },
                    TileLayer {
                        tex_id: 0,
                        alpha: 0,
                    },
                    TileLayer {
                        tex_id: 0,
                        alpha: 0,
                    },
                    TileLayer {
                        tex_id: 0,
                        alpha: 0,
                    },
                ],
            };

            // Game UV base for this tile: (tile_x % 4) * 0.25, (tile_y % 4) * 0.25
            let tex_u_base = (tx % 4) as f32 * 0.25;
            let tex_v_base = (ty % 4) as f32 * 0.25;

            for py in 0..tile_sz {
                for px in 0..tile_sz {
                    // Sub-tile position (0..1 within the tile)
                    let sub_u = (px as f32 + 0.5) / tile_sz as f32;
                    let sub_v = (py as f32 + 0.5) / tile_sz as f32;

                    // Terrain texture UV for this pixel
                    let tex_u = tex_u_base + sub_u * 0.25;
                    let tex_v = tex_v_base + sub_v * 0.25;

                    // Composite layers
                    let mut r: f32 = 0.0;
                    let mut g: f32 = 0.0;
                    let mut b: f32 = 0.0;

                    for (layer_idx, layer) in layers.iter().enumerate() {
                        if layer.alpha == 0 {
                            continue;
                        }

                        let tex_img = match tex_images.get(&layer.tex_id) {
                            Some(img) => img,
                            None => continue,
                        };

                        let color = sample_texture(tex_img, tex_u, tex_v);

                        if layer_idx == 0 {
                            // Base layer: full opacity, replace
                            r = color[0];
                            g = color[1];
                            b = color[2];
                        } else {
                            // Overlay layer: blend using alpha mask
                            let blend = if layer.alpha == 15 {
                                1.0
                            } else if let Some(alpha_img) = alpha_atlas {
                                let alpha_id = layer.alpha as usize;
                                if alpha_id > 0 {
                                    let [au, av] = client_alpha_mask_uv(alpha_id, sub_u, sub_v);
                                    sample_alpha(alpha_img, use_alpha_color_mask, au, av)
                                } else {
                                    // alpha_id 0: no mask in native data.
                                    1.0
                                }
                            } else {
                                // No alpha atlas: approximate
                                if layer.alpha == 15 {
                                    1.0
                                } else {
                                    0.5
                                }
                            };

                            r = r * (1.0 - blend) + color[0] * blend;
                            g = g * (1.0 - blend) + color[1] * blend;
                            b = b * (1.0 - blend) + color[2] * blend;
                        }
                    }

                    atlas.put_pixel(
                        tx * tile_sz + px,
                        ty * tile_sz + py,
                        image::Rgb([r as u8, g as u8, b as u8]),
                    );
                }
            }
        }
    }

    atlas
}

/// Collect all texture IDs referenced by tiles in the map.
pub fn collect_referenced_tex_ids(parsed_map: &ParsedMap) -> HashSet<u8> {
    let mut ids = HashSet::new();
    let mut has_missing_sections = false;

    for section in &parsed_map.sections {
        if let Some(section) = section {
            for tile in &section.tiles {
                let layers = unpack_tile_layers(tile.bt_tile_info, tile.dw_tile_info);
                for layer in &layers {
                    if layer.alpha > 0 && layer.tex_id > 0 {
                        ids.insert(layer.tex_id);
                    }
                }
            }
        } else {
            has_missing_sections = true;
        }
    }

    // Original client renders missing sections using a default underwater tile.
    if has_missing_sections {
        ids.insert(UNDERWATER_TEXNO);
    }

    ids
}

/// Attempt to load TerrainInfo.bin, load referenced textures, and bake an atlas.
/// Returns None if TerrainInfo.bin is missing or textures can't be loaded.
pub fn try_bake_atlas(project_dir: &Path, parsed_map: &ParsedMap) -> Option<image::RgbImage> {
    let terrain_info_path = client_paths::table_file(project_dir, "TerrainInfo.bin");

    let terrain_info_data = std::fs::read(&terrain_info_path).ok()?;
    let terrain_info = parse_terrain_info(&terrain_info_data).ok()?;

    let referenced_ids = collect_referenced_tex_ids(parsed_map);
    if referenced_ids.is_empty() {
        return None;
    }

    let tex_images = load_terrain_images(project_dir, &terrain_info, &referenced_ids);
    if tex_images.is_empty() {
        return None;
    }

    let alpha_atlas = load_alpha_atlas(project_dir);

    Some(bake_terrain_atlas(
        parsed_map,
        &tex_images,
        alpha_atlas.as_ref(),
    ))
}

// ============================================================================
// Phase E: Individual terrain texture + alpha atlas export
// ============================================================================

/// Export individual terrain textures as 256×256 PNGs to `output_dir/terrain_textures/`.
/// Returns a map of texture_id → relative path (e.g. "terrain_textures/terrain_5.png").
/// Only exports textures that are actually referenced by the map.
pub fn export_terrain_textures(
    project_dir: &Path,
    parsed_map: &ParsedMap,
    output_dir: &Path,
) -> Result<HashMap<u8, String>> {
    let terrain_info_path = client_paths::table_file(project_dir, "TerrainInfo.bin");

    let terrain_info_data = std::fs::read(&terrain_info_path)
        .map_err(|e| anyhow::anyhow!("Failed to read TerrainInfo.bin: {}", e))?;
    let terrain_info = parse_terrain_info(&terrain_info_data)?;

    let referenced_ids = collect_referenced_tex_ids(parsed_map);
    if referenced_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let tex_dir = output_dir.join("terrain_textures");
    std::fs::create_dir_all(&tex_dir)?;

    let mut exported = HashMap::new();

    for &id in &referenced_ids {
        let info = match terrain_info.get(&id) {
            Some(info) => info,
            None => continue,
        };

        if let Some(img) = load_pko_image(project_dir, &info.path) {
            // Resize to 256×256 for consistency
            let resized = img.resize_exact(256, 256, image::imageops::FilterType::Lanczos3);
            let png_name = format!("terrain_{}.png", id);
            let png_path = tex_dir.join(&png_name);
            resized
                .save(&png_path)
                .map_err(|e| anyhow::anyhow!("Failed to save terrain texture {}: {}", id, e))?;
            exported.insert(id, format!("terrain_textures/{}", png_name));
        }
    }

    eprintln!(
        "Exported {}/{} terrain textures ({} referenced)",
        exported.len(),
        terrain_info.len(),
        referenced_ids.len()
    );

    Ok(exported)
}

/// Export ALL terrain textures from TerrainInfo.bin as 256×256 PNGs to `output_dir/terrain_textures/`.
/// Unlike `export_terrain_textures()`, this exports every entry in the tileset catalog,
/// not just textures referenced by a specific map. Used by the shared export.
/// Returns a map of texture_id → relative path (e.g. "terrain_textures/terrain_5.png").
pub fn export_all_terrain_textures(
    project_dir: &Path,
    output_dir: &Path,
) -> Result<HashMap<u8, String>> {
    let terrain_info_path = client_paths::table_file(project_dir, "TerrainInfo.bin");

    let terrain_info_data = std::fs::read(&terrain_info_path)
        .map_err(|e| anyhow::anyhow!("Failed to read TerrainInfo.bin: {}", e))?;
    let terrain_info = parse_terrain_info(&terrain_info_data)?;

    let tex_dir = output_dir.join("terrain_textures");
    std::fs::create_dir_all(&tex_dir)?;

    let mut exported = HashMap::new();

    for (id, info) in &terrain_info {
        if let Some(img) = load_pko_image(project_dir, &info.path) {
            let resized = img.resize_exact(256, 256, image::imageops::FilterType::Lanczos3);
            let png_name = format!("terrain_{}.png", id);
            let png_path = tex_dir.join(&png_name);
            resized
                .save(&png_path)
                .map_err(|e| anyhow::anyhow!("Failed to save terrain texture {}: {}", id, e))?;
            exported.insert(*id, format!("terrain_textures/{}", png_name));
        } else {
            eprintln!(
                "Warning: could not load terrain texture {} (path: {})",
                id, info.path
            );
        }
    }

    eprintln!(
        "Exported {}/{} terrain textures (all entries from TerrainInfo.bin)",
        exported.len(),
        terrain_info.len()
    );

    Ok(exported)
}

/// Export the alpha mask atlas (total.tga) as a PNG to `output_dir/terrain_textures/alpha_atlas.png`.
/// Returns the relative path if successful.
pub fn export_alpha_atlas(project_dir: &Path, output_dir: &Path) -> Result<Option<String>> {
    let atlas = match load_alpha_atlas(project_dir) {
        Some(img) => img,
        None => {
            eprintln!("Warning: alpha mask atlas (total.tga) not found — blending will degrade to hard steps");
            return Ok(None);
        }
    };

    let tex_dir = output_dir.join("terrain_textures");
    std::fs::create_dir_all(&tex_dir)?;

    let png_path = tex_dir.join("alpha_atlas.png");
    atlas
        .save(&png_path)
        .map_err(|e| anyhow::anyhow!("Failed to save alpha atlas: {}", e))?;

    Ok(Some("terrain_textures/alpha_atlas.png".to_string()))
}

/// Export the alpha mask atlas as 16 individual 64x64 PNG slices to
/// `output_dir/terrain_textures/alpha_mask_N.png`.
/// Each slice is V-flipped (DirectX top-left origin → Unity bottom-left origin).
/// Returns a vec of 16 relative paths if successful.
pub fn export_alpha_mask_array(
    project_dir: &Path,
    output_dir: &Path,
) -> Result<Option<Vec<String>>> {
    let atlas = match load_alpha_atlas(project_dir) {
        Some(img) => img,
        None => {
            eprintln!("Warning: alpha mask atlas (total.tga) not found — cannot export mask array");
            return Ok(None);
        }
    };

    let (aw, ah) = atlas.dimensions();
    if aw != 256 || ah != 256 {
        anyhow::bail!(
            "Alpha atlas unexpected size: {}x{} (expected 256x256)",
            aw,
            ah
        );
    }

    let tex_dir = output_dir.join("terrain_textures");
    std::fs::create_dir_all(&tex_dir)?;

    let cell_size: u32 = 64;
    let mut paths = Vec::with_capacity(16);

    for id in 0u32..16 {
        // Locate the cell in the atlas using ALPHA_NO_2_UV (DirectX convention, Y=0 at top)
        let uv = ALPHA_NO_2_UV[id as usize];
        let cell_x = (uv[0] * aw as f32) as u32; // pixel X origin
        let cell_y = (uv[1] * ah as f32) as u32; // pixel Y origin (DX: top-down)

        // Crop the 64x64 cell
        let cell = atlas.crop_imm(cell_x, cell_y, cell_size, cell_size);

        // V-flip for Unity (bottom-left origin)
        let flipped = image::imageops::flip_vertical(&cell.to_rgba8());

        let png_name = format!("alpha_mask_{}.png", id);
        let png_path = tex_dir.join(&png_name);
        flipped
            .save(&png_path)
            .map_err(|e| anyhow::anyhow!("Failed to save alpha mask slice {}: {}", id, e))?;

        paths.push(format!("terrain_textures/{}", png_name));
    }

    eprintln!("Exported 16 alpha mask slices (64x64 each, V-flipped for Unity)");
    Ok(Some(paths))
}

/// Build tile layer grid: 8 bytes per tile encoding all 4 texture layers + existence flag.
/// Format per tile: [base_tex, L1_tex, L1_alpha, L2_tex, L2_alpha, L3_tex, L3_alpha]
/// Row-major order (Y outer, X inner), same as other grids.
pub fn build_tile_layer_grid(parsed_map: &ParsedMap) -> Vec<u8> {
    let w = parsed_map.header.n_width;
    let h = parsed_map.header.n_height;
    let mut grid = Vec::with_capacity((w * h * 8) as usize);

    for ty in 0..h {
        for tx in 0..w {
            let (layers, exists) = match super::terrain::get_tile(parsed_map, tx, ty) {
                Some(tile) => (
                    unpack_tile_layers(tile.bt_tile_info, tile.dw_tile_info),
                    1u8,
                ),
                // Missing section: no data in .map file. The original engine returns
                // _pDefaultTile (btTexNo=22, height=-2.0) at runtime. We write zeros
                // for the layer data and exists=0 so Unity can apply the fallback.
                None => (
                    [
                        TileLayer {
                            tex_id: 0,
                            alpha: 0,
                        },
                        TileLayer {
                            tex_id: 0,
                            alpha: 0,
                        },
                        TileLayer {
                            tex_id: 0,
                            alpha: 0,
                        },
                        TileLayer {
                            tex_id: 0,
                            alpha: 0,
                        },
                    ],
                    0u8,
                ),
            };

            // 8 bytes: base_tex, L1_tex, L1_alpha, L2_tex, L2_alpha, L3_tex, L3_alpha, exists
            grid.push(layers[0].tex_id);
            grid.push(layers[1].tex_id);
            grid.push(layers[1].alpha);
            grid.push(layers[2].tex_id);
            grid.push(layers[2].alpha);
            grid.push(layers[3].tex_id);
            grid.push(layers[3].alpha);
            grid.push(exists);
        }
    }

    grid
}

/// Get the ALPHA_NO_2_UV table (needed by Unity for shader constants).
/// Returns the 16-entry UV lookup table as an array of [u, v] pairs.
pub fn get_alpha_uv_table() -> &'static [[f32; 2]; 16] {
    &ALPHA_NO_2_UV
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::map::terrain::{MapHeader, MapSection, MapTile};

    fn make_tile(bt_tile_info: u8, dw_tile_info: u32) -> MapTile {
        MapTile {
            dw_tile_info,
            bt_tile_info,
            s_color: -1,
            c_height: 0,
            s_region: 0,
            bt_island: 0,
            bt_block: [0; 4],
        }
    }

    fn one_tile_map(texture_id: u8) -> ParsedMap {
        one_tile_map_with_color(texture_id, -1)
    }

    fn one_tile_map_with_color(texture_id: u8, s_color: i16) -> ParsedMap {
        let mut tile = make_tile(texture_id, 0);
        tile.s_color = s_color;

        ParsedMap {
            header: MapHeader {
                n_map_flag: 780627,
                n_width: 1,
                n_height: 1,
                n_section_width: 1,
                n_section_height: 1,
            },
            section_cnt_x: 1,
            section_cnt_y: 1,
            section_offsets: vec![20],
            sections: vec![Some(MapSection { tiles: vec![tile] })],
        }
    }

    fn solid_color_map(width: i32, height: i32, texture_id: u8, s_color: i16) -> ParsedMap {
        solid_color_map_with_height(width, height, texture_id, s_color, 0)
    }

    fn solid_color_map_with_height(
        width: i32,
        height: i32,
        texture_id: u8,
        s_color: i16,
        c_height: i8,
    ) -> ParsedMap {
        let mut tile = make_tile(texture_id, 0);
        tile.s_color = s_color;
        tile.c_height = c_height;

        ParsedMap {
            header: MapHeader {
                n_map_flag: 780627,
                n_width: width,
                n_height: height,
                n_section_width: width,
                n_section_height: height,
            },
            section_cnt_x: 1,
            section_cnt_y: 1,
            section_offsets: vec![20],
            sections: vec![Some(MapSection {
                tiles: vec![tile; (width * height) as usize],
            })],
        }
    }

    fn set_map_tile_height(map: &mut ParsedMap, tile_x: i32, tile_y: i32, c_height: i8) {
        let section = map.sections[0].as_mut().unwrap();
        let index = (tile_y * map.header.n_section_width + tile_x) as usize;
        section.tiles[index].c_height = c_height;
    }

    fn unique_temp_root(label: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "pko_tools_{label}_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }

    fn decode_data_uri_pixel(data_uri: &str, x: u32, y: u32) -> [u8; 4] {
        let payload = data_uri
            .strip_prefix("data:image/png;base64,")
            .expect("expected PNG data URI");
        let bytes = BASE64_STANDARD.decode(payload).unwrap();
        let image = image::load_from_memory(&bytes).unwrap().to_rgba8();
        let pixel = image.get_pixel(x, y);
        [pixel[0], pixel[1], pixel[2], pixel[3]]
    }

    #[test]
    fn test_unpack_tile_layers() {
        let bt = 5u8;
        let dw: u32 = (3 << 26) | (15 << 22) | (7 << 16) | (8 << 12) | (1 << 6) | (0 << 2);

        let layers = unpack_tile_layers(bt, dw);

        assert_eq!(layers[0].tex_id, 5);
        assert_eq!(layers[0].alpha, 15);
        assert_eq!(layers[1].tex_id, 3);
        assert_eq!(layers[1].alpha, 15);
        assert_eq!(layers[2].tex_id, 7);
        assert_eq!(layers[2].alpha, 8);
        assert_eq!(layers[3].tex_id, 1);
        assert_eq!(layers[3].alpha, 0);
    }

    #[test]
    fn tile_layer_grid_missing_tile_uses_zero_default() {
        let parsed = ParsedMap {
            header: MapHeader {
                n_map_flag: 0,
                n_width: 2,
                n_height: 1,
                n_section_width: 1,
                n_section_height: 1,
            },
            section_cnt_x: 2,
            section_cnt_y: 1,
            section_offsets: vec![0, 0],
            sections: vec![
                Some(MapSection {
                    // base=5, overlay1 tex=3 alpha=15
                    tiles: vec![make_tile(5, (3 << 26) | (15 << 22))],
                }),
                None,
            ],
        };

        let grid = build_tile_layer_grid(&parsed);
        assert_eq!(grid.len(), 16, "2 tiles * 8 bytes");

        // Tile (0,0): source data, exists=1
        assert_eq!(grid[0], 5);
        assert_eq!(grid[1], 3);
        assert_eq!(grid[2], 15);
        assert_eq!(grid[7], 1, "exists flag for loaded tile");

        // Tile (1,0): missing section => 0 sentinel + exists=0
        assert_eq!(grid[8], 0);
        assert_eq!(grid[9], 0);
        assert_eq!(grid[10], 0);
        assert_eq!(grid[11], 0);
        assert_eq!(grid[12], 0);
        assert_eq!(grid[13], 0);
        assert_eq!(grid[14], 0);
        assert_eq!(grid[15], 0, "exists flag for missing section");
    }

    #[test]
    fn test_parse_terrain_info_real() {
        let path = std::path::Path::new("../top-client/scripts/table/TerrainInfo.bin");
        if !path.exists() {
            return;
        }

        let data = std::fs::read(path).unwrap();
        let entries = parse_terrain_info(&data).unwrap();

        assert!(!entries.is_empty(), "should have terrain entries");
        for (id, info) in &entries {
            eprintln!("Terrain {}: {}", id, info.path);
            assert!(!info.path.is_empty());
        }
    }

    #[test]
    fn parse_terrain_info_reads_all_records_from_file_length() {
        let mut data = Vec::new();
        data.extend_from_slice(&(TERRAIN_ENTRY_SIZE as u32).to_le_bytes());

        for i in 1..=60u32 {
            let index = (i - 1) as i32;
            let id = i as i32;
            let name = format!("texture/terrain/terrain_{:03}.tga", i);
            data.extend_from_slice(&terrain_info_record(index, id, &name));
        }

        let entries = parse_terrain_info(&data).unwrap();

        assert_eq!(entries.len(), 60);
        assert_eq!(
            entries.get(&60).map(|entry| entry.path.as_str()),
            Some("texture/terrain/terrain_060.tga"),
        );
    }

    #[test]
    fn parse_terrain_info_accepts_headerless_client_records() {
        let mut data = Vec::new();
        data.extend_from_slice(&terrain_info_record(0, 2, "terrain_002.bmp"));
        data.extend_from_slice(&terrain_info_record(1, 7, r"texture\terrain\grass07.bmp"));

        let entries = parse_terrain_info(&data).unwrap();

        assert_eq!(entries.len(), 2);
        assert_eq!(
            entries.get(&2).map(|entry| entry.path.as_str()),
            Some("terrain_002.bmp"),
        );
        assert_eq!(
            entries.get(&7).map(|entry| entry.path.as_str()),
            Some(r"texture\terrain\grass07.bmp"),
        );
    }

    #[test]
    fn parse_terrain_info_keeps_headerless_record_when_exists_matches_struct_size() {
        let mut data = terrain_info_record(0, 2, "terrain_002.bmp");
        data[0..4].copy_from_slice(&(TERRAIN_ENTRY_SIZE as u32).to_le_bytes());

        let entries = parse_terrain_info(&data).unwrap();

        assert_eq!(
            entries.get(&2).map(|entry| entry.path.as_str()),
            Some("terrain_002.bmp"),
        );
    }

    #[test]
    fn parse_terrain_info_accepts_header_only_empty_table() {
        let data = (TERRAIN_ENTRY_SIZE as u32).to_le_bytes();

        let entries = parse_terrain_info(&data).unwrap();

        assert!(entries.is_empty());
    }

    fn terrain_info_record(index: i32, id: i32, path: &str) -> Vec<u8> {
        assert!(
            path.len() <= 72,
            "TerrainInfo path fixture must fit szDataName"
        );
        let mut entry = vec![0u8; TERRAIN_ENTRY_SIZE];
        entry[0..4].copy_from_slice(&1u32.to_le_bytes());
        entry[4..8].copy_from_slice(&index.to_le_bytes());
        entry[84..88].copy_from_slice(&1u32.to_le_bytes());
        entry[100..104].copy_from_slice(&id.to_le_bytes());
        entry[8..8 + path.len()].copy_from_slice(path.as_bytes());
        entry
    }

    fn terrain_info_bytes(entries: &[(i32, i32, &str)]) -> Vec<u8> {
        let mut data = Vec::new();
        data.extend_from_slice(&(TERRAIN_ENTRY_SIZE as u32).to_le_bytes());

        for (index, id, path) in entries {
            data.extend_from_slice(&terrain_info_record(*index, *id, path));
        }

        data
    }

    #[test]
    fn read_pko_texture_bytes_resolves_terrain_relative_names() {
        let root = unique_temp_root("terrain_relative_texture");
        let texture_dir = root.join("texture").join("terrain");
        std::fs::create_dir_all(&texture_dir).unwrap();
        std::fs::write(texture_dir.join("grass01.bmp"), [1u8, 2, 3, 4]).unwrap();

        assert_eq!(
            read_pko_texture_bytes(&root, "grass01.bmp"),
            Some(vec![1, 2, 3, 4])
        );

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn read_pko_texture_bytes_resolves_data_texture_paths_from_data_root() {
        let root = unique_temp_root("data_root_texture_prefix");
        let texture_dir = root.join("texture").join("terrain");
        std::fs::create_dir_all(&texture_dir).unwrap();
        std::fs::write(texture_dir.join("grass01.bmp"), [5u8, 6, 7, 8]).unwrap();

        assert_eq!(
            read_pko_texture_bytes(&root, "Data/texture/terrain/grass01.bmp"),
            Some(vec![5, 6, 7, 8])
        );

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn terrain_texture_catalog_reads_sorted_entries_and_file_names() {
        let root = std::env::temp_dir().join(format!(
            "pko_tools_terrain_texture_catalog_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let table_dir = root.join("scripts").join("table");
        std::fs::create_dir_all(&table_dir).unwrap();
        std::fs::write(
            table_dir.join("TerrainInfo.bin"),
            terrain_info_bytes(&[
                (0, 7, r"texture\terrain\grass_007.tga"),
                (1, 2, "texture/terrain/terrain_002.tga"),
            ]),
        )
        .unwrap();

        let catalog = terrain_texture_catalog(&root).unwrap();

        assert_eq!(catalog.len(), 2);
        assert_eq!(catalog[0].id, 2);
        assert_eq!(catalog[0].path, "texture/terrain/terrain_002.tga");
        assert_eq!(catalog[0].file_name, "terrain_002.tga");
        assert_eq!(catalog[1].id, 7);
        assert_eq!(catalog[1].path, r"texture\terrain\grass_007.tga");
        assert_eq!(catalog[1].file_name, "grass_007.tga");

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn live_textured_overview_samples_real_terrain_texture() {
        let root = unique_temp_root("terrain_texture_overview");
        let texture_dir = root.join("texture").join("terrain");
        std::fs::create_dir_all(&texture_dir).unwrap();
        image::RgbaImage::from_pixel(2, 2, image::Rgba([220, 40, 10, 255]))
            .save(texture_dir.join("terrain_002.png"))
            .unwrap();
        let terrain_info = terrain_info_bytes(&[(0, 2, "texture/terrain/terrain_002.png")]);
        let map = solid_color_map(5, 5, 2, -1);
        let sampler = TerrainTextureSampler::load_for_map(&root, &map, &terrain_info)
            .unwrap()
            .expect("sampler should load the referenced texture");

        let overview =
            build_textured_overview_layer(&map, &sampler, MapWorkbenchLayer::TextureBase, 16)
                .unwrap();

        assert_eq!(overview.layer, MapWorkbenchLayer::TextureBase);
        assert_eq!(overview.sample_width, 5);
        assert_eq!(overview.sample_height, 5);
        assert_eq!(
            decode_data_uri_pixel(&overview.image_data_uri, 0, 0),
            [214, 40, 10, 255]
        );

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn live_textured_overview_modulates_texture_by_tile_color() {
        let root = unique_temp_root("terrain_texture_tint");
        let texture_dir = root.join("texture").join("terrain");
        std::fs::create_dir_all(&texture_dir).unwrap();
        image::RgbaImage::from_pixel(2, 2, image::Rgba([200, 120, 80, 255]))
            .save(texture_dir.join("terrain_002.png"))
            .unwrap();
        let terrain_info = terrain_info_bytes(&[(0, 2, "texture/terrain/terrain_002.png")]);
        let map = solid_color_map(5, 5, 2, 0x8410u16 as i16);
        let sampler = TerrainTextureSampler::load_for_map(&root, &map, &terrain_info)
            .unwrap()
            .expect("sampler should load the referenced texture");

        let overview =
            build_textured_overview_layer(&map, &sampler, MapWorkbenchLayer::TextureBase, 16)
                .unwrap();

        assert_eq!(
            decode_data_uri_pixel(&overview.image_data_uri, 0, 0),
            [100, 60, 40, 255]
        );

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn live_textured_overview_raw_layer_skips_tile_color_modulation() {
        let root = unique_temp_root("terrain_texture_raw_overview");
        let texture_dir = root.join("texture").join("terrain");
        std::fs::create_dir_all(&texture_dir).unwrap();
        image::RgbaImage::from_pixel(2, 2, image::Rgba([200, 120, 80, 255]))
            .save(texture_dir.join("terrain_002.png"))
            .unwrap();
        let terrain_info = terrain_info_bytes(&[(0, 2, "texture/terrain/terrain_002.png")]);
        let map = solid_color_map(2, 2, 2, 0x8410u16 as i16);
        let sampler = TerrainTextureSampler::load_for_map(&root, &map, &terrain_info)
            .unwrap()
            .expect("sampler should load the referenced texture");

        let overview =
            build_textured_overview_layer(&map, &sampler, MapWorkbenchLayer::TextureRaw, 16)
                .unwrap();

        assert_eq!(overview.layer, MapWorkbenchLayer::TextureRaw);
        assert_eq!(
            decode_data_uri_pixel(&overview.image_data_uri, 0, 0),
            [200, 120, 80, 255]
        );

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn live_textured_overview_downsamples_visible_area_instead_of_point_sampling() {
        let root = unique_temp_root("terrain_texture_overview_downsample");
        let texture_dir = root.join("texture").join("terrain");
        std::fs::create_dir_all(&texture_dir).unwrap();
        let colors = [
            (2, [240, 0, 0, 255]),
            (3, [0, 200, 0, 255]),
            (4, [0, 0, 160, 255]),
            (5, [120, 120, 120, 255]),
        ];
        for (id, color) in colors {
            image::RgbaImage::from_pixel(2, 2, image::Rgba(color))
                .save(texture_dir.join(format!("terrain_{id:03}.png")))
                .unwrap();
        }
        let terrain_info = terrain_info_bytes(&[
            (0, 2, "texture/terrain/terrain_002.png"),
            (1, 3, "texture/terrain/terrain_003.png"),
            (2, 4, "texture/terrain/terrain_004.png"),
            (3, 5, "texture/terrain/terrain_005.png"),
        ]);
        let mut map = solid_color_map(32, 32, 2, -1);
        let section = map.sections[0].as_mut().unwrap();
        section.tiles[0].bt_tile_info = 2;
        section.tiles[1].bt_tile_info = 3;
        section.tiles[32].bt_tile_info = 4;
        section.tiles[33].bt_tile_info = 5;
        let sampler = TerrainTextureSampler::load_for_map(&root, &map, &terrain_info)
            .unwrap()
            .expect("sampler should load the referenced textures");

        let overview =
            build_textured_overview_layer(&map, &sampler, MapWorkbenchLayer::TextureRaw, 16)
                .unwrap();

        assert_eq!(overview.sample_width, 16);
        assert_eq!(overview.sample_height, 16);
        assert_eq!(
            decode_data_uri_pixel(&overview.image_data_uri, 0, 0),
            [90, 80, 70, 255]
        );

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn live_textured_chunk_uses_multi_sampled_tile_textures() {
        let root = unique_temp_root("terrain_texture_chunk");
        let texture_dir = root.join("texture").join("terrain");
        std::fs::create_dir_all(&texture_dir).unwrap();
        image::RgbaImage::from_pixel(4, 4, image::Rgba([20, 180, 90, 255]))
            .save(texture_dir.join("terrain_002.png"))
            .unwrap();
        let terrain_info = terrain_info_bytes(&[(0, 2, "texture/terrain/terrain_002.png")]);
        let map = one_tile_map(2);
        let sampler = TerrainTextureSampler::load_for_map(&root, &map, &terrain_info)
            .unwrap()
            .expect("sampler should load the referenced texture");

        let chunk = build_textured_chunk_payload(
            &map,
            &sampler,
            MapChunkRequest {
                chunk_x: 0,
                chunk_y: 0,
                chunk_size: None,
                layer: MapWorkbenchLayer::TextureBase,
                zoom_bucket: 2,
                include_numeric_payload: false,
                source_guard: None,
            },
            128,
        )
        .unwrap();

        assert_eq!(chunk.layer, MapWorkbenchLayer::TextureBase);
        assert_eq!(chunk.sample_width, 4);
        assert_eq!(chunk.sample_height, 4);
        assert_eq!(chunk.numeric_payload, None);
        assert_eq!(
            decode_data_uri_pixel(&chunk.image_data_uri, 0, 0),
            [19, 178, 88, 255]
        );

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn live_textured_chunk_raw_layer_skips_tile_color_modulation() {
        let root = unique_temp_root("terrain_texture_chunk_raw");
        let texture_dir = root.join("texture").join("terrain");
        std::fs::create_dir_all(&texture_dir).unwrap();
        image::RgbaImage::from_pixel(2, 2, image::Rgba([200, 120, 80, 255]))
            .save(texture_dir.join("terrain_002.png"))
            .unwrap();
        let terrain_info = terrain_info_bytes(&[(0, 2, "texture/terrain/terrain_002.png")]);
        let map = solid_color_map(2, 2, 2, 0x8410u16 as i16);
        let sampler = TerrainTextureSampler::load_for_map(&root, &map, &terrain_info)
            .unwrap()
            .expect("sampler should load the referenced texture");

        let client_chunk = build_textured_chunk_payload(
            &map,
            &sampler,
            MapChunkRequest {
                chunk_x: 0,
                chunk_y: 0,
                chunk_size: None,
                layer: MapWorkbenchLayer::TextureBase,
                zoom_bucket: 0,
                include_numeric_payload: false,
                source_guard: None,
            },
            128,
        )
        .unwrap();
        let raw_chunk = build_textured_chunk_payload(
            &map,
            &sampler,
            MapChunkRequest {
                chunk_x: 0,
                chunk_y: 0,
                chunk_size: None,
                layer: MapWorkbenchLayer::TextureRaw,
                zoom_bucket: 0,
                include_numeric_payload: false,
                source_guard: None,
            },
            128,
        )
        .unwrap();

        assert_eq!(
            decode_data_uri_pixel(&client_chunk.image_data_uri, 0, 0),
            [100, 60, 40, 255]
        );
        assert_eq!(
            decode_data_uri_pixel(&raw_chunk.image_data_uri, 0, 0),
            [200, 120, 80, 255]
        );
        assert_eq!(raw_chunk.layer, MapWorkbenchLayer::TextureRaw);

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn live_textured_chunk_scales_sample_resolution_by_zoom_bucket() {
        let root = unique_temp_root("terrain_texture_chunk_lod");
        let texture_dir = root.join("texture").join("terrain");
        std::fs::create_dir_all(&texture_dir).unwrap();
        image::RgbaImage::from_pixel(4, 4, image::Rgba([20, 180, 90, 255]))
            .save(texture_dir.join("terrain_002.png"))
            .unwrap();
        let terrain_info = terrain_info_bytes(&[(0, 2, "texture/terrain/terrain_002.png")]);
        let map = one_tile_map(2);
        let sampler = TerrainTextureSampler::load_for_map(&root, &map, &terrain_info)
            .unwrap()
            .expect("sampler should load the referenced texture");

        let chunk_for_bucket = |zoom_bucket| {
            build_textured_chunk_payload(
                &map,
                &sampler,
                MapChunkRequest {
                    chunk_x: 0,
                    chunk_y: 0,
                    chunk_size: None,
                    layer: MapWorkbenchLayer::TextureBase,
                    zoom_bucket,
                    include_numeric_payload: false,
                    source_guard: None,
                },
                128,
            )
            .unwrap()
        };

        assert_eq!(chunk_for_bucket(0).sample_width, 1);
        assert_eq!(chunk_for_bucket(1).sample_width, 2);
        assert_eq!(chunk_for_bucket(2).sample_width, 4);
        assert_eq!(chunk_for_bucket(3).sample_width, 8);
        assert_eq!(chunk_for_bucket(4).sample_width, 16);
        assert_eq!(chunk_for_bucket(5).sample_width, 32);
        assert_eq!(chunk_for_bucket(6).sample_width, 64);

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn live_tile_texture_preview_compares_raw_and_client_tinted_samples() {
        let root = unique_temp_root("terrain_texture_tile_preview");
        let texture_dir = root.join("texture").join("terrain");
        std::fs::create_dir_all(&texture_dir).unwrap();
        image::RgbaImage::from_pixel(2, 2, image::Rgba([200, 120, 80, 255]))
            .save(texture_dir.join("terrain_002.png"))
            .unwrap();
        let terrain_info = terrain_info_bytes(&[(0, 2, "texture/terrain/terrain_002.png")]);
        let map = solid_color_map(2, 2, 2, 0x8410u16 as i16);
        let sampler = TerrainTextureSampler::load_for_map(&root, &map, &terrain_info)
            .unwrap()
            .expect("sampler should load the referenced texture");

        let preview = build_tile_texture_preview(&map, &sampler, 0, 0, 4).unwrap();

        assert_eq!(preview.tile_x, 0);
        assert_eq!(preview.tile_y, 0);
        assert_eq!(preview.sample_width, 4);
        assert_eq!(preview.sample_height, 4);
        assert_eq!(
            decode_data_uri_pixel(&preview.raw_image_data_uri, 0, 0),
            [200, 120, 80, 255]
        );
        assert_eq!(
            decode_data_uri_pixel(&preview.client_image_data_uri, 0, 0),
            [100, 60, 40, 255]
        );

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn terrain_texture_sampling_interpolates_between_neighboring_texels() {
        let img = DynamicImage::ImageRgba8(image::RgbaImage::from_fn(2, 2, |x, y| match (x, y) {
            (0, 0) => image::Rgba([0, 0, 0, 255]),
            (1, 0) => image::Rgba([100, 0, 0, 255]),
            (0, 1) => image::Rgba([0, 100, 0, 255]),
            _ => image::Rgba([0, 0, 100, 255]),
        }));

        let sampled = sample_texture(&img, 0.5, 0.5);

        for (actual, expected) in sampled.iter().zip([25.0, 25.0, 25.0]) {
            assert!(
                (*actual - expected).abs() < 0.01,
                "expected interpolated channel near {expected}, got {actual}",
            );
        }
    }

    #[test]
    fn terrain_alpha_mask_sampling_interpolates_between_neighboring_pixels() {
        let alpha_atlas =
            DynamicImage::ImageRgba8(image::RgbaImage::from_fn(2, 2, |x, y| match (x, y) {
                (0, 0) | (1, 1) => image::Rgba([0, 0, 0, 0]),
                _ => image::Rgba([0, 0, 0, 255]),
            }));

        let sampled = sample_alpha(&alpha_atlas, false, 0.5, 0.5);

        assert!(
            (sampled - 0.5).abs() < 0.01,
            "expected interpolated mask alpha near 0.5, got {sampled}",
        );
    }

    #[test]
    fn terrain_alpha_atlas_uses_mask_color_when_alpha_plane_is_opaque() {
        let mut tex_images = HashMap::new();
        tex_images.insert(
            2,
            DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
                2,
                2,
                image::Rgba([200, 20, 10, 255]),
            )),
        );
        tex_images.insert(
            3,
            DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
                2,
                2,
                image::Rgba([10, 30, 220, 255]),
            )),
        );
        let alpha_atlas = DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            4,
            4,
            image::Rgba([0, 0, 0, 255]),
        ));
        let use_alpha_color_mask = alpha_atlas_uses_color_mask(&alpha_atlas);
        assert!(use_alpha_color_mask);

        let sampler = TerrainTextureSampler {
            tex_images,
            alpha_atlas: Some(alpha_atlas),
            alpha_atlas_uses_color_mask: use_alpha_color_mask,
        };
        let layers = [
            TileLayer {
                tex_id: 2,
                alpha: 15,
            },
            TileLayer {
                tex_id: 3,
                alpha: 1,
            },
            TileLayer {
                tex_id: 0,
                alpha: 0,
            },
            TileLayer {
                tex_id: 0,
                alpha: 0,
            },
        ];

        assert_eq!(
            sampler.sample_layers_rgb(&layers, 0, 0, 0.5, 0.5),
            Some([200, 20, 10]),
        );
    }

    #[test]
    fn terrain_alpha_atlas_preserves_opaque_pixels_when_alpha_plane_varies() {
        let mut tex_images = HashMap::new();
        tex_images.insert(
            2,
            DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
                2,
                2,
                image::Rgba([200, 20, 10, 255]),
            )),
        );
        tex_images.insert(
            3,
            DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
                2,
                2,
                image::Rgba([10, 30, 220, 255]),
            )),
        );
        let mut alpha_atlas_pixels = image::RgbaImage::from_pixel(4, 4, image::Rgba([0, 0, 0, 0]));
        alpha_atlas_pixels.put_pixel(0, 0, image::Rgba([0, 0, 0, 255]));
        let alpha_atlas = DynamicImage::ImageRgba8(alpha_atlas_pixels);
        let use_alpha_color_mask = alpha_atlas_uses_color_mask(&alpha_atlas);
        assert!(!use_alpha_color_mask);

        let sampler = TerrainTextureSampler {
            tex_images,
            alpha_atlas: Some(alpha_atlas),
            alpha_atlas_uses_color_mask: use_alpha_color_mask,
        };
        let layers = [
            TileLayer {
                tex_id: 2,
                alpha: 15,
            },
            TileLayer {
                tex_id: 3,
                alpha: 1,
            },
            TileLayer {
                tex_id: 0,
                alpha: 0,
            },
            TileLayer {
                tex_id: 0,
                alpha: 0,
            },
        ];

        assert_eq!(
            sampler.sample_layers_rgb(&layers, 0, 0, 0.5, 0.5),
            Some([10, 30, 220]),
        );
    }

    #[test]
    fn terrain_overlay_alpha_15_replaces_existing_layers_like_client() {
        let mut tex_images = HashMap::new();
        tex_images.insert(
            2,
            DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
                2,
                2,
                image::Rgba([200, 20, 10, 255]),
            )),
        );
        tex_images.insert(
            3,
            DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
                2,
                2,
                image::Rgba([10, 30, 220, 255]),
            )),
        );
        let alpha_atlas = DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            64,
            64,
            image::Rgba([0, 0, 0, 255]),
        ));
        let sampler = TerrainTextureSampler {
            tex_images,
            alpha_atlas: Some(alpha_atlas),
            alpha_atlas_uses_color_mask: true,
        };
        let layers = [
            TileLayer {
                tex_id: 2,
                alpha: 15,
            },
            TileLayer {
                tex_id: 3,
                alpha: 15,
            },
            TileLayer {
                tex_id: 0,
                alpha: 0,
            },
            TileLayer {
                tex_id: 0,
                alpha: 0,
            },
        ];

        assert_eq!(
            sampler.sample_layers_rgb(&layers, 0, 0, 0.5, 0.5),
            Some([10, 30, 220]),
        );
    }

    #[test]
    fn terrain_alpha_mask_sampling_uses_client_edge_inset() {
        let mut alpha_atlas_pixels =
            image::RgbaImage::from_pixel(400, 400, image::Rgba([0, 0, 0, 0]));
        for x in 103..=104 {
            for y in 103..=104 {
                alpha_atlas_pixels.put_pixel(x, y, image::Rgba([0, 0, 0, 255]));
            }
        }
        for x in 195..=196 {
            for y in 195..=196 {
                alpha_atlas_pixels.put_pixel(x, y, image::Rgba([0, 0, 0, 255]));
            }
        }
        let alpha_atlas = DynamicImage::ImageRgba8(alpha_atlas_pixels);
        let [u, v] = client_alpha_mask_uv(6, 0.0, 0.0);
        let [far_u, far_v] = client_alpha_mask_uv(6, 1.0, 1.0);

        assert_eq!(sample_alpha(&alpha_atlas, false, u, v), 1.0);
        assert_eq!(sample_alpha(&alpha_atlas, false, far_u, far_v), 1.0);
    }

    #[test]
    fn live_texture_sampler_stops_at_first_empty_overlay_slot() {
        let mut tex_images = HashMap::new();
        tex_images.insert(
            2,
            DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
                2,
                2,
                image::Rgba([200, 20, 10, 255]),
            )),
        );
        tex_images.insert(
            3,
            DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
                2,
                2,
                image::Rgba([10, 30, 220, 255]),
            )),
        );

        let sampler = TerrainTextureSampler {
            tex_images,
            alpha_atlas: None,
            alpha_atlas_uses_color_mask: false,
        };
        let layers = [
            TileLayer {
                tex_id: 2,
                alpha: 15,
            },
            TileLayer {
                tex_id: 0,
                alpha: 0,
            },
            TileLayer {
                tex_id: 3,
                alpha: 15,
            },
            TileLayer {
                tex_id: 0,
                alpha: 0,
            },
        ];

        assert_eq!(
            sampler.sample_layers_rgb(&layers, 0, 0, 0.5, 0.5),
            Some([200, 20, 10]),
        );
    }

    #[test]
    fn live_texture_sampler_blends_available_overlay_when_base_texture_is_missing() {
        let mut tex_images = HashMap::new();
        tex_images.insert(
            3,
            DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
                2,
                2,
                image::Rgba([100, 50, 20, 255]),
            )),
        );
        let alpha_atlas = DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            4,
            4,
            image::Rgba([128, 0, 0, 255]),
        ));
        let use_alpha_color_mask = alpha_atlas_uses_color_mask(&alpha_atlas);
        assert!(use_alpha_color_mask);

        let sampler = TerrainTextureSampler {
            tex_images,
            alpha_atlas: Some(alpha_atlas),
            alpha_atlas_uses_color_mask: use_alpha_color_mask,
        };
        let layers = [
            TileLayer {
                tex_id: 2,
                alpha: 15,
            },
            TileLayer {
                tex_id: 3,
                alpha: 1,
            },
            TileLayer {
                tex_id: 0,
                alpha: 0,
            },
            TileLayer {
                tex_id: 0,
                alpha: 0,
            },
        ];

        assert_eq!(
            sampler.sample_layers_rgb(&layers, 0, 0, 0.5, 0.5),
            Some([50, 25, 10]),
        );
    }

    #[test]
    fn live_texture_sampler_keeps_available_textures_when_some_references_are_missing() {
        let root = unique_temp_root("terrain_texture_partial");
        let texture_dir = root.join("texture").join("terrain");
        std::fs::create_dir_all(&texture_dir).unwrap();
        image::RgbaImage::from_pixel(2, 2, image::Rgba([220, 40, 10, 255]))
            .save(texture_dir.join("terrain_002.png"))
            .unwrap();
        let terrain_info = terrain_info_bytes(&[(0, 2, "texture/terrain/terrain_002.png")]);
        let map = ParsedMap {
            header: MapHeader {
                n_map_flag: 780627,
                n_width: 1,
                n_height: 1,
                n_section_width: 1,
                n_section_height: 1,
            },
            section_cnt_x: 1,
            section_cnt_y: 1,
            section_offsets: vec![20],
            sections: vec![Some(MapSection {
                tiles: vec![make_tile(2, (3 << 26) | (15 << 22))],
            })],
        };

        let sampler = TerrainTextureSampler::load_for_map(&root, &map, &terrain_info).unwrap();
        let fingerprint = terrain_texture_asset_fingerprint(&root, &map, &terrain_info).unwrap();

        let sampler = sampler.expect("available terrain textures should still be sampled");
        assert_eq!(
            sampler.sample_map_rgb(&map, 0, 0, 0.5, 0.5),
            Some([214, 40, 10])
        );
        assert!(
            fingerprint.is_some(),
            "missing texture assets still get a stable miss fingerprint"
        );

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn live_texture_sampler_keeps_available_textures_when_texture_file_is_missing() {
        let root = unique_temp_root("terrain_texture_missing_file");
        let texture_dir = root.join("texture").join("terrain");
        std::fs::create_dir_all(&texture_dir).unwrap();
        image::RgbaImage::from_pixel(2, 2, image::Rgba([220, 40, 10, 255]))
            .save(texture_dir.join("terrain_002.png"))
            .unwrap();
        let terrain_info = terrain_info_bytes(&[
            (0, 2, "texture/terrain/terrain_002.png"),
            (1, 3, "texture/terrain/missing_003.png"),
        ]);
        let map = ParsedMap {
            header: MapHeader {
                n_map_flag: 780627,
                n_width: 1,
                n_height: 1,
                n_section_width: 1,
                n_section_height: 1,
            },
            section_cnt_x: 1,
            section_cnt_y: 1,
            section_offsets: vec![20],
            sections: vec![Some(MapSection {
                tiles: vec![make_tile(2, (3 << 26) | (15 << 22))],
            })],
        };

        let sampler = TerrainTextureSampler::load_for_map(&root, &map, &terrain_info)
            .unwrap()
            .expect("available terrain textures should still be sampled");
        assert_eq!(
            sampler.sample_map_rgb(&map, 0, 0, 0.5, 0.5),
            Some([214, 40, 10])
        );

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn terrain_texture_asset_report_counts_loaded_and_missing_references() {
        let root = unique_temp_root("terrain_texture_asset_report");
        let texture_dir = root.join("texture").join("terrain");
        std::fs::create_dir_all(&texture_dir).unwrap();
        image::RgbaImage::from_pixel(2, 2, image::Rgba([220, 40, 10, 255]))
            .save(texture_dir.join("terrain_002.png"))
            .unwrap();
        let terrain_info = terrain_info_bytes(&[
            (0, 2, "texture/terrain/terrain_002.png"),
            (1, 3, "texture/terrain/missing_003.png"),
        ]);
        let map = ParsedMap {
            header: MapHeader {
                n_map_flag: 780627,
                n_width: 1,
                n_height: 1,
                n_section_width: 1,
                n_section_height: 1,
            },
            section_cnt_x: 1,
            section_cnt_y: 1,
            section_offsets: vec![20],
            sections: vec![Some(MapSection {
                tiles: vec![make_tile(2, (3 << 26) | (15 << 22))],
            })],
        };

        let report = terrain_texture_asset_report(&root, &map, &terrain_info).unwrap();

        assert_eq!(report.referenced_count, 2);
        assert_eq!(report.loaded_count, 1);
        assert_eq!(report.missing_count, 1);
        assert!(!report.alpha_atlas_available);

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn live_texture_sampler_tints_default_sea_sections_like_client() {
        let mut tex_images = HashMap::new();
        tex_images.insert(
            UNDERWATER_TEXNO,
            DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
                2,
                2,
                image::Rgba([200, 180, 120, 255]),
            )),
        );
        let sampler = TerrainTextureSampler {
            tex_images,
            alpha_atlas: None,
            alpha_atlas_uses_color_mask: false,
        };
        let map = ParsedMap {
            header: MapHeader {
                n_map_flag: 780627,
                n_width: 1,
                n_height: 1,
                n_section_width: 1,
                n_section_height: 1,
            },
            section_cnt_x: 1,
            section_cnt_y: 1,
            section_offsets: vec![0],
            sections: vec![None],
        };

        assert_eq!(
            sampler.sample_map_rgb(&map, 0, 0, 0.5, 0.5),
            Some([150, 147, 201])
        );
    }

    #[test]
    fn live_texture_sampler_does_not_tint_from_non_sea_quad_tile_height() {
        let mut tex_images = HashMap::new();
        tex_images.insert(
            2,
            DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
                2,
                2,
                image::Rgba([200, 180, 120, 255]),
            )),
        );
        let sampler = TerrainTextureSampler {
            tex_images,
            alpha_atlas: None,
            alpha_atlas_uses_color_mask: false,
        };
        let mut map = solid_color_map_with_height(5, 5, 2, -1, 0);
        // The sampled point is inside the 0..4 sea quad, but tile (1,1) is not
        // a sea-quad vertex. Matching the client, this height alone must not
        // create a water overlay.
        set_map_tile_height(&mut map, 1, 1, -20);

        assert_eq!(
            sampler.sample_map_rgb(&map, 1, 1, 0.0, 0.0),
            Some([195, 178, 117])
        );
    }

    #[test]
    fn live_texture_sampler_raw_layer_skips_client_sea_tint() {
        let mut tex_images = HashMap::new();
        tex_images.insert(
            2,
            DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
                2,
                2,
                image::Rgba([200, 180, 120, 255]),
            )),
        );
        let sampler = TerrainTextureSampler {
            tex_images,
            alpha_atlas: None,
            alpha_atlas_uses_color_mask: false,
        };
        let mut map = solid_color_map_with_height(5, 5, 2, -1, 0);
        set_map_tile_height(&mut map, 4, 0, -20);
        set_map_tile_height(&mut map, 0, 4, -20);
        set_map_tile_height(&mut map, 4, 4, -20);

        assert_eq!(
            sampler.sample_map_rgb(&map, 1, 1, 0.0, 0.0),
            Some([173, 163, 159])
        );
        assert_eq!(
            sampler.sample_map_rgb_raw(&map, 1, 1, 0.0, 0.0),
            Some([200, 180, 120])
        );
    }

    #[test]
    fn live_texture_sampler_interpolates_client_sea_quad_alpha() {
        let mut tex_images = HashMap::new();
        tex_images.insert(
            2,
            DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
                2,
                2,
                image::Rgba([200, 180, 120, 255]),
            )),
        );
        let sampler = TerrainTextureSampler {
            tex_images,
            alpha_atlas: None,
            alpha_atlas_uses_color_mask: false,
        };
        let mut map = solid_color_map_with_height(5, 5, 2, -1, 0);
        set_map_tile_height(&mut map, 1, 1, -20);
        set_map_tile_height(&mut map, 4, 0, -20);
        set_map_tile_height(&mut map, 0, 4, -20);
        set_map_tile_height(&mut map, 4, 4, -20);

        assert_eq!(
            sampler.sample_map_rgb(&map, 1, 1, 0.0, 0.0),
            Some([173, 163, 159])
        );
    }

    #[test]
    fn live_texture_sampler_does_not_clip_client_sea_quad_alpha_to_current_tile() {
        let mut tex_images = HashMap::new();
        tex_images.insert(
            2,
            DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
                2,
                2,
                image::Rgba([200, 180, 120, 255]),
            )),
        );
        let sampler = TerrainTextureSampler {
            tex_images,
            alpha_atlas: None,
            alpha_atlas_uses_color_mask: false,
        };
        let mut map = solid_color_map_with_height(5, 5, 2, -1, 0);
        set_map_tile_height(&mut map, 4, 0, -20);
        set_map_tile_height(&mut map, 0, 4, -20);
        set_map_tile_height(&mut map, 4, 4, -20);

        assert_eq!(
            sampler.sample_map_rgb(&map, 1, 1, 0.0, 0.0),
            Some([173, 163, 159])
        );
    }

    #[test]
    fn terrain_texture_asset_fingerprint_changes_when_texture_content_changes() {
        let root = unique_temp_root("terrain_texture_fingerprint");
        let texture_dir = root.join("texture").join("terrain");
        let texture_path = texture_dir.join("terrain_002.png");
        std::fs::create_dir_all(&texture_dir).unwrap();
        image::RgbaImage::from_pixel(2, 2, image::Rgba([220, 40, 10, 255]))
            .save(&texture_path)
            .unwrap();
        let terrain_info = terrain_info_bytes(&[(0, 2, "texture/terrain/terrain_002.png")]);
        let map = one_tile_map(2);

        let first = terrain_texture_asset_fingerprint(&root, &map, &terrain_info)
            .unwrap()
            .expect("first fingerprint");
        image::RgbaImage::from_pixel(2, 2, image::Rgba([10, 140, 230, 255]))
            .save(&texture_path)
            .unwrap();
        let second = terrain_texture_asset_fingerprint(&root, &map, &terrain_info)
            .unwrap()
            .expect("second fingerprint");

        assert_ne!(first, second);

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn terrain_texture_catalog_keeps_preview_payloads_lazy() {
        let root = std::env::temp_dir().join(format!(
            "pko_tools_terrain_texture_catalog_lazy_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let table_dir = root.join("scripts").join("table");
        let texture_dir = root.join("texture").join("terrain");
        std::fs::create_dir_all(&table_dir).unwrap();
        std::fs::create_dir_all(&texture_dir).unwrap();
        std::fs::write(
            table_dir.join("TerrainInfo.bin"),
            terrain_info_bytes(&[(0, 2, "texture/terrain/terrain_002.png")]),
        )
        .unwrap();

        image::RgbaImage::from_pixel(2, 2, image::Rgba([120, 80, 40, 255]))
            .save(texture_dir.join("terrain_002.png"))
            .unwrap();

        let catalog = terrain_texture_catalog(&root).unwrap();

        assert_eq!(catalog.len(), 1);
        assert_eq!(catalog[0].id, 2);
        assert!(catalog[0].preview_data_uri.is_none());

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn terrain_texture_preview_data_uri_embeds_texture_preview_when_file_is_available() {
        let root = std::env::temp_dir().join(format!(
            "pko_tools_terrain_texture_preview_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let table_dir = root.join("scripts").join("table");
        let texture_dir = root.join("texture").join("terrain");
        std::fs::create_dir_all(&table_dir).unwrap();
        std::fs::create_dir_all(&texture_dir).unwrap();
        std::fs::write(
            table_dir.join("TerrainInfo.bin"),
            terrain_info_bytes(&[(0, 2, "texture/terrain/terrain_002.png")]),
        )
        .unwrap();

        image::RgbaImage::from_pixel(2, 2, image::Rgba([120, 80, 40, 255]))
            .save(texture_dir.join("terrain_002.png"))
            .unwrap();

        let preview = terrain_texture_preview_data_uri(&root, 2).unwrap();

        assert!(preview
            .as_deref()
            .unwrap_or_default()
            .starts_with("data:image/png;base64,"));

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn test_atlas_baking_real() {
        let project_dir = std::path::Path::new("../top-client");
        let map_path = project_dir.join("map/garner.map");
        if !map_path.exists() {
            return;
        }

        let map_data = std::fs::read(&map_path).unwrap();
        let parsed = crate::map::map_loader::load_map(&map_data).unwrap();

        let atlas = try_bake_atlas(project_dir, &parsed);
        assert!(atlas.is_some(), "should produce an atlas");

        let atlas = atlas.unwrap();
        let ts = atlas_tile_size(parsed.header.n_width as u32, parsed.header.n_height as u32);
        let expected_w = parsed.header.n_width as u32 * ts;
        let expected_h = parsed.header.n_height as u32 * ts;
        eprintln!(
            "Atlas size: {}x{} pixels ({}px/tile)",
            atlas.width(),
            atlas.height(),
            ts,
        );
        assert_eq!(atlas.width(), expected_w);
        assert_eq!(atlas.height(), expected_h);
    }

    #[test]
    fn test_alpha_channel_analysis() {
        use image::GenericImageView;

        // --- 1. Analyze the exported PNG alpha atlas ---
        let png_path =
            std::path::Path::new("../unity-export/07xmas/terrain_textures/alpha_atlas.png");
        if !png_path.exists() {
            eprintln!("SKIP: alpha_atlas.png not found at {:?}", png_path);
            return;
        }

        let png_img = image::open(png_path).expect("failed to open alpha_atlas.png");
        let (w, h) = png_img.dimensions();
        let color_type = png_img.color();
        eprintln!("=== alpha_atlas.png ===");
        eprintln!("Dimensions: {}x{}", w, h);
        eprintln!("Color type: {:?}", color_type);

        let mut min_a: u8 = 255;
        let mut max_a: u8 = 0;
        let mut sum_a: u64 = 0;
        let mut count_not_255: u64 = 0;
        let total = (w as u64) * (h as u64);

        for y in 0..h {
            for x in 0..w {
                let p = png_img.get_pixel(x, y);
                let a = p[3];
                if a != 255 {
                    count_not_255 += 1;
                }
                if a < min_a {
                    min_a = a;
                }
                if a > max_a {
                    max_a = a;
                }
                sum_a += a as u64;
            }
        }

        let mean_a = sum_a as f64 / total as f64;
        eprintln!("Total pixels: {}", total);
        eprintln!(
            "Pixels with alpha != 255: {} ({:.2}%)",
            count_not_255,
            100.0 * count_not_255 as f64 / total as f64
        );
        eprintln!("Alpha min={} max={} mean={:.2}", min_a, max_a, mean_a);

        // Sample 5 pixels from different quadrants
        let samples = [
            (w / 4, h / 4, "top-left quadrant"),
            (3 * w / 4, h / 4, "top-right quadrant"),
            (w / 2, h / 2, "center"),
            (w / 4, 3 * h / 4, "bottom-left quadrant"),
            (3 * w / 4, 3 * h / 4, "bottom-right quadrant"),
        ];
        for (sx, sy, label) in &samples {
            let p = png_img.get_pixel(*sx, *sy);
            eprintln!(
                "  Sample ({},{}) [{}]: R={} G={} B={} A={}",
                sx, sy, label, p[0], p[1], p[2], p[3]
            );
        }

        // --- Also check R, G, B channel statistics ---
        let mut min_r: u8 = 255;
        let mut max_r: u8 = 0;
        let mut sum_r: u64 = 0;
        let mut min_g: u8 = 255;
        let mut max_g: u8 = 0;
        let mut sum_g: u64 = 0;
        let mut min_b: u8 = 255;
        let mut max_b: u8 = 0;
        let mut sum_b: u64 = 0;
        for y in 0..h {
            for x in 0..w {
                let p = png_img.get_pixel(x, y);
                let (r, g, b) = (p[0], p[1], p[2]);
                if r < min_r {
                    min_r = r;
                }
                if r > max_r {
                    max_r = r;
                }
                sum_r += r as u64;
                if g < min_g {
                    min_g = g;
                }
                if g > max_g {
                    max_g = g;
                }
                sum_g += g as u64;
                if b < min_b {
                    min_b = b;
                }
                if b > max_b {
                    max_b = b;
                }
                sum_b += b as u64;
            }
        }
        eprintln!(
            "R channel: min={} max={} mean={:.2}",
            min_r,
            max_r,
            sum_r as f64 / total as f64
        );
        eprintln!(
            "G channel: min={} max={} mean={:.2}",
            min_g,
            max_g,
            sum_g as f64 / total as f64
        );
        eprintln!(
            "B channel: min={} max={} mean={:.2}",
            min_b,
            max_b,
            sum_b as f64 / total as f64
        );

        // --- 2. Analyze the original TGA ---
        let tga_path = std::path::Path::new("../top-client/texture/terrain/alpha/total.tga");
        if !tga_path.exists() {
            eprintln!("SKIP: total.tga not found at {:?}", tga_path);
            return;
        }

        let tga_raw = std::fs::read(tga_path).expect("failed to read total.tga");
        let tga_decoded = crate::item::model::decode_pko_texture(&tga_raw);
        let tga_img = image::load_from_memory_with_format(&tga_decoded, image::ImageFormat::Tga)
            .expect("failed to decode total.tga after PKO un-obfuscation");
        let (tw, th) = tga_img.dimensions();
        let tga_color = tga_img.color();
        eprintln!("");
        eprintln!("=== total.tga (original) ===");
        eprintln!("Dimensions: {}x{}", tw, th);
        eprintln!("Color type: {:?}", tga_color);

        let mut tga_min_a: u8 = 255;
        let mut tga_max_a: u8 = 0;
        let mut tga_sum_a: u64 = 0;
        let mut tga_count_not_255: u64 = 0;
        let mut tga_min_r: u8 = 255;
        let mut tga_max_r: u8 = 0;
        let mut tga_sum_r: u64 = 0;
        let mut tga_min_g: u8 = 255;
        let mut tga_max_g: u8 = 0;
        let mut tga_sum_g: u64 = 0;
        let mut tga_min_b: u8 = 255;
        let mut tga_max_b: u8 = 0;
        let mut tga_sum_b: u64 = 0;
        let tga_total = (tw as u64) * (th as u64);

        for y in 0..th {
            for x in 0..tw {
                let p = tga_img.get_pixel(x, y);
                let (r, g, b, a) = (p[0], p[1], p[2], p[3]);
                if a != 255 {
                    tga_count_not_255 += 1;
                }
                if a < tga_min_a {
                    tga_min_a = a;
                }
                if a > tga_max_a {
                    tga_max_a = a;
                }
                tga_sum_a += a as u64;
                if r < tga_min_r {
                    tga_min_r = r;
                }
                if r > tga_max_r {
                    tga_max_r = r;
                }
                tga_sum_r += r as u64;
                if g < tga_min_g {
                    tga_min_g = g;
                }
                if g > tga_max_g {
                    tga_max_g = g;
                }
                tga_sum_g += g as u64;
                if b < tga_min_b {
                    tga_min_b = b;
                }
                if b > tga_max_b {
                    tga_max_b = b;
                }
                tga_sum_b += b as u64;
            }
        }

        eprintln!("Total pixels: {}", tga_total);
        eprintln!(
            "Pixels with alpha != 255: {} ({:.2}%)",
            tga_count_not_255,
            100.0 * tga_count_not_255 as f64 / tga_total as f64
        );
        eprintln!(
            "Alpha:  min={} max={} mean={:.2}",
            tga_min_a,
            tga_max_a,
            tga_sum_a as f64 / tga_total as f64
        );
        eprintln!(
            "R chan: min={} max={} mean={:.2}",
            tga_min_r,
            tga_max_r,
            tga_sum_r as f64 / tga_total as f64
        );
        eprintln!(
            "G chan: min={} max={} mean={:.2}",
            tga_min_g,
            tga_max_g,
            tga_sum_g as f64 / tga_total as f64
        );
        eprintln!(
            "B chan: min={} max={} mean={:.2}",
            tga_min_b,
            tga_max_b,
            tga_sum_b as f64 / tga_total as f64
        );

        // Sample from TGA
        let tga_samples = [
            (tw / 4, th / 4, "top-left quadrant"),
            (3 * tw / 4, th / 4, "top-right quadrant"),
            (tw / 2, th / 2, "center"),
            (tw / 4, 3 * th / 4, "bottom-left quadrant"),
            (3 * tw / 4, 3 * th / 4, "bottom-right quadrant"),
        ];
        for (sx, sy, label) in &tga_samples {
            let p = tga_img.get_pixel(*sx, *sy);
            eprintln!(
                "  Sample ({},{}) [{}]: R={} G={} B={} A={}",
                sx, sy, label, p[0], p[1], p[2], p[3]
            );
        }

        // --- 3. Compare: Does R in TGA match the alpha data we expect? ---
        eprintln!("");
        eprintln!("=== Comparison ===");
        eprintln!("PNG alpha range: [{}, {}]", min_a, max_a);
        eprintln!("TGA alpha range: [{}, {}]", tga_min_a, tga_max_a);
        eprintln!("TGA R channel range: [{}, {}]", tga_min_r, tga_max_r);
        if tga_max_a == tga_min_a && tga_min_a == 255 {
            eprintln!("NOTE: TGA alpha is all 255 -- alpha blending data is likely in the R channel, not the A channel");
        }
    }
}
