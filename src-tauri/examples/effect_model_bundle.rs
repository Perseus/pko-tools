//! Build a pko-tools effect model bundle for headless pixel capture.
//!
//! Usage:
//!   cargo run --example effect_model_bundle -- <client_dir> <effect_file_or_dir> <out.json>
//!   cargo run --example effect_model_bundle -- <client_dir> --models model1,model2 <out.json>

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use pko_tools_lib::effect::{
    commands::{build_effect_model_gltf, resolve_effect_model_path},
    model::{EffFile, ParFile},
};
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelBundle {
    schema: &'static str,
    client_dir: String,
    models: BTreeMap<String, ModelBundleEntry>,
    effects: BTreeMap<String, EffectBundleEntry>,
    missing: Vec<String>,
    missing_effects: Vec<String>,
    errors: Vec<ModelBundleError>,
}

#[derive(Serialize)]
struct ModelBundleEntry {
    gltf: String,
    source: String,
}

#[derive(Serialize)]
struct EffectBundleEntry {
    effect: EffFile,
    source: String,
}

#[derive(Serialize)]
struct ModelBundleError {
    name: String,
    error: String,
}

#[derive(Default)]
struct SourceRefs {
    model_names: BTreeSet<String>,
    effect_names: BTreeSet<String>,
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

    let (refs, out_path) = if args[1] == "--models" {
        if args.len() < 4 {
            print_usage();
            std::process::exit(1);
        }
        (
            SourceRefs {
                model_names: parse_model_names(&args[2]),
                effect_names: BTreeSet::new(),
            },
            PathBuf::from(&args[3]),
        )
    } else {
        let source = PathBuf::from(&args[1]);
        (
            collect_refs_from_source(&source)?,
            PathBuf::from(&args[2]),
        )
    };

    let bundle = build_bundle(&client_dir, refs);
    let json = serde_json::to_string_pretty(&bundle)?;
    if let Some(parent) = out_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&out_path, json)?;
    eprintln!(
        "Wrote {} models to {} (missing={}, errors={})",
        bundle.models.len(),
        out_path.display(),
        bundle.missing.len(),
        bundle.errors.len(),
    );
    Ok(())
}

fn build_bundle(client_dir: &Path, refs: SourceRefs) -> ModelBundle {
    let mut model_names = refs.model_names;
    let mut models = BTreeMap::new();
    let mut effects = BTreeMap::new();
    let mut missing = Vec::new();
    let mut missing_effects = Vec::new();
    let mut errors = Vec::new();

    for name in refs.effect_names {
        let key = normalize_effect_name(&name);
        if key.is_empty() || effects.contains_key(&key) {
            continue;
        }

        let Some(path) = resolve_effect_path(client_dir, &name) else {
            missing_effects.push(name);
            continue;
        };

        match std::fs::read(&path)
            .with_context(|| format!("read {}", path.display()))
            .and_then(|data| EffFile::from_bytes(&data).map_err(Into::into))
        {
            Ok(effect) => {
                for sub in &effect.sub_effects {
                    add_model_name(&mut model_names, &sub.model_name);
                }
                effects.insert(
                    key,
                    EffectBundleEntry {
                        effect,
                        source: path.to_string_lossy().to_string(),
                    },
                );
            }
            Err(error) => errors.push(ModelBundleError { name, error: error.to_string() }),
        }
    }

    for name in model_names {
        let key = normalize_model_name(&name);
        if key.is_empty() || models.contains_key(&key) {
            continue;
        }

        let Some(path) = resolve_effect_model_path(client_dir, &name) else {
            missing.push(name);
            continue;
        };

        match build_effect_model_gltf(client_dir, &name) {
            Ok(gltf) => {
                models.insert(
                    key,
                    ModelBundleEntry {
                        gltf,
                        source: path.to_string_lossy().to_string(),
                    },
                );
            }
            Err(error) => errors.push(ModelBundleError { name, error }),
        }
    }

    ModelBundle {
        schema: "pko-effect-model-bundle/v1",
        client_dir: client_dir.to_string_lossy().to_string(),
        models,
        effects,
        missing,
        missing_effects,
        errors,
    }
}

fn collect_refs_from_source(source: &Path) -> Result<SourceRefs> {
    if source.is_file() {
        let mut refs = SourceRefs::default();
        collect_refs_from_file(source, &mut refs)?;
        return Ok(refs);
    }

    if !source.is_dir() {
        bail!("effect source does not exist: {}", source.display());
    }

    let mut refs = SourceRefs::default();
    for entry in std::fs::read_dir(source)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_file() {
            collect_refs_from_file(&path, &mut refs)?;
        }
    }
    Ok(refs)
}

fn collect_refs_from_file(path: &Path, refs: &mut SourceRefs) -> Result<()> {
    let ext = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    let data = std::fs::read(path).with_context(|| format!("read {}", path.display()))?;

    match ext.as_str() {
        "eff" => {
            let effect = EffFile::from_bytes(&data)?;
            for sub in effect.sub_effects {
                add_model_name(&mut refs.model_names, &sub.model_name);
            }
        }
        "par" => {
            let particle = ParFile::from_bytes(&data)?;
            for system in particle.systems {
                add_particle_model_ref(refs, &system.model_name);
            }
        }
        _ => {}
    }

    Ok(())
}

fn parse_model_names(value: &str) -> BTreeSet<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn add_model_name(names: &mut BTreeSet<String>, name: &str) {
    let normalized = normalize_model_name(name);
    if !normalized.is_empty() && !is_builtin_model_name(&normalized) {
        names.insert(normalized);
    }
}

fn add_particle_model_ref(refs: &mut SourceRefs, name: &str) {
    if is_effect_model_name(name) {
        let normalized = normalize_effect_name(name);
        if !normalized.is_empty() {
            refs.effect_names.insert(normalized);
        }
        return;
    }
    add_model_name(&mut refs.model_names, name);
}

fn normalize_model_name(name: &str) -> String {
    let mut value = name.trim().replace('\\', "/").to_ascii_lowercase();
    if let Some(file_name) = value.rsplit('/').next() {
        value = file_name.to_owned();
    }
    if value.ends_with(".lgo") {
        value.truncate(value.len() - ".lgo".len());
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

fn is_builtin_model_name(name: &str) -> bool {
    matches!(
        name,
        "" | "cylinder" | "cone" | "rect" | "rectz" | "rectplane" | "triangle" | "triangleplane"
    )
}

fn resolve_effect_path(client_dir: &Path, effect_name: &str) -> Option<PathBuf> {
    let name = normalize_effect_name(effect_name);
    if name.is_empty() {
        return None;
    }
    let target = format!("{}.eff", name);
    let dir = client_dir.join("effect");
    if !dir.exists() {
        return None;
    }
    for entry in std::fs::read_dir(&dir).ok()?.flatten() {
        if let Some(file_name) = entry.file_name().to_str() {
            if file_name.to_ascii_lowercase() == target {
                return Some(entry.path());
            }
        }
    }
    None
}

fn print_usage() {
    eprintln!("Usage:");
    eprintln!("  effect_model_bundle <client_dir> <effect_file_or_dir> <out.json>");
    eprintln!("  effect_model_bundle <client_dir> --models model1,model2 <out.json>");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_model_name_strips_paths_extensions_and_case() {
        assert_eq!(normalize_model_name("Model\\Effect\\Weapon.LGO"), "weapon");
    }

    #[test]
    fn particle_eff_model_names_are_collected_as_nested_effects() {
        let mut refs = SourceRefs::default();
        add_particle_model_ref(&mut refs, "effect\\30Light.EFF");
        add_particle_model_ref(&mut refs, "weapon.lgo");

        assert_eq!(refs.effect_names.into_iter().collect::<Vec<_>>(), vec!["30light"]);
        assert_eq!(refs.model_names.into_iter().collect::<Vec<_>>(), vec!["weapon"]);
    }

    #[test]
    fn builtin_names_are_not_collected() {
        let mut names = BTreeSet::new();
        add_model_name(&mut names, "RectPlane");
        add_model_name(&mut names, "spark.lgo");

        assert_eq!(names.into_iter().collect::<Vec<_>>(), vec!["spark"]);
    }
}
