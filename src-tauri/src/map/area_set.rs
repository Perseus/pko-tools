use std::collections::HashMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

/// A single area definition from AreaSet.bin.
/// Each entry is keyed by btIsland (0-255) from the map tile data.
/// Used for per-area lighting, music, minimap color, and zone type.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AreaDefinition {
    pub area_id: u32,
    /// Minimap color (ARGB packed as [R, G, B, A])
    pub color: [u8; 4],
    /// Background music track index
    pub music: i32,
    /// Ambient/environment light color [R, G, B] (0-255)
    pub env_color: [u8; 3],
    /// Directional light color [R, G, B] (0-255)
    pub light_color: [u8; 3],
    /// Directional light direction vector [x, y, z]
    pub light_dir: [f32; 3],
    /// Zone type: 0=wilderness (PK enabled), 1=city (safe zone)
    pub zone_type: u8,
}

// CRawDataInfo base layout constants (shared with sceneobjinfo, sceneffectinfo)
const RAW_DATA_INFO_BEXIST_OFFSET: usize = 0;
const RAW_DATA_INFO_NID_OFFSET: usize = 100;

// AreaSet derived fields start after CRawDataInfo base (108 bytes)
const AREA_DERIVED_OFFSET: usize = 108;

fn read_u32(data: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(data[offset..offset + 4].try_into().unwrap())
}

fn read_i32(data: &[u8], offset: usize) -> i32 {
    i32::from_le_bytes(data[offset..offset + 4].try_into().unwrap())
}

fn read_f32(data: &[u8], offset: usize) -> f32 {
    f32::from_le_bytes(data[offset..offset + 4].try_into().unwrap())
}

/// Unpack Windows RGB() DWORD (0x00BBGGRR) to [R, G, B, A].
/// The Windows RGB() macro stores as: R in byte 0, G in byte 1, B in byte 2.
/// Used for AreaSet's dwColor (minimap color).
fn unpack_windows_rgb(dword: u32) -> [u8; 4] {
    let r = (dword & 0xFF) as u8;
    let g = ((dword >> 8) & 0xFF) as u8;
    let b = ((dword >> 16) & 0xFF) as u8;
    [r, g, b, 255] // Windows RGB has no alpha channel, default to opaque
}

/// Unpack D3D ARGB DWORD (0xAARRGGBB) to [R, G, B] (drop alpha).
/// Used for AreaSet's dwEnvColor and dwLightColor.
fn unpack_argb_rgb(dword: u32) -> [u8; 3] {
    let r = ((dword >> 16) & 0xFF) as u8;
    let g = ((dword >> 8) & 0xFF) as u8;
    let b = (dword & 0xFF) as u8;
    [r, g, b]
}

/// Parse AreaSet.bin — CRawDataSet binary format.
///
/// Structure: CAreaRecord extends CRawDataInfo (108 bytes base)
/// Derived fields at offset 108:
///   dwColor:      DWORD (4 bytes) — minimap color (Windows RGB: 0x00BBGGRR)
///   nMusic:       int   (4 bytes) — background music track index
///   dwEnvColor:   DWORD (4 bytes) — ambient/environment light color (D3D ARGB: 0xAARRGGBB)
///   dwLightColor: DWORD (4 bytes) — directional light color (D3D ARGB: 0xAARRGGBB)
///   fLightDir[3]: float[3] (12 bytes) — directional light direction vector
///   chType:       char  (1 byte)  — zone type: 0=wilderness, 1=city
pub fn parse_area_set_bin(data: &[u8]) -> anyhow::Result<HashMap<u32, AreaDefinition>> {
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

        let area_id = read_u32(chunk, RAW_DATA_INFO_NID_OFFSET);

        // Derived fields
        let d = AREA_DERIVED_OFFSET;
        if chunk.len() < d + 29 {
            continue; // Not enough data for derived fields
        }

        let dw_color = read_u32(chunk, d);
        let n_music = read_i32(chunk, d + 4);
        let dw_env_color = read_u32(chunk, d + 8);
        let dw_light_color = read_u32(chunk, d + 12);
        let light_dir = [
            read_f32(chunk, d + 16),
            read_f32(chunk, d + 20),
            read_f32(chunk, d + 24),
        ];
        let ch_type = chunk[d + 28];

        map.insert(
            area_id,
            AreaDefinition {
                area_id,
                color: unpack_windows_rgb(dw_color),
                music: n_music,
                env_color: unpack_argb_rgb(dw_env_color),
                light_color: unpack_argb_rgb(dw_light_color),
                light_dir,
                zone_type: ch_type,
            },
        );
    }

    Ok(map)
}

/// Load and parse AreaSet.bin from a project directory.
pub fn load_area_set(project_dir: &Path) -> anyhow::Result<HashMap<u32, AreaDefinition>> {
    let bin_path = project_dir.join("scripts/table/AreaSet.bin");
    if bin_path.exists() {
        let data = std::fs::read(&bin_path)?;
        return parse_area_set_bin(&data);
    }

    // Try lowercase variant
    let bin_path_lower = project_dir.join("scripts/table/areaset.bin");
    if bin_path_lower.exists() {
        let data = std::fs::read(&bin_path_lower)?;
        return parse_area_set_bin(&data);
    }

    Ok(HashMap::new())
}

/// Convert area definitions to JSON-serializable format for manifest.
/// Keyed by area_id (btIsland value) as string.
pub fn areas_to_json(areas: &HashMap<u32, AreaDefinition>) -> serde_json::Value {
    let mut map = serde_json::Map::new();

    for (id, area) in areas {
        map.insert(
            id.to_string(),
            serde_json::json!({
                "color": area.color,
                "music": area.music,
                "env_color": area.env_color,
                "light_color": area.light_color,
                "light_dir": area.light_dir,
                "zone_type": area.zone_type,
            }),
        );
    }

    serde_json::Value::Object(map)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unpack_windows_rgb_white() {
        // Windows RGB(255, 255, 255) = 0x00FFFFFF
        let result = unpack_windows_rgb(0x00FFFFFF);
        assert_eq!(result, [255, 255, 255, 255]);
    }

    #[test]
    fn unpack_windows_rgb_color() {
        // Windows RGB(140, 180, 220) = 0x00DC_B48C (B=220 << 16 | G=180 << 8 | R=140)
        let val = 140u32 | (180 << 8) | (220 << 16);
        let result = unpack_windows_rgb(val);
        assert_eq!(result, [140, 180, 220, 255]);
    }

    #[test]
    fn unpack_argb_rgb_drops_alpha() {
        // D3D ARGB: 0xFF112233 → [R=0x11, G=0x22, B=0x33]
        let result = unpack_argb_rgb(0xFF112233);
        assert_eq!(result, [0x11, 0x22, 0x33]);
    }

    #[test]
    fn parse_empty() {
        let map = parse_area_set_bin(&[]).unwrap();
        assert!(map.is_empty());

        let map = parse_area_set_bin(&0u32.to_le_bytes()).unwrap();
        assert!(map.is_empty());
    }

    #[test]
    fn parse_real_data() {
        let bin_path = std::path::PathBuf::from("../top-client/scripts/table/AreaSet.bin");
        if !bin_path.exists() {
            return;
        }

        let data = std::fs::read(&bin_path).unwrap();
        let map = parse_area_set_bin(&data).unwrap();

        assert!(!map.is_empty(), "should have area entries");
        eprintln!("AreaSet.bin: {} entries", map.len());

        for (id, area) in map.iter().take(5) {
            eprintln!(
                "  area_id={}, color={:?}, music={}, env_color={:?}, light_color={:?}, light_dir={:?}, zone_type={}",
                id, area.color, area.music, area.env_color, area.light_color, area.light_dir, area.zone_type
            );
        }

        // Basic sanity: colors should have reasonable values
        for area in map.values() {
            assert!(area.zone_type <= 1, "zone_type should be 0 or 1, got {}", area.zone_type);
        }
    }

    #[test]
    fn areas_to_json_format() {
        let mut areas = HashMap::new();
        areas.insert(1, AreaDefinition {
            area_id: 1,
            color: [140, 220, 180, 255],
            music: 3,
            env_color: [255, 255, 255],
            light_color: [153, 153, 153],
            light_dir: [-1.0, -1.0, -1.0],
            zone_type: 1,
        });

        let json = areas_to_json(&areas);
        assert!(json.is_object());
        let obj = json.as_object().unwrap();
        assert!(obj.contains_key("1"));
        let entry = &obj["1"];
        assert_eq!(entry["music"], 3);
        assert_eq!(entry["zone_type"], 1);
    }
}
