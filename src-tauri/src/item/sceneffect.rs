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

/// Load and parse sceneffectinfo.txt from a project directory
pub fn load_scene_effect_info(project_dir: &Path) -> anyhow::Result<HashMap<u32, SceneEffectInfo>> {
    let path = project_dir.join("scripts/table/sceneffectinfo.txt");
    if !path.exists() {
        return Ok(HashMap::new());
    }

    let text = std::fs::read_to_string(&path)?;
    Ok(parse_scene_effect_info(&text))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_basic_entry() {
        let input = "100\teffect_fire.par\tFire Effect\tfire_photo\t3\t1\t1,2,3\t-1\t0.5\t10.0\t5\t2\n";
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
}
