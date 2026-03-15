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
