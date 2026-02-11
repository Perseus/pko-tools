use std::collections::{HashMap, HashSet};
use std::path::Path;

use anyhow::Result;
use image::{DynamicImage, GenericImageView, Pixel};

use super::terrain::ParsedMap;
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
    image::load_from_memory(&decoded).ok()
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
    // Alpha mask is grayscale — use the red channel
    pixel[0] as f32 / 255.0
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

    let default_color = image::Rgb([128u8, 128, 128]);

    for ty in 0..map_h {
        for tx in 0..map_w {
            let tile = match super::terrain::get_tile(parsed_map, tx as i32, ty as i32) {
                Some(t) => t,
                None => {
                    // Fill tile region with default
                    for py in 0..tile_sz {
                        for px in 0..tile_sz {
                            atlas.put_pixel(
                                tx * tile_sz + px,
                                ty * tile_sz + py,
                                default_color,
                            );
                        }
                    }
                    continue;
                }
            };

            let layers = unpack_tile_layers(tile.bt_tile_info, tile.dw_tile_info);

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
                                if layer.alpha == 15 { 1.0 } else { 0.5 }
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
        }
    }

    ids
}

/// Attempt to load TerrainInfo.bin, load referenced textures, and bake an atlas.
/// Returns None if TerrainInfo.bin is missing or textures can't be loaded.
pub fn try_bake_atlas(
    project_dir: &Path,
    parsed_map: &ParsedMap,
) -> Option<image::RgbImage> {
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

    Some(bake_terrain_atlas(parsed_map, &tex_images, alpha_atlas.as_ref()))
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

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
}
