//! Dump a pko-tools-side pko-effect-trace/v1 artifact for one .eff file.
//!
//! Usage:
//!   cargo run --example effect_trace_dump -- <eff_path> <output.json> [--loop 0|1] [--times 0,0.1,0.2]

use std::path::PathBuf;

use pko_tools_lib::effect::{model::EffFile, trace::sample_effect_trace_artifact};

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 3 {
        eprintln!(
            "Usage: effect_trace_dump <eff_path> <output.json> [--loop 0|1] [--times 0,0.1,0.2]"
        );
        std::process::exit(1);
    }

    let eff_path = PathBuf::from(&args[1]);
    let output_path = PathBuf::from(&args[2]);
    let mut loop_playback = true;
    let mut sample_times = vec![0.0, 0.1, 0.2, 0.5, 1.0, 1.5, 2.0, 3.0];

    let mut i = 3;
    while i < args.len() {
        match args[i].as_str() {
            "--loop" if i + 1 < args.len() => {
                loop_playback = args[i + 1] != "0";
                i += 2;
            }
            "--times" if i + 1 < args.len() => {
                sample_times = parse_sample_times(&args[i + 1]);
                i += 2;
            }
            _ => {
                i += 1;
            }
        }
    }

    let bytes = std::fs::read(&eff_path)?;
    let effect = EffFile::from_bytes(&bytes)?;
    let artifact = sample_effect_trace_artifact(
        &effect,
        &sample_times,
        loop_playback,
        "pko-tools-rust",
        eff_path
            .file_name()
            .map(|name| name.to_string_lossy().to_string()),
    );
    let json = serde_json::to_string_pretty(&artifact)?;

    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&output_path, json)?;
    eprintln!("Wrote {}", output_path.display());
    Ok(())
}

fn parse_sample_times(input: &str) -> Vec<f32> {
    let values: Vec<f32> = input
        .split(',')
        .filter_map(|value| value.trim().parse::<f32>().ok())
        .collect();

    if values.is_empty() {
        vec![0.0, 0.1, 0.2, 0.5, 1.0, 1.5, 2.0, 3.0]
    } else {
        values
    }
}
