//! Serialize a parsed particle controller JSON file back to PKO .par bytes.
//!
//! Usage:
//!   cargo run --example effect_par_from_json -- <par-json> <out-par>

use std::path::PathBuf;
use std::process;

use anyhow::{bail, Context, Result};
use pko_tools_lib::effect::model::ParFile;

fn main() {
    if let Err(error) = run() {
        eprintln!("Error: {error:?}");
        process::exit(1);
    }
}

fn run() -> Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let parsed = parse_args(&args)?;
    let json = std::fs::read_to_string(&parsed.input)
        .with_context(|| format!("failed to read {}", parsed.input.display()))?;
    let par: ParFile = serde_json::from_str(&json)
        .with_context(|| format!("failed to parse {}", parsed.input.display()))?;
    let bytes = par.to_bytes()?;

    if let Some(parent) = parsed.output.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("failed to create {}", parent.display()))?;
    }
    std::fs::write(&parsed.output, &bytes)
        .with_context(|| format!("failed to write {}", parsed.output.display()))?;

    println!("Wrote {} bytes to {}", bytes.len(), parsed.output.display());
    Ok(())
}

struct Args {
    input: PathBuf,
    output: PathBuf,
}

fn parse_args(args: &[String]) -> Result<Args> {
    if args.len() != 2 {
        bail!("Usage: effect_par_from_json <par-json> <out-par>");
    }
    Ok(Args {
        input: PathBuf::from(&args[0]),
        output: PathBuf::from(&args[1]),
    })
}
