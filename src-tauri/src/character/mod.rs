pub mod commands;
pub mod helper;
pub mod info;
pub mod lgo_loader;
pub mod mesh;
pub mod model;
pub mod texture;

use std::{
    fs::File,
    io::BufWriter,
    path::{Path, PathBuf},
};

use ::gltf::{buffer, image, json::Index, Buffer, Document, Gltf};
use binrw::BinWrite;
use info::get_character;
use model::CharacterGeometricModel;
use serde::{Deserialize, Serialize};

use crate::{
    client_paths, db,
    math::coord_transform::CoordTransform,
    projects::{self, project},
};
use gltf::json as gltf;

#[derive(Debug, Serialize, Deserialize)]
pub struct Character {
    pub id: u32,
    pub name: String,
    pub icon_name: String,
    pub model_type: u8,
    pub ctrl_type: u8,
    pub model: u16,
    pub suit_id: u16,
    pub suit_num: u16,
    pub mesh_part_0: u16,
    pub mesh_part_1: u16,
    pub mesh_part_2: u16,
    pub mesh_part_3: u16,
    pub mesh_part_4: u16,
    pub mesh_part_5: u16,
    pub mesh_part_6: u16,
    pub mesh_part_7: u16,
    pub feff_id: String,
    pub eeff_id: u16,
    pub effect_action_id: String,
    pub shadow: u16,
    pub action_id: u16,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CharacterMetadata {
    pub character_id: u32,
    pub character_name: String,
    pub model_id: u16,
    pub animation_id: u16,
    pub bone_count: u32,
    pub frame_count: u32,
    pub dummy_count: u32,
    pub vertex_count: u32,
    pub triangle_count: u32,
    pub material_count: u32,
    /// LGO file IDs for each model part (e.g., ["0725000000", "0725000001"])
    pub model_parts: Vec<String>,
    pub bounding_spheres: u32,
    pub bounding_boxes: u32,
}

pub struct GLTFFieldsToAggregate {
    pub buffer: Vec<gltf::Buffer>,
    pub buffer_view: Vec<gltf::buffer::View>,
    pub accessor: Vec<gltf::Accessor>,
    pub image: Vec<gltf::Image>,
    pub texture: Vec<gltf::Texture>,
    pub material: Vec<gltf::Material>,
    pub sampler: Vec<gltf::texture::Sampler>,
    pub animation: Vec<gltf::Animation>,
    pub skin: Vec<gltf::Skin>,
    pub nodes: Vec<gltf::Node>,
}

impl Character {
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

    fn model_file_id(&self, part: u32) -> Option<u32> {
        (self.model as u32)
            .checked_mul(1_000_000)?
            .checked_add((self.suit_id as u32).checked_mul(10_000)?)?
            .checked_add(part)
    }

    fn model_file_path(project_dir: &Path, model_id: u32) -> PathBuf {
        client_paths::asset_file(
            project_dir,
            "model",
            Path::new("character").join(format!("{:0>10}.lgo", model_id)),
        )
    }

    fn action_variant_part_group(&self, discovered: &[(u32, PathBuf)]) -> Vec<(u32, PathBuf)> {
        let action_variant = self.action_id % 100;
        if action_variant == 0 {
            return Vec::new();
        }

        discovered
            .iter()
            .filter(|(id, _)| {
                let part = id % 10_000;
                part / 100 == action_variant as u32
            })
            .cloned()
            .collect()
    }

    fn animation_id(&self, project_dir: &Path) -> u16 {
        let model_animation =
            client_paths::asset_file(project_dir, "animation", format!("{:0>4}.lab", self.model));
        if model_animation.exists() || self.action_id == 0 {
            return self.model;
        }

        let action_animation = client_paths::asset_file(
            project_dir,
            "animation",
            format!("{:0>4}.lab", self.action_id),
        );
        if action_animation.exists() {
            self.action_id
        } else {
            self.model
        }
    }

    fn animation_file_path(&self, project_dir: &Path) -> PathBuf {
        client_paths::asset_file(
            project_dir,
            "animation",
            format!("{:0>4}.lab", self.animation_id(project_dir)),
        )
    }

    fn resolve_model_parts(&self, project_dir: &Path) -> Vec<(u32, PathBuf)> {
        let parts = self.get_parts();
        let mut resolved = Vec::new();

        for (i, part) in parts.iter().enumerate() {
            let Some(index_id) = self.model_file_id(i as u32) else {
                continue;
            };
            let index_path = Self::model_file_path(project_dir, index_id);
            if index_path.exists() {
                resolved.push((index_id, index_path));
                continue;
            }

            let parsed_part = part.parse::<u32>().unwrap_or(i as u32);
            if let Some(part_id) = self.model_file_id(parsed_part) {
                let part_path = Self::model_file_path(project_dir, part_id);
                if part_path.exists() {
                    resolved.push((part_id, part_path));
                } else {
                    resolved.push((index_id, index_path));
                }
            } else {
                resolved.push((index_id, index_path));
            }
        }

        if resolved.iter().any(|(_, path)| path.exists()) {
            return resolved;
        }

        let character_dir = client_paths::asset_file(project_dir, "model", "character");
        let mut prefixes = Vec::new();
        if let Some(indexed_id) = self.model_file_id(0) {
            prefixes.push(
                format!("{:0>10}", indexed_id)
                    .chars()
                    .take(6)
                    .collect::<String>(),
            );
        }
        prefixes.push(format!("{:0>4}{:0>4}", self.model, self.suit_id));
        prefixes.push(format!("{:0>4}{:0>2}", self.model, self.suit_id));
        let mut discovered: Vec<(u32, PathBuf)> = std::fs::read_dir(character_dir)
            .ok()
            .into_iter()
            .flat_map(|entries| entries.filter_map(Result::ok))
            .filter_map(|entry| {
                let path = entry.path();
                let stem = path.file_stem()?.to_str()?;
                if !prefixes.iter().any(|prefix| stem.starts_with(prefix)) {
                    return None;
                }
                let id = stem.parse::<u32>().ok()?;
                Some((id, path))
            })
            .collect();
        discovered.sort_by_key(|(id, _)| *id);
        let action_variant_parts = self.action_variant_part_group(&discovered);
        if !action_variant_parts.is_empty() {
            return action_variant_parts;
        }
        discovered
    }

    pub fn get_metadata(&self, project_dir: &Path) -> anyhow::Result<CharacterMetadata> {
        let model_parts_with_paths = self.resolve_model_parts(project_dir);
        let model_locations: Vec<String> = model_parts_with_paths
            .iter()
            .map(|(_, path)| path.to_string_lossy().to_string())
            .collect();

        let models: Vec<model::CharacterGeometricModel> = model_locations
            .iter()
            .map(|location| model::CharacterGeometricModel::from_file(PathBuf::from(location)))
            .collect::<anyhow::Result<Vec<_>>>()?;
        let animation = super::animation::character::LwBoneFile::from_file(
            self.animation_file_path(project_dir),
        )?;

        // Calculate metadata
        let bone_count = animation.header.bone_num;
        let frame_count = animation.header.frame_num;
        let dummy_count = animation.header.dummy_num;

        let mut total_vertices = 0u32;
        let mut total_triangles = 0u32;
        let mut total_materials = 0u32;
        let mut total_bspheres = 0u32;
        let mut total_bboxes = 0u32;

        for model in &models {
            if let Some(ref mesh_info) = model.mesh_info {
                total_vertices += mesh_info.header.vertex_num;
                // Calculate triangles based on indices
                total_triangles += mesh_info.header.index_num / 3;
            }

            if let Some(ref material_seq) = model.material_seq {
                total_materials += material_seq.len() as u32;
            }

            if let Some(ref helper_data) = model.helper_data {
                total_bspheres += helper_data.bsphere_num;
                total_bboxes += helper_data.bbox_num;
            }
        }

        // Generate LGO file IDs for each part (e.g., "0725000000", "0725000001")
        let model_parts: Vec<String> = model_parts_with_paths
            .iter()
            .map(|(model_id, _)| format!("{:0>10}", model_id))
            .collect();

        Ok(CharacterMetadata {
            character_id: self.id,
            character_name: self.name.clone(),
            model_id: self.model,
            animation_id: self.animation_id(project_dir),
            bone_count,
            frame_count,
            dummy_count,
            vertex_count: total_vertices,
            triangle_count: total_triangles,
            material_count: total_materials,
            model_parts,
            bounding_spheres: total_bspheres,
            bounding_boxes: total_bboxes,
        })
    }

    pub fn get_gltf_json(
        &self,
        project_dir: &Path,
        ct: Option<&CoordTransform>,
    ) -> anyhow::Result<String> {
        self.get_gltf_json_with_split(project_dir, ct, true)
    }

    pub fn get_gltf_json_with_split(
        &self,
        project_dir: &Path,
        ct: Option<&CoordTransform>,
        split_animations: bool,
    ) -> anyhow::Result<String> {
        let model_parts_with_paths = self.resolve_model_parts(project_dir);
        let model_locations: Vec<String> = model_parts_with_paths
            .iter()
            .map(|(_, path)| path.to_string_lossy().to_string())
            .collect();

        let models: Vec<model::CharacterGeometricModel> = model_locations
            .iter()
            .map(|location| model::CharacterGeometricModel::from_file(PathBuf::from(location)))
            .collect::<anyhow::Result<Vec<_>>>()?;
        let animation = super::animation::character::LwBoneFile::from_file(
            self.animation_file_path(project_dir),
        )
        .ok();

        let mut fields_to_aggregate = GLTFFieldsToAggregate {
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

        // Create one mesh per LGO part (more idiomatic glTF structure)
        // Each mesh has one primitive and is named after the LGO file
        let mut meshes: Vec<gltf::Mesh> = vec![];
        for (i, model) in models.iter().enumerate() {
            let primitive =
                model.get_gltf_mesh_primitive(project_dir, &mut fields_to_aggregate, ct)?;
            let model_id = model_parts_with_paths
                .get(i)
                .map(|(id, _)| *id)
                .or_else(|| self.model_file_id(i as u32))
                .unwrap_or(i as u32);
            let mesh_name = format!("{:0>10}", model_id);

            meshes.push(gltf::Mesh {
                name: Some(mesh_name),
                primitives: vec![primitive],
                weights: None,
                extensions: None,
                extras: None,
            });
        }

        let mesh_count = meshes.len();
        let mut scene_nodes = Vec::new();

        if let Some(animation) = animation.as_ref() {
            let (skin, nodes) =
                animation.to_gltf_skin_and_nodes_multi(&mut fields_to_aggregate, mesh_count, ct);
            fields_to_aggregate.skin.push(skin);
            fields_to_aggregate.nodes.extend(nodes);

            // Build scene node indices: root bone plus skinned mesh nodes.
            scene_nodes.push(Index::new(0));
            let skinned_mesh_start_idx = fields_to_aggregate.nodes.len() - mesh_count;
            for i in 0..mesh_count {
                scene_nodes.push(Index::new((skinned_mesh_start_idx + i) as u32));
            }

            // Try to load action table + pose table for split animations.
            // PKO clients use CharacterAction.tx keyed by CharacterInfo action_id;
            // Demon clients use CharacterActionInfo.bin keyed by character row id.
            let action_table_path =
                client_paths::script_txt_file(project_dir, "CharacterAction.tx");
            let action_info_path = client_paths::table_file(project_dir, "CharacterActionInfo.bin");
            let poseinfo_path = client_paths::table_file(project_dir, "characterposeinfo.bin");

            if split_animations
                && poseinfo_path.exists()
                && (action_table_path.exists() || action_info_path.exists())
            {
                let (action_table, lookup_id) = if action_table_path.exists() {
                    (
                        super::animation::action_table::load_action_table(&action_table_path)?,
                        self.action_id,
                    )
                } else {
                    (
                        super::animation::action_table::load_action_info_bin(&action_info_path)?,
                        self.id as u16,
                    )
                };
                let pose_table = super::animation::pose_info::load_poseinfo(&poseinfo_path)?;

                if let Some(actions) = action_table.get(&lookup_id) {
                    animation.to_gltf_animations_split(
                        &mut fields_to_aggregate,
                        actions,
                        Some(&pose_table),
                        ct,
                    );
                } else {
                    // No actions for this char type — fall back to single animation
                    animation.to_gltf_animations_and_sampler(&mut fields_to_aggregate, ct);
                }
            } else {
                animation.to_gltf_animations_and_sampler(&mut fields_to_aggregate, ct);
            }
        } else {
            for (i, mesh) in meshes.iter().enumerate() {
                let node_index = fields_to_aggregate.nodes.len();
                fields_to_aggregate.nodes.push(gltf::Node {
                    camera: None,
                    children: None,
                    extensions: None,
                    matrix: None,
                    mesh: Some(Index::new(i as u32)),
                    name: mesh.name.clone(),
                    rotation: None,
                    scale: None,
                    skin: None,
                    translation: None,
                    weights: None,
                    extras: None,
                });
                scene_nodes.push(Index::new(node_index as u32));
            }
        }

        let helpers: Vec<Vec<gltf::Node>> = models
            .iter()
            .enumerate()
            .map(|(i, model)| model.get_gltf_helper_nodes_for_mesh(i, ct))
            .collect();
        for helper_nodes in helpers {
            for node in helper_nodes {
                let node_index = fields_to_aggregate.nodes.len();
                fields_to_aggregate.nodes.push(node);
                scene_nodes.push(Index::new(node_index as u32));
            }
        }

        let scene = gltf::Scene {
            nodes: scene_nodes,
            name: Some("DefaultScene".to_string()),
            extensions: None,
            extras: None,
        };

        let gltf = gltf::Root {
            nodes: fields_to_aggregate.nodes,
            skins: fields_to_aggregate.skin,
            scenes: vec![scene],
            images: fields_to_aggregate.image,
            scene: Some(Index::new(0)),
            accessors: fields_to_aggregate.accessor,
            buffers: fields_to_aggregate.buffer,
            buffer_views: fields_to_aggregate.buffer_view,
            meshes,
            textures: fields_to_aggregate.texture,
            materials: fields_to_aggregate.material,
            samplers: fields_to_aggregate.sampler,
            animations: fields_to_aggregate.animation,
            ..Default::default()
        };

        let gltf_as_string = serde_json::to_string(&gltf)?;
        Ok(gltf_as_string)
    }

    pub fn from_gltf(
        gltf: Document,
        buffers: Vec<buffer::Data>,
        images: Vec<image::Data>,
    ) -> anyhow::Result<Self> {
        let animation_data =
            super::animation::character::LwBoneFile::from_gltf(&gltf, &buffers, &images)?;
        let file = File::create("./test_artifacts/test.lab")?;
        let mut writer = BufWriter::new(file);
        animation_data.write_options(&mut writer, binrw::Endian::Little, ())?;

        let mesh_data =
            CharacterGeometricModel::from_gltf(&gltf, &buffers, &images, 1, &animation_data)?;
        let file = File::create("./test_artifacts/test.lgo")?;
        let mut writer = BufWriter::new(file);
        mesh_data.write_options(&mut writer, binrw::Endian::Little, ())?;

        unimplemented!()
    }

    pub fn import_gltf_with_char_id(
        gltf: Document,
        buffers: Vec<buffer::Data>,
        images: Vec<image::Data>,
        model_id: u32,
    ) -> anyhow::Result<(String, String)> {
        let animation_data =
            super::animation::character::LwBoneFile::from_gltf(&gltf, &buffers, &images)?;

        // Count meshes in the glTF - each mesh becomes a separate LGO file
        let mesh_count = mesh::CharacterMeshInfo::get_mesh_count(&gltf);

        let animation_file_name = format!("{:0>4}.lab", model_id);

        // Write animation file
        let file = File::create(format!(
            "./imports/character/animation/{}",
            animation_file_name
        ))?;
        let mut writer = BufWriter::new(file);
        animation_data.write_options(&mut writer, binrw::Endian::Little, ())?;

        // Write each mesh as a separate LGO file
        let mut mesh_file_names = Vec::new();
        for mesh_idx in 0..mesh_count {
            let mesh_data = CharacterGeometricModel::from_gltf_mesh(
                &gltf,
                &buffers,
                &images,
                model_id,
                &animation_data,
                mesh_idx,
            )?;

            // File naming: model_id * 1000000 + mesh_idx
            // e.g., model 725: 0725000000.lgo, 0725000001.lgo
            let mesh_file_name = format!("{:0>10}.lgo", model_id * 1000000 + mesh_idx as u32);

            let file = File::create(format!("./imports/character/model/{}", mesh_file_name))?;
            let mut writer = BufWriter::new(file);
            mesh_data.write_options(&mut writer, binrw::Endian::Little, ())?;

            mesh_file_names.push(mesh_file_name);
        }

        // Return the first mesh file name for backwards compatibility
        let mesh_file_name = mesh_file_names
            .first()
            .cloned()
            .unwrap_or_else(|| format!("{:0>10}.lgo", model_id * 1000000));

        Ok((animation_file_name, mesh_file_name))
    }

    /// Import a glTF file and return detailed results including all generated files
    pub fn import_gltf_with_char_id_detailed(
        gltf: Document,
        buffers: Vec<buffer::Data>,
        images: Vec<image::Data>,
        model_id: u32,
    ) -> anyhow::Result<ImportResult> {
        let animation_data =
            super::animation::character::LwBoneFile::from_gltf(&gltf, &buffers, &images)?;

        // Count meshes in the glTF - each mesh becomes a separate LGO file
        let mesh_count = mesh::CharacterMeshInfo::get_mesh_count(&gltf);

        let animation_file_name = format!("{:0>4}.lab", model_id);

        // Write animation file
        let file = File::create(format!(
            "./imports/character/animation/{}",
            animation_file_name
        ))?;
        let mut writer = BufWriter::new(file);
        animation_data.write_options(&mut writer, binrw::Endian::Little, ())?;

        // Write each mesh as a separate LGO file
        let mut mesh_file_names = Vec::new();
        for mesh_idx in 0..mesh_count {
            let mesh_data = CharacterGeometricModel::from_gltf_mesh(
                &gltf,
                &buffers,
                &images,
                model_id,
                &animation_data,
                mesh_idx,
            )?;

            let mesh_file_name = format!("{:0>10}.lgo", model_id * 1000000 + mesh_idx as u32);

            let file = File::create(format!("./imports/character/model/{}", mesh_file_name))?;
            let mut writer = BufWriter::new(file);
            mesh_data.write_options(&mut writer, binrw::Endian::Little, ())?;

            mesh_file_names.push(mesh_file_name);
        }

        Ok(ImportResult {
            animation_file: animation_file_name,
            mesh_files: mesh_file_names,
            mesh_count,
        })
    }
}

/// Result of importing a glTF file
#[derive(Debug)]
pub struct ImportResult {
    pub animation_file: String,
    pub mesh_files: Vec<String>,
    pub mesh_count: usize,
}

pub fn get_character_gltf_json(
    project_id: uuid::Uuid,
    character_id: u32,
) -> anyhow::Result<String> {
    // Viewer path: single monolithic animation (fast), action picker uses frame ranges
    // StandardGltf converts Z-up to Y-up. The Three.js viewer no longer applies its
    // own -90° X rotation — the data arrives in Y-up and is rendered directly.
    let project = projects::project::Project::get_project(project_id)?;
    let character = get_character(project_id, character_id)?;
    let project_dir = project.project_directory.as_ref();
    let ct = CoordTransform::new();
    character.get_gltf_json_with_split(project_dir, Some(&ct), false)
}

pub fn get_character_gltf_json_with_options(
    project_id: uuid::Uuid,
    character_id: u32,
    y_up: bool,
) -> anyhow::Result<String> {
    // Export path: split animations for Unity import
    let project = projects::project::Project::get_project(project_id)?;
    let character = get_character(project_id, character_id)?;
    let project_dir = project.project_directory.as_ref();
    let ct = if y_up {
        Some(CoordTransform::new())
    } else {
        None
    };
    character.get_gltf_json_with_split(project_dir, ct.as_ref(), true)
}

pub fn get_character_metadata(
    project_id: uuid::Uuid,
    character_id: u32,
) -> anyhow::Result<CharacterMetadata> {
    let project = projects::project::Project::get_project(project_id)?;
    let character = get_character(project_id, character_id)?;

    let project_dir = project.project_directory.as_ref();

    let metadata = character.get_metadata(project_dir)?;
    Ok(metadata)
}

#[cfg(test)]
mod test {
    use std::{io::Write, thread};

    use ::gltf::{import, Gltf};

    use super::*;

    #[test]
    #[ignore = "relies on local test_artifacts/test.gltf"]
    fn is_able_to_parse_gltf() {
        let (gltf, buffers, images) = import(PathBuf::from("./test_artifacts/test.gltf")).unwrap();
        let character = Character::from_gltf(gltf, buffers, images).unwrap();
        println!("{:?}", character);
    }

    #[test]
    #[ignore = "relies on external EA 1.0.1 path"]
    fn is_able_to_convert_lab_back_to_gltf() {
        let character = Character {
            id: 958,
            name: "Balasteer the Wicked".to_string(),
            action_id: 0,
            ctrl_type: 0,
            eeff_id: 0,
            effect_action_id: "".to_string(),
            feff_id: "".to_string(),
            icon_name: "".to_string(),
            mesh_part_0: 1,
            mesh_part_1: 0,
            mesh_part_2: 0,
            mesh_part_3: 0,
            mesh_part_4: 0,
            mesh_part_5: 0,
            mesh_part_6: 0,
            mesh_part_7: 0,
            model: 201,
            model_type: 4,
            shadow: 0,
            suit_id: 0,
            suit_num: 0,
        };

        let gltf = character.get_gltf_json(Path::new("/mnt/d/EA 1.0.1"), None);
        let mut file = File::create("./test_artifacts/test.gltf").unwrap();
        file.write_all(gltf.unwrap().as_bytes()).unwrap();
    }

    #[test]
    fn resolves_demon_character_part_filename_pattern() {
        let root = std::env::temp_dir().join(format!(
            "pko_tools_demon_character_parts_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let character_dir = root.join("Data").join("model").join("character");
        std::fs::create_dir_all(&character_dir).unwrap();
        std::fs::write(character_dir.join("3001000100.lgo"), []).unwrap();
        std::fs::write(character_dir.join("3001000101.lgo"), []).unwrap();

        let character = Character {
            id: 1,
            name: "Demon".to_string(),
            action_id: 0,
            ctrl_type: 0,
            eeff_id: 0,
            effect_action_id: String::new(),
            feff_id: String::new(),
            icon_name: String::new(),
            mesh_part_0: 100,
            mesh_part_1: 0,
            mesh_part_2: 0,
            mesh_part_3: 0,
            mesh_part_4: 0,
            mesh_part_5: 0,
            mesh_part_6: 0,
            mesh_part_7: 0,
            model: 3001,
            model_type: 1,
            shadow: 0,
            suit_id: 1,
            suit_num: 1,
        };

        let parts = character.resolve_model_parts(&root);
        let ids: Vec<u32> = parts.iter().map(|(id, _)| *id).collect();
        assert_eq!(ids, vec![3001000100, 3001000101]);

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn resolves_demon_character_parts_by_geometry_prefix() {
        let root = std::env::temp_dir().join(format!(
            "pko_tools_demon_character_prefix_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let character_dir = root.join("Data").join("model").join("character");
        let animation_dir = root.join("Data").join("animation");
        std::fs::create_dir_all(&character_dir).unwrap();
        std::fs::create_dir_all(&animation_dir).unwrap();
        std::fs::write(character_dir.join("0100010102.lgo"), []).unwrap();
        std::fs::write(character_dir.join("0100010103.lgo"), []).unwrap();
        std::fs::write(animation_dir.join("3001.lab"), []).unwrap();

        let character = Character {
            id: 1,
            name: "Demon".to_string(),
            action_id: 3001,
            ctrl_type: 0,
            eeff_id: 0,
            effect_action_id: String::new(),
            feff_id: String::new(),
            icon_name: String::new(),
            mesh_part_0: 100,
            mesh_part_1: 0,
            mesh_part_2: 0,
            mesh_part_3: 0,
            mesh_part_4: 0,
            mesh_part_5: 0,
            mesh_part_6: 0,
            mesh_part_7: 0,
            model: 100,
            model_type: 1,
            shadow: 0,
            suit_id: 1,
            suit_num: 1,
        };

        let parts = character.resolve_model_parts(&root);
        let ids: Vec<u32> = parts.iter().map(|(id, _)| *id).collect();
        assert_eq!(ids, vec![100010102, 100010103]);
        assert_eq!(character.animation_id(&root), 3001);

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn resolves_demon_humanoid_parts_from_action_variant() {
        let root = std::env::temp_dir().join(format!(
            "pko_tools_demon_character_action_variant_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let character_dir = root.join("Data").join("model").join("character");
        std::fs::create_dir_all(&character_dir).unwrap();
        for file_name in [
            "0100010102.lgo",
            "0100010103.lgo",
            "0100010104.lgo",
            "0100010602.lgo",
            "0100010603.lgo",
            "0100010604.lgo",
        ] {
            std::fs::write(character_dir.join(file_name), []).unwrap();
        }

        let character = Character {
            id: 26,
            name: "Demon guard".to_string(),
            action_id: 1006,
            ctrl_type: 0,
            eeff_id: 0,
            effect_action_id: String::new(),
            feff_id: String::new(),
            icon_name: String::new(),
            mesh_part_0: 1,
            mesh_part_1: 0,
            mesh_part_2: 0,
            mesh_part_3: 0,
            mesh_part_4: 0,
            mesh_part_5: 0,
            mesh_part_6: 0,
            mesh_part_7: 0,
            model: 100,
            model_type: 1,
            shadow: 0,
            suit_id: 1,
            suit_num: 1,
        };

        let parts = character.resolve_model_parts(&root);
        let ids: Vec<u32> = parts.iter().map(|(id, _)| *id).collect();
        assert_eq!(ids, vec![100010602, 100010603, 100010604]);

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn oversized_demon_character_model_ids_do_not_panic() {
        let root = std::env::temp_dir().join(format!(
            "pko_tools_demon_character_oversized_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let character_dir = root.join("Data").join("model").join("character");
        std::fs::create_dir_all(&character_dir).unwrap();

        let character = Character {
            id: 1,
            name: "Invalid".to_string(),
            action_id: 0,
            ctrl_type: 0,
            eeff_id: 0,
            effect_action_id: String::new(),
            feff_id: String::new(),
            icon_name: String::new(),
            mesh_part_0: 1,
            mesh_part_1: 0,
            mesh_part_2: 0,
            mesh_part_3: 0,
            mesh_part_4: 0,
            mesh_part_5: 0,
            mesh_part_6: 0,
            mesh_part_7: 0,
            model: u16::MAX,
            model_type: 1,
            shadow: 0,
            suit_id: u16::MAX,
            suit_num: 1,
        };

        let result = std::panic::catch_unwind(|| character.resolve_model_parts(&root));
        assert!(result.is_ok());
        assert!(result.unwrap().is_empty());

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn demon_character_from_env_generates_gltf() {
        let Ok(project_dir) = std::env::var("PKO_DEMON_PROJECT_DIR") else {
            eprintln!("PKO_DEMON_PROJECT_DIR not set, skipping");
            return;
        };
        let project_dir = PathBuf::from(project_dir);
        if !project_dir.exists() {
            eprintln!("PKO_DEMON_PROJECT_DIR does not exist, skipping");
            return;
        }

        let characters = crate::character::info::parse_character_table(&project_dir).unwrap();
        let character = characters
            .iter()
            .find(|character| {
                !character.resolve_model_parts(&project_dir).is_empty()
                    && character.animation_file_path(&project_dir).exists()
            })
            .expect("expected at least one renderable Demon character");
        let gltf = character.get_gltf_json(&project_dir, None).unwrap();
        assert!(gltf.contains("\"meshes\""));
    }
}
