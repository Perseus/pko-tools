use std::collections::HashMap;
use std::path::PathBuf;

fn main() {
    let args: Vec<String> = std::env::args().collect();

    // Check for --dump-scene-obj-info mode
    if args.len() >= 3 && args[1] == "--dump-scene-obj-info" {
        let client_dir = PathBuf::from(&args[2]);
        let map_name = args.get(3).map(|s| s.as_str());
        dump_scene_obj_info(&client_dir, map_name);
        return;
    }

    // Check for --shared mode: export_cli <client_dir> <output_dir> --shared
    if args.len() >= 4 && args[3] == "--shared" {
        let client_dir = PathBuf::from(&args[1]);
        let output_dir = PathBuf::from(&args[2]);

        eprintln!("Exporting shared assets ...");
        eprintln!("  Client dir: {}", client_dir.display());
        eprintln!("  Output dir: {}", output_dir.display());

        match pko_tools_lib::map::shared::export_shared_assets(&client_dir, &output_dir) {
            Ok(result) => {
                eprintln!("Shared export complete!");
                eprintln!("  Terrain textures: {}", result.total_terrain_textures);
                eprintln!("  Buildings exported: {} ({} failed)", result.total_buildings_exported, result.total_buildings_failed);
                eprintln!("  Effect textures: {}", result.total_effect_textures);
                eprintln!("  Water textures: {}", result.total_water_textures);
                eprintln!("  Alpha masks: {}", if result.has_alpha_masks { "yes" } else { "no" });
            }
            Err(e) => {
                eprintln!("Shared export failed: {:?}", e);
                std::process::exit(1);
            }
        }
        return;
    }

    if args.len() < 4 {
        eprintln!("Usage:");
        eprintln!("  export_cli <client_dir> <output_dir> <map_name> [--format v2|v3]");
        eprintln!("  export_cli <client_dir> <output_dir> --shared");
        eprintln!("  export_cli --dump-scene-obj-info <client_dir> [map_name]");
        eprintln!();
        eprintln!("Examples:");
        eprintln!("  export_cli ./top-client ./unity-export 07xmas2");
        eprintln!("  export_cli ./top-client ./unity-export 07xmas2 --format v2");
        eprintln!("  export_cli ./top-client ./unity-export/Shared --shared");
        eprintln!("  export_cli --dump-scene-obj-info ./top-client");
        eprintln!("  export_cli --dump-scene-obj-info ./top-client 07xmas2");
        std::process::exit(1);
    }

    let client_dir = PathBuf::from(&args[1]);
    let output_dir = PathBuf::from(&args[2]).join(&args[3]);
    let map_name = &args[3];

    // Parse optional --format flag
    let mut options = pko_tools_lib::map::ExportOptions::default();
    let mut i = 4;
    while i < args.len() {
        if args[i] == "--format" {
            if let Some(val) = args.get(i + 1) {
                match val.as_str() {
                    "v2" => options.manifest_version = 2,
                    "v3" => options.manifest_version = 3,
                    other => {
                        eprintln!("Unknown format '{}', expected v2 or v3", other);
                        std::process::exit(1);
                    }
                }
                i += 2;
            } else {
                eprintln!("--format requires a value (v2 or v3)");
                std::process::exit(1);
            }
        } else {
            i += 1;
        }
    }

    eprintln!("Exporting map '{}' (manifest v{}) ...", map_name, options.manifest_version);
    eprintln!("  Client dir: {}", client_dir.display());
    eprintln!("  Output dir: {}", output_dir.display());

    match pko_tools_lib::map::terrain::export_map_for_unity(&client_dir, map_name, &output_dir, &options) {
        Ok(result) => {
            eprintln!("Export complete!");
            eprintln!("  Terrain glTF: {}", result.terrain_gltf_path);
            eprintln!("  Manifest: {}", result.manifest_path);
            eprintln!("  Buildings exported: {}", result.total_buildings_exported);
            eprintln!("  Total placements: {}", result.total_placements);
        }
        Err(e) => {
            eprintln!("Export failed: {:?}", e);
            std::process::exit(1);
        }
    }
}

fn dump_scene_obj_info(client_dir: &PathBuf, map_name: Option<&str>) {
    // Load sceneobjinfo.bin
    let obj_info = match pko_tools_lib::map::scene_obj_info::load_scene_obj_info(client_dir) {
        Ok(info) => info,
        Err(e) => {
            eprintln!("Failed to load sceneobjinfo.bin: {:?}", e);
            std::process::exit(1);
        }
    };

    // Sort entries by ID
    let mut entries: Vec<_> = obj_info.values().collect();
    entries.sort_by_key(|e| e.id);

    for entry in &entries {
        println!("id={} filename={}", entry.id, entry.filename);
    }
    eprintln!("Total entries: {}", entries.len());

    // If a map name was provided, cross-reference with the .obj file
    if let Some(name) = map_name {
        let obj_path = client_dir.join("map").join(format!("{}.obj", name));
        eprintln!();
        eprintln!("Loading .obj file: {}", obj_path.display());

        let data = match std::fs::read(&obj_path) {
            Ok(d) => d,
            Err(e) => {
                eprintln!("Failed to read .obj file: {:?}", e);
                std::process::exit(1);
            }
        };

        let parsed = match pko_tools_lib::map::scene_obj::parse_obj_file(&data) {
            Ok(p) => p,
            Err(e) => {
                eprintln!("Failed to parse .obj file: {:?}", e);
                std::process::exit(1);
            }
        };

        eprintln!(
            "Parsed .obj: sections={}x{}, section_size={}x{}, total_objects={}",
            parsed.section_cnt_x,
            parsed.section_cnt_y,
            parsed.section_width,
            parsed.section_height,
            parsed.objects.len()
        );

        // Count placements per obj_id (only type 0 = models)
        let mut usage_counts: HashMap<u16, usize> = HashMap::new();
        let mut effect_count = 0usize;
        for obj in &parsed.objects {
            if obj.obj_type == 0 {
                *usage_counts.entry(obj.obj_id).or_insert(0) += 1;
            } else {
                effect_count += 1;
            }
        }

        let model_count: usize = usage_counts.values().sum();
        eprintln!(
            "Model placements: {} ({} unique obj_ids), Effect placements: {}",
            model_count,
            usage_counts.len(),
            effect_count
        );

        // Sort by obj_id and print cross-reference
        let mut used_ids: Vec<_> = usage_counts.into_iter().collect();
        used_ids.sort_by_key(|(id, _)| *id);

        eprintln!();
        println!("--- Cross-reference: obj_ids used in {} ---", name);
        let mut found = 0usize;
        let mut missing = 0usize;
        for (obj_id, count) in &used_ids {
            let info = obj_info.get(&(*obj_id as u32));
            match info {
                Some(entry) => {
                    println!(
                        "obj_id={} count={} filename={}",
                        obj_id, count, entry.filename
                    );
                    found += 1;
                }
                None => {
                    println!(
                        "obj_id={} count={} filename=<NOT FOUND in sceneobjinfo.bin>",
                        obj_id, count
                    );
                    missing += 1;
                }
            }
        }
        eprintln!(
            "Cross-reference: {} found, {} missing from sceneobjinfo.bin",
            found, missing
        );
    }
}
