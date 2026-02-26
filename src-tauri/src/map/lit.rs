//! Parser for `scripts/txt/lit.tx` — the PKO lit overlay texture system.
//!
//! Each entry defines an overlay texture applied to a building primitive at runtime.
//! The overlay is applied as texture stage 1 with a configurable color operation.
//!
//! Format:
//! ```text
//! num: <count>
//! <idx>) <obj_type> <fields...>
//! ```
//!
//! obj_type 0 (character): `anim_type file mask str_num str_1...str_N`
//! obj_type 1 (scene): `anim_type file sub_id color_op str_num str_1...str_N`
//! obj_type 2 (item): `anim_type file sub_id color_op str_num str_1...str_N`

use std::path::Path;

use anyhow::{anyhow, Result};
use serde::Serialize;

/// A single lit overlay entry from lit.tx.
#[derive(Debug, Clone, Serialize)]
pub struct LitEntry {
    /// 0 = character, 1 = scene object, 2 = item
    pub obj_type: u32,
    /// Animation type for the overlay UV
    pub anim_type: u32,
    /// Model filename (e.g., "02010005.lgo")
    pub file: String,
    /// Sub-ID (only for scene/item; ignored at runtime by LitMgr::Lit())
    pub sub_id: u32,
    /// D3D texture stage color operation (e.g., 9 = D3DTOP_ADDSMOOTH)
    pub color_op: u32,
    /// Overlay texture filename (first entry in str_buf)
    pub overlay_texture: Option<String>,
    /// All texture filenames from str_buf
    pub textures: Vec<String>,
}

/// Parse the lit.tx file and return all entries.
pub fn parse_lit_tx(path: &Path) -> Result<Vec<LitEntry>> {
    let content = std::fs::read_to_string(path)?;
    let mut lines = content.lines();

    // First line: "num: <count>"
    let first_line = lines.next().ok_or_else(|| anyhow!("empty lit.tx"))?;
    let count: usize = first_line
        .strip_prefix("num:")
        .or_else(|| first_line.strip_prefix("num :"))
        .ok_or_else(|| anyhow!("expected 'num: N' header, got: {}", first_line))?
        .trim()
        .parse()?;

    let mut entries = Vec::with_capacity(count);

    for line in lines {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        // Skip the "N) " prefix
        let rest = match line.find(')') {
            Some(i) => line[i + 1..].trim(),
            None => continue,
        };

        let tokens: Vec<&str> = rest.split_whitespace().collect();
        if tokens.is_empty() {
            continue;
        }

        let obj_type: u32 = tokens[0].parse().unwrap_or(0);

        match obj_type {
            0 => {
                // Character: anim_type file mask str_num str_1...
                if tokens.len() < 5 {
                    continue;
                }
                let anim_type: u32 = tokens[1].parse().unwrap_or(0);
                let file = tokens[2].to_string();
                let _mask = tokens[3];
                let str_num: usize = tokens[4].parse().unwrap_or(0);
                let textures: Vec<String> = tokens[5..5 + str_num.min(tokens.len() - 5)]
                    .iter()
                    .map(|s| s.to_string())
                    .collect();

                entries.push(LitEntry {
                    obj_type,
                    anim_type,
                    file,
                    sub_id: 0,
                    color_op: 0,
                    overlay_texture: textures.first().cloned(),
                    textures,
                });
            }
            1 | 2 => {
                // Scene/Item: anim_type file sub_id color_op str_num str_1...
                if tokens.len() < 6 {
                    continue;
                }
                let anim_type: u32 = tokens[1].parse().unwrap_or(0);
                let file = tokens[2].to_string();
                let sub_id: u32 = tokens[3].parse().unwrap_or(0);
                let color_op: u32 = tokens[4].parse().unwrap_or(0);
                let str_num: usize = tokens[5].parse().unwrap_or(0);
                let textures: Vec<String> = tokens[6..6 + str_num.min(tokens.len() - 6)]
                    .iter()
                    .map(|s| s.to_string())
                    .collect();

                entries.push(LitEntry {
                    obj_type,
                    anim_type,
                    file,
                    sub_id,
                    color_op,
                    overlay_texture: textures.first().cloned(),
                    textures,
                });
            }
            _ => continue,
        }
    }

    Ok(entries)
}

/// Get lit entries for scene objects only (obj_type == 1), keyed by filename.
pub fn get_scene_lit_entries(entries: &[LitEntry]) -> Vec<&LitEntry> {
    entries.iter().filter(|e| e.obj_type == 1).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_lit_tx_file() {
        let path = Path::new(
            "../top-client/corsairs-online-public/client/scripts/txt/lit.tx",
        );
        if !path.exists() {
            return;
        }

        let entries = parse_lit_tx(path).unwrap();
        assert_eq!(entries.len(), 9, "lit.tx should have 9 entries");

        // Check the scene entry (type 1)
        let scene_entries: Vec<_> = entries.iter().filter(|e| e.obj_type == 1).collect();
        assert_eq!(scene_entries.len(), 1, "should have 1 scene entry");
        assert_eq!(scene_entries[0].file, "02010005.lgo");
        assert_eq!(scene_entries[0].anim_type, 4);
        assert_eq!(scene_entries[0].color_op, 9);
        assert_eq!(scene_entries[0].textures.len(), 3);
        assert_eq!(scene_entries[0].overlay_texture.as_deref(), Some("cobweb.TGA"));

        // Character entries (type 0)
        let char_entries: Vec<_> = entries.iter().filter(|e| e.obj_type == 0).collect();
        assert_eq!(char_entries.len(), 7);

        // Thunder entries should have 5 textures each
        let thunder = char_entries
            .iter()
            .find(|e| e.file == "0000060002.lgo")
            .expect("should find thunder entry");
        assert_eq!(thunder.textures.len(), 5);
        assert_eq!(thunder.textures[0], "thunder01.TGA");
    }
}
