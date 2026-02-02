use std::path::Path;
use std::str::FromStr;

use base64::Engine;
use serde::Serialize;

use crate::character::{model::CharacterGeometricModel, GLTFFieldsToAggregate};
use crate::projects::project::Project;

use super::{model::EffFile, scan_effects_directory};

#[tauri::command]
pub async fn list_effects(project_id: String) -> Result<Vec<String>, String> {
    let project_id = uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    scan_effects_directory(project.project_directory.as_ref()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn load_effect(project_id: String, effect_name: String) -> Result<EffFile, String> {
    let project_id = uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;
    let effect_path = effect_file_path(project.project_directory.as_ref(), &effect_name);

    let bytes = std::fs::read(&effect_path)
        .map_err(|e| format!("Failed to read effect file {}: {}", effect_path.display(), e))?;
    EffFile::from_bytes(&bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_effect(
    project_id: String,
    effect_name: String,
    effect: EffFile,
) -> Result<(), String> {
    let project_id = uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;
    let effect_path = effect_file_path(project.project_directory.as_ref(), &effect_name);

    if let Some(parent) = effect_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create effect directory: {}", e))?;
    }

    let bytes = effect.to_bytes().map_err(|e| e.to_string())?;
    std::fs::write(&effect_path, bytes)
        .map_err(|e| format!("Failed to write effect file {}: {}", effect_path.display(), e))?;

    Ok(())
}

#[tauri::command]
pub async fn load_texture_bytes(path: String) -> Result<String, String> {
    let bytes = std::fs::read(&path)
        .map_err(|e| format!("Failed to read texture {}: {}", path, e))?;
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
    let bytes = std::fs::read(&resolved)
        .map_err(|e| format!("Failed to read texture {}: {}", path, e))?;

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
            let rgba = img.to_rgba8();
            let (w, h) = rgba.dimensions();
            let data = base64::engine::general_purpose::STANDARD.encode(rgba.as_raw());
            return Ok(DecodedTexture { width: w, height: h, data });
        }
    }
    // Also try auto-detection
    if let Ok(img) = image::load_from_memory(&bytes) {
        let rgba = img.to_rgba8();
        let (w, h) = rgba.dimensions();
        let data = base64::engine::general_purpose::STANDARD.encode(rgba.as_raw());
        return Ok(DecodedTexture { width: w, height: h, data });
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
        let has_tga_footer = bytes[footer_start + 1] <= 1
            && bytes[footer_start + 2] == 2;

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
        if w_pow2 { s += 10; }
        if h_pow2 { s += 10; }
        // Prefer smaller aspect ratio (closer to square)
        if ratio <= 2 { s += 5; }
        else if ratio <= 4 { s += 3; }
        else if ratio <= 8 { s += 1; }
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
            rgba.push(255);      // A
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
        if w_pow2 { s += 10; }
        if h_pow2 { s += 10; }
        if ratio <= 2 { s += 5; }
        else if ratio <= 4 { s += 3; }
        else if ratio <= 8 { s += 1; }
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
            rgba.push(255);      // A
        }
    }

    let data = base64::engine::general_purpose::STANDARD.encode(&rgba);
    Some(DecodedTexture {
        width: w as u32,
        height: h as u32,
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

#[tauri::command]
pub async fn save_particles(
    project_id: String,
    effect_name: String,
    particles: serde_json::Value,
) -> Result<(), String> {
    let project_id = uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
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
    let project_id = uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
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
    let project_id = uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
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
                            if let Some(name) = path.strip_prefix(project_dir).ok().and_then(|p| p.to_str()) {
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
    let project_id = uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    let file_name = if path_name.ends_with(".csf") {
        path_name.clone()
    } else {
        format!("{}.csf", path_name)
    };

    let path = project.project_directory.join("effect").join(&file_name);
    let resolved = resolve_case_insensitive(path.to_str().unwrap_or(""))
        .unwrap_or(path);

    let bytes = std::fs::read(&resolved)
        .map_err(|e| format!("Failed to read path file {}: {}", resolved.display(), e))?;

    parse_csf_points(&bytes)
        .map_err(|e| format!("Failed to parse CSF file: {}", e))
}

/// Parse a .csf path file: "csf" header (3 bytes) + version (i32) + count (i32) + Vec3[count]
fn parse_csf_points(bytes: &[u8]) -> Result<Vec<[f32; 3]>, String> {
    if bytes.len() < 11 {
        return Err("File too small for CSF header".to_string());
    }

    // Check "csf" header
    if &bytes[0..3] != b"csf" {
        return Err("Invalid CSF header".to_string());
    }

    let _version = i32::from_le_bytes(
        bytes[3..7].try_into().map_err(|_| "Failed to read version")?
    );
    let count = i32::from_le_bytes(
        bytes[7..11].try_into().map_err(|_| "Failed to read count")?
    );

    if count < 0 {
        return Err("Negative point count".to_string());
    }
    let count = count as usize;

    let expected_size = 11 + count * 12; // 3 floats × 4 bytes each
    if bytes.len() < expected_size {
        return Err(format!(
            "File too small: expected {} bytes for {} points, got {}",
            expected_size, count, bytes.len()
        ));
    }

    let mut points = Vec::with_capacity(count);
    let mut offset = 11;
    for _ in 0..count {
        let x = f32::from_le_bytes(bytes[offset..offset+4].try_into().map_err(|_| "Failed to read float")?);
        let y = f32::from_le_bytes(bytes[offset+4..offset+8].try_into().map_err(|_| "Failed to read float")?);
        let z = f32::from_le_bytes(bytes[offset+8..offset+12].try_into().map_err(|_| "Failed to read float")?);
        points.push([x, y, z]);
        offset += 12;
    }

    Ok(points)
}

fn particles_file_path(project_dir: &std::path::Path, effect_name: &str) -> std::path::PathBuf {
    let base = effect_name.strip_suffix(".eff").unwrap_or(effect_name);
    project_dir.join("effect").join(format!("{}.particles.json", base))
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
fn resolve_effect_model_path(project_dir: &Path, model_name: &str) -> Option<std::path::PathBuf> {
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
fn build_effect_model_gltf(project_dir: &Path, model_name: &str) -> Result<String, String> {
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

    let node = gltf::json::Node {
        mesh: Some(gltf::json::Index::new(0)),
        name: Some(model_name.to_string()),
        ..Default::default()
    };

    let scene = gltf::json::Scene {
        name: Some("Scene".to_string()),
        nodes: vec![gltf::json::Index::new(0)],
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
        nodes: vec![node],
        scenes: vec![scene],
        scene: Some(gltf::json::Index::new(0)),
        ..Default::default()
    };

    serde_json::to_string(&root).map_err(|e| format!("Failed to serialize glTF: {}", e))
}

#[tauri::command]
pub async fn load_effect_model(
    project_id: String,
    model_name: String,
) -> Result<String, String> {
    let project_id =
        uuid::Uuid::from_str(&project_id).map_err(|_| "Invalid project id".to_string())?;
    let project = Project::get_project(project_id).map_err(|e| e.to_string())?;

    build_effect_model_gltf(project.project_directory.as_ref(), &model_name)
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
