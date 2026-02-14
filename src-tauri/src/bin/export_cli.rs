use std::path::PathBuf;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 4 {
        eprintln!("Usage: export_cli <client_dir> <output_dir> <map_name>");
        eprintln!("Example: export_cli ./top-client ./unity-export 07xmas2");
        std::process::exit(1);
    }

    let client_dir = PathBuf::from(&args[1]);
    let output_dir = PathBuf::from(&args[2]).join(&args[3]);
    let map_name = &args[3];

    eprintln!("Exporting map '{}' ...", map_name);
    eprintln!("  Client dir: {}", client_dir.display());
    eprintln!("  Output dir: {}", output_dir.display());

    match pko_tools_lib::map::terrain::export_map_for_unity(&client_dir, map_name, &output_dir) {
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
