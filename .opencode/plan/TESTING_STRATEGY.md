# Testing Strategy for Bone Hierarchy Pipeline

## Overview

This document outlines a comprehensive testing strategy for the glTF ↔ LAB/LGO conversion pipeline that allows rapid iteration while maintaining correctness.

**Key Constraints:**
- ✅ Have known-good LAB/LGO files for reference
- ❌ Cannot run actual game client in CI
- ✅ File formats are stable (won't change)
- 🎯 Need to move quickly without breaking things

**Testing Philosophy:**
- **Fast feedback loop** - Most tests run in milliseconds
- **High confidence** - Catch semantic errors, not just structural issues
- **Easy debugging** - When tests fail, immediately know what's wrong
- **Automated** - No manual checking required for CI/CD

---

## Testing Pyramid

```
        /\
       /  \       Slow, High-value
      /____\      Visual Validation (Manual, Occasional)
     /      \
    / Golden \    Medium Speed
   / Snapshot \   Integration Tests (Every Commit)
  /____________\
 /              \
/ Unit + Props   \ Fast, Run Always
\________________/ Property-Based + Unit Tests (Every Save)
```

---

## Layer 1: Unit Tests (Invariant Checking)

**Purpose:** Verify mathematical properties that MUST hold, regardless of visual appearance.

**Run frequency:** Every file save (via IDE), every commit

**Speed:** < 100ms for entire suite

### Test Categories

#### A. Index Space Correctness

These tests ensure the core bug fixes work:

```rust
#[cfg(test)]
mod index_space_tests {
    use super::*;
    
    #[test]
    fn parent_id_is_array_position_not_node_index() {
        // This is the core bug we're fixing
        let gltf = load_fixture("non_sequential_nodes.gltf");
        let lab = LwBoneFile::from_gltf(&gltf, &buffers, &images).unwrap();
        
        // Verify: parent_id references array position
        for (idx, bone) in lab.base_seq.iter().enumerate() {
            if bone.parent_id != LW_INVALID_INDEX {
                // Parent must be earlier in array (depth-first)
                assert!(
                    bone.parent_id < idx as u32,
                    "Bug detected! Bone[{}] '{}' has parent_id={} >= own index. \
                     This means parent_id is storing node index, not array position.",
                    idx, bone.name, bone.parent_id
                );
            }
        }
    }
    
    #[test]
    fn bone_index_seq_references_lab_array_not_enumerate_index() {
        let gltf = load_fixture("partial_bones.gltf");
        let lab = LwBoneFile::from_gltf(&gltf, &buffers, &images).unwrap();
        let lgo = CharacterMeshInfo::from_gltf(&gltf, &buffers, &images, &lab).unwrap();
        
        // If bone_index_seq is [0,1,2] for any input, it's likely wrong
        // (the enumerate index bug)
        if lgo.bone_index_seq == vec![0, 1, 2] && lab.base_seq.len() > 3 {
            panic!(
                "Bug detected! bone_index_seq is [0,1,2] but LAB has {} bones. \
                 This suggests bone_index_seq is storing enumerate indices.",
                lab.base_seq.len()
            );
        }
        
        // Verify all indices are valid
        for (mesh_idx, &lab_idx) in lgo.bone_index_seq.iter().enumerate() {
            assert!(
                lab_idx < lab.base_seq.len() as u32,
                "bone_index_seq[{}] = {} but LAB only has {} bones",
                mesh_idx, lab_idx, lab.base_seq.len()
            );
        }
    }
    
    #[test]
    fn bone_ids_are_sequential_array_indices() {
        let lab = load_fixture_lab("character.lab");
        
        for (array_pos, bone) in lab.base_seq.iter().enumerate() {
            assert_eq!(
                bone.id, array_pos as u32,
                "Bone at array position {} has id={}, should be {}",
                array_pos, bone.id, array_pos
            );
        }
    }
}
```

#### B. Hierarchy Consistency

```rust
#[cfg(test)]
mod hierarchy_tests {
    #[test]
    fn no_circular_parent_chains() {
        let lab = load_fixture_lab("character.lab");
        
        for start_idx in 0..lab.base_seq.len() {
            let mut visited = HashSet::new();
            let mut current = start_idx;
            let mut depth = 0;
            
            while lab.base_seq[current].parent_id != LW_INVALID_INDEX {
                assert!(
                    !visited.contains(&current),
                    "Circular parent chain detected starting at bone {}",
                    start_idx
                );
                assert!(
                    depth < 100,
                    "Parent chain too deep (>100), likely a cycle"
                );
                
                visited.insert(current);
                current = lab.base_seq[current].parent_id as usize;
                depth += 1;
            }
        }
    }
    
    #[test]
    fn depth_first_ordering_verified() {
        let lab = load_fixture_lab("character.lab");
        
        // Build child list for each bone
        let mut children: Vec<Vec<usize>> = vec![Vec::new(); lab.base_seq.len()];
        for (child_idx, bone) in lab.base_seq.iter().enumerate() {
            if bone.parent_id != LW_INVALID_INDEX {
                children[bone.parent_id as usize].push(child_idx);
            }
        }
        
        // In depth-first order, all children come immediately after parent
        // or after parent's descendants
        for (parent_idx, child_list) in children.iter().enumerate() {
            for &child_idx in child_list {
                assert!(
                    child_idx > parent_idx,
                    "Child bone {} comes before parent bone {} - not depth-first",
                    child_idx, parent_idx
                );
            }
        }
    }
    
    #[test]
    fn inverse_bind_matrices_match_bone_count() {
        let lab = load_fixture_lab("character.lab");
        
        assert_eq!(
            lab.invmat_seq.len(), lab.base_seq.len(),
            "Inverse bind matrix count mismatch"
        );
    }
}
```

#### C. Skinning Validity

```rust
#[cfg(test)]
mod skinning_tests {
    #[test]
    fn mesh_bone_indices_in_bounds() {
        let lgo = load_fixture_lgo("character.lgo");
        
        for (vertex_idx, blend) in lgo.blend_seq.iter().enumerate() {
            let indices = blend.indexd.to_le_bytes();
            for (influence_idx, &bone_idx) in indices.iter().enumerate() {
                assert!(
                    bone_idx < lgo.bone_index_num as u8,
                    "Vertex {} influence {} references bone {} but mesh only has {} bones",
                    vertex_idx, influence_idx, bone_idx, lgo.bone_index_num
                );
            }
        }
    }
    
    #[test]
    fn bone_weights_sum_to_one() {
        let lgo = load_fixture_lgo("character.lgo");
        
        for (vertex_idx, blend) in lgo.blend_seq.iter().enumerate() {
            let sum: f32 = blend.weight.iter().sum();
            
            assert!(
                (sum - 1.0).abs() < 0.01,
                "Vertex {} weights sum to {} (should be ~1.0)",
                vertex_idx, sum
            );
        }
    }
}
```

---

## Layer 2: Property-Based Testing

**Purpose:** Generate thousands of random valid inputs and verify invariants hold for ALL of them.

**How it works:**
1. Define a "generator" that creates random but structurally valid bone hierarchies
2. Convert them through your pipeline (glTF → LAB/LGO)
3. Check that ALL invariants hold
4. If any test fails, proptest automatically finds the **minimal failing case**

**Library:** [`proptest`](https://github.com/proptest-rs/proptest)

### Example Implementation

```rust
use proptest::prelude::*;
use proptest::collection::vec;

// Strategy: Generate a random valid bone hierarchy
fn bone_hierarchy_strategy() -> impl Strategy<Value = Vec<BoneSpec>> {
    (1..20usize).prop_flat_map(|bone_count| {
        vec(
            (
                "[a-zA-Z]{3,10}",     // Random bone name
                0..bone_count,         // Parent index (will validate)
            ),
            bone_count
        )
    }).prop_map(|specs| {
        // Convert to valid hierarchy (ensure parents come before children)
        let mut bones = Vec::new();
        for (i, (name, parent_idx)) in specs.into_iter().enumerate() {
            let parent_id = if i == 0 || parent_idx >= i {
                LW_INVALID_INDEX  // Root or invalid → make it root
            } else {
                parent_idx as u32  // Valid parent
            };
            
            bones.push(BoneSpec {
                name,
                parent_id,
            });
        }
        bones
    })
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(1000))]
    
    #[test]
    fn any_valid_hierarchy_maintains_invariants(
        bones in bone_hierarchy_strategy()
    ) {
        // Convert test hierarchy to glTF
        let gltf = create_test_gltf_from_bones(&bones);
        
        // Run through our pipeline
        let lab = LwBoneFile::from_gltf(&gltf, &buffers, &images)
            .expect("Pipeline should handle any valid hierarchy");
        
        // Check ALL invariants
        check_all_invariants(&lab);
    }
    
    #[test]
    fn any_bone_subset_produces_valid_bone_index_seq(
        total_bones in 5..20usize,
        used_bone_indices in prop::collection::hash_set(0..20usize, 1..10)
    ) {
        // Create skeleton with N bones
        let bones = create_test_bones(total_bones);
        let gltf = create_test_gltf_from_bones(&bones);
        
        // Create mesh that only uses a subset of bones
        let used_indices: Vec<_> = used_bone_indices.into_iter()
            .filter(|&i| i < total_bones)
            .collect();
        let gltf_with_mesh = add_mesh_using_bones(&gltf, &used_indices);
        
        // Pipeline should handle this
        let lab = LwBoneFile::from_gltf(&gltf_with_mesh, &buffers, &images).unwrap();
        let lgo = CharacterMeshInfo::from_gltf(&gltf_with_mesh, &buffers, &images, &lab).unwrap();
        
        // Verify bone_index_seq is valid
        assert_eq!(lgo.bone_index_seq.len(), used_indices.len());
        for &lab_idx in &lgo.bone_index_seq {
            assert!(lab_idx < lab.base_seq.len() as u32);
        }
    }
}

fn check_all_invariants(lab: &LwBoneFile) {
    // Bone IDs are sequential
    for (i, bone) in lab.base_seq.iter().enumerate() {
        assert_eq!(bone.id, i as u32);
    }
    
    // Parent IDs are valid and come before children
    for (i, bone) in lab.base_seq.iter().enumerate() {
        if bone.parent_id != LW_INVALID_INDEX {
            assert!(bone.parent_id < i as u32);
        }
    }
    
    // No circular chains
    for start in 0..lab.base_seq.len() {
        let mut visited = HashSet::new();
        let mut current = start;
        while lab.base_seq[current].parent_id != LW_INVALID_INDEX {
            assert!(!visited.contains(&current));
            visited.insert(current);
            current = lab.base_seq[current].parent_id as usize;
        }
    }
    
    // IBM count matches
    assert_eq!(lab.invmat_seq.len(), lab.base_seq.len());
}
```

**Why This Is Powerful:**

Instead of writing 10 manual test cases, you run 1000 random cases. When a bug exists:
```
Test failed after 247 runs:
  bones = [
    BoneSpec { name: "aaa", parent_id: INVALID },
    BoneSpec { name: "bbb", parent_id: 0 },
    BoneSpec { name: "ccc", parent_id: 0 },  // Sibling to bbb
  ]
  
Minimal failing case (shrunk from original):
  bones = [
    BoneSpec { name: "a", parent_id: INVALID },
    BoneSpec { name: "b", parent_id: 0 },
    BoneSpec { name: "c", parent_id: 0 },
  ]
  
Assertion failed: bone[2].parent_id = 1 (expected < 2)
```

Proptest automatically **shrinks** the failing case to the minimal example.

---

## Layer 3: Snapshot/Golden File Testing

**Purpose:** Ensure byte-for-byte identical output for known inputs. Catches ANY change in output.

**How it works:**
1. Generate LAB/LGO files from test glTF files
2. Store the output as "golden files"
3. On each test run, regenerate and compare with golden files
4. If different, test fails (unless you explicitly update golden files)

### Implementation

```rust
#[cfg(test)]
mod snapshot_tests {
    use std::fs;
    use std::path::Path;
    
    #[test]
    fn test_simple_skeleton_golden() {
        test_golden_file("simple_skeleton");
    }
    
    #[test]
    fn test_branching_hierarchy_golden() {
        test_golden_file("branching_hierarchy");
    }
    
    #[test]
    fn test_complex_character_golden() {
        test_golden_file("complex_character");
    }
    
    fn test_golden_file(name: &str) {
        // Load input glTF
        let gltf_path = format!("tests/fixtures/gltf/{}.gltf", name);
        let gltf = load_gltf(&gltf_path).unwrap();
        
        // Convert to LAB/LGO
        let lab = LwBoneFile::from_gltf(&gltf, &buffers, &images).unwrap();
        let lgo = CharacterMeshInfo::from_gltf(&gltf, &buffers, &images, &lab).unwrap();
        
        // Serialize to bytes
        let mut lab_bytes = Vec::new();
        lab.write_options(&mut lab_bytes, binrw::Endian::Little, ()).unwrap();
        
        let mut lgo_bytes = Vec::new();
        lgo.write_options(&mut lgo_bytes, binrw::Endian::Little, ()).unwrap();
        
        // Compare or update golden files
        let lab_golden = format!("tests/fixtures/golden/{}.lab", name);
        let lgo_golden = format!("tests/fixtures/golden/{}.lgo", name);
        
        if std::env::var("UPDATE_GOLDEN").is_ok() {
            // Update mode: save new golden files
            fs::write(&lab_golden, &lab_bytes).unwrap();
            fs::write(&lgo_golden, &lgo_bytes).unwrap();
            println!("Updated golden files for {}", name);
        } else {
            // Test mode: compare with existing golden files
            let expected_lab = fs::read(&lab_golden).unwrap();
            let expected_lgo = fs::read(&lgo_golden).unwrap();
            
            if lab_bytes != expected_lab {
                save_diff_for_debugging(&lab_bytes, &expected_lab, &format!("{}_lab", name));
                panic!(
                    "LAB output for {} differs from golden file.\n\
                     Run with UPDATE_GOLDEN=1 to update.\n\
                     Diff saved to test_artifacts/{}_lab_diff.txt",
                    name, name
                );
            }
            
            if lgo_bytes != expected_lgo {
                save_diff_for_debugging(&lgo_bytes, &expected_lgo, &format!("{}_lgo", name));
                panic!(
                    "LGO output for {} differs from golden file.\n\
                     Run with UPDATE_GOLDEN=1 to update.\n\
                     Diff saved to test_artifacts/{}_lgo_diff.txt",
                    name, name
                );
            }
        }
    }
    
    fn save_diff_for_debugging(actual: &[u8], expected: &[u8], name: &str) {
        // Create human-readable diff
        let diff = format!(
            "Byte differences for {}:\n\
             Actual length: {}\n\
             Expected length: {}\n\n",
            name, actual.len(), expected.len()
        );
        
        // Show first few differences
        let mut diff_details = String::new();
        for (i, (a, e)) in actual.iter().zip(expected.iter()).enumerate() {
            if a != e {
                diff_details.push_str(&format!(
                    "Offset 0x{:04x} ({:6}): actual=0x{:02x} expected=0x{:02x}\n",
                    i, i, a, e
                ));
                if diff_details.lines().count() > 20 {
                    diff_details.push_str("... (showing first 20 differences)\n");
                    break;
                }
            }
        }
        
        fs::create_dir_all("test_artifacts").ok();
        fs::write(
            format!("test_artifacts/{}_diff.txt", name),
            diff + &diff_details
        ).ok();
    }
}
```

**Usage:**

```bash
# Normal test run - compares with golden files
cargo test --test snapshot_tests

# Update golden files after intentional changes
UPDATE_GOLDEN=1 cargo test --test snapshot_tests
```

**When to update golden files:**
- ✅ After fixing bugs (output should change)
- ✅ After intentional format improvements
- ❌ NOT when test fails unexpectedly (investigate first!)

---

## Layer 4: Visual Validation (Without Game Client)

Since you can't run the game client, here are alternative approaches for visual validation:

### Option A: Export to glTF and Use Standard Viewers

**Workflow:**
1. Convert LAB/LGO → glTF
2. Open in web-based glTF viewer
3. Verify skeleton and animation visually

```rust
#[test]
#[ignore]  // Manual test
fn export_for_visual_inspection() {
    let lab = load_fixture_lab("character.lab");
    let lgo = load_fixture_lgo("character.lgo");
    
    // Export back to glTF
    let gltf = export_to_gltf(&lab, &lgo);
    
    // Save to test artifacts
    fs::create_dir_all("test_artifacts/visual").unwrap();
    gltf.save("test_artifacts/visual/character.gltf").unwrap();
    
    println!("\n=== VISUAL INSPECTION ===");
    println!("1. Open https://gltf-viewer.donmccurdy.com/");
    println!("2. Load: test_artifacts/visual/character.gltf");
    println!("\nVerify:");
    println!("  ☐ Skeleton hierarchy looks correct");
    println!("  ☐ Bones are in expected positions");
    println!("  ☐ Mesh deforms correctly (move animation slider)");
    println!("  ☐ No visual artifacts or distortions");
    println!("  ☐ Compare with reference model if available");
}
```

**Recommended Viewers:**
- https://gltf-viewer.donmccurdy.com/ (best for debugging)
- https://sandbox.babylonjs.com/ (shows skeleton)
- Blender (most detailed inspection)

### Option B: Mathematical Validation (Simulate Game Engine)

**Idea:** Implement the exact same algorithm the game uses, verify it produces valid transforms.

```rust
#[test]
fn simulate_game_engine_hierarchy_building() {
    let lab = load_fixture_lab("character.lab");
    
    // Simulate what game does at runtime
    let bone_matrices = build_hierarchy_like_game_engine(&lab, frame: 0);
    
    // Verify mathematical properties
    for (i, matrix) in bone_matrices.iter().enumerate() {
        // 1. No NaN or infinite values
        assert!(
            matrix.iter().all(|&v| v.is_finite()),
            "Bone {} matrix contains NaN/infinite",
            i
        );
        
        // 2. Determinant should be reasonable (not degenerate)
        let det = matrix.determinant();
        assert!(
            det.abs() > 0.0001,
            "Bone {} matrix is degenerate (det={})",
            i, det
        );
        
        // 3. For rigid transforms, determinant should be ~1
        // (allows for scale, so we're lenient)
        assert!(
            det.abs() < 1000.0,
            "Bone {} matrix has extreme scale (det={})",
            i, det
        );
    }
    
    // Verify parent-child relationships make sense
    verify_bone_transforms_consistent(&lab, &bone_matrices);
}

fn build_hierarchy_like_game_engine(lab: &LwBoneFile, frame: usize) -> Vec<Matrix4<f32>> {
    // This is the EXACT algorithm from lwAnimCtrl.cpp
    let mut out_buf = vec![Matrix4::identity(); lab.base_seq.len()];
    
    // Step 1: Build hierarchy
    for i in 0..lab.base_seq.len() {
        // Get local transform for this bone at this frame
        let local_transform = get_bone_local_transform(lab, i, frame);
        
        let parent_id = lab.base_seq[i].parent_id;
        if parent_id == LW_INVALID_INDEX {
            out_buf[i] = local_transform;
        } else {
            // Multiply by parent's already-computed transform
            out_buf[i] = local_transform * out_buf[parent_id as usize];
        }
    }
    
    // Step 2: Apply inverse bind matrices
    for i in 0..lab.base_seq.len() {
        out_buf[i] = lab.invmat_seq[i].0 * out_buf[i];
    }
    
    out_buf
}

fn verify_bone_transforms_consistent(lab: &LwBoneFile, matrices: &[Matrix4<f32>]) {
    // Child bones should be "close to" their parents in world space
    for (i, bone) in lab.base_seq.iter().enumerate() {
        if bone.parent_id != LW_INVALID_INDEX {
            let parent_pos = matrices[bone.parent_id as usize].w.truncate();
            let child_pos = matrices[i].w.truncate();
            let distance = (child_pos - parent_pos).magnitude();
            
            // Bone lengths should be reasonable (0.01 to 100 units)
            assert!(
                distance < 100.0,
                "Bone {} '{}' is too far from parent (distance={})",
                i, bone.name, distance
            );
        }
    }
}
```

### Option C: Round-Trip Validation with Known-Good Files

**This is probably your best option for visual confidence:**

```rust
#[test]
fn round_trip_preserves_visual_properties() {
    // Start with a KNOWN-GOOD LAB/LGO from the game
    let original_lab = load_known_good_lab("character_001.lab");
    let original_lgo = load_known_good_lgo("character_001.lgo");
    
    // Export to glTF
    let gltf = export_to_gltf(&original_lab, &original_lgo);
    
    // Import back
    let imported_lab = LwBoneFile::from_gltf(&gltf, &buffers, &images).unwrap();
    let imported_lgo = CharacterMeshInfo::from_gltf(&gltf, &buffers, &images, &imported_lab).unwrap();
    
    // Verify key visual properties match
    compare_bone_hierarchies(&original_lab, &imported_lab);
    compare_skinning_data(&original_lgo, &imported_lgo);
    compare_animations(&original_lab, &imported_lab);
}

fn compare_bone_hierarchies(original: &LwBoneFile, imported: &LwBoneFile) {
    assert_eq!(original.base_seq.len(), imported.base_seq.len(), "Bone count changed");
    
    for (orig, imp) in original.base_seq.iter().zip(&imported.base_seq) {
        // Names should match
        assert_eq!(orig.name, imp.name, "Bone name changed");
        
        // Parent relationships should match
        // (parent_id might differ but parent NAME should match)
        if orig.parent_id != LW_INVALID_INDEX {
            let orig_parent_name = &original.base_seq[orig.parent_id as usize].name;
            let imp_parent_name = &imported.base_seq[imp.parent_id as usize].name;
            assert_eq!(
                orig_parent_name, imp_parent_name,
                "Bone '{}' parent changed from '{}' to '{}'",
                orig.name, orig_parent_name, imp_parent_name
            );
        } else {
            assert_eq!(imp.parent_id, LW_INVALID_INDEX, "Root bone changed");
        }
    }
    
    // Inverse bind matrices should be very similar
    for (i, (orig, imp)) in original.invmat_seq.iter().zip(&imported.invmat_seq).enumerate() {
        let diff = matrix_difference(&orig.0, &imp.0);
        assert!(
            diff < 0.001,  // 0.1% tolerance for floating point
            "Bone {} IBM differs by {}", i, diff
        );
    }
}
```

---

## Recommended Test Structure

```
src-tauri/
├── tests/
│   ├── unit/
│   │   ├── index_spaces.rs       # Core bug fix tests
│   │   ├── hierarchy.rs          # Hierarchy consistency
│   │   └── skinning.rs           # Mesh-skeleton linkage
│   ├── integration/
│   │   ├── snapshot_tests.rs     # Golden file comparison
│   │   ├── round_trip.rs         # Known-good files
│   │   └── property_based.rs     # Proptest generators
│   ├── visual/
│   │   ├── export_for_inspection.rs  # Manual visual tests
│   │   └── simulate_engine.rs        # Math validation
│   └── fixtures/
│       ├── gltf/
│       │   ├── simple_skeleton.gltf
│       │   ├── branching_hierarchy.gltf
│       │   ├── non_sequential_nodes.gltf
│       │   └── complex_character.gltf
│       ├── golden/
│       │   ├── simple_skeleton.lab
│       │   ├── simple_skeleton.lgo
│       │   └── ...
│       └── known_good/
│           ├── character_001.lab     # From actual game
│           ├── character_001.lgo
│           └── ...
```

---

## Test Workflow

### During Development (Every Save)

```bash
# Run fast unit tests on every file save (via IDE or cargo-watch)
cargo watch -x 'test --lib'
```

This gives you **instant feedback** (< 100ms) while coding.

### Before Commit (Pre-commit Hook)

```bash
# Run all tests except manual ones
cargo test --all-targets

# This includes:
# - Unit tests
# - Property-based tests (1000 cases)
# - Snapshot tests
# Time: ~5 seconds
```

### CI/CD Pipeline

```yaml
# .github/workflows/test.yml
name: Test Pipeline

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      
      - name: Cache cargo registry
        uses: actions/cache@v2
        with:
          path: ~/.cargo/registry
          key: ${{ runner.os }}-cargo-registry
      
      - name: Run all automated tests
        run: |
          cd src-tauri
          cargo test --all-targets --verbose
      
      - name: Verify golden files unchanged
        run: |
          cd src-tauri
          cargo test --test snapshot_tests
          # Fail if any golden files were modified
          git diff --exit-code tests/fixtures/golden/
      
      - name: Run property-based tests with high case count
        run: |
          cd src-tauri
          PROPTEST_CASES=10000 cargo test --test property_based
      
      - name: Generate test artifacts for inspection
        if: failure()
        run: |
          cd src-tauri
          cargo test export_for_visual_inspection -- --ignored
      
      - name: Upload test artifacts
        if: failure()
        uses: actions/upload-artifact@v2
        with:
          name: test-artifacts
          path: src-tauri/test_artifacts/
```

### Weekly: Manual Visual Validation

```bash
# Export test models for visual inspection
cargo test visual:: -- --ignored --nocapture

# Open generated files in glTF viewer
# Check against known-good references
```

---

## Setting Up Your Known-Good Files

Since you have known-good LAB/LGO files, here's how to use them:

### 1. Create Test Fixtures

```bash
# Copy known-good files to test fixtures
mkdir -p src-tauri/tests/fixtures/known_good
cp /path/to/game/character_001.lab src-tauri/tests/fixtures/known_good/
cp /path/to/game/character_001.lgo src-tauri/tests/fixtures/known_good/

# Do this for 3-5 representative characters
```

### 2. Create Corresponding glTF Files

```rust
// One-time setup: export known-good files to glTF
#[test]
#[ignore]
fn create_golden_gltf_files() {
    for entry in fs::read_dir("tests/fixtures/known_good").unwrap() {
        let path = entry.unwrap().path();
        if path.extension() == Some("lab") {
            let lab = load_lab(&path);
            let lgo_path = path.with_extension("lgo");
            let lgo = load_lgo(&lgo_path);
            
            let gltf = export_to_gltf(&lab, &lgo);
            let gltf_path = path.with_extension("gltf");
            gltf.save(&gltf_path).unwrap();
            
            println!("Created {}", gltf_path.display());
        }
    }
}
```

### 3. Use as Test Oracles

```rust
#[test]
fn round_trip_all_known_good_files() {
    for entry in fs::read_dir("tests/fixtures/known_good").unwrap() {
        let path = entry.unwrap().path();
        if path.extension() == Some("gltf") {
            println!("Testing {}", path.display());
            test_round_trip(&path);
        }
    }
}
```

---

## Debug Helpers

When tests fail, you want to quickly understand WHY:

```rust
// Add this to your test utils
pub fn print_bone_hierarchy(lab: &LwBoneFile) {
    println!("\n=== Bone Hierarchy ===");
    for (i, bone) in lab.base_seq.iter().enumerate() {
        let parent_name = if bone.parent_id == LW_INVALID_INDEX {
            "ROOT".to_string()
        } else {
            format!("'{}'", lab.base_seq[bone.parent_id as usize].name)
        };
        
        println!(
            "[{}] '{}' (id={}, parent_id={} → {})",
            i, bone.name, bone.id, bone.parent_id, parent_name
        );
    }
}

pub fn print_bone_index_seq(lab: &LwBoneFile, lgo: &CharacterMeshInfo) {
    println!("\n=== Bone Index Mapping ===");
    println!("Mesh has {} bones, LAB has {} bones", lgo.bone_index_num, lab.base_seq.len());
    
    for (mesh_idx, &lab_idx) in lgo.bone_index_seq.iter().enumerate() {
        let bone_name = &lab.base_seq[lab_idx as usize].name;
        println!(
            "mesh_bone[{}] → LAB_bone[{}] '{}'",
            mesh_idx, lab_idx, bone_name
        );
    }
}
```

Use in tests:
```rust
#[test]
fn debug_failing_case() {
    let gltf = load_fixture("failing_case.gltf");
    let lab = LwBoneFile::from_gltf(&gltf, &buffers, &images).unwrap();
    let lgo = CharacterMeshInfo::from_gltf(&gltf, &buffers, &images, &lab).unwrap();
    
    print_bone_hierarchy(&lab);
    print_bone_index_seq(&lab, &lgo);
    
    // Now the failure reason should be obvious
    assert_eq!(lab.base_seq.len(), 5);
}
```

---

## Summary

**Recommended Testing Layers (in priority order):**

1. **Unit tests for index spaces** (MUST HAVE)
   - Fast, catch the core bugs immediately
   - Run on every file save

2. **Snapshot tests with known-good files** (MUST HAVE)
   - Ensures output doesn't change unexpectedly
   - Run before every commit

3. **Property-based tests** (HIGHLY RECOMMENDED)
   - Finds edge cases you didn't think of
   - Run in CI with high case count

4. **Round-trip tests** (HIGHLY RECOMMENDED)
   - Proves your conversions are correct
   - Uses your known-good files

5. **Visual export for manual checks** (NICE TO HAVE)
   - Weekly sanity check
   - Open in glTF viewer

**This gives you:**
- ✅ Fast feedback (< 100ms for most tests)
- ✅ High confidence (catches semantic errors)
- ✅ Easy debugging (clear failure messages)
- ✅ Fully automated (no manual checking in CI)
- ✅ Safe refactoring (change anything, tests tell you if it breaks)

Want me to create a detailed implementation plan for any of these layers?
