// Common test utilities and helpers
use std::fs;
use std::path::{Path, PathBuf};

/// Load a known-good LAB file from test fixtures
pub fn load_known_good_lab(filename: &str) -> PathBuf {
    let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    path.push("tests/fixtures/known_good");
    path.push(filename);
    
    assert!(path.exists(), "Test fixture not found: {}", path.display());
    path
}

/// Load a known-good LGO file from test fixtures
pub fn load_known_good_lgo(filename: &str) -> PathBuf {
    let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    path.push("tests/fixtures/known_good");
    path.push(filename);
    
    assert!(path.exists(), "Test fixture not found: {}", path.display());
    path
}

/// Load a test glTF file from fixtures
pub fn load_test_gltf(filename: &str) -> PathBuf {
    let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    path.push("tests/fixtures/gltf");
    path.push(filename);
    
    assert!(path.exists(), "Test glTF not found: {}", path.display());
    path
}

/// Print bone hierarchy for debugging
pub fn print_bone_hierarchy(bones: &[pko_tools_lib::animation::character::LwBoneBaseInfo]) {
    println!("\n=== Bone Hierarchy ===");
    for (i, bone) in bones.iter().enumerate() {
        let parent_name = if bone.parent_id == pko_tools_lib::animation::character::LW_INVALID_INDEX {
            "ROOT".to_string()
        } else {
            format!("'{}'", bones[bone.parent_id as usize].name)
        };
        
        println!(
            "[{}] '{}' (id={}, parent_id={} → {})",
            i, bone.name, bone.id, bone.parent_id, parent_name
        );
    }
}

/// Print bone index sequence mapping for debugging
pub fn print_bone_index_seq(
    bones: &[pko_tools_lib::animation::character::LwBoneBaseInfo],
    bone_index_seq: &[u32],
) {
    println!("\n=== Bone Index Mapping ===");
    println!("Mesh has {} bones, LAB has {} bones", bone_index_seq.len(), bones.len());
    
    for (mesh_idx, &lab_idx) in bone_index_seq.iter().enumerate() {
        if (lab_idx as usize) < bones.len() {
            let bone_name = &bones[lab_idx as usize].name;
            println!(
                "mesh_bone[{}] → LAB_bone[{}] '{}'",
                mesh_idx, lab_idx, bone_name
            );
        } else {
            println!(
                "mesh_bone[{}] → LAB_bone[{}] ❌ OUT OF BOUNDS (LAB has {} bones)",
                mesh_idx, lab_idx, bones.len()
            );
        }
    }
}

/// Get list of all known-good test files
pub fn get_known_good_lab_files() -> Vec<PathBuf> {
    let mut path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    path.push("tests/fixtures/known_good");
    
    let mut lab_files = Vec::new();
    
    if let Ok(entries) = fs::read_dir(&path) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("lab") {
                lab_files.push(path);
            }
        }
    }
    
    lab_files.sort();
    lab_files
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_can_find_known_good_files() {
        let files = get_known_good_lab_files();
        assert!(!files.is_empty(), "Should have at least one known-good LAB file");
        println!("Found {} known-good LAB files", files.len());
    }
}
