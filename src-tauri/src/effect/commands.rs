use std::path::Path;
use std::str::FromStr;

use base64::Engine;
use gltf::json::{
    accessor::{ComponentType, GenericComponentType},
    animation::{Channel, Sampler, Target},
    validation::{Checked, USize64},
};
use serde::Serialize;

use crate::character::{model::CharacterGeometricModel, GLTFFieldsToAggregate};
use crate::item::model::decode_pko_texture;
use crate::map::lmo_types::LmoBoneAnimData;
use crate::map::scene_model::decode_dds_with_alpha;
use crate::projects::project::Project;

use super::{model::EffFile, model::ParFile, scan_effects_directory, scan_par_files};
// Effect data is in D3D Y-up LH space. Transforms match Three.js "YXZ" Euler
// directly (confirmed via matrix comparison with game client debug dumps).
// No coordinate conversion needed for standalone viewing.
const EFFECT_MODEL_ANIMATION_FPS: f32 = 30.0;

#[tauri::command]
pub async fn list_effects(project_id: String) -> Result<Vec<String>, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    scan_effects_directory(project.project_directory.as_ref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn load_effect(project_id: String, effect_name: String) -> Result<EffFile, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;
    let effect_path = effect_file_path(project.project_directory.as_ref(), &effect_name);

    let bytes = std::fs::read(&effect_path).map_err(|e| {
        format!(
            "Failed to read effect file {}: {}",
            effect_path.display(),
            e
        )
    })?;
    EffFile::from_bytes(&bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_effect(
    project_id: String,
    effect_name: String,
    effect: EffFile,
) -> Result<(), String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;
    let effect_path = effect_file_path(project.project_directory.as_ref(), &effect_name);

    if let Some(parent) = effect_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create effect directory: {}", e))?;
    }

    let bytes = effect.to_bytes().map_err(|e| e.to_string())?;
    std::fs::write(&effect_path, bytes).map_err(|e| {
        format!(
            "Failed to write effect file {}: {}",
            effect_path.display(),
            e
        )
    })?;

    Ok(())
}

#[tauri::command]
pub async fn load_par_file(project_id: String, par_name: String) -> Result<ParFile, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;
    let par_path = par_file_path(project.project_directory.as_ref(), &par_name);

    let bytes = std::fs::read(&par_path)
        .map_err(|e| format!("Failed to read par file {}: {}", par_path.display(), e))?;
    ParFile::from_bytes(&bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_par_files(project_id: String) -> Result<Vec<String>, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    scan_par_files(project.project_directory.as_ref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn load_texture_bytes(path: String) -> Result<String, String> {
    let bytes =
        std::fs::read(&path).map_err(|e| format!("Failed to read texture {}: {}", path, e))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[derive(Serialize)]
pub struct DecodedTexture {
    pub width: u32,
    pub height: u32,
    pub data: String, // base64-encoded RGBA pixels
}

/// Decode a texture file to raw RGBA pixels.
/// Handles standard formats (TGA, BMP, PNG, DDS) via the `image` crate,
/// plus the non-standard PKO TGA format (48-byte header + raw BGRA pixels).
#[tauri::command]
pub async fn decode_texture(path: String) -> Result<DecodedTexture, String> {
    let resolved = resolve_case_insensitive(&path).unwrap_or_else(|| path.clone().into());
    let raw_bytes =
        std::fs::read(&resolved).map_err(|e| format!("Failed to read texture {}: {}", path, e))?;
    let bytes = decode_pko_texture(&raw_bytes);

    if let Some(img) = decode_dds_with_alpha(&bytes) {
        return Ok(decoded_texture_from_image(img));
    }

    // Try standard image decoding first (handles valid TGA, BMP, PNG, etc.)
    let ext = path.rsplit('.').next().unwrap_or("").to_lowercase();
    let format = match ext.as_str() {
        "tga" => Some(image::ImageFormat::Tga),
        "bmp" => Some(image::ImageFormat::Bmp),
        "png" => Some(image::ImageFormat::Png),
        "dds" => Some(image::ImageFormat::Dds),
        _ => None,
    };

    if let Some(fmt) = format {
        if let Ok(img) = image::load_from_memory_with_format(&bytes, fmt) {
            return Ok(decoded_texture_from_image(img));
        }
    }
    // Also try auto-detection
    if let Ok(img) = image::load_from_memory(&bytes) {
        return Ok(decoded_texture_from_image(img));
    }

    // Fallback: paletted (color-mapped) TGA.
    // image crate v0.25 doesn't handle type 1 (color-mapped) TGA files.
    // These have a palette (color map) followed by 8-bit pixel indices.
    if let Some(result) = try_decode_paletted_tga(&bytes) {
        return Ok(result);
    }

    // Fallback: PKO non-standard TGA formats.
    //
    // Variant 1 (ARGB with TGA footer):
    //   Raw ARGB pixel data followed by a 48-byte footer containing a standard TGA
    //   header fragment. Detected by checking if the last 48 bytes start with a valid
    //   TGA header (color_map_type <= 1 and image_type == 2).
    //
    // Variant 2 (BGRA with header):
    //   48-byte header (junk + "TRUEVISION-XFILE.\0" + padding) followed by BGRA pixels.
    const PKO_TGA_FOOTER_SIZE: usize = 48;
    if bytes.len() > PKO_TGA_FOOTER_SIZE {
        let footer_start = bytes.len() - PKO_TGA_FOOTER_SIZE;
        let has_tga_footer = bytes[footer_start + 1] <= 1 && bytes[footer_start + 2] == 2;

        if has_tga_footer {
            // Variant 1: pixel data is bytes 0..footer_start in ARGB format
            if let Some(result) = try_decode_pko_tga_argb(&bytes[..footer_start]) {
                return Ok(result);
            }
        }

        // Variant 2: skip 48-byte header, pixel data in BGRA format
        if let Some(result) = try_decode_pko_tga(&bytes[PKO_TGA_FOOTER_SIZE..]) {
            return Ok(result);
        }
    }

    Err(format!("Unable to decode texture: {}", path))
}

fn decoded_texture_from_image(img: image::DynamicImage) -> DecodedTexture {
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    let data = base64::engine::general_purpose::STANDARD.encode(rgba.as_raw());
    DecodedTexture {
        width: w,
        height: h,
        data,
    }
}

/// Try decoding raw PKO pixel data at both 4bpp (BGRA) and 3bpp (BGR).
/// Picks whichever bpp yields the best (closest-to-square, both-pow2) dimensions.
fn try_decode_pko_tga(pixel_data: &[u8]) -> Option<DecodedTexture> {
    let len = pixel_data.len();

    // Score dimension quality: both pow2 = 2, one pow2 = 1, neither = 0
    let score = |w: usize, h: usize| -> u32 {
        let w_pow2 = w.is_power_of_two() && w >= 16;
        let h_pow2 = h.is_power_of_two() && h >= 16;
        let ratio = if w >= h { w / h.max(1) } else { h / w.max(1) };
        let mut s: u32 = 0;
        if w_pow2 {
            s += 10;
        }
        if h_pow2 {
            s += 10;
        }
        // Prefer smaller aspect ratio (closer to square)
        if ratio <= 2 {
            s += 5;
        } else if ratio <= 4 {
            s += 3;
        } else if ratio <= 8 {
            s += 1;
        }
        s
    };

    let mut best: Option<(u32, usize, usize, u8)> = None; // (score, w, h, bpp)

    for bpp in [4u8, 3u8] {
        let bpp_usize = bpp as usize;
        if len % bpp_usize != 0 {
            continue;
        }
        let pixel_count = len / bpp_usize;
        if let Some((w, h)) = guess_texture_dimensions(pixel_count) {
            let s = score(w, h);
            if best.is_none() || s > best.unwrap().0 {
                best = Some((s, w, h, bpp));
            }
        }
    }

    let (_, w, h, bpp) = best?;
    let mut rgba = Vec::with_capacity(w * h * 4);

    if bpp == 4 {
        for chunk in pixel_data.chunks_exact(4) {
            rgba.push(chunk[2]); // R
            rgba.push(chunk[1]); // G
            rgba.push(chunk[0]); // B
            rgba.push(chunk[3]); // A
        }
    } else {
        for chunk in pixel_data.chunks_exact(3) {
            rgba.push(chunk[2]); // R
            rgba.push(chunk[1]); // G
            rgba.push(chunk[0]); // B
            rgba.push(255); // A
        }
    }

    let data = base64::engine::general_purpose::STANDARD.encode(&rgba);
    Some(DecodedTexture {
        width: w as u32,
        height: h as u32,
        data,
    })
}

/// Try decoding raw PKO pixel data stored in ARGB format (variant 1).
/// Used when the file has pixel data followed by a TGA header footer.
fn try_decode_pko_tga_argb(pixel_data: &[u8]) -> Option<DecodedTexture> {
    let len = pixel_data.len();

    let score = |w: usize, h: usize| -> u32 {
        let w_pow2 = w.is_power_of_two() && w >= 16;
        let h_pow2 = h.is_power_of_two() && h >= 16;
        let ratio = if w >= h { w / h.max(1) } else { h / w.max(1) };
        let mut s: u32 = 0;
        if w_pow2 {
            s += 10;
        }
        if h_pow2 {
            s += 10;
        }
        if ratio <= 2 {
            s += 5;
        } else if ratio <= 4 {
            s += 3;
        } else if ratio <= 8 {
            s += 1;
        }
        s
    };

    let mut best: Option<(u32, usize, usize, u8)> = None;

    for bpp in [4u8, 3u8] {
        let bpp_usize = bpp as usize;
        if len % bpp_usize != 0 {
            continue;
        }
        let pixel_count = len / bpp_usize;
        if let Some((w, h)) = guess_texture_dimensions(pixel_count) {
            let s = score(w, h);
            if best.is_none() || s > best.unwrap().0 {
                best = Some((s, w, h, bpp));
            }
        }
    }

    let (_, w, h, bpp) = best?;
    let mut rgba = Vec::with_capacity(w * h * 4);

    if bpp == 4 {
        // ARGB → RGBA
        for chunk in pixel_data.chunks_exact(4) {
            rgba.push(chunk[1]); // R
            rgba.push(chunk[2]); // G
            rgba.push(chunk[3]); // B
            rgba.push(chunk[0]); // A
        }
    } else {
        // 3bpp: treat as RGB (no alpha byte present)
        for chunk in pixel_data.chunks_exact(3) {
            rgba.push(chunk[0]); // R
            rgba.push(chunk[1]); // G
            rgba.push(chunk[2]); // B
            rgba.push(255); // A
        }
    }

    let data = base64::engine::general_purpose::STANDARD.encode(&rgba);
    Some(DecodedTexture {
        width: w as u32,
        height: h as u32,
        data,
    })
}

/// Decode a paletted (color-mapped) TGA file (image_type = 1).
/// Layout:
///   18 bytes: TGA header
///   id_length bytes: image ID (usually 0)
///   palette_length * (palette_bpp / 8) bytes: palette in BGR(A) order
///   width * height bytes: 8-bit pixel indices
///   optional 26-byte TGA 2.0 footer ("TRUEVISION-XFILE.\0")
fn try_decode_paletted_tga(bytes: &[u8]) -> Option<DecodedTexture> {
    if bytes.len() < 18 {
        return None;
    }

    let id_length = bytes[0] as usize;
    let color_map_type = bytes[1];
    let image_type = bytes[2];

    // Only handle color-mapped, uncompressed (type 1)
    if color_map_type != 1 || image_type != 1 {
        return None;
    }

    let palette_start = u16::from_le_bytes([bytes[3], bytes[4]]) as usize;
    let palette_length = u16::from_le_bytes([bytes[5], bytes[6]]) as usize;
    let palette_bpp = bytes[7] as usize; // bits per palette entry (usually 24 or 32)
    let width = u16::from_le_bytes([bytes[12], bytes[13]]) as usize;
    let height = u16::from_le_bytes([bytes[14], bytes[15]]) as usize;
    let pixel_depth = bytes[16] as usize; // bits per pixel index (should be 8)
    let descriptor = bytes[17];

    if pixel_depth != 8 || (palette_bpp != 24 && palette_bpp != 32) {
        return None;
    }
    if width == 0 || height == 0 || palette_length == 0 {
        return None;
    }

    let palette_bytes_per_entry = palette_bpp / 8;
    let header_end = 18 + id_length;
    let palette_data_start = header_end;
    let palette_data_end = palette_data_start + palette_length * palette_bytes_per_entry;
    let pixel_data_start = palette_data_end;
    let pixel_data_end = pixel_data_start + width * height;

    if bytes.len() < pixel_data_end {
        return None;
    }

    // Parse palette (BGR or BGRA order)
    let palette = &bytes[palette_data_start..palette_data_end];
    let pixel_data = &bytes[pixel_data_start..pixel_data_end];

    let mut rgba = Vec::with_capacity(width * height * 4);
    for &idx in pixel_data {
        let actual_idx = (idx as usize).saturating_sub(palette_start);
        if actual_idx >= palette_length {
            // Out-of-range index: transparent black
            rgba.extend_from_slice(&[0, 0, 0, 0]);
            continue;
        }
        let offset = actual_idx * palette_bytes_per_entry;
        let b = palette[offset];
        let g = palette[offset + 1];
        let r = palette[offset + 2];
        let a = if palette_bytes_per_entry == 4 {
            palette[offset + 3]
        } else {
            255
        };
        rgba.extend_from_slice(&[r, g, b, a]);
    }

    // TGA origin: check bit 5 of descriptor for top-to-bottom
    let top_to_bottom = (descriptor & 0x20) != 0;
    if !top_to_bottom {
        // Default TGA is bottom-to-top; flip vertically
        let row_bytes = width * 4;
        let mut flipped = vec![0u8; rgba.len()];
        for y in 0..height {
            let src_row = y * row_bytes;
            let dst_row = (height - 1 - y) * row_bytes;
            flipped[dst_row..dst_row + row_bytes]
                .copy_from_slice(&rgba[src_row..src_row + row_bytes]);
        }
        rgba = flipped;
    }

    let data = base64::engine::general_purpose::STANDARD.encode(&rgba);
    Some(DecodedTexture {
        width: width as u32,
        height: height as u32,
        data,
    })
}

/// Guess texture dimensions from pixel count.
/// Finds all valid power-of-2 dimension pairs and picks the one closest to square.
/// Falls back to pow2 width with any reasonable even height.
fn guess_texture_dimensions(pixel_count: usize) -> Option<(usize, usize)> {
    let powers: &[usize] = &[16, 32, 64, 128, 256, 512, 1024];

    // Collect all valid (w, h) pairs where both are powers of 2
    let mut candidates: Vec<(usize, usize)> = Vec::new();
    for &w in powers {
        if pixel_count % w == 0 {
            let h = pixel_count / w;
            if powers.contains(&h) && w >= h {
                candidates.push((w, h));
            }
        }
    }

    // Pick the pair with the smallest aspect ratio (closest to square)
    if !candidates.is_empty() {
        candidates.sort_by_key(|&(w, h)| w / h.max(1));
        return Some(candidates[0]);
    }

    // Fallback: pow2 width, any reasonable even height, prefer closest to square
    let mut fallback: Vec<(usize, usize)> = Vec::new();
    for &w in powers {
        if pixel_count % w == 0 {
            let h = pixel_count / w;
            if h >= 1 && h <= 2048 && w >= h {
                fallback.push((w, h));
            }
        }
    }
    if !fallback.is_empty() {
        fallback.sort_by_key(|&(w, h)| w / h.max(1));
        return Some(fallback[0]);
    }

    None
}

/// Resolve a file path using case-insensitive matching on the filename component.
/// PKO is a Windows game where paths are case-insensitive, but macOS/Linux may
/// have case-sensitive filesystems. If the exact path doesn't exist, scan the
/// parent directory for a case-insensitive match.
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

// TODO: Inverse remap (Y-up -> PKO Z-up) needed here once editing is supported.
// The frontend now holds Y-up data; writing it directly produces incorrect PKO files.
#[tauri::command]
pub async fn save_particles(
    project_id: String,
    effect_name: String,
    particles: serde_json::Value,
) -> Result<(), String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;
    let path = particles_file_path(project.project_directory.as_ref(), &effect_name);

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    let json = serde_json::to_string_pretty(&particles)
        .map_err(|e| format!("Failed to serialize particles: {}", e))?;
    std::fs::write(&path, json)
        .map_err(|e| format!("Failed to write particles file {}: {}", path.display(), e))?;

    Ok(())
}

#[tauri::command]
pub async fn load_particles(
    project_id: String,
    effect_name: String,
) -> Result<Option<serde_json::Value>, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;
    let path = particles_file_path(project.project_directory.as_ref(), &effect_name);

    if !path.exists() {
        return Ok(None);
    }

    let contents = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read particles file {}: {}", path.display(), e))?;
    let value: serde_json::Value = serde_json::from_str(&contents)
        .map_err(|e| format!("Failed to parse particles JSON: {}", e))?;

    Ok(Some(value))
}

#[tauri::command]
pub async fn list_texture_files(project_id: String) -> Result<Vec<String>, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;
    let project_dir = project.project_directory.as_ref();

    let texture_dirs = [
        "texture/effect",
        "texture/skill",
        "texture/lit",
        "texture/sceneffect",
    ];

    let extensions = ["tga", "dds", "bmp", "png"];
    let mut files = Vec::new();

    for dir in &texture_dirs {
        let full_path = project_dir.join(dir);
        if !full_path.exists() {
            continue;
        }
        if let Ok(entries) = std::fs::read_dir(&full_path) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_file() {
                    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                        if extensions.contains(&ext.to_lowercase().as_str()) {
                            if let Some(name) =
                                path.strip_prefix(project_dir).ok().and_then(|p| p.to_str())
                            {
                                files.push(name.to_string());
                            }
                        }
                    }
                }
            }
        }
    }

    files.sort();
    Ok(files)
}

#[tauri::command]
pub async fn load_path_file(
    project_id: String,
    path_name: String,
) -> Result<Vec<[f32; 3]>, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    let file_name = if path_name.ends_with(".csf") {
        path_name.clone()
    } else {
        format!("{}.csf", path_name)
    };

    let path = project.project_directory.join("effect").join(&file_name);
    let resolved = resolve_case_insensitive(path.to_str().unwrap_or("")).unwrap_or(path);

    let bytes = std::fs::read(&resolved)
        .map_err(|e| format!("Failed to read path file {}: {}", resolved.display(), e))?;

    parse_csf_points(&bytes).map_err(|e| format!("Failed to parse CSF file: {}", e))
}

/// Parse a .csf path file: "csf\0" header (4 bytes) + version (i32) + count (i32) + Vec3[count].
/// C++ remaps each D3DXVECTOR3 from client coordinates as x, -z, y after reading.
fn parse_csf_points(bytes: &[u8]) -> Result<Vec<[f32; 3]>, String> {
    if bytes.len() < 12 {
        return Err("File too small for CSF header".to_string());
    }

    if &bytes[0..4] != b"csf\0" {
        return Err("Invalid CSF header".to_string());
    }

    let _version = i32::from_le_bytes(
        bytes[4..8]
            .try_into()
            .map_err(|_| "Failed to read version")?,
    );
    let count = i32::from_le_bytes(
        bytes[8..12]
            .try_into()
            .map_err(|_| "Failed to read count")?,
    );

    if count < 0 {
        return Err("Negative point count".to_string());
    }
    let count = count as usize;

    let expected_size = 12 + count * 12; // 3 floats x 4 bytes each
    if bytes.len() < expected_size {
        return Err(format!(
            "File too small: expected {} bytes for {} points, got {}",
            expected_size,
            count,
            bytes.len()
        ));
    }

    let mut points = Vec::with_capacity(count);
    let mut offset = 12;
    for _ in 0..count {
        let x = f32::from_le_bytes(
            bytes[offset..offset + 4]
                .try_into()
                .map_err(|_| "Failed to read float")?,
        );
        let y = f32::from_le_bytes(
            bytes[offset + 4..offset + 8]
                .try_into()
                .map_err(|_| "Failed to read float")?,
        );
        let z = f32::from_le_bytes(
            bytes[offset + 8..offset + 12]
                .try_into()
                .map_err(|_| "Failed to read float")?,
        );
        points.push([x, -z, y]);
        offset += 12;
    }

    Ok(points)
}

fn particles_file_path(project_dir: &std::path::Path, effect_name: &str) -> std::path::PathBuf {
    let base = effect_name.strip_suffix(".eff").unwrap_or(effect_name);
    project_dir
        .join("effect")
        .join(format!("{}.particles.json", base))
}

fn par_file_path(project_dir: &std::path::Path, par_name: &str) -> std::path::PathBuf {
    let file_name = if par_name.ends_with(".par") {
        par_name.to_string()
    } else {
        format!("{}.par", par_name)
    };

    project_dir.join("effect").join(file_name)
}

fn effect_file_path(project_dir: &std::path::Path, effect_name: &str) -> std::path::PathBuf {
    let file_name = if effect_name.ends_with(".eff") {
        effect_name.to_string()
    } else {
        format!("{}.eff", effect_name)
    };

    project_dir.join("effect").join(file_name)
}

/// Resolve an effect model .lgo path with case-insensitive filename matching.
pub fn resolve_effect_model_path(
    project_dir: &Path,
    model_name: &str,
) -> Option<std::path::PathBuf> {
    let name = model_name.strip_suffix(".lgo").unwrap_or(model_name);
    let target = format!("{}.lgo", name).to_lowercase();
    let dir = project_dir.join("model/effect");

    if !dir.exists() {
        return None;
    }

    for entry in std::fs::read_dir(&dir).ok()?.flatten() {
        if let Some(file_name) = entry.file_name().to_str() {
            if file_name.to_lowercase() == target {
                return Some(entry.path());
            }
        }
    }

    None
}

/// Load an effect .lgo model and return a minimal glTF JSON string containing
/// only geometry (POSITION, NORMAL, TEXCOORD_0, indices). No materials, skins,
/// or animations — the effect system provides its own textures and blending.
pub fn build_effect_model_gltf(project_dir: &Path, model_name: &str) -> Result<String, String> {
    let lgo_path = resolve_effect_model_path(project_dir, model_name)
        .ok_or_else(|| format!("Effect model not found: {}", model_name))?;

    let geom = CharacterGeometricModel::from_file(lgo_path)
        .map_err(|e| format!("Failed to load LGO: {}", e))?;

    let mesh_info = geom
        .mesh_info
        .as_ref()
        .ok_or_else(|| "LGO has no mesh data".to_string())?;

    let mut fields = GLTFFieldsToAggregate {
        buffer: vec![],
        buffer_view: vec![],
        accessor: vec![],
        image: vec![],
        texture: vec![],
        material: vec![],
        sampler: vec![],
        animation: vec![],
        skin: vec![],
        nodes: vec![],
    };

    let primitive = mesh_info.get_geometry_only_primitive(&mut fields);

    let mesh = gltf::json::Mesh {
        name: Some(model_name.to_string()),
        primitives: vec![primitive],
        extensions: None,
        extras: None,
        weights: None,
    };

    let mut nodes = Vec::new();
    let skin = geom
        .bone_animation
        .as_ref()
        .and_then(|bone_anim| append_effect_model_bone_animation(&mut fields, &mut nodes, bone_anim));

    let root_joint_nodes = if let Some(bone_anim) = geom.bone_animation.as_ref() {
        collect_root_joint_nodes(bone_anim, 0)
    } else {
        Vec::new()
    };

    let mesh_node = gltf::json::Node {
        mesh: Some(gltf::json::Index::new(0)),
        name: Some(model_name.to_string()),
        skin,
        children: if root_joint_nodes.is_empty() {
            None
        } else {
            Some(root_joint_nodes)
        },
        ..Default::default()
    };
    let helper_nodes = geom.get_gltf_helper_nodes_for_mesh(0, None);
    let scene_node_indices =
        append_effect_model_scene_nodes(&mut nodes, mesh_node, helper_nodes);

    let scene = gltf::json::Scene {
        name: Some("Scene".to_string()),
        nodes: scene_node_indices,
        extensions: None,
        extras: None,
    };

    let root = gltf::json::Root {
        asset: gltf::json::Asset {
            version: "2.0".to_string(),
            generator: Some("pko-tools".to_string()),
            ..Default::default()
        },
        buffers: fields.buffer,
        buffer_views: fields.buffer_view,
        accessors: fields.accessor,
        meshes: vec![mesh],
        nodes,
        scenes: vec![scene],
        scene: Some(gltf::json::Index::new(0)),
        animations: fields.animation,
        skins: fields.skin,
        ..Default::default()
    };

    serde_json::to_string(&root).map_err(|e| format!("Failed to serialize glTF: {}", e))
}

fn append_effect_model_scene_nodes(
    nodes: &mut Vec<gltf::json::Node>,
    mesh_node: gltf::json::Node,
    helper_nodes: Vec<gltf::json::Node>,
) -> Vec<gltf::json::Index<gltf::json::Node>> {
    let first_scene_node = nodes.len() as u32;
    nodes.push(mesh_node);
    nodes.extend(helper_nodes);
    (first_scene_node..nodes.len() as u32)
        .map(gltf::json::Index::new)
        .collect()
}

fn collect_root_joint_nodes(
    bone_anim: &LmoBoneAnimData,
    first_joint_node_idx: u32,
) -> Vec<gltf::json::Index<gltf::json::Node>> {
    bone_anim
        .bones
        .iter()
        .enumerate()
        .filter(|(_, bone)| bone.parent_id == u32::MAX)
        .map(|(idx, _)| gltf::json::Index::new(first_joint_node_idx + idx as u32))
        .collect()
}

fn append_effect_model_bone_animation(
    fields: &mut GLTFFieldsToAggregate,
    nodes: &mut Vec<gltf::json::Node>,
    bone_anim: &LmoBoneAnimData,
) -> Option<gltf::json::Index<gltf::json::Skin>> {
    if bone_anim.bones.is_empty() || bone_anim.inv_bind_matrices.is_empty() {
        return None;
    }

    let bone_count = bone_anim.bones.len();
    let first_joint_node_idx = nodes.len() as u32;
    let mut joint_node_indices = Vec::with_capacity(bone_count);

    for (idx, bone) in bone_anim.bones.iter().enumerate() {
        let (translation, rotation) = bone_anim
            .keyframes
            .get(idx)
            .and_then(|kf| kf.translations.first().zip(kf.rotations.first()))
            .map(|(t, r)| (*t, *r))
            .unwrap_or(([0.0, 0.0, 0.0], [0.0, 0.0, 0.0, 1.0]));

        let node_idx = nodes.len() as u32;
        joint_node_indices.push(node_idx);
        nodes.push(gltf::json::Node {
            name: Some(format!("effect_model_bone_{}", bone.name)),
            translation: Some(translation.into()),
            rotation: Some(gltf::json::scene::UnitQuaternion(rotation)),
            ..Default::default()
        });
    }

    let mut children_by_bone = vec![Vec::<gltf::json::Index<gltf::json::Node>>::new(); bone_count];
    for (idx, bone) in bone_anim.bones.iter().enumerate() {
        if bone.parent_id != u32::MAX {
            let parent = bone.parent_id as usize;
            if parent < bone_count {
                children_by_bone[parent].push(gltf::json::Index::new(first_joint_node_idx + idx as u32));
            }
        }
    }
    for (idx, children) in children_by_bone.into_iter().enumerate() {
        if !children.is_empty() {
            nodes[(first_joint_node_idx + idx as u32) as usize].children = Some(children);
        }
    }

    let mut ibm_data = Vec::with_capacity(bone_count * 16);
    for matrix in bone_anim.inv_bind_matrices.iter().take(bone_count) {
        for col in 0..4 {
            for row in 0..4 {
                ibm_data.push(matrix[col][row]);
            }
        }
    }
    let inverse_bind_matrices = add_effect_model_f32_accessor(
        fields,
        &ibm_data,
        "effect_model_inverse_bind_matrices",
        gltf::json::accessor::Type::Mat4,
        16,
    );

    let skin_index = fields.skin.len() as u32;
    fields.skin.push(gltf::json::Skin {
        inverse_bind_matrices: Some(gltf::json::Index::new(inverse_bind_matrices)),
        joints: joint_node_indices
            .iter()
            .map(|idx| gltf::json::Index::new(*idx))
            .collect(),
        skeleton: Some(gltf::json::Index::new(first_joint_node_idx)),
        name: Some("effect_model_skin".to_string()),
        extensions: None,
        extras: None,
    });

    append_effect_model_animation(fields, bone_anim, &joint_node_indices);

    Some(gltf::json::Index::new(skin_index))
}

fn append_effect_model_animation(
    fields: &mut GLTFFieldsToAggregate,
    bone_anim: &LmoBoneAnimData,
    joint_node_indices: &[u32],
) {
    let frame_count = bone_anim.frame_num as usize;
    if frame_count <= 1 {
        return;
    }

    let times: Vec<f32> = (0..frame_count)
        .map(|frame| frame as f32 / EFFECT_MODEL_ANIMATION_FPS)
        .collect();
    let time_accessor = add_effect_model_f32_accessor(
        fields,
        &times,
        "effect_model_bone_time",
        gltf::json::accessor::Type::Scalar,
        1,
    );

    let mut samplers = Vec::new();
    let mut channels = Vec::new();

    for (bone_idx, keyframes) in bone_anim.keyframes.iter().enumerate() {
        if bone_idx >= joint_node_indices.len() {
            break;
        }

        if keyframes.translations.len() == frame_count {
            let translations: Vec<f32> = keyframes
                .translations
                .iter()
                .flat_map(|t| t.iter().copied())
                .collect();
            let output = add_effect_model_f32_accessor(
                fields,
                &translations,
                &format!("effect_model_bone_{}_translation", bone_idx),
                gltf::json::accessor::Type::Vec3,
                3,
            );
            let sampler = samplers.len() as u32;
            samplers.push(Sampler {
                input: gltf::json::Index::new(time_accessor),
                output: gltf::json::Index::new(output),
                interpolation: Checked::Valid(gltf::json::animation::Interpolation::Linear),
                extensions: None,
                extras: None,
            });
            channels.push(Channel {
                sampler: gltf::json::Index::new(sampler),
                target: Target {
                    node: gltf::json::Index::new(joint_node_indices[bone_idx]),
                    path: Checked::Valid(gltf::json::animation::Property::Translation),
                    extensions: None,
                    extras: None,
                },
                extensions: None,
                extras: None,
            });
        }

        if keyframes.rotations.len() == frame_count {
            let rotations: Vec<f32> = keyframes
                .rotations
                .iter()
                .flat_map(|r| r.iter().copied())
                .collect();
            let output = add_effect_model_f32_accessor(
                fields,
                &rotations,
                &format!("effect_model_bone_{}_rotation", bone_idx),
                gltf::json::accessor::Type::Vec4,
                4,
            );
            let sampler = samplers.len() as u32;
            samplers.push(Sampler {
                input: gltf::json::Index::new(time_accessor),
                output: gltf::json::Index::new(output),
                interpolation: Checked::Valid(gltf::json::animation::Interpolation::Linear),
                extensions: None,
                extras: None,
            });
            channels.push(Channel {
                sampler: gltf::json::Index::new(sampler),
                target: Target {
                    node: gltf::json::Index::new(joint_node_indices[bone_idx]),
                    path: Checked::Valid(gltf::json::animation::Property::Rotation),
                    extensions: None,
                    extras: None,
                },
                extensions: None,
                extras: None,
            });
        }
    }

    if !channels.is_empty() {
        fields.animation.push(gltf::json::Animation {
            name: Some("EffectModelBoneAnimation".to_string()),
            samplers,
            channels,
            extensions: None,
            extras: None,
        });
    }
}

fn add_effect_model_f32_accessor(
    fields: &mut GLTFFieldsToAggregate,
    data: &[f32],
    name: &str,
    accessor_type: gltf::json::accessor::Type,
    components_per_element: usize,
) -> u32 {
    let bytes: Vec<u8> = data.iter().flat_map(|value| value.to_le_bytes()).collect();
    let buffer_index = fields.buffer.len() as u32;
    let buffer_view_index = fields.buffer_view.len() as u32;
    let accessor_index = fields.accessor.len() as u32;

    fields.buffer.push(gltf::json::Buffer {
        byte_length: USize64(bytes.len() as u64),
        extensions: None,
        extras: None,
        name: Some(format!("{}_buffer", name)),
        uri: Some(format!(
            "data:application/octet-stream;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(&bytes)
        )),
    });
    fields.buffer_view.push(gltf::json::buffer::View {
        buffer: gltf::json::Index::new(buffer_index),
        byte_length: USize64(bytes.len() as u64),
        byte_offset: Some(USize64(0)),
        byte_stride: None,
        target: Some(Checked::Valid(gltf::json::buffer::Target::ArrayBuffer)),
        extensions: None,
        extras: None,
        name: Some(format!("{}_view", name)),
    });
    fields.accessor.push(gltf::json::Accessor {
        buffer_view: Some(gltf::json::Index::new(buffer_view_index)),
        byte_offset: Some(USize64(0)),
        component_type: Checked::Valid(GenericComponentType(ComponentType::F32)),
        count: USize64((data.len() / components_per_element) as u64),
        extensions: None,
        extras: None,
        max: None,
        min: None,
        name: Some(format!("{}_accessor", name)),
        normalized: false,
        sparse: None,
        type_: Checked::Valid(accessor_type),
    });

    accessor_index
}

#[tauri::command]
pub async fn load_effect_model(project_id: String, model_name: String) -> Result<String, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    build_effect_model_gltf(project.project_directory.as_ref(), &model_name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::item::model::encode_pko_texture;
    use base64::Engine;

    /// Verify build_effect_model_gltf produces valid glTF with 1 mesh, 1 scene,
    /// 0 skins, 0 animations, and 0 materials.
    /// Ignored by default since it requires an actual project directory with .lgo files.
    #[test]
    #[ignore]
    fn test_build_effect_model_gltf() {
        // Update this path to a project directory containing model/effect/*.lgo files
        let project_dir = Path::new("./test_artifacts/project");
        let result = build_effect_model_gltf(project_dir, "wind01");
        assert!(result.is_ok(), "Failed: {:?}", result.err());

        let json_str = result.unwrap();
        let root: gltf::json::Root = serde_json::from_str(&json_str).unwrap();

        assert_eq!(root.meshes.len(), 1, "Expected 1 mesh");
        assert_eq!(root.scenes.len(), 1, "Expected 1 scene");
        assert_eq!(root.skins.len(), 0, "Expected 0 skins");
        assert_eq!(root.animations.len(), 0, "Expected 0 animations");
        assert_eq!(root.materials.len(), 0, "Expected 0 materials");
        assert!(!root.accessors.is_empty(), "Expected at least 1 accessor");
        assert!(!root.buffers.is_empty(), "Expected at least 1 buffer");
    }

    #[test]
    fn effect_model_gltf_preserves_gunwing_bone_animation() {
        let project_dir = Path::new("E:/gamedev/mp-client-source/Client/client");
        if !project_dir.join("model/effect/gunwing.lgo").exists() {
            eprintln!(
                "Skipping effect_model_gltf_preserves_gunwing_bone_animation: source client not found"
            );
            return;
        }

        let json_str = build_effect_model_gltf(project_dir, "gunwing.lgo")
            .expect("gunwing effect model should build");
        let root: gltf::json::Root = serde_json::from_str(&json_str).unwrap();

        assert_eq!(root.skins.len(), 1, "gunwing.lgo should keep its skin");
        assert!(
            !root.animations.is_empty(),
            "gunwing.lgo should keep its embedded bone animation"
        );

        let attrs = &root.meshes[0].primitives[0].attributes;
        assert!(
            attrs.contains_key(&gltf::json::validation::Checked::Valid(
                gltf::json::mesh::Semantic::Joints(0),
            )),
            "skinned effect model primitive should include JOINTS_0"
        );
        assert!(
            attrs.contains_key(&gltf::json::validation::Checked::Valid(
                gltf::json::mesh::Semantic::Weights(0),
            )),
            "skinned effect model primitive should include WEIGHTS_0"
        );
    }

    #[test]
    fn effect_model_scene_keeps_helper_nodes_addressable() {
        let mesh_node = gltf::json::Node {
            mesh: Some(gltf::json::Index::new(0)),
            name: Some("weapon".to_string()),
            ..Default::default()
        };
        let helper_node = gltf::json::Node {
            name: Some("Dummy1".to_string()),
            ..Default::default()
        };

        let mut nodes = Vec::new();
        let scene_nodes = append_effect_model_scene_nodes(&mut nodes, mesh_node, vec![helper_node]);

        assert_eq!(nodes.len(), 2);
        assert_eq!(nodes[0].name.as_deref(), Some("weapon"));
        assert_eq!(nodes[1].name.as_deref(), Some("Dummy1"));
        assert_eq!(
            scene_nodes
                .iter()
                .map(|idx| idx.value())
                .collect::<Vec<_>>(),
            vec![0, 1]
        );
    }

    #[test]
    fn test_decode_paletted_tga() {
        let path = std::path::Path::new("../top-client/texture/effect/jb05.TGA");
        if !path.exists() {
            eprintln!("Skipping: jb05.TGA not found at {}", path.display());
            return;
        }

        let bytes = std::fs::read(path).unwrap();
        let result = try_decode_paletted_tga(&bytes);
        assert!(result.is_some(), "Should decode paletted TGA");

        let decoded = result.unwrap();
        assert_eq!(decoded.width, 128);
        assert_eq!(decoded.height, 128);

        // RGBA data should be width * height * 4 bytes, base64-encoded
        let raw = base64::engine::general_purpose::STANDARD
            .decode(&decoded.data)
            .unwrap();
        assert_eq!(raw.len(), 128 * 128 * 4);

        eprintln!(
            "Decoded paletted TGA: {}x{}, {} bytes RGBA",
            decoded.width,
            decoded.height,
            raw.len()
        );
    }

    #[test]
    fn decode_texture_unwraps_pko_encoded_standard_images() {
        let temp = tempfile::tempdir().expect("temp dir");
        let path = temp.path().join("encoded.png");
        let img = image::RgbaImage::from_pixel(16, 16, image::Rgba([12, 34, 56, 78]));
        let mut png = Vec::new();
        image::DynamicImage::ImageRgba8(img)
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .expect("encode png");
        assert!(png.len() >= 88, "fixture must exercise PKO byte swapping");
        std::fs::write(&path, encode_pko_texture(&png)).expect("write encoded texture");

        let decoded =
            tauri::async_runtime::block_on(decode_texture(path.to_string_lossy().to_string()))
                .expect("decode pko encoded texture");
        let raw = base64::engine::general_purpose::STANDARD
            .decode(decoded.data)
            .expect("base64 rgba");

        assert_eq!(decoded.width, 16);
        assert_eq!(decoded.height, 16);
        assert!(raw.chunks_exact(4).all(|px| px == [12, 34, 56, 78]));
    }

    #[test]
    fn decode_texture_preserves_dxt1_punch_through_alpha() {
        let temp = tempfile::tempdir().expect("temp dir");
        let path = temp.path().join("mask.dds");
        let mut block = [0u8; 8];
        block[0] = 0x00;
        block[1] = 0x00;
        block[2] = 0xff;
        block[3] = 0xff;
        block[4] = 0xff;
        block[5] = 0xff;
        block[6] = 0xff;
        block[7] = 0xff;
        let dds = build_dxt1_dds(4, 4, &block);
        assert!(
            decode_dds_with_alpha(&dds).is_some(),
            "fixture should decode directly"
        );
        std::fs::write(&path, dds).expect("write dds");

        let decoded =
            tauri::async_runtime::block_on(decode_texture(path.to_string_lossy().to_string()))
                .expect("decode dxt1 texture");
        let raw = base64::engine::general_purpose::STANDARD
            .decode(decoded.data)
            .expect("base64 rgba");
        let alpha_values: Vec<u8> = raw.chunks_exact(4).map(|px| px[3]).collect();

        assert_eq!(decoded.width, 4);
        assert_eq!(decoded.height, 4);
        assert_eq!(
            alpha_values.iter().filter(|&&alpha| alpha == 0).count(),
            16,
            "DXT1 punch-through block should decode as fully transparent",
        );
    }

    fn build_dxt1_dds(width: u32, height: u32, dxt1_blocks: &[u8]) -> Vec<u8> {
        const FOURCC_DXT1: u32 = u32::from_le_bytes(*b"DXT1");
        let mut dds = Vec::new();
        dds.extend_from_slice(b"DDS ");
        dds.extend_from_slice(&124u32.to_le_bytes());
        dds.extend_from_slice(&0x81007u32.to_le_bytes());
        dds.extend_from_slice(&height.to_le_bytes());
        dds.extend_from_slice(&width.to_le_bytes());
        dds.extend_from_slice(&(dxt1_blocks.len() as u32).to_le_bytes());
        dds.extend_from_slice(&0u32.to_le_bytes());
        dds.extend_from_slice(&1u32.to_le_bytes());
        for _ in 0..11 {
            dds.extend_from_slice(&0u32.to_le_bytes());
        }
        dds.extend_from_slice(&32u32.to_le_bytes());
        dds.extend_from_slice(&0x4u32.to_le_bytes());
        dds.extend_from_slice(&FOURCC_DXT1.to_le_bytes());
        dds.extend_from_slice(&0u32.to_le_bytes());
        for _ in 0..4 {
            dds.extend_from_slice(&0u32.to_le_bytes());
        }
        dds.extend_from_slice(&0x1000u32.to_le_bytes());
        dds.extend_from_slice(&0u32.to_le_bytes());
        dds.extend_from_slice(&0u32.to_le_bytes());
        dds.extend_from_slice(&0u32.to_le_bytes());
        dds.extend_from_slice(&0u32.to_le_bytes());
        dds.extend_from_slice(dxt1_blocks);
        dds
    }

    #[test]
    fn parse_csf_points_matches_cpp_header_and_coordinate_remap() {
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"csf\0");
        bytes.extend_from_slice(&1_i32.to_le_bytes());
        bytes.extend_from_slice(&1_i32.to_le_bytes());
        bytes.extend_from_slice(&2.0_f32.to_le_bytes());
        bytes.extend_from_slice(&3.0_f32.to_le_bytes());
        bytes.extend_from_slice(&4.0_f32.to_le_bytes());

        let points = parse_csf_points(&bytes).expect("valid csf path");

        assert_eq!(points, vec![[2.0, -4.0, 3.0]]);
    }
}
