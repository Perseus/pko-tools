//! Scan a PKO effect directory and print representative .par files for particle branches.
//!
//! Usage:
//!   cargo run --example particle_feature_scan -- <effect-dir>

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process;

use anyhow::{bail, Context, Result};
use pko_tools_lib::effect::model::ParFile;
use serde::Serialize;

fn main() {
    if let Err(error) = run() {
        eprintln!("Error: {error:?}");
        process::exit(1);
    }
}

fn run() -> Result<()> {
    let dir = std::env::args().nth(1).map(PathBuf::from)
        .ok_or_else(|| anyhow::anyhow!("Usage: particle_feature_scan <effect-dir>"))?;
    if !dir.is_dir() {
        bail!("{} is not a directory", dir.display());
    }

    let mut paths: Vec<PathBuf> = std::fs::read_dir(&dir)
        .with_context(|| format!("failed to read {}", dir.display()))?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("par")))
        .collect();
    paths.sort();

    let mut report = ScanReport {
        effect_dir: dir.display().to_string(),
        file_count: 0,
        parse_failures: Vec::new(),
        features: BTreeMap::new(),
    };

    for path in paths {
        let bytes = std::fs::read(&path)
            .with_context(|| format!("failed to read {}", path.display()))?;
        let par = match ParFile::from_bytes(&bytes) {
            Ok(par) => par,
            Err(error) => {
                report.parse_failures.push(format!("{}: {error}", path.display()));
                continue;
            }
        };
        report.file_count += 1;
        if !par.models.is_empty() {
            record(&mut report, "characterModel", &dir, &path, None);
        }
    }

    println!("{}", serde_json::to_string_pretty(&report)?);
    Ok(())
}

fn record(
    report: &mut ScanReport,
    feature: &'static str,
    root: &Path,
    path: &Path,
    system_index: Option<usize>,
) {
    let entries = report.features.entry(feature.to_string()).or_default();
    if entries.len() >= 32 {
        return;
    }
    entries.push(FeatureHit {
        file: path.strip_prefix(root).unwrap_or(path).display().to_string(),
        system_index,
    });
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
    system_index: Option<usize>,
}
