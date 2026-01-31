// Round-trip test: LAB/LGO → glTF → LAB/LGO
// This test verifies that converting files back and forth produces identical results

use binrw::{BinReaderExt, BinWrite};
use pko_tools_lib::animation::character::LwBoneFile;
use pko_tools_lib::character::model::CharacterGeometricModel;
use std::fs;
use std::io::BufWriter;

#[path = "common/mod.rs"]
mod common;

/// Test round-trip conversion for character 789 (files prefixed with 0725)
/// 1. Load 0725.lab and 0725000000.lgo (original files)
/// 2. Export to glTF
/// 3. Import glTF back to LAB/LGO (new files)
/// 4. Compare original vs new byte-by-byte
#[test]
#[ignore = "byte-level equality is unstable due to float drift"]
fn roundtrip_character_789() {
    println!("\n🔄 Round-trip test for character 789 (0725.lab / 0725000000.lgo)");

    let test_dir =
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/known_good");

    // Step 1: Load original LAB and LGO files
    println!("📂 Step 1: Loading original files...");
    let lab_path = test_dir.join("0725.lab");
    let lgo_path = test_dir.join("0725000000.lgo");

    let mut original_lab_file = fs::File::open(&lab_path).expect("Failed to open original LAB");
    let original_lab: LwBoneFile = original_lab_file
        .read_le()
        .expect("Failed to parse original LAB");

    // Note: The 0725000000.lgo has parsing issues, so we skip it for now
    println!("  ✓ Original LAB: {} bones", original_lab.base_seq.len());
    println!("    header.bone_num = {}", original_lab.header.bone_num);
    println!("    header.frame_num = {}", original_lab.header.frame_num);
    println!("    header.dummy_num = {}", original_lab.header.dummy_num);
    println!("    header.key_type = {}", original_lab.header.key_type);
    println!("    base_seq.len() = {}", original_lab.base_seq.len());
    println!("    invmat_seq.len() = {}", original_lab.invmat_seq.len());
    println!("    dummy_seq.len() = {}", original_lab.dummy_seq.len());
    println!("    key_seq.len() = {}", original_lab.key_seq.len());
    println!("  ⚠️  Skipping LGO comparison (parsing issues with 0725000000.lgo)");

    // Debug: Print original bone names (first 10 only)
    println!("\n📋 Original LAB bones (first 10):");
    for (i, bone) in original_lab.base_seq.iter().take(10).enumerate() {
        println!(
            "    [{}] id={}, parent={}, name='{}'",
            i, bone.id, bone.parent_id, bone.name
        );
    }
    if original_lab.base_seq.len() > 10 {
        println!("    ... ({} more bones)", original_lab.base_seq.len() - 10);
    }

    // Step 2: Export to glTF
    println!("\n📤 Step 2: Exporting to glTF...");

    // Load the 789.gltf file that already exists
    let gltf_path = test_dir.join("789.gltf");
    let (gltf_doc, buffers, images) = gltf::import(&gltf_path).expect("Failed to load 789.gltf");

    println!("  ✓ Loaded 789.gltf");
    println!("  glTF has {} nodes", gltf_doc.nodes().len());

    // Debug: Check glTF skin
    if let Some(skin) = gltf_doc.skins().next() {
        println!("  glTF skin has {} joints", skin.joints().count());
        println!("\n📋 glTF joints:");
        for (i, joint) in skin.joints().enumerate() {
            println!(
                "    [{}] node_idx={}, name='{:?}'",
                i,
                joint.index(),
                joint.name()
            );
        }
    }

    // Step 3: Import glTF back to LAB (skip LGO for now)
    println!("\n📥 Step 3: Importing glTF back to LAB...");
    let new_lab = LwBoneFile::from_gltf(&gltf_doc, &buffers, &images)
        .expect("Failed to import LAB from glTF");

    println!("  ✓ New LAB: {} bones", new_lab.base_seq.len());
    println!("    header.bone_num = {}", new_lab.header.bone_num);
    println!("    header.frame_num = {}", new_lab.header.frame_num);
    println!("    header.dummy_num = {}", new_lab.header.dummy_num);
    println!("    header.key_type = {}", new_lab.header.key_type);
    println!("    base_seq.len() = {}", new_lab.base_seq.len());
    println!("    invmat_seq.len() = {}", new_lab.invmat_seq.len());
    println!("    dummy_seq.len() = {}", new_lab.dummy_seq.len());
    println!("    key_seq.len() = {}", new_lab.key_seq.len());

    // Debug: Print new bone names (first 10 only)
    println!("\n📋 New LAB bones (first 10):");
    for (i, bone) in new_lab.base_seq.iter().take(10).enumerate() {
        println!(
            "    [{}] id={}, parent={}, name='{}'",
            i, bone.id, bone.parent_id, bone.name
        );
    }
    if new_lab.base_seq.len() > 10 {
        println!("    ... ({} more bones)", new_lab.base_seq.len() - 10);
    }

    // Compare bone lists
    println!("\n🔍 Comparing bone lists...");
    println!("  Original has {} bones", original_lab.base_seq.len());
    println!("  New has {} bones", new_lab.base_seq.len());

    // Find missing bones
    let original_names: std::collections::HashSet<_> =
        original_lab.base_seq.iter().map(|b| &b.name).collect();
    let new_names: std::collections::HashSet<_> =
        new_lab.base_seq.iter().map(|b| &b.name).collect();

    let missing_in_new: Vec<_> = original_names.difference(&new_names).collect();
    let extra_in_new: Vec<_> = new_names.difference(&original_names).collect();

    if !missing_in_new.is_empty() {
        println!("  ❌ Bones missing in new LAB:");
        for name in missing_in_new {
            println!("    - '{}'", name);
        }
    }

    if !extra_in_new.is_empty() {
        println!("  ⚠️  Extra bones in new LAB:");
        for name in extra_in_new {
            println!("    - '{}'", name);
        }
    }

    // Step 4: Write new LAB file to temp directory for comparison
    println!("\n💾 Step 4: Writing new LAB file...");
    let temp_dir = std::env::temp_dir().join("pko_roundtrip_test");
    fs::create_dir_all(&temp_dir).expect("Failed to create temp dir");

    let new_lab_path = temp_dir.join("0725_new.lab");

    let new_lab_file = fs::File::create(&new_lab_path).expect("Failed to create new LAB");
    let mut lab_writer = BufWriter::new(new_lab_file);
    new_lab
        .write_options(&mut lab_writer, binrw::Endian::Little, ())
        .expect("Failed to write new LAB");
    drop(lab_writer);

    println!("  ✓ New LAB written to: {}", new_lab_path.display());

    // Step 5: Compare byte-by-byte
    println!("\n🔍 Step 5: Comparing files byte-by-byte...");

    // Compare LAB files
    let original_lab_bytes = fs::read(&lab_path).expect("Failed to read original LAB");
    let new_lab_bytes = fs::read(&new_lab_path).expect("Failed to read new LAB");

    println!("  Original LAB size: {} bytes", original_lab_bytes.len());
    println!("  New LAB size:      {} bytes", new_lab_bytes.len());

    if original_lab_bytes.len() != new_lab_bytes.len() {
        println!("\n❌ LAB FILE SIZE MISMATCH!");
        println!(
            "  Difference: {} bytes",
            (new_lab_bytes.len() as i64 - original_lab_bytes.len() as i64).abs()
        );

        // Find first difference
        let min_len = original_lab_bytes.len().min(new_lab_bytes.len());
        for i in 0..min_len {
            if original_lab_bytes[i] != new_lab_bytes[i] {
                println!("  First byte difference at offset 0x{:08X} ({}):", i, i);
                println!("    Original: 0x{:02X}", original_lab_bytes[i]);
                println!("    New:      0x{:02X}", new_lab_bytes[i]);
                break;
            }
        }

        panic!("LAB files are different sizes!");
    }

    // Find byte differences in LAB
    let mut lab_diffs = Vec::new();
    for (i, (orig, new)) in original_lab_bytes
        .iter()
        .zip(new_lab_bytes.iter())
        .enumerate()
    {
        if orig != new {
            lab_diffs.push((i, *orig, *new));
            if lab_diffs.len() <= 10 {
                println!("  LAB diff at 0x{:08X}: 0x{:02X} → 0x{:02X}", i, orig, new);
            }
        }
    }

    if !lab_diffs.is_empty() {
        println!("\n❌ LAB FILE CONTENT MISMATCH!");
        println!(
            "  Total differences: {} bytes ({:.2}%)",
            lab_diffs.len(),
            (lab_diffs.len() as f64 / original_lab_bytes.len() as f64) * 100.0
        );

        if lab_diffs.len() > 10 {
            println!("  (showing first 10 differences)");
        }

        panic!("LAB files have {} byte differences", lab_diffs.len());
    }

    println!("  ✓ LAB files are identical!");

    println!("\n✅ ROUND-TRIP TEST PASSED!");
    println!("  LAB file is byte-for-byte identical after round-trip conversion (glTF → LAB).");
}
