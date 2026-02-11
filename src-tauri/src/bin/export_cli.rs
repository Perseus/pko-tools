use std::fs;
use std::path::{Path, PathBuf};

fn export_lgo_to_gltf(lgo_path: &Path, texture_dir: &Path, output_path: &Path) -> anyhow::Result<()> {
    let gltf_json = pko_tools_lib::item::model::build_gltf_from_lgo(lgo_path, texture_dir)?;
    fs::write(output_path, &gltf_json)?;
    Ok(())
}

fn export_map_for_unity(client_dir: &Path, map_name: &str, output_dir: &Path) -> anyhow::Result<()> {
    println!("Exporting map '{}' for Unity...", map_name);
    let result = pko_tools_lib::map::terrain::export_map_for_unity(client_dir, map_name, output_dir)?;
    println!("Done!");
    println!("  Output dir: {}", result.output_dir);
    println!("  Terrain: {}", result.terrain_gltf_path);
    println!("  Manifest: {}", result.manifest_path);
    println!("  Buildings exported: {}", result.total_buildings_exported);
    println!("  Total placements: {}", result.total_placements);
    Ok(())
}

fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();

    if args.len() < 3 {
        eprintln!("Usage:");
        eprintln!("  export_cli <client_dir> <output_dir> [options]");
        eprintln!();
        eprintln!("Options:");
        eprintln!("  --filter character|item    Filter by model type");
        eprintln!("  --limit N                  Limit number of exports");
        eprintln!("  --files id1,id2,...         Export specific model IDs");
        eprintln!("  --subdir name              Output subdirectory name");
        eprintln!("  --map <map_name>           Export a map for Unity (terrain + buildings + collision)");
        eprintln!();
        eprintln!("Examples:");
        eprintln!("  export_cli /path/to/top-client /path/to/output --filter item --limit 10");
        eprintln!("  export_cli /path/to/top-client /path/to/output --filter character --files 0010000000,0100000000 --subdir npc");
        eprintln!("  export_cli /path/to/top-client /path/to/output --map 07xmas");
        std::process::exit(1);
    }

    let client_dir = PathBuf::from(&args[1]);
    let output_dir = PathBuf::from(&args[2]);

    let mut filter: Option<&str> = None;
    let mut limit: Option<usize> = None;
    let mut specific_files: Option<Vec<String>> = None;
    let mut subdir: Option<String> = None;
    let mut map_name: Option<String> = None;

    let mut i = 3;
    while i < args.len() {
        match args[i].as_str() {
            "--filter" => { i += 1; filter = Some(args.get(i).map(|s| s.as_str()).unwrap_or("")); }
            "--limit" => { i += 1; limit = args.get(i).and_then(|s| s.parse().ok()); }
            "--files" => { i += 1; specific_files = args.get(i).map(|s| s.split(',').map(|f| f.to_string()).collect()); }
            "--subdir" => { i += 1; subdir = args.get(i).map(|s| s.to_string()); }
            "--map" => { i += 1; map_name = args.get(i).map(|s| s.to_string()); }
            _ => { eprintln!("Unknown flag: {}", args[i]); std::process::exit(1); }
        }
        i += 1;
    }

    // Handle map export mode
    if let Some(ref name) = map_name {
        return export_map_for_unity(&client_dir, name, &output_dir);
    }

    let character_model_dir = client_dir.join("model/character");
    let item_model_dir = client_dir.join("model/item");

    let mut lgo_files: Vec<(PathBuf, String)> = Vec::new();

    if let Some(ref files) = specific_files {
        // Export specific files by ID
        let category = filter.unwrap_or("character");
        let model_dir = if category == "item" { &item_model_dir } else { &character_model_dir };
        for file_id in files {
            let filename = if file_id.ends_with(".lgo") { file_id.clone() } else { format!("{}.lgo", file_id) };
            let path = model_dir.join(&filename);
            if path.exists() {
                lgo_files.push((path, category.to_string()));
            } else {
                eprintln!("Not found: {}", path.display());
            }
        }
    } else {
        // Collect by filter
        if filter.is_none() || filter == Some("character") {
            if character_model_dir.exists() {
                let mut entries: Vec<_> = fs::read_dir(&character_model_dir)?
                    .filter_map(|e| e.ok())
                    .filter(|e| e.path().extension().map(|ext| ext == "lgo").unwrap_or(false))
                    .collect();
                entries.sort_by_key(|e| e.file_name());
                for entry in entries {
                    lgo_files.push((entry.path(), "character".to_string()));
                }
            }
        }
        if filter.is_none() || filter == Some("item") {
            if item_model_dir.exists() {
                let mut entries: Vec<_> = fs::read_dir(&item_model_dir)?
                    .filter_map(|e| e.ok())
                    .filter(|e| e.path().extension().map(|ext| ext == "lgo").unwrap_or(false))
                    .collect();
                entries.sort_by_key(|e| e.file_name());
                for entry in entries {
                    lgo_files.push((entry.path(), "item".to_string()));
                }
            }
        }
    }

    if let Some(n) = limit {
        lgo_files.truncate(n);
    }

    println!("Found {} LGO files to export", lgo_files.len());

    // Create output directory
    let out_subdir = if let Some(ref s) = subdir {
        output_dir.join(s)
    } else {
        output_dir.clone()
    };
    fs::create_dir_all(&out_subdir)?;

    let mut success = 0;
    let mut failed = 0;
    let total = lgo_files.len();

    for (lgo_path, _category) in &lgo_files {
        let stem = lgo_path.file_stem().unwrap().to_string_lossy();
        let output_path = out_subdir.join(format!("{}.gltf", stem));
        let texture_dir = &client_dir;

        match export_lgo_to_gltf(lgo_path, texture_dir, &output_path) {
            Ok(()) => {
                success += 1;
                println!("[{}/{}] OK {}.gltf", success + failed, total, stem);
            }
            Err(e) => {
                failed += 1;
                eprintln!("[{}/{}] FAIL {}: {}", success + failed, total, stem, e);
            }
        }
    }

    println!("\nDone! {} succeeded, {} failed out of {} total", success, failed, total);
    println!("Output: {}", out_subdir.display());

    Ok(())
}
