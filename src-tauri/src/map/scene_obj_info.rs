use std::collections::HashMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

/// A scene object model entry from sceneobjinfo.bin.
///
/// Parses all CSceneObjInfo fields (extends CRawDataInfo, 108-byte base).
/// Struct layout verified against real sceneobjinfo.bin (276-byte entries, 593 records).
///
/// Field offsets (from start of each entry):
///   0: bExist (i32)         — CRawDataInfo base
///   8: szDataName[72]       — .lmo filename
/// 100: nID (u32)            — object ID
/// 108: szName[16]           — display name
/// 124: nType (i32)          — 0=normal, 3=point light, 4=ambient light, 6=env sound
/// 128: btPointColor[3]      — point light RGB
/// 131: btEnvColor[3]        — ambient light RGB
/// 134: btFogColor[3]        — fog RGB
/// 137: (3 bytes padding)
/// 140: nRange (i32)         — point light range
/// 144: Attenuation1 (f32)   — point light attenuation
/// 148: nAnimCtrlID (i32)    — point light animation controller ID
/// 152: nStyle (i32)         — rendering style
/// 156: nAttachEffectID (i32) — attached .eff ID
/// 160: bEnablePointLight (i32/BOOL)
/// 164: bEnableEnvLight (i32/BOOL)
/// 168: nFlag (i32)          — other flags
/// 172: nSizeFlag (i32)      — visibility culling for oversized objects
/// 176: szEnvSound[11]       — environment sound filename
/// 187: (1 byte padding)
/// 188: nEnvSoundDis (i32)   — sound distance in centimeters
/// 192: nPhotoTexID (i32)    — icon texture ID
/// 196: bShadeFlag (i32/BOOL) — whether to tint by tile color
/// 200: bIsReallyBig (i32/BOOL) — special culling for oversized objects
/// 204: nFadeObjNum (i32)    — number of fade object references
/// 208: nFadeObjSeq[16] (i32×16) — fade object IDs
/// 272: fFadeCoefficent (f32) — fade coefficient
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct SceneObjModelInfo {
    pub id: u32,
    pub filename: String,
    // --- C3: semantic fields ---
    pub display_name: String,
    /// 0=normal building, 3=point light, 4=ambient light, 6=env sound
    pub obj_type: i32,
    /// Whether to tint the building's material by the terrain tile color at its position
    pub shade_flag: bool,
    pub enable_point_light: bool,
    pub enable_env_light: bool,
    pub attach_effect_id: i32,
    pub style: i32,
    pub flag: i32,
    pub size_flag: i32,
    pub anim_ctrl_id: i32,
    pub is_really_big: bool,
    // Point light data (only meaningful when obj_type == 3)
    pub point_color: [u8; 3],
    pub env_color: [u8; 3],
    pub point_range: i32,
    pub point_attenuation: f32,
}

// CRawDataInfo layout constants (same as sceneffect.rs)
const RAW_DATA_INFO_BEXIST_OFFSET: usize = 0;
const RAW_DATA_INFO_SZDATA_OFFSET: usize = 8;
const RAW_DATA_INFO_SZDATA_LEN: usize = 72;
const RAW_DATA_INFO_NID_OFFSET: usize = 100;

// CSceneObjInfo derived field offsets (from entry start)
const SCENE_OBJ_SZNAME_OFFSET: usize = 108;
const SCENE_OBJ_SZNAME_LEN: usize = 16;
const SCENE_OBJ_NTYPE_OFFSET: usize = 124;
const SCENE_OBJ_POINT_COLOR_OFFSET: usize = 128;
const SCENE_OBJ_ENV_COLOR_OFFSET: usize = 131;
// const SCENE_OBJ_FOG_COLOR_OFFSET: usize = 134; // Parsed but not exported (unused at runtime)
const SCENE_OBJ_NRANGE_OFFSET: usize = 140;
const SCENE_OBJ_ATTENUATION1_OFFSET: usize = 144;
const SCENE_OBJ_NANIM_CTRL_ID_OFFSET: usize = 148;
const SCENE_OBJ_NSTYLE_OFFSET: usize = 152;
const SCENE_OBJ_NATTACH_EFFECT_ID_OFFSET: usize = 156;
const SCENE_OBJ_BENABLE_POINT_LIGHT_OFFSET: usize = 160;
const SCENE_OBJ_BENABLE_ENV_LIGHT_OFFSET: usize = 164;
const SCENE_OBJ_NFLAG_OFFSET: usize = 168;
const SCENE_OBJ_NSIZE_FLAG_OFFSET: usize = 172;
// const SCENE_OBJ_SZENVSOUND_OFFSET: usize = 176; // Parsed but not exported
const SCENE_OBJ_BSHADE_FLAG_OFFSET: usize = 196;
const SCENE_OBJ_BIS_REALLY_BIG_OFFSET: usize = 200;

/// Minimum entry size needed to parse all CSceneObjInfo fields (through bIsReallyBig)
const MIN_DERIVED_SIZE: usize = 204;

fn read_u32(data: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(data[offset..offset + 4].try_into().unwrap())
}

fn read_i32(data: &[u8], offset: usize) -> i32 {
    i32::from_le_bytes(data[offset..offset + 4].try_into().unwrap())
}

fn read_f32(data: &[u8], offset: usize) -> f32 {
    f32::from_le_bytes(data[offset..offset + 4].try_into().unwrap())
}

fn read_bool(data: &[u8], offset: usize) -> bool {
    read_i32(data, offset) != 0
}

fn read_cstr(data: &[u8], offset: usize, max_len: usize) -> String {
    let slice = &data[offset..offset + max_len];
    let end = slice.iter().position(|&b| b == 0).unwrap_or(max_len);
    String::from_utf8_lossy(&slice[..end]).to_string()
}

/// Parse sceneobjinfo.bin — CRawDataSet binary format.
///
/// Structure: CSceneObjInfo extends CRawDataInfo (108 bytes base).
/// Uses entry_size from the file header (first 4 bytes) as authoritative record stride.
pub fn parse_scene_obj_info_bin(data: &[u8]) -> anyhow::Result<HashMap<u32, SceneObjModelInfo>> {
    if data.len() < 4 {
        return Ok(HashMap::new());
    }

    let entry_size = read_u32(data, 0) as usize;
    if entry_size == 0 {
        return Ok(HashMap::new());
    }

    let has_derived_fields = entry_size >= MIN_DERIVED_SIZE;

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

        // Parse derived CSceneObjInfo fields if the entry is large enough
        let (
            display_name,
            obj_type,
            shade_flag,
            enable_point_light,
            enable_env_light,
            attach_effect_id,
            style,
            flag,
            size_flag,
            anim_ctrl_id,
            is_really_big,
            point_color,
            env_color,
            point_range,
            point_attenuation,
        ) = if has_derived_fields {
            let display_name =
                read_cstr(chunk, SCENE_OBJ_SZNAME_OFFSET, SCENE_OBJ_SZNAME_LEN);
            let obj_type = read_i32(chunk, SCENE_OBJ_NTYPE_OFFSET);
            let shade_flag = read_bool(chunk, SCENE_OBJ_BSHADE_FLAG_OFFSET);
            let enable_point_light = read_bool(chunk, SCENE_OBJ_BENABLE_POINT_LIGHT_OFFSET);
            let enable_env_light = read_bool(chunk, SCENE_OBJ_BENABLE_ENV_LIGHT_OFFSET);
            let attach_effect_id = read_i32(chunk, SCENE_OBJ_NATTACH_EFFECT_ID_OFFSET);
            let style = read_i32(chunk, SCENE_OBJ_NSTYLE_OFFSET);
            let flag = read_i32(chunk, SCENE_OBJ_NFLAG_OFFSET);
            let size_flag = read_i32(chunk, SCENE_OBJ_NSIZE_FLAG_OFFSET);
            let anim_ctrl_id = read_i32(chunk, SCENE_OBJ_NANIM_CTRL_ID_OFFSET);
            let is_really_big = read_bool(chunk, SCENE_OBJ_BIS_REALLY_BIG_OFFSET);
            let point_color = [
                chunk[SCENE_OBJ_POINT_COLOR_OFFSET],
                chunk[SCENE_OBJ_POINT_COLOR_OFFSET + 1],
                chunk[SCENE_OBJ_POINT_COLOR_OFFSET + 2],
            ];
            let env_color = [
                chunk[SCENE_OBJ_ENV_COLOR_OFFSET],
                chunk[SCENE_OBJ_ENV_COLOR_OFFSET + 1],
                chunk[SCENE_OBJ_ENV_COLOR_OFFSET + 2],
            ];
            let point_range = read_i32(chunk, SCENE_OBJ_NRANGE_OFFSET);
            let point_attenuation = read_f32(chunk, SCENE_OBJ_ATTENUATION1_OFFSET);
            (
                display_name,
                obj_type,
                shade_flag,
                enable_point_light,
                enable_env_light,
                attach_effect_id,
                style,
                flag,
                size_flag,
                anim_ctrl_id,
                is_really_big,
                point_color,
                env_color,
                point_range,
                point_attenuation,
            )
        } else {
            // Fallback: minimal entry with only base fields
            (
                String::new(),
                0,
                false,
                false,
                true,
                0,
                0,
                0,
                0,
                0,
                false,
                [0; 3],
                [0; 3],
                0,
                0.0,
            )
        };

        map.insert(
            id,
            SceneObjModelInfo {
                id,
                filename,
                display_name,
                obj_type,
                shade_flag,
                enable_point_light,
                enable_env_light,
                attach_effect_id,
                style,
                flag,
                size_flag,
                anim_ctrl_id,
                is_really_big,
                point_color,
                env_color,
                point_range,
                point_attenuation,
            },
        );
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

        // All filenames should end with .lmo
        for info in map.values() {
            assert!(
                info.filename.to_lowercase().ends_with(".lmo"),
                "filename '{}' should end with .lmo",
                info.filename
            );
        }
    }

    #[test]
    fn parse_bin_semantic_fields() {
        let bin_path = std::path::PathBuf::from("../top-client/scripts/table/sceneobjinfo.bin");
        if !bin_path.exists() {
            return;
        }

        let data = std::fs::read(&bin_path).unwrap();
        let map = parse_scene_obj_info_bin(&data).unwrap();

        // Entry 5 (Argent Blacksmith) should have shadeFlag=true
        if let Some(info) = map.get(&5) {
            assert!(
                info.shade_flag,
                "id=5 should have shade_flag=true, got false"
            );
            assert!(info.display_name.starts_with("Argent Blacksmit"));
            assert_eq!(info.obj_type, 0, "should be a normal building");
        }

        // Count entries with shade_flag
        let shaded = map.values().filter(|v| v.shade_flag).count();
        assert!(shaded > 100, "expected many shaded entries, got {}", shaded);

        // Should have various object types
        let types: std::collections::HashSet<i32> =
            map.values().map(|v| v.obj_type).collect();
        assert!(
            types.contains(&0),
            "should have type 0 (normal buildings)"
        );
        eprintln!(
            "Object types present: {:?}, shaded: {}/{}",
            types,
            shaded,
            map.len()
        );
    }

    #[test]
    fn parse_bin_point_lights() {
        let bin_path = std::path::PathBuf::from("../top-client/scripts/table/sceneobjinfo.bin");
        if !bin_path.exists() {
            return;
        }

        let data = std::fs::read(&bin_path).unwrap();
        let map = parse_scene_obj_info_bin(&data).unwrap();

        // Check that type-3 entries (point lights) exist
        let point_lights: Vec<_> = map.values().filter(|v| v.obj_type == 3).collect();
        if !point_lights.is_empty() {
            eprintln!("Found {} point light entries", point_lights.len());
            for pl in &point_lights {
                eprintln!(
                    "  id={}, file={}, color={:?}, enablePt={}",
                    pl.id, pl.filename, pl.point_color, pl.enable_point_light
                );
            }
        }
    }
}
