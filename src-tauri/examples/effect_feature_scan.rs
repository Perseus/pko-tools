//! Scan a PKO effect directory and print representative .eff files for render branches.
//!
//! Usage:
//!   cargo run --example effect_feature_scan -- <effect-dir>

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process;

use anyhow::{bail, Context, Result};
use pko_tools_lib::effect::model::{EffFile, SubEffect};
use serde::Serialize;

fn main() {
    if let Err(error) = run() {
        eprintln!("Error: {error:?}");
        process::exit(1);
    }
}

fn run() -> Result<()> {
    let dir = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .ok_or_else(|| anyhow::anyhow!("Usage: effect_feature_scan <effect-dir>"))?;
    if !dir.is_dir() {
        bail!("{} is not a directory", dir.display());
    }

    let mut paths: Vec<PathBuf> = std::fs::read_dir(&dir)
        .with_context(|| format!("failed to read {}", dir.display()))?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| {
            path.extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("eff"))
        })
        .collect();
    paths.sort();

    let mut report = ScanReport {
        effect_dir: dir.display().to_string(),
        file_count: 0,
        parse_failures: Vec::new(),
        features: BTreeMap::new(),
    };

    for path in paths {
        let bytes =
            std::fs::read(&path).with_context(|| format!("failed to read {}", path.display()))?;
        let effect = match EffFile::from_bytes(&bytes) {
            Ok(effect) => effect,
            Err(error) => {
                report
                    .parse_failures
                    .push(format!("{}: {error}", path.display()));
                continue;
            }
        };
        report.file_count += 1;
        scan_effect(&mut report, &dir, &path, &effect);
    }

    println!("{}", serde_json::to_string_pretty(&report)?);
    Ok(())
}

fn scan_effect(report: &mut ScanReport, root: &Path, path: &Path, effect: &EffFile) {
    if effect.rotating {
        record(report, "groupRotation", root, path, None);
    }

    for (index, sub) in effect.sub_effects.iter().enumerate() {
        if model_name_eq(sub, "Rect") {
            record(report, "builtinRect", root, path, Some(index));
        }
        if model_name_eq(sub, "Cylinder") || model_name_eq(sub, "Cone") {
            record(report, "builtinCylinder", root, path, Some(index));
        }
        if model_name_lower(sub).ends_with(".lgo") {
            record(report, "externalLgo", root, path, Some(index));
        }
        if sub.rota_loop {
            record(report, "rotaLoop", root, path, Some(index));
        }
        if sub.frame_tex_count > 0 || !sub.frame_tex_names.is_empty() {
            record(report, "frameTexture", root, path, Some(index));
        }
        if sub.tex_count > 1 || sub.tex_list.len() > 1 || sub.effect_type == 1 {
            record(report, "uvAnimation", root, path, Some(index));
        }
        if sub.use_param > 0 || !sub.per_frame_cylinder.is_empty() {
            record(report, "useParam", root, path, Some(index));
        }
        if sub.alpha {
            record(
                report,
                "transparentBlackAlphaCandidate",
                root,
                path,
                Some(index),
            );
        }
    }
}

fn record(
    report: &mut ScanReport,
    feature: &'static str,
    root: &Path,
    path: &Path,
    sub_effect_index: Option<usize>,
) {
    let entries = report.features.entry(feature.to_string()).or_default();
    if entries.len() >= 32 {
        return;
    }
    let relative = path
        .strip_prefix(root)
        .unwrap_or(path)
        .display()
        .to_string();
    if entries
        .iter()
        .any(|entry| entry.file == relative && entry.sub_effect_index == sub_effect_index)
    {
        return;
    }
    entries.push(FeatureHit {
        file: relative,
        sub_effect_index,
    });
}

fn model_name_eq(sub: &SubEffect, expected: &str) -> bool {
    sub.model_name.trim().eq_ignore_ascii_case(expected)
}

fn model_name_lower(sub: &SubEffect) -> String {
    sub.model_name.trim().to_ascii_lowercase()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanReport {
    effect_dir: String,
    file_count: usize,
    parse_failures: Vec<String>,
    features: BTreeMap<String, Vec<FeatureHit>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FeatureHit {
    file: String,
    sub_effect_index: Option<usize>,
}
