//! Audit effect and particle asset references for a client directory.
//!
//! Usage:
//!   cargo run --example effect_asset_audit -- <client-root>

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::process;

use anyhow::{bail, Context, Result};
use pko_tools_lib::client_paths;
use pko_tools_lib::effect::commands::decode_texture;
use pko_tools_lib::effect::model::{EffFile, ParFile};

const TEXTURE_DIRS: [&str; 5] = ["effect", "", "skill", "sceneffect", "lit"];
const TEXTURE_EXTS: [&str; 4] = ["tga", "dds", "png", "bmp"];

fn main() {
    if let Err(error) = run() {
        eprintln!("Error: {error:?}");
        process::exit(1);
    }
}

fn run() -> Result<()> {
    let client_root = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .ok_or_else(|| anyhow::anyhow!("Usage: effect_asset_audit <client-root>"))?;
    if !client_root.is_dir() {
        bail!("{} is not a directory", client_root.display());
    }

    let effect_dir = client_paths::asset_dir(&client_root, "effect");
    if !effect_dir.is_dir() {
        bail!("effect directory not found at {}", effect_dir.display());
    }

    let mut refs = BTreeSet::<String>::new();
    let mut eff_files = 0usize;
    let mut par_files = 0usize;
    let mut eff_parse_failures = Vec::new();
    let mut par_parse_failures = Vec::new();

    for path in collect_files(&effect_dir, "eff")? {
        let bytes =
            std::fs::read(&path).with_context(|| format!("failed to read {}", path.display()))?;
        match EffFile::from_bytes(&bytes) {
            Ok(effect) => {
                eff_files += 1;
                for sub in effect.sub_effects {
                    collect_ref(&mut refs, &sub.tex_name);
                    for name in sub.frame_tex_names {
                        collect_ref(&mut refs, &name);
                    }
                }
            }
            Err(error) => eff_parse_failures.push(format!("{}: {error}", path.display())),
        }
    }

    for path in collect_files(&effect_dir, "par")? {
        let bytes =
            std::fs::read(&path).with_context(|| format!("failed to read {}", path.display()))?;
        match ParFile::from_bytes(&bytes) {
            Ok(par) => {
                par_files += 1;
                for system in par.systems {
                    collect_ref(&mut refs, &system.texture_name);
                }
                for strip in par.strips {
                    collect_ref(&mut refs, &strip.texture_name);
                }
            }
            Err(error) => par_parse_failures.push(format!("{}: {error}", path.display())),
        }
    }

    let mut missing = Vec::new();
    let mut decoded = 0usize;
    let mut decode_failures = Vec::new();
    let mut extension_counts = BTreeMap::<String, usize>::new();

    for name in &refs {
        let Some(path) = resolve_texture(&client_root, name) else {
            missing.push(name.clone());
            continue;
        };
        let ext = path
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("<none>")
            .to_ascii_lowercase();
        *extension_counts.entry(ext).or_default() += 1;
        match tauri::async_runtime::block_on(decode_texture(path.to_string_lossy().to_string())) {
            Ok(_) => decoded += 1,
            Err(error) => {
                decode_failures.push(format!("{} -> {}: {}", name, path.display(), error))
            }
        }
    }

    println!("Effect asset audit for {}", client_root.display());
    println!("  effect files parsed: {eff_files}");
    println!("  particle files parsed: {par_files}");
    println!("  unique texture refs: {}", refs.len());
    println!(
        "  resolved texture refs: {}",
        refs.len().saturating_sub(missing.len())
    );
    println!("  decoded texture refs: {decoded}");
    println!("  missing texture refs: {}", missing.len());
    println!("  decode failures: {}", decode_failures.len());
    println!("  texture extensions: {:?}", extension_counts);
    println!("  eff parse failures: {}", eff_parse_failures.len());
    println!("  par parse failures: {}", par_parse_failures.len());

    for value in missing.iter().take(20) {
        println!("    missing texture: {value}");
    }
    for value in decode_failures.iter().take(20) {
        println!("    decode failure: {value}");
    }
    for value in eff_parse_failures.iter().take(10) {
        println!("    eff parse failure: {value}");
    }
    for value in par_parse_failures.iter().take(10) {
        println!("    par parse failure: {value}");
    }

    Ok(())
}

fn collect_files(dir: &Path, ext: &str) -> Result<Vec<PathBuf>> {
    let mut files: Vec<_> = std::fs::read_dir(dir)?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.is_file())
        .filter(|path| {
            path.extension()
                .is_some_and(|value| value.eq_ignore_ascii_case(ext))
        })
        .collect();
    files.sort();
    Ok(files)
}

fn collect_ref(refs: &mut BTreeSet<String>, name: &str) {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed == "0" {
        return;
    }
    refs.insert(trimmed.to_string());
}

fn resolve_texture(client_root: &Path, name: &str) -> Option<PathBuf> {
    let texture_root = client_paths::asset_dir(client_root, "texture");
    let has_extension = Path::new(name).extension().is_some();
    let names: Vec<String> = if has_extension {
        vec![name.to_string()]
    } else {
        TEXTURE_EXTS
            .iter()
            .map(|ext| format!("{name}.{ext}"))
            .collect()
    };

    for dir in TEXTURE_DIRS {
        let base = if dir.is_empty() {
            texture_root.clone()
        } else {
            texture_root.join(dir)
        };
        for candidate in &names {
            let path = base.join(candidate);
            if let Some(resolved) = resolve_case_insensitive(&path) {
                return Some(resolved);
            }
        }
    }
    None
}

fn resolve_case_insensitive(path: &Path) -> Option<PathBuf> {
    if path.exists() {
        return Some(path.to_path_buf());
    }

    let parent = path.parent()?;
    let file_name = path.file_name()?.to_str()?.to_ascii_lowercase();
    for entry in std::fs::read_dir(parent).ok()?.flatten() {
        let name = entry.file_name();
        if name.to_string_lossy().to_ascii_lowercase() == file_name {
            return Some(entry.path());
        }
    }

    None
}
