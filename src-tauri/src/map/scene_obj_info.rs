use std::collections::HashMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

/// A scene object model entry from sceneobjinfo.bin.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SceneObjModelInfo {
    pub id: u32,
    pub filename: String,
}

// CRawDataInfo layout constants (same as sceneffect.rs)
const RAW_DATA_INFO_BEXIST_OFFSET: usize = 0;
const RAW_DATA_INFO_SZDATA_OFFSET: usize = 8;
const RAW_DATA_INFO_SZDATA_LEN: usize = 72;
const RAW_DATA_INFO_NID_OFFSET: usize = 100;

fn read_u32(data: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(data[offset..offset + 4].try_into().unwrap())
}

fn read_i32(data: &[u8], offset: usize) -> i32 {
    i32::from_le_bytes(data[offset..offset + 4].try_into().unwrap())
}

fn read_cstr(data: &[u8], offset: usize, max_len: usize) -> String {
    let slice = &data[offset..offset + max_len];
    let end = slice.iter().position(|&b| b == 0).unwrap_or(max_len);
    String::from_utf8_lossy(&slice[..end]).to_string()
}

/// Parse sceneobjinfo.bin — CRawDataSet binary format.
///
/// Structure: CSceneObjInfo extends CRawDataInfo (108 bytes base)
/// Base fields: bExist(i32, offset 0), szDataName[72](offset 8), nID(u32, offset 100)
/// The szDataName field contains the .lmo filename.
pub fn parse_scene_obj_info_bin(data: &[u8]) -> anyhow::Result<HashMap<u32, SceneObjModelInfo>> {
    if data.len() < 4 {
        return Ok(HashMap::new());
    }

    let entry_size = read_u32(data, 0) as usize;
    if entry_size == 0 {
        return Ok(HashMap::new());
    }

    let data = &data[4..];
    let entry_count = data.len() / entry_size;
    let mut map = HashMap::new();

    for i in 0..entry_count {
        let offset = i * entry_size;
        if offset + entry_size > data.len() {
            break;
        }
        let chunk = &data[offset..offset + entry_size];

        let b_exist = read_i32(chunk, RAW_DATA_INFO_BEXIST_OFFSET);
        if b_exist == 0 {
            continue;
        }

        let id = read_u32(chunk, RAW_DATA_INFO_NID_OFFSET);
        let filename = read_cstr(chunk, RAW_DATA_INFO_SZDATA_OFFSET, RAW_DATA_INFO_SZDATA_LEN)
            .trim()
            .to_string();

        if filename.is_empty() {
            continue;
        }

        map.insert(id, SceneObjModelInfo { id, filename });
    }

    Ok(map)
}

/// Load and parse sceneobjinfo.bin from a project directory.
pub fn load_scene_obj_info(project_dir: &Path) -> anyhow::Result<HashMap<u32, SceneObjModelInfo>> {
    let bin_path = project_dir.join("scripts/table/sceneobjinfo.bin");
    if bin_path.exists() {
        let data = std::fs::read(&bin_path)?;
        return parse_scene_obj_info_bin(&data);
    }

    Ok(HashMap::new())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_bin_empty() {
        let map = parse_scene_obj_info_bin(&[]).unwrap();
        assert!(map.is_empty());

        let map = parse_scene_obj_info_bin(&0u32.to_le_bytes()).unwrap();
        assert!(map.is_empty());
    }

    #[test]
    fn parse_bin_real_data() {
        let bin_path = std::path::PathBuf::from("../top-client/scripts/table/sceneobjinfo.bin");
        if !bin_path.exists() {
            return;
        }

        let data = std::fs::read(&bin_path).unwrap();
        let map = parse_scene_obj_info_bin(&data).unwrap();

        assert!(!map.is_empty(), "should have entries");
        eprintln!("sceneobjinfo.bin: {} entries", map.len());

        // Print a few entries for inspection
        for (id, info) in map.iter().take(5) {
            eprintln!("  id={}, filename={}", id, info.filename);
        }

        // All filenames should end with .lmo
        for info in map.values() {
            assert!(
                info.filename.to_lowercase().ends_with(".lmo"),
                "filename '{}' should end with .lmo",
                info.filename
            );
        }
    }
}
