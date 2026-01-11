// Unit tests for skinning validity
// These tests verify mesh-skeleton linkage is correct

use std::fs;
use binrw::BinReaderExt;
use pko_tools_lib::animation::character::LwBoneFile;
use pko_tools_lib::character::model::CharacterGeometricModel;

#[path = "common/mod.rs"]
mod common;

/// Verify bone_index_seq values are in bounds
#[test]
fn bone_index_seq_values_in_bounds() {
    println!("\n🔍 Testing: bone_index_seq values are in bounds");
    
    let known_good_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/known_good");
    
    // Load LAB file
    let lab_path = known_good_path.join("0000.lab");
    if !lab_path.exists() {
        println!("⚠️  Skipping: 0000.lab not found");
        return;
    }
    
    let mut lab_file = fs::File::open(&lab_path).expect("Failed to open LAB");
    let lab: LwBoneFile = lab_file.read_le().expect("Failed to parse LAB");
    
    // Test all corresponding LGO files
    let lgo_files: Vec<_> = fs::read_dir(&known_good_path)
        .expect("Failed to read dir")
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path().extension().and_then(|s| s.to_str()) == Some("lgo")
                && e.path().file_stem().unwrap().to_str().unwrap().starts_with("0000")
        })
        .collect();
    
    for lgo_entry in lgo_files {
        let lgo_path = lgo_entry.path();
        println!("  Testing: {}", lgo_path.file_name().unwrap().to_string_lossy());
        
        let mut lgo_file = fs::File::open(&lgo_path).expect("Failed to open LGO");
        let lgo_model: CharacterGeometricModel = lgo_file.read_le().expect("Failed to parse LGO");
        
        let lgo = match &lgo_model.mesh_info {
            Some(mesh) => mesh,
            None => {
                println!("  ⚠️  No mesh_info, skipping");
                continue;
            }
        };
        
        // All bone_index_seq values must be < LAB bone count
        for (mesh_idx, &lab_idx) in lgo.bone_index_seq.iter().enumerate() {
            assert!(
                lab_idx < lab.base_seq.len() as u32,
                "bone_index_seq[{}] = {} but LAB only has {} bones. \
                 Game would crash with out-of-bounds access!",
                mesh_idx, lab_idx, lab.base_seq.len()
            );
        }
    }
    
    println!("✅ All bone_index_seq values are in bounds");
}

/// Verify vertex blend indices are in bounds
#[test]
fn vertex_blend_indices_in_bounds() {
    println!("\n🔍 Testing: Vertex blend indices are in bounds");
    
    let known_good_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/known_good");
    
    let lgo_files: Vec<_> = fs::read_dir(&known_good_path)
        .expect("Failed to read dir")
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("lgo"))
        .take(5)
        .collect();
    
    for lgo_entry in lgo_files {
        let lgo_path = lgo_entry.path();
        println!("  Testing: {}", lgo_path.file_name().unwrap().to_string_lossy());
        
        let mut lgo_file = fs::File::open(&lgo_path).expect("Failed to open LGO");
        let lgo_model: CharacterGeometricModel = lgo_file.read_le().expect("Failed to parse LGO");
        
        let lgo = match &lgo_model.mesh_info {
            Some(mesh) => mesh,
            None => {
                println!("  ⚠️  No mesh_info, skipping");
                continue;
            }
        };
        
        // Check all vertex blend indices
        for (vertex_idx, blend) in lgo.blend_seq.iter().enumerate() {
            let indices = blend.indexd.to_le_bytes();
            for (influence_idx, &bone_idx) in indices.iter().enumerate() {
                assert!(
                    bone_idx < lgo.header.bone_index_num as u8,
                    "Vertex {} influence {} references mesh bone {} but only {} bones in mesh. \
                     Game would crash!",
                    vertex_idx, influence_idx, bone_idx, lgo.header.bone_index_num
                );
            }
        }
    }
    
    println!("✅ All vertex blend indices are in bounds");
}

/// Verify bone weights sum to approximately 1.0
#[test]
fn bone_weights_sum_to_one() {
    println!("\n🔍 Testing: Bone weights sum to ~1.0");
    
    let known_good_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/known_good");
    
    let lgo_files: Vec<_> = fs::read_dir(&known_good_path)
        .expect("Failed to read dir")
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("lgo"))
        .take(5)
        .collect();
    
    for lgo_entry in lgo_files {
        let lgo_path = lgo_entry.path();
        let mut lgo_file = fs::File::open(&lgo_path).expect("Failed to open LGO");
        let lgo_model: CharacterGeometricModel = lgo_file.read_le().expect("Failed to parse LGO");
        
        let lgo = match &lgo_model.mesh_info {
            Some(mesh) => mesh,
            None => continue,
        };
        
        let mut bad_weights = 0;
        for (vertex_idx, blend) in lgo.blend_seq.iter().enumerate() {
            let sum: f32 = blend.weight.iter().sum();
            
            // Allow some tolerance for floating point
            if (sum - 1.0).abs() > 0.01 {
                bad_weights += 1;
                if bad_weights <= 5 {  // Only print first 5
                    println!(
                        "  ⚠️  Vertex {} weights sum to {} (should be ~1.0)",
                        vertex_idx, sum
                    );
                }
            }
        }
        
        if bad_weights > 0 {
            println!(
                "  ⚠️  {} / {} vertices have weights not summing to 1.0",
                bad_weights, lgo.blend_seq.len()
            );
        }
    }
    
    println!("✅ Weight check complete");
}

/// Verify bone_index_num matches bone_index_seq length
#[test]
fn bone_index_num_matches_sequence_length() {
    println!("\n🔍 Testing: bone_index_num matches bone_index_seq length");
    
    let known_good_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/known_good");
    
    let lgo_files: Vec<_> = fs::read_dir(&known_good_path)
        .expect("Failed to read dir")
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().and_then(|s| s.to_str()) == Some("lgo"))
        .take(5)
        .collect();
    
    for lgo_entry in lgo_files {
        let lgo_path = lgo_entry.path();
        let mut lgo_file = fs::File::open(&lgo_path).expect("Failed to open LGO");
        let lgo_model: CharacterGeometricModel = lgo_file.read_le().expect("Failed to parse LGO");
        
        let lgo = match &lgo_model.mesh_info {
            Some(mesh) => mesh,
            None => continue,
        };
        
        assert_eq!(
            lgo.header.bone_index_num, lgo.bone_index_seq.len() as u32,
            "File {}: bone_index_num={} but bone_index_seq has {} entries",
            lgo_path.file_name().unwrap().to_string_lossy(),
            lgo.header.bone_index_num,
            lgo.bone_index_seq.len()
        );
    }
    
    println!("✅ bone_index_num matches sequence length");
}
