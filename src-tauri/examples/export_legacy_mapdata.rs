/// Quick one-off: export .mapdata for a map using the Rust pipeline.
/// Usage: cargo run --example export_legacy_mapdata -- <client_dir> <map_name> <output_path>
use std::path::PathBuf;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 4 {
        eprintln!("Usage: export_legacy_mapdata <client_dir> <map_name> <output_mapdata_path>");
        eprintln!("Example: export_legacy_mapdata ./mp-client/client/bin garner /tmp/garner_legacy.mapdata");
        std::process::exit(1);
    }

    let client_dir = PathBuf::from(&args[1]);
    let map_name = &args[2];
    let output_path = PathBuf::from(&args[3]);

    // Load .map
    let map_path = client_dir.join("map").join(format!("{}.map", map_name));
    eprintln!("Loading {}", map_path.display());
    let map_data = std::fs::read(&map_path).expect("Failed to read .map file");
    let parsed_map = pko_tools_lib::map::map_loader::load_map(&map_data).expect("Failed to parse .map");

    eprintln!("Map: {}x{} tiles, {} sections",
        parsed_map.header.n_width, parsed_map.header.n_height,
        parsed_map.sections.len());

    // Export .mapdata
    if let Some(parent) = output_path.parent() {
        std::fs::create_dir_all(parent).ok();
    }

    let result = pko_tools_lib::map::terrain::export_mapdata(
        &parsed_map,
        32, // section_tile_size matching TerrainStreamer default
        &output_path,
    ).expect("Failed to export .mapdata");

    eprintln!("Written {} ({} bytes)", output_path.display(), result.total_size);
    eprintln!("  Collision: {}x{} ({} bytes bitmap)",
        result.collision_w, result.collision_h, result.collision_bitmap_size);
    eprintln!("  Raw block: {} bytes, compressed: {} bytes",
        result.raw_block_size, result.compressed_block_size);
}
