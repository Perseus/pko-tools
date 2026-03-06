//! Kaitai-backed characterposeinfo.bin loader.
//!
//! Converts the Kaitai `PkoPoseinfo` AST into domain types
//! (`PoseTable`, `PoseEntry`).

use anyhow::{anyhow, Result};
use kaitai::*;
use std::path::Path;

use crate::kaitai_gen::pko_poseinfo::*;

/// Weapon wield mode names, indexed 0-6.
pub const WEAPON_MODES: [&str; 7] = [
    "unarmed", // S_MELEE
    "sword",   // S_MELEE2
    "2h",      // D_MELEE
    "dual",    // D_WEAPON
    "gun",     // S_GUN
    "bow",     // D_BOW
    "dagger",  // S_DAGGER
];

#[derive(Debug, Clone, serde::Serialize)]
pub struct PoseEntry {
    pub pose_id: u16,
    pub name: String,
    pub weapon_variants: [i16; 7],
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct PoseTable {
    pub entries: Vec<PoseEntry>,
}

impl PoseTable {
    pub fn get_pose_name(&self, pose_id: u16) -> Option<&str> {
        self.entries
            .iter()
            .find(|e| e.pose_id == pose_id)
            .map(|e| e.name.as_str())
    }

    pub fn get_base_pose(&self, variant_id: u16) -> Option<(&PoseEntry, usize)> {
        for entry in &self.entries {
            for (weapon_idx, &vid) in entry.weapon_variants.iter().enumerate() {
                if vid == variant_id as i16 {
                    return Some((entry, weapon_idx));
                }
            }
        }
        None
    }
}

pub fn load_poseinfo(path: impl AsRef<Path>) -> Result<PoseTable> {
    let data = std::fs::read(path.as_ref())
        .map_err(|e| anyhow!("Failed to read poseinfo: {e}"))?;
    load_poseinfo_from_bytes(&data)
}

pub fn load_poseinfo_from_bytes(data: &[u8]) -> Result<PoseTable> {
    let reader = BytesReader::from(data.to_vec());
    let parsed = PkoPoseinfo::read_into::<_, PkoPoseinfo>(&reader, None, None)
        .map_err(|e| anyhow!("Kaitai poseinfo parse error: {:?}", e))?;

    convert_poseinfo(&parsed)
}

fn convert_poseinfo(parsed: &PkoPoseinfo) -> Result<PoseTable> {
    let entries_raw = parsed.entries();
    let mut entries = Vec::with_capacity(entries_raw.len());

    for entry in entries_raw.iter() {
        let pose_id = *entry.pose_id() as u16;

        // Extract null-terminated ASCII name from 64-byte field
        let name_bytes = entry.name();
        let end = name_bytes
            .iter()
            .position(|&b| b == 0)
            .unwrap_or(name_bytes.len());
        let name = String::from_utf8_lossy(&name_bytes[..end]).to_string();

        let variants = entry.weapon_variants();
        let mut weapon_variants = [0i16; 7];
        for (i, &v) in variants.iter().enumerate().take(7) {
            weapon_variants[i] = v;
        }

        entries.push(PoseEntry {
            pose_id,
            name,
            weapon_variants,
        });
    }

    Ok(PoseTable { entries })
}

/// Sanitize a pose name for use as a glTF animation name.
/// Lowercase, spaces → underscores, strip parentheses.
pub fn sanitize_action_name(name: &str) -> String {
    name.to_lowercase()
        .replace(' ', "_")
        .replace('(', "")
        .replace(')', "")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_path() -> std::path::PathBuf {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/known_good/characterposeinfo.bin")
    }

    #[test]
    fn parse_poseinfo_basic() {
        let table = load_poseinfo(fixture_path()).expect("parse characterposeinfo.bin");
        assert_eq!(table.entries.len(), 54);
    }

    #[test]
    fn pose_1_is_normal_wait() {
        let table = load_poseinfo(fixture_path()).expect("parse");
        let entry = &table.entries[0];
        assert_eq!(entry.pose_id, 1);
        assert_eq!(entry.name, "Normal Wait");
        assert_eq!(
            entry.weapon_variants,
            [1, 55, 109, 163, 217, 271, 325]
        );
    }

    #[test]
    fn pose_17_is_death_all() {
        let table = load_poseinfo(fixture_path()).expect("parse");
        let entry = table
            .entries
            .iter()
            .find(|e| e.pose_id == 17)
            .expect("pose 17 exists");
        assert_eq!(entry.name, "Death (All)");
    }

    #[test]
    fn get_pose_name_lookup() {
        let table = load_poseinfo(fixture_path()).expect("parse");
        assert_eq!(table.get_pose_name(1), Some("Normal Wait"));
        assert_eq!(table.get_pose_name(17), Some("Death (All)"));
        assert_eq!(table.get_pose_name(999), None);
    }

    #[test]
    fn get_base_pose_reverse_lookup() {
        let table = load_poseinfo(fixture_path()).expect("parse");
        // variant 55 = Normal Wait with sword (weapon index 1)
        let (entry, weapon_idx) = table.get_base_pose(55).expect("variant 55 exists");
        assert_eq!(entry.pose_id, 1);
        assert_eq!(entry.name, "Normal Wait");
        assert_eq!(weapon_idx, 1);
    }

    #[test]
    fn sanitize_names() {
        assert_eq!(sanitize_action_name("Normal Wait"), "normal_wait");
        assert_eq!(sanitize_action_name("Death (All)"), "death_all");
        assert_eq!(sanitize_action_name("Attack 1"), "attack_1");
    }
}
