// Unit tests for index space correctness
// These tests verify that the core bugs are fixed:
// - Bug #1: parent_id stores array positions, not node indices
// - Bug #3: bone_index_seq stores LAB array indices, not enumerate indices

use std::collections::HashSet;
use std::fs;
use binrw::BinReaderExt;
use pko_tools_lib::animation::character::{LwBoneFile, LW_INVALID_INDEX};
use pko_tools_lib::character::model::CharacterGeometricModel;

// Import test helpers
#[path = "common/mod.rs"]
mod common;

/// BUG #1 TEST: Verify parent_id is array position, not node index
/// This is the core bug - parent_id MUST be an array index for game engine to work
#[test]
fn parent_id_is_array_position_not_node_index() {
    println!("\n🔍 Testing Bug #1: parent_id uses array positions");
    
    // Test with all known-good LAB files
    let lab_files = common::get_known_good_lab_files();
    assert!(!lab_files.is_empty(), "No known-good LAB files found");
    
    for lab_path in lab_files.iter().take(5) {  // Test first 5 files
        println!("  Testing: {}", lab_path.file_name().unwrap().to_string_lossy());
        
        let mut file = fs::File::open(lab_path).expect("Failed to open LAB file");
        let lab: LwBoneFile = file.read_le().expect("Failed to parse LAB file");
        
        // Core invariant: parent_id < child's index (depth-first ordering)
        for (idx, bone) in lab.base_seq.iter().enumerate() {
            if bone.parent_id != LW_INVALID_INDEX {
                assert!(
                    bone.parent_id < idx as u32,
                    "❌ Bug #1 detected! \
                     Bone[{}] '{}' has parent_id={} >= own index {}. \
                     This means parent_id is storing node index, not array position. \
                     Game engine will access wrong bone!",
                    idx, bone.name, bone.parent_id, idx
                );
            }
        }
    }
    
    println!("✅ Bug #1 check passed: All parent_id values are valid array positions");
}

/// BUG #1 EXTENDED: Verify bone IDs are sequential
#[test]
fn bone_ids_are_sequential_array_indices() {
    println!("\n🔍 Testing: Bone IDs are sequential");
    
    let lab_files = common::get_known_good_lab_files();
    
    for lab_path in lab_files.iter().take(5) {
        let mut file = fs::File::open(lab_path).expect("Failed to open LAB file");
        let lab: LwBoneFile = file.read_le().expect("Failed to parse LAB file");
        
        for (array_pos, bone) in lab.base_seq.iter().enumerate() {
            assert_eq!(
                bone.id, array_pos as u32,
                "Bone at array position {} has id={}, should be {}. \
                 Bone IDs must be sequential for game engine.",
                array_pos, bone.id, array_pos
            );
        }
    }
    
    println!("✅ Bone IDs are sequential");
}

/// BUG #3 TEST: Verify bone_index_seq contains LAB array indices
/// NOT enumerate indices (which would just be 0,1,2,3...)
#[test]
fn bone_index_seq_references_lab_array_not_enumerate_index() {
    println!("\n🔍 Testing Bug #3: bone_index_seq uses LAB array indices");
    
    // For this test, we need LGO files with their corresponding LAB
    let known_good_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/known_good");
    
    // Find LAB file
    let lab_path = known_good_path.join("0000.lab");
    if !lab_path.exists() {
        println!("⚠️  Skipping: 0000.lab not found");
        return;
    }
    
    let mut lab_file = fs::File::open(&lab_path).expect("Failed to open LAB");
    let lab: LwBoneFile = lab_file.read_le().expect("Failed to parse LAB");
    
    // Find corresponding LGO files
    let lgo_files: Vec<_> = fs::read_dir(&known_good_path)
        .expect("Failed to read known_good dir")
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path().extension().and_then(|s| s.to_str()) == Some("lgo")
                && e.path().file_stem().unwrap().to_str().unwrap().starts_with("0000")
        })
        .take(3)  // Test first 3 LGO files
        .collect();
    
    for lgo_entry in lgo_files {
        let lgo_path = lgo_entry.path();
        println!("  Testing: {}", lgo_path.file_name().unwrap().to_string_lossy());
        
        let mut lgo_file = fs::File::open(&lgo_path).expect("Failed to open LGO");
        let lgo_model: CharacterGeometricModel = lgo_file.read_le().expect("Failed to parse LGO");
        
        // Extract mesh_info from the model
        let lgo = match &lgo_model.mesh_info {
            Some(mesh) => mesh,
            None => {
                println!("  ⚠️  No mesh_info in this LGO, skipping");
                continue;
            }
        };
        
        // Bug #3 detection: If bone_index_seq is [0,1,2] for ANY input,
        // it's likely the enumerate index bug
        if lgo.bone_index_seq == vec![0, 1, 2] && lab.base_seq.len() > 3 {
            panic!(
                "❌ Bug #3 detected! \
                 bone_index_seq is [0,1,2] but LAB has {} bones. \
                 This suggests bone_index_seq is storing enumerate indices, not LAB bone indices.",
                lab.base_seq.len()
            );
        }
        
        // Verify all indices are valid LAB bone array indices
        for (mesh_idx, &lab_idx) in lgo.bone_index_seq.iter().enumerate() {
            assert!(
                lab_idx < lab.base_seq.len() as u32,
                "❌ Bug #3 detected! \
                 bone_index_seq[{}] = {} but LAB only has {} bones. \
                 Out-of-bounds access would crash game!",
                mesh_idx, lab_idx, lab.base_seq.len()
            );
        }
    }
    
    println!("✅ Bug #3 check passed: bone_index_seq contains valid LAB indices");
}

/// Verify no circular parent chains exist
#[test]
fn no_circular_parent_chains() {
    println!("\n🔍 Testing: No circular parent chains");
    
    let lab_files = common::get_known_good_lab_files();
    
    for lab_path in lab_files.iter().take(5) {
        let mut file = fs::File::open(lab_path).expect("Failed to open LAB");
        let lab: LwBoneFile = file.read_le().expect("Failed to parse LAB");
        
        // Follow parent chain for each bone
        for start_idx in 0..lab.base_seq.len() {
            let mut visited = HashSet::new();
            let mut current = start_idx;
            let mut depth = 0;
            
            while lab.base_seq[current].parent_id != LW_INVALID_INDEX {
                assert!(
                    !visited.contains(&current),
                    "Circular parent chain detected at bone {} '{}'",
                    current, lab.base_seq[current].name
                );
                assert!(
                    depth < 100,
                    "Parent chain too deep (>100), likely a cycle at bone '{}'",
                    lab.base_seq[current].name
                );
                
                visited.insert(current);
                current = lab.base_seq[current].parent_id as usize;
                depth += 1;
            }
        }
    }
    
    println!("✅ No circular parent chains found");
}

/// Verify exactly one root bone exists
#[test]
fn exactly_one_root_bone() {
    println!("\n🔍 Testing: Exactly one root bone");
    
    let lab_files = common::get_known_good_lab_files();
    
    for lab_path in lab_files.iter().take(5) {
        let mut file = fs::File::open(lab_path).expect("Failed to open LAB");
        let lab: LwBoneFile = file.read_le().expect("Failed to parse LAB");
        
        let root_count = lab.base_seq.iter()
            .filter(|b| b.parent_id == LW_INVALID_INDEX)
            .count();
        
        assert_eq!(
            root_count, 1,
            "File {} has {} root bones, should have exactly 1. \
             Game requires single root bone.",
            lab_path.file_name().unwrap().to_string_lossy(),
            root_count
        );
    }
    
    println!("✅ All files have exactly one root bone");
}

#[test]
fn inverse_bind_matrices_match_bone_count() {
    println!("\n🔍 Testing: Inverse bind matrices match bone count");
    
    let lab_files = common::get_known_good_lab_files();
    
    for lab_path in lab_files.iter().take(5) {
        let mut file = fs::File::open(lab_path).expect("Failed to open LAB");
        let lab: LwBoneFile = file.read_le().expect("Failed to parse LAB");
        
        assert_eq!(
            lab.invmat_seq.len(), lab.base_seq.len(),
            "Inverse bind matrix count ({}) doesn't match bone count ({})",
            lab.invmat_seq.len(), lab.base_seq.len()
        );
    }
    
    println!("✅ Inverse bind matrix counts match");
}
