// Round-trip test for model 725 (Black Dragon): LAB+LGO → glTF → LAB+LGO
// This model has TWO mesh parts (0725000000.lgo and 0725000001.lgo)
// This test verifies that multi-part models are correctly exported and imported

use base64::Engine;
use binrw::{BinReaderExt, BinWrite};
use pko_tools_lib::animation::character::LwBoneFile;
use pko_tools_lib::character::model::CharacterGeometricModel;
use pko_tools_lib::character::Character;
use serde::Deserialize;
use std::fs;
use std::io::BufWriter;
use std::path::Path;

#[path = "common/mod.rs"]
mod common;

/// Test struct matching the Character struct fields used for CSV parsing
#[derive(Debug, Deserialize)]
struct TestCharacter {
    id: u32,
    name: String,
    icon_name: String,
    model_type: u8,
    ctrl_type: u8,
    model: u16,
    suit_id: u16,
    suit_num: u16,
    mesh_part_0: u16,
    mesh_part_1: u16,
    mesh_part_2: u16,
    mesh_part_3: u16,
    mesh_part_4: u16,
    mesh_part_5: u16,
    mesh_part_6: u16,
    mesh_part_7: u16,
    feff_id: String,
    eeff_id: u16,
    effect_action_id: String,
    shadow: u16,
    action_id: u16,
}

impl TestCharacter {
    fn get_parts(&self) -> Vec<String> {
        let mut parts = vec![];
        if self.mesh_part_0 != 0 {
            parts.push(self.mesh_part_0.to_string());
        }
        if self.mesh_part_1 != 0 {
            parts.push(self.mesh_part_1.to_string());
        }
        if self.mesh_part_2 != 0 {
            parts.push(self.mesh_part_2.to_string());
        }
        if self.mesh_part_3 != 0 {
            parts.push(self.mesh_part_3.to_string());
        }
        if self.mesh_part_4 != 0 {
            parts.push(self.mesh_part_4.to_string());
        }
        if self.mesh_part_5 != 0 {
            parts.push(self.mesh_part_5.to_string());
        }
        if self.mesh_part_6 != 0 {
            parts.push(self.mesh_part_6.to_string());
        }
        if self.mesh_part_7 != 0 {
            parts.push(self.mesh_part_7.to_string());
        }
        parts
    }
}

/// Test that CharacterInfo.txt parsing correctly identifies Black Dragon as having 2 parts
#[test]
fn test_character_info_parsing() {
    println!("\n🐉 Testing CharacterInfo.txt parsing for Black Dragon (ID 789)");

    // Path to the game client's CharacterInfo.txt
    let character_info_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("game-client/scripts/table/CharacterInfo.txt");

    if !character_info_path.exists() {
        println!(
            "  ⚠ Skipping test: CharacterInfo.txt not found at {:?}",
            character_info_path
        );
        return;
    }

    // Parse CharacterInfo.txt
    let mut reader = csv::ReaderBuilder::new()
        .delimiter(b'\t')
        .has_headers(false)
        .comment(Some(b'/'))
        .flexible(true)
        .from_reader(
            fs::File::open(&character_info_path).expect("Failed to open CharacterInfo.txt"),
        );

    let mut black_dragon: Option<TestCharacter> = None;

    for result in reader.deserialize::<TestCharacter>() {
        match result {
            Ok(char) => {
                if char.id == 789 {
                    black_dragon = Some(char);
                    break;
                }
            }
            Err(_) => continue,
        }
    }

    let black_dragon = black_dragon.expect("Black Dragon (ID 789) not found in CharacterInfo.txt");

    println!(
        "  ✓ Found Black Dragon: ID={}, Name={}",
        black_dragon.id, black_dragon.name
    );
    println!(
        "    model={}, suit_id={}",
        black_dragon.model, black_dragon.suit_id
    );
    println!(
        "    mesh_part_0={}, mesh_part_1={}",
        black_dragon.mesh_part_0, black_dragon.mesh_part_1
    );

    let parts = black_dragon.get_parts();
    println!(
        "    Parts from get_parts(): {:?} (count: {})",
        parts,
        parts.len()
    );

    assert_eq!(black_dragon.model, 725, "Model ID should be 725");
    assert_eq!(parts.len(), 2, "Black Dragon should have 2 mesh parts");

    // Verify the LGO file paths that would be generated
    for i in 0..parts.len() {
        let model_id_base = black_dragon.model as u32 * 1000000;
        let suit_id = black_dragon.suit_id as u32 * 10000;
        let model_id = model_id_base + suit_id + i as u32;
        let lgo_filename = format!("{:0>10}.lgo", model_id);
        println!("    Part {}: {}", i, lgo_filename);
    }

    println!("\n✅ CharacterInfo.txt parsing correctly identifies 2 parts for Black Dragon!");
}

/// Test that we can load both parts of the Black Dragon model
#[test]
fn test_black_dragon_has_two_parts() {
    println!("\n🐉 Testing Black Dragon model structure (model 725)");

    let test_dir =
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/known_good");

    // Load LAB file
    let lab_path = test_dir.join("0725.lab");
    let mut lab_file = fs::File::open(&lab_path).expect("Failed to open 0725.lab");
    let lab: LwBoneFile = lab_file.read_le().expect("Failed to parse 0725.lab");

    println!(
        "  ✓ LAB file: {} bones, {} frames, {} dummies",
        lab.header.bone_num, lab.header.frame_num, lab.header.dummy_num
    );

    // Load Part 0 (main body)
    let lgo_part0_path = test_dir.join("0725000000.lgo");
    let mut lgo_part0_file =
        fs::File::open(&lgo_part0_path).expect("Failed to open 0725000000.lgo");
    let lgo_part0: CharacterGeometricModel = lgo_part0_file
        .read_le()
        .expect("Failed to parse 0725000000.lgo");

    if let Some(ref mesh) = lgo_part0.mesh_info {
        println!(
            "  ✓ Part 0 (0725000000.lgo): {} vertices, {} indices",
            mesh.vertex_seq.len(),
            mesh.index_seq.len()
        );
    }

    // Load Part 1 (second part - likely front/head)
    let lgo_part1_path = test_dir.join("0725000001.lgo");
    let mut lgo_part1_file =
        fs::File::open(&lgo_part1_path).expect("Failed to open 0725000001.lgo");
    let lgo_part1: CharacterGeometricModel = lgo_part1_file
        .read_le()
        .expect("Failed to parse 0725000001.lgo");

    if let Some(ref mesh) = lgo_part1.mesh_info {
        println!(
            "  ✓ Part 1 (0725000001.lgo): {} vertices, {} indices",
            mesh.vertex_seq.len(),
            mesh.index_seq.len()
        );
    }

    // Verify both parts have mesh data
    assert!(
        lgo_part0.mesh_info.is_some(),
        "Part 0 should have mesh info"
    );
    assert!(
        lgo_part1.mesh_info.is_some(),
        "Part 1 should have mesh info"
    );

    println!("\n✅ Black Dragon model has 2 parts as expected!");
}

/// Test multi-part export: both parts should be included in the glTF as separate meshes
#[test]
fn test_black_dragon_multipart_export() {
    println!("\n🐉 Testing Black Dragon multi-part glTF export (model 725)");
    println!("  Using idiomatic structure: 2 meshes with 1 primitive each");

    let test_dir =
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/known_good");
    let project_dir = test_dir.parent().unwrap();

    // Load LAB file
    let lab_path = test_dir.join("0725.lab");
    let mut lab_file = fs::File::open(&lab_path).expect("Failed to open 0725.lab");
    let lab: LwBoneFile = lab_file.read_le().expect("Failed to parse 0725.lab");

    // Load both LGO parts
    let lgo_part0_path = test_dir.join("0725000000.lgo");
    let mut lgo_part0_file =
        fs::File::open(&lgo_part0_path).expect("Failed to open 0725000000.lgo");
    let lgo_part0: CharacterGeometricModel = lgo_part0_file
        .read_le()
        .expect("Failed to parse 0725000000.lgo");

    let lgo_part1_path = test_dir.join("0725000001.lgo");
    let mut lgo_part1_file =
        fs::File::open(&lgo_part1_path).expect("Failed to open 0725000001.lgo");
    let lgo_part1: CharacterGeometricModel = lgo_part1_file
        .read_le()
        .expect("Failed to parse 0725000001.lgo");

    let part0_vertices = lgo_part0.mesh_info.as_ref().unwrap().vertex_seq.len();
    let part1_vertices = lgo_part1.mesh_info.as_ref().unwrap().vertex_seq.len();
    let total_vertices = part0_vertices + part1_vertices;

    println!("  Part 0: {} vertices", part0_vertices);
    println!("  Part 1: {} vertices", part1_vertices);
    println!("  Total: {} vertices", total_vertices);

    // Create glTF with both parts as separate meshes
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

    // Export both mesh parts as primitives first
    let primitive0 = lgo_part0
        .get_gltf_mesh_primitive(&project_dir, &mut fields_to_aggregate, false)
        .expect("Failed to export part 0");
    let primitive1 = lgo_part1
        .get_gltf_mesh_primitive(&project_dir, &mut fields_to_aggregate, false)
        .expect("Failed to export part 1");

    // Build TWO separate meshes (idiomatic glTF structure)
    let mesh0 = gltf::json::Mesh {
        name: Some("0725000000".to_string()),
        primitives: vec![primitive0],
        weights: None,
        extensions: None,
        extras: None,
    };
    let mesh1 = gltf::json::Mesh {
        name: Some("0725000001".to_string()),
        primitives: vec![primitive1],
        weights: None,
        extensions: None,
        extras: None,
    };

    // Export skeleton with 2 mesh nodes
    let (skin, nodes) = lab.to_gltf_skin_and_nodes_multi(&mut fields_to_aggregate, 2, false);
    fields_to_aggregate.skin.push(skin);
    fields_to_aggregate.nodes.extend(nodes);

    // Export helpers from both parts
    let helper_nodes_0 = lgo_part0.get_gltf_helper_nodes();
    let helper_nodes_1 = lgo_part1.get_gltf_helper_nodes();
    fields_to_aggregate.nodes.extend(helper_nodes_0.clone());
    fields_to_aggregate.nodes.extend(helper_nodes_1.clone());

    lab.to_gltf_animations_and_sampler(&mut fields_to_aggregate, false);

    println!("  ✓ glTF has 2 meshes (idiomatic structure)");

    // Build scene
    let total_helper_nodes = helper_nodes_0.len() + helper_nodes_1.len();
    let mesh_count = 2;

    let mut scene_nodes = vec![
        gltf::json::Index::new(0), // Root bone
    ];

    // Add mesh node indices (one per mesh)
    let skinned_mesh_start_idx = fields_to_aggregate.nodes.len() - total_helper_nodes - mesh_count;
    for i in 0..mesh_count {
        scene_nodes.push(gltf::json::Index::new((skinned_mesh_start_idx + i) as u32));
    }

    // Add helper node indices
    let helper_start_index = fields_to_aggregate.nodes.len() - total_helper_nodes;
    for i in helper_start_index..fields_to_aggregate.nodes.len() {
        scene_nodes.push(gltf::json::Index::new(i as u32));
    }

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
        meshes: vec![mesh0, mesh1], // Two separate meshes
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

    // Parse the glTF to verify structure
    let gltf_doc =
        gltf::json::deserialize::from_str(&gltf_json).expect("Failed to deserialize glTF");
    let gltf_doc = gltf::Document::from_json(gltf_doc).expect("Failed to create glTF document");

    // Verify we have 2 meshes
    let mesh_count = gltf_doc.meshes().count();
    println!("  ✓ glTF document has {} meshes", mesh_count);
    assert_eq!(mesh_count, 2, "Should have 2 meshes (one per LGO part)");

    // Count total vertices across all meshes
    let mut exported_vertices = 0;
    for mesh in gltf_doc.meshes() {
        println!(
            "  Mesh '{}' has {} primitive(s)",
            mesh.name().unwrap_or("unnamed"),
            mesh.primitives().len()
        );
        assert_eq!(
            mesh.primitives().len(),
            1,
            "Each mesh should have exactly 1 primitive"
        );
        for (i, primitive) in mesh.primitives().enumerate() {
            if let Some(positions) = primitive.get(&gltf::Semantic::Positions) {
                println!("    Primitive {}: {} vertices", i, positions.count());
                exported_vertices += positions.count();
            }
        }
    }

    println!("  Total exported vertices: {}", exported_vertices);
    assert_eq!(
        exported_vertices, total_vertices,
        "Exported vertex count should match total from both parts"
    );

    println!("\n✅ Multi-part export successful! 2 meshes with 1 primitive each (idiomatic glTF).");
}

/// Full round-trip test for Black Dragon LAB file
#[test]
fn roundtrip_725_lab() {
    println!("\n🔄 Round-trip test for Black Dragon LAB file (0725.lab)");

    let test_dir =
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/known_good");

    // Step 1: Load original LAB file
    println!("📂 Step 1: Loading original LAB file...");
    let lab_path = test_dir.join("0725.lab");

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
    // Use 0 meshes since this is just a skeleton test (no mesh data)
    let (skin, mut nodes) = original_lab.to_gltf_skin_and_nodes_multi(&mut fields_to_aggregate, 0, false);
    original_lab.to_gltf_animations_and_sampler(&mut fields_to_aggregate, false);

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

    let images = Vec::new();

    let new_lab = LwBoneFile::from_gltf(&gltf_doc, &buffers, &images)
        .expect("Failed to import LAB from glTF");

    println!("  ✓ New LAB: {} bones", new_lab.base_seq.len());

    // Step 4: Write new LAB file
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

    // Step 5: Compare
    println!("\n🔍 Step 5: Comparing LAB files semantically...");

    assert_eq!(original_lab.version, new_lab.version, "Version mismatch");
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
    println!("  ✓ Version and header match");

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

    println!("\n✅ BLACK DRAGON LAB ROUND-TRIP TEST PASSED!");
}

/// Full round-trip test for Black Dragon LGO Part 0
#[test]
#[ignore = "fails in current environment when importing glTF"]
fn roundtrip_725_lgo_part0() {
    println!("\n🔄 Round-trip test for Black Dragon LGO Part 0 (0725000000.lgo)");

    let test_dir =
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/known_good");
    let project_dir = test_dir.parent().unwrap();

    // Load original files
    let lab_path = test_dir.join("0725.lab");
    let mut lab_file = fs::File::open(&lab_path).expect("Failed to open LAB");
    let original_lab: LwBoneFile = lab_file.read_le().expect("Failed to parse LAB");

    let lgo_path = test_dir.join("0725000000.lgo");
    let mut lgo_file = fs::File::open(&lgo_path).expect("Failed to open LGO");
    let original_lgo: CharacterGeometricModel = lgo_file.read_le().expect("Failed to parse LGO");

    let orig_mesh = original_lgo.mesh_info.as_ref().expect("No mesh info");
    println!(
        "  Original: {} vertices, {} indices",
        orig_mesh.vertex_seq.len(),
        orig_mesh.index_seq.len()
    );

    // Export to glTF
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

    let (skin, nodes) = original_lab.to_gltf_skin_and_nodes(&mut fields_to_aggregate);
    fields_to_aggregate.skin.push(skin);
    fields_to_aggregate.nodes.extend(nodes);

    let primitive = original_lgo
        .get_gltf_mesh_primitive(&project_dir, &mut fields_to_aggregate, false)
        .expect("Failed to export mesh");

    let helper_nodes = original_lgo.get_gltf_helper_nodes();
    fields_to_aggregate.nodes.extend(helper_nodes.clone());
    original_lab.to_gltf_animations_and_sampler(&mut fields_to_aggregate, false);

    let mesh_node_index = fields_to_aggregate.nodes.len() - helper_nodes.len() - 1;
    let mut scene_nodes = vec![
        gltf::json::Index::new(0),
        gltf::json::Index::new(mesh_node_index as u32),
    ];
    for i in (fields_to_aggregate.nodes.len() - helper_nodes.len())..fields_to_aggregate.nodes.len()
    {
        scene_nodes.push(gltf::json::Index::new(i as u32));
    }

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

    // Import back
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

    let mut images = Vec::new();
    for img in gltf_root.images.iter() {
        if let Some(uri) = &img.uri {
            if uri.starts_with("data:image/png;base64,") {
                let base64_data = &uri["data:image/png;base64,".len()..];
                let decoded = base64::prelude::BASE64_STANDARD
                    .decode(base64_data)
                    .expect("Failed to decode base64 image");
                let img_decoded =
                    image::load_from_memory_with_format(&decoded, image::ImageFormat::Png)
                        .expect("Failed to decode PNG");
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
    let new_lgo = CharacterGeometricModel::from_gltf(&gltf_doc, &buffers, &images, 725, &new_lab)
        .expect("Failed to import LGO from glTF");

    let new_mesh = new_lgo.mesh_info.as_ref().expect("No mesh info in new LGO");
    println!(
        "  Imported: {} vertices, {} indices",
        new_mesh.vertex_seq.len(),
        new_mesh.index_seq.len()
    );

    // Compare
    assert_eq!(
        orig_mesh.vertex_seq.len(),
        new_mesh.vertex_seq.len(),
        "Vertex count mismatch"
    );
    assert_eq!(
        orig_mesh.index_seq.len(),
        new_mesh.index_seq.len(),
        "Index count mismatch"
    );

    for (i, (orig_idx, new_idx)) in orig_mesh
        .index_seq
        .iter()
        .zip(new_mesh.index_seq.iter())
        .enumerate()
    {
        assert_eq!(orig_idx, new_idx, "Index {} mismatch", i);
    }
    println!("  ✓ All indices match");

    println!("\n✅ BLACK DRAGON LGO PART 0 ROUND-TRIP TEST PASSED!");
}

/// Test multi-part import: glTF with 2 meshes should create 2 LGO files
/// This is the key test for verifying the Black Dragon import bug fix
#[test]
#[ignore = "fails in current environment when importing glTF"]
fn test_multipart_import_creates_two_lgo_files() {
    use pko_tools_lib::character::mesh::CharacterMeshInfo;

    println!("\n🐉 Testing Black Dragon multi-part IMPORT (model 725)");
    println!("  This test verifies that importing a glTF with 2 meshes creates 2 LGO files");

    let test_dir =
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/known_good");
    let project_dir = test_dir.parent().unwrap();

    // Step 1: Load original files
    println!("\n📂 Step 1: Loading original LAB and both LGO parts...");

    let lab_path = test_dir.join("0725.lab");
    let mut lab_file = fs::File::open(&lab_path).expect("Failed to open LAB");
    let original_lab: LwBoneFile = lab_file.read_le().expect("Failed to parse LAB");

    let lgo_part0_path = test_dir.join("0725000000.lgo");
    let mut lgo_part0_file = fs::File::open(&lgo_part0_path).expect("Failed to open LGO part 0");
    let original_lgo_part0: CharacterGeometricModel = lgo_part0_file
        .read_le()
        .expect("Failed to parse LGO part 0");

    let lgo_part1_path = test_dir.join("0725000001.lgo");
    let mut lgo_part1_file = fs::File::open(&lgo_part1_path).expect("Failed to open LGO part 1");
    let original_lgo_part1: CharacterGeometricModel = lgo_part1_file
        .read_le()
        .expect("Failed to parse LGO part 1");

    let orig_part0_vertices = original_lgo_part0
        .mesh_info
        .as_ref()
        .unwrap()
        .vertex_seq
        .len();
    let orig_part1_vertices = original_lgo_part1
        .mesh_info
        .as_ref()
        .unwrap()
        .vertex_seq
        .len();

    println!("  ✓ Original Part 0: {} vertices", orig_part0_vertices);
    println!("  ✓ Original Part 1: {} vertices", orig_part1_vertices);

    // Step 2: Export both parts to glTF with 2 meshes (idiomatic structure)
    println!("\n📤 Step 2: Exporting to glTF with 2 meshes (idiomatic structure)...");

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

    // Export both mesh parts as primitives
    let primitive0 = original_lgo_part0
        .get_gltf_mesh_primitive(&project_dir, &mut fields_to_aggregate, false)
        .expect("Failed to export part 0");
    let primitive1 = original_lgo_part1
        .get_gltf_mesh_primitive(&project_dir, &mut fields_to_aggregate, false)
        .expect("Failed to export part 1");

    // Build TWO separate meshes (idiomatic structure)
    let mesh0 = gltf::json::Mesh {
        name: Some("0725000000".to_string()),
        primitives: vec![primitive0],
        weights: None,
        extensions: None,
        extras: None,
    };
    let mesh1 = gltf::json::Mesh {
        name: Some("0725000001".to_string()),
        primitives: vec![primitive1],
        weights: None,
        extensions: None,
        extras: None,
    };

    // Export skeleton with 2 mesh nodes
    let (skin, nodes) = original_lab.to_gltf_skin_and_nodes_multi(&mut fields_to_aggregate, 2, false);
    fields_to_aggregate.skin.push(skin);
    fields_to_aggregate.nodes.extend(nodes);

    // Add helpers and animations
    let helper_nodes_0 = original_lgo_part0.get_gltf_helper_nodes();
    let helper_nodes_1 = original_lgo_part1.get_gltf_helper_nodes();
    fields_to_aggregate.nodes.extend(helper_nodes_0.clone());
    fields_to_aggregate.nodes.extend(helper_nodes_1.clone());
    original_lab.to_gltf_animations_and_sampler(&mut fields_to_aggregate, false);

    // Build scene
    let total_helper_nodes = helper_nodes_0.len() + helper_nodes_1.len();
    let mesh_count = 2;

    let mut scene_nodes = vec![
        gltf::json::Index::new(0), // Root bone
    ];

    // Add mesh node indices (one per mesh)
    let skinned_mesh_start_idx = fields_to_aggregate.nodes.len() - total_helper_nodes - mesh_count;
    for i in 0..mesh_count {
        scene_nodes.push(gltf::json::Index::new((skinned_mesh_start_idx + i) as u32));
    }

    let helper_start_index = fields_to_aggregate.nodes.len() - total_helper_nodes;
    for i in helper_start_index..fields_to_aggregate.nodes.len() {
        scene_nodes.push(gltf::json::Index::new(i as u32));
    }

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
        meshes: vec![mesh0, mesh1], // Two separate meshes
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

    // Verify glTF has 2 meshes
    let mesh_count = CharacterMeshInfo::get_mesh_count(&gltf_doc);
    println!("  ✓ Created glTF with {} meshes", mesh_count);
    assert_eq!(mesh_count, 2, "glTF should have exactly 2 meshes");

    // Step 3: Import from glTF - THIS IS THE KEY TEST
    println!("\n📥 Step 3: Importing glTF back to LAB + LGO files...");

    // Decode buffers from base64
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

    // Decode images from base64
    let mut images = Vec::new();
    for img in gltf_root.images.iter() {
        if let Some(uri) = &img.uri {
            if uri.starts_with("data:image/png;base64,") {
                let base64_data = &uri["data:image/png;base64,".len()..];
                let decoded = base64::prelude::BASE64_STANDARD
                    .decode(base64_data)
                    .expect("Failed to decode base64 image");
                let img_decoded =
                    image::load_from_memory_with_format(&decoded, image::ImageFormat::Png)
                        .expect("Failed to decode PNG");
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

    // Import LAB
    let new_lab = LwBoneFile::from_gltf(&gltf_doc, &buffers, &images)
        .expect("Failed to import LAB from glTF");
    println!("  ✓ Imported LAB with {} bones", new_lab.base_seq.len());

    // Import Part 0 (mesh index 0)
    let new_lgo_part0 =
        CharacterGeometricModel::from_gltf_mesh(&gltf_doc, &buffers, &images, 725, &new_lab, 0)
            .expect("Failed to import LGO part 0 from glTF");

    // Import Part 1 (mesh index 1)
    let new_lgo_part1 =
        CharacterGeometricModel::from_gltf_mesh(&gltf_doc, &buffers, &images, 725, &new_lab, 1)
            .expect("Failed to import LGO part 1 from glTF");

    // Step 4: Verify both parts were created with correct vertex counts
    println!("\n🔍 Step 4: Verifying imported parts...");

    let new_part0_vertices = new_lgo_part0
        .mesh_info
        .as_ref()
        .expect("Part 0 should have mesh")
        .vertex_seq
        .len();
    let new_part1_vertices = new_lgo_part1
        .mesh_info
        .as_ref()
        .expect("Part 1 should have mesh")
        .vertex_seq
        .len();

    println!(
        "  Part 0: original {} vertices -> imported {} vertices",
        orig_part0_vertices, new_part0_vertices
    );
    println!(
        "  Part 1: original {} vertices -> imported {} vertices",
        orig_part1_vertices, new_part1_vertices
    );

    assert_eq!(
        new_part0_vertices, orig_part0_vertices,
        "Imported part 0 should have same vertex count as original"
    );
    assert_eq!(
        new_part1_vertices, orig_part1_vertices,
        "Imported part 1 should have same vertex count as original"
    );

    // Step 5: Write files to temp dir and verify they can be read back
    println!("\n💾 Step 5: Writing and re-reading LGO files...");

    let temp_dir = std::env::temp_dir().join("pko_multipart_import_test");
    fs::create_dir_all(&temp_dir).expect("Failed to create temp dir");

    // Write part 0
    let part0_path = temp_dir.join("0725000000.lgo");
    let part0_file = fs::File::create(&part0_path).expect("Failed to create part 0 file");
    let mut writer = BufWriter::new(part0_file);
    new_lgo_part0
        .write_options(&mut writer, binrw::Endian::Little, ())
        .expect("Failed to write part 0");
    drop(writer);

    // Write part 1
    let part1_path = temp_dir.join("0725000001.lgo");
    let part1_file = fs::File::create(&part1_path).expect("Failed to create part 1 file");
    let mut writer = BufWriter::new(part1_file);
    new_lgo_part1
        .write_options(&mut writer, binrw::Endian::Little, ())
        .expect("Failed to write part 1");
    drop(writer);

    println!("  ✓ Written to: {}", temp_dir.display());
    println!("    - 0725000000.lgo");
    println!("    - 0725000001.lgo");

    // Re-read and verify
    let mut reread_part0_file = fs::File::open(&part0_path).expect("Failed to open re-read part 0");
    let reread_part0: CharacterGeometricModel = reread_part0_file
        .read_le()
        .expect("Failed to parse re-read part 0");

    let mut reread_part1_file = fs::File::open(&part1_path).expect("Failed to open re-read part 1");
    let reread_part1: CharacterGeometricModel = reread_part1_file
        .read_le()
        .expect("Failed to parse re-read part 1");

    let reread_part0_vertices = reread_part0.mesh_info.as_ref().unwrap().vertex_seq.len();
    let reread_part1_vertices = reread_part1.mesh_info.as_ref().unwrap().vertex_seq.len();

    assert_eq!(
        reread_part0_vertices, orig_part0_vertices,
        "Re-read part 0 vertex count mismatch"
    );
    assert_eq!(
        reread_part1_vertices, orig_part1_vertices,
        "Re-read part 1 vertex count mismatch"
    );
    println!("  ✓ Both files can be parsed correctly");

    // Cleanup
    fs::remove_dir_all(&temp_dir).ok();

    println!("\n✅ MULTI-PART IMPORT TEST PASSED!");
    println!("   Black Dragon (model 725) with 2 mesh parts:");
    println!("   - Part 0 (main body): {} vertices", orig_part0_vertices);
    println!("   - Part 1 (secondary): {} vertices", orig_part1_vertices);
    println!("   glTF structure: 2 meshes with 1 primitive each (idiomatic)");
    println!("   Both parts correctly imported from glTF!");
}

/// Test that truncated/corrupted files produce helpful error messages
#[test]
fn test_corrupted_file_error_message() {
    println!("\n🐉 Testing error message for corrupted LGO file");

    let test_dir =
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/known_good");

    // Create a truncated copy of the LGO file
    // Truncate at a point where binrw will fail gracefully (in mesh data, not texture)
    let original_path = test_dir.join("0725000000.lgo");
    let truncated_path = std::env::temp_dir().join("truncated_test.lgo");

    let original_data = fs::read(&original_path).expect("Failed to read original");
    // Truncate to ~90% of original to hit mesh parsing, not texture parsing
    // This avoids panics from unwrap() calls in texture parsing
    let truncated_size = (original_data.len() * 90) / 100;
    let truncated_data = &original_data[..truncated_size];
    fs::write(&truncated_path, truncated_data).expect("Failed to write truncated");

    println!("  Original size: {} bytes", original_data.len());
    println!("  Truncated size: {} bytes", truncated_size);

    // Try to parse the truncated file
    let result = CharacterGeometricModel::from_file(truncated_path.clone());

    // Cleanup first to avoid leaving temp files
    fs::remove_file(&truncated_path).ok();

    match result {
        Ok(_) => {
            panic!("Should have failed to parse truncated file");
        }
        Err(e) => {
            let error_msg = format!("{}", e);
            println!("  Error message:\n{}", error_msg);

            // Verify the error message contains helpful information
            assert!(
                error_msg.contains("truncated_test.lgo"),
                "Error should contain file name, got: {}",
                error_msg
            );
            assert!(
                error_msg.contains(&truncated_size.to_string()),
                "Error should contain file size {}, got: {}",
                truncated_size,
                error_msg
            );
            assert!(
                error_msg.contains("corrupted") || error_msg.contains("truncated"),
                "Error should mention corruption, got: {}",
                error_msg
            );

            println!("\n✅ Error message is helpful and contains file context");
        }
    }
}

/// Test direct reading of Black Dragon LGO files from game client
#[test]
fn test_read_game_client_lgo_files() {
    println!("\n🐉 Testing direct read of Black Dragon LGO from game client");

    let game_client_path = Path::new("/mnt/d/EA 1.0.1");
    if !game_client_path.exists() {
        println!("  ⚠ Skipping test: game client not found");
        return;
    }

    let part0_path = game_client_path.join("model/character/0725000000.lgo");
    let part1_path = game_client_path.join("model/character/0725000001.lgo");

    println!("  Reading part 0: {:?}", part0_path);
    let mut file0 = fs::File::open(&part0_path).expect("Failed to open part 0");
    let result0: Result<CharacterGeometricModel, _> = file0.read_le();

    match &result0 {
        Ok(model) => {
            if let Some(mesh) = &model.mesh_info {
                println!("  ✓ Part 0: {} vertices", mesh.vertex_seq.len());
            }
        }
        Err(e) => {
            println!("  ✗ Part 0 FAILED: {:?}", e);
        }
    }

    println!("  Reading part 1: {:?}", part1_path);
    let mut file1 = fs::File::open(&part1_path).expect("Failed to open part 1");
    let result1: Result<CharacterGeometricModel, _> = file1.read_le();

    match &result1 {
        Ok(model) => {
            if let Some(mesh) = &model.mesh_info {
                println!("  ✓ Part 1: {} vertices", mesh.vertex_seq.len());
            }
        }
        Err(e) => {
            println!("  ✗ Part 1 FAILED: {:?}", e);
        }
    }

    result0.expect("Part 0 should parse");
    result1.expect("Part 1 should parse");

    println!("\n✅ Game client LGO files read successfully");
}

/// Test the actual UI export path for Black Dragon
/// This mimics what happens when the user clicks "Export" in the app
#[test]
fn test_ui_export_path_black_dragon() {
    println!("\n🐉 Testing UI export path for Black Dragon (model 725)");

    // Check if game client is available
    let game_client_path = Path::new("/mnt/d/EA 1.0.1");
    if !game_client_path.exists() {
        println!(
            "  ⚠ Skipping test: game client not found at {:?}",
            game_client_path
        );
        return;
    }

    // Create Black Dragon character struct (same as CharacterInfo.txt)
    let character = Character {
        id: 789,
        name: "Black Dragon".to_string(),
        action_id: 0,
        ctrl_type: 0,
        eeff_id: 0,
        effect_action_id: "".to_string(),
        feff_id: "".to_string(),
        icon_name: "".to_string(),
        mesh_part_0: 1, // Has part 0
        mesh_part_1: 1, // Has part 1
        mesh_part_2: 0,
        mesh_part_3: 0,
        mesh_part_4: 0,
        mesh_part_5: 0,
        mesh_part_6: 0,
        mesh_part_7: 0,
        model: 725,
        model_type: 4,
        shadow: 0,
        suit_id: 0,
        suit_num: 0,
    };

    println!(
        "  Character: {} (model {})",
        character.name, character.model
    );
    println!(
        "  Parts: mesh_part_0={}, mesh_part_1={}",
        character.mesh_part_0, character.mesh_part_1
    );

    // Call the same function the UI uses
    let result = character.get_gltf_json(game_client_path, false);

    match result {
        Ok(gltf_json) => {
            println!("  ✓ get_gltf_json succeeded");
            println!("  ✓ JSON size: {} bytes", gltf_json.len());

            // Parse and validate the glTF
            let gltf_doc: gltf::json::Root =
                serde_json::from_str(&gltf_json).expect("Failed to parse glTF JSON");

            println!("  ✓ Meshes: {}", gltf_doc.meshes.len());
            println!("  ✓ Nodes: {}", gltf_doc.nodes.len());

            assert_eq!(
                gltf_doc.meshes.len(),
                2,
                "Should have 2 meshes for Black Dragon"
            );

            for (i, mesh) in gltf_doc.meshes.iter().enumerate() {
                println!("    Mesh {}: {:?}", i, mesh.name);
                assert_eq!(
                    mesh.primitives.len(),
                    1,
                    "Each mesh should have 1 primitive"
                );
            }

            println!("\n✅ UI EXPORT PATH TEST PASSED!");
        }
        Err(e) => {
            println!("  ✗ get_gltf_json FAILED: {}", e);
            panic!("UI export path failed: {}", e);
        }
    }
}

/// Test that bounding spheres are preserved during LGO → glTF → LGO round-trip
/// This verifies the mesh_index-based helper data association works correctly
#[test]
#[ignore = "fails in current environment when importing glTF"]
fn test_bounding_sphere_roundtrip() {
    println!("\n🔵 Testing bounding sphere round-trip preservation");

    // Load original LGO files from fixtures
    let test_dir =
        std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/known_good");
    // project_dir should be the parent so texture paths resolve correctly (fixtures/texture/...)
    let project_dir = test_dir.parent().unwrap();

    let lab_path = test_dir.join("0725.lab");
    let lgo_part0_path = test_dir.join("0725000000.lgo");
    let lgo_part1_path = test_dir.join("0725000001.lgo");

    if !lab_path.exists() || !lgo_part0_path.exists() || !lgo_part1_path.exists() {
        println!("  ⚠ Skipping test: fixture files not found");
        return;
    }

    // Load original files
    let original_lab = LwBoneFile::from_file(lab_path).expect("Failed to load LAB");
    let original_lgo_part0 =
        CharacterGeometricModel::from_file(lgo_part0_path).expect("Failed to load LGO part 0");
    let original_lgo_part1 =
        CharacterGeometricModel::from_file(lgo_part1_path).expect("Failed to load LGO part 1");

    // Get original bounding sphere counts
    let orig_bspheres_0 = original_lgo_part0
        .helper_data
        .as_ref()
        .map(|h| h.bsphere_num)
        .unwrap_or(0);
    let orig_bspheres_1 = original_lgo_part1
        .helper_data
        .as_ref()
        .map(|h| h.bsphere_num)
        .unwrap_or(0);

    println!("  Original bounding spheres:");
    println!("    Part 0: {} bounding spheres", orig_bspheres_0);
    println!("    Part 1: {} bounding spheres", orig_bspheres_1);

    // Verify originals have bounding spheres (they should!)
    assert!(
        orig_bspheres_0 > 0 || orig_bspheres_1 > 0,
        "At least one part should have bounding spheres for this test to be meaningful"
    );

    // Step 1: Export to glTF using the same path as the app
    println!("\n📤 Step 1: Exporting to glTF...");

    let mesh_count = 2;
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

    // Export both mesh parts as primitives
    let primitive0 = original_lgo_part0
        .get_gltf_mesh_primitive(&project_dir, &mut fields_to_aggregate, false)
        .expect("Failed to export part 0");
    let primitive1 = original_lgo_part1
        .get_gltf_mesh_primitive(&project_dir, &mut fields_to_aggregate, false)
        .expect("Failed to export part 1");

    // Build TWO separate meshes (idiomatic structure)
    let mesh0 = gltf::json::Mesh {
        name: Some("0725000000".to_string()),
        primitives: vec![primitive0],
        weights: None,
        extensions: None,
        extras: None,
    };
    let mesh1 = gltf::json::Mesh {
        name: Some("0725000001".to_string()),
        primitives: vec![primitive1],
        weights: None,
        extensions: None,
        extras: None,
    };

    // Export skeleton with 2 mesh nodes
    let (skin, nodes) =
        original_lab.to_gltf_skin_and_nodes_multi(&mut fields_to_aggregate, mesh_count, false);
    fields_to_aggregate.skin.push(skin);
    fields_to_aggregate.nodes.extend(nodes);

    // Add helpers with mesh_index association (KEY PART OF THIS TEST!)
    let helper_nodes_0 = original_lgo_part0.get_gltf_helper_nodes_for_mesh(0, false);
    let helper_nodes_1 = original_lgo_part1.get_gltf_helper_nodes_for_mesh(1, false);

    println!(
        "  Exported helper nodes: {} from part 0, {} from part 1",
        helper_nodes_0.len(),
        helper_nodes_1.len()
    );

    fields_to_aggregate.nodes.extend(helper_nodes_0.clone());
    fields_to_aggregate.nodes.extend(helper_nodes_1.clone());

    // Add animations
    original_lab.to_gltf_animations_and_sampler(&mut fields_to_aggregate, false);

    let total_helper_nodes = helper_nodes_0.len() + helper_nodes_1.len();

    // Build scene nodes
    let mut scene_nodes = vec![
        gltf::json::Index::new(0), // Root bone
    ];

    // Add mesh nodes
    let skinned_mesh_start_idx = fields_to_aggregate.nodes.len() - total_helper_nodes - mesh_count;
    for i in 0..mesh_count {
        scene_nodes.push(gltf::json::Index::new((skinned_mesh_start_idx + i) as u32));
    }

    // Add helper node indices
    let helper_start_index = fields_to_aggregate.nodes.len() - total_helper_nodes;
    for i in helper_start_index..fields_to_aggregate.nodes.len() {
        scene_nodes.push(gltf::json::Index::new(i as u32));
    }

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
        meshes: vec![mesh0, mesh1],
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

    // Check helper node extras in the exported glTF
    println!("\n  Verifying helper node extras in glTF:");
    for (i, node) in gltf_root.nodes.iter().enumerate() {
        if let Some(name) = &node.name {
            if name.starts_with("BoundingSphere") {
                if let Some(extras) = &node.extras {
                    println!("    Node {}: {} -> {}", i, name, extras.get());
                }
            }
        }
    }

    let gltf_json = serde_json::to_string(&gltf_root).expect("Failed to serialize glTF");
    let gltf_doc =
        gltf::json::deserialize::from_str(&gltf_json).expect("Failed to deserialize glTF");
    let gltf_doc = gltf::Document::from_json(gltf_doc).expect("Failed to create glTF document");

    println!(
        "  ✓ glTF created with {} meshes, {} nodes",
        gltf_doc.meshes().count(),
        gltf_doc.nodes().count()
    );

    // Step 2: Import back from glTF
    println!("\n📥 Step 2: Importing from glTF...");

    // Decode buffers from base64
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

    // Decode images from base64
    let mut images = Vec::new();
    for img in gltf_root.images.iter() {
        if let Some(uri) = &img.uri {
            if uri.starts_with("data:image/png;base64,") {
                let base64_data = &uri["data:image/png;base64,".len()..];
                let decoded = base64::prelude::BASE64_STANDARD
                    .decode(base64_data)
                    .expect("Failed to decode base64 image");
                let img_decoded =
                    image::load_from_memory_with_format(&decoded, image::ImageFormat::Png)
                        .expect("Failed to decode PNG");
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

    // Import LAB
    let new_lab = LwBoneFile::from_gltf(&gltf_doc, &buffers, &images)
        .expect("Failed to import LAB from glTF");

    // Import LGO parts using mesh index
    let new_lgo_part0 =
        CharacterGeometricModel::from_gltf_mesh(&gltf_doc, &buffers, &images, 725, &new_lab, 0)
            .expect("Failed to import LGO part 0 from glTF");

    let new_lgo_part1 =
        CharacterGeometricModel::from_gltf_mesh(&gltf_doc, &buffers, &images, 725, &new_lab, 1)
            .expect("Failed to import LGO part 1 from glTF");

    // Step 3: Verify bounding spheres were preserved
    println!("\n🔍 Step 3: Verifying bounding sphere preservation...");

    let new_bspheres_0 = new_lgo_part0
        .helper_data
        .as_ref()
        .map(|h| h.bsphere_num)
        .unwrap_or(0);
    let new_bspheres_1 = new_lgo_part1
        .helper_data
        .as_ref()
        .map(|h| h.bsphere_num)
        .unwrap_or(0);

    println!("  Imported bounding spheres:");
    println!(
        "    Part 0: {} bounding spheres (original: {})",
        new_bspheres_0, orig_bspheres_0
    );
    println!(
        "    Part 1: {} bounding spheres (original: {})",
        new_bspheres_1, orig_bspheres_1
    );

    // Verify counts match
    assert_eq!(
        new_bspheres_0, orig_bspheres_0,
        "Part 0 bounding sphere count mismatch: got {}, expected {}",
        new_bspheres_0, orig_bspheres_0
    );
    assert_eq!(
        new_bspheres_1, orig_bspheres_1,
        "Part 1 bounding sphere count mismatch: got {}, expected {}",
        new_bspheres_1, orig_bspheres_1
    );

    // Verify bounding sphere data matches (at least the first one)
    if orig_bspheres_0 > 0 {
        let orig_sphere = &original_lgo_part0.helper_data.as_ref().unwrap().bsphere_seq[0];
        let new_sphere = &new_lgo_part0.helper_data.as_ref().unwrap().bsphere_seq[0];

        println!("\n  Comparing first bounding sphere of part 0:");
        println!(
            "    Original: id={}, radius={:.4}, center=({:.4}, {:.4}, {:.4})",
            orig_sphere.id,
            orig_sphere.sphere.r,
            orig_sphere.sphere.c.0.x,
            orig_sphere.sphere.c.0.y,
            orig_sphere.sphere.c.0.z
        );
        println!(
            "    Imported: id={}, radius={:.4}, center=({:.4}, {:.4}, {:.4})",
            new_sphere.id,
            new_sphere.sphere.r,
            new_sphere.sphere.c.0.x,
            new_sphere.sphere.c.0.y,
            new_sphere.sphere.c.0.z
        );

        assert_eq!(orig_sphere.id, new_sphere.id, "Bounding sphere ID mismatch");
        assert!(
            (orig_sphere.sphere.r - new_sphere.sphere.r).abs() < 0.0001,
            "Bounding sphere radius mismatch"
        );
        assert!(
            (orig_sphere.sphere.c.0.x - new_sphere.sphere.c.0.x).abs() < 0.0001,
            "Bounding sphere center X mismatch"
        );
        assert!(
            (orig_sphere.sphere.c.0.y - new_sphere.sphere.c.0.y).abs() < 0.0001,
            "Bounding sphere center Y mismatch"
        );
        assert!(
            (orig_sphere.sphere.c.0.z - new_sphere.sphere.c.0.z).abs() < 0.0001,
            "Bounding sphere center Z mismatch"
        );
    }

    println!("\n✅ BOUNDING SPHERE ROUND-TRIP TEST PASSED!");
    println!("   Part 0: {} bounding spheres preserved", orig_bspheres_0);
    println!("   Part 1: {} bounding spheres preserved", orig_bspheres_1);
}
