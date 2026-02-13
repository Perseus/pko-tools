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

fn read_u32(data: &[u8], offset: usize) -> Option<u32> {
    data.get(offset..offset + 4)
        .and_then(|s| s.try_into().ok())
        .map(u32::from_le_bytes)
}

fn read_i32(data: &[u8], offset: usize) -> Option<i32> {
    data.get(offset..offset + 4)
        .and_then(|s| s.try_into().ok())
        .map(i32::from_le_bytes)
}

fn read_f32(data: &[u8], offset: usize) -> Option<f32> {
    data.get(offset..offset + 4)
        .and_then(|s| s.try_into().ok())
        .map(f32::from_le_bytes)
}

/// Read a null-terminated string from a fixed-size buffer.
/// Returns None if the buffer is too small.
fn read_fixed_string(data: &[u8], offset: usize, max_len: usize) -> Option<String> {
    let end = offset + max_len;
    let slice = data.get(offset..end)?;
    let nul_pos = slice.iter().position(|&b| b == 0).unwrap_or(max_len);
    Some(String::from_utf8_lossy(&slice[..nul_pos]).to_string())
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

    let entry_size = read_u32(data, 0).unwrap_or(0) as usize;
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

        // Base fields — skip entry if chunk is too small
        let b_exist = match read_i32(chunk, RAW_DATA_INFO_BEXIST_OFFSET) {
            Some(v) => v,
            None => continue,
        };
        if b_exist == 0 {
            continue;
        }

        let map_id = match read_u32(chunk, RAW_DATA_INFO_NID_OFFSET) {
            Some(v) => v,
            None => continue,
        };
        let data_name = match read_fixed_string(chunk, RAW_DATA_INFO_DATANAME_OFFSET, 72) {
            Some(v) => v,
            None => continue,
        };

        // Derived fields
        let d = MAP_DERIVED_OFFSET;
        let display_name = match read_fixed_string(chunk, d, 16) { Some(v) => v, None => continue };
        let init_x = match read_i32(chunk, d + 16) { Some(v) => v, None => continue };
        let init_y = match read_i32(chunk, d + 20) { Some(v) => v, None => continue };
        let light_dir = match (read_f32(chunk, d + 24), read_f32(chunk, d + 28), read_f32(chunk, d + 32)) {
            (Some(x), Some(y), Some(z)) => [x, y, z],
            _ => continue,
        };
        let light_color = match (chunk.get(d + 36), chunk.get(d + 37), chunk.get(d + 38)) {
            (Some(&r), Some(&g), Some(&b)) => [r, g, b],
            _ => continue,
        };
        let show_switch = match chunk.get(d + 39) { Some(&v) => v != 0, None => continue };

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
/// Uses strict matching: exact match or path-suffix match only.
/// No substring fallback to avoid ambiguity with shared prefixes (garner/garner2).
pub fn find_map_info<'a>(
    infos: &'a HashMap<u32, MapInfo>,
    map_name: &str,
) -> Option<&'a MapInfo> {
    let map_name_lower = map_name.to_lowercase();

    // Pass 1: exact match on data_name
    if let Some(info) = infos.values().find(|info| {
        info.data_name.to_lowercase() == map_name_lower
    }) {
        return Some(info);
    }

    // Pass 2: path-suffix match (data_name ends with "/map_name" or "\map_name")
    infos.values().find(|info| {
        let dn = info.data_name.to_lowercase();
        dn.ends_with(&format!("/{}", map_name_lower))
            || dn.ends_with(&format!("\\{}", map_name_lower))
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
        assert_eq!(read_fixed_string(data, 0, 5).unwrap(), "hello");
        assert_eq!(read_fixed_string(data, 0, 16).unwrap(), "hello");
        // Out of bounds returns None
        assert!(read_fixed_string(data, 0, 32).is_none());
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

    #[test]
    fn find_map_info_no_prefix_ambiguity() {
        let mut infos = HashMap::new();
        infos.insert(
            1,
            MapInfo {
                map_id: 1,
                data_name: "map/garner".to_string(),
                display_name: "Garner".to_string(),
                init_x: 100,
                init_y: 100,
                light_dir: [1.0, 1.0, -1.0],
                light_color: [255, 255, 255],
                show_switch: false,
            },
        );
        infos.insert(
            2,
            MapInfo {
                map_id: 2,
                data_name: "map/garner2".to_string(),
                display_name: "Garner2".to_string(),
                init_x: 200,
                init_y: 200,
                light_dir: [1.0, 1.0, -1.0],
                light_color: [255, 255, 255],
                show_switch: false,
            },
        );

        // "garner" must match map_id=1, NOT map_id=2
        let found = find_map_info(&infos, "garner");
        assert!(found.is_some());
        assert_eq!(found.unwrap().map_id, 1, "should match garner, not garner2");

        // "garner2" must match map_id=2
        let found2 = find_map_info(&infos, "garner2");
        assert!(found2.is_some());
        assert_eq!(found2.unwrap().map_id, 2);
    }
}
