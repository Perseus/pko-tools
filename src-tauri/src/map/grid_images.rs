//! Grid-to-PNG image encoding for map export v3.
//!
//! Each function takes raw grid data (as produced by `terrain::build_*_grid`)
//! and writes a PNG image file. The encoding strategies are documented in the
//! plan at `docs/plans/grid-image-export.md`.

use std::path::Path;

use anyhow::{Context, Result};
use image::{GrayImage, RgbImage, RgbaImage};

/// Encode a collision grid (u8: 0=walkable, 1=blocked) as a grayscale PNG.
/// Source 0 → pixel 0 (black), source 1 → pixel 255 (white).
/// Decode contract: pixel < 128 = walkable, pixel >= 128 = blocked.
pub fn encode_collision_png(grid: &[u8], w: i32, h: i32, path: &Path) -> Result<()> {
    let (w, h) = (w as u32, h as u32);
    let mut img = GrayImage::new(w, h);
    for y in 0..h {
        for x in 0..w {
            let idx = (y * w + x) as usize;
            let val = if grid[idx] != 0 { 255u8 } else { 0u8 };
            img.put_pixel(x, y, image::Luma([val]));
        }
    }
    img.save(path)
        .with_context(|| format!("Failed to write collision PNG: {}", path.display()))
}

/// Encode a u8 grid as a grayscale PNG (direct value mapping).
/// Used for area grid (btIsland) and tile_texture grid (bt_tile_info).
pub fn encode_u8_grid_png(grid: &[u8], w: i32, h: i32, path: &Path) -> Result<()> {
    let (w, h) = (w as u32, h as u32);
    let mut img = GrayImage::new(w, h);
    for y in 0..h {
        for x in 0..w {
            let idx = (y * w + x) as usize;
            img.put_pixel(x, y, image::Luma([grid[idx]]));
        }
    }
    img.save(path)
        .with_context(|| format!("Failed to write u8 grid PNG: {}", path.display()))
}

/// Encode an i16 grid (raw LE bytes, 2 bytes per cell) as an RGB8 PNG.
/// i16 → unsigned offset +32768 → R=low byte, G=high byte, B=0.
/// Used for obj_height (millimeters) and region (bitmask).
pub fn encode_i16_grid_png(grid: &[u8], w: i32, h: i32, path: &Path) -> Result<()> {
    let (w, h) = (w as u32, h as u32);
    let mut img = RgbImage::new(w, h);
    for y in 0..h {
        for x in 0..w {
            let byte_idx = ((y * w + x) * 2) as usize;
            let lo = grid[byte_idx];
            let hi = grid[byte_idx + 1];
            let i16_val = i16::from_le_bytes([lo, hi]);
            let u16_val = (i16_val as i32 + 32768) as u16;
            let r = (u16_val & 0xFF) as u8;
            let g = (u16_val >> 8) as u8;
            img.put_pixel(x, y, image::Rgb([r, g, 0]));
        }
    }
    img.save(path)
        .with_context(|| format!("Failed to write i16 grid PNG: {}", path.display()))
}

/// Encode a tile color grid (i16 RGB565 LE bytes, 2 bytes per cell) as an RGB8 PNG.
/// Pre-decodes RGB565 → RGB8 at export time so the PNG is visually meaningful.
pub fn encode_tile_color_png(grid: &[u8], w: i32, h: i32, path: &Path) -> Result<()> {
    let (w, h) = (w as u32, h as u32);
    let mut img = RgbImage::new(w, h);
    for y in 0..h {
        for x in 0..w {
            let byte_idx = ((y * w + x) * 2) as usize;
            let lo = grid[byte_idx];
            let hi = grid[byte_idx + 1];
            let color = u16::from_le_bytes([lo, hi]);
            // RGB565 → RGB8 (same formula as PKO engine LW_RGB565TODWORD)
            let r = ((color & 0xF800) >> 8) as u8; // 5 bits → top 5 of 8
            let g = ((color & 0x07E0) >> 3) as u8; // 6 bits → top 6 of 8
            let b = ((color & 0x001F) << 3) as u8; // 5 bits → top 5 of 8
            img.put_pixel(x, y, image::Rgb([r, g, b]));
        }
    }
    img.save(path)
        .with_context(|| format!("Failed to write tile color PNG: {}", path.display()))
}

/// Encode tile layer grid (7 bytes per tile) into two PNG files:
/// - tile_layer_tex.png: RGBA8 (R=base_tex, G=L1_tex, B=L2_tex, A=L3_tex)
/// - tile_layer_alpha.png: RGB8 (R=L1_alpha, G=L2_alpha, B=L3_alpha)
pub fn encode_tile_layer_pngs(
    grid: &[u8],
    w: i32,
    h: i32,
    tex_path: &Path,
    alpha_path: &Path,
) -> Result<()> {
    let (w, h) = (w as u32, h as u32);
    let mut tex_img = RgbaImage::new(w, h);
    let mut alpha_img = RgbImage::new(w, h);

    for y in 0..h {
        for x in 0..w {
            let base_idx = ((y * w + x) * 7) as usize;
            // Layout: [base_tex, L1_tex, L1_alpha, L2_tex, L2_alpha, L3_tex, L3_alpha]
            let base_tex = grid[base_idx];
            let l1_tex = grid[base_idx + 1];
            let l1_alpha = grid[base_idx + 2];
            let l2_tex = grid[base_idx + 3];
            let l2_alpha = grid[base_idx + 4];
            let l3_tex = grid[base_idx + 5];
            let l3_alpha = grid[base_idx + 6];

            tex_img.put_pixel(x, y, image::Rgba([base_tex, l1_tex, l2_tex, l3_tex]));
            alpha_img.put_pixel(x, y, image::Rgb([l1_alpha, l2_alpha, l3_alpha]));
        }
    }

    tex_img
        .save(tex_path)
        .with_context(|| format!("Failed to write tile layer tex PNG: {}", tex_path.display()))?;
    alpha_img.save(alpha_path).with_context(|| {
        format!(
            "Failed to write tile layer alpha PNG: {}",
            alpha_path.display()
        )
    })
}

/// Encode all grids as PNG images into the given output directory.
/// Creates a `grids/` subdirectory and writes all PNG files.
/// Returns the list of written file paths (relative to output_dir).
pub fn encode_all_grids(
    collision: &(Vec<u8>, i32, i32),
    obj_height: &(Vec<u8>, i32, i32),
    terrain_height: &(Vec<u8>, i32, i32),
    region_bytes: &[u8],
    area_bytes: &[u8],
    tile_tex_bytes: &[u8],
    tile_color_bytes: &[u8],
    tile_layer_bytes: &[u8],
    map_w: i32,
    map_h: i32,
    grids_dir: &Path,
) -> Result<()> {
    std::fs::create_dir_all(grids_dir)?;

    encode_collision_png(
        &collision.0,
        collision.1,
        collision.2,
        &grids_dir.join("collision.png"),
    )?;

    encode_i16_grid_png(
        &obj_height.0,
        obj_height.1,
        obj_height.2,
        &grids_dir.join("obj_height.png"),
    )?;

    encode_i16_grid_png(
        &terrain_height.0,
        terrain_height.1,
        terrain_height.2,
        &grids_dir.join("terrain_height.png"),
    )?;

    encode_i16_grid_png(
        region_bytes,
        map_w,
        map_h,
        &grids_dir.join("region.png"),
    )?;

    encode_u8_grid_png(area_bytes, map_w, map_h, &grids_dir.join("area.png"))?;

    encode_u8_grid_png(
        tile_tex_bytes,
        map_w,
        map_h,
        &grids_dir.join("tile_texture.png"),
    )?;

    encode_tile_color_png(
        tile_color_bytes,
        map_w,
        map_h,
        &grids_dir.join("tile_color.png"),
    )?;

    encode_tile_layer_pngs(
        tile_layer_bytes,
        map_w,
        map_h,
        &grids_dir.join("tile_layer_tex.png"),
        &grids_dir.join("tile_layer_alpha.png"),
    )?;

    Ok(())
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn test_collision_png_round_trip() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("collision.png");

        // 4x4 grid: top-left 2x2 blocked, rest walkable
        let grid: Vec<u8> = vec![
            1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ];

        encode_collision_png(&grid, 4, 4, &path).unwrap();

        let img = image::open(&path).unwrap().into_luma8();
        assert_eq!(img.dimensions(), (4, 4));

        // Blocked cells → 255
        assert_eq!(img.get_pixel(0, 0).0[0], 255);
        assert_eq!(img.get_pixel(1, 0).0[0], 255);
        assert_eq!(img.get_pixel(0, 1).0[0], 255);
        assert_eq!(img.get_pixel(1, 1).0[0], 255);

        // Walkable cells → 0
        assert_eq!(img.get_pixel(2, 0).0[0], 0);
        assert_eq!(img.get_pixel(3, 3).0[0], 0);
    }

    #[test]
    fn test_u8_grid_png_round_trip() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("area.png");

        let grid: Vec<u8> = vec![0, 5, 10, 255, 128, 42, 0, 1, 99];

        encode_u8_grid_png(&grid, 3, 3, &path).unwrap();

        let img = image::open(&path).unwrap().into_luma8();
        assert_eq!(img.dimensions(), (3, 3));

        assert_eq!(img.get_pixel(0, 0).0[0], 0);
        assert_eq!(img.get_pixel(1, 0).0[0], 5);
        assert_eq!(img.get_pixel(2, 0).0[0], 10);
        assert_eq!(img.get_pixel(0, 1).0[0], 255);
        assert_eq!(img.get_pixel(1, 1).0[0], 128);
        assert_eq!(img.get_pixel(2, 2).0[0], 99);
    }

    #[test]
    fn test_i16_grid_png_round_trip() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("height.png");

        // Test specific i16 values: min, -1, 0, 1, max, and a region bitmask
        let test_values: Vec<i16> = vec![-32768, -1, 0, 1, 32767, 0x0007];
        let mut grid_bytes = Vec::new();
        for &val in &test_values {
            grid_bytes.extend_from_slice(&val.to_le_bytes());
        }

        // 6 values in a 3x2 grid
        encode_i16_grid_png(&grid_bytes, 3, 2, &path).unwrap();

        let img = image::open(&path).unwrap().into_rgb8();
        assert_eq!(img.dimensions(), (3, 2));

        // Verify round-trip for each value
        for (i, &expected) in test_values.iter().enumerate() {
            let x = (i % 3) as u32;
            let y = (i / 3) as u32;
            let pixel = img.get_pixel(x, y);
            let raw = pixel.0[0] as u16 + pixel.0[1] as u16 * 256;
            let decoded = (raw as i32 - 32768) as i16;
            assert_eq!(
                decoded, expected,
                "i16 round-trip failed for value {} at ({}, {}): got {}",
                expected, x, y, decoded
            );
        }
    }

    #[test]
    fn test_tile_color_png_round_trip() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("tile_color.png");

        // Test known RGB565 values
        // Pure red: 0xF800, pure green: 0x07E0, pure blue: 0x001F, white: 0xFFFF
        let test_colors: Vec<u16> = vec![0xF800, 0x07E0, 0x001F, 0xFFFF];
        let mut grid_bytes = Vec::new();
        for &c in &test_colors {
            grid_bytes.extend_from_slice(&c.to_le_bytes());
        }

        encode_tile_color_png(&grid_bytes, 2, 2, &path).unwrap();

        let img = image::open(&path).unwrap().into_rgb8();
        assert_eq!(img.dimensions(), (2, 2));

        // Pure red (0xF800): R=0xF8, G=0, B=0
        let p = img.get_pixel(0, 0).0;
        assert_eq!(p[0], 0xF8);
        assert_eq!(p[1], 0);
        assert_eq!(p[2], 0);

        // Pure green (0x07E0): R=0, G=0xFC, B=0
        let p = img.get_pixel(1, 0).0;
        assert_eq!(p[0], 0);
        assert_eq!(p[1], 0xFC);
        assert_eq!(p[2], 0);

        // Pure blue (0x001F): R=0, G=0, B=0xF8
        let p = img.get_pixel(0, 1).0;
        assert_eq!(p[0], 0);
        assert_eq!(p[1], 0);
        assert_eq!(p[2], 0xF8);

        // White (0xFFFF): R=0xF8, G=0xFC, B=0xF8
        let p = img.get_pixel(1, 1).0;
        assert_eq!(p[0], 0xF8);
        assert_eq!(p[1], 0xFC);
        assert_eq!(p[2], 0xF8);
    }

    #[test]
    fn test_tile_layer_pngs_round_trip() {
        let tmp = TempDir::new().unwrap();
        let tex_path = tmp.path().join("tile_layer_tex.png");
        let alpha_path = tmp.path().join("tile_layer_alpha.png");

        // 2x2 grid, 7 bytes per tile
        // Tile (0,0): base=1, L1t=2, L1a=3, L2t=4, L2a=5, L3t=6, L3a=7
        // Tile (1,0): base=10, L1t=11, L1a=12, L2t=13, L2a=14, L3t=15, L3a=0
        // Tile (0,1): base=0, all zeros
        // Tile (1,1): base=22, L1t=0, L1a=0, L2t=0, L2a=0, L3t=0, L3a=0
        let grid: Vec<u8> = vec![
            1, 2, 3, 4, 5, 6, 7, // tile (0,0)
            10, 11, 12, 13, 14, 15, 0, // tile (1,0)
            0, 0, 0, 0, 0, 0, 0, // tile (0,1)
            22, 0, 0, 0, 0, 0, 0, // tile (1,1)
        ];

        encode_tile_layer_pngs(&grid, 2, 2, &tex_path, &alpha_path).unwrap();

        let tex_img = image::open(&tex_path).unwrap().into_rgba8();
        let alpha_img = image::open(&alpha_path).unwrap().into_rgb8();
        assert_eq!(tex_img.dimensions(), (2, 2));
        assert_eq!(alpha_img.dimensions(), (2, 2));

        // Tile (0,0): tex RGBA = (1,2,4,6), alpha RGB = (3,5,7)
        let p = tex_img.get_pixel(0, 0).0;
        assert_eq!(p, [1, 2, 4, 6]);
        let p = alpha_img.get_pixel(0, 0).0;
        assert_eq!(p, [3, 5, 7]);

        // Tile (1,0): tex RGBA = (10,11,13,15), alpha RGB = (12,14,0)
        let p = tex_img.get_pixel(1, 0).0;
        assert_eq!(p, [10, 11, 13, 15]);
        let p = alpha_img.get_pixel(1, 0).0;
        assert_eq!(p, [12, 14, 0]);

        // Tile (1,1): tex RGBA = (22,0,0,0)
        let p = tex_img.get_pixel(1, 1).0;
        assert_eq!(p, [22, 0, 0, 0]);
    }

    #[test]
    fn test_i16_extreme_values() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("extremes.png");

        // Exhaustive edge cases for the i16 encoding
        let test_values: Vec<i16> = vec![
            i16::MIN,     // -32768
            i16::MIN + 1, // -32767
            -1000,
            -1,
            0,
            1,
            1000,
            i16::MAX - 1, // 32766
            i16::MAX,     // 32767
        ];
        let mut grid_bytes = Vec::new();
        for &val in &test_values {
            grid_bytes.extend_from_slice(&val.to_le_bytes());
        }

        // 9 values in a 3x3 grid
        encode_i16_grid_png(&grid_bytes, 3, 3, &path).unwrap();

        let img = image::open(&path).unwrap().into_rgb8();
        for (i, &expected) in test_values.iter().enumerate() {
            let x = (i % 3) as u32;
            let y = (i / 3) as u32;
            let pixel = img.get_pixel(x, y);
            let raw = pixel.0[0] as u16 + pixel.0[1] as u16 * 256;
            let decoded = (raw as i32 - 32768) as i16;
            assert_eq!(decoded, expected, "Failed for value {}", expected);
        }
    }
}
