use std::collections::HashMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

/// A single entry from sceneffectinfo.txt
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SceneEffectInfo {
    pub id: u32,
    pub filename: String,
    pub display_name: String,
    pub photo_name: String,
    pub eff_type: u32,
    pub obj_type: u32,
    pub dummy_list: Vec<i32>,
    pub dummy2: i32,
    pub height_off: f32,
    pub play_time: f32,
    pub light_id: i32,
    pub base_size: i32,
}

/// Parse sceneffectinfo.txt — a tab-separated text file.
///
/// Format (12 columns per line):
///   ID  filename  display_name  photo_name  effType  objType  dummyList  dummy2  heightOff  playTime  lightID  baseSize
///
/// Lines starting with "//" are comments. The dummyList column may contain
/// comma-separated integers (e.g., "1,2,3,4") or a single value.
pub fn parse_scene_effect_info(text: &str) -> HashMap<u32, SceneEffectInfo> {
    let mut map = HashMap::new();

    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("//") {
            continue;
        }

        let cols: Vec<&str> = line.split('\t').collect();
        if cols.len() < 12 {
            continue;
        }

        let id = match cols[0].parse::<u32>() {
            Ok(v) => v,
            Err(_) => continue,
        };

        let dummy_list: Vec<i32> = cols[6]
            .split(',')
            .filter_map(|s| s.trim().parse::<i32>().ok())
            .collect();

        let entry = SceneEffectInfo {
            id,
            filename: cols[1].to_string(),
            display_name: cols[2].to_string(),
            photo_name: cols[3].to_string(),
            eff_type: cols[4].parse().unwrap_or(0),
            obj_type: cols[5].parse().unwrap_or(0),
            dummy_list,
            dummy2: cols[7].parse().unwrap_or(-1),
            height_off: cols[8].parse().unwrap_or(0.0),
            play_time: cols[9].parse().unwrap_or(0.0),
            light_id: cols[10].parse().unwrap_or(0),
            base_size: cols[11].parse().unwrap_or(-1),
        };

        map.insert(id, entry);
    }

    map
}

// ============================================================================
// Binary format parser (sceneffectinfo.bin — CRawDataSet)
// ============================================================================

/// CRawDataInfo layout constants (shared with refine.rs)
const RAW_DATA_INFO_SIZE: usize = 108;
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

fn read_f32(data: &[u8], offset: usize) -> f32 {
    f32::from_le_bytes(data[offset..offset + 4].try_into().unwrap())
}

fn read_cstr(data: &[u8], offset: usize, max_len: usize) -> String {
    let slice = &data[offset..offset + max_len];
    let end = slice.iter().position(|&b| b == 0).unwrap_or(max_len);
    String::from_utf8_lossy(&slice[..end]).to_string()
}

/// Parse sceneffectinfo.bin — CRawDataSet binary format.
///
/// Structure: CMagicInfo extends CRawDataInfo (108 bytes base + 100 bytes derived = 208 total)
///
/// Derived fields at offset 108:
///   szName: char[16]       — display name
///   szPhotoName: char[16]  — photo/icon name
///   nPhotoTexID: int       — photo texture ID
///   nEffType: int          — effect type
///   nObjType: int          — object type
///   nDummyNum: int         — number of active dummy entries
///   nDummy: int[8]         — dummy/bone attachment IDs (-1 = unused)
///   nDummy2: int           — secondary dummy
///   nHeightOff: int        — height offset
///   fPlayTime: float       — play duration
///   LightID: int           — light effect ID
///   fBaseSize: float       — base size/scale
pub fn parse_scene_effect_info_bin(data: &[u8]) -> anyhow::Result<HashMap<u32, SceneEffectInfo>> {
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
        let filename = read_cstr(chunk, RAW_DATA_INFO_SZDATA_OFFSET, RAW_DATA_INFO_SZDATA_LEN);

        let d = RAW_DATA_INFO_SIZE;
        let display_name = read_cstr(chunk, d, 16);
        let photo_name = read_cstr(chunk, d + 16, 16);
        // nPhotoTexID at d+32 (skip)
        let eff_type = read_u32(chunk, d + 36);
        let obj_type = read_u32(chunk, d + 40);
        let dummy_num = read_i32(chunk, d + 44) as usize;
        let mut dummy_list = Vec::new();
        for j in 0..8usize.min(dummy_num) {
            let did = read_i32(chunk, d + 48 + j * 4);
            if did != -1 {
                dummy_list.push(did);
            }
        }
        let dummy2 = read_i32(chunk, d + 80);
        let height_off = read_i32(chunk, d + 84) as f32;
        let play_time = read_f32(chunk, d + 88);
        let light_id = read_i32(chunk, d + 92);
        let base_size = read_i32(chunk, d + 96);

        map.insert(
            id,
            SceneEffectInfo {
                id,
                filename,
                display_name,
                photo_name,
                eff_type,
                obj_type,
                dummy_list,
                dummy2,
                height_off,
                play_time,
                light_id,
                base_size,
            },
        );
    }

    Ok(map)
}

/// Load and parse sceneffectinfo from a project directory.
/// Tries .bin (binary CRawDataSet) first, falls back to .txt (tab-separated text).
pub fn load_scene_effect_info(project_dir: &Path) -> anyhow::Result<HashMap<u32, SceneEffectInfo>> {
    let bin_path = project_dir.join("scripts/table/sceneffectinfo.bin");
    if bin_path.exists() {
        let data = std::fs::read(&bin_path)?;
        return parse_scene_effect_info_bin(&data);
    }

    let txt_path = project_dir.join("scripts/table/sceneffectinfo.txt");
    if txt_path.exists() {
        let text = std::fs::read_to_string(&txt_path)?;
        return Ok(parse_scene_effect_info(&text));
    }

    Ok(HashMap::new())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_basic_entry() {
        let input =
            "100\teffect_fire.par\tFire Effect\tfire_photo\t3\t1\t1,2,3\t-1\t0.5\t10.0\t5\t2\n";
        let map = parse_scene_effect_info(input);

        assert_eq!(map.len(), 1);
        let entry = map.get(&100).unwrap();
        assert_eq!(entry.filename, "effect_fire.par");
        assert_eq!(entry.display_name, "Fire Effect");
        assert_eq!(entry.photo_name, "fire_photo");
        assert_eq!(entry.eff_type, 3);
        assert_eq!(entry.obj_type, 1);
        assert_eq!(entry.dummy_list, vec![1, 2, 3]);
        assert_eq!(entry.dummy2, -1);
        assert!((entry.height_off - 0.5).abs() < f32::EPSILON);
        assert!((entry.play_time - 10.0).abs() < f32::EPSILON);
        assert_eq!(entry.light_id, 5);
        assert_eq!(entry.base_size, 2);
    }

    #[test]
    fn parse_skips_comments_and_blank_lines() {
        let input = "\
// This is a comment
// Another comment

100\teffect.par\tName\tPhoto\t3\t1\t1\t-1\t0.0\t0.0\t0\t-1
";
        let map = parse_scene_effect_info(input);
        assert_eq!(map.len(), 1);
        assert!(map.contains_key(&100));
    }

    #[test]
    fn parse_skips_short_lines() {
        let input = "100\teffect.par\tName\n"; // only 3 columns, needs 12
        let map = parse_scene_effect_info(input);
        assert!(map.is_empty());
    }

    #[test]
    fn parse_multiple_entries() {
        let input = "\
10\ta.par\tA\tPA\t1\t0\t0\t0\t0\t0\t0\t0
20\tb.par\tB\tPB\t2\t0\t1,2\t0\t0\t0\t0\t0
";
        let map = parse_scene_effect_info(input);
        assert_eq!(map.len(), 2);
        assert_eq!(map.get(&10).unwrap().filename, "a.par");
        assert_eq!(map.get(&20).unwrap().dummy_list, vec![1, 2]);
    }

    #[test]
    fn parse_single_dummy_value() {
        let input = "50\teff.par\tN\tP\t3\t0\t5\t-1\t0\t0\t0\t0\n";
        let map = parse_scene_effect_info(input);
        assert_eq!(map.get(&50).unwrap().dummy_list, vec![5]);
    }

    #[test]
    fn parse_empty_input() {
        let map = parse_scene_effect_info("");
        assert!(map.is_empty());
    }

    #[test]
    fn parse_invalid_id_skipped() {
        let input = "abc\teff.par\tN\tP\t3\t0\t1\t0\t0\t0\t0\t0\n";
        let map = parse_scene_effect_info(input);
        assert!(map.is_empty());
    }

    #[test]
    fn parse_bin_real_data() {
        let bin_path = std::path::PathBuf::from("../top-client/scripts/table/sceneffectinfo.bin");
        if !bin_path.exists() {
            return;
        }

        let data = std::fs::read(&bin_path).unwrap();
        let map = parse_scene_effect_info_bin(&data).unwrap();

        // Should have many entries
        assert!(map.len() > 100, "got {} entries", map.len());

        // First entry (ID 1) should be "wave1.par"
        let entry1 = map.get(&1).unwrap();
        assert_eq!(entry1.filename, "wave1.par");
        assert!(!entry1.display_name.is_empty());

        // Verify a forge particle effect entry exists (3302 = base_id 330 * 10 + tier 2)
        assert!(map.contains_key(&3302), "scene effect 3302 should exist");
    }

    #[test]
    fn parse_bin_empty() {
        let map = parse_scene_effect_info_bin(&[]).unwrap();
        assert!(map.is_empty());

        let map = parse_scene_effect_info_bin(&0u32.to_le_bytes()).unwrap();
        assert!(map.is_empty());
    }
}
