pub mod commands;
pub mod info;
pub mod lit;
pub mod model;
pub mod refine;
pub mod sceneffect;

use serde::{Deserialize, Serialize};

/// Weapon/equipment item types that have 3D models
pub const WEAPON_ITEM_TYPES: &[u32] = &[
    1,  // Sword (1H)
    2,  // Sword (2H)
    3,  // Bow
    4,  // Gun
    5,  // Knife/Dagger
    6,  // Shield
    7,  // Staff
    8,  // Axe
    14, // Boxing Glove
    15, // Claw
];

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Item {
    pub id: u32,
    pub name: String,
    pub icon_name: String,
    pub model_ground: String,
    pub model_lance: String,
    pub model_carsise: String,
    pub model_phyllis: String,
    pub model_ami: String,
    pub item_type: u32,
    pub display_effect: String,
    pub bind_effect: String,
    pub bind_effect_2: String,
    pub description: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ItemMetadata {
    pub item_id: u32,
    pub item_name: String,
    pub item_type: u32,
    pub model_id: String,
    pub vertex_count: u32,
    pub triangle_count: u32,
    pub material_count: u32,
    pub dummy_count: u32,
    pub bounding_spheres: u32,
    pub bounding_boxes: u32,
    pub available_models: Vec<String>,
}
