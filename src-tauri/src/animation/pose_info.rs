//! Kaitai-backed characterposeinfo.bin loader.
//!
//! Converts the Kaitai `PkoPoseinfo` AST into domain types
//! (`PoseTable`, `PoseEntry`).

use anyhow::{anyhow, Result};
use std::path::Path;

use crate::text_encoding::decode_gbk_cstr;

const POSEINFO_HEADER_SIZE: usize = 4;
const POSEINFO_RECORD_SIZE: usize = 120;
const POSEINFO_NAME_OFFSET: usize = 8;
const POSEINFO_NAME_SIZE: usize = 64;
const POSEINFO_WEAPON_VARIANTS_OFFSET: usize = 108;
const POSEINFO_WEAPON_VARIANT_COUNT: usize = 7;

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
    let data = std::fs::read(path.as_ref()).map_err(|e| anyhow!("Failed to read poseinfo: {e}"))?;
    load_poseinfo_from_bytes(&data)
}

pub fn load_poseinfo_from_bytes(data: &[u8]) -> Result<PoseTable> {
    if data.len() < POSEINFO_HEADER_SIZE {
        return Ok(PoseTable {
            entries: Vec::new(),
        });
    }

    let payload = &data[POSEINFO_HEADER_SIZE..];
    let mut entries = Vec::with_capacity(payload.len() / POSEINFO_RECORD_SIZE);

    for record in payload.chunks_exact(POSEINFO_RECORD_SIZE) {
        let pose_id = read_u32(record, 4).unwrap_or(0);
        if pose_id == 0 || pose_id > u16::MAX as u32 {
            continue;
        }

        let mut weapon_variants = [0i16; 7];
        for (i, slot) in weapon_variants
            .iter_mut()
            .enumerate()
            .take(POSEINFO_WEAPON_VARIANT_COUNT)
        {
            let offset = POSEINFO_WEAPON_VARIANTS_OFFSET + i * 2;
            *slot = read_i16(record, offset).unwrap_or(0);
        }

        let name = record
            .get(POSEINFO_NAME_OFFSET..POSEINFO_NAME_OFFSET + POSEINFO_NAME_SIZE)
            .map(decode_gbk_cstr)
            .unwrap_or_default();

        entries.push(PoseEntry {
            pose_id: pose_id as u16,
            name,
            weapon_variants,
        });
    }

    Ok(PoseTable { entries })
}

fn read_u32(record: &[u8], offset: usize) -> Option<u32> {
    let bytes: [u8; 4] = record.get(offset..offset + 4)?.try_into().ok()?;
    Some(u32::from_le_bytes(bytes))
}

fn read_i16(record: &[u8], offset: usize) -> Option<i16> {
    let bytes: [u8; 2] = record.get(offset..offset + 2)?.try_into().ok()?;
    Some(i16::from_le_bytes(bytes))
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
        assert_eq!(entry.weapon_variants, [1, 55, 109, 163, 217, 271, 325]);
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

    #[test]
    fn parse_poseinfo_reads_all_records_and_decodes_gbk_names() {
        let mut data = vec![0u8; POSEINFO_HEADER_SIZE + POSEINFO_RECORD_SIZE * 2];
        data[0..4].copy_from_slice(&120u32.to_le_bytes());

        let first = &mut data[POSEINFO_HEADER_SIZE..POSEINFO_HEADER_SIZE + POSEINFO_RECORD_SIZE];
        first[0..4].copy_from_slice(&1u32.to_le_bytes());
        first[4..8].copy_from_slice(&1u32.to_le_bytes());
        first[POSEINFO_NAME_OFFSET..POSEINFO_NAME_OFFSET + 4]
            .copy_from_slice(&[0xb4, 0xfd, 0xbb, 0xfa]);
        first[POSEINFO_WEAPON_VARIANTS_OFFSET..POSEINFO_WEAPON_VARIANTS_OFFSET + 2]
            .copy_from_slice(&1i16.to_le_bytes());

        let second_start = POSEINFO_HEADER_SIZE + POSEINFO_RECORD_SIZE;
        let second = &mut data[second_start..second_start + POSEINFO_RECORD_SIZE];
        second[0..4].copy_from_slice(&2u32.to_le_bytes());
        second[4..8].copy_from_slice(&2u32.to_le_bytes());
        second[POSEINFO_NAME_OFFSET..POSEINFO_NAME_OFFSET + 6].copy_from_slice(b"Attack");
        second[POSEINFO_WEAPON_VARIANTS_OFFSET..POSEINFO_WEAPON_VARIANTS_OFFSET + 2]
            .copy_from_slice(&2i16.to_le_bytes());

        let table = load_poseinfo_from_bytes(&data).expect("parse poseinfo");
        assert_eq!(table.entries.len(), 2);
        assert_eq!(table.entries[0].name, "待机");
        assert_eq!(table.entries[1].name, "Attack");
    }
}
