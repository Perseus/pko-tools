mod animation;
pub mod commands;
mod helper;
mod info;
mod math;
mod mesh;
mod model;
mod texture;

use std::path::PathBuf;

use info::get_character;
use serde::{Deserialize, Serialize};

use crate::{db, projects};

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

pub fn open_character(project_id: uuid::Uuid, character_id: u32) {
    let character = get_character(project_id, character_id);
    if character.is_err() {
        println!("Error opening character: {:?}", character.err().unwrap());
        return;
    }

    let character = character.unwrap();
}
