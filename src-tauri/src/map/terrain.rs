use std::path::Path;

use anyhow::{Context, Result};

use super::{MapEntry, MapMetadata};
use crate::client_paths;
use crate::map::obj_loader;

// ============================================================================
// Map file constants
// ============================================================================

const CUR_VERSION_NO: i32 = 780627; // MP_MAP_FLAG(780624) + 3

// Original PKO terrain/sea defaults (Engine/sdk/include/MPMap.h)
pub(crate) const UNDERWATER_HEIGHT: f32 = -2.0;
pub(crate) const UNDERWATER_TEXNO: u8 = 22;
pub(crate) const MAP_HEIGHT_SCALE: f32 = 1.0;

// ============================================================================
// Parsed structures
// ============================================================================

#[derive(Debug, serde::Serialize)]
pub struct MapHeader {
    pub n_map_flag: i32,
    pub n_width: i32,
    pub n_height: i32,
    pub n_section_width: i32,
    pub n_section_height: i32,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct MapTile {
    pub dw_tile_info: u32,
    pub bt_tile_info: u8,
    pub s_color: i16,
    pub c_height: i8,
    pub s_region: i16,
    pub bt_island: u8,
    pub bt_block: [u8; 4],
}

#[derive(Debug, serde::Serialize)]
pub struct MapSection {
    pub tiles: Vec<MapTile>,
}

#[derive(Debug, serde::Serialize)]
pub struct ParsedMap {
    pub header: MapHeader,
    pub section_cnt_x: i32,
    pub section_cnt_y: i32,
    pub section_offsets: Vec<u32>,
    pub sections: Vec<Option<MapSection>>,
}

// ============================================================================
// Color conversion
// ============================================================================

/// Convert terrain vertex color (stored as i16) to (R, G, B) floats in 0..1.
///
/// The map file stores colors in BGR565 format (blue in high 5 bits, red in
/// low 5 bits). The original engine's LW_RGB565TODWORD macro misleadingly
/// names the fields "R/G/B" by bit position, but then packs the DWORD as
/// `R_bits | (G_bits << 8) | (B_bits << 16)` — placing the high-5-bit value
/// into D3DCOLOR's blue byte and the low-5-bit value into D3DCOLOR's red byte.
/// The net effect is that the high 5 bits are blue and the low 5 bits are red.
pub fn rgb565_to_float(color: i16) -> (f32, f32, f32) {
    let c = color as u16;
    // High 5 bits = blue, middle 6 bits = green, low 5 bits = red
    let b = ((c & 0xf800) >> 8) as f32 / 255.0;
    let g = ((c & 0x07e0) >> 3) as f32 / 255.0;
    let r = ((c & 0x001f) << 3) as f32 / 255.0;
    (r, g, b)
}

/// Scan `project_dir/map/` for `.map` files and build a list of available maps.
pub fn scan_maps(project_dir: &Path) -> Result<Vec<MapEntry>> {
    let map_dir = client_paths::asset_dir(project_dir, "map");
    if !map_dir.exists() {
        return Ok(vec![]);
    }

    let mut entries = Vec::new();

    for entry in std::fs::read_dir(&map_dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("map") {
            continue;
        }

        let file_name = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("")
            .to_string();

        // Quick-read just the header to get dimensions
        let data = std::fs::read(&path)?;
        if data.len() < 20 {
            continue;
        }

        let flag = i32::from_le_bytes([data[0], data[1], data[2], data[3]]);
        if flag != CUR_VERSION_NO {
            continue;
        }
        let width = i32::from_le_bytes([data[4], data[5], data[6], data[7]]);
        let height = i32::from_le_bytes([data[8], data[9], data[10], data[11]]);

        let obj_path = map_dir.join(format!("{}.obj", file_name));
        let rbo_path = map_dir.join(format!("{}.rbo", file_name));

        let display_name = file_name
            .chars()
            .enumerate()
            .map(|(i, c)| if i == 0 { c.to_ascii_uppercase() } else { c })
            .collect::<String>();

        entries.push(MapEntry {
            name: file_name,
            display_name,
            map_file: format!(
                "map/{}.map",
                entry.path().file_stem().unwrap().to_str().unwrap()
            ),
            has_obj: obj_path.exists(),
            has_rbo: rbo_path.exists(),
            width,
            height,
        });
    }

    entries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(entries)
}

// ============================================================================
// Native map helpers
// ============================================================================

/// Get the tile at absolute tile coordinates (tx, ty), returning None if the
/// section is empty or coords are out of bounds.
pub(crate) fn get_tile<'a>(map: &'a ParsedMap, tx: i32, ty: i32) -> Option<&'a MapTile> {
    if tx < 0 || ty < 0 || tx >= map.header.n_width || ty >= map.header.n_height {
        return None;
    }
    let sx = tx / map.header.n_section_width;
    let sy = ty / map.header.n_section_height;
    let section_idx = (sy * map.section_cnt_x + sx) as usize;
    let section = map.sections.get(section_idx)?.as_ref()?;
    let lx = (tx % map.header.n_section_width) as usize;
    let ly = (ty % map.header.n_section_height) as usize;
    let tile_idx = ly * map.header.n_section_width as usize + lx;
    section.tiles.get(tile_idx)
}

/// Convert tile height byte to PKO native world units.
/// Client code: `pTile->fHeight = (float)(tile.cHeight * 10) / 100.0f`
/// Native mapdata export keeps that same unit scale.
pub(crate) fn tile_height(tile: &MapTile) -> f32 {
    (tile.c_height as f32 * 10.0) / 100.0 / MAP_HEIGHT_SCALE
}

pub(crate) fn default_missing_tile() -> MapTile {
    MapTile {
        dw_tile_info: 0,
        bt_tile_info: UNDERWATER_TEXNO,
        s_color: -1,
        c_height: (UNDERWATER_HEIGHT * 10.0).round() as i8,
        s_region: 0,
        bt_island: 0,
        bt_block: [0; 4],
    }
}

/// Resolve the terrain tile used for a render vertex.
///
/// PKO vertex ownership semantics are strict: vertex (vx, vy) samples
/// `GetTile(vx, vy)` directly. If that tile is out-of-range or section-missing,
/// the render path falls back to default underwater tile values.
///
/// Boundary clamping: when a vertex sits at the +1 edge of a loaded section
/// (right or bottom boundary), get_tile returns None because the vertex
/// coordinate falls into the next (unloaded) section. This creates a steep
/// cliff face with near-horizontal normals that appears grey under lighting.
/// To avoid this, try the immediate neighbor tile (vx-1 or vy-1). If found,
/// the boundary vertex inherits that neighbor's height/color, eliminating
/// the cliff. The flat underwater floor still exists further out.
fn get_render_vertex_tile<'a>(map: &'a ParsedMap, vx: i32, vy: i32) -> Option<&'a MapTile> {
    if let Some(tile) = get_tile(map, vx, vy) {
        return Some(tile);
    }
    // Boundary clamp: try left, top, then diagonal neighbor.
    // Handles +1 fence-post vertices at right/bottom/corner edges.
    if vx > 0 {
        if let Some(tile) = get_tile(map, vx - 1, vy) {
            return Some(tile);
        }
    }
    if vy > 0 {
        if let Some(tile) = get_tile(map, vx, vy - 1) {
            return Some(tile);
        }
    }
    // Corner case: both vx and vy are +1 boundary
    if vx > 0 && vy > 0 {
        if let Some(tile) = get_tile(map, vx - 1, vy - 1) {
            return Some(tile);
        }
    }
    None
}

// ============================================================================
// Grid builders for native mapdata export
// ============================================================================

/// Decode btBlock byte to object height using the original engine formula.
/// From MPTile.h `_getObjHeight`: bits 0-5 = magnitude (0-63),
/// bit 6 = sign (1 = negative), bit 7 = collision flag (ignored for height).
/// Returns height in original engine world units (range ±3.15).
pub fn decode_obj_height(bt_block_byte: u8) -> f32 {
    let magnitude = (bt_block_byte & 0x3F) as f32; // bits 0-5
    let signed = (bt_block_byte & 0x40) != 0; // bit 6
    let height = magnitude * 5.0 / 100.0;
    if signed {
        -height
    } else {
        height
    }
}

/// Build collision grid from tile bt_block[4] data at 2x tile resolution.
/// Returns (grid_bytes, width, height) where width=n_width*2, height=n_height*2.
/// Each byte is 1 (blocked) or 0 (walkable), extracted from bit 7 of btBlock.
fn build_collision_grid(map: &ParsedMap) -> (Vec<u8>, i32, i32) {
    let w = map.header.n_width * 2;
    let h = map.header.n_height * 2;
    let mut grid = vec![0u8; (w * h) as usize];

    for ty in 0..map.header.n_height {
        for tx in 0..map.header.n_width {
            if let Some(tile) = get_tile(map, tx, ty) {
                for sub_y in 0..2i32 {
                    for sub_x in 0..2i32 {
                        let cx = tx * 2 + sub_x;
                        let cy = ty * 2 + sub_y;
                        let idx = (cy * w + cx) as usize;
                        let block_idx = (sub_y * 2 + sub_x) as usize;
                        // Only store collision flag (bit 7). Previously stored
                        // the raw byte, which caused walkable cells with height
                        // data (bits 0-6) to be incorrectly treated as blocked.
                        grid[idx] = if tile.bt_block[block_idx] & 0x80 != 0 {
                            1
                        } else {
                            0
                        };
                    }
                }
            }
        }
    }

    (grid, w, h)
}

/// Build object height grid from tile btBlock[4] data at 2x tile resolution.
/// Each cell is an i16 in little-endian encoding representing height in
/// millimeters (height * 1000). This gives sub-millimeter precision for the
/// ±3.15 range while keeping the grid compact (2 bytes per cell).
/// Returns (grid_bytes, width, height).
fn build_obj_height_grid(map: &ParsedMap) -> (Vec<u8>, i32, i32) {
    let w = map.header.n_width * 2;
    let h = map.header.n_height * 2;
    // Pre-allocate as i16 array, then convert to bytes
    let mut grid_i16 = vec![0i16; (w * h) as usize];

    for ty in 0..map.header.n_height {
        for tx in 0..map.header.n_width {
            if let Some(tile) = get_tile(map, tx, ty) {
                for sub_y in 0..2i32 {
                    for sub_x in 0..2i32 {
                        let cx = tx * 2 + sub_x;
                        let cy = ty * 2 + sub_y;
                        let idx = (cy * w + cx) as usize;
                        let block_idx = (sub_y * 2 + sub_x) as usize;
                        let height = decode_obj_height(tile.bt_block[block_idx]);
                        grid_i16[idx] = (height * 1000.0).round() as i16;
                    }
                }
            } else {
                // Missing tile → UNDERWATER_HEIGHT for all 4 sub-tiles
                let uw = (UNDERWATER_HEIGHT * 1000.0).round() as i16;
                for sub_y in 0..2i32 {
                    for sub_x in 0..2i32 {
                        let cx = tx * 2 + sub_x;
                        let cy = ty * 2 + sub_y;
                        let idx = (cy * w + cx) as usize;
                        grid_i16[idx] = uw;
                    }
                }
            }
        }
    }

    // Convert i16 array to LE bytes
    let mut grid = Vec::with_capacity((w * h * 2) as usize);
    for val in &grid_i16 {
        grid.extend_from_slice(&val.to_le_bytes());
    }

    (grid, w, h)
}

/// Build terrain height grid at vertex resolution using tile_height().
/// Each vertex (vx, vy) samples get_render_vertex_tile(map, vx, vy) which
/// uses boundary clamping to inherit neighbor heights at section edges.
/// This prevents cliff walls where loaded terrain meets unloaded sea.
/// Grid dimensions: (n_width+1) × (n_height+1).
/// Each cell is an i16 in LE encoding representing height in millimeters.
/// Returns (grid_bytes, width, height).
fn build_terrain_height_grid(map: &ParsedMap) -> (Vec<u8>, i32, i32) {
    let vw = map.header.n_width + 1;
    let vh = map.header.n_height + 1;
    let mut grid_i16 = vec![0i16; (vw * vh) as usize];
    let uw = (UNDERWATER_HEIGHT * 1000.0).round() as i16;

    for vy in 0..vh {
        for vx in 0..vw {
            let idx = (vy * vw + vx) as usize;
            grid_i16[idx] = match get_render_vertex_tile(map, vx, vy) {
                Some(tile) => (tile_height(tile) * 1000.0).round() as i16,
                None => uw,
            };
        }
    }

    // Convert i16 array to LE bytes
    let mut grid = Vec::with_capacity((vw * vh * 2) as usize);
    for val in &grid_i16 {
        grid.extend_from_slice(&val.to_le_bytes());
    }

    (grid, vw, vh)
}

/// Build region grid (sRegion i16 per tile). Returns raw i16 LE bytes.
fn build_region_grid(map: &ParsedMap) -> Vec<u8> {
    let w = map.header.n_width;
    let h = map.header.n_height;
    let mut data = Vec::with_capacity((w * h * 2) as usize);

    for ty in 0..h {
        for tx in 0..w {
            let region = get_tile(map, tx, ty).map(|t| t.s_region).unwrap_or(0);
            data.extend_from_slice(&region.to_le_bytes());
        }
    }

    data
}

/// Build area grid (btIsland u8 per tile).
fn build_area_grid(map: &ParsedMap) -> Vec<u8> {
    let w = map.header.n_width;
    let h = map.header.n_height;
    let mut grid = vec![0u8; (w * h) as usize];

    for ty in 0..h {
        for tx in 0..w {
            let island = get_tile(map, tx, ty).map(|t| t.bt_island).unwrap_or(0);
            grid[(ty * w + tx) as usize] = island;
        }
    }

    grid
}

/// Build tile texture grid (bt_tile_info per tile → u8).
/// This is the base layer (Layer 0) texture ID — the primary terrain texture
/// for each tile. Used by SeaRenderer for underwater tile detection (ID 22).
/// Missing sections use 0 sentinel.
fn build_tile_texture_grid(map: &ParsedMap) -> Vec<u8> {
    let w = map.header.n_width;
    let h = map.header.n_height;
    let mut grid = vec![0u8; (w * h) as usize];

    for ty in 0..h {
        for tx in 0..w {
            let tex_id = get_tile(map, tx, ty).map(|t| t.bt_tile_info).unwrap_or(0);
            grid[(ty * w + tx) as usize] = tex_id;
        }
    }

    grid
}

/// Build tile color grid (sColor i16 per tile). Returns raw i16 LE bytes.
fn build_tile_color_grid(map: &ParsedMap) -> Vec<u8> {
    let w = map.header.n_width;
    let h = map.header.n_height;
    let mut data = Vec::with_capacity((w * h * 2) as usize);

    for ty in 0..h {
        for tx in 0..w {
            // Missing sections default to 0xFFFF (near-white in RGB565) = multiplicative identity.
            // Using 0 would decode to black, causing buildings with shadeFlag to go black.
            let color = get_tile(map, tx, ty).map(|t| t.s_color).unwrap_or(-1i16);
            data.extend_from_slice(&color.to_le_bytes());
        }
    }

    data
}

// ============================================================================
// .mapdata binary format — unified packed grid file
// ============================================================================

/// Magic number for .mapdata files: "PKOW" in little-endian
const MAPDATA_MAGIC: u32 = 0x504B4F57;
/// Current .mapdata format version
const MAPDATA_VERSION: u16 = 1;
/// Header size in bytes
const MAPDATA_HEADER_SIZE: u32 = 32;

/// Export all grid data as a single `.mapdata` binary file.
///
/// Format:
///   Header (32 bytes)
///   Collision bitmap (uncompressed) — 1 bit per cell, 2x resolution, MSB first
///   Compressed block (zlib deflate) — obj_height + terrain_height + area + region
///     + tile_texture + tile_layer + tile_color concatenated
///
/// The collision bitmap is uncompressed for instant per-frame walk queries.
/// All other grids are decompressed once at map load (during loading screen).
pub fn export_mapdata(
    parsed_map: &ParsedMap,
    section_tile_size: i32,
    output_path: &Path,
) -> Result<MapdataExportResult> {
    use flate2::write::ZlibEncoder;
    use flate2::Compression;
    use std::io::Write;

    let map_w = parsed_map.header.n_width;
    let map_h = parsed_map.header.n_height;
    let collision_cells_per_tile: u16 = 2;
    let collision_w = map_w * collision_cells_per_tile as i32;
    let collision_h = map_h * collision_cells_per_tile as i32;
    let sections_x = (map_w + section_tile_size - 1) / section_tile_size;
    let sections_z = (map_h + section_tile_size - 1) / section_tile_size;

    eprintln!(
        "[mapdata] Building grids for {}x{} map (sections {}x{}, tile_size {})...",
        map_w, map_h, sections_x, sections_z, section_tile_size
    );

    // Build all grids using existing functions
    let (collision_grid, coll_w, coll_h) = build_collision_grid(parsed_map);
    let (obj_height_bytes, _, _) = build_obj_height_grid(parsed_map);
    let (terrain_height_bytes, _, _) = build_terrain_height_grid(parsed_map);
    let area_bytes = build_area_grid(parsed_map);
    let region_bytes = build_region_grid(parsed_map);
    let tile_tex_bytes = build_tile_texture_grid(parsed_map);
    let tile_layer_bytes = super::texture::build_tile_layer_grid(parsed_map);
    let tile_color_bytes = build_tile_color_grid(parsed_map);

    // 1. Pack collision into 1-bit bitmap (MSB first, 1=walkable, 0=blocked)
    let bitmap_len = (coll_w as u64 * coll_h as u64).div_ceil(8);
    let mut collision_bitmap = vec![0u8; bitmap_len as usize];
    for (i, &cell) in collision_grid.iter().enumerate() {
        let walkable = cell == 0; // 0 = walkable in the u8 grid
        if walkable {
            let byte_idx = i / 8;
            let bit_idx = 7 - (i % 8); // MSB first
            collision_bitmap[byte_idx] |= 1 << bit_idx;
        }
    }

    // 2. Concatenate all compressed grids in spec order
    let mut raw_block = Vec::with_capacity(
        obj_height_bytes.len()
            + terrain_height_bytes.len()
            + area_bytes.len()
            + region_bytes.len()
            + tile_tex_bytes.len()
            + tile_layer_bytes.len()
            + tile_color_bytes.len(),
    );
    raw_block.extend_from_slice(&obj_height_bytes);
    raw_block.extend_from_slice(&terrain_height_bytes);
    raw_block.extend_from_slice(&area_bytes);
    raw_block.extend_from_slice(&region_bytes);
    raw_block.extend_from_slice(&tile_tex_bytes);
    raw_block.extend_from_slice(&tile_layer_bytes);
    raw_block.extend_from_slice(&tile_color_bytes);

    let raw_block_size = raw_block.len() as u32;

    // 3. Compress with zlib (level 6 = good balance of speed vs ratio)
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::new(6));
    encoder.write_all(&raw_block)?;
    let compressed_block = encoder.finish()?;
    let compressed_block_size = compressed_block.len() as u32;

    // 4. Compute offsets
    let compressed_block_offset = MAPDATA_HEADER_SIZE + collision_bitmap.len() as u32;

    // 5. Write the file
    let mut out = Vec::with_capacity(
        MAPDATA_HEADER_SIZE as usize + collision_bitmap.len() + compressed_block.len(),
    );

    // Header (32 bytes)
    out.extend_from_slice(&MAPDATA_MAGIC.to_le_bytes()); // [0:4]
    out.extend_from_slice(&MAPDATA_VERSION.to_le_bytes()); // [4:6]
    out.extend_from_slice(&(map_w as u16).to_le_bytes()); // [6:8]
    out.extend_from_slice(&(map_h as u16).to_le_bytes()); // [8:10]
    out.extend_from_slice(&(section_tile_size as u16).to_le_bytes()); // [10:12]
    out.extend_from_slice(&(sections_x as u16).to_le_bytes()); // [12:14]
    out.extend_from_slice(&(sections_z as u16).to_le_bytes()); // [14:16]
    out.extend_from_slice(&collision_cells_per_tile.to_le_bytes()); // [16:18]
    out.extend_from_slice(&0u16.to_le_bytes()); // [18:20] flags (reserved)
    out.extend_from_slice(&compressed_block_offset.to_le_bytes()); // [20:24]
    out.extend_from_slice(&compressed_block_size.to_le_bytes()); // [24:28]
    out.extend_from_slice(&raw_block_size.to_le_bytes()); // [28:32]

    assert_eq!(
        out.len(),
        MAPDATA_HEADER_SIZE as usize,
        "header must be exactly 32 bytes"
    );

    // Collision bitmap (uncompressed)
    out.extend_from_slice(&collision_bitmap);

    // Compressed block
    out.extend_from_slice(&compressed_block);

    std::fs::write(output_path, &out)
        .with_context(|| format!("Failed to write .mapdata: {}", output_path.display()))?;

    let total_size = out.len();
    let compression_ratio = if raw_block_size > 0 {
        compressed_block_size as f64 / raw_block_size as f64
    } else {
        0.0
    };

    eprintln!(
        "[mapdata] Written {} ({:.1} MB): bitmap={} bytes, raw={:.1} MB, compressed={:.1} MB ({:.1}% ratio)",
        output_path.display(),
        total_size as f64 / 1_048_576.0,
        collision_bitmap.len(),
        raw_block_size as f64 / 1_048_576.0,
        compressed_block_size as f64 / 1_048_576.0,
        compression_ratio * 100.0,
    );

    Ok(MapdataExportResult {
        total_size: total_size as u64,
        collision_bitmap_size: collision_bitmap.len() as u64,
        raw_block_size: raw_block_size as u64,
        compressed_block_size: compressed_block_size as u64,
        collision_w: collision_w as u32,
        collision_h: collision_h as u32,
    })
}

/// Result of a .mapdata export
pub struct MapdataExportResult {
    pub total_size: u64,
    pub collision_bitmap_size: u64,
    pub raw_block_size: u64,
    pub compressed_block_size: u64,
    pub collision_w: u32,
    pub collision_h: u32,
}

/// Get metadata for a map without building full tile/chunk payloads.
pub fn get_metadata(project_dir: &Path, map_name: &str) -> Result<MapMetadata> {
    let map_path = client_paths::asset_file(project_dir, "map", format!("{}.map", map_name));
    let map_data = std::fs::read(&map_path)
        .with_context(|| format!("Failed to read map file: {}", map_path.display()))?;
    let parsed_map = super::map_loader::load_map(&map_data)?;

    let total_sections = parsed_map.section_offsets.len() as u32;
    let non_empty = parsed_map
        .section_offsets
        .iter()
        .filter(|&&o| o != 0)
        .count() as u32;
    let total_tiles =
        non_empty * (parsed_map.header.n_section_width * parsed_map.header.n_section_height) as u32;

    // Count objects if .obj file exists
    let obj_path = client_paths::asset_file(project_dir, "map", format!("{}.obj", map_name));
    let object_count = if obj_path.exists() {
        let obj_data = std::fs::read(&obj_path)?;
        obj_loader::load_obj(&obj_data)
            .map(|o| o.objects.len() as u32)
            .unwrap_or(0)
    } else {
        0
    };

    Ok(MapMetadata {
        name: map_name.to_string(),
        width: parsed_map.header.n_width,
        height: parsed_map.header.n_height,
        section_width: parsed_map.header.n_section_width,
        section_height: parsed_map.header.n_section_height,
        total_sections,
        non_empty_sections: non_empty,
        total_tiles,
        object_count,
    })
}
// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rgb565_white() {
        let (r, g, b) = rgb565_to_float(-1i16); // 0xFFFF
        assert!(r > 0.95);
        assert!(g > 0.95);
        assert!(b > 0.95);
    }

    #[test]
    fn rgb565_black() {
        let (r, g, b) = rgb565_to_float(0);
        assert!(r < 0.01);
        assert!(g < 0.01);
        assert!(b < 0.01);
    }

    #[test]
    fn rgb565_pure_blue() {
        // 0xF800 = high 5 bits set = blue in BGR565
        let (r, g, b) = rgb565_to_float(0xF800u16 as i16);
        assert!(r < 0.05, "r={}", r);
        assert!(g < 0.05, "g={}", g);
        assert!(b > 0.9, "b={}", b);
    }

    #[test]
    fn rgb565_green() {
        // Pure green in BGR565: 0x07E0
        let (r, g, b) = rgb565_to_float(0x07E0u16 as i16);
        assert!(r < 0.05, "r={}", r);
        assert!(g > 0.9, "g={}", g);
        assert!(b < 0.05, "b={}", b);
    }

    #[test]
    fn rgb565_pure_red() {
        // 0x001F = low 5 bits set = red in BGR565
        let (r, g, b) = rgb565_to_float(0x001Fu16 as i16);
        assert!(r > 0.9, "r={}", r);
        assert!(g < 0.05, "g={}", g);
        assert!(b < 0.05, "b={}", b);
    }

    #[test]
    fn tile_height_conversion() {
        let tile = MapTile {
            dw_tile_info: 0,
            bt_tile_info: 0,
            s_color: 0,
            c_height: 10,
            s_region: 0,
            bt_island: 0,
            bt_block: [0; 4],
        };
        let h = tile_height(&tile);
        // cHeight=10 → fHeight = 1.0 in PKO native units.
        assert!((h - 1.0).abs() < 0.01, "height={}", h);

        let tile2 = MapTile {
            c_height: -5,
            ..tile
        };
        let h2 = tile_height(&tile2);
        // cHeight=-5 → fHeight = -0.5 in PKO native units.
        assert!((h2 - (-0.5)).abs() < 0.01, "height={}", h2);
    }

    fn make_tile(c_height: i8) -> MapTile {
        MapTile {
            dw_tile_info: 0,
            bt_tile_info: 1, // non-zero so tile emits geometry (0 = skip, matching original engine)
            s_color: 0,
            c_height,
            s_region: 0,
            bt_island: 0,
            bt_block: [0; 4],
        }
    }

    #[test]
    fn render_vertex_tile_clamps_boundary_to_neighbor() {
        let parsed = ParsedMap {
            header: MapHeader {
                n_map_flag: CUR_VERSION_NO,
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
                    tiles: vec![make_tile(10)],
                }),
                None,
            ],
        };

        // Vertex (1,0) sits at +1 boundary of loaded section 0.
        // get_tile(1,0) returns None (section 1 unloaded), but boundary
        // clamping finds neighbor (0,0) to avoid cliff faces.
        let tile = get_render_vertex_tile(&parsed, 1, 0);
        assert!(tile.is_some(), "boundary vertex should clamp to neighbor");
        assert_eq!(tile.unwrap().c_height, 10);
    }

    #[test]
    fn render_vertex_tile_boundary_clamps_at_map_edge() {
        let parsed = ParsedMap {
            header: MapHeader {
                n_map_flag: CUR_VERSION_NO,
                n_width: 1,
                n_height: 1,
                n_section_width: 1,
                n_section_height: 1,
            },
            section_cnt_x: 1,
            section_cnt_y: 1,
            section_offsets: vec![0],
            sections: vec![Some(MapSection {
                tiles: vec![make_tile(10)],
            })],
        };

        // Out-of-range vertices at +1 edges clamp back to loaded neighbor
        assert!(get_render_vertex_tile(&parsed, 1, 0).is_some());
        assert!(get_render_vertex_tile(&parsed, 0, 1).is_some());
        // Truly out of range (no neighbor) still returns None
        assert!(get_render_vertex_tile(&parsed, -1, 0).is_none());
    }

    #[test]
    fn parse_real_map() {
        let map_path = std::path::Path::new("../top-client/map/garner.map");
        if !map_path.exists() {
            return;
        }

        let data = std::fs::read(map_path).unwrap();
        let parsed = crate::map::map_loader::load_map(&data).unwrap();

        assert!(parsed.header.n_width > 0);
        assert!(parsed.header.n_height > 0);
        assert!(parsed.header.n_section_width > 0);
        assert!(parsed.header.n_section_height > 0);

        let non_empty = parsed.sections.iter().filter(|s| s.is_some()).count();
        assert!(non_empty > 0, "should have at least one non-empty section");

        eprintln!(
            "Map: {}x{}, sections: {}x{} ({}x{}), non-empty: {}",
            parsed.header.n_width,
            parsed.header.n_height,
            parsed.section_cnt_x,
            parsed.section_cnt_y,
            parsed.header.n_section_width,
            parsed.header.n_section_height,
            non_empty
        );
    }

    #[test]
    fn decode_obj_height_formula() {
        // Zero byte = zero height
        assert_eq!(super::decode_obj_height(0x00), 0.0);

        // Magnitude 1, positive: 1 * 5 / 100 = 0.05
        assert!((super::decode_obj_height(0x01) - 0.05).abs() < 0.001);

        // Magnitude 63 (max), positive: 63 * 5 / 100 = 3.15
        assert!((super::decode_obj_height(0x3F) - 3.15).abs() < 0.001);

        // Magnitude 1, negative (bit 6 set): -0.05
        assert!((super::decode_obj_height(0x41) - (-0.05)).abs() < 0.001);

        // Magnitude 63, negative: -3.15
        assert!((super::decode_obj_height(0x7F) - (-3.15)).abs() < 0.001);

        // Collision bit (bit 7) should not affect height
        // 0x80 = collision only, no height = 0.0
        assert_eq!(super::decode_obj_height(0x80), 0.0);

        // 0x81 = collision + magnitude 1 positive = 0.05
        assert!((super::decode_obj_height(0x81) - 0.05).abs() < 0.001);

        // 0xC1 = collision + magnitude 1 negative = -0.05
        assert!((super::decode_obj_height(0xC1) - (-0.05)).abs() < 0.001);
    }

    #[test]
    fn collision_grid_stores_only_collision_flag() {
        let parsed = ParsedMap {
            header: MapHeader {
                n_map_flag: CUR_VERSION_NO,
                n_width: 1,
                n_height: 1,
                n_section_width: 1,
                n_section_height: 1,
            },
            section_cnt_x: 1,
            section_cnt_y: 1,
            section_offsets: vec![0],
            sections: vec![Some(MapSection {
                tiles: vec![MapTile {
                    dw_tile_info: 0,
                    bt_tile_info: 0,
                    s_color: 0,
                    c_height: -5,
                    s_region: 0,
                    bt_island: 0,
                    // sub-tile 0: walkable with height (0x49 = positive height, no collision)
                    // sub-tile 1: blocked (0x80 = collision flag only)
                    // sub-tile 2: walkable zero (0x00)
                    // sub-tile 3: blocked with height (0xC9 = collision + negative height)
                    bt_block: [0x49, 0x80, 0x00, 0xC9],
                }],
            })],
        };

        let (grid, w, h) = build_collision_grid(&parsed);
        assert_eq!(w, 2);
        assert_eq!(h, 2);
        assert_eq!(grid.len(), 4);
        // sub-tile 0 (0,0): 0x49 → bit 7 clear → walkable (0)
        assert_eq!(grid[0], 0, "0x49 should be walkable");
        // sub-tile 1 (1,0): 0x80 → bit 7 set → blocked (1)
        assert_eq!(grid[1], 1, "0x80 should be blocked");
        // sub-tile 2 (0,1): 0x00 → walkable (0)
        assert_eq!(grid[2], 0, "0x00 should be walkable");
        // sub-tile 3 (1,1): 0xC9 → bit 7 set → blocked (1)
        assert_eq!(grid[3], 1, "0xC9 should be blocked");
    }

    #[test]
    fn obj_height_grid_encodes_i16_millimeters() {
        let parsed = ParsedMap {
            header: MapHeader {
                n_map_flag: CUR_VERSION_NO,
                n_width: 1,
                n_height: 1,
                n_section_width: 1,
                n_section_height: 1,
            },
            section_cnt_x: 1,
            section_cnt_y: 1,
            section_offsets: vec![0],
            sections: vec![Some(MapSection {
                tiles: vec![MapTile {
                    dw_tile_info: 0,
                    bt_tile_info: 0,
                    s_color: 0,
                    c_height: 0,
                    s_region: 0,
                    bt_island: 0,
                    // 0x09 = magnitude 9, positive: 9*5/100 = 0.45 → 450 millis
                    // 0x00 = 0.0 → 0 millis
                    // 0x41 = magnitude 1, negative: -0.05 → -50 millis
                    // 0x3F = magnitude 63, positive: 3.15 → 3150 millis
                    bt_block: [0x09, 0x00, 0x41, 0x3F],
                }],
            })],
        };

        let (grid, w, h) = build_obj_height_grid(&parsed);
        assert_eq!(w, 2);
        assert_eq!(h, 2);
        assert_eq!(grid.len(), 8); // 4 cells × 2 bytes each

        let read_i16 =
            |idx: usize| -> i16 { i16::from_le_bytes([grid[idx * 2], grid[idx * 2 + 1]]) };

        assert_eq!(read_i16(0), 450, "0x09 → 0.45 → 450mm");
        assert_eq!(read_i16(1), 0, "0x00 → 0.0 → 0mm");
        assert_eq!(read_i16(2), -50, "0x41 → -0.05 → -50mm");
        assert_eq!(read_i16(3), 3150, "0x3F → 3.15 → 3150mm");
    }

    #[test]
    fn terrain_height_grid_encodes_i16_millimeters() {
        // 2×2 tile map → vertex grid is 3×3
        let parsed = ParsedMap {
            header: MapHeader {
                n_map_flag: CUR_VERSION_NO,
                n_width: 2,
                n_height: 2,
                n_section_width: 2,
                n_section_height: 2,
            },
            section_cnt_x: 1,
            section_cnt_y: 1,
            section_offsets: vec![0],
            sections: vec![Some(MapSection {
                tiles: vec![
                    // tile (0,0): c_height = 10 → (10*10)/100 = 1.0 → 1000mm
                    MapTile {
                        dw_tile_info: 0,
                        bt_tile_info: 0,
                        s_color: 0,
                        c_height: 10,
                        s_region: 0,
                        bt_island: 0,
                        bt_block: [0; 4],
                    },
                    // tile (1,0): c_height = -5 → (-5*10)/100 = -0.5 → -500mm
                    MapTile {
                        dw_tile_info: 0,
                        bt_tile_info: 0,
                        s_color: 0,
                        c_height: -5,
                        s_region: 0,
                        bt_island: 0,
                        bt_block: [0; 4],
                    },
                    // tile (0,1): c_height = 0 → 0mm
                    MapTile {
                        dw_tile_info: 0,
                        bt_tile_info: 0,
                        s_color: 0,
                        c_height: 0,
                        s_region: 0,
                        bt_island: 0,
                        bt_block: [0; 4],
                    },
                    // tile (1,1): c_height = 127 → (127*10)/100 = 12.7 → 12700mm
                    MapTile {
                        dw_tile_info: 0,
                        bt_tile_info: 0,
                        s_color: 0,
                        c_height: 127,
                        s_region: 0,
                        bt_island: 0,
                        bt_block: [0; 4],
                    },
                ],
            })],
        };

        let (grid, w, h) = build_terrain_height_grid(&parsed);
        // Vertex resolution: (2+1) × (2+1) = 3×3
        assert_eq!(w, 3);
        assert_eq!(h, 3);
        assert_eq!(grid.len(), 18); // 9 cells × 2 bytes each

        let read_i16 =
            |idx: usize| -> i16 { i16::from_le_bytes([grid[idx * 2], grid[idx * 2 + 1]]) };

        // Row 0: vertices (0,0), (1,0), (2,0)
        // (0,0) → get_tile(0,0) = tile(0,0), c_height=10 → 1000mm
        assert_eq!(read_i16(0), 1000, "vertex (0,0) → tile (0,0) c_height=10");
        // (1,0) → get_tile(1,0) = tile(1,0), c_height=-5 → -500mm
        assert_eq!(read_i16(1), -500, "vertex (1,0) → tile (1,0) c_height=-5");
        // (2,0) → +1 edge clamps to neighbor tile (1,0) → -500mm
        assert_eq!(read_i16(2), -500, "vertex (2,0) → edge clamp to tile (1,0)");

        // Row 1: vertices (0,1), (1,1), (2,1)
        // (0,1) → get_tile(0,1) = tile(0,1), c_height=0 → 0mm
        assert_eq!(read_i16(3), 0, "vertex (0,1) → tile (0,1) c_height=0");
        // (1,1) → get_tile(1,1) = tile(1,1), c_height=127 → 12700mm
        assert_eq!(read_i16(4), 12700, "vertex (1,1) → tile (1,1) c_height=127");
        // (2,1) → +1 edge clamps to neighbor tile (1,1) → 12700mm
        assert_eq!(
            read_i16(5),
            12700,
            "vertex (2,1) → edge clamp to tile (1,1)"
        );

        // Row 2: vertices (0,2), (1,2), (2,2) — +1 edge clamps to loaded neighbors.
        assert_eq!(read_i16(6), 0, "vertex (0,2) → edge clamp to tile (0,1)");
        assert_eq!(
            read_i16(7),
            12700,
            "vertex (1,2) → edge clamp to tile (1,1)"
        );
        assert_eq!(
            read_i16(8),
            12700,
            "vertex (2,2) → diagonal edge clamp to tile (1,1)"
        );
    }

    #[test]
    fn diagnostic_btblock_height_xmas() {
        // Load the xmas map to analyze btBlock height data.
        // Skip silently if top-client data not present.
        let map_path = std::path::Path::new("../top-client/map/07xmas2.map");
        if !map_path.exists() {
            eprintln!("SKIP: {} not found", map_path.display());
            return;
        }

        let data = std::fs::read(map_path).unwrap();
        let parsed = crate::map::map_loader::load_map(&data).unwrap();

        let tw = parsed.header.n_width;
        let th = parsed.header.n_height;
        eprintln!(
            "Map: {}x{} tiles, sections: {}x{}",
            tw, th, parsed.section_cnt_x, parsed.section_cnt_y
        );

        // --- Global btBlock statistics ---
        let mut total_subtiles: u64 = 0;
        let mut nonzero_height: u64 = 0; // bits 0-6 != 0
        let mut collision_set: u64 = 0; // bit 7 set
        let mut walkable_nonzero: u64 = 0; // bit 7 clear but bits 0-6 != 0 (collision grid bug)
        let mut height_positive: u64 = 0;
        let mut height_negative: u64 = 0;

        // Histogram: height value → count (in 0.5-unit buckets)
        let mut histogram: std::collections::BTreeMap<i32, u64> = std::collections::BTreeMap::new();

        // --- Near-water analysis ---
        // Tiles where cHeight < 0 (below sea level)
        let mut underwater_tiles: u64 = 0;
        let mut underwater_subtiles_nonzero_height: u64 = 0;
        let mut underwater_min_obj_height: f32 = f32::MAX;
        let mut underwater_max_obj_height: f32 = f32::MIN;

        // Water-edge tiles: cHeight between -5 and 0 (transition zone)
        let mut edge_tiles: u64 = 0;
        let mut edge_subtiles_nonzero_height: u64 = 0;
        let mut edge_min_obj_height: f32 = f32::MAX;
        let mut edge_max_obj_height: f32 = f32::MIN;

        // Global min/max
        let mut global_min_obj_height: f32 = f32::MAX;
        let mut global_max_obj_height: f32 = f32::MIN;
        let mut global_min_c_height: i8 = i8::MAX;
        let mut global_max_c_height: i8 = i8::MIN;

        // Sample some edge tiles for detailed output
        let mut edge_samples: Vec<(i32, i32, i8, [u8; 4], [f32; 4])> = Vec::new();

        for ty in 0..th {
            for tx in 0..tw {
                let tile = match get_tile(&parsed, tx, ty) {
                    Some(t) => t,
                    None => continue,
                };

                if tile.c_height < global_min_c_height {
                    global_min_c_height = tile.c_height;
                }
                if tile.c_height > global_max_c_height {
                    global_max_c_height = tile.c_height;
                }

                let is_underwater = tile.c_height < 0;
                let is_edge = tile.c_height >= -5 && tile.c_height < 0;
                if is_underwater {
                    underwater_tiles += 1;
                }
                if is_edge {
                    edge_tiles += 1;
                }

                let mut obj_heights = [0.0f32; 4];
                for i in 0..4 {
                    let bb = tile.bt_block[i];
                    let h = decode_obj_height(bb);
                    obj_heights[i] = h;

                    total_subtiles += 1;

                    let has_height = (bb & 0x7F) != 0; // bits 0-6 non-zero
                    let is_blocked = (bb & 0x80) != 0; // bit 7

                    if has_height {
                        nonzero_height += 1;
                    }
                    if is_blocked {
                        collision_set += 1;
                    }
                    if !is_blocked && bb != 0 {
                        walkable_nonzero += 1;
                    }
                    if h > 0.001 {
                        height_positive += 1;
                    }
                    if h < -0.001 {
                        height_negative += 1;
                    }

                    // Histogram bucket: multiply by 10, round to nearest 5 (= 0.5 unit buckets)
                    let bucket = (h * 10.0).round() as i32 / 5 * 5;
                    *histogram.entry(bucket).or_insert(0) += 1;

                    if h < global_min_obj_height {
                        global_min_obj_height = h;
                    }
                    if h > global_max_obj_height {
                        global_max_obj_height = h;
                    }

                    if is_underwater && has_height {
                        underwater_subtiles_nonzero_height += 1;
                    }
                    if is_underwater && h < underwater_min_obj_height {
                        underwater_min_obj_height = h;
                    }
                    if is_underwater && h > underwater_max_obj_height {
                        underwater_max_obj_height = h;
                    }

                    if is_edge && has_height {
                        edge_subtiles_nonzero_height += 1;
                    }
                    if is_edge && h < edge_min_obj_height {
                        edge_min_obj_height = h;
                    }
                    if is_edge && h > edge_max_obj_height {
                        edge_max_obj_height = h;
                    }
                }

                // Collect detailed samples for edge tiles
                if is_edge && edge_samples.len() < 20 {
                    let any_nonzero = tile.bt_block.iter().any(|&b| (b & 0x7F) != 0);
                    if any_nonzero {
                        edge_samples.push((tx, ty, tile.c_height, tile.bt_block, obj_heights));
                    }
                }
            }
        }

        // --- Print results ---
        eprintln!("\n=== btBlock Height Diagnostic for 07xmas2 ===\n");

        eprintln!(
            "cHeight range: {} to {} (fHeight: {:.2} to {:.2})",
            global_min_c_height,
            global_max_c_height,
            global_min_c_height as f32 * 0.1,
            global_max_c_height as f32 * 0.1
        );

        eprintln!("\n--- Global btBlock Statistics ---");
        eprintln!("Total sub-tiles:       {}", total_subtiles);
        eprintln!(
            "Non-zero height:       {} ({:.1}%)",
            nonzero_height,
            nonzero_height as f64 / total_subtiles as f64 * 100.0
        );
        eprintln!(
            "Collision (bit 7):     {} ({:.1}%)",
            collision_set,
            collision_set as f64 / total_subtiles as f64 * 100.0
        );
        eprintln!(
            "Walkable but != 0:     {} ({:.1}%) ← COLLISION GRID BUG",
            walkable_nonzero,
            walkable_nonzero as f64 / total_subtiles as f64 * 100.0
        );
        eprintln!("Height > 0:            {}", height_positive);
        eprintln!("Height < 0:            {}", height_negative);
        eprintln!(
            "Obj height range:      {:.3} to {:.3}",
            global_min_obj_height, global_max_obj_height
        );

        eprintln!("\n--- Height Histogram (0.5-unit buckets) ---");
        for (&bucket, &count) in &histogram {
            if count > 0 {
                let lo = bucket as f64 / 10.0;
                let hi = lo + 0.5;
                let bar_len = (count as f64 / total_subtiles as f64 * 200.0) as usize;
                let bar: String = "#".repeat(bar_len.max(1).min(80));
                eprintln!("[{:+5.1} to {:+5.1}]: {:>8} {}", lo, hi, count, bar);
            }
        }

        eprintln!("\n--- Underwater Tiles (cHeight < 0) ---");
        eprintln!("Underwater tiles:      {}", underwater_tiles);
        eprintln!(
            "Subtiles with height:  {}",
            underwater_subtiles_nonzero_height
        );
        if underwater_tiles > 0 {
            eprintln!(
                "Obj height range:      {:.3} to {:.3}",
                underwater_min_obj_height, underwater_max_obj_height
            );
        }

        eprintln!("\n--- Water-Edge Tiles (-5 <= cHeight < 0) ---");
        eprintln!("Edge tiles:            {}", edge_tiles);
        eprintln!("Subtiles with height:  {}", edge_subtiles_nonzero_height);
        if edge_tiles > 0 {
            eprintln!(
                "Obj height range:      {:.3} to {:.3}",
                edge_min_obj_height, edge_max_obj_height
            );
        }

        if !edge_samples.is_empty() {
            eprintln!("\n--- Sample Water-Edge Tiles (up to 20) ---");
            for (tx, ty, ch, bb, oh) in &edge_samples {
                let fh = *ch as f32 * 0.1;
                eprintln!(
                    "  tile({},{}) cH={:+3} fH={:+5.1} btBlock=[0x{:02X},0x{:02X},0x{:02X},0x{:02X}] objH=[{:+.3},{:+.3},{:+.3},{:+.3}]",
                    tx, ty, ch, fh, bb[0], bb[1], bb[2], bb[3], oh[0], oh[1], oh[2], oh[3]
                );
            }
        }

        // --- Compare cHeight terrain vs btBlock at same position ---
        eprintln!("\n--- cHeight vs btBlock Height Comparison (underwater tiles) ---");
        let mut deeper_count: u64 = 0;
        let mut shallower_count: u64 = 0;
        let mut same_count: u64 = 0;
        let mut max_depth_diff: f32 = 0.0;

        for ty in 0..th {
            for tx in 0..tw {
                let tile = match get_tile(&parsed, tx, ty) {
                    Some(t) => t,
                    None => continue,
                };
                if tile.c_height >= 0 {
                    continue;
                }

                let terrain_h = tile.c_height as f32 * 0.1; // fHeight (original engine units)
                for i in 0..4 {
                    let obj_h = decode_obj_height(tile.bt_block[i]);
                    let diff = obj_h - terrain_h;
                    if diff < -0.001 {
                        deeper_count += 1; // btBlock is deeper than terrain
                        if diff.abs() > max_depth_diff {
                            max_depth_diff = diff.abs();
                        }
                    } else if diff > 0.001 {
                        shallower_count += 1; // btBlock is shallower than terrain
                    } else {
                        same_count += 1;
                    }
                }
            }
        }

        eprintln!("btBlock DEEPER than terrain:    {} sub-tiles", deeper_count);
        eprintln!(
            "btBlock SHALLOWER than terrain:  {} sub-tiles",
            shallower_count
        );
        eprintln!("btBlock SAME as terrain:         {} sub-tiles", same_count);
        eprintln!(
            "Max depth difference:            {:.3} units",
            max_depth_diff
        );

        eprintln!("\n=== VERDICT ===");
        if nonzero_height > 0 && walkable_nonzero > 0 {
            eprintln!("CONFIRMED: btBlock has meaningful height data.");
            eprintln!(
                "CONFIRMED: Collision grid bug — {} walkable cells incorrectly blocked.",
                walkable_nonzero
            );
        }
        if deeper_count > 0 {
            eprintln!("CONFIRMED: btBlock encodes DEEPER heights than terrain at water edges.");
            eprintln!("→ Proceed with Phases 2-8 to use btBlock height for character placement.");
        } else if nonzero_height == 0 {
            eprintln!(
                "DISPROVED: btBlock has NO meaningful height data. Investigate other causes."
            );
        } else {
            eprintln!(
                "INCONCLUSIVE: btBlock has height data but not deeper than terrain at water."
            );
        }
    }

    #[test]
    fn scolor_distribution_07xmas2() {
        let map_path = "/Users/anirudh/gamedev/pko-tools/top-client/map/07xmas2.map";
        let data = match std::fs::read(map_path) {
            Ok(d) => d,
            Err(_) => {
                eprintln!("SKIP: map file not found");
                return;
            }
        };
        let map = crate::map::map_loader::load_map(&data).expect("can't parse map");

        let mut zero_count = 0u64;
        let mut nonzero_count = 0u64;
        let mut samples = Vec::new();

        for ty in 0..map.header.n_height {
            for tx in 0..map.header.n_width {
                if let Some(tile) = get_tile(&map, tx, ty) {
                    if tile.s_color == 0 {
                        zero_count += 1;
                    } else {
                        nonzero_count += 1;
                        if samples.len() < 10 {
                            samples.push((tx, ty, tile.s_color));
                        }
                    }
                }
            }
        }

        let total = zero_count + nonzero_count;
        eprintln!("\nsColor distribution for 07xmas2:");
        eprintln!("  Total tiles with data: {}", total);
        eprintln!(
            "  sColor == 0: {} ({:.1}%)",
            zero_count,
            zero_count as f64 / total as f64 * 100.0
        );
        eprintln!(
            "  sColor != 0: {} ({:.1}%)",
            nonzero_count,
            nonzero_count as f64 / total as f64 * 100.0
        );
        for (tx, ty, v) in &samples {
            let packed = *v as u16;
            let r = ((packed & 0xF800) >> 8) as f32 / 255.0;
            let g = ((packed & 0x07E0) >> 3) as f32 / 255.0;
            let b = ((packed & 0x001F) << 3) as f32 / 255.0;
            eprintln!(
                "  tile({},{}) = 0x{:04X} → RGB({:.3}, {:.3}, {:.3})",
                tx, ty, packed, r, g, b
            );
        }
    }

    // ---- Native mapdata export tests ----

    fn make_test_map(width: i32, height: i32, section_size: i32) -> ParsedMap {
        let sec_x = width / section_size;
        let sec_y = height / section_size;
        let tiles_per_sec = (section_size * section_size) as usize;
        let mut sections = Vec::new();
        for _ in 0..(sec_x * sec_y) {
            let tiles: Vec<MapTile> = (0..tiles_per_sec).map(|_| make_tile(5)).collect();
            sections.push(Some(MapSection { tiles }));
        }
        ParsedMap {
            header: MapHeader {
                n_map_flag: CUR_VERSION_NO,
                n_width: width,
                n_height: height,
                n_section_width: section_size,
                n_section_height: section_size,
            },
            section_cnt_x: sec_x,
            section_cnt_y: sec_y,
            section_offsets: vec![1; (sec_x * sec_y) as usize],
            sections,
        }
    }

    #[test]
    fn export_mapdata_round_trip() {
        use flate2::read::ZlibDecoder;
        use std::io::Read;

        let map = make_test_map(4, 4, 2);
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.mapdata");

        let result = export_mapdata(&map, 2, &path).expect("export_mapdata");

        // Read back and verify header
        let data = std::fs::read(&path).unwrap();
        assert!(data.len() >= 32, "file too small");

        let magic = u32::from_le_bytes(data[0..4].try_into().unwrap());
        assert_eq!(magic, MAPDATA_MAGIC);

        let version = u16::from_le_bytes(data[4..6].try_into().unwrap());
        assert_eq!(version, 1);

        let map_w = u16::from_le_bytes(data[6..8].try_into().unwrap());
        let map_h = u16::from_le_bytes(data[8..10].try_into().unwrap());
        assert_eq!(map_w, 4);
        assert_eq!(map_h, 4);

        let section_size = u16::from_le_bytes(data[10..12].try_into().unwrap());
        assert_eq!(section_size, 2);

        let sections_x = u16::from_le_bytes(data[12..14].try_into().unwrap());
        let sections_z = u16::from_le_bytes(data[14..16].try_into().unwrap());
        assert_eq!(sections_x, 2);
        assert_eq!(sections_z, 2);

        let cells_per_tile = u16::from_le_bytes(data[16..18].try_into().unwrap());
        assert_eq!(cells_per_tile, 2);

        let comp_offset = u32::from_le_bytes(data[20..24].try_into().unwrap()) as usize;
        let comp_size = u32::from_le_bytes(data[24..28].try_into().unwrap()) as usize;
        let raw_size = u32::from_le_bytes(data[28..32].try_into().unwrap()) as usize;

        // Collision bitmap should be right after header
        let coll_w = 4 * 2; // map_w * cells_per_tile
        let coll_h = 4 * 2;
        let bitmap_len = (coll_w * coll_h + 7) / 8;
        assert_eq!(comp_offset, 32 + bitmap_len);

        // Decompress the block
        let compressed = &data[comp_offset..comp_offset + comp_size];
        let mut decoder = ZlibDecoder::new(compressed);
        let mut decompressed = Vec::new();
        decoder.read_to_end(&mut decompressed).unwrap();
        assert_eq!(decompressed.len(), raw_size);

        // Verify expected raw size:
        //   obj_height: 8*8*2 = 128
        //   terrain_height: 5*5*2 = 50
        //   area: 4*4*1 = 16
        //   region: 4*4*2 = 32
        //   tile_texture: 4*4*1 = 16
        //   tile_layer: 4*4*8 = 128
        //   tile_color: 4*4*2 = 32
        //   Total: 402
        let expected_raw =
            8 * 8 * 2 + 5 * 5 * 2 + 4 * 4 * 1 + 4 * 4 * 2 + 4 * 4 * 1 + 4 * 4 * 8 + 4 * 4 * 2;
        assert_eq!(raw_size, expected_raw, "raw block size mismatch");

        // Verify total file size matches result
        assert_eq!(data.len() as u64, result.total_size);
    }
}
