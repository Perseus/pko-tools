// Round-trip test for model 725 (Black Dragon): LAB+LGO → glTF → LAB+LGO
// This model has TWO mesh parts (0725000000.lgo and 0725000001.lgo)
// This test verifies that multi-part models are correctly exported and imported

use std::fs;
use std::io::BufWriter;
use base64::Engine;
use binrw::{BinReaderExt, BinWrite};
use pko_tools_lib::animation::character::LwBoneFile;
use pko_tools_lib::character::model::CharacterGeometricModel;
use serde::Deserialize;

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
        if self.mesh_part_0 != 0 { parts.push(self.mesh_part_0.to_string()); }
        if self.mesh_part_1 != 0 { parts.push(self.mesh_part_1.to_string()); }
        if self.mesh_part_2 != 0 { parts.push(self.mesh_part_2.to_string()); }
        if self.mesh_part_3 != 0 { parts.push(self.mesh_part_3.to_string()); }
        if self.mesh_part_4 != 0 { parts.push(self.mesh_part_4.to_string()); }
        if self.mesh_part_5 != 0 { parts.push(self.mesh_part_5.to_string()); }
        if self.mesh_part_6 != 0 { parts.push(self.mesh_part_6.to_string()); }
        if self.mesh_part_7 != 0 { parts.push(self.mesh_part_7.to_string()); }
        parts
    }
}

/// Test that CharacterInfo.txt parsing correctly identifies Black Dragon as having 2 parts
#[test]
fn test_character_info_parsing() {
    println!("\n🐉 Testing CharacterInfo.txt parsing for Black Dragon (ID 789)");
    
    // Path to the game client's CharacterInfo.txt
    let character_info_path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent().unwrap()
        .join("game-client/scripts/table/CharacterInfo.txt");
    
    if !character_info_path.exists() {
        println!("  ⚠ Skipping test: CharacterInfo.txt not found at {:?}", character_info_path);
        return;
    }
    
    // Parse CharacterInfo.txt
    let mut reader = csv::ReaderBuilder::new()
        .delimiter(b'\t')
        .has_headers(false)
        .comment(Some(b'/'))
        .flexible(true)
        .from_reader(fs::File::open(&character_info_path).expect("Failed to open CharacterInfo.txt"));
    
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
    
    println!("  ✓ Found Black Dragon: ID={}, Name={}", black_dragon.id, black_dragon.name);
    println!("    model={}, suit_id={}", black_dragon.model, black_dragon.suit_id);
    println!("    mesh_part_0={}, mesh_part_1={}", black_dragon.mesh_part_0, black_dragon.mesh_part_1);
    
    let parts = black_dragon.get_parts();
    println!("    Parts from get_parts(): {:?} (count: {})", parts, parts.len());
    
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
    
    let test_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/known_good");
    
    // Load LAB file
    let lab_path = test_dir.join("0725.lab");
    let mut lab_file = fs::File::open(&lab_path).expect("Failed to open 0725.lab");
    let lab: LwBoneFile = lab_file.read_le().expect("Failed to parse 0725.lab");
    
    println!("  ✓ LAB file: {} bones, {} frames, {} dummies", 
        lab.header.bone_num, lab.header.frame_num, lab.header.dummy_num);
    
    // Load Part 0 (main body)
    let lgo_part0_path = test_dir.join("0725000000.lgo");
    let mut lgo_part0_file = fs::File::open(&lgo_part0_path).expect("Failed to open 0725000000.lgo");
    let lgo_part0: CharacterGeometricModel = lgo_part0_file.read_le().expect("Failed to parse 0725000000.lgo");
    
    if let Some(ref mesh) = lgo_part0.mesh_info {
        println!("  ✓ Part 0 (0725000000.lgo): {} vertices, {} indices", 
            mesh.vertex_seq.len(), mesh.index_seq.len());
    }
    
    // Load Part 1 (second part - likely front/head)
    let lgo_part1_path = test_dir.join("0725000001.lgo");
    let mut lgo_part1_file = fs::File::open(&lgo_part1_path).expect("Failed to open 0725000001.lgo");
    let lgo_part1: CharacterGeometricModel = lgo_part1_file.read_le().expect("Failed to parse 0725000001.lgo");
    
    if let Some(ref mesh) = lgo_part1.mesh_info {
        println!("  ✓ Part 1 (0725000001.lgo): {} vertices, {} indices", 
            mesh.vertex_seq.len(), mesh.index_seq.len());
    }
    
    // Verify both parts have mesh data
    assert!(lgo_part0.mesh_info.is_some(), "Part 0 should have mesh info");
    assert!(lgo_part1.mesh_info.is_some(), "Part 1 should have mesh info");
    
    println!("\n✅ Black Dragon model has 2 parts as expected!");
}

/// Test multi-part export: both parts should be included in the glTF
#[test]
fn test_black_dragon_multipart_export() {
    println!("\n🐉 Testing Black Dragon multi-part glTF export (model 725)");
    
    let test_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/known_good");
    let project_dir = test_dir.parent().unwrap();
    
    // Load LAB file
    let lab_path = test_dir.join("0725.lab");
    let mut lab_file = fs::File::open(&lab_path).expect("Failed to open 0725.lab");
    let lab: LwBoneFile = lab_file.read_le().expect("Failed to parse 0725.lab");
    
    // Load both LGO parts
    let lgo_part0_path = test_dir.join("0725000000.lgo");
    let mut lgo_part0_file = fs::File::open(&lgo_part0_path).expect("Failed to open 0725000000.lgo");
    let lgo_part0: CharacterGeometricModel = lgo_part0_file.read_le().expect("Failed to parse 0725000000.lgo");
    
    let lgo_part1_path = test_dir.join("0725000001.lgo");
    let mut lgo_part1_file = fs::File::open(&lgo_part1_path).expect("Failed to open 0725000001.lgo");
    let lgo_part1: CharacterGeometricModel = lgo_part1_file.read_le().expect("Failed to parse 0725000001.lgo");
    
    let part0_vertices = lgo_part0.mesh_info.as_ref().unwrap().vertex_seq.len();
    let part1_vertices = lgo_part1.mesh_info.as_ref().unwrap().vertex_seq.len();
    let total_vertices = part0_vertices + part1_vertices;
    
    println!("  Part 0: {} vertices", part0_vertices);
    println!("  Part 1: {} vertices", part1_vertices);
    println!("  Total: {} vertices", total_vertices);
    
    // Create glTF with both parts
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
    let (skin, nodes) = lab.to_gltf_skin_and_nodes(&mut fields_to_aggregate);
    fields_to_aggregate.skin.push(skin);
    fields_to_aggregate.nodes.extend(nodes);
    
    // Export both mesh parts
    let primitive0 = lgo_part0.get_gltf_mesh_primitive(&project_dir, &mut fields_to_aggregate)
        .expect("Failed to export part 0");
    let primitive1 = lgo_part1.get_gltf_mesh_primitive(&project_dir, &mut fields_to_aggregate)
        .expect("Failed to export part 1");
    
    // Export helpers from both parts
    let helper_nodes_0 = lgo_part0.get_gltf_helper_nodes();
    let helper_nodes_1 = lgo_part1.get_gltf_helper_nodes();
    fields_to_aggregate.nodes.extend(helper_nodes_0.clone());
    fields_to_aggregate.nodes.extend(helper_nodes_1.clone());
    
    lab.to_gltf_animations_and_sampler(&mut fields_to_aggregate);
    
    // Build mesh with both primitives
    let mesh = gltf::json::Mesh {
        name: Some("mesh".to_string()),
        primitives: vec![primitive0, primitive1],
        weights: None,
        extensions: None,
        extras: None,
    };
    
    println!("  ✓ glTF mesh has {} primitives", mesh.primitives.len());
    assert_eq!(mesh.primitives.len(), 2, "Should have 2 primitives for 2 mesh parts");
    
    // Build scene
    let total_helper_nodes = helper_nodes_0.len() + helper_nodes_1.len();
    let mesh_node_index = fields_to_aggregate.nodes.len() - total_helper_nodes - 1;
    
    let mut scene_nodes = vec![
        gltf::json::Index::new(0),  // Root bone
        gltf::json::Index::new(mesh_node_index as u32),  // Skinned mesh
    ];
    
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
        meshes: vec![mesh],
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
    let gltf_doc = gltf::json::deserialize::from_str(&gltf_json).expect("Failed to deserialize glTF");
    let gltf_doc = gltf::Document::from_json(gltf_doc).expect("Failed to create glTF document");
    
    // Count total vertices across all primitives
    let mut exported_vertices = 0;
    for mesh in gltf_doc.meshes() {
        println!("  Mesh '{}' has {} primitives", mesh.name().unwrap_or("unnamed"), mesh.primitives().len());
        for (i, primitive) in mesh.primitives().enumerate() {
            if let Some(positions) = primitive.get(&gltf::Semantic::Positions) {
                println!("    Primitive {}: {} vertices", i, positions.count());
                exported_vertices += positions.count();
            }
        }
    }
    
    println!("  Total exported vertices: {}", exported_vertices);
    assert_eq!(exported_vertices, total_vertices, 
        "Exported vertex count should match total from both parts");
    
    println!("\n✅ Multi-part export successful! Both parts included in glTF.");
}

/// Full round-trip test for Black Dragon LAB file
#[test]
fn roundtrip_725_lab() {
    println!("\n🔄 Round-trip test for Black Dragon LAB file (0725.lab)");
    
    let test_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/known_good");
    
    // Step 1: Load original LAB file
    println!("📂 Step 1: Loading original LAB file...");
    let lab_path = test_dir.join("0725.lab");
    
    let mut original_lab_file = fs::File::open(&lab_path).expect("Failed to open original LAB");
    let original_lab: LwBoneFile = original_lab_file.read_le().expect("Failed to parse original LAB");
    
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
    original_lab.to_gltf_animations_and_sampler(&mut fields_to_aggregate);
    
    // Remove the "CharacterSkinnedMesh" node
    if let Some(last_node) = nodes.last() {
        if last_node.name.as_deref() == Some("CharacterSkinnedMesh") {
            nodes.pop();
        }
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
    let gltf_doc = gltf::json::deserialize::from_str(&gltf_json).expect("Failed to deserialize glTF");
    let gltf_doc = gltf::Document::from_json(gltf_doc).expect("Failed to create glTF document");
    
    println!("  ✓ Created glTF document with {} nodes", gltf_doc.nodes().len());
    
    // Step 3: Import glTF back to LAB
    println!("\n📥 Step 3: Importing glTF back to LAB...");
    
    let mut buffers = Vec::new();
    for buf in gltf_root.buffers.iter() {
        if let Some(uri) = &buf.uri {
            if uri.starts_with("data:application/octet-stream;base64,") {
                let base64_data = &uri["data:application/octet-stream;base64,".len()..];
                let decoded = base64::prelude::BASE64_STANDARD.decode(base64_data)
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
    new_lab.write_options(&mut lab_writer, binrw::Endian::Little, ()).expect("Failed to write new LAB");
    drop(lab_writer);
    
    println!("  ✓ New LAB written to: {}", new_lab_path.display());
    
    // Step 5: Compare
    println!("\n🔍 Step 5: Comparing LAB files semantically...");
    
    assert_eq!(original_lab.version, new_lab.version, "Version mismatch");
    assert_eq!(original_lab.header.bone_num, new_lab.header.bone_num, "Bone count mismatch");
    assert_eq!(original_lab.header.frame_num, new_lab.header.frame_num, "Frame count mismatch");
    assert_eq!(original_lab.header.dummy_num, new_lab.header.dummy_num, "Dummy count mismatch");
    println!("  ✓ Version and header match");
    
    assert_eq!(original_lab.base_seq.len(), new_lab.base_seq.len(), "Bone sequence length mismatch");
    for (i, (orig_bone, new_bone)) in original_lab.base_seq.iter().zip(new_lab.base_seq.iter()).enumerate() {
        assert_eq!(orig_bone.name, new_bone.name, "Bone {} name mismatch", i);
        assert_eq!(orig_bone.id, new_bone.id, "Bone {} id mismatch", i);
        assert_eq!(orig_bone.parent_id, new_bone.parent_id, "Bone {} parent_id mismatch", i);
    }
    println!("  ✓ All {} bones match", original_lab.base_seq.len());
    
    assert_eq!(original_lab.dummy_seq.len(), new_lab.dummy_seq.len(), "Dummy sequence length mismatch");
    for (i, (orig_dummy, new_dummy)) in original_lab.dummy_seq.iter().zip(new_lab.dummy_seq.iter()).enumerate() {
        assert_eq!(orig_dummy.id, new_dummy.id, "Dummy {} id mismatch", i);
        assert_eq!(orig_dummy.parent_bone_id, new_dummy.parent_bone_id, "Dummy {} parent_bone_id mismatch", i);
    }
    println!("  ✓ All {} dummies match", original_lab.dummy_seq.len());
    
    println!("\n✅ BLACK DRAGON LAB ROUND-TRIP TEST PASSED!");
}

/// Full round-trip test for Black Dragon LGO Part 0
#[test]
fn roundtrip_725_lgo_part0() {
    println!("\n🔄 Round-trip test for Black Dragon LGO Part 0 (0725000000.lgo)");
    
    let test_dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/known_good");
    let project_dir = test_dir.parent().unwrap();
    
    // Load original files
    let lab_path = test_dir.join("0725.lab");
    let mut lab_file = fs::File::open(&lab_path).expect("Failed to open LAB");
    let original_lab: LwBoneFile = lab_file.read_le().expect("Failed to parse LAB");
    
    let lgo_path = test_dir.join("0725000000.lgo");
    let mut lgo_file = fs::File::open(&lgo_path).expect("Failed to open LGO");
    let original_lgo: CharacterGeometricModel = lgo_file.read_le().expect("Failed to parse LGO");
    
    let orig_mesh = original_lgo.mesh_info.as_ref().expect("No mesh info");
    println!("  Original: {} vertices, {} indices", orig_mesh.vertex_seq.len(), orig_mesh.index_seq.len());
    
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
    
    let primitive = original_lgo.get_gltf_mesh_primitive(&project_dir, &mut fields_to_aggregate)
        .expect("Failed to export mesh");
    
    let helper_nodes = original_lgo.get_gltf_helper_nodes();
    fields_to_aggregate.nodes.extend(helper_nodes.clone());
    original_lab.to_gltf_animations_and_sampler(&mut fields_to_aggregate);
    
    let mesh_node_index = fields_to_aggregate.nodes.len() - helper_nodes.len() - 1;
    let mut scene_nodes = vec![
        gltf::json::Index::new(0),
        gltf::json::Index::new(mesh_node_index as u32),
    ];
    for i in (fields_to_aggregate.nodes.len() - helper_nodes.len())..fields_to_aggregate.nodes.len() {
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
    let gltf_doc = gltf::json::deserialize::from_str(&gltf_json).expect("Failed to deserialize glTF");
    let gltf_doc = gltf::Document::from_json(gltf_doc).expect("Failed to create glTF document");
    
    // Import back
    let mut buffers = Vec::new();
    for buf in gltf_root.buffers.iter() {
        if let Some(uri) = &buf.uri {
            if uri.starts_with("data:application/octet-stream;base64,") {
                let base64_data = &uri["data:application/octet-stream;base64,".len()..];
                let decoded = base64::prelude::BASE64_STANDARD.decode(base64_data)
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
                let decoded = base64::prelude::BASE64_STANDARD.decode(base64_data)
                    .expect("Failed to decode base64 image");
                let img_decoded = image::load_from_memory_with_format(&decoded, image::ImageFormat::Png)
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
    println!("  Imported: {} vertices, {} indices", new_mesh.vertex_seq.len(), new_mesh.index_seq.len());
    
    // Compare
    assert_eq!(orig_mesh.vertex_seq.len(), new_mesh.vertex_seq.len(), "Vertex count mismatch");
    assert_eq!(orig_mesh.index_seq.len(), new_mesh.index_seq.len(), "Index count mismatch");
    
    for (i, (orig_idx, new_idx)) in orig_mesh.index_seq.iter().zip(new_mesh.index_seq.iter()).enumerate() {
        assert_eq!(orig_idx, new_idx, "Index {} mismatch", i);
    }
    println!("  ✓ All indices match");
    
    println!("\n✅ BLACK DRAGON LGO PART 0 ROUND-TRIP TEST PASSED!");
}
