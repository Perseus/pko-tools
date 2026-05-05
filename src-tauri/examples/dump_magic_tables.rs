//! Simple CLI tool to dump MagicGroupInfo.bin and MagicSingleinfo.bin contents
//!
//! Usage: dump_magic_tables <scripts_table_dir>

use std::path::Path;

fn main() {
    let args: Vec<String> = std::env::args().collect();

    if args.len() < 2 {
        eprintln!("Usage: dump_magic_tables <scripts_table_dir>");
        eprintln!();
        eprintln!("Example: dump_magic_tables /e/gamedev/mp-client-source/Client/client/scripts/table");
        std::process::exit(1);
    }

    let table_dir = Path::new(&args[1]);
    
    // Load MagicGroupInfo.bin
    let group_path = table_dir.join("MagicGroupInfo.bin");
    if group_path.exists() {
        println!("\n========== MagicGroupInfo.bin ==========");
        match std::fs::read(&group_path) {
            Ok(data) => {
                match pko_tools_lib::effect_v2::magic_group_loader::load_magic_group(&data) {
                    Ok(table) => {
                        println!("Record size: {}", table.record_size);
                        println!("Total entries: {}\n", table.entries.len());
                        
                        for entry in &table.entries {
                            let active_types: Vec<String> = entry.type_ids.iter()
                                .zip(&entry.counts)
                                .filter(|(&id, _)| id >= 0)
                                .map(|(&id, &count)| format!("{}x{}", id, count))
                                .collect();
                            
                            println!("ID={:4} | name={:30} | render_idx={:2} | types=[{}] | total={}",
                                entry.id,
                                entry.name,
                                entry.render_idx,
                                active_types.join(", "),
                                entry.total_count
                            );
                        }
                    }
                    Err(e) => eprintln!("Error parsing MagicGroupInfo.bin: {}", e),
                }
            }
            Err(e) => eprintln!("Error reading MagicGroupInfo.bin: {}", e),
        }
    } else {
        eprintln!("MagicGroupInfo.bin not found at {}", group_path.display());
    }
    
    // Load MagicSingleinfo.bin
    let single_path = table_dir.join("MagicSingleinfo.bin");
    if single_path.exists() {
        println!("\n========== MagicSingleinfo.bin ==========");
        match std::fs::read(&single_path) {
            Ok(data) => {
                match pko_tools_lib::effect_v2::magic_single_loader::load_magic_single(&data) {
                    Ok(table) => {
                        println!("Record size: {}", table.record_size);
                        println!("Total entries: {}\n", table.entries.len());
                        
                        for entry in &table.entries {
                            println!("ID={:5} | name={:30} | render_idx={:2}",
                                entry.id,
                                entry.name,
                                entry.render_idx
                            );
                        }
                    }
                    Err(e) => eprintln!("Error parsing MagicSingleinfo.bin: {}", e),
                }
            }
            Err(e) => eprintln!("Error reading MagicSingleinfo.bin: {}", e),
        }
    } else {
        eprintln!("MagicSingleinfo.bin not found at {}", single_path.display());
    }
}
