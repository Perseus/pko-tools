// Unit tests for hierarchy consistency
// These tests verify that bone hierarchies are correctly ordered and valid

use binrw::BinReaderExt;
use pko_tools_lib::animation::character::{LwBoneFile, LW_INVALID_INDEX};
use std::fs;

#[path = "common/mod.rs"]
mod common;

/// Verify depth-first ordering: all children come after their parents
#[test]
fn depth_first_ordering_verified() {
    println!("\n🔍 Testing: Depth-first ordering");

    let lab_files = common::get_known_good_lab_files();

    for lab_path in lab_files.iter().take(5) {
        println!(
            "  Testing: {}",
            lab_path.file_name().unwrap().to_string_lossy()
        );

        let mut file = fs::File::open(lab_path).expect("Failed to open LAB");
        let lab: LwBoneFile = file.read_le().expect("Failed to parse LAB");

        // Build child list for each bone
        let mut children: Vec<Vec<usize>> = vec![Vec::new(); lab.base_seq.len()];
        for (child_idx, bone) in lab.base_seq.iter().enumerate() {
            if bone.parent_id != LW_INVALID_INDEX {
                children[bone.parent_id as usize].push(child_idx);
            }
        }

        // In depth-first order, all children come after parent
        for (parent_idx, child_list) in children.iter().enumerate() {
            for &child_idx in child_list {
                assert!(
                    child_idx > parent_idx,
                    "Child bone {} '{}' comes before parent bone {} '{}' - not depth-first! \
                     Game engine requires depth-first ordering.",
                    child_idx,
                    lab.base_seq[child_idx].name,
                    parent_idx,
                    lab.base_seq[parent_idx].name
                );
            }
        }
    }

    println!("✅ All hierarchies are in depth-first order");
}

/// Verify all parent references point to valid bones
#[test]
fn parent_references_are_valid() {
    println!("\n🔍 Testing: Parent references are valid");

    let lab_files = common::get_known_good_lab_files();

    for lab_path in lab_files.iter().take(5) {
        let mut file = fs::File::open(lab_path).expect("Failed to open LAB");
        let lab: LwBoneFile = file.read_le().expect("Failed to parse LAB");

        for (idx, bone) in lab.base_seq.iter().enumerate() {
            if bone.parent_id != LW_INVALID_INDEX {
                // Parent index must be in range
                assert!(
                    (bone.parent_id as usize) < lab.base_seq.len(),
                    "Bone {} '{}' has parent_id={} but only {} bones exist",
                    idx,
                    bone.name,
                    bone.parent_id,
                    lab.base_seq.len()
                );

                // Parent must come before child
                assert!(
                    bone.parent_id < idx as u32,
                    "Bone {} '{}' has parent_id={} >= own index",
                    idx,
                    bone.name,
                    bone.parent_id
                );
            }
        }
    }

    println!("✅ All parent references are valid");
}

/// Verify bone names are valid and non-empty
#[test]
fn bone_names_are_valid() {
    println!("\n🔍 Testing: Bone names are valid");

    let lab_files = common::get_known_good_lab_files();

    for lab_path in lab_files.iter().take(5) {
        let mut file = fs::File::open(lab_path).expect("Failed to open LAB");
        let lab: LwBoneFile = file.read_le().expect("Failed to parse LAB");

        for (idx, bone) in lab.base_seq.iter().enumerate() {
            assert!(!bone.name.is_empty(), "Bone {} has empty name", idx);

            assert!(
                bone.name.len() < 64, // LW_MAX_NAME
                "Bone {} name too long: {} chars",
                idx,
                bone.name.len()
            );
        }
    }

    println!("✅ All bone names are valid");
}

/// Verify root bone is at index 0
#[test]
fn root_bone_is_at_index_zero() {
    println!("\n🔍 Testing: Root bone is at index 0");

    let lab_files = common::get_known_good_lab_files();

    for lab_path in lab_files.iter().take(5) {
        let mut file = fs::File::open(lab_path).expect("Failed to open LAB");
        let lab: LwBoneFile = file.read_le().expect("Failed to parse LAB");

        if !lab.base_seq.is_empty() {
            assert_eq!(
                lab.base_seq[0].parent_id,
                LW_INVALID_INDEX,
                "File {}: First bone '{}' is not root (parent_id={}). \
                 Root bone should be at index 0 in depth-first order.",
                lab_path.file_name().unwrap().to_string_lossy(),
                lab.base_seq[0].name,
                lab.base_seq[0].parent_id
            );
        }
    }

    println!("✅ Root bones are at index 0");
}

/// Verify hierarchy is connected (all bones reachable from root)
#[test]
fn hierarchy_is_connected() {
    println!("\n🔍 Testing: Hierarchy is connected");

    let lab_files = common::get_known_good_lab_files();

    for lab_path in lab_files.iter().take(5) {
        let mut file = fs::File::open(lab_path).expect("Failed to open LAB");
        let lab: LwBoneFile = file.read_le().expect("Failed to parse LAB");

        if lab.base_seq.is_empty() {
            continue;
        }

        // Build parent-child relationships
        let mut children: Vec<Vec<usize>> = vec![Vec::new(); lab.base_seq.len()];
        for (child_idx, bone) in lab.base_seq.iter().enumerate() {
            if bone.parent_id != LW_INVALID_INDEX {
                children[bone.parent_id as usize].push(child_idx);
            }
        }

        // DFS from root to find all reachable bones
        let mut visited = vec![false; lab.base_seq.len()];
        let mut stack = vec![0usize]; // Start from root

        while let Some(idx) = stack.pop() {
            if visited[idx] {
                continue;
            }
            visited[idx] = true;

            // Add children to stack
            for &child in &children[idx] {
                stack.push(child);
            }
        }

        // All bones should be reachable from root
        let unreachable: Vec<_> = visited
            .iter()
            .enumerate()
            .filter(|(_, &v)| !v)
            .map(|(i, _)| format!("Bone[{}] '{}'", i, lab.base_seq[i].name))
            .collect();

        assert!(
            unreachable.is_empty(),
            "File {}: {} bones unreachable from root: {}",
            lab_path.file_name().unwrap().to_string_lossy(),
            unreachable.len(),
            unreachable.join(", ")
        );
    }

    println!("✅ All hierarchies are connected");
}
