use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};

use super::model::{ForgeGlowDraft, ForgeGlowDraftSummary};

pub fn sanitize_slug(value: &str) -> String {
    let mut out = String::new();
    let mut last_was_dash = false;

    for ch in value.chars().flat_map(|c| c.to_lowercase()) {
        if ch.is_ascii_alphanumeric() {
            out.push(ch);
            last_was_dash = false;
        } else if !last_was_dash {
            out.push('-');
            last_was_dash = true;
        }
    }

    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "forge-glow-draft".to_string()
    } else {
        trimmed
    }
}

pub fn drafts_dir(project_dir: &Path) -> PathBuf {
    project_dir.join("pko-tools").join("forge-glows").join("drafts")
}

pub fn draft_path(project_dir: &Path, draft_id: &str) -> PathBuf {
    drafts_dir(project_dir).join(format!("{}.json", sanitize_slug(draft_id)))
}

pub fn save_draft(project_dir: &Path, draft: &ForgeGlowDraft) -> Result<()> {
    let path = draft_path(project_dir, &draft.id);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("Failed to create draft dir {}", parent.display()))?;
    }

    let json = serde_json::to_string_pretty(draft)?;
    fs::write(&path, json).with_context(|| format!("Failed to write draft {}", path.display()))
}

pub fn load_draft(project_dir: &Path, draft_id: &str) -> Result<ForgeGlowDraft> {
    let path = draft_path(project_dir, draft_id);
    let json =
        fs::read_to_string(&path).with_context(|| format!("Failed to read {}", path.display()))?;
    serde_json::from_str(&json).with_context(|| format!("Failed to parse {}", path.display()))
}

pub fn list_drafts(project_dir: &Path) -> Result<Vec<ForgeGlowDraftSummary>> {
    let dir = drafts_dir(project_dir);
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut drafts = Vec::new();
    for entry in fs::read_dir(&dir).with_context(|| format!("Failed to read {}", dir.display()))? {
        let entry = entry?;
        if entry.path().extension().and_then(|ext| ext.to_str()) != Some("json") {
            continue;
        }
        let json = fs::read_to_string(entry.path())?;
        let draft: ForgeGlowDraft = serde_json::from_str(&json)?;
        drafts.push(ForgeGlowDraftSummary::from(&draft));
    }
    drafts.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    Ok(drafts)
}

pub fn delete_draft(project_dir: &Path, draft_id: &str) -> Result<()> {
    let path = draft_path(project_dir, draft_id);
    if path.exists() {
        fs::remove_file(&path)
            .with_context(|| format!("Failed to delete draft {}", path.display()))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::forge_glow::model::ForgeGlowDraft;

    #[test]
    fn sanitize_slug_keeps_exports_path_safe() {
        assert_eq!(sanitize_slug("Fire Glow: +9/Blue"), "fire-glow-9-blue");
    }

    #[test]
    fn save_and_load_draft_round_trips() {
        let dir = tempfile::tempdir().unwrap();
        let draft = ForgeGlowDraft::new_for_test("draft-1", "Sword Glow");

        save_draft(dir.path(), &draft).unwrap();
        let loaded = load_draft(dir.path(), "draft-1").unwrap();

        assert_eq!(loaded.id, "draft-1");
        assert_eq!(loaded.name, "Sword Glow");
    }
}
