mod decrypt;
mod error;
mod parser;
mod structure;
mod structures;
mod types;

pub use decrypt::detect_version;
pub use error::{DecompilerError, Result};
pub use structure::{FieldDef, ParserType, Structure, StructureBuilder};
pub use structures::{
    create_character_info_v1, create_item_refine_effect_info, create_item_refine_info,
    create_scene_effect_info, create_stone_info, get_character_info_structure,
};
pub use types::{FieldValue, GameVersion};

use parser::ParserState;
use serde::Serialize;
use std::fs::File;
use std::io::{Cursor, Write as IoWrite};
use std::path::Path;

/// Result of a CRawDataSet decompilation
#[derive(Debug, Serialize)]
pub struct DecompileResult {
    pub records_total: usize,
    pub records_written: usize,
    pub records_skipped: usize,
    pub output_path: String,
}

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

/// Decompile a CRawDataSet binary file to TSV format.
///
/// CRawDataSet files share a common format:
/// - First 4 bytes: entry size (little-endian u32)
/// - Remaining bytes: sequential entries of that size
/// - Each entry starts with a 4-byte `bExist` flag; entries with bExist == 0 are skipped
///
/// This function tries V1 (unencrypted) first, then V4 (encrypted) if V1 produces
/// parse errors. Records where `bExist == 0` are filtered out.
///
/// # Arguments
/// * `input_path` - Path to the .bin file
/// * `output_path` - Path to write the TSV output
/// * `structure` - Structure definition for parsing records
pub fn decompile_rawdataset_to_tsv(
    input_path: impl AsRef<Path>,
    output_path: impl AsRef<Path>,
    structure: &Structure,
) -> Result<DecompileResult> {
    let data = std::fs::read(input_path.as_ref())?;

    if data.len() < 4 {
        return Err(DecompilerError::InvalidFormat(
            "File too short for size header".to_string(),
        ));
    }

    let entry_size = u32::from_le_bytes([data[0], data[1], data[2], data[3]]) as usize;
    if entry_size == 0 {
        return Err(DecompilerError::InvalidFormat(
            "Invalid entry size: 0".to_string(),
        ));
    }

    let record_data = &data[4..];
    let records_total = record_data.len() / entry_size;

    // Try V1 (unencrypted) first, fall back to V4 (encrypted)
    let version = {
        if records_total > 0 {
            let first_chunk = &record_data[..entry_size.min(record_data.len())];
            // Check if bExist at offset 0 looks reasonable when unencrypted (0 or 1)
            let b_exist_raw = u32::from_le_bytes(
                first_chunk[..4].try_into().unwrap_or([0, 0, 0, 0]),
            );
            if b_exist_raw <= 1 {
                GameVersion::V1
            } else {
                GameVersion::V4
            }
        } else {
            GameVersion::V1
        }
    };

    // Split and optionally decrypt records
    let records = decrypt::read_encrypted_records(&data, version)?;

    // Filter by bExist and parse
    let mut output_rows: Vec<Vec<String>> = Vec::new();
    output_rows.push(structure.field_names());

    let mut records_written = 0;
    let mut records_skipped = 0;

    for record in &records {
        // Check bExist (first 4 bytes of each record)
        if record.len() < 4 {
            records_skipped += 1;
            continue;
        }
        let b_exist = u32::from_le_bytes(record[..4].try_into().unwrap_or([0, 0, 0, 0]));
        if b_exist == 0 {
            records_skipped += 1;
            continue;
        }

        let cursor = Cursor::new(record);
        let mut state = ParserState::new(cursor);

        match structure.parse_record(&mut state) {
            Ok(values) => {
                let row: Vec<String> = values
                    .into_iter()
                    .filter(|v| !matches!(v, FieldValue::Skip))
                    .map(|v| v.to_tsv_string())
                    .collect();
                output_rows.push(row);
                records_written += 1;
            }
            Err(_) => {
                records_skipped += 1;
            }
        }
    }

    // Ensure output directory exists
    if let Some(parent) = output_path.as_ref().parent() {
        std::fs::create_dir_all(parent)?;
    }

    write_tsv(&output_path, &output_rows)?;

    Ok(DecompileResult {
        records_total,
        records_written,
        records_skipped,
        output_path: output_path.as_ref().to_string_lossy().to_string(),
    })
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

    // ========================================================================
    // CRawDataSet round-trip tests (synthetic data)
    // ========================================================================

    /// Helper: build a raw CRawDataSet binary buffer with the given entry size and entries.
    /// Each entry must be exactly `entry_size` bytes.
    fn build_rawdataset(entry_size: usize, entries: &[Vec<u8>]) -> Vec<u8> {
        let mut data = Vec::new();
        data.extend_from_slice(&(entry_size as u32).to_le_bytes());
        for entry in entries {
            assert_eq!(entry.len(), entry_size, "entry must be exactly entry_size bytes");
            data.extend_from_slice(entry);
        }
        data
    }

    /// Helper: build an entry with bExist=1, nID at offset 100, rest zeroed.
    fn make_entry(entry_size: usize, id: i32) -> Vec<u8> {
        let mut buf = vec![0u8; entry_size];
        // bExist = 1 at offset 0
        buf[0..4].copy_from_slice(&1i32.to_le_bytes());
        // nID at offset 100
        buf[100..104].copy_from_slice(&id.to_le_bytes());
        buf
    }

    /// Helper: write i16 at offset within a buffer
    fn write_i16(buf: &mut [u8], offset: usize, value: i16) {
        buf[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
    }

    /// Helper: write i32 at offset within a buffer
    fn write_i32(buf: &mut [u8], offset: usize, value: i32) {
        buf[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
    }

    /// Helper: write f32 at offset within a buffer
    fn write_f32(buf: &mut [u8], offset: usize, value: f32) {
        buf[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
    }

    #[test]
    fn test_roundtrip_item_refine_info() {
        let entry_size = 152;

        // Entry 1: nID=5001, Value=[1..14], fChaEffectScale=[1.0, 1.5, 0.8, 2.0]
        let mut e1 = make_entry(entry_size, 5001);
        let d = 108; // derived fields start
        for j in 0..14 {
            write_i16(&mut e1, d + j * 2, (j + 1) as i16);
        }
        write_f32(&mut e1, d + 28, 1.0);
        write_f32(&mut e1, d + 32, 1.5);
        write_f32(&mut e1, d + 36, 0.8);
        write_f32(&mut e1, d + 40, 2.0);

        // Entry 2: nID=5002, all zeros (bExist=1)
        let e2 = make_entry(entry_size, 5002);

        // Entry 3: bExist=0, should be filtered
        let mut e3 = make_entry(entry_size, 9999);
        e3[0..4].copy_from_slice(&0i32.to_le_bytes());

        let data = build_rawdataset(entry_size, &[e1, e2, e3]);

        let input_path = unique_temp_path("test_refine_info", "bin");
        let output_path = unique_temp_path("test_refine_info", "txt");
        std::fs::write(&input_path, &data).unwrap();

        let structure = structures::create_item_refine_info();
        let result = decompile_rawdataset_to_tsv(&input_path, &output_path, &structure).unwrap();

        assert_eq!(result.records_written, 2);
        assert_eq!(result.records_skipped, 1);

        let output = std::fs::read_to_string(&output_path).unwrap();
        let lines: Vec<&str> = output.lines().collect();

        // Header + 2 data rows
        assert_eq!(lines.len(), 3);
        assert!(lines[0].starts_with("//nID"));
        assert!(lines[0].contains("Value"));
        assert!(lines[0].contains("fChaEffectScale"));

        // Row 1: nID=5001
        assert!(lines[1].starts_with("5001\t"));
        assert!(lines[1].contains("1,2,3,4,5,6,7,8,9,10,11,12,13,14"));
        assert!(lines[1].contains("1.0,1.5,0.8,2.0"));

        // Row 2: nID=5002
        assert!(lines[2].starts_with("5002\t"));

        // Verify nID=9999 is NOT present
        assert!(!output.contains("9999"));

        std::fs::remove_file(&input_path).ok();
        std::fs::remove_file(&output_path).ok();
    }

    #[test]
    fn test_roundtrip_item_refine_effect_info() {
        let entry_size = 164;

        let mut e1 = make_entry(entry_size, 42);
        let d = 108;
        // nLightID = 7
        write_i32(&mut e1, d, 7);
        // sEffectID: short[16] — first 4 set
        write_i16(&mut e1, d + 4, 10);
        write_i16(&mut e1, d + 6, 20);
        write_i16(&mut e1, d + 8, 30);
        write_i16(&mut e1, d + 10, 40);
        // chDummy: byte[4] at d+36
        e1[d + 36] = 1;
        e1[d + 37] = 2;
        e1[d + 38] = 3;
        e1[d + 39] = 0;
        // _sEffectNum: int[4] at d+40
        write_i32(&mut e1, d + 40, 100);
        write_i32(&mut e1, d + 44, 200);
        write_i32(&mut e1, d + 48, 300);
        write_i32(&mut e1, d + 52, 0);

        // Entry with bExist=0
        let mut e2 = make_entry(entry_size, 99);
        e2[0..4].copy_from_slice(&0i32.to_le_bytes());

        let data = build_rawdataset(entry_size, &[e1, e2]);

        let input_path = unique_temp_path("test_refine_effect", "bin");
        let output_path = unique_temp_path("test_refine_effect", "txt");
        std::fs::write(&input_path, &data).unwrap();

        let structure = structures::create_item_refine_effect_info();
        let result = decompile_rawdataset_to_tsv(&input_path, &output_path, &structure).unwrap();

        assert_eq!(result.records_written, 1);
        assert_eq!(result.records_skipped, 1);

        let output = std::fs::read_to_string(&output_path).unwrap();
        let lines: Vec<&str> = output.lines().collect();
        assert_eq!(lines.len(), 2); // header + 1 data row

        assert!(lines[1].starts_with("42\t"));
        assert!(lines[1].contains("7\t")); // nLightID
        assert!(lines[1].contains("10,20,30,40")); // first 4 of sEffectID
        assert!(lines[1].contains("1,2,3,0")); // chDummy
        assert!(lines[1].contains("100,200,300,0")); // _sEffectNum

        std::fs::remove_file(&input_path).ok();
        std::fs::remove_file(&output_path).ok();
    }

    #[test]
    fn test_roundtrip_scene_effect_info() {
        let entry_size = 208;

        let mut e1 = make_entry(entry_size, 335);
        let d = 108;
        // szName: "fire.par" at d, 16 bytes
        let name = b"fire.par";
        e1[d..d + name.len()].copy_from_slice(name);
        // szPhotoName at d+16
        let photo = b"fire_ph";
        e1[d + 16..d + 16 + photo.len()].copy_from_slice(photo);
        // nPhotoTexID at d+32
        write_i32(&mut e1, d + 32, 0);
        // nEffType at d+36
        write_i32(&mut e1, d + 36, 1);
        // nObjType at d+40
        write_i32(&mut e1, d + 40, 2);
        // nDummyNum at d+44
        write_i32(&mut e1, d + 44, 3);
        // nDummy[8] at d+48: [1,2,3,0,0,0,0,0]
        write_i32(&mut e1, d + 48, 1);
        write_i32(&mut e1, d + 52, 2);
        write_i32(&mut e1, d + 56, 3);
        // nDummy2 at d+80
        write_i32(&mut e1, d + 80, -1);
        // nHeightOff at d+84
        write_i32(&mut e1, d + 84, 0);
        // fPlayTime at d+88
        write_f32(&mut e1, d + 88, 5.0);
        // LightID at d+92
        write_i32(&mut e1, d + 92, 0);
        // fBaseSize at d+96
        write_f32(&mut e1, d + 96, 1.0);

        let data = build_rawdataset(entry_size, &[e1]);

        let input_path = unique_temp_path("test_scene_effect", "bin");
        let output_path = unique_temp_path("test_scene_effect", "txt");
        std::fs::write(&input_path, &data).unwrap();

        let structure = structures::create_scene_effect_info();
        let result = decompile_rawdataset_to_tsv(&input_path, &output_path, &structure).unwrap();

        assert_eq!(result.records_written, 1);

        let output = std::fs::read_to_string(&output_path).unwrap();
        let lines: Vec<&str> = output.lines().collect();
        assert_eq!(lines.len(), 2);

        assert!(lines[1].starts_with("335\t"));
        assert!(lines[1].contains("fire.par"));
        assert!(lines[1].contains("fire_ph"));
        assert!(lines[1].contains("5.0")); // fPlayTime
        assert!(lines[1].contains("1.0")); // fBaseSize

        std::fs::remove_file(&input_path).ok();
        std::fs::remove_file(&output_path).ok();
    }

    #[test]
    fn test_roundtrip_stone_info() {
        let entry_size = 192; // 108 base + 4 nItemID + 12 nEquipPos + 4 nType + 64 szHintFunc = 192

        let mut e1 = make_entry(entry_size, 1);
        let d = 108;
        // nItemID at d
        write_i32(&mut e1, d, 8001);
        // nEquipPos[3] at d+4
        write_i32(&mut e1, d + 4, 1);
        write_i32(&mut e1, d + 8, 2);
        write_i32(&mut e1, d + 12, 3);
        // nType at d+16
        write_i32(&mut e1, d + 16, 2);
        // szHintFunc at d+20, 64 bytes
        let func = b"Stone_GetHint";
        e1[d + 20..d + 20 + func.len()].copy_from_slice(func);

        let data = build_rawdataset(entry_size, &[e1]);

        let input_path = unique_temp_path("test_stone_info", "bin");
        let output_path = unique_temp_path("test_stone_info", "txt");
        std::fs::write(&input_path, &data).unwrap();

        let structure = structures::create_stone_info();
        let result = decompile_rawdataset_to_tsv(&input_path, &output_path, &structure).unwrap();

        assert_eq!(result.records_written, 1);

        let output = std::fs::read_to_string(&output_path).unwrap();
        let lines: Vec<&str> = output.lines().collect();
        assert_eq!(lines.len(), 2);

        assert!(lines[1].starts_with("1\t"));
        assert!(lines[1].contains("8001"));
        assert!(lines[1].contains("1,2,3")); // nEquipPos
        assert!(lines[1].contains("2")); // nType
        assert!(lines[1].contains("Stone_GetHint"));

        std::fs::remove_file(&input_path).ok();
        std::fs::remove_file(&output_path).ok();
    }

    // ========================================================================
    // Integration tests (require real game files)
    // ========================================================================

    #[test]
    #[ignore]
    fn test_decompile_real_item_refine_info() {
        let test_file = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("test_artifacts")
            .join("decompiler")
            .join("ItemRefineInfo.bin");
        if !test_file.exists() {
            panic!("Place ItemRefineInfo.bin in test_artifacts/decompiler/");
        }

        let output_file = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("test_artifacts")
            .join("decompiler")
            .join("ItemRefineInfo_output.txt");

        let structure = structures::create_item_refine_info();
        let result = decompile_rawdataset_to_tsv(&test_file, &output_file, &structure).unwrap();
        println!("ItemRefineInfo: {} written, {} skipped", result.records_written, result.records_skipped);

        let output = std::fs::read_to_string(&output_file).unwrap();
        for line in output.lines().take(5) {
            println!("{}", line);
        }
    }

    #[test]
    #[ignore]
    fn test_decompile_real_item_refine_effect_info() {
        let test_file = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("test_artifacts")
            .join("decompiler")
            .join("ItemRefineEffectInfo.bin");
        if !test_file.exists() {
            panic!("Place ItemRefineEffectInfo.bin in test_artifacts/decompiler/");
        }

        let output_file = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("test_artifacts")
            .join("decompiler")
            .join("ItemRefineEffectInfo_output.txt");

        let structure = structures::create_item_refine_effect_info();
        let result = decompile_rawdataset_to_tsv(&test_file, &output_file, &structure).unwrap();
        println!("ItemRefineEffectInfo: {} written, {} skipped", result.records_written, result.records_skipped);

        let output = std::fs::read_to_string(&output_file).unwrap();
        for line in output.lines().take(5) {
            println!("{}", line);
        }
    }

    #[test]
    #[ignore]
    fn test_decompile_real_scene_effect_info() {
        let test_file = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("test_artifacts")
            .join("decompiler")
            .join("sceneffectinfo.bin");
        if !test_file.exists() {
            panic!("Place sceneffectinfo.bin in test_artifacts/decompiler/");
        }

        let output_file = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("test_artifacts")
            .join("decompiler")
            .join("sceneffectinfo_output.txt");

        let structure = structures::create_scene_effect_info();
        let result = decompile_rawdataset_to_tsv(&test_file, &output_file, &structure).unwrap();
        println!("sceneffectinfo: {} written, {} skipped", result.records_written, result.records_skipped);

        let output = std::fs::read_to_string(&output_file).unwrap();
        for line in output.lines().take(5) {
            println!("{}", line);
        }
    }

    #[test]
    #[ignore]
    fn test_decompile_real_stone_info() {
        let test_file = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("test_artifacts")
            .join("decompiler")
            .join("StoneInfo.bin");
        if !test_file.exists() {
            panic!("Place StoneInfo.bin in test_artifacts/decompiler/");
        }

        let output_file = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("test_artifacts")
            .join("decompiler")
            .join("StoneInfo_output.txt");

        let structure = structures::create_stone_info();
        let result = decompile_rawdataset_to_tsv(&test_file, &output_file, &structure).unwrap();
        println!("StoneInfo: {} written, {} skipped", result.records_written, result.records_skipped);

        let output = std::fs::read_to_string(&output_file).unwrap();
        for line in output.lines().take(5) {
            println!("{}", line);
        }
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
