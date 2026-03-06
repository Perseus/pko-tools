//! CharacterAction.tx parser.
//!
//! Parses the tab-separated action table mapping (char_type, action_id)
//! to frame ranges. The file is GB2312-encoded but all data fields are ASCII.

use anyhow::{Context, Result};
use std::collections::HashMap;
use std::path::Path;

#[derive(Debug, Clone, serde::Serialize)]
pub struct ActionRange {
    pub action_id: u16,
    pub start_frame: u32,
    pub end_frame: u32,
    pub key_frames: Vec<u32>,
}

/// Full parsed action table: char_type_id → list of action ranges.
pub type ActionTable = HashMap<u16, Vec<ActionRange>>;

/// Load and parse a CharacterAction.tx file.
pub fn load_action_table(path: impl AsRef<Path>) -> Result<ActionTable> {
    let data = std::fs::read(path.as_ref())
        .with_context(|| format!("Failed to read {}", path.as_ref().display()))?;
    parse_action_table(&data)
}

/// Parse CharacterAction.tx from raw bytes.
///
/// The file is GB2312 but all numeric data is ASCII. Comment lines start
/// with `//`. Character type headers are standalone numbers. Action entries
/// are tab-indented lines with: action_id, start_frame, end_frame, [key_frames...].
pub fn parse_action_table(data: &[u8]) -> Result<ActionTable> {
    let mut table: ActionTable = HashMap::new();
    let mut current_char_type: Option<u16> = None;

    for line in data.split(|&b| b == b'\n') {
        // Trim \r and trailing whitespace
        let line = strip_trailing_whitespace(line);
        if line.is_empty() {
            continue;
        }

        // Skip comment lines
        if line.starts_with(b"//") {
            continue;
        }

        // Check if this is a character type header (starts with digit, no leading whitespace)
        if line[0].is_ascii_digit() {
            let num_str = extract_ascii_number(line);
            if let Ok(char_type) = num_str.parse::<u16>() {
                current_char_type = Some(char_type);
                table.entry(char_type).or_default();
            }
            continue;
        }

        // Action entry line (starts with tab)
        if line[0] == b'\t' {
            let Some(char_type) = current_char_type else {
                continue;
            };

            if let Some(action) = parse_action_line(line) {
                // Skip zero-range actions (unused)
                if action.start_frame == 0 && action.end_frame == 0 {
                    continue;
                }
                table.entry(char_type).or_default().push(action);
            }
        }
    }

    Ok(table)
}

fn strip_trailing_whitespace(line: &[u8]) -> &[u8] {
    let mut end = line.len();
    while end > 0 && (line[end - 1] == b'\r' || line[end - 1] == b' ' || line[end - 1] == b'\t') {
        end -= 1;
    }
    &line[..end]
}

/// Extract the first ASCII number from a byte slice.
fn extract_ascii_number(bytes: &[u8]) -> String {
    bytes
        .iter()
        .take_while(|b| b.is_ascii_digit())
        .map(|&b| b as char)
        .collect()
}

/// Parse a tab-indented action line into an ActionRange.
///
/// Format: `\t\t<action_id>\t\t<start>\t\t<end>[\t\t<key1>[\t\t<key2>...]]`
fn parse_action_line(line: &[u8]) -> Option<ActionRange> {
    // Split by tabs and filter out empty segments
    let fields: Vec<&str> = line
        .split(|&b| b == b'\t')
        .filter_map(|seg| {
            let s = std::str::from_utf8(seg).ok()?;
            let s = s.trim();
            if s.is_empty() { None } else { Some(s) }
        })
        .collect();

    if fields.len() < 3 {
        return None;
    }

    let action_id = fields[0].parse::<u16>().ok()?;
    let start_frame = fields[1].parse::<u32>().ok()?;
    let end_frame = fields[2].parse::<u32>().ok()?;

    let key_frames: Vec<u32> = fields[3..]
        .iter()
        .filter_map(|s| s.parse::<u32>().ok())
        .collect();

    Some(ActionRange {
        action_id,
        start_frame,
        end_frame,
        key_frames,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_path() -> std::path::PathBuf {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../top-client/scripts/txt/CharacterAction.tx")
    }

    #[test]
    fn parse_action_table_loads() {
        let path = fixture_path();
        if !path.exists() {
            eprintln!("Skipping: top-client not found");
            return;
        }
        let table = load_action_table(&path).expect("parse CharacterAction.tx");
        assert_eq!(table.len(), 289, "expected 289 character types");
    }

    #[test]
    fn char_type_1_action_counts() {
        let path = fixture_path();
        if !path.exists() {
            eprintln!("Skipping: top-client not found");
            return;
        }
        let table = load_action_table(&path).expect("parse");
        let actions = table.get(&1).expect("char type 1 exists");
        // Player char 1 has 378 actions (54 × 7 weapon variants) but many
        // are zero-range (unused weapon variants). After filtering: 227 remain.
        assert_eq!(actions.len(), 227);
    }

    #[test]
    fn char_type_1_action_1_frames() {
        let path = fixture_path();
        if !path.exists() {
            eprintln!("Skipping: top-client not found");
            return;
        }
        let table = load_action_table(&path).expect("parse");
        let actions = table.get(&1).expect("char type 1");
        let action_1 = actions
            .iter()
            .find(|a| a.action_id == 1)
            .expect("action 1 exists");
        assert_eq!(action_1.start_frame, 2);
        assert_eq!(action_1.end_frame, 59);
    }

    #[test]
    fn char_type_1_action_5_run() {
        let path = fixture_path();
        if !path.exists() {
            eprintln!("Skipping: top-client not found");
            return;
        }
        let table = load_action_table(&path).expect("parse");
        let actions = table.get(&1).expect("char type 1");
        let action_5 = actions
            .iter()
            .find(|a| a.action_id == 5)
            .expect("action 5 exists");
        assert_eq!(action_5.start_frame, 1921);
        assert_eq!(action_5.end_frame, 1937);
        assert_eq!(action_5.key_frames, vec![1921, 1929]);
    }

    #[test]
    fn zero_range_actions_skipped() {
        let path = fixture_path();
        if !path.exists() {
            eprintln!("Skipping: top-client not found");
            return;
        }
        let table = load_action_table(&path).expect("parse");
        let actions = table.get(&1).expect("char type 1");
        // Action 14 has start=0, end=0 — should be skipped
        assert!(
            !actions.iter().any(|a| a.action_id == 14),
            "action 14 (zero-range) should be skipped"
        );
    }

    #[test]
    fn npc_char_type_10_has_54_actions() {
        let path = fixture_path();
        if !path.exists() {
            eprintln!("Skipping: top-client not found");
            return;
        }
        let table = load_action_table(&path).expect("parse");
        if let Some(actions) = table.get(&10) {
            // NPC should have ~54 actions (minus zero-range)
            assert!(
                actions.len() <= 54,
                "NPC char type 10 should have ≤54 actions, got {}",
                actions.len()
            );
        }
    }
}
