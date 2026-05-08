//! CLI tool that parses a PKO binary file and prints its contents as JSON.
//!
//! Usage:
//!   pko_inspect <file>
//!   pko_inspect <file> --out <json>
//!
//! Supported formats: .lmo, .lgo, .lab, .map, .obj, .eff, .lit, .bin (characterposeinfo)

use std::path::{Path, PathBuf};
use std::process;

use anyhow::{bail, Context, Result};
use serde_json::Value;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let parsed_args = match parse_args(&args) {
        Ok(parsed) => parsed,
        Err(message) => {
            eprintln!("{message}");
            print_usage();
            process::exit(1);
        }
    };

    match inspect(&parsed_args.input) {
        Ok(json) => {
            if let Some(out_path) = parsed_args.out {
                if let Some(parent) = out_path.parent() {
                    if let Err(e) = std::fs::create_dir_all(parent) {
                        eprintln!("Error: failed to create {}: {e}", parent.display());
                        process::exit(1);
                    }
                }
                if let Err(e) = std::fs::write(&out_path, json) {
                    eprintln!("Error: failed to write {}: {e}", out_path.display());
                    process::exit(1);
                }
            } else {
                println!("{json}");
            }
        }
        Err(e) => {
            eprintln!("Error: {e:?}");
            process::exit(1);
        }
    }
}

struct Args {
    input: PathBuf,
    out: Option<PathBuf>,
}

fn parse_args(args: &[String]) -> Result<Args> {
    if args.is_empty() {
        bail!("Missing input file.");
    }
    let mut input: Option<PathBuf> = None;
    let mut out: Option<PathBuf> = None;
    let mut i = 0;
    while i < args.len() {
        match args[i].as_str() {
            "--out" => {
                i += 1;
                let Some(value) = args.get(i) else {
                    bail!("Missing value for --out.");
                };
                out = Some(PathBuf::from(value));
            }
            value if value.starts_with("--") => bail!("Unknown argument: {value}"),
            value => {
                if input.is_some() {
                    bail!("Unexpected extra input file: {value}");
                }
                input = Some(PathBuf::from(value));
            }
        }
        i += 1;
    }

    let Some(input) = input else {
        bail!("Missing input file.");
    };
    Ok(Args { input, out })
}

fn print_usage() {
    eprintln!("Usage:");
    eprintln!("  pko_inspect <file>");
    eprintln!("  pko_inspect <file> --out <json>");
    eprintln!();
    eprintln!("Supported formats: .lmo, .lgo, .lab, .map, .obj, .eff, .par, .lit, .bin");
}

fn inspect(path: &Path) -> Result<String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();

    let value: Value = match ext.as_str() {
        "lmo" => {
            let model = pko_tools_lib::map::lmo_loader::load_lmo(path)?;
            serde_json::to_value(&model).context("serialize LMO")?
        }
        "lgo" => {
            let model = pko_tools_lib::character::lgo_loader::load_lgo(path)?;
            serde_json::to_value(&model).context("serialize LGO")?
        }
        "lab" => {
            let bones = pko_tools_lib::animation::lab_loader::load_lab(path)?;
            serde_json::to_value(&bones).context("serialize LAB")?
        }
        "map" => {
            let data = std::fs::read(path).with_context(|| format!("read {}", path.display()))?;
            let parsed = pko_tools_lib::map::map_loader::load_map(&data)?;
            serde_json::to_value(&parsed).context("serialize MAP")?
        }
        "obj" => {
            let data = std::fs::read(path).with_context(|| format!("read {}", path.display()))?;
            let parsed = pko_tools_lib::map::obj_loader::load_obj(&data)?;
            serde_json::to_value(&parsed).context("serialize OBJ")?
        }
        "eff" => {
            let data = std::fs::read(path).with_context(|| format!("read {}", path.display()))?;
            let parsed = pko_tools_lib::effect::eff_loader::load_eff(&data)?;
            serde_json::to_value(&parsed).context("serialize EFF")?
        }
        "par" => {
            let data = std::fs::read(path).with_context(|| format!("read {}", path.display()))?;
            let parsed = pko_tools_lib::effect::par_loader::load_par(&data)?;
            serde_json::to_value(&parsed).context("serialize PAR")?
        }
        "lit" => {
            let entries = pko_tools_lib::map::lit::parse_lit_tx(path)?;
            serde_json::to_value(&entries).context("serialize LIT")?
        }
        "bin" => {
            let table = pko_tools_lib::animation::pose_info::load_poseinfo(path)?;
            serde_json::to_value(&table).context("serialize poseinfo")?
        }
        other => bail!("Unsupported file extension: .{other}"),
    };

    // Post-process: replace NaN/Inf with null for valid JSON
    let cleaned = sanitize_floats(value);
    serde_json::to_string_pretty(&cleaned).context("format JSON")
}

/// Replace NaN and Infinity float values with JSON null.
fn sanitize_floats(v: Value) -> Value {
    match v {
        Value::Number(n) => {
            if let Some(f) = n.as_f64() {
                if f.is_nan() || f.is_infinite() {
                    return Value::Null;
                }
            }
            Value::Number(n)
        }
        Value::Array(arr) => Value::Array(arr.into_iter().map(sanitize_floats).collect()),
        Value::Object(map) => Value::Object(
            map.into_iter()
                .map(|(k, v)| (k, sanitize_floats(v)))
                .collect(),
        ),
        other => other,
    }
}
