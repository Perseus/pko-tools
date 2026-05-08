//! Build a pko-tools effect texture bundle for headless pixel capture.
//!
//! Usage:
//!   cargo run --example effect_texture_bundle -- <client_dir> <effect_file_or_dir> <out.json>
//!   cargo run --example effect_texture_bundle -- <client_dir> --textures tex1,tex2 <out.json>

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use base64::Engine;
use pko_tools_lib::effect::{
    commands::decode_texture,
    model::{EffFile, ParFile},
};
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TextureBundle {
    schema: &'static str,
    client_dir: String,
    textures: BTreeMap<String, TextureBundleEntry>,
    missing: Vec<String>,
    errors: Vec<TextureBundleError>,
}

#[derive(Serialize)]
struct TextureBundleEntry {
    width: u32,
    height: u32,
    rgba: String,
    source: String,
}

#[derive(Serialize)]
struct TextureBundleError {
    name: String,
    path: String,
    error: String,
}

fn main() -> Result<()> {
    let mut args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().is_some_and(|arg| arg == "--") {
        args.remove(0);
    }
    if args.len() < 3 {
        print_usage();
        std::process::exit(1);
    }

    let client_dir = PathBuf::from(&args[0]);
    if !client_dir.exists() {
        bail!("client dir does not exist: {}", client_dir.display());
    }

    let (texture_names, out_path) = if args[1] == "--textures" {
        if args.len() < 4 {
            print_usage();
            std::process::exit(1);
        }
        (parse_texture_names(&args[2]), PathBuf::from(&args[3]))
    } else {
        let source = PathBuf::from(&args[1]);
        (
            collect_texture_names_from_source(&source)?,
            PathBuf::from(&args[2]),
        )
    };

    let bundle = build_bundle(&client_dir, texture_names)?;
    let json = serde_json::to_string_pretty(&bundle)?;
    if let Some(parent) = out_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&out_path, json)?;
    eprintln!(
        "Wrote {} textures to {} (missing={}, errors={})",
        bundle.textures.len(),
        out_path.display(),
        bundle.missing.len(),
        bundle.errors.len(),
    );
    Ok(())
}

fn build_bundle(client_dir: &Path, texture_names: BTreeSet<String>) -> Result<TextureBundle> {
    let mut textures = BTreeMap::new();
    let mut missing = Vec::new();
    let mut errors = Vec::new();

    for name in texture_names {
        let key = normalize_texture_name(&name);
        if key.is_empty() || textures.contains_key(&key) {
            continue;
        }

        let Some(path) = resolve_texture_path(client_dir, &name) else {
            missing.push(name);
            continue;
        };

        match tauri::async_runtime::block_on(decode_texture(path.to_string_lossy().to_string())) {
            Ok(decoded) => {
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(decoded.data.as_bytes())
                    .context("decode texture base64")?;
                let quantized = emulate_d3d_a4r4g4b4(&bytes);
                textures.insert(
                    key,
                    TextureBundleEntry {
                        width: decoded.width,
                        height: decoded.height,
                        rgba: base64::engine::general_purpose::STANDARD.encode(quantized),
                        source: path.to_string_lossy().to_string(),
                    },
                );
            }
            Err(error) => errors.push(TextureBundleError {
                name,
                path: path.to_string_lossy().to_string(),
                error,
            }),
        }
    }

    Ok(TextureBundle {
        schema: "pko-effect-texture-bundle/v1",
        client_dir: client_dir.to_string_lossy().to_string(),
        textures,
        missing,
        errors,
    })
}

fn collect_texture_names_from_source(source: &Path) -> Result<BTreeSet<String>> {
    if source.is_file() {
        let mut names = BTreeSet::new();
        collect_texture_names_from_file(source, &mut names)?;
        return Ok(names);
    }

    if !source.is_dir() {
        bail!("effect source does not exist: {}", source.display());
    }

    let mut names = BTreeSet::new();
    for entry in std::fs::read_dir(source)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_file() {
            collect_texture_names_from_file(&path, &mut names)?;
        }
    }
    Ok(names)
}

fn collect_texture_names_from_file(path: &Path, names: &mut BTreeSet<String>) -> Result<()> {
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let data = std::fs::read(path).with_context(|| format!("read {}", path.display()))?;

    match ext.as_str() {
        "eff" => {
            let effect = EffFile::from_bytes(&data)?;
            collect_eff_textures(&effect, names);
        }
        "par" => {
            let particle = ParFile::from_bytes(&data)?;
            for system in particle.systems {
                add_texture_name(names, &system.texture_name);
                if is_effect_model_name(&system.model_name) {
                    collect_nested_effect_textures(path, &system.model_name, names)?;
                }
            }
            for strip in particle.strips {
                add_texture_name(names, &strip.texture_name);
            }
        }
        _ => {}
    }

    Ok(())
}

fn collect_eff_textures(effect: &EffFile, names: &mut BTreeSet<String>) {
    for sub in &effect.sub_effects {
        add_texture_name(names, &sub.tex_name);
        for frame_tex in &sub.frame_tex_names {
            add_texture_name(names, frame_tex);
        }
    }
}

fn collect_nested_effect_textures(
    source_path: &Path,
    effect_name: &str,
    names: &mut BTreeSet<String>,
) -> Result<()> {
    let Some(effect_path) = resolve_effect_path(source_path, effect_name) else {
        return Ok(());
    };
    let data = std::fs::read(&effect_path)
        .with_context(|| format!("read nested effect {}", effect_path.display()))?;
    let effect = EffFile::from_bytes(&data)?;
    collect_eff_textures(&effect, names);
    Ok(())
}

fn parse_texture_names(value: &str) -> BTreeSet<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn add_texture_name(names: &mut BTreeSet<String>, name: &str) {
    let normalized = normalize_texture_name(name);
    if !normalized.is_empty() {
        names.insert(normalized);
    }
}

fn resolve_texture_path(client_dir: &Path, name: &str) -> Option<PathBuf> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return None;
    }

    let has_extension = Path::new(trimmed).extension().is_some();
    let names: Vec<String> = if has_extension {
        vec![trimmed.to_owned()]
    } else {
        ["tga", "dds", "png", "bmp"]
            .iter()
            .map(|ext| format!("{trimmed}.{ext}"))
            .collect()
    };

    for dir in [
        "texture/effect",
        "texture",
        "texture/skill",
        "texture/sceneffect",
        "texture/lit",
    ] {
        let root = client_dir.join(dir);
        for candidate in &names {
            if let Some(path) = resolve_case_insensitive(&root, candidate) {
                return Some(path);
            }
        }
    }

    None
}

fn resolve_case_insensitive(dir: &Path, name: &str) -> Option<PathBuf> {
    let target = name.to_ascii_lowercase();
    for entry in std::fs::read_dir(dir).ok()?.filter_map(|entry| entry.ok()) {
        let file_name = entry.file_name();
        if file_name.to_string_lossy().to_ascii_lowercase() == target {
            return Some(entry.path());
        }
    }
    None
}

fn normalize_texture_name(name: &str) -> String {
    let mut value = name.trim().replace('\\', "/").to_ascii_lowercase();
    if let Some(file_name) = value.rsplit('/').next() {
        value = file_name.to_owned();
    }
    for ext in [".tga", ".dds", ".png", ".bmp"] {
        if value.ends_with(ext) {
            value.truncate(value.len() - ext.len());
            break;
        }
    }
    value
}

fn normalize_effect_name(name: &str) -> String {
    let mut value = name.trim().replace('\\', "/").to_ascii_lowercase();
    if let Some(file_name) = value.rsplit('/').next() {
        value = file_name.to_owned();
    }
    if value.ends_with(".eff") {
        value.truncate(value.len() - ".eff".len());
    }
    value
}

fn is_effect_model_name(name: &str) -> bool {
    name.trim().to_ascii_lowercase().ends_with(".eff")
}

fn resolve_effect_path(source_path: &Path, effect_name: &str) -> Option<PathBuf> {
    let dir = source_path.parent()?;
    let target = format!("{}.eff", normalize_effect_name(effect_name));
    resolve_case_insensitive(dir, &target)
}

fn emulate_d3d_a4r4g4b4(rgba: &[u8]) -> Vec<u8> {
    rgba.iter()
        .map(|value| {
            let packed4 = value >> 4;
            packed4 | (packed4 << 4)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_effect_name_strips_paths_extensions_and_case() {
        assert_eq!(normalize_effect_name("effect\\30Light.EFF"), "30light");
    }

    #[test]
    fn effect_model_names_are_detected_case_insensitively() {
        assert!(is_effect_model_name("30Light.EFF"));
        assert!(!is_effect_model_name("weapon.lgo"));
    }
}

fn print_usage() {
    eprintln!("Usage:");
    eprintln!("  effect_texture_bundle <client_dir> <effect_file_or_dir> <out.json>");
    eprintln!("  effect_texture_bundle <client_dir> --textures tex1,tex2 <out.json>");
}
