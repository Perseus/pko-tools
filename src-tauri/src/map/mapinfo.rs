use std::collections::HashMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

/// A single map info entry from mapinfo.bin.
/// CMapInfo extends CRawDataInfo (108 bytes base).
/// Derived fields at offset 108:
///   szName[16]:      char[16]  — map display name
///   nInitX:          int (4)   — spawn tile X
///   nInitY:          int (4)   — spawn tile Y
///   fLightDir[3]:    float[3]  — directional light direction (may be default [1,1,-1])
///   btLightColor[3]: BYTE[3]   — directional light color (may be default [255,255,255])
///   IsShowSwitch:    bool (1)  — whether to show map switch UI
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MapInfo {
    /// Map ID (nID from CRawDataInfo base)
    pub map_id: u32,
    /// Internal filename from szDataName (CRawDataInfo base, offset 8, 72 bytes)
    pub data_name: String,
    /// Map display name (szName[16])
    pub display_name: String,
    /// Spawn point tile X
    pub init_x: i32,
    /// Spawn point tile Y
    pub init_y: i32,
    /// Directional light direction [x, y, z]
    pub light_dir: [f32; 3],
    /// Directional light color [R, G, B] (0-255)
    pub light_color: [u8; 3],
    /// Whether to show map switch UI element
    pub show_switch: bool,
}

// CRawDataInfo base layout constants
const RAW_DATA_INFO_BEXIST_OFFSET: usize = 0;
const RAW_DATA_INFO_DATANAME_OFFSET: usize = 8;
const RAW_DATA_INFO_NID_OFFSET: usize = 100;

// CMapInfo derived fields start after CRawDataInfo base (108 bytes)
const MAP_DERIVED_OFFSET: usize = 108;

fn read_u32(data: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(data[offset..offset + 4].try_into().unwrap())
}

fn read_i32(data: &[u8], offset: usize) -> i32 {
    i32::from_le_bytes(data[offset..offset + 4].try_into().unwrap())
}

fn read_f32(data: &[u8], offset: usize) -> f32 {
    f32::from_le_bytes(data[offset..offset + 4].try_into().unwrap())
}

/// Read a null-terminated string from a fixed-size buffer.
fn read_fixed_string(data: &[u8], offset: usize, max_len: usize) -> String {
    let end = offset + max_len;
    let slice = &data[offset..end];
    let nul_pos = slice.iter().position(|&b| b == 0).unwrap_or(max_len);
    String::from_utf8_lossy(&slice[..nul_pos]).to_string()
}

/// Parse mapinfo.bin — CRawDataSet binary format.
///
/// Structure: CMapInfo extends CRawDataInfo (108 bytes base)
/// Derived fields at offset 108:
///   szName[16]:      char[16]  (16 bytes)
///   nInitX:          int       (4 bytes) — spawn X
///   nInitY:          int       (4 bytes) — spawn Y
///   fLightDir[3]:    float[3]  (12 bytes) — light direction
///   btLightColor[3]: BYTE[3]   (3 bytes) — light color
///   IsShowSwitch:    bool      (1 byte)
pub fn parse_mapinfo_bin(data: &[u8]) -> anyhow::Result<HashMap<u32, MapInfo>> {
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

        let map_id = read_u32(chunk, RAW_DATA_INFO_NID_OFFSET);
        let data_name = read_fixed_string(chunk, RAW_DATA_INFO_DATANAME_OFFSET, 72);

        // Derived fields
        let d = MAP_DERIVED_OFFSET;
        if chunk.len() < d + 40 {
            continue; // Not enough data for all derived fields
        }

        let display_name = read_fixed_string(chunk, d, 16);
        let init_x = read_i32(chunk, d + 16);
        let init_y = read_i32(chunk, d + 20);
        let light_dir = [
            read_f32(chunk, d + 24),
            read_f32(chunk, d + 28),
            read_f32(chunk, d + 32),
        ];
        let light_color = [chunk[d + 36], chunk[d + 37], chunk[d + 38]];
        let show_switch = chunk[d + 39] != 0;

        map.insert(
            map_id,
            MapInfo {
                map_id,
                data_name,
                display_name,
                init_x,
                init_y,
                light_dir,
                light_color,
                show_switch,
            },
        );
    }

    Ok(map)
}

/// Load and parse mapinfo.bin from a project directory.
pub fn load_mapinfo(project_dir: &Path) -> anyhow::Result<HashMap<u32, MapInfo>> {
    let bin_path = project_dir.join("scripts/table/mapinfo.bin");
    if bin_path.exists() {
        let data = std::fs::read(&bin_path)?;
        return parse_mapinfo_bin(&data);
    }

    // Try MapInfo.bin (mixed case)
    let bin_path2 = project_dir.join("scripts/table/MapInfo.bin");
    if bin_path2.exists() {
        let data = std::fs::read(&bin_path2)?;
        return parse_mapinfo_bin(&data);
    }

    Ok(HashMap::new())
}

/// Find the MapInfo entry matching a map folder name (e.g., "07xmas").
/// Matches against data_name (the szDataName field from CRawDataInfo).
pub fn find_map_info<'a>(
    infos: &'a HashMap<u32, MapInfo>,
    map_name: &str,
) -> Option<&'a MapInfo> {
    let map_name_lower = map_name.to_lowercase();
    infos.values().find(|info| {
        info.data_name.to_lowercase() == map_name_lower
            || info.data_name.to_lowercase().ends_with(&format!("/{}", map_name_lower))
            || info.data_name.to_lowercase().ends_with(&format!("\\{}", map_name_lower))
            || info.data_name.to_lowercase().contains(&map_name_lower)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_empty() {
        let map = parse_mapinfo_bin(&[]).unwrap();
        assert!(map.is_empty());

        let map = parse_mapinfo_bin(&0u32.to_le_bytes()).unwrap();
        assert!(map.is_empty());
    }

    #[test]
    fn read_fixed_string_basic() {
        let data = b"hello\0world\0\0\0\0\0";
        assert_eq!(read_fixed_string(data, 0, 5), "hello");
        assert_eq!(read_fixed_string(data, 0, 16), "hello");
    }

    #[test]
    fn parse_real_data() {
        let bin_path = std::path::PathBuf::from("../top-client/scripts/table/mapinfo.bin");
        if !bin_path.exists() {
            return;
        }

        let data = std::fs::read(&bin_path).unwrap();
        let map = parse_mapinfo_bin(&data).unwrap();

        assert!(!map.is_empty(), "should have map entries");
        eprintln!("mapinfo.bin: {} entries", map.len());

        for (id, info) in map.iter().take(5) {
            eprintln!(
                "  map_id={}, data_name='{}', display_name='{}', init=({},{}), light_dir={:?}, light_color={:?}, show_switch={}",
                id, info.data_name, info.display_name, info.init_x, info.init_y,
                info.light_dir, info.light_color, info.show_switch
            );
        }
    }

    #[test]
    fn find_map_info_basic() {
        let mut infos = HashMap::new();
        infos.insert(
            1,
            MapInfo {
                map_id: 1,
                data_name: "map/07xmas".to_string(),
                display_name: "Christmas".to_string(),
                init_x: 148,
                init_y: 148,
                light_dir: [1.0, 1.0, -1.0],
                light_color: [255, 255, 255],
                show_switch: false,
            },
        );

        let found = find_map_info(&infos, "07xmas");
        assert!(found.is_some());
        assert_eq!(found.unwrap().init_x, 148);

        let not_found = find_map_info(&infos, "garner");
        assert!(not_found.is_none());
    }
}
