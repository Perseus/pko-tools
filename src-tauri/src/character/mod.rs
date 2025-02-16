mod animation;
pub mod commands;
mod helper;
mod info;
mod mesh;
pub mod model;
mod texture;

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

        let primitives = models
            .iter()
            .map(|model| model.get_gltf_mesh_primitive(project_dir, &mut fields_to_aggregate))
            .collect::<Vec<_>>();
        let (skin, nodes) = animation.to_gltf_skin_and_nodes(&mut fields_to_aggregate);
        fields_to_aggregate.skin.push(skin);
        fields_to_aggregate.nodes.extend(nodes);

        let helpers = models
            .iter()
            .map(|model| model.get_gltf_helper_nodes())
            .collect::<Vec<_>>();
        let mut total_helper_nodes = 0;
        for helper_nodes in helpers.iter() {
            total_helper_nodes += helper_nodes.len();
            fields_to_aggregate.nodes.extend(helper_nodes.clone());
        }
        animation.to_gltf_animations_and_sampler(&mut fields_to_aggregate);

        let scene = gltf::Scene {
            nodes: vec![
                Index::new(0),
                Index::new((fields_to_aggregate.nodes.len() - total_helper_nodes - 1) as u32),
            ],
            name: Some("DefaultScene".to_string()),
            extensions: None,
            extras: None,
        };

        let mesh = gltf::Mesh {
            name: Some("mesh".to_string()),
            primitives: primitives
                .iter()
                .map(|p| p.as_ref().unwrap().clone())
                .collect(),
            weights: None,
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
            meshes: vec![mesh],
            textures: fields_to_aggregate.texture,
            materials: fields_to_aggregate.material,
            samplers: fields_to_aggregate.sampler,
            animations: fields_to_aggregate.animation,
            ..Default::default()
        };

        let gltf_as_string = serde_json::to_string_pretty(&gltf)?;
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

        let mesh_data = CharacterGeometricModel::from_gltf(&gltf, &buffers, &images, 1)?;
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
        let mesh_data = CharacterGeometricModel::from_gltf(&gltf, &buffers, &images, model_id)?;

        let animation_file_name = format!("{:0>4}.lab", model_id);
        let mesh_file_name = format!("{:0>10}.lgo", model_id * 1000000);

        let file = File::create(format!("./imports/character/animation/{}", animation_file_name))?;
        let mut writer = BufWriter::new(file);
        animation_data.write_options(&mut writer, binrw::Endian::Little, ())?;

        let file = File::create(format!("./imports/character/model/{}", mesh_file_name))?;
        let mut writer = BufWriter::new(file);
        mesh_data.write_options(&mut writer, binrw::Endian::Little, ())?;

        Ok((animation_file_name, mesh_file_name))
    }
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

#[cfg(test)]
mod test {
    use std::{io::Write, thread};

    use ::gltf::{import, Gltf};

    use super::*;

    #[test]
    fn is_able_to_parse_gltf() {
        let (gltf, buffers, images) =
            import(PathBuf::from("./test_artifacts/test.gltf")).unwrap();
        let character = Character::from_gltf(gltf, buffers, images).unwrap();
        println!("{:?}", character);
    }

    #[test]
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
