pub mod animation;
pub mod commands;
pub mod helper;
mod info;
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
    db,
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

    pub fn get_metadata(&self, project_dir: &Path) -> anyhow::Result<CharacterMetadata> {
        let parts = self.get_parts();
        let mut model_locations = vec![];

        for i in 0..parts.len() {
            let model_id_base = self.model as u32 * 1000000;
            let suit_id = self.suit_id as u32 * 10000;
            let model_id = model_id_base + suit_id + i as u32;
            let model_location = format!(
                "{}/model/character/{:0>10}.lgo",
                project_dir.to_str().unwrap(),
                model_id
            );
            model_locations.push(model_location);
        }

        let models: Vec<model::CharacterGeometricModel> = model_locations
            .iter()
            .map(|location| model::CharacterGeometricModel::from_file(PathBuf::from(location)))
            .collect::<anyhow::Result<Vec<_>>>()?;
        let animation =
            super::animation::character::LwBoneFile::from_file(PathBuf::from(format!(
                "{}/animation/{:0>4}.lab",
                project_dir.to_str().unwrap(),
                self.model
            )))?;

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
        let model_parts: Vec<String> = (0..parts.len())
            .map(|i| {
                let model_id_base = self.model as u32 * 1000000;
                let suit_id = self.suit_id as u32 * 10000;
                let model_id = model_id_base + suit_id + i as u32;
                format!("{:0>10}", model_id)
            })
            .collect();

        Ok(CharacterMetadata {
            character_id: self.id,
            character_name: self.name.clone(),
            model_id: self.model,
            animation_id: self.model, // Animation ID is the same as model ID
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

    pub fn get_gltf_json(&self, project_dir: &Path) -> anyhow::Result<String> {
        let parts = self.get_parts();
        let mut model_locations = vec![];

        for i in 0..parts.len() {
            let model_id_base = self.model as u32 * 1000000;
            let suit_id = self.suit_id as u32 * 10000;
            let model_id = model_id_base + suit_id + i as u32;
            let model_location = format!(
                "{}/model/character/{:0>10}.lgo",
                project_dir.to_str().unwrap(),
                model_id
            );
            model_locations.push(model_location);
        }

        let models: Vec<model::CharacterGeometricModel> = model_locations
            .iter()
            .map(|location| model::CharacterGeometricModel::from_file(PathBuf::from(location)))
            .collect::<anyhow::Result<Vec<_>>>()?;
        let animation =
            super::animation::character::LwBoneFile::from_file(PathBuf::from(format!(
                "{}/animation/{:0>4}.lab",
                project_dir.to_str().unwrap(),
                self.model
            )))?;

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
            let primitive = model.get_gltf_mesh_primitive(project_dir, &mut fields_to_aggregate)?;
            let model_id_base = self.model as u32 * 1000000;
            let suit_id = self.suit_id as u32 * 10000;
            let model_id = model_id_base + suit_id + i as u32;
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
        let (skin, nodes) = animation.to_gltf_skin_and_nodes_multi(&mut fields_to_aggregate, mesh_count);
        fields_to_aggregate.skin.push(skin);
        fields_to_aggregate.nodes.extend(nodes);

        let helpers: Vec<Vec<gltf::Node>> = models
            .iter()
            .enumerate()
            .map(|(i, model)| model.get_gltf_helper_nodes_for_mesh(i))
            .collect();
        let mut total_helper_nodes = 0;
        for helper_nodes in helpers.iter() {
            total_helper_nodes += helper_nodes.len();
            fields_to_aggregate.nodes.extend(helper_nodes.clone());
        }
        animation.to_gltf_animations_and_sampler(&mut fields_to_aggregate);

        // Build scene node indices: root bone, skinned mesh nodes, and all helper nodes
        let mut scene_nodes = vec![
            Index::new(0),  // Root bone
        ];
        
        // Add skinned mesh node indices (one per mesh, created by to_gltf_skin_and_nodes_multi)
        // These nodes are at indices: (nodes.len() - total_helper_nodes - mesh_count) to (nodes.len() - total_helper_nodes - 1)
        let skinned_mesh_start_idx = fields_to_aggregate.nodes.len() - total_helper_nodes - mesh_count;
        for i in 0..mesh_count {
            scene_nodes.push(Index::new((skinned_mesh_start_idx + i) as u32));
        }

        // Add helper node indices to scene so they're loaded by glTF parsers
        let helper_start_index = fields_to_aggregate.nodes.len() - total_helper_nodes;
        for i in helper_start_index..fields_to_aggregate.nodes.len() {
            scene_nodes.push(Index::new(i as u32));
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

        let mesh_data = CharacterGeometricModel::from_gltf(&gltf, &buffers, &images, 1, &animation_data)?;
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
        let file = File::create(format!("./imports/character/animation/{}", animation_file_name))?;
        let mut writer = BufWriter::new(file);
        animation_data.write_options(&mut writer, binrw::Endian::Little, ())?;
        
        // Write each mesh as a separate LGO file
        let mut mesh_file_names = Vec::new();
        for mesh_idx in 0..mesh_count {
            let mesh_data = CharacterGeometricModel::from_gltf_mesh(
                &gltf, &buffers, &images, model_id, &animation_data, mesh_idx
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
        let mesh_file_name = mesh_file_names.first()
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
        let file = File::create(format!("./imports/character/animation/{}", animation_file_name))?;
        let mut writer = BufWriter::new(file);
        animation_data.write_options(&mut writer, binrw::Endian::Little, ())?;
        
        // Write each mesh as a separate LGO file
        let mut mesh_file_names = Vec::new();
        for mesh_idx in 0..mesh_count {
            let mesh_data = CharacterGeometricModel::from_gltf_mesh(
                &gltf, &buffers, &images, model_id, &animation_data, mesh_idx
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
    let project = projects::project::Project::get_project(project_id)?;
    let character = get_character(project_id, character_id)?;

    let project_dir = project.project_directory.as_ref();

    let gltf_json = character.get_gltf_json(project_dir)?;
    Ok(gltf_json)
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
        let (gltf, buffers, images) =
            import(PathBuf::from("./test_artifacts/test.gltf")).unwrap();
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

        let gltf = character.get_gltf_json(Path::new("/mnt/d/EA 1.0.1"));
        let mut file = File::create("./test_artifacts/test.gltf").unwrap();
        file.write_all(gltf.unwrap().as_bytes()).unwrap();
    }
}
