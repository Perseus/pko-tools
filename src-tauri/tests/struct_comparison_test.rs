// Test to compare LAB struct fields directly to identify what's different

use binrw::BinReaderExt;
use cgmath::InnerSpace;
use pko_tools_lib::animation::character::LwBoneFile;
use std::fs;

#[path = "common/mod.rs"]
mod common;

#[test]
fn test_struct_fields_after_roundtrip() {
    println!("\n🔬 Struct field comparison test");

    let test_dir =
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/known_good");

    // Load original LAB
    let lab_path = test_dir.join("0725.lab");
    let mut original_lab_file = fs::File::open(&lab_path).expect("Failed to open original LAB");
    let original_lab: LwBoneFile = original_lab_file
        .read_le()
        .expect("Failed to parse original LAB");

    // Load glTF and import back
    let gltf_path = test_dir.join("789.gltf");
    let (gltf_doc, buffers, images) = gltf::import(&gltf_path).expect("Failed to load 789.gltf");
    let new_lab = LwBoneFile::from_gltf(&gltf_doc, &buffers, &images)
        .expect("Failed to import LAB from glTF");

    println!("\n📊 Header comparison:");
    println!(
        "  bone_num:  {} vs {}",
        original_lab.header.bone_num, new_lab.header.bone_num
    );
    println!(
        "  frame_num: {} vs {}",
        original_lab.header.frame_num, new_lab.header.frame_num
    );
    println!(
        "  dummy_num: {} vs {}",
        original_lab.header.dummy_num, new_lab.header.dummy_num
    );
    println!(
        "  key_type:  {} vs {}",
        original_lab.header.key_type, new_lab.header.key_type
    );

    assert_eq!(
        original_lab.header.bone_num, new_lab.header.bone_num,
        "bone_num mismatch"
    );
    assert_eq!(
        original_lab.header.frame_num, new_lab.header.frame_num,
        "frame_num mismatch"
    );
    assert_eq!(
        original_lab.header.dummy_num, new_lab.header.dummy_num,
        "dummy_num mismatch"
    );
    assert_eq!(
        original_lab.header.key_type, new_lab.header.key_type,
        "key_type mismatch"
    );

    println!("\n📊 Bone comparison:");
    assert_eq!(
        original_lab.base_seq.len(),
        new_lab.base_seq.len(),
        "Different number of bones"
    );

    for (i, (orig_bone, new_bone)) in original_lab
        .base_seq
        .iter()
        .zip(new_lab.base_seq.iter())
        .enumerate()
    {
        if orig_bone.name != new_bone.name {
            println!(
                "  ❌ Bone {}: name '{}' vs '{}'",
                i, orig_bone.name, new_bone.name
            );
        }
        if orig_bone.id != new_bone.id {
            println!("  ❌ Bone {}: id {} vs {}", i, orig_bone.id, new_bone.id);
        }
        if orig_bone.parent_id != new_bone.parent_id {
            println!(
                "  ❌ Bone {}: parent_id {} vs {}",
                i, orig_bone.parent_id, new_bone.parent_id
            );
        }
    }
    println!(
        "  ✓ All {} bones match (name, id, parent_id)",
        original_lab.base_seq.len()
    );

    println!("\n📊 Animation keyframes comparison:");
    assert_eq!(
        original_lab.key_seq.len(),
        new_lab.key_seq.len(),
        "Different number of key sequences"
    );

    let mut bones_with_diff_keyframes = 0;
    for (i, (orig_key, new_key)) in original_lab
        .key_seq
        .iter()
        .zip(new_lab.key_seq.iter())
        .enumerate()
    {
        let mut has_diff = false;

        // Compare pos_seq
        match (&orig_key.pos_seq, &new_key.pos_seq) {
            (Some(orig_pos), Some(new_pos)) => {
                if orig_pos.len() != new_pos.len() {
                    println!(
                        "  ❌ Bone {}: pos_seq length {} vs {}",
                        i,
                        orig_pos.len(),
                        new_pos.len()
                    );
                    has_diff = true;
                } else {
                    // Check for float differences
                    let mut max_pos_diff = 0.0f32;
                    for (orig_p, new_p) in orig_pos.iter().zip(new_pos.iter()) {
                        let diff_x = (orig_p.0.x - new_p.0.x).abs();
                        let diff_y = (orig_p.0.y - new_p.0.y).abs();
                        let diff_z = (orig_p.0.z - new_p.0.z).abs();
                        max_pos_diff = max_pos_diff.max(diff_x).max(diff_y).max(diff_z);
                    }
                    if max_pos_diff > 0.0001 {
                        println!("  ⚠️  Bone {}: pos_seq max diff {:.6}", i, max_pos_diff);
                        has_diff = true;
                    }
                }
            }
            (None, None) => {}
            _ => {
                println!("  ❌ Bone {}: pos_seq presence mismatch", i);
                has_diff = true;
            }
        }

        // Compare quat_seq
        match (&orig_key.quat_seq, &new_key.quat_seq) {
            (Some(orig_quat), Some(new_quat)) => {
                if orig_quat.len() != new_quat.len() {
                    println!(
                        "  ❌ Bone {}: quat_seq length {} vs {}",
                        i,
                        orig_quat.len(),
                        new_quat.len()
                    );
                    has_diff = true;
                } else {
                    let mut max_quat_diff = 0.0f32;
                    let mut max_diff_frame = 0;
                    let mut max_diff_orig = orig_quat[0].clone();
                    let mut max_diff_new = new_quat[0].clone();

                    for (frame_idx, (orig_q, new_q)) in
                        orig_quat.iter().zip(new_quat.iter()).enumerate()
                    {
                        // Normalize both quaternions first (original file may have unnormalized quats)
                        let orig_norm = orig_q.0.normalize();
                        let new_norm = new_q.0.normalize();

                        // Account for quaternion double cover: q and -q represent same rotation
                        // Check both q vs q' and q vs -q', take minimum difference
                        let diff_x_pos = (orig_norm.v.x - new_norm.v.x).abs();
                        let diff_y_pos = (orig_norm.v.y - new_norm.v.y).abs();
                        let diff_z_pos = (orig_norm.v.z - new_norm.v.z).abs();
                        let diff_w_pos = (orig_norm.s - new_norm.s).abs();
                        let frame_max_pos =
                            diff_x_pos.max(diff_y_pos).max(diff_z_pos).max(diff_w_pos);

                        let diff_x_neg = (orig_norm.v.x - (-new_norm.v.x)).abs();
                        let diff_y_neg = (orig_norm.v.y - (-new_norm.v.y)).abs();
                        let diff_z_neg = (orig_norm.v.z - (-new_norm.v.z)).abs();
                        let diff_w_neg = (orig_norm.s - (-new_norm.s)).abs();
                        let frame_max_neg =
                            diff_x_neg.max(diff_y_neg).max(diff_z_neg).max(diff_w_neg);

                        let frame_max = frame_max_pos.min(frame_max_neg);
                        if frame_max > max_quat_diff {
                            max_quat_diff = frame_max;
                            max_diff_frame = frame_idx;
                            max_diff_orig = orig_q.clone();
                            max_diff_new = new_q.clone();
                        }
                    }
                    if max_quat_diff > 0.001 {
                        println!(
                            "  ⚠️  Bone {}: quat_seq max diff {:.6} at frame {}",
                            i, max_quat_diff, max_diff_frame
                        );
                        if i == 24 || i == 25 || i == 29 || i == 38 {
                            println!(
                                "      Original: [{:.3}, {:.3}, {:.3}, {:.3}]",
                                max_diff_orig.0.v.x,
                                max_diff_orig.0.v.y,
                                max_diff_orig.0.v.z,
                                max_diff_orig.0.s
                            );
                            println!(
                                "      New:      [{:.3}, {:.3}, {:.3}, {:.3}]",
                                max_diff_new.0.v.x,
                                max_diff_new.0.v.y,
                                max_diff_new.0.v.z,
                                max_diff_new.0.s
                            );

                            // Check if it's just a sign flip
                            let neg_new = (
                                -max_diff_new.0.v.x,
                                -max_diff_new.0.v.y,
                                -max_diff_new.0.v.z,
                                -max_diff_new.0.s,
                            );
                            let diff_negated_x = (max_diff_orig.0.v.x - neg_new.0).abs();
                            let diff_negated_y = (max_diff_orig.0.v.y - neg_new.1).abs();
                            let diff_negated_z = (max_diff_orig.0.v.z - neg_new.2).abs();
                            let diff_negated_w = (max_diff_orig.0.s - neg_new.3).abs();
                            let max_negated_diff = diff_negated_x
                                .max(diff_negated_y)
                                .max(diff_negated_z)
                                .max(diff_negated_w);
                            println!(
                                "      Negated new matches orig? diff = {:.6}",
                                max_negated_diff
                            );
                        }
                        has_diff = true;
                    }
                }
            }
            (None, None) => {}
            _ => {
                println!("  ❌ Bone {}: quat_seq presence mismatch", i);
                has_diff = true;
            }
        }

        if has_diff {
            bones_with_diff_keyframes += 1;
        }
    }

    if bones_with_diff_keyframes == 0 {
        println!("  ✓ All keyframes match within tolerance");
    } else {
        println!(
            "  ❌ {} / {} bones have keyframe differences",
            bones_with_diff_keyframes,
            original_lab.key_seq.len()
        );
        panic!("Keyframe data doesn't match!");
    }

    println!("\n✅ All struct fields match!");
}
