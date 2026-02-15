use std::collections::{HashMap, HashSet};
use std::path::Path;

use anyhow::Result;
use image::{DynamicImage, GenericImageView, Pixel};

use super::terrain::{ParsedMap, UNDERWATER_TEXNO};
use crate::item::model::decode_pko_texture;

// ============================================================================
// TerrainInfo.bin parsing
// ============================================================================

const TERRAIN_ENTRY_SIZE: usize = 120;
const TERRAIN_ENTRY_COUNT: usize = 49;

/// Maximum atlas dimension in pixels. The per-tile resolution adapts to fit.
/// 8192 keeps JPEG size reasonable (~2-8 MB) while maximizing texture detail.
const MAX_ATLAS_DIM: u32 = 8192;

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

/// Parse `scripts/table/TerrainInfo.bin` to extract terrain texture entries.
/// Format: 4-byte header (struct size = 120), then 49 × 120-byte entries.
/// Each entry: nIndex at offset 4 (4 bytes LE), szDataName at offset 8 (72 bytes, null-terminated).
pub fn parse_terrain_info(data: &[u8]) -> Result<HashMap<u8, TerrainTextureInfo>> {
    if data.len() < 4 {
        anyhow::bail!("TerrainInfo.bin too small");
    }

    let struct_size = u32::from_le_bytes([data[0], data[1], data[2], data[3]]) as usize;
    if struct_size != TERRAIN_ENTRY_SIZE {
        anyhow::bail!(
            "TerrainInfo.bin unexpected struct size: {} (expected {})",
            struct_size,
            TERRAIN_ENTRY_SIZE
        );
    }

    let mut entries = HashMap::new();
    let entry_data = &data[4..];

    for i in 0..TERRAIN_ENTRY_COUNT {
        let offset = i * TERRAIN_ENTRY_SIZE;
        if offset + TERRAIN_ENTRY_SIZE > entry_data.len() {
            break;
        }

        let entry = &entry_data[offset..offset + TERRAIN_ENTRY_SIZE];

        // nIndex at offset 4 (4 bytes LE)
        let n_index = u32::from_le_bytes([entry[4], entry[5], entry[6], entry[7]]) as u8;

        // szDataName at offset 8 (72 bytes, null-terminated)
        let name_bytes = &entry[8..80];
        let name_end = name_bytes.iter().position(|&b| b == 0).unwrap_or(72);
        let name = String::from_utf8_lossy(&name_bytes[..name_end]).to_string();

        if name.is_empty() || n_index == 0 {
            continue;
        }

        entries.insert(
            n_index,
            TerrainTextureInfo {
                id: n_index,
                path: name,
            },
        );
    }

    Ok(entries)
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
fn load_pko_image(project_dir: &Path, rel_path: &str) -> Option<DynamicImage> {
    let tex_data = std::fs::read(project_dir.join(rel_path))
        .or_else(|_| std::fs::read(project_dir.join(rel_path.replace('\\', "/"))))
        .ok()?;
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

// ============================================================================
// Texture sampling helpers
// ============================================================================

/// Sample a terrain texture at the given UV coordinate (wrapping).
/// Returns (r, g, b) as floats 0..255.
fn sample_texture(img: &DynamicImage, u: f32, v: f32) -> [f32; 3] {
    let (w, h) = img.dimensions();
    // Wrap UV to [0, 1)
    let u = u.fract();
    let v = v.fract();
    let u = if u < 0.0 { u + 1.0 } else { u };
    let v = if v < 0.0 { v + 1.0 } else { v };

    let px = ((u * w as f32) as u32).min(w - 1);
    let py = ((v * h as f32) as u32).min(h - 1);
    let pixel = img.get_pixel(px, py).to_rgba();
    [pixel[0] as f32, pixel[1] as f32, pixel[2] as f32]
}

/// Sample alpha from the alpha mask atlas at a given UV.
/// Returns alpha as float 0..1.
fn sample_alpha(atlas: &DynamicImage, u: f32, v: f32) -> f32 {
    let (w, h) = atlas.dimensions();
    let u = u.fract().max(0.0);
    let v = v.fract().max(0.0);
    let px = ((u * w as f32) as u32).min(w - 1);
    let py = ((v * h as f32) as u32).min(h - 1);
    let pixel = atlas.get_pixel(px, py).to_rgba();
    // Alpha channel — matches original D3D pipeline (D3DTSS_ALPHAOP = SELECTARG1)
    pixel[3] as f32 / 255.0
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
                            let blend = if let Some(alpha_img) = alpha_atlas {
                                let alpha_id = layer.alpha as usize;
                                if alpha_id > 0 && alpha_id < 16 {
                                    let au_base = ALPHA_NO_2_UV[alpha_id][0];
                                    let av_base = ALPHA_NO_2_UV[alpha_id][1];
                                    // The alpha mask tile uses mirror addressing
                                    // in the game, but for our baking we sample
                                    // the sub-tile position within the 0.25×0.25 cell
                                    let au = au_base + sub_u * 0.25;
                                    let av = av_base + sub_v * 0.25;
                                    sample_alpha(alpha_img, au, av)
                                } else {
                                    // alpha_id 0 or 15: treat as full
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
    let terrain_info_path = project_dir
        .join("scripts")
        .join("table")
        .join("TerrainInfo.bin");

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
    let terrain_info_path = project_dir
        .join("scripts")
        .join("table")
        .join("TerrainInfo.bin");

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

/// Build tile layer grid: 7 bytes per tile encoding all 4 texture layers.
/// Format per tile: [base_tex, L1_tex, L1_alpha, L2_tex, L2_alpha, L3_tex, L3_alpha]
/// Row-major order (Y outer, X inner), same as other grids.
pub fn build_tile_layer_grid(parsed_map: &ParsedMap) -> Vec<u8> {
    let w = parsed_map.header.n_width;
    let h = parsed_map.header.n_height;
    let mut grid = Vec::with_capacity((w * h * 7) as usize);

    for ty in 0..h {
        for tx in 0..w {
            let layers = match super::terrain::get_tile(parsed_map, tx, ty) {
                Some(tile) => unpack_tile_layers(tile.bt_tile_info, tile.dw_tile_info),
                // Missing sections: use 0 sentinel (same as tile_texture_grid).
                // UNDERWATER_TEXNO (22) is only meaningful for tiles that actually
                // exist in loaded sections — injecting it for absent data is misleading.
                None => [
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
            };

            // 7 bytes: base_tex, L1_tex, L1_alpha, L2_tex, L2_alpha, L3_tex, L3_alpha
            grid.push(layers[0].tex_id);
            grid.push(layers[1].tex_id);
            grid.push(layers[1].alpha);
            grid.push(layers[2].tex_id);
            grid.push(layers[2].alpha);
            grid.push(layers[3].tex_id);
            grid.push(layers[3].alpha);
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
            s_color: 0,
            c_height: 0,
            s_region: 0,
            bt_island: 0,
            bt_block: [0; 4],
        }
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
        assert_eq!(grid.len(), 14, "2 tiles * 7 bytes");

        // Tile (0,0): source data
        assert_eq!(grid[0], 5);
        assert_eq!(grid[1], 3);
        assert_eq!(grid[2], 15);

        // Tile (1,0): missing section => 0 sentinel (matches tile_texture_grid)
        assert_eq!(grid[7], 0);
        assert_eq!(grid[8], 0);
        assert_eq!(grid[9], 0);
        assert_eq!(grid[10], 0);
        assert_eq!(grid[11], 0);
        assert_eq!(grid[12], 0);
        assert_eq!(grid[13], 0);
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
    fn test_atlas_baking_real() {
        let project_dir = std::path::Path::new("../top-client");
        let map_path = project_dir.join("map/garner.map");
        if !map_path.exists() {
            return;
        }

        let map_data = std::fs::read(&map_path).unwrap();
        let parsed = super::super::terrain::parse_map(&map_data).unwrap();

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
