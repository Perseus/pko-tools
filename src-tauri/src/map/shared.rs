//! Shared asset export for the PKO → Unity pipeline.
//!
//! Exports all global assets once to a central directory so per-map exports
//! can reference them instead of duplicating buildings, textures, and effects.

use std::collections::HashMap;
use std::path::Path;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use crate::effect::model::EffFile;
use crate::math::coord_transform::{CoordTransform, ExportProfile};

/// Result of a shared asset export.
#[derive(Debug, Serialize, Deserialize)]
pub struct SharedExportResult {
    pub output_dir: String,
    pub total_terrain_textures: u32,
    pub total_buildings_exported: u32,
    pub total_buildings_failed: u32,
    pub total_effect_textures: u32,
    pub total_water_textures: u32,
    pub has_alpha_masks: bool,
}

/// Export all shared assets from a PKO client directory.
///
/// Exports to a temp directory first, then renames to `output_dir` on success
/// to prevent partial output if the export fails mid-run.
///
/// Exported assets:
/// 1. All terrain textures (from TerrainInfo.bin)
/// 2. Alpha mask atlas + 16 individual slices
/// 3. All buildings (from sceneobjinfo.bin → .lmo → .glb)
/// 4. All effect textures (from sceneffectinfo → .eff files → textures)
/// 5. Water textures (ocean_h_01-30)
/// 6. shared_manifest.json (inventory of everything exported)
pub fn export_shared_assets(project_dir: &Path, output_dir: &Path) -> Result<SharedExportResult> {
    export_shared_assets_with_profile(project_dir, output_dir, ExportProfile::UnityGltfast)
}

pub fn export_shared_assets_with_profile(project_dir: &Path, output_dir: &Path, profile: ExportProfile) -> Result<SharedExportResult> {
    // Atomic write: export to temp dir, rename on success
    let temp_dir = output_dir.with_file_name(format!(
        ".shared-export-tmp-{}",
        std::process::id()
    ));
    if temp_dir.exists() {
        std::fs::remove_dir_all(&temp_dir)?;
    }
    std::fs::create_dir_all(&temp_dir)?;

    let result = export_shared_assets_inner(project_dir, &temp_dir, profile);

    match result {
        Ok(mut export_result) => {
            // Rename temp dir to final output dir
            if output_dir.exists() {
                std::fs::remove_dir_all(output_dir)?;
            }
            std::fs::rename(&temp_dir, output_dir)
                .with_context(|| format!(
                    "Failed to rename temp dir {} to {}",
                    temp_dir.display(),
                    output_dir.display()
                ))?;
            export_result.output_dir = output_dir.to_string_lossy().to_string();
            Ok(export_result)
        }
        Err(e) => {
            // Clean up temp dir on failure
            let _ = std::fs::remove_dir_all(&temp_dir);
            Err(e)
        }
    }
}

fn export_shared_assets_inner(project_dir: &Path, output_dir: &Path, profile: ExportProfile) -> Result<SharedExportResult> {
    // 1. Export ALL terrain textures
    eprintln!("[shared] Exporting all terrain textures...");
    let terrain_textures =
        super::texture::export_all_terrain_textures(project_dir, output_dir)
            .unwrap_or_default();
    let total_terrain_textures = terrain_textures.len() as u32;

    // 2. Export alpha masks
    eprintln!("[shared] Exporting alpha masks...");
    let alpha_atlas_path =
        super::texture::export_alpha_atlas(project_dir, output_dir).unwrap_or(None);
    let alpha_mask_array =
        super::texture::export_alpha_mask_array(project_dir, output_dir).unwrap_or(None);
    let has_alpha_masks = alpha_mask_array.is_some();

    // 3. Export ALL buildings from sceneobjinfo.bin
    eprintln!("[shared] Exporting all buildings...");
    let ct = CoordTransform::new(profile);
    let (buildings_exported, buildings_failed, buildings_manifest) =
        export_all_buildings(project_dir, output_dir, true, &ct)?;

    // 4. Export ALL effect textures
    eprintln!("[shared] Exporting all effect textures...");
    let effect_textures = export_all_effect_textures(project_dir, output_dir);
    let total_effect_textures = effect_textures.len() as u32;

    // 5. Export water textures
    eprintln!("[shared] Exporting water textures...");
    let water_textures = copy_water_textures(project_dir, output_dir);
    let total_water_textures = water_textures.len() as u32;

    // 6. Write shared_manifest.json
    eprintln!("[shared] Writing shared_manifest.json...");
    let manifest = build_shared_manifest(&SharedManifestData {
        terrain_textures: &terrain_textures,
        alpha_atlas_path: &alpha_atlas_path,
        alpha_mask_array: &alpha_mask_array,
        buildings: &buildings_manifest,
        buildings_exported,
        buildings_failed,
        effect_textures: &effect_textures,
        water_textures: &water_textures,
    });

    let manifest_json = serde_json::to_string_pretty(&manifest)?;
    std::fs::write(output_dir.join("shared_manifest.json"), manifest_json.as_bytes())?;

    eprintln!("[shared] Export complete: {} terrain textures, {} buildings ({} failed), {} effect textures, {} water textures",
        total_terrain_textures, buildings_exported, buildings_failed, total_effect_textures, total_water_textures);

    Ok(SharedExportResult {
        output_dir: output_dir.to_string_lossy().to_string(),
        total_terrain_textures,
        total_buildings_exported: buildings_exported,
        total_buildings_failed: buildings_failed,
        total_effect_textures,
        total_water_textures,
        has_alpha_masks,
    })
}

/// Export shared assets v2: geometry-only GLBs with external texture URIs.
/// Scene textures should be exported separately via `export_scene_textures()`.
pub fn export_shared_assets_v2(project_dir: &Path, output_dir: &Path) -> Result<SharedExportResult> {
    let temp_dir = output_dir.with_file_name(format!(
        ".shared-v2-export-tmp-{}",
        std::process::id()
    ));
    if temp_dir.exists() {
        std::fs::remove_dir_all(&temp_dir)?;
    }
    std::fs::create_dir_all(&temp_dir)?;

    let result = export_shared_assets_v2_inner(project_dir, &temp_dir);

    match result {
        Ok(mut export_result) => {
            // Move buildings from temp to output (don't delete existing — textures may be there)
            let temp_buildings = temp_dir.join("buildings");
            let out_buildings = output_dir.join("buildings");
            if out_buildings.exists() {
                std::fs::remove_dir_all(&out_buildings)?;
            }
            if temp_buildings.exists() {
                std::fs::rename(&temp_buildings, &out_buildings)?;
            }
            let _ = std::fs::remove_dir_all(&temp_dir);
            export_result.output_dir = output_dir.to_string_lossy().to_string();
            Ok(export_result)
        }
        Err(e) => {
            let _ = std::fs::remove_dir_all(&temp_dir);
            Err(e)
        }
    }
}

fn export_shared_assets_v2_inner(project_dir: &Path, output_dir: &Path) -> Result<SharedExportResult> {
    // Export buildings with external texture URIs (no embedded textures)
    let ct = CoordTransform::new(ExportProfile::UnityGltfast);
    let (buildings_exported, buildings_failed, _manifest) =
        export_all_buildings(project_dir, output_dir, false, &ct)?;

    // Export effect textures + water textures (same as v1)
    let effect_textures = export_all_effect_textures(project_dir, output_dir);
    let water_textures = copy_water_textures(project_dir, output_dir);

    Ok(SharedExportResult {
        output_dir: output_dir.to_string_lossy().to_string(),
        total_terrain_textures: 0, // exported separately
        total_buildings_exported: buildings_exported,
        total_buildings_failed: buildings_failed,
        total_effect_textures: effect_textures.len() as u32,
        total_water_textures: water_textures.len() as u32,
        has_alpha_masks: false, // exported separately
    })
}

/// Export all scene textures as DDS files with padded mip chains.
///
/// Unity's IHVImageFormatImporter requires complete mip chains. PKO DDS files
/// only have 3 levels — this function pads them to the full chain.
/// Non-DDS textures (.tga, .bmp) are converted to PNG.
pub fn export_scene_textures(project_dir: &Path, output_dir: &Path) -> Result<u32> {
    use crate::item::model::decode_pko_texture;

    let tex_dir = project_dir.join("texture/scene");
    if !tex_dir.exists() {
        return Ok(0);
    }

    let out_dir = output_dir.join("textures/scene");
    std::fs::create_dir_all(&out_dir)?;

    let mut count: u32 = 0;

    for entry in std::fs::read_dir(&tex_dir)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let ext = path
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        let stem = path
            .file_stem()
            .map(|s| s.to_string_lossy().to_lowercase())
            .unwrap_or_default();

        match ext.as_str() {
            "dds" => {
                let raw = std::fs::read(&path)?;
                let decoded = decode_pko_texture(&raw);

                if decoded.len() < 128 || &decoded[0..4] != b"DDS " {
                    eprintln!("[textures] SKIP {}: invalid DDS", stem);
                    continue;
                }

                // Decode DDS to PNG. Lossless from the decoded RGBA data.
                // Uses decode_dds_with_alpha to preserve DXT1 punch-through alpha.
                match crate::map::scene_model::decode_dds_with_alpha(&decoded) {
                    Some(rgba_image) => {
                        let out_path = out_dir.join(format!("{}.png", stem));
                        rgba_image.save(&out_path)?;
                        count += 1;
                    }
                    None => {
                        eprintln!("[textures] SKIP {}: DDS decode failed", stem);
                    }
                }
            }
            "bmp" | "tga" | "png" => {
                // Convert non-DDS to PNG
                let raw = std::fs::read(&path)?;
                let decoded = decode_pko_texture(&raw);
                match image::load_from_memory(&decoded) {
                    Ok(img) => {
                        let out_path = out_dir.join(format!("{}.png", stem));
                        img.save(&out_path)?;
                        count += 1;
                    }
                    Err(e) => {
                        eprintln!("[textures] SKIP {}.{}: {}", stem, ext, e);
                    }
                }
            }
            _ => {} // Skip non-texture files (.lmo etc.)
        }
    }

    eprintln!("[shared] Exported {} scene textures to {}", count, out_dir.display());
    Ok(count)
}

/// Convert a DDS file to KTX2 format.
///
/// KTX2 is a modern container for GPU-compressed textures supported by glTFast.
/// DDS and KTX2 can both wrap the same BC1/BC3 compressed data — this function
/// re-wraps without recompressing.
fn dds_to_ktx2(dds: &[u8]) -> Option<Vec<u8>> {
    if dds.len() < 128 || &dds[0..4] != b"DDS " {
        return None;
    }

    let width = u32::from_le_bytes(dds[16..20].try_into().ok()?);
    let height = u32::from_le_bytes(dds[12..16].try_into().ok()?);
    let mip_count = u32::from_le_bytes(dds[28..32].try_into().ok()?).max(1);
    let fourcc = &dds[84..88];

    // Map DDS FourCC to Vulkan format
    let (vk_format, block_size): (u32, u32) = match fourcc {
        b"DXT1" => (131, 8),   // VK_FORMAT_BC1_RGBA_UNORM_BLOCK
        b"DXT3" => (135, 16),  // VK_FORMAT_BC2_UNORM_BLOCK
        b"DXT5" => (137, 16),  // VK_FORMAT_BC3_UNORM_BLOCK
        _ => return None,
    };

    // Calculate mip level sizes and offsets
    struct MipLevel { offset: u64, size: u64 }
    let mut levels = Vec::new();
    let mut mw = width;
    let mut mh = height;
    let mut data_offset: u64 = 128; // DDS header size

    for _ in 0..mip_count {
        let bw = ((mw + 3) / 4).max(1);
        let bh = ((mh + 3) / 4).max(1);
        let size = (bw * bh * block_size) as u64;
        levels.push(MipLevel { offset: data_offset, size });
        data_offset += size;
        mw = (mw / 2).max(1);
        mh = (mh / 2).max(1);
    }

    // KTX2 header: 80 bytes
    // Level index: mip_count * 24 bytes (byteOffset, byteLength, uncompressedByteLength)
    // Then mip data (smallest first in KTX2, largest first in DDS)

    let level_index_size = (mip_count * 24) as usize;
    let header_size: usize = 80;
    let ktx2_data_start = header_size + level_index_size;

    // Total pixel data size
    let total_data: u64 = levels.iter().map(|l| l.size).sum();
    let total_size = ktx2_data_start as u64 + total_data;

    let mut out = vec![0u8; total_size as usize];

    // KTX2 identifier (12 bytes)
    out[0..12].copy_from_slice(&[
        0xAB, 0x4B, 0x54, 0x58, 0x20, 0x32, 0x30, 0xBB, 0x0D, 0x0A, 0x1A, 0x0A
    ]);

    // Header fields (little-endian)
    let h = &mut out[12..80];
    h[0..4].copy_from_slice(&vk_format.to_le_bytes());       // vkFormat
    h[4..8].copy_from_slice(&4u32.to_le_bytes());             // typeSize (4 for block-compressed)
    h[8..12].copy_from_slice(&width.to_le_bytes());           // pixelWidth
    h[12..16].copy_from_slice(&height.to_le_bytes());         // pixelHeight
    h[16..20].copy_from_slice(&0u32.to_le_bytes());           // pixelDepth (0 = 2D)
    h[20..24].copy_from_slice(&0u32.to_le_bytes());           // layerCount (0 = not array)
    h[24..28].copy_from_slice(&1u32.to_le_bytes());           // faceCount (1 = not cubemap)
    h[28..32].copy_from_slice(&mip_count.to_le_bytes());      // levelCount
    h[32..36].copy_from_slice(&0u32.to_le_bytes());           // supercompressionScheme (0 = none)

    // DFD/KVD/SGD byte offsets and lengths — all zero (no data format descriptor, no key/value)
    // h[36..68] = zeros (dfdByteOffset, dfdByteLength, kvdByteOffset, kvdByteLength, sgdByteOffset, sgdByteLength)
    // Already zero from vec initialization

    // Level index — KTX2 stores mips smallest-first, but the level index
    // references them by level (0 = largest). We store data in DDS order (largest first).
    let mut ktx2_offset = ktx2_data_start as u64;
    for (i, level) in levels.iter().enumerate() {
        let idx_offset = header_size + i * 24;
        // byteOffset
        out[idx_offset..idx_offset + 8].copy_from_slice(&ktx2_offset.to_le_bytes());
        // byteLength
        out[idx_offset + 8..idx_offset + 16].copy_from_slice(&level.size.to_le_bytes());
        // uncompressedByteLength (same as byteLength for no supercompression)
        out[idx_offset + 16..idx_offset + 24].copy_from_slice(&level.size.to_le_bytes());

        // Copy pixel data
        let src_start = level.offset as usize;
        let src_end = src_start + level.size as usize;
        if src_end > dds.len() {
            return None; // DDS file truncated
        }
        let dst_start = ktx2_offset as usize;
        out[dst_start..dst_start + level.size as usize]
            .copy_from_slice(&dds[src_start..src_end]);

        ktx2_offset += level.size;
    }

    Some(out)
}

/// Pad a DDS file's mip chain to the full depth required by Unity.
///
/// Unity's IHVImageFormatImporter rejects DDS files with incomplete mip chains.
/// PKO textures typically have 3 mip levels for 256×256; Unity expects 9.
/// We append zero-filled blocks for the missing small mips.
fn pad_dds_mip_chain(data: &[u8]) -> Vec<u8> {
    if data.len() < 128 || &data[0..4] != b"DDS " {
        return data.to_vec();
    }

    let width = u32::from_le_bytes(data[16..20].try_into().unwrap());
    let height = u32::from_le_bytes(data[12..16].try_into().unwrap());
    let current_mips = u32::from_le_bytes(data[28..32].try_into().unwrap());
    let fourcc = &data[84..88];

    let block_size: u32 = match fourcc {
        b"DXT1" => 8,
        b"DXT3" | b"DXT5" => 16,
        _ => return data.to_vec(), // Unknown format, return as-is
    };

    // Calculate full mip count
    let mut full_mips: u32 = 1;
    let mut dim = width.max(height);
    while dim > 1 {
        dim /= 2;
        full_mips += 1;
    }

    if current_mips >= full_mips {
        return data.to_vec(); // Already complete
    }

    // Calculate where the missing mips start (current data ends)
    let mut mw = width;
    let mut mh = height;
    for _ in 0..current_mips {
        mw = (mw / 2).max(1);
        mh = (mh / 2).max(1);
    }

    // Generate zero-filled blocks for missing mips
    let mut extra = Vec::new();
    for _ in current_mips..full_mips {
        let bw = ((mw + 3) / 4).max(1);
        let bh = ((mh + 3) / 4).max(1);
        extra.extend(std::iter::repeat(0u8).take((bw * bh * block_size) as usize));
        mw = (mw / 2).max(1);
        mh = (mh / 2).max(1);
    }

    // Update mip count in header
    let mut result = data.to_vec();
    result[28..32].copy_from_slice(&full_mips.to_le_bytes());
    result.extend(extra);
    result
}

/// Export all buildings from sceneobjinfo.bin as GLB files.
/// When `embed_textures` is false, GLBs reference external textures via URI.
/// Returns (exported_count, failed_count, buildings_manifest_map).
fn export_all_buildings(
    project_dir: &Path,
    output_dir: &Path,
    embed_textures: bool,
    ct: &CoordTransform,
) -> Result<(u32, u32, serde_json::Map<String, serde_json::Value>)> {
    let obj_info = super::scene_obj_info::load_scene_obj_info(project_dir)
        .context("Failed to load sceneobjinfo.bin")?;

    let buildings_dir = output_dir.join("buildings");
    std::fs::create_dir_all(&buildings_dir)?;

    let mut exported: u32 = 0;
    let mut failed: u32 = 0;
    let mut manifest = serde_json::Map::new();

    // Sort by ID for deterministic output
    let mut entries: Vec<_> = obj_info.values().collect();
    entries.sort_by_key(|e| e.id);

    let total_models = entries.iter().filter(|e| e.obj_type == 0).count();
    let mut model_idx: usize = 0;

    for info in &entries {
        // Only export type 0 (buildings/models)
        if info.obj_type != 0 {
            continue;
        }

        model_idx += 1;
        // Log progress every 25 buildings
        if model_idx == 1 || model_idx % 25 == 0 || model_idx == total_models {
            eprintln!(
                "[shared] Building {}/{}: {}",
                model_idx, total_models, info.filename
            );
        }

        let lmo_path = match super::scene_model::find_lmo_path(project_dir, &info.filename) {
            Some(p) => p,
            None => {
                eprintln!(
                    "  Warning: LMO file not found for obj_id={} filename={}",
                    info.id, info.filename
                );
                failed += 1;
                continue;
            }
        };

        let stem = info
            .filename
            .strip_suffix(".lmo")
            .or_else(|| info.filename.strip_suffix(".LMO"))
            .unwrap_or(&info.filename);
        let out_filename = format!("{}.glb", stem);
        let out_path = buildings_dir.join(&out_filename);

        match super::scene_model::build_glb_from_lmo(&lmo_path, project_dir, embed_textures, ct) {
            Ok((json, bin)) => {
                if let Err(e) = super::glb::write_glb(&json, &bin, &out_path) {
                    eprintln!(
                        "  Warning: failed to write GLB for obj_id={}: {}",
                        info.id, e
                    );
                    failed += 1;
                    continue;
                }
            }
            Err(e) => {
                eprintln!(
                    "  Warning: failed to build GLB for obj_id={} ({}): {}",
                    info.id, info.filename, e
                );
                failed += 1;
                continue;
            }
        }

        // Build manifest entry with semantic fields
        let entry = serde_json::json!({
            "glb": format!("buildings/{}", out_filename),
            "filename": info.filename,
            "obj_type": info.obj_type,
            "shade_flag": info.shade_flag,
            "enable_point_light": info.enable_point_light,
            "enable_env_light": info.enable_env_light,
            "attach_effect_id": info.attach_effect_id,
            "style": info.style,
            "flag": info.flag,
            "size_flag": info.size_flag,
            "is_really_big": info.is_really_big,
        });
        manifest.insert(info.id.to_string(), entry);
        exported += 1;
    }

    eprintln!(
        "  Buildings: {} exported, {} failed, {} total entries in sceneobjinfo.bin",
        exported,
        failed,
        entries.len()
    );

    Ok((exported, failed, manifest))
}

/// Export all effect textures by loading ALL effects from sceneffectinfo and
/// collecting every referenced texture across all sub-effects.
fn export_all_effect_textures(
    project_dir: &Path,
    output_dir: &Path,
) -> HashMap<String, String> {
    let effect_info =
        crate::item::sceneffect::load_scene_effect_info(project_dir).unwrap_or_default();

    // Load all effect files and collect them into a serde_json::Map
    // (same format as copy_effect_textures expects)
    let mut effect_definitions = serde_json::Map::new();
    for (eff_id, eff_info) in &effect_info {
        if let Some(eff_file) = load_effect_file(project_dir, &eff_info.filename) {
            if let Ok(serde_json::Value::Object(mut eff_obj)) = serde_json::to_value(&eff_file) {
                eff_obj.insert("filename".to_string(), serde_json::json!(eff_info.filename));
                effect_definitions
                    .insert(eff_id.to_string(), serde_json::Value::Object(eff_obj));
            }
        }
    }

    copy_effect_textures(project_dir, output_dir, &effect_definitions)
}

/// Find and load an .eff file from the project directory.
/// Reuses the same logic as terrain.rs load_effect_file.
fn load_effect_file(project_dir: &Path, eff_filename: &str) -> Option<EffFile> {
    let base = eff_filename
        .strip_suffix(".par")
        .or_else(|| eff_filename.strip_suffix(".PAR"))
        .or_else(|| eff_filename.strip_suffix(".eff"))
        .or_else(|| eff_filename.strip_suffix(".EFF"))
        .unwrap_or(eff_filename);

    let eff_path = project_dir.join("effect").join(format!("{}.eff", base));
    if eff_path.exists() {
        if let Ok(bytes) = std::fs::read(&eff_path) {
            return EffFile::from_bytes(&bytes).ok();
        }
    }

    // Try lowercase
    let eff_path_lc = project_dir
        .join("effect")
        .join(format!("{}.eff", base.to_lowercase()));
    if eff_path_lc.exists() {
        if let Ok(bytes) = std::fs::read(&eff_path_lc) {
            return EffFile::from_bytes(&bytes).ok();
        }
    }

    None
}

/// Copy effect textures — same logic as terrain.rs copy_effect_textures.
fn copy_effect_textures(
    project_dir: &Path,
    output_dir: &Path,
    effect_definitions: &serde_json::Map<String, serde_json::Value>,
) -> HashMap<String, String> {
    let mut copied = HashMap::new();

    let out_dir = output_dir.join("effects").join("textures");
    let _ = std::fs::create_dir_all(&out_dir);

    let effect_tex_dirs = ["texture/effect", "texture/scene", "texture"];
    let exts = ["tga", "bmp", "dds", "png"];

    // Collect all unique texture names from all sub-effects
    let mut tex_names: Vec<String> = Vec::new();
    for (_eff_id, def_val) in effect_definitions.iter() {
        if let Some(subs) = def_val.get("subEffects").and_then(|v| v.as_array()) {
            for sub in subs {
                if let Some(name) = sub.get("texName").and_then(|v| v.as_str()) {
                    if !name.is_empty() {
                        tex_names.push(name.to_string());
                    }
                }
                if let Some(names) = sub.get("frameTexNames").and_then(|v| v.as_array()) {
                    for n in names {
                        if let Some(s) = n.as_str() {
                            if !s.is_empty() {
                                tex_names.push(s.to_string());
                            }
                        }
                    }
                }
            }
        }
    }

    tex_names.sort();
    tex_names.dedup();

    for tex_name in &tex_names {
        if copied.contains_key(tex_name) {
            continue;
        }

        let stem = tex_name
            .rfind('.')
            .map(|i| &tex_name[..i])
            .unwrap_or(tex_name);

        // Find the source file
        let mut source_path = None;
        for dir in &effect_tex_dirs {
            for ext in &exts {
                let candidate = project_dir.join(dir).join(format!("{}.{}", stem, ext));
                if candidate.exists() {
                    source_path = Some(candidate);
                    break;
                }
                let candidate_lc = project_dir
                    .join(dir)
                    .join(format!("{}.{}", stem.to_lowercase(), ext));
                if candidate_lc.exists() {
                    source_path = Some(candidate_lc);
                    break;
                }
            }
            if source_path.is_some() {
                break;
            }
        }

        if let Some(src) = source_path {
            let png_name = format!("{}.png", stem);
            let png_path = out_dir.join(&png_name);

            let success = if src
                .extension()
                .is_some_and(|e| e.eq_ignore_ascii_case("dds"))
            {
                let dds_name = format!("{}.dds", stem);
                let dds_out = out_dir.join(&dds_name);
                std::fs::copy(&src, &dds_out).is_ok()
            } else if let Ok(img) = image::open(&src) {
                img.save(&png_path).is_ok()
            } else {
                let raw_data = match std::fs::read(&src) {
                    Ok(d) => d,
                    Err(_) => continue,
                };
                let decoded = crate::item::model::decode_pko_texture(&raw_data);
                match image::load_from_memory(&decoded) {
                    Ok(img) => img.save(&png_path).is_ok(),
                    Err(_) => false,
                }
            };

            if success {
                let rel_path = format!("effects/textures/{}", png_name);
                copied.insert(tex_name.clone(), rel_path);
            }
        }
    }

    if !copied.is_empty() {
        eprintln!(
            "  Effect textures: {} copied to effects/textures/",
            copied.len()
        );
    }

    copied
}

/// Copy water textures from BMP to PNG format — same logic as terrain.rs.
fn copy_water_textures(project_dir: &Path, output_dir: &Path) -> Vec<String> {
    let water_dir = project_dir.join("texture/terrain/water");
    if !water_dir.exists() {
        return Vec::new();
    }

    let out_water_dir = output_dir.join("water");
    let _ = std::fs::create_dir_all(&out_water_dir);

    let mut copied = Vec::new();
    for i in 1..=30 {
        let bmp_name = format!("ocean_h.{:02}.bmp", i);
        let bmp_path = water_dir.join(&bmp_name);

        let actual_path = if bmp_path.exists() {
            bmp_path
        } else {
            // Try case-insensitive
            let target = bmp_name.to_lowercase();
            match std::fs::read_dir(&water_dir).ok().and_then(|entries| {
                entries
                    .flatten()
                    .find(|e| e.file_name().to_string_lossy().to_lowercase() == target)
                    .map(|e| e.path())
            }) {
                Some(p) => p,
                None => continue,
            }
        };

        if let Ok(img) = image::open(&actual_path) {
            let png_name = format!("ocean_h_{:02}.png", i);
            let png_path = out_water_dir.join(&png_name);
            if img.save(&png_path).is_ok() {
                copied.push(format!("water/{}", png_name));
            }
        }
    }

    copied
}

struct SharedManifestData<'a> {
    terrain_textures: &'a HashMap<u8, String>,
    alpha_atlas_path: &'a Option<String>,
    alpha_mask_array: &'a Option<Vec<String>>,
    buildings: &'a serde_json::Map<String, serde_json::Value>,
    buildings_exported: u32,
    buildings_failed: u32,
    effect_textures: &'a HashMap<String, String>,
    water_textures: &'a [String],
}

/// Build the shared_manifest.json content.
fn build_shared_manifest(data: &SharedManifestData) -> serde_json::Value {
    let tex_map: serde_json::Map<String, serde_json::Value> = data.terrain_textures
        .iter()
        .map(|(id, path)| (id.to_string(), serde_json::json!(path)))
        .collect();

    let mut manifest = serde_json::json!({
        "version": 1,
        "type": "shared_assets",
        "terrain_textures": tex_map,
        "buildings": data.buildings,
        "buildings_exported": data.buildings_exported,
        "buildings_failed": data.buildings_failed,
        "water_textures": data.water_textures,
    });

    let obj = manifest.as_object_mut().unwrap();

    if let Some(ref atlas_path) = data.alpha_atlas_path {
        obj.insert("alpha_atlas".into(), serde_json::json!(atlas_path));
    }
    if let Some(ref mask_paths) = data.alpha_mask_array {
        obj.insert("alpha_masks".into(), serde_json::json!(mask_paths));
    }

    let eff_map: serde_json::Map<String, serde_json::Value> = data.effect_textures
        .iter()
        .map(|(name, path)| (name.clone(), serde_json::json!(path)))
        .collect();
    obj.insert("effect_textures".into(), serde_json::Value::Object(eff_map));

    manifest
}
