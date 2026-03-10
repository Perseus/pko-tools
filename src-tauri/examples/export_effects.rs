//! CLI tool for exporting PKO effect data to Unity-ready JSON + PNG.
//!
//! Usage:
//!   cargo run --example export_effects -- <client_dir> <output_dir>
//!
//! This will:
//!   1. Export all .eff files as JSON (with coordinate remap) to <output_dir>/effects/
//!   2. Export all .par files as JSON (with coordinate remap) to <output_dir>/particles/
//!   3. Convert referenced effect textures to PNG in <output_dir>/textures/
//!   4. Copy all .bin table files to <output_dir>/tables/
//!
//! The coordinate remap applied is (x,y,z) → (x,z,y) — the same Y↔Z swap
//! used by the terrain/building export pipeline.

use std::path::PathBuf;

fn main() {
    let args: Vec<String> = std::env::args().collect();

    if args.len() < 3 {
        eprintln!("Usage: export_effects <client_dir> <output_dir>");
        eprintln!();
        eprintln!("  <client_dir>  Path to PKO client directory (contains effect/, texture/, scripts/)");
        eprintln!("  <output_dir>  Output directory for exported data");
        std::process::exit(1);
    }

    let client_dir = PathBuf::from(&args[1]);
    let output_dir = PathBuf::from(&args[2]);

    if !client_dir.exists() {
        eprintln!("Error: client directory does not exist: {}", client_dir.display());
        std::process::exit(1);
    }

    let effect_dir = client_dir.join("effect");
    if !effect_dir.exists() {
        eprintln!("Error: effect/ directory not found in {}", client_dir.display());
        std::process::exit(1);
    }

    // Create output directory
    if let Err(e) = std::fs::create_dir_all(&output_dir) {
        eprintln!("Error: failed to create output directory: {}", e);
        std::process::exit(1);
    }

    eprintln!("=== PKO Effect Export ===");
    eprintln!("Client: {}", client_dir.display());
    eprintln!("Output: {}", output_dir.display());
    eprintln!();

    // 1. Export .eff files
    eprintln!("--- Exporting .eff files ---");
    match pko_tools_lib::effect::export::export_all_eff(&effect_dir, &output_dir) {
        Ok((success, errors)) => {
            eprintln!("  EFF: {} exported, {} errors", success, errors);
            if errors > 0 {
                eprintln!("  WARNING: {} .eff files failed to export", errors);
            }
        }
        Err(e) => {
            eprintln!("  ERROR: failed to export .eff files: {}", e);
            std::process::exit(1);
        }
    }

    // 2. Export .par files
    eprintln!("--- Exporting .par files ---");
    match pko_tools_lib::effect::export::export_all_par(&effect_dir, &output_dir) {
        Ok((success, errors)) => {
            eprintln!("  PAR: {} exported, {} errors", success, errors);
            if errors > 0 {
                eprintln!("  WARNING: {} .par files failed to export", errors);
            }
        }
        Err(e) => {
            eprintln!("  ERROR: failed to export .par files: {}", e);
            std::process::exit(1);
        }
    }

    // 3. Export textures
    eprintln!("--- Exporting effect textures ---");
    let texture_dir = client_dir.join("texture").join("effect");
    match pko_tools_lib::effect::texture_export::export_effect_textures(
        &effect_dir,
        &texture_dir,
        &output_dir,
    ) {
        Ok((success, skipped, errors)) => {
            eprintln!(
                "  Textures: {} exported, {} skipped (not on disk), {} errors",
                success, skipped, errors
            );
        }
        Err(e) => {
            eprintln!("  ERROR: failed to export textures: {}", e);
            std::process::exit(1);
        }
    }

    // 4. Copy .bin table files
    eprintln!("--- Copying binary table files ---");
    let table_src = client_dir.join("scripts").join("table");
    let table_dst = output_dir.join("tables");

    if table_src.exists() {
        if let Err(e) = std::fs::create_dir_all(&table_dst) {
            eprintln!("  ERROR: failed to create tables directory: {}", e);
            std::process::exit(1);
        }

        let table_files = [
            "sceneffectinfo.bin",
            "MagicSingleinfo.bin",
            "MagicGroupInfo.bin",
            "skilleff.bin",
            "skillinfo.bin",
            "ItemRefineInfo.bin",
            "ItemRefineEffectInfo.bin",
        ];

        let mut copied = 0;
        for name in &table_files {
            // Case-insensitive lookup
            let resolved = resolve_case_insensitive(&table_src, name);
            match resolved {
                Some(src_path) => {
                    let dst_path = table_dst.join(name);
                    match std::fs::copy(&src_path, &dst_path) {
                        Ok(_) => {
                            copied += 1;
                            eprintln!("  Copied: {}", name);
                        }
                        Err(e) => {
                            eprintln!("  WARN: failed to copy {}: {}", name, e);
                        }
                    }
                }
                None => {
                    eprintln!("  WARN: table file not found: {}", name);
                }
            }
        }
        eprintln!("  Tables: {}/{} copied", copied, table_files.len());
    } else {
        eprintln!("  WARN: scripts/table/ directory not found, skipping table copy");
    }

    eprintln!();
    eprintln!("=== Export complete ===");
}

/// Resolve a filename case-insensitively within a directory.
fn resolve_case_insensitive(dir: &std::path::Path, name: &str) -> Option<PathBuf> {
    let target = name.to_lowercase();
    let entries = std::fs::read_dir(dir).ok()?;

    for entry in entries.flatten() {
        if let Some(file_name) = entry.file_name().to_str() {
            if file_name.to_lowercase() == target {
                return Some(entry.path());
            }
        }
    }

    None
}
