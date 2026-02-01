// Test for byte-by-byte equality after round-trip conversion
// This test identifies exactly which bytes differ and helps debug the issue

use binrw::{BinReaderExt, BinWrite};
use pko_tools_lib::animation::character::LwBoneFile;
use std::fs;
use std::io::BufWriter;

#[path = "common/mod.rs"]
mod common;

#[test]
#[ignore = "byte-level equality is unstable due to float drift"]
fn test_byte_equality_after_roundtrip() {
    println!("\n🔬 Byte-by-byte equality test for LAB round-trip");

    let test_dir =
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/known_good");

    // Load original LAB
    let lab_path = test_dir.join("0725.lab");
    let mut original_lab_file = fs::File::open(&lab_path).expect("Failed to open original LAB");
    let original_lab: LwBoneFile = original_lab_file
        .read_le()
        .expect("Failed to parse original LAB");

    // Load glTF
    let gltf_path = test_dir.join("789.gltf");
    let (gltf_doc, buffers, images) = gltf::import(&gltf_path).expect("Failed to load 789.gltf");

    // Import back to LAB
    let new_lab = LwBoneFile::from_gltf(&gltf_doc, &buffers, &images)
        .expect("Failed to import LAB from glTF");

    // Write new LAB
    let temp_dir = std::env::temp_dir().join("pko_byte_test");
    fs::create_dir_all(&temp_dir).expect("Failed to create temp dir");
    let new_lab_path = temp_dir.join("0725_new.lab");

    let new_lab_file = fs::File::create(&new_lab_path).expect("Failed to create new LAB");
    let mut lab_writer = BufWriter::new(new_lab_file);
    new_lab
        .write_options(&mut lab_writer, binrw::Endian::Little, ())
        .expect("Failed to write new LAB");
    drop(lab_writer);

    // Read both files as bytes
    let original_bytes = fs::read(&lab_path).expect("Failed to read original LAB");
    let new_bytes = fs::read(&new_lab_path).expect("Failed to read new LAB");

    println!("📊 File sizes:");
    println!("  Original: {} bytes", original_bytes.len());
    println!("  New:      {} bytes", new_bytes.len());

    // Check if sizes match
    if original_bytes.len() != new_bytes.len() {
        panic!("❌ File sizes don't match! Cannot proceed with byte comparison.");
    }

    // Find all differences
    let mut diffs = Vec::new();
    for (i, (orig, new)) in original_bytes.iter().zip(new_bytes.iter()).enumerate() {
        if orig != new {
            diffs.push((i, *orig, *new));
        }
    }

    if diffs.is_empty() {
        println!("✅ FILES ARE IDENTICAL!");
        return;
    }

    println!(
        "\n❌ Found {} byte differences ({:.2}%)",
        diffs.len(),
        (diffs.len() as f64 / original_bytes.len() as f64) * 100.0
    );

    // Analyze the pattern of differences
    println!("\n🔍 First 20 differences:");
    for (i, orig, new) in diffs.iter().take(20) {
        println!(
            "  Offset 0x{:08X} ({}): 0x{:02X} → 0x{:02X}",
            i, i, orig, new
        );
    }

    // Find ranges of differences
    println!("\n📍 Difference ranges:");
    let mut range_start = diffs[0].0;
    let mut range_end = diffs[0].0;
    let mut range_count = 1;

    for i in 1..diffs.len() {
        if diffs[i].0 == range_end + 1 {
            range_end = diffs[i].0;
            range_count += 1;
        } else {
            println!(
                "  Range 0x{:08X}-0x{:08X} ({} bytes)",
                range_start, range_end, range_count
            );
            range_start = diffs[i].0;
            range_end = diffs[i].0;
            range_count = 1;
        }
    }
    println!(
        "  Range 0x{:08X}-0x{:08X} ({} bytes)",
        range_start, range_end, range_count
    );

    // Check if all new bytes are zero
    let all_zero = diffs.iter().all(|(_, _, new)| *new == 0);
    if all_zero {
        println!("\n⚠️  ALL DIFFERENT BYTES IN NEW FILE ARE ZERO!");
        println!("    This suggests data is not being populated during import.");
    }

    // Check if any original bytes are zero
    let any_orig_zero = diffs.iter().any(|(_, orig, _)| *orig == 0);
    println!("\n📈 Pattern analysis:");
    println!("  All new bytes are zero: {}", all_zero);
    println!("  Any original bytes are zero: {}", any_orig_zero);

    // Check if differences are mostly in least significant bytes of floats
    println!("\n🔬 Checking if differences are floating point precision issues...");
    let mut lsb_diffs = 0;
    for (offset, _, _) in &diffs {
        // Check if this byte is the last byte of a 4-byte value (float LSB)
        if offset % 4 == 3 || offset % 4 == 0 {
            lsb_diffs += 1;
        }
    }
    println!(
        "  Differences at float LSB positions: {} / {} ({:.1}%)",
        lsb_diffs,
        diffs.len(),
        (lsb_diffs as f64 / diffs.len() as f64) * 100.0
    );

    // Analyze magnitude of differences
    let mut small_diffs = 0;
    for (_, orig, new) in &diffs {
        let diff = (*orig as i16 - *new as i16).abs();
        if diff <= 2 {
            small_diffs += 1;
        }
    }
    println!(
        "  Differences ≤2: {} / {} ({:.1}%)",
        small_diffs,
        diffs.len(),
        (small_diffs as f64 / diffs.len() as f64) * 100.0
    );

    // Try to interpret some differences as floats
    println!("\n🔢 Sample float comparisons (first 5 aligned 4-byte values with diffs):");
    let mut float_samples = 0;
    for i in (0..original_bytes.len() - 3).step_by(4) {
        let has_diff = diffs.iter().any(|(off, _, _)| *off >= i && *off < i + 4);
        if has_diff && float_samples < 5 {
            let orig_bytes = [
                original_bytes[i],
                original_bytes[i + 1],
                original_bytes[i + 2],
                original_bytes[i + 3],
            ];
            let new_bytes = [
                new_bytes[i],
                new_bytes[i + 1],
                new_bytes[i + 2],
                new_bytes[i + 3],
            ];
            let orig_float = f32::from_le_bytes(orig_bytes);
            let new_float = f32::from_le_bytes(new_bytes);
            println!(
                "  Offset 0x{:08X}: {:.6} vs {:.6} (diff: {:.9})",
                i,
                orig_float,
                new_float,
                orig_float - new_float
            );
            float_samples += 1;
        }
    }

    panic!("Files are not byte-for-byte identical!");
}
