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

    // Check for --characters mode: export_cli <client_dir> <output_dir> --characters [--no-split-animations] [--char-id <id>]
    if args.len() >= 4 && args[3] == "--characters" {
        let client_dir = PathBuf::from(&args[1]);
        let output_dir = PathBuf::from(&args[2]);
        let mut split_animations = true;
        let mut char_id_filter: Option<u32> = None;

        let mut i = 4;
        while i < args.len() {
            match args[i].as_str() {
                "--no-split-animations" => {
                    split_animations = false;
                    i += 1;
                }
                "--char-id" => {
                    if let Some(val) = args.get(i + 1) {
                        char_id_filter = Some(val.parse().unwrap_or_else(|_| {
                            eprintln!("Invalid character id: {}", val);
                            std::process::exit(1);
                        }));
                        i += 2;
                    } else {
                        eprintln!("--char-id requires a value");
                        std::process::exit(1);
                    }
                }
                _ => { i += 1; }
            }
        }

        export_characters(&client_dir, &output_dir, split_animations, char_id_filter);
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
        eprintln!("  export_cli <client_dir> <output_dir> <map_name> [--shared-dir <path>]");
        eprintln!("  export_cli <client_dir> <output_dir> --shared");
        eprintln!("  export_cli <client_dir> <output_dir> --characters [--no-split-animations] [--char-id <id>]");
        eprintln!("  export_cli --dump-scene-obj-info <client_dir> [map_name]");
        eprintln!();
        eprintln!("Examples:");
        eprintln!("  export_cli ./top-client ./unity-export 07xmas2");
        eprintln!("  export_cli ./top-client ./unity-export/Shared --shared");
        eprintln!("  export_cli ./top-client ./unity-export 07xmas2 --shared-dir ./unity-export/Shared");
        eprintln!("  export_cli ./top-client ./unity-export --characters");
        eprintln!("  export_cli ./top-client ./unity-export --characters --char-id 1");
        eprintln!("  export_cli --dump-scene-obj-info ./top-client");
        eprintln!("  export_cli --dump-scene-obj-info ./top-client 07xmas2");
        std::process::exit(1);
    }

    let client_dir = PathBuf::from(&args[1]);
    let output_dir = PathBuf::from(&args[2]).join(&args[3]);
    let map_name = &args[3];

    // Parse optional flags
    let mut options = pko_tools_lib::map::ExportOptions::default();
    let mut i = 4;
    while i < args.len() {
        match args[i].as_str() {
            "--shared-dir" => {
                if let Some(val) = args.get(i + 1) {
                    let shared_path = PathBuf::from(val);
                    if !shared_path.exists() {
                        eprintln!("Shared assets directory does not exist: {}", shared_path.display());
                        eprintln!("Run `export_cli <client_dir> <output_dir> --shared` first.");
                        std::process::exit(1);
                    }
                    options.shared_assets_dir = Some(shared_path);
                    i += 2;
                } else {
                    eprintln!("--shared-dir requires a path to the shared assets directory");
                    std::process::exit(1);
                }
            }
            _ => { i += 1; }
        }
    }

    eprintln!("Exporting map '{}' ...", map_name);
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

fn export_characters(
    client_dir: &PathBuf,
    output_dir: &PathBuf,
    split_animations: bool,
    char_id_filter: Option<u32>,
) {
    let char_info_path = client_dir.join("scripts/table/CharacterInfo.txt");
    if !char_info_path.exists() {
        eprintln!("CharacterInfo.txt not found at {}", char_info_path.display());
        std::process::exit(1);
    }

    let characters = pko_tools_lib::character::info::parse_character_info(char_info_path)
        .unwrap_or_else(|e| {
            eprintln!("Failed to parse CharacterInfo.txt: {:?}", e);
            std::process::exit(1);
        });

    let characters: Vec<_> = if let Some(id) = char_id_filter {
        characters.into_iter().filter(|c| c.id == id).collect()
    } else {
        characters
    };

    if characters.is_empty() {
        eprintln!("No characters found{}", char_id_filter.map_or(String::new(), |id| format!(" with id {}", id)));
        std::process::exit(1);
    }

    // Deduplicate by model ID — multiple characters can share the same model
    let mut seen_models: std::collections::HashSet<u16> = std::collections::HashSet::new();
    let characters: Vec<_> = characters
        .into_iter()
        .filter(|c| seen_models.insert(c.model))
        .collect();

    std::fs::create_dir_all(output_dir).unwrap_or_else(|e| {
        eprintln!("Failed to create output directory: {:?}", e);
        std::process::exit(1);
    });

    eprintln!(
        "Exporting {} unique character model(s) (split_animations={}) ...",
        characters.len(),
        split_animations
    );
    eprintln!("  Client dir: {}", client_dir.display());
    eprintln!("  Output dir: {}", output_dir.display());

    let y_up = true; // glTF standard
    let mut exported = 0u32;
    let mut failed = 0u32;

    for character in &characters {
        let gltf_result = if split_animations {
            character.get_gltf_json(client_dir, y_up)
        } else {
            // Force legacy single-animation by temporarily hiding the data files.
            // Instead, we call get_gltf_json which auto-detects — to force no-split,
            // we'd need a parameter. For now, just use get_gltf_json since split is
            // the default when data files exist. The --no-split flag would require
            // a code path change in get_gltf_json. Log a note.
            eprintln!("  [note] --no-split-animations not yet fully implemented, using auto-detect");
            character.get_gltf_json(client_dir, y_up)
        };

        match gltf_result {
            Ok(gltf_json) => {
                let out_path = output_dir.join(format!("{}.gltf", character.id));
                match std::fs::write(&out_path, gltf_json) {
                    Ok(_) => {
                        exported += 1;
                        eprintln!(
                            "  [ok] char {} (model {}) → {}",
                            character.id,
                            character.model,
                            out_path.display()
                        );
                    }
                    Err(e) => {
                        failed += 1;
                        eprintln!(
                            "  [err] char {} (model {}): write failed: {}",
                            character.id, character.model, e
                        );
                    }
                }
            }
            Err(e) => {
                failed += 1;
                eprintln!(
                    "  [err] char {} (model {}): {}",
                    character.id, character.model, e
                );
            }
        }
    }

    eprintln!();
    eprintln!("Character export complete: {} exported, {} failed", exported, failed);
    if failed > 0 {
        std::process::exit(1);
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

        let parsed = match pko_tools_lib::map::obj_loader::load_obj(&data) {
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
