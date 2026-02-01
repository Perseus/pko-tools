mod decrypt;
mod error;
mod parser;
mod structure;
mod structures;
mod types;

pub use decrypt::detect_version;
pub use error::{DecompilerError, Result};
pub use structure::{FieldDef, ParserType, Structure, StructureBuilder};
pub use structures::{create_character_info_v1, get_character_info_structure};
pub use types::{FieldValue, GameVersion};

use parser::ParserState;
use std::fs::File;
use std::io::{Cursor, Write as IoWrite};
use std::path::Path;

/// Decompile a binary file to TSV format
///
/// # Arguments
/// * `input_path` - Path to the binary (.bin) file
/// * `output_path` - Path to write the TSV output
/// * `version` - Game version (determines encryption)
/// * `structure` - Structure definition for parsing records
///
/// # File Format
/// Input binary file format:
/// - First 4 bytes: record size (little-endian u32)
/// - Remaining bytes: records of (record_size - 1) bytes each
///
/// Output TSV format:
/// - First row: field names (tab-separated)
/// - Subsequent rows: field values (tab-separated)
///
/// # Example
/// ```no_run
/// use pko_tools_lib::decompiler::{decompile_to_tsv, GameVersion, StructureBuilder};
///
/// let structure = StructureBuilder::new("CharacterInfo")
///     .pad(4)
///     .field_ulong("ID")
///     .field_char_fixed("Name", 72)
///     .pad(28)
///     .build();
///
/// decompile_to_tsv(
///     "CharacterInfo.bin",
///     "CharacterInfo.txt",
///     GameVersion::V1,
///     &structure,
/// ).unwrap();
/// ```
pub fn decompile_to_tsv(
    input_path: impl AsRef<Path>,
    output_path: impl AsRef<Path>,
    version: GameVersion,
    structure: &Structure,
) -> Result<()> {
    // Read the binary file
    let data = std::fs::read(input_path.as_ref())?;

    println!("File size: {} bytes", data.len());

    // Decrypt and split into records
    let records = decrypt::read_encrypted_records(&data, version)?;

    println!(
        "Found {} records (version: {:?}, encryption: {})",
        records.len(),
        version,
        if version.uses_encryption() {
            "enabled"
        } else {
            "disabled"
        }
    );

    if !records.is_empty() {
        println!("Record size: {} bytes", records[0].len());
    }

    // Parse each record
    let mut output_rows: Vec<Vec<String>> = Vec::new();

    // Add header row with field names
    output_rows.push(structure.field_names());

    let mut success_count = 0;
    let mut error_count = 0;

    // Parse each record
    for (i, record) in records.iter().enumerate() {
        let cursor = Cursor::new(record);
        let mut state = ParserState::new(cursor);

        match structure.parse_record(&mut state) {
            Ok(values) => {
                // Debug: Check if we consumed the whole record
                if i < 5 {
                    println!(
                        "Record {}: consumed {} bytes out of {} (remaining: {})",
                        i,
                        state.position(),
                        record.len(),
                        record.len() - state.position()
                    );
                }
                // Filter out Skip values and convert to strings
                let row: Vec<String> = values
                    .into_iter()
                    .filter(|v| !matches!(v, FieldValue::Skip))
                    .map(|v| v.to_tsv_string())
                    .collect();

                output_rows.push(row);
                success_count += 1;
            }
            Err(e) => {
                println!("Warning: Error parsing record {}: {:?}", i, e);
                println!("  Record size: {} bytes", record.len());
                if error_count < 3 {
                    // Show first few bytes of failed records
                    println!("  First 16 bytes: {:02X?}", &record[..record.len().min(16)]);
                }
                println!("  Continuing with remaining records...");
                error_count += 1;
            }
        }
    }

    println!(
        "Parsing complete: {} successful, {} failed",
        success_count, error_count
    );

    // Write TSV output
    write_tsv(output_path, &output_rows)?;

    Ok(())
}

/// Decompile a binary file to TSV format with automatic version detection
///
/// This is a convenience wrapper around `decompile_to_tsv` that automatically
/// detects whether the file is encrypted (V4+) or unencrypted (V1-V3).
///
/// # Arguments
/// * `input_path` - Path to the binary (.bin) file
/// * `output_path` - Path to write the TSV output
/// * `structure` - Structure definition for parsing records
///
/// # Example
/// ```no_run
/// use pko_tools_lib::decompiler::{decompile_to_tsv_auto, create_character_info_v1};
///
/// let structure = create_character_info_v1();
/// decompile_to_tsv_auto(
///     "CharacterInfo.bin",
///     "CharacterInfo.txt",
///     &structure,
/// ).unwrap();
/// ```
pub fn decompile_to_tsv_auto(
    input_path: impl AsRef<Path>,
    output_path: impl AsRef<Path>,
    structure: &Structure,
) -> Result<()> {
    // Read the file
    let data = std::fs::read(input_path.as_ref())?;

    // Detect version
    let version = detect_version(&data)?;

    println!("Auto-detected game version: {:?}", version);

    // Decompile with detected version
    decompile_to_tsv(input_path, output_path, version, structure)
}

/// Write rows to a TSV file
fn write_tsv(path: impl AsRef<Path>, rows: &[Vec<String>]) -> Result<()> {
    let mut file = File::create(path)?;

    for (i, row) in rows.iter().enumerate() {
        // First row gets "//" prefix for header
        if i == 0 {
            file.write_all(b"//")?;
        }

        // Write tab-separated values
        let line = row.join("\t");
        file.write_all(line.as_bytes())?;

        // Add newline except for last row (matches Lua decompiler behavior)
        if i < rows.len() - 1 {
            file.write_all(b"\n")?;
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;
    use std::path::PathBuf;

    fn unique_temp_path(prefix: &str, extension: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        let thread_id = format!("{:?}", std::thread::current().id());
        path.push(format!(
            "{}_{}_{}.{}",
            prefix,
            std::process::id(),
            thread_id,
            extension
        ));
        path
    }

    #[test]
    fn test_write_tsv() {
        let rows = vec![
            vec!["ID".to_string(), "Name".to_string(), "Value".to_string()],
            vec!["1".to_string(), "Item A".to_string(), "100".to_string()],
            vec!["2".to_string(), "Item B".to_string(), "200".to_string()],
        ];

        let temp_path = unique_temp_path("test_output", "tsv");
        write_tsv(&temp_path, &rows).unwrap();

        let content = std::fs::read_to_string(&temp_path).unwrap();
        let expected = "//ID\tName\tValue\n1\tItem A\t100\n2\tItem B\t200";

        assert_eq!(content, expected);

        // Cleanup
        std::fs::remove_file(&temp_path).ok();
    }

    #[test]
    fn test_decompile_simple() {
        // Create a simple binary file for testing
        // Format: [4 byte size][records]
        // Record size = 4 (each record is 4 bytes)

        let mut data = Vec::new();
        data.extend_from_slice(&4u32.to_le_bytes()); // Record size = 4

        // Record 1: id=1, value=100 (u16)
        data.push(1); // id
        data.extend_from_slice(&100u16.to_le_bytes()); // value
        data.push(0); // padding

        // Record 2: id=2, value=200 (u16)
        data.push(2); // id
        data.extend_from_slice(&200u16.to_le_bytes()); // value
        data.push(0); // padding

        let input_path = unique_temp_path("test_input", "bin");
        let output_path = unique_temp_path("test_output", "tsv");

        std::fs::write(&input_path, &data).unwrap();

        let structure = StructureBuilder::new("TestStruct")
            .field_ubyte("ID")
            .field_ushort("Value")
            .pad(1)
            .build();

        let result = decompile_to_tsv(&input_path, &output_path, GameVersion::V1, &structure);
        assert!(result.is_ok());

        let output = std::fs::read_to_string(&output_path).unwrap();
        assert!(output.contains("//ID\tValue"));
        assert!(output.contains("1\t100"));
        assert!(output.contains("2\t200"));

        // Cleanup
        std::fs::remove_file(&input_path).ok();
        std::fs::remove_file(&output_path).ok();
    }

    #[test]
    fn test_decompile_with_strings() {
        let mut data = Vec::new();
        data.extend_from_slice(&9u32.to_le_bytes()); // Record size = 9

        // Record 1: id=1, name="Test"
        data.push(1); // id (1 byte)
        data.extend_from_slice(b"Test\0"); // name (5 bytes including null)
        data.extend_from_slice(&[0, 0, 0]); // padding to reach 9 bytes (8 bytes for name field)

        let input_path = unique_temp_path("test_string", "bin");
        let output_path = unique_temp_path("test_string", "tsv");

        std::fs::write(&input_path, &data).unwrap();

        let structure = StructureBuilder::new("TestStruct")
            .field_ubyte("ID")
            .field_char_fixed("Name", 8)
            .build();

        let result = decompile_to_tsv(&input_path, &output_path, GameVersion::V1, &structure);
        assert!(result.is_ok());

        let output = std::fs::read_to_string(&output_path).unwrap();
        assert!(output.contains("//ID\tName"));
        assert!(output.contains("1\tTest"));

        // Cleanup
        std::fs::remove_file(&input_path).ok();
        std::fs::remove_file(&output_path).ok();
    }

    #[test]
    fn test_character_info_structure() {
        // Test that the CharacterInfo structure can be created
        let structure = structures::create_character_info_v1();
        assert_eq!(structure.name(), "CharacterInfo");

        // Verify we have all the major fields
        let fields = structure.field_names();
        assert!(fields.contains(&"ID".to_string()));
        assert!(fields.contains(&"Name".to_string()));
        assert!(fields.contains(&"Level".to_string()));
        assert!(fields.contains(&"Max HP".to_string()));
        assert!(fields.contains(&"Current HP".to_string()));
        assert!(fields.contains(&"Skill ID".to_string()));
        assert!(fields.contains(&"Drop ID".to_string()));
    }

    #[test]
    #[ignore] // Requires actual game file to be placed in test_artifacts
    fn test_character_info_decompile() {
        // This test requires CharacterInfo.bin to be placed in test_artifacts/decompiler/
        // To run: cargo test test_character_info_decompile -- --ignored

        let test_file = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("test_artifacts")
            .join("decompiler")
            .join("CharacterInfo.bin");

        if !test_file.exists() {
            panic!(
                "Test file not found: {:?}\n\
                 Please place CharacterInfo.bin in test_artifacts/decompiler/\n\
                 See test_artifacts/decompiler/README.md for details",
                test_file
            );
        }

        let output_file = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("test_artifacts")
            .join("decompiler")
            .join("CharacterInfo_output.txt");

        let structure = structures::create_character_info_v1();

        // Try with V1 (unencrypted) first
        let result = decompile_to_tsv(&test_file, &output_file, GameVersion::V1, &structure);

        if let Err(e) = &result {
            println!("V1 decompilation failed: {:?}", e);
            println!("Trying V4 (encrypted)...");

            // Try V4 (encrypted) if V1 fails
            let result_v4 = decompile_to_tsv(&test_file, &output_file, GameVersion::V4, &structure);
            assert!(
                result_v4.is_ok(),
                "Decompilation failed for both V1 and V4: {:?}",
                e
            );
        } else {
            assert!(result.is_ok());
        }

        // Verify output file was created
        assert!(output_file.exists());

        // Read and display first few lines
        let output = std::fs::read_to_string(&output_file).unwrap();
        let lines: Vec<&str> = output.lines().take(5).collect();
        println!("First 5 lines of output:");
        for line in lines {
            println!("{}", line);
        }

        // Compare with expected output if available
        let expected_file = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("test_artifacts")
            .join("decompiler")
            .join("CharacterInfo_expected.txt");

        if expected_file.exists() {
            // Use lossy UTF-8 conversion for expected file since Lua decompiler may produce invalid UTF-8
            let expected_bytes = std::fs::read(&expected_file).unwrap();
            let expected = String::from_utf8_lossy(&expected_bytes).into_owned();
            let output = std::fs::read_to_string(&output_file).unwrap();

            // Compare line by line for better error messages
            let expected_lines: Vec<&str> = expected.lines().collect();
            let output_lines: Vec<&str> = output.lines().collect();

            assert_eq!(
                expected_lines.len(),
                output_lines.len(),
                "Number of lines differs: expected {}, got {}",
                expected_lines.len(),
                output_lines.len()
            );

            for (i, (exp, out)) in expected_lines.iter().zip(output_lines.iter()).enumerate() {
                assert_eq!(
                    exp,
                    out,
                    "Line {} differs:\nExpected: {}\nGot:      {}",
                    i + 1,
                    exp,
                    out
                );
            }
        } else {
            println!(
                "Note: Expected output file not found at {:?}\n\
                 You can place the Lua decompiler output there to verify correctness",
                expected_file
            );
        }
    }
}
