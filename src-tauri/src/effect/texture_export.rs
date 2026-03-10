//! Effect texture discovery and conversion to PNG.
//!
//! Scans .eff and .par files for texture name references, resolves them
//! against the `texture/effect/` directory (case-insensitive), and converts
//! DDS/TGA/BMP to RGBA PNG using the existing decode pipeline.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use anyhow::Result;

use crate::item::model::decode_pko_texture;
use crate::map::scene_model::decode_dds_with_alpha;

use super::model::{EffFile, ParFile};

/// Collect all unique texture names referenced by .eff and .par files.
pub fn collect_texture_names(
    effect_dir: &Path,
) -> Result<HashSet<String>> {
    let mut names = HashSet::new();

    for entry in std::fs::read_dir(effect_dir)?.filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        let data = match std::fs::read(&path) {
            Ok(d) => d,
            Err(_) => continue,
        };

        match ext.as_str() {
            "eff" => {
                if let Ok(eff) = EffFile::from_bytes(&data) {
                    collect_eff_textures(&eff, &mut names);
                }
            }
            "par" => {
                if let Ok(par) = ParFile::from_bytes(&data) {
                    collect_par_textures(&par, &mut names);
                }
            }
            _ => {}
        }
    }

    Ok(names)
}

/// Extract texture names from an EFF file.
fn collect_eff_textures(eff: &EffFile, names: &mut HashSet<String>) {
    for sub in &eff.sub_effects {
        add_name(names, &sub.tex_name);
        for name in &sub.frame_tex_names {
            add_name(names, name);
        }
    }
}

/// Extract texture names from a PAR file.
fn collect_par_textures(par: &ParFile, names: &mut HashSet<String>) {
    for sys in &par.systems {
        add_name(names, &sys.texture_name);
    }
    for strip in &par.strips {
        add_name(names, &strip.texture_name);
    }
}

/// Add a non-empty, lowercased texture name to the set.
fn add_name(names: &mut HashSet<String>, name: &str) {
    let trimmed = name.trim();
    if !trimmed.is_empty() {
        names.insert(trimmed.to_lowercase());
    }
}

/// Build a case-insensitive lookup map from the texture/effect/ directory.
/// Returns a map from lowercase filename → actual path on disk.
fn build_texture_lookup(texture_dir: &Path) -> Result<std::collections::HashMap<String, PathBuf>> {
    let mut map = std::collections::HashMap::new();

    if !texture_dir.exists() {
        return Ok(map);
    }

    for entry in std::fs::read_dir(texture_dir)?.filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.is_file() {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                map.insert(name.to_lowercase(), path);
            }
        }
    }

    Ok(map)
}

/// Decode a texture file to an RGBA image.
/// Handles PKO encoding, DDS (including DXT1 alpha), TGA (including non-standard variants),
/// and standard image formats.
///
/// `ext` should be the lowercase file extension (e.g., "tga", "dds", "bmp").
fn decode_texture_to_image(data: &[u8], ext: &str) -> Option<image::DynamicImage> {
    // Step 1: Undo PKO mp.x encoding if present
    let decoded = decode_pko_texture(data);

    // Step 2: Try DDS with alpha-aware decode (handles DXT1 punch-through)
    if let Some(img) = decode_dds_with_alpha(&decoded) {
        return Some(img);
    }

    // Step 3: Try format-specific decode with the image crate
    let format = match ext {
        "tga" => Some(image::ImageFormat::Tga),
        "bmp" => Some(image::ImageFormat::Bmp),
        "png" => Some(image::ImageFormat::Png),
        "dds" => Some(image::ImageFormat::Dds),
        _ => None,
    };

    if let Some(fmt) = format {
        if let Ok(img) = image::load_from_memory_with_format(&decoded, fmt) {
            return Some(img);
        }
    }

    // Step 4: Try auto-detection
    if let Ok(img) = image::load_from_memory(&decoded) {
        return Some(img);
    }

    // Step 5: PKO non-standard TGA variants (same logic as commands.rs)
    const PKO_TGA_FOOTER_SIZE: usize = 48;
    if decoded.len() > PKO_TGA_FOOTER_SIZE {
        let footer_start = decoded.len() - PKO_TGA_FOOTER_SIZE;
        let has_tga_footer =
            decoded[footer_start + 1] <= 1 && decoded[footer_start + 2] == 2;

        if has_tga_footer {
            // Variant 1: ARGB pixels before the footer
            if let Some(img) = try_decode_raw_pixels(&decoded[..footer_start], true) {
                return Some(img);
            }
        }

        // Variant 2: 48-byte header + BGRA pixels
        if let Some(img) = try_decode_raw_pixels(&decoded[PKO_TGA_FOOTER_SIZE..], false) {
            return Some(img);
        }
    }

    None
}

/// Try to decode raw pixel data as ARGB (variant 1) or BGRA (variant 2).
fn try_decode_raw_pixels(pixel_data: &[u8], is_argb: bool) -> Option<image::DynamicImage> {
    let len = pixel_data.len();

    // Try 4bpp first, then 3bpp
    for bpp in [4u8, 3u8] {
        let bpp_usize = bpp as usize;
        if len % bpp_usize != 0 {
            continue;
        }
        let pixel_count = len / bpp_usize;
        if let Some((w, h)) = guess_power_of_two_dims(pixel_count) {
            let mut rgba = Vec::with_capacity(w * h * 4);

            if bpp == 4 {
                for chunk in pixel_data.chunks_exact(4) {
                    if is_argb {
                        // ARGB → RGBA
                        rgba.push(chunk[1]); // R
                        rgba.push(chunk[2]); // G
                        rgba.push(chunk[3]); // B
                        rgba.push(chunk[0]); // A
                    } else {
                        // BGRA → RGBA
                        rgba.push(chunk[2]); // R
                        rgba.push(chunk[1]); // G
                        rgba.push(chunk[0]); // B
                        rgba.push(chunk[3]); // A
                    }
                }
            } else {
                for chunk in pixel_data.chunks_exact(3) {
                    if is_argb {
                        rgba.push(chunk[0]);
                        rgba.push(chunk[1]);
                        rgba.push(chunk[2]);
                    } else {
                        rgba.push(chunk[2]);
                        rgba.push(chunk[1]);
                        rgba.push(chunk[0]);
                    }
                    rgba.push(255);
                }
            }

            if let Some(img_buf) = image::RgbaImage::from_raw(w as u32, h as u32, rgba) {
                return Some(image::DynamicImage::ImageRgba8(img_buf));
            }
        }
    }

    None
}

/// Guess power-of-two texture dimensions from pixel count.
fn guess_power_of_two_dims(pixel_count: usize) -> Option<(usize, usize)> {
    let powers: &[usize] = &[16, 32, 64, 128, 256, 512, 1024];

    // Prefer closest to square, both pow2
    let mut best: Option<(usize, usize, usize)> = None; // (w, h, ratio)
    for &w in powers {
        if pixel_count % w == 0 {
            let h = pixel_count / w;
            if powers.contains(&h) {
                let ratio = if w >= h { w / h } else { h / w };
                if best.is_none() || ratio < best.unwrap().2 {
                    // Canonicalize so w >= h
                    if w >= h {
                        best = Some((w, h, ratio));
                    } else {
                        best = Some((h, w, ratio));
                    }
                }
            }
        }
    }

    best.map(|(w, h, _)| (w, h))
}

/// Export all referenced effect textures to PNG.
/// Returns (success_count, skipped_count, error_count).
pub fn export_effect_textures(
    effect_dir: &Path,
    texture_dir: &Path,
    output_dir: &Path,
) -> Result<(usize, usize, usize)> {
    let tex_out = output_dir.join("textures");
    std::fs::create_dir_all(&tex_out)?;

    // Collect referenced texture names
    let names = collect_texture_names(effect_dir)?;
    eprintln!("Found {} unique texture references", names.len());

    // Build case-insensitive lookup
    let lookup = build_texture_lookup(texture_dir)?;
    eprintln!("Found {} texture files on disk", lookup.len());

    let mut success = 0usize;
    let mut skipped = 0usize;
    let mut errors = 0usize;

    for name in &names {
        // Try to resolve the texture file
        let resolved = lookup.get(name.as_str());

        let source_path = match resolved {
            Some(p) => p.clone(),
            None => {
                // Try with common extensions
                let base = name
                    .strip_suffix(".tga")
                    .or_else(|| name.strip_suffix(".dds"))
                    .or_else(|| name.strip_suffix(".bmp"))
                    .or_else(|| name.strip_suffix(".png"))
                    .unwrap_or(name);

                let found = ["tga", "dds", "bmp", "png"]
                    .iter()
                    .find_map(|ext| {
                        let key = format!("{}.{}", base, ext);
                        lookup.get(&key).cloned()
                    });

                match found {
                    Some(p) => p,
                    None => {
                        skipped += 1;
                        continue;
                    }
                }
            }
        };

        // Read and decode
        let raw_bytes = match std::fs::read(&source_path) {
            Ok(b) => b,
            Err(e) => {
                eprintln!("WARN: failed to read {}: {}", source_path.display(), e);
                errors += 1;
                continue;
            }
        };

        let source_ext = source_path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        let img = match decode_texture_to_image(&raw_bytes, &source_ext) {
            Some(img) => img,
            None => {
                eprintln!("WARN: failed to decode {}", source_path.display());
                errors += 1;
                continue;
            }
        };

        // Write as PNG. Use the original name with its extension replaced by .png.
        // If the name has no recognized extension, just append .png.
        let base = name
            .strip_suffix(".tga")
            .or_else(|| name.strip_suffix(".dds"))
            .or_else(|| name.strip_suffix(".bmp"))
            .unwrap_or(name);
        let out_path = tex_out.join(format!("{}.png", base));

        match img.to_rgba8().save(&out_path) {
            Ok(_) => success += 1,
            Err(e) => {
                eprintln!("WARN: failed to write {}: {}", out_path.display(), e);
                errors += 1;
            }
        }
    }

    Ok((success, skipped, errors))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn collect_texture_names_from_corpus() {
        let eff_dir = Path::new("../top-client/effect");
        if !eff_dir.exists() {
            eprintln!("Skipping: ../top-client/effect not found");
            return;
        }

        let names = collect_texture_names(eff_dir).unwrap();
        assert!(!names.is_empty(), "Expected at least 1 texture reference");
        eprintln!("Collected {} unique texture names from corpus", names.len());

        // All names should be lowercase and non-empty
        for name in &names {
            assert!(!name.is_empty());
            assert_eq!(name, &name.to_lowercase());
        }
    }

    #[test]
    fn export_textures_from_corpus() {
        let eff_dir = Path::new("../top-client/effect");
        let tex_dir = Path::new("../top-client/texture/effect");
        if !eff_dir.exists() || !tex_dir.exists() {
            eprintln!("Skipping: corpus directories not found");
            return;
        }

        let tmp = tempfile::tempdir().unwrap();
        let (success, skipped, errors) =
            export_effect_textures(eff_dir, tex_dir, tmp.path()).unwrap();

        eprintln!(
            "Texture export: {} success, {} skipped (not on disk), {} errors",
            success, skipped, errors
        );

        assert!(success > 0, "Expected at least 1 texture exported");
        // Allow up to 5% errors — some textures are 8-bit paletted TGA (type 1)
        // which the image crate may not fully support. 27/887 ≈ 3% in current corpus.
        let error_rate = errors as f64 / (success + errors) as f64;
        assert!(
            error_rate < 0.05,
            "Error rate {:.1}% ({} errors) exceeds 5% threshold",
            error_rate * 100.0,
            errors
        );

        // Verify output files exist and are valid PNG
        let tex_out = tmp.path().join("textures");
        let png_count = std::fs::read_dir(&tex_out)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.path()
                    .extension()
                    .map_or(false, |ext| ext == "png")
            })
            .count();

        // PNG count may be less than success count due to name collisions
        // (e.g., "fire01" and "fire01.tga" both write to "fire01.png")
        assert!(png_count > 0, "Expected at least 1 PNG output file");
        assert!(
            png_count <= success,
            "PNG count {} exceeds success count {}",
            png_count,
            success
        );
    }

    #[test]
    fn guess_dims_square() {
        assert_eq!(guess_power_of_two_dims(256 * 256), Some((256, 256)));
        assert_eq!(guess_power_of_two_dims(128 * 128), Some((128, 128)));
    }

    #[test]
    fn guess_dims_rectangular() {
        assert_eq!(guess_power_of_two_dims(256 * 128), Some((256, 128)));
    }

    #[test]
    fn guess_dims_invalid() {
        assert_eq!(guess_power_of_two_dims(7), None);
        assert_eq!(guess_power_of_two_dims(0), None);
    }
}
