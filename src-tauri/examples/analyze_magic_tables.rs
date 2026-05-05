//! Detailed analysis of MagicGroupInfo.bin with cross-references to MagicSingleinfo.bin
//!
//! Usage: analyze_magic_tables <scripts_table_dir>

use std::path::Path;
use std::collections::HashMap;

fn main() {
    let args: Vec<String> = std::env::args().collect();

    if args.len() < 2 {
        eprintln!("Usage: analyze_magic_tables <scripts_table_dir>");
        std::process::exit(1);
    }

    let table_dir = Path::new(&args[1]);
    
    // Load both tables
    let group_path = table_dir.join("MagicGroupInfo.bin");
    let single_path = table_dir.join("MagicSingleinfo.bin");
    
    if !group_path.exists() || !single_path.exists() {
        eprintln!("Error: Missing MagicGroupInfo.bin or MagicSingleinfo.bin");
        std::process::exit(1);
    }

    let group_data = std::fs::read(&group_path).expect("Failed to read MagicGroupInfo.bin");
    let single_data = std::fs::read(&single_path).expect("Failed to read MagicSingleinfo.bin");
    
    let group_table = pko_tools_lib::effect_v2::magic_group_loader::load_magic_group(&group_data)
        .expect("Failed to parse MagicGroupInfo.bin");
    let single_table = pko_tools_lib::effect_v2::magic_single_loader::load_magic_single(&single_data)
        .expect("Failed to parse MagicSingleinfo.bin");
    
    // Build lookup map for singles
    let mut single_map = HashMap::new();
    for entry in &single_table.entries {
        single_map.insert(entry.id, entry);
    }
    
    println!("\n============= MAGIC GROUPS BY RENDER_IDX =============\n");
    
    // Separate groups by render_idx
    let mut by_render_idx: HashMap<i32, Vec<_>> = HashMap::new();
    for entry in &group_table.entries {
        by_render_idx.entry(entry.render_idx).or_insert_with(Vec::new).push(entry);
    }
    
    let mut indices: Vec<_> = by_render_idx.keys().collect();
    indices.sort();
    
    for render_idx in indices {
        let groups = &by_render_idx[render_idx];
        let mode_name = match render_idx {
            0 => "FAN MODE",
            1 => "SEQUENCE MODE",
            _ => "OTHER",
        };
        
        println!("\n--- render_idx = {} ({}) ---", render_idx, mode_name);
        println!("Count: {}\n", groups.len());
        
        for group in groups {
            println!("  Group ID={}  Name=\"{}\"", group.id, group.name);
            println!("    data_name: {}", group.data_name);
            println!("    total_count: {}", group.total_count);
            println!("    Referenced MagicSingle IDs:");
            
            for (type_id, count) in group.type_ids.iter().zip(&group.counts) {
                if *type_id >= 0 {
                    if let Some(single) = single_map.get(type_id) {
                        println!("      - ID={:4} count={:2} | name=\"{}\" | render_idx={}",
                            type_id, count, single.name, single.render_idx);
                    } else {
                        println!("      - ID={:4} count={:2} | [NOT FOUND]", type_id, count);
                    }
                }
            }
            println!();
        }
    }
}
