use serde::Serialize;

/// A single magic/skill effect parameter record from MagicSingleinfo.bin.
#[derive(Debug, Clone, Serialize)]
pub struct MagicSingleEntry {
    /// Magic effect ID (primary key).
    pub id: i32,
    /// Data source / lookup name.
    pub data_name: String,
    /// Display name.
    pub name: String,
    /// Model/effect file names (only the first `model_count` are meaningful).
    pub models: Vec<String>,
    /// Effect velocity.
    pub velocity: i32,
    /// Particle part names (only the first `particle_count` are meaningful).
    pub particles: Vec<String>,
    /// Dummy point indices (-1 means unused).
    pub dummies: Vec<i32>,
    /// Render mode index.
    pub render_idx: i32,
    /// Light ID reference.
    pub light_id: i32,
    /// Result/hit effect name.
    pub result_effect: String,
}

/// Parsed MagicSingleinfo.bin table.
#[derive(Debug, Clone, Serialize)]
pub struct MagicSingleTable {
    /// Record size from file header (expected 600).
    pub record_size: u32,
    /// All active entries (records with b_exist == 1).
    pub entries: Vec<MagicSingleEntry>,
}

/// A single magic group record from MagicGroupInfo.bin.
#[derive(Debug, Clone, Serialize)]
pub struct MagicGroupEntry {
    /// Magic group ID (primary key).
    pub id: i32,
    /// Data source / lookup name.
    pub data_name: String,
    /// Display name.
    pub name: String,
    /// MagicSingleInfo IDs referenced by this group (up to 8, -1 = unused).
    pub type_ids: Vec<i32>,
    /// Play count for each type ID.
    pub counts: Vec<i32>,
    /// Total play count (sum of counts).
    pub total_count: i32,
    /// Render state index (-1 = default).
    pub render_idx: i32,
}

/// Parsed MagicGroupInfo.bin table.
#[derive(Debug, Clone, Serialize)]
pub struct MagicGroupTable {
    /// Record size from file header (expected 216).
    pub record_size: u32,
    /// All active entries (records with b_exist == 1).
    pub entries: Vec<MagicGroupEntry>,
}
