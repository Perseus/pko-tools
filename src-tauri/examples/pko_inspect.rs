//! CLI tool that parses a PKO binary file and prints its contents as JSON.
//!
//! Usage: pko_inspect <file>
//!
//! Supported formats: .lmo, .lgo, .lab, .map, .obj, .eff, .lit

use std::path::Path;
use std::process;

use anyhow::{Context, Result, bail};
use serde_json::Value;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 2 {
        eprintln!("Usage: pko_inspect <file>");
        eprintln!();
        eprintln!("Supported formats: .lmo, .lgo, .lab, .map, .obj, .eff, .par, .lit");
        process::exit(1);
    }

    let path = Path::new(&args[1]);
    match inspect(path) {
        Ok(json) => println!("{json}"),
        Err(e) => {
            eprintln!("Error: {e:?}");
            process::exit(1);
        }
    }
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
            let data = std::fs::read(path)
                .with_context(|| format!("read {}", path.display()))?;
            let parsed = pko_tools_lib::map::map_loader::load_map(&data)?;
            serde_json::to_value(&parsed).context("serialize MAP")?
        }
        "obj" => {
            let data = std::fs::read(path)
                .with_context(|| format!("read {}", path.display()))?;
            let parsed = pko_tools_lib::map::obj_loader::load_obj(&data)?;
            serde_json::to_value(&parsed).context("serialize OBJ")?
        }
        "eff" => {
            let data = std::fs::read(path)
                .with_context(|| format!("read {}", path.display()))?;
            let parsed = pko_tools_lib::effect::eff_loader::load_eff(&data)?;
            serde_json::to_value(&parsed).context("serialize EFF")?
        }
        "par" => {
            let data = std::fs::read(path)
                .with_context(|| format!("read {}", path.display()))?;
            let parsed = pko_tools_lib::effect::par_loader::load_par(&data)?;
            serde_json::to_value(&parsed).context("serialize PAR")?
        }
        "lit" => {
            let entries = pko_tools_lib::map::lit::parse_lit_tx(path)?;
            serde_json::to_value(&entries).context("serialize LIT")?
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
        Value::Object(map) => {
            Value::Object(map.into_iter().map(|(k, v)| (k, sanitize_floats(v))).collect())
        }
        other => other,
    }
}
