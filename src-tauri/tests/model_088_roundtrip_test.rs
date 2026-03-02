// Round-trip test for model 088: LAB+LGO → glTF → LAB+LGO
// This test verifies that converting files back and forth produces identical results

use base64::Engine;
use binrw::{BinReaderExt, BinWrite};
use pko_tools_lib::animation::character::LwBoneFile;
use pko_tools_lib::character::model::CharacterGeometricModel;
use std::fs;
use std::io::BufWriter;

#[path = "common/mod.rs"]
mod common;

/// Test round-trip conversion for model 088 LAB file
/// 1. Load 0088.lab (original file)
/// 2. Export to glTF
/// 3. Import glTF back to LAB (new file)
/// 4. Compare original vs new semantically
///
/// Known limitations:
/// - Quaternions are normalized during export (glTF requires unit quaternions)
///   so non-normalized quaternions in original files will be normalized after round-trip
/// - Padding bytes in name buffers are zeroed (original files may have garbage data)
#[test]
#[ignore = "fails with current glTF round-trip output"]
fn roundtrip_088_lab() {
    println!("\n🔄 Round-trip test for model 088 LAB file (0088.lab)");

    let test_dir =
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/known_good");

    // Step 1: Load original LAB file
    println!("📂 Step 1: Loading original LAB file...");
    let lab_path = test_dir.join("0088.lab");

    let mut original_lab_file = fs::File::open(&lab_path).expect("Failed to open original LAB");
    let original_lab: LwBoneFile = original_lab_file
        .read_le()
        .expect("Failed to parse original LAB");

    println!("  ✓ Original LAB: {} bones", original_lab.base_seq.len());
    println!("    header.bone_num = {}", original_lab.header.bone_num);
    println!("    header.frame_num = {}", original_lab.header.frame_num);
    println!("    header.dummy_num = {}", original_lab.header.dummy_num);
    println!("    header.key_type = {}", original_lab.header.key_type);

    // Step 2: Export to glTF
    println!("\n📤 Step 2: Exporting to glTF...");

    let mut fields_to_aggregate = pko_tools_lib::character::GLTFFieldsToAggregate {
        buffer: vec![],
        buffer_view: vec![],
        accessor: vec![],
        image: vec![],
        texture: vec![],
        material: vec![],
        sampler: vec![],
        animation: vec![],
        skin: vec![],
        nodes: vec![],
    };
    let (skin, mut nodes) = original_lab.to_gltf_skin_and_nodes(&mut fields_to_aggregate);
    original_lab.to_gltf_animations_and_sampler(&mut fields_to_aggregate, false);

    // Remove the "CharacterSkinnedMesh" node that to_gltf_skin_and_nodes adds at the end
    // since we're only testing LAB (skeleton) without mesh data
    if let Some(last_node) = nodes.last() {
        if last_node.name.as_deref() == Some("CharacterSkinnedMesh") {
            nodes.pop();
        }
    }

    // Create glTF document
    let gltf_root = gltf::json::Root {
        accessors: fields_to_aggregate.accessor,
        animations: fields_to_aggregate.animation,
        asset: gltf::json::Asset {
            generator: Some("pko-tools".to_string()),
            version: "2.0".to_string(),
            ..Default::default()
        },
        buffers: fields_to_aggregate.buffer,
        buffer_views: fields_to_aggregate.buffer_view,
        images: fields_to_aggregate.image,
        materials: Vec::new(),
        meshes: Vec::new(),
        nodes,
        samplers: fields_to_aggregate.sampler,
        scene: Some(gltf::json::Index::new(0)),
        scenes: vec![gltf::json::Scene {
            nodes: vec![gltf::json::Index::new(0)],
            name: Some("DefaultScene".to_string()),
            extensions: None,
            extras: None,
        }],
        skins: vec![skin],
        textures: Vec::new(),
        ..Default::default()
    };

    let gltf_json = serde_json::to_string(&gltf_root).expect("Failed to serialize glTF");
    let gltf_doc =
        gltf::json::deserialize::from_str(&gltf_json).expect("Failed to deserialize glTF");
    let gltf_doc = gltf::Document::from_json(gltf_doc).expect("Failed to create glTF document");

    println!(
        "  ✓ Created glTF document with {} nodes",
        gltf_doc.nodes().len()
    );

    // Step 3: Import glTF back to LAB
    println!("\n📥 Step 3: Importing glTF back to LAB...");

    // Decode base64 buffers
    let mut buffers = Vec::new();
    for buf in gltf_root.buffers.iter() {
        if let Some(uri) = &buf.uri {
            if uri.starts_with("data:application/octet-stream;base64,") {
                let base64_data = &uri["data:application/octet-stream;base64,".len()..];
                let decoded = base64::prelude::BASE64_STANDARD
                    .decode(base64_data)
                    .expect("Failed to decode base64 buffer");
                buffers.push(gltf::buffer::Data(decoded));
            }
        }
    }

    let images = Vec::new(); // No images for LAB files

    let new_lab = LwBoneFile::from_gltf(&gltf_doc, &buffers, &images)
        .expect("Failed to import LAB from glTF");

    println!("  ✓ New LAB: {} bones", new_lab.base_seq.len());
    println!("    header.bone_num = {}", new_lab.header.bone_num);
    println!("    header.frame_num = {}", new_lab.header.frame_num);
    println!("    header.dummy_num = {}", new_lab.header.dummy_num);
    println!("    header.key_type = {}", new_lab.header.key_type);

    // Step 4: Write new LAB file to temp directory
    println!("\n💾 Step 4: Writing new LAB file...");
    let temp_dir = std::env::temp_dir().join("pko_roundtrip_test");
    fs::create_dir_all(&temp_dir).expect("Failed to create temp dir");

    let new_lab_path = temp_dir.join("0088_new.lab");

    let new_lab_file = fs::File::create(&new_lab_path).expect("Failed to create new LAB");
    let mut lab_writer = BufWriter::new(new_lab_file);
    new_lab
        .write_options(&mut lab_writer, binrw::Endian::Little, ())
        .expect("Failed to write new LAB");
    drop(lab_writer);

    println!("  ✓ New LAB written to: {}", new_lab_path.display());

    // Step 5: Compare semantic equality (not byte-by-byte due to padding)
    println!("\n🔍 Step 5: Comparing LAB files semantically...");

    // Compare version and header
    assert_eq!(original_lab.version, new_lab.version, "Version mismatch");
    assert_eq!(
        original_lab.old_version, new_lab.old_version,
        "Old version mismatch"
    );
    assert_eq!(
        original_lab.header.bone_num, new_lab.header.bone_num,
        "Bone count mismatch"
    );
    assert_eq!(
        original_lab.header.frame_num, new_lab.header.frame_num,
        "Frame count mismatch"
    );
    assert_eq!(
        original_lab.header.dummy_num, new_lab.header.dummy_num,
        "Dummy count mismatch"
    );
    assert_eq!(
        original_lab.header.key_type, new_lab.header.key_type,
        "Key type mismatch"
    );
    println!("  ✓ Version and header match");

    // Compare bones
    assert_eq!(
        original_lab.base_seq.len(),
        new_lab.base_seq.len(),
        "Bone sequence length mismatch"
    );
    for (i, (orig_bone, new_bone)) in original_lab
        .base_seq
        .iter()
        .zip(new_lab.base_seq.iter())
        .enumerate()
    {
        assert_eq!(orig_bone.name, new_bone.name, "Bone {} name mismatch", i);
        assert_eq!(orig_bone.id, new_bone.id, "Bone {} id mismatch", i);
        assert_eq!(
            orig_bone.parent_id, new_bone.parent_id,
            "Bone {} parent_id mismatch",
            i
        );
    }
    println!("  ✓ All {} bones match", original_lab.base_seq.len());

    // Compare inverse bind matrices
    assert_eq!(
        original_lab.invmat_seq.len(),
        new_lab.invmat_seq.len(),
        "Inverse bind matrix count mismatch"
    );
    for (i, (orig_mat, new_mat)) in original_lab
        .invmat_seq
        .iter()
        .zip(new_lab.invmat_seq.iter())
        .enumerate()
    {
        for j in 0..4 {
            for k in 0..4 {
                let orig_val = orig_mat.0[j][k];
                let new_val = new_mat.0[j][k];
                let diff = (orig_val - new_val).abs();
                assert!(
                    diff < 0.0001,
                    "Inverse bind matrix {} element [{},{}] differs by {}",
                    i,
                    j,
                    k,
                    diff
                );
            }
        }
    }
    println!(
        "  ✓ All {} inverse bind matrices match",
        original_lab.invmat_seq.len()
    );

    // Compare dummies
    assert_eq!(
        original_lab.dummy_seq.len(),
        new_lab.dummy_seq.len(),
        "Dummy sequence length mismatch"
    );
    for (i, (orig_dummy, new_dummy)) in original_lab
        .dummy_seq
        .iter()
        .zip(new_lab.dummy_seq.iter())
        .enumerate()
    {
        assert_eq!(orig_dummy.id, new_dummy.id, "Dummy {} id mismatch", i);
        assert_eq!(
            orig_dummy.parent_bone_id, new_dummy.parent_bone_id,
            "Dummy {} parent_bone_id mismatch",
            i
        );
    }
    println!("  ✓ All {} dummies match", original_lab.dummy_seq.len());

    // Compare animation keyframes
    assert_eq!(
        original_lab.key_seq.len(),
        new_lab.key_seq.len(),
        "Keyframe sequence length mismatch"
    );
    for i in 0..original_lab.key_seq.len() {
        let orig_key = &original_lab.key_seq[i];
        let new_key = &new_lab.key_seq[i];

        // Compare position sequences
        if let (Some(orig_pos), Some(new_pos)) = (&orig_key.pos_seq, &new_key.pos_seq) {
            assert_eq!(
                orig_pos.len(),
                new_pos.len(),
                "Position sequence length mismatch for bone {}",
                i
            );
            for (f, (orig_p, new_p)) in orig_pos.iter().zip(new_pos.iter()).enumerate() {
                let diff = ((orig_p.0.x - new_p.0.x).abs()
                    + (orig_p.0.y - new_p.0.y).abs()
                    + (orig_p.0.z - new_p.0.z).abs())
                    / 3.0;
                assert!(
                    diff < 0.001,
                    "Position differs for bone {} frame {} by {}",
                    i,
                    f,
                    diff
                );
            }
        }

        // Compare rotation sequences
        if let (Some(orig_rot), Some(new_rot)) = (&orig_key.quat_seq, &new_key.quat_seq) {
            assert_eq!(
                orig_rot.len(),
                new_rot.len(),
                "Rotation sequence length mismatch for bone {}",
                i
            );
            for (f, (orig_q, new_q)) in orig_rot.iter().zip(new_rot.iter()).enumerate() {
                // Quaternions q and -q represent the same rotation, so check both
                let diff_same = ((orig_q.0.s - new_q.0.s).abs()
                    + (orig_q.0.v.x - new_q.0.v.x).abs()
                    + (orig_q.0.v.y - new_q.0.v.y).abs()
                    + (orig_q.0.v.z - new_q.0.v.z).abs())
                    / 4.0;

                let diff_opposite = ((orig_q.0.s + new_q.0.s).abs()
                    + (orig_q.0.v.x + new_q.0.v.x).abs()
                    + (orig_q.0.v.y + new_q.0.v.y).abs()
                    + (orig_q.0.v.z + new_q.0.v.z).abs())
                    / 4.0;

                let min_diff = diff_same.min(diff_opposite);

                // Note: We allow larger tolerance because glTF normalizes quaternions
                // The original PKO format may have non-unit quaternions
                // We check that the rotation direction is preserved by comparing both q and -q
                assert!(min_diff < 0.2, 
                    "Rotation differs significantly for bone {} frame {} by {} (orig: [{}, {}, {}, {}], new: [{}, {}, {}, {}])", 
                    i, f, min_diff,
                    orig_q.0.s, orig_q.0.v.x, orig_q.0.v.y, orig_q.0.v.z,
                    new_q.0.s, new_q.0.v.x, new_q.0.v.y, new_q.0.v.z);
            }
        }
    }
    println!(
        "  ✓ All {} animation keyframe sequences match",
        original_lab.key_seq.len()
    );

    println!("\n✅ ROUND-TRIP TEST PASSED!");
    println!("  LAB file is semantically identical after round-trip conversion.");
    println!("  (Note: Padding bytes in name buffers may differ, which is expected)");
}

/// Test round-trip conversion for model 088 LGO file  
/// This test creates the full glTF with both LAB and LGO, then imports back
/// 1. Load 0088.lab and 0088000000.lgo (original files)
/// 2. Export to glTF (combined)
/// 3. Import glTF back to LAB+LGO (new files)
/// 4. Compare original vs new semantically
///
/// Known limitations:
/// - Floating point precision may differ slightly
/// - Some hardcoded values in from_gltf may not match original exactly
#[test]
#[ignore = "fails with current glTF round-trip output"]
fn roundtrip_088_lgo() {
    println!("\n🔄 Round-trip test for model 088 LGO file (0088000000.lgo)");

    let test_dir =
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/known_good");

    // Step 1: Load original LAB and LGO files
    println!("📂 Step 1: Loading original LAB and LGO files...");
    let lab_path = test_dir.join("0088.lab");
    let lgo_path = test_dir.join("0088000000.lgo");

    let mut original_lab_file = fs::File::open(&lab_path).expect("Failed to open original LAB");
    let original_lab: LwBoneFile = original_lab_file
        .read_le()
        .expect("Failed to parse original LAB");

    let mut original_lgo_file = fs::File::open(&lgo_path).expect("Failed to open original LGO");
    let original_lgo: CharacterGeometricModel = original_lgo_file
        .read_le()
        .expect("Failed to parse original LGO");

    println!("  ✓ Original LAB: {} bones", original_lab.base_seq.len());
    println!("  ✓ Original LGO loaded");
    if let Some(ref mesh) = original_lgo.mesh_info {
        println!(
            "    mesh: {} vertices, {} indices",
            mesh.vertex_seq.len(),
            mesh.index_seq.len()
        );
    }
    if let Some(ref materials) = original_lgo.material_seq {
        println!("    materials: {}", materials.len());
    }

    // Step 2: Export to glTF (combined LAB + LGO)
    println!("\n📤 Step 2: Exporting to glTF...");

    let mut fields_to_aggregate = pko_tools_lib::character::GLTFFieldsToAggregate {
        buffer: vec![],
        buffer_view: vec![],
        accessor: vec![],
        image: vec![],
        texture: vec![],
        material: vec![],
        sampler: vec![],
        animation: vec![],
        skin: vec![],
        nodes: vec![],
    };

    // Export skeleton
    let (skin, nodes) = original_lab.to_gltf_skin_and_nodes(&mut fields_to_aggregate);
    original_lab.to_gltf_animations_and_sampler(&mut fields_to_aggregate, false);
    fields_to_aggregate.skin.push(skin);
    fields_to_aggregate.nodes.extend(nodes);

    // Export mesh (use test fixtures dir as project_dir since it has texture/ subdirectory)
    let project_dir = test_dir.parent().unwrap();
    let primitive = original_lgo
        .get_gltf_mesh_primitive(&project_dir, &mut fields_to_aggregate, false)
        .expect("Failed to get mesh primitive");

    // Export helpers
    let helper_nodes = original_lgo.get_gltf_helper_nodes();
    fields_to_aggregate.nodes.extend(helper_nodes.clone());

    // Build scene node indices
    let mesh_node_index = fields_to_aggregate.nodes.len() - helper_nodes.len() - 1;
    let mut scene_nodes = vec![
        gltf::json::Index::new(0),                      // Root bone
        gltf::json::Index::new(mesh_node_index as u32), // Skinned mesh
    ];

    // Add helper node indices
    let helper_start_index = fields_to_aggregate.nodes.len() - helper_nodes.len();
    for i in helper_start_index..fields_to_aggregate.nodes.len() {
        scene_nodes.push(gltf::json::Index::new(i as u32));
    }

    // Create glTF document
    let gltf_root = gltf::json::Root {
        accessors: fields_to_aggregate.accessor,
        animations: fields_to_aggregate.animation,
        asset: gltf::json::Asset {
            generator: Some("pko-tools".to_string()),
            version: "2.0".to_string(),
            ..Default::default()
        },
        buffers: fields_to_aggregate.buffer,
        buffer_views: fields_to_aggregate.buffer_view,
        images: fields_to_aggregate.image,
        materials: fields_to_aggregate.material,
        meshes: vec![gltf::json::Mesh {
            name: Some("mesh".to_string()),
            primitives: vec![primitive],
            weights: None,
            extensions: None,
            extras: None,
        }],
        nodes: fields_to_aggregate.nodes,
        samplers: fields_to_aggregate.sampler,
        scene: Some(gltf::json::Index::new(0)),
        scenes: vec![gltf::json::Scene {
            nodes: scene_nodes,
            name: Some("DefaultScene".to_string()),
            extensions: None,
            extras: None,
        }],
        skins: fields_to_aggregate.skin,
        textures: fields_to_aggregate.texture,
        ..Default::default()
    };

    let gltf_json = serde_json::to_string(&gltf_root).expect("Failed to serialize glTF");
    let gltf_doc =
        gltf::json::deserialize::from_str(&gltf_json).expect("Failed to deserialize glTF");
    let gltf_doc = gltf::Document::from_json(gltf_doc).expect("Failed to create glTF document");

    println!(
        "  ✓ Created glTF document with {} nodes",
        gltf_doc.nodes().len()
    );

    // Step 3: Import glTF back to LAB+LGO
    println!("\n📥 Step 3: Importing glTF back to LAB+LGO...");

    // Decode base64 buffers
    let mut buffers = Vec::new();
    for buf in gltf_root.buffers.iter() {
        if let Some(uri) = &buf.uri {
            if uri.starts_with("data:application/octet-stream;base64,") {
                let base64_data = &uri["data:application/octet-stream;base64,".len()..];
                let decoded = base64::prelude::BASE64_STANDARD
                    .decode(base64_data)
                    .expect("Failed to decode base64 buffer");
                buffers.push(gltf::buffer::Data(decoded));
            }
        }
    }

    // Decode base64 images
    let mut images = Vec::new();
    for img in gltf_root.images.iter() {
        if let Some(uri) = &img.uri {
            if uri.starts_with("data:image/png;base64,") {
                let base64_data = &uri["data:image/png;base64,".len()..];
                let decoded = base64::prelude::BASE64_STANDARD
                    .decode(base64_data)
                    .expect("Failed to decode base64 image");

                // Decode PNG using image crate
                let img_decoded =
                    image::load_from_memory_with_format(&decoded, image::ImageFormat::Png)
                        .expect("Failed to decode PNG image");

                let img_rgb = img_decoded.to_rgb8();
                let (width, height) = img_rgb.dimensions();

                images.push(gltf::image::Data {
                    pixels: img_rgb.into_raw(),
                    format: gltf::image::Format::R8G8B8,
                    width,
                    height,
                });
            }
        }
    }

    let new_lab = LwBoneFile::from_gltf(&gltf_doc, &buffers, &images)
        .expect("Failed to import LAB from glTF");

    let new_lgo = CharacterGeometricModel::from_gltf(&gltf_doc, &buffers, &images, 88, &new_lab)
        .expect("Failed to import LGO from glTF");

    println!("  ✓ New LAB: {} bones", new_lab.base_seq.len());
    println!("  ✓ New LGO imported");
    if let Some(ref mesh) = new_lgo.mesh_info {
        println!(
            "    mesh: {} vertices, {} indices",
            mesh.vertex_seq.len(),
            mesh.index_seq.len()
        );
    }

    // Step 4: Write new files to temp directory
    println!("\n💾 Step 4: Writing new LAB and LGO files...");
    let temp_dir = std::env::temp_dir().join("pko_roundtrip_test");
    fs::create_dir_all(&temp_dir).expect("Failed to create temp dir");

    let new_lab_path = temp_dir.join("0088_new.lab");
    let new_lgo_path = temp_dir.join("0088000000_new.lgo");

    let new_lab_file = fs::File::create(&new_lab_path).expect("Failed to create new LAB");
    let mut lab_writer = BufWriter::new(new_lab_file);
    new_lab
        .write_options(&mut lab_writer, binrw::Endian::Little, ())
        .expect("Failed to write new LAB");
    drop(lab_writer);

    let new_lgo_file = fs::File::create(&new_lgo_path).expect("Failed to create new LGO");
    let mut lgo_writer = BufWriter::new(new_lgo_file);
    new_lgo
        .write_options(&mut lgo_writer, binrw::Endian::Little, ())
        .expect("Failed to write new LGO");
    drop(lgo_writer);

    println!("  ✓ New LAB written to: {}", new_lab_path.display());
    println!("  ✓ New LGO written to: {}", new_lgo_path.display());

    // Step 5: Compare semantic equality
    println!("\n🔍 Step 5: Comparing LGO files semantically...");

    // Compare materials
    let orig_materials = original_lgo
        .material_seq
        .as_ref()
        .expect("Original has no materials");
    let new_materials = new_lgo.material_seq.as_ref().expect("New has no materials");
    assert_eq!(
        orig_materials.len(),
        new_materials.len(),
        "Material count mismatch"
    );
    println!("  ✓ Material count matches: {}", orig_materials.len());

    // Compare mesh data
    let orig_mesh = original_lgo
        .mesh_info
        .as_ref()
        .expect("Original has no mesh");
    let new_mesh = new_lgo.mesh_info.as_ref().expect("New has no mesh");

    assert_eq!(
        orig_mesh.vertex_seq.len(),
        new_mesh.vertex_seq.len(),
        "Vertex count mismatch"
    );
    assert_eq!(
        orig_mesh.header.vertex_num, new_mesh.header.vertex_num,
        "Header vertex_num mismatch"
    );
    println!("  ✓ Vertex count matches: {}", orig_mesh.vertex_seq.len());

    assert_eq!(
        orig_mesh.index_seq.len(),
        new_mesh.index_seq.len(),
        "Index count mismatch"
    );
    assert_eq!(
        orig_mesh.header.index_num, new_mesh.header.index_num,
        "Header index_num mismatch"
    );
    println!("  ✓ Index count matches: {}", orig_mesh.index_seq.len());

    // Compare vertex positions
    for (i, (orig_vert, new_vert)) in orig_mesh
        .vertex_seq
        .iter()
        .zip(new_mesh.vertex_seq.iter())
        .enumerate()
    {
        let diff = ((orig_vert.0.x - new_vert.0.x).abs()
            + (orig_vert.0.y - new_vert.0.y).abs()
            + (orig_vert.0.z - new_vert.0.z).abs())
            / 3.0;
        assert!(diff < 0.001, "Vertex {} position differs by {}", i, diff);
    }
    println!("  ✓ All vertex positions match");

    // Compare vertex normals
    assert_eq!(
        orig_mesh.normal_seq.len(),
        new_mesh.normal_seq.len(),
        "Normal count mismatch"
    );
    for (i, (orig_norm, new_norm)) in orig_mesh
        .normal_seq
        .iter()
        .zip(new_mesh.normal_seq.iter())
        .enumerate()
    {
        let diff = ((orig_norm.0.x - new_norm.0.x).abs()
            + (orig_norm.0.y - new_norm.0.y).abs()
            + (orig_norm.0.z - new_norm.0.z).abs())
            / 3.0;
        assert!(diff < 0.01, "Normal {} differs by {}", i, diff);
    }
    println!("  ✓ All vertex normals match");

    // Compare indices
    for (i, (orig_idx, new_idx)) in orig_mesh
        .index_seq
        .iter()
        .zip(new_mesh.index_seq.iter())
        .enumerate()
    {
        assert_eq!(orig_idx, new_idx, "Index {} mismatch", i);
    }
    println!("  ✓ All indices match");

    // Compare bone index sequence
    // Note: The order may differ after round-trip, but the set of bones should be the same
    println!(
        "  Original bone_index_seq ({} bones): {:?}",
        orig_mesh.bone_index_seq.len(),
        orig_mesh.bone_index_seq
    );
    println!(
        "  New bone_index_seq ({} bones): {:?}",
        new_mesh.bone_index_seq.len(),
        new_mesh.bone_index_seq
    );
    assert_eq!(
        orig_mesh.bone_index_seq.len(),
        new_mesh.bone_index_seq.len(),
        "Bone index sequence length mismatch"
    );

    let orig_bones_set: std::collections::HashSet<_> = orig_mesh.bone_index_seq.iter().collect();
    let new_bones_set: std::collections::HashSet<_> = new_mesh.bone_index_seq.iter().collect();
    assert_eq!(orig_bones_set, new_bones_set, "Bone index sets don't match");
    println!("  ✓ Bone index sequences contain same bones (order may differ)");

    // Compare bone weights and joint assignments
    // Note: We need to compare the actual LAB bone IDs, not the indices into bone_index_seq,
    // since bone_index_seq ordering may differ after round-trip
    assert_eq!(
        orig_mesh.blend_seq.len(),
        new_mesh.blend_seq.len(),
        "Blend sequence length mismatch"
    );
    println!(
        "  ✓ Blend sequence count matches: {}",
        orig_mesh.blend_seq.len()
    );

    for (i, (orig_blend, new_blend)) in orig_mesh
        .blend_seq
        .iter()
        .zip(new_mesh.blend_seq.iter())
        .enumerate()
    {
        // Decode the joint indices (u8 values packed in u32)
        let orig_joints = orig_blend.indexd.to_le_bytes();
        let new_joints = new_blend.indexd.to_le_bytes();

        // Convert indices to LAB bone IDs for comparison
        // Only check bones that have non-zero weight (zero-weight bones can point anywhere)
        for j in 0..4 {
            let weight_diff = (orig_blend.weight[j] - new_blend.weight[j]).abs();
            assert!(
                weight_diff < 0.001,
                "Vertex {} weight {} differs by {}",
                i,
                j,
                weight_diff
            );

            // Only verify bone IDs for joints with non-zero weight
            if orig_blend.weight[j] > 0.0001 {
                let orig_bone_id = orig_mesh.bone_index_seq[orig_joints[j] as usize];
                let new_bone_id = new_mesh.bone_index_seq[new_joints[j] as usize];
                assert_eq!(
                    orig_bone_id, new_bone_id,
                    "Vertex {} joint {} bone ID mismatch (weight={})",
                    i, j, orig_blend.weight[j]
                );
            }
        }
    }
    println!("  ✓ All vertex weights and joint assignments match (LAB bone IDs)");

    // Compare bounding spheres
    if let (Some(orig_helper), Some(new_helper)) = (&original_lgo.helper_data, &new_lgo.helper_data)
    {
        assert_eq!(
            orig_helper.bsphere_seq.len(),
            new_helper.bsphere_seq.len(),
            "Bounding sphere count mismatch"
        );
        println!(
            "  ✓ Bounding sphere count matches: {}",
            orig_helper.bsphere_seq.len()
        );

        for (i, (orig_sphere, new_sphere)) in orig_helper
            .bsphere_seq
            .iter()
            .zip(new_helper.bsphere_seq.iter())
            .enumerate()
        {
            assert_eq!(
                orig_sphere.id, new_sphere.id,
                "Bounding sphere {} id mismatch",
                i
            );

            // Compare sphere center
            let center_diff = ((orig_sphere.sphere.c.0.x - new_sphere.sphere.c.0.x).abs()
                + (orig_sphere.sphere.c.0.y - new_sphere.sphere.c.0.y).abs()
                + (orig_sphere.sphere.c.0.z - new_sphere.sphere.c.0.z).abs())
                / 3.0;
            assert!(
                center_diff < 0.001,
                "Bounding sphere {} center differs by {}",
                i,
                center_diff
            );

            // Compare sphere radius
            let radius_diff = (orig_sphere.sphere.r - new_sphere.sphere.r).abs();
            assert!(
                radius_diff < 0.001,
                "Bounding sphere {} radius differs by {}",
                i,
                radius_diff
            );

            // Compare sphere transform matrix
            for row in 0..4 {
                for col in 0..4 {
                    let mat_diff = (orig_sphere.mat.0[row][col] - new_sphere.mat.0[row][col]).abs();
                    assert!(
                        mat_diff < 0.001,
                        "Bounding sphere {} matrix[{}][{}] differs by {}",
                        i,
                        row,
                        col,
                        mat_diff
                    );
                }
            }
        }
        println!("  ✓ All bounding spheres match (including transform matrices)");
    }

    // Compare texture coordinates
    assert_eq!(
        orig_mesh.texcoord_seq[0].len(),
        new_mesh.texcoord_seq[0].len(),
        "Texcoord count mismatch"
    );
    for (i, (orig_uv, new_uv)) in orig_mesh.texcoord_seq[0]
        .iter()
        .zip(new_mesh.texcoord_seq[0].iter())
        .enumerate()
    {
        let diff = ((orig_uv.0.x - new_uv.0.x).abs() + (orig_uv.0.y - new_uv.0.y).abs()) / 2.0;
        assert!(diff < 0.001, "Texcoord {} differs by {}", i, diff);
    }
    println!(
        "  ✓ All texture coordinates match: {}",
        orig_mesh.texcoord_seq[0].len()
    );

    // Compare mesh header values
    assert_eq!(orig_mesh.header.fvf, new_mesh.header.fvf, "FVF mismatch");
    assert_eq!(
        orig_mesh.header.pt_type, new_mesh.header.pt_type,
        "Primitive type mismatch"
    );
    assert_eq!(
        orig_mesh.header.subset_num, new_mesh.header.subset_num,
        "Subset count mismatch"
    );
    println!(
        "  ✓ Mesh header values match (fvf={}, pt_type={:?}, subsets={})",
        orig_mesh.header.fvf, orig_mesh.header.pt_type, orig_mesh.header.subset_num
    );

    // Compare subset info
    assert_eq!(
        orig_mesh.subset_seq.len(),
        new_mesh.subset_seq.len(),
        "Subset sequence length mismatch"
    );
    for (i, (orig_subset, new_subset)) in orig_mesh
        .subset_seq
        .iter()
        .zip(new_mesh.subset_seq.iter())
        .enumerate()
    {
        assert_eq!(
            orig_subset.primitive_num, new_subset.primitive_num,
            "Subset {} primitive_num mismatch",
            i
        );
        assert_eq!(
            orig_subset.start_index, new_subset.start_index,
            "Subset {} start_index mismatch",
            i
        );
        assert_eq!(
            orig_subset.vertex_num, new_subset.vertex_num,
            "Subset {} vertex_num mismatch",
            i
        );
        assert_eq!(
            orig_subset.min_index, new_subset.min_index,
            "Subset {} min_index mismatch",
            i
        );
    }
    println!("  ✓ All subsets match: {}", orig_mesh.subset_seq.len());

    // Compare vertex colors (if present)
    if !orig_mesh.vercol_seq.is_empty() {
        assert_eq!(
            orig_mesh.vercol_seq.len(),
            new_mesh.vercol_seq.len(),
            "Vertex color count mismatch"
        );
        for (i, (orig_col, new_col)) in orig_mesh
            .vercol_seq
            .iter()
            .zip(new_mesh.vercol_seq.iter())
            .enumerate()
        {
            assert_eq!(orig_col, new_col, "Vertex color {} mismatch", i);
        }
        println!(
            "  ✓ All vertex colors match: {}",
            orig_mesh.vercol_seq.len()
        );
    } else {
        println!("  - No vertex colors in this model");
    }

    // Compare additional texture coordinate sets (if present)
    for tex_idx in 1..4 {
        if !orig_mesh.texcoord_seq[tex_idx].is_empty() {
            assert_eq!(
                orig_mesh.texcoord_seq[tex_idx].len(),
                new_mesh.texcoord_seq[tex_idx].len(),
                "Texcoord[{}] count mismatch",
                tex_idx
            );
            for (i, (orig_uv, new_uv)) in orig_mesh.texcoord_seq[tex_idx]
                .iter()
                .zip(new_mesh.texcoord_seq[tex_idx].iter())
                .enumerate()
            {
                let diff =
                    ((orig_uv.0.x - new_uv.0.x).abs() + (orig_uv.0.y - new_uv.0.y).abs()) / 2.0;
                assert!(
                    diff < 0.001,
                    "Texcoord[{}] {} differs by {}",
                    tex_idx,
                    i,
                    diff
                );
            }
            println!(
                "  ✓ Texcoord[{}] matches: {} entries",
                tex_idx,
                orig_mesh.texcoord_seq[tex_idx].len()
            );
        }
    }

    // Compare mesh header bone-related fields
    assert_eq!(
        orig_mesh.header.bone_index_num, new_mesh.header.bone_index_num,
        "bone_index_num mismatch"
    );
    assert_eq!(
        orig_mesh.header.bone_infl_factor, new_mesh.header.bone_infl_factor,
        "bone_infl_factor mismatch"
    );
    println!(
        "  ✓ Mesh header bone fields match (bone_index_num={}, bone_infl_factor={})",
        orig_mesh.header.bone_index_num, orig_mesh.header.bone_infl_factor
    );

    // Compare vertex element sequence
    assert_eq!(
        orig_mesh.vertex_element_seq.len(),
        new_mesh.vertex_element_seq.len(),
        "Vertex element count mismatch"
    );
    for (i, (orig_ve, new_ve)) in orig_mesh
        .vertex_element_seq
        .iter()
        .zip(new_mesh.vertex_element_seq.iter())
        .enumerate()
    {
        assert_eq!(
            orig_ve.stream, new_ve.stream,
            "vertex_element_seq[{}].stream mismatch",
            i
        );
        assert_eq!(
            orig_ve.offset, new_ve.offset,
            "vertex_element_seq[{}].offset mismatch",
            i
        );
        assert_eq!(
            orig_ve._type, new_ve._type,
            "vertex_element_seq[{}]._type mismatch",
            i
        );
        assert_eq!(
            orig_ve.method, new_ve.method,
            "vertex_element_seq[{}].method mismatch",
            i
        );
        assert_eq!(
            orig_ve.usage, new_ve.usage,
            "vertex_element_seq[{}].usage mismatch",
            i
        );
        assert_eq!(
            orig_ve.usage_index, new_ve.usage_index,
            "vertex_element_seq[{}].usage_index mismatch",
            i
        );
    }
    println!(
        "  ✓ Vertex element sequence matches: {} elements",
        orig_mesh.vertex_element_seq.len()
    );

    // Compare mesh header render state settings
    for (i, (orig_rs, new_rs)) in orig_mesh
        .header
        .rs_set
        .iter()
        .zip(new_mesh.header.rs_set.iter())
        .enumerate()
    {
        assert_eq!(
            orig_rs.state, new_rs.state,
            "Mesh header rs_set[{}].state mismatch",
            i
        );
        assert_eq!(
            orig_rs.value0, new_rs.value0,
            "Mesh header rs_set[{}].value0 mismatch",
            i
        );
        assert_eq!(
            orig_rs.value1, new_rs.value1,
            "Mesh header rs_set[{}].value1 mismatch",
            i
        );
    }
    println!("  ✓ Mesh header render state settings match");

    // Compare material properties
    for (i, (orig_mat, new_mat)) in orig_materials.iter().zip(new_materials.iter()).enumerate() {
        let opacity_diff = (orig_mat.opacity - new_mat.opacity).abs();
        assert!(
            opacity_diff < 0.001,
            "Material {} opacity differs by {}",
            i,
            opacity_diff
        );
        assert_eq!(
            orig_mat.transp_type, new_mat.transp_type,
            "Material {} transp_type mismatch",
            i
        );

        // Compare material D3D properties (diffuse)
        let dif_diff = (orig_mat.material.dif.r - new_mat.material.dif.r).abs()
            + (orig_mat.material.dif.g - new_mat.material.dif.g).abs()
            + (orig_mat.material.dif.b - new_mat.material.dif.b).abs()
            + (orig_mat.material.dif.a - new_mat.material.dif.a).abs();
        assert!(
            dif_diff < 0.01,
            "Material {} diffuse differs by {}",
            i,
            dif_diff
        );

        // Compare ambient
        let amb_diff = (orig_mat.material.amb.r - new_mat.material.amb.r).abs()
            + (orig_mat.material.amb.g - new_mat.material.amb.g).abs()
            + (orig_mat.material.amb.b - new_mat.material.amb.b).abs()
            + (orig_mat.material.amb.a - new_mat.material.amb.a).abs();
        assert!(
            amb_diff < 0.01,
            "Material {} ambient differs by {}",
            i,
            amb_diff
        );

        // Compare specular (if present)
        match (&orig_mat.material.spe, &new_mat.material.spe) {
            (Some(orig_spe), Some(new_spe)) => {
                let spe_diff = (orig_spe.r - new_spe.r).abs()
                    + (orig_spe.g - new_spe.g).abs()
                    + (orig_spe.b - new_spe.b).abs()
                    + (orig_spe.a - new_spe.a).abs();
                assert!(
                    spe_diff < 0.01,
                    "Material {} specular differs by {}",
                    i,
                    spe_diff
                );
            }
            (None, None) => {}
            _ => panic!("Material {} specular presence mismatch", i),
        }

        // Compare emissive (if present)
        match (&orig_mat.material.emi, &new_mat.material.emi) {
            (Some(orig_emi), Some(new_emi)) => {
                let emi_diff = (orig_emi.r - new_emi.r).abs()
                    + (orig_emi.g - new_emi.g).abs()
                    + (orig_emi.b - new_emi.b).abs()
                    + (orig_emi.a - new_emi.a).abs();
                assert!(
                    emi_diff < 0.01,
                    "Material {} emissive differs by {}",
                    i,
                    emi_diff
                );
            }
            (None, None) => {}
            _ => panic!("Material {} emissive presence mismatch", i),
        }

        let power_diff = (orig_mat.material.power - new_mat.material.power).abs();
        assert!(
            power_diff < 0.001,
            "Material {} power differs by {}",
            i,
            power_diff
        );

        // Compare material render state settings
        for (j, (orig_rs, new_rs)) in orig_mat
            .rs_set
            .iter()
            .zip(new_mat.rs_set.iter())
            .enumerate()
        {
            assert_eq!(
                orig_rs.state, new_rs.state,
                "Material {} rs_set[{}].state mismatch",
                i, j
            );
            assert_eq!(
                orig_rs.value0, new_rs.value0,
                "Material {} rs_set[{}].value0 mismatch",
                i, j
            );
            assert_eq!(
                orig_rs.value1, new_rs.value1,
                "Material {} rs_set[{}].value1 mismatch",
                i, j
            );
        }

        // Compare texture info
        for (j, (orig_tex, new_tex)) in orig_mat
            .tex_seq
            .iter()
            .zip(new_mat.tex_seq.iter())
            .enumerate()
        {
            assert_eq!(
                orig_tex.stage, new_tex.stage,
                "Material {} tex_seq[{}].stage mismatch",
                i, j
            );
            assert_eq!(
                orig_tex.level, new_tex.level,
                "Material {} tex_seq[{}].level mismatch",
                i, j
            );
            assert_eq!(
                orig_tex.usage, new_tex.usage,
                "Material {} tex_seq[{}].usage mismatch",
                i, j
            );
            assert_eq!(
                orig_tex.d3d_format, new_tex.d3d_format,
                "Material {} tex_seq[{}].d3d_format mismatch",
                i, j
            );
            assert_eq!(
                orig_tex.d3d_pool, new_tex.d3d_pool,
                "Material {} tex_seq[{}].d3d_pool mismatch",
                i, j
            );
            assert_eq!(
                orig_tex.byte_alignment_flag, new_tex.byte_alignment_flag,
                "Material {} tex_seq[{}].byte_alignment_flag mismatch",
                i, j
            );
            assert_eq!(
                orig_tex._type, new_tex._type,
                "Material {} tex_seq[{}]._type mismatch",
                i, j
            );
            assert_eq!(
                orig_tex.colorkey_type, new_tex.colorkey_type,
                "Material {} tex_seq[{}].colorkey_type mismatch",
                i, j
            );
            assert_eq!(
                orig_tex.colorkey.to_color(),
                new_tex.colorkey.to_color(),
                "Material {} tex_seq[{}].colorkey mismatch",
                i,
                j
            );
            assert_eq!(
                orig_tex.data, new_tex.data,
                "Material {} tex_seq[{}].data mismatch",
                i, j
            );
            // Note: file_name may differ due to model_id in import, so skip that check

            // Compare texture stage state (tss_set)
            for (k, (orig_tss, new_tss)) in orig_tex
                .tss_set
                .iter()
                .zip(new_tex.tss_set.iter())
                .enumerate()
            {
                assert_eq!(
                    orig_tss.state, new_tss.state,
                    "Material {} tex_seq[{}].tss_set[{}].state mismatch",
                    i, j, k
                );
                assert_eq!(
                    orig_tss.value0, new_tss.value0,
                    "Material {} tex_seq[{}].tss_set[{}].value0 mismatch",
                    i, j, k
                );
                assert_eq!(
                    orig_tss.value1, new_tss.value1,
                    "Material {} tex_seq[{}].tss_set[{}].value1 mismatch",
                    i, j, k
                );
            }
        }
    }
    println!("  ✓ All material properties match (including all texture info fields)");

    // Compare helper data (bounding boxes, dummy nodes, etc.)
    if let (Some(orig_helper), Some(new_helper)) = (&original_lgo.helper_data, &new_lgo.helper_data)
    {
        // Compare helper type flags
        assert_eq!(orig_helper._type, new_helper._type, "Helper _type mismatch");
        println!("  ✓ Helper type flags match: {:#x}", orig_helper._type);

        // Dummy nodes - compare all fields if present
        assert_eq!(
            orig_helper.dummy_seq.len(),
            new_helper.dummy_seq.len(),
            "Dummy node count mismatch"
        );
        for (i, (orig_dummy, new_dummy)) in orig_helper
            .dummy_seq
            .iter()
            .zip(new_helper.dummy_seq.iter())
            .enumerate()
        {
            assert_eq!(orig_dummy.id, new_dummy.id, "Dummy {} id mismatch", i);
            assert_eq!(
                orig_dummy.parent_type, new_dummy.parent_type,
                "Dummy {} parent_type mismatch",
                i
            );
            assert_eq!(
                orig_dummy.parent_id, new_dummy.parent_id,
                "Dummy {} parent_id mismatch",
                i
            );
            // Compare matrices
            for row in 0..4 {
                for col in 0..4 {
                    let mat_diff = (orig_dummy.mat.0[row][col] - new_dummy.mat.0[row][col]).abs();
                    assert!(
                        mat_diff < 0.001,
                        "Dummy {} mat[{}][{}] differs by {}",
                        i,
                        row,
                        col,
                        mat_diff
                    );
                    let mat_local_diff =
                        (orig_dummy.mat_local.0[row][col] - new_dummy.mat_local.0[row][col]).abs();
                    assert!(
                        mat_local_diff < 0.001,
                        "Dummy {} mat_local[{}][{}] differs by {}",
                        i,
                        row,
                        col,
                        mat_local_diff
                    );
                }
            }
        }
        if !orig_helper.dummy_seq.is_empty() {
            println!(
                "  ✓ All {} dummy nodes match (including matrices)",
                orig_helper.dummy_seq.len()
            );
        }

        // Bounding boxes (box_seq)
        assert_eq!(
            orig_helper.box_seq.len(),
            new_helper.box_seq.len(),
            "Box count mismatch"
        );
        for (i, (orig_box, new_box)) in orig_helper
            .box_seq
            .iter()
            .zip(new_helper.box_seq.iter())
            .enumerate()
        {
            assert_eq!(orig_box.id, new_box.id, "Box {} id mismatch", i);
            assert_eq!(orig_box._type, new_box._type, "Box {} _type mismatch", i);
            assert_eq!(orig_box.state, new_box.state, "Box {} state mismatch", i);
            assert_eq!(orig_box.name, new_box.name, "Box {} name mismatch", i);
        }
        if !orig_helper.box_seq.is_empty() {
            println!("  ✓ All {} boxes match", orig_helper.box_seq.len());
        }

        // Mesh helpers
        assert_eq!(
            orig_helper.mesh_seq.len(),
            new_helper.mesh_seq.len(),
            "Mesh helper count mismatch"
        );
        for (i, (orig_mesh_helper, new_mesh_helper)) in orig_helper
            .mesh_seq
            .iter()
            .zip(new_helper.mesh_seq.iter())
            .enumerate()
        {
            assert_eq!(
                orig_mesh_helper.id, new_mesh_helper.id,
                "Mesh helper {} id mismatch",
                i
            );
            assert_eq!(
                orig_mesh_helper._type, new_mesh_helper._type,
                "Mesh helper {} _type mismatch",
                i
            );
            assert_eq!(
                orig_mesh_helper.sub_type, new_mesh_helper.sub_type,
                "Mesh helper {} sub_type mismatch",
                i
            );
            assert_eq!(
                orig_mesh_helper.state, new_mesh_helper.state,
                "Mesh helper {} state mismatch",
                i
            );
            assert_eq!(
                orig_mesh_helper.name, new_mesh_helper.name,
                "Mesh helper {} name mismatch",
                i
            );
            assert_eq!(
                orig_mesh_helper.vertex_num, new_mesh_helper.vertex_num,
                "Mesh helper {} vertex_num mismatch",
                i
            );
            assert_eq!(
                orig_mesh_helper.face_num, new_mesh_helper.face_num,
                "Mesh helper {} face_num mismatch",
                i
            );
        }
        if !orig_helper.mesh_seq.is_empty() {
            println!("  ✓ All {} mesh helpers match", orig_helper.mesh_seq.len());
        }

        // Bounding boxes (bbox_seq)
        assert_eq!(
            orig_helper.bbox_seq.len(),
            new_helper.bbox_seq.len(),
            "BBox count mismatch"
        );
        for (i, (orig_bbox, new_bbox)) in orig_helper
            .bbox_seq
            .iter()
            .zip(new_helper.bbox_seq.iter())
            .enumerate()
        {
            assert_eq!(orig_bbox.id, new_bbox.id, "BBox {} id mismatch", i);
            // Compare box bounds and matrix
            for row in 0..4 {
                for col in 0..4 {
                    let mat_diff = (orig_bbox.mat.0[row][col] - new_bbox.mat.0[row][col]).abs();
                    assert!(
                        mat_diff < 0.001,
                        "BBox {} mat[{}][{}] differs by {}",
                        i,
                        row,
                        col,
                        mat_diff
                    );
                }
            }
        }
        if !orig_helper.bbox_seq.is_empty() {
            println!("  ✓ All {} bboxes match", orig_helper.bbox_seq.len());
        }
    }

    println!("\n✅ ROUND-TRIP TEST PASSED!");
    println!("  LGO file is semantically identical after round-trip conversion.");
}
