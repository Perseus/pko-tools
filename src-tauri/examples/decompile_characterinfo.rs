/// Example: Decompile CharacterInfo.bin with automatic version detection
///
/// Usage:
///   cargo run --example decompile_characterinfo path/to/CharacterInfo.bin output.txt
///
use pko_tools_lib::decompiler::{create_character_info_v1, decompile_to_tsv_auto};
use std::env;

fn main() {
    let args: Vec<String> = env::args().collect();

    if args.len() != 3 {
        eprintln!("Usage: {} <input.bin> <output.txt>", args[0]);
        eprintln!("\nExample:");
        eprintln!(
            "  cargo run --example decompile_characterinfo CharacterInfo.bin CharacterInfo.txt"
        );
        std::process::exit(1);
    }

    let input_path = &args[1];
    let output_path = &args[2];

    println!("Decompiling CharacterInfo.bin...");
    println!("  Input:  {}", input_path);
    println!("  Output: {}", output_path);
    println!();

    // Create the CharacterInfo structure
    let structure = create_character_info_v1();

    // Decompile with automatic version detection
    match decompile_to_tsv_auto(input_path, output_path, &structure) {
        Ok(()) => {
            println!("\n✓ Decompilation successful!");
            println!("  Output written to: {}", output_path);
        }
        Err(e) => {
            eprintln!("\n✗ Decompilation failed: {:?}", e);
            std::process::exit(1);
        }
    }
}
