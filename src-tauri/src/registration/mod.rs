pub mod commands;

use std::path::Path;

use crate::character::Character;

/// Check if a model ID (Framework Number) is already in use in CharacterInfo.txt.
pub fn is_model_id_available(project_dir: &Path, model_id: u32) -> anyhow::Result<bool> {
    let char_info_path = project_dir.join("scripts/table/CharacterInfo.txt");

    if !char_info_path.exists() {
        return Err(anyhow::anyhow!("CharacterInfo.txt not found"));
    }

    let mut reader = csv::ReaderBuilder::new()
        .delimiter(b'\t')
        .has_headers(false)
        .comment(Some(b'/'))
        .flexible(true)
        .from_reader(std::fs::File::open(&char_info_path)?);

    for result in reader.deserialize::<Character>() {
        if let Ok(character) = result {
            if character.model as u32 == model_id {
                return Ok(false);
            }
        }
    }

    Ok(true)
}

/// Find the next available model ID (Framework Number) by scanning CharacterInfo.txt.
pub fn get_next_available_model_id(project_dir: &Path) -> anyhow::Result<u32> {
    let char_info_path = project_dir.join("scripts/table/CharacterInfo.txt");

    if !char_info_path.exists() {
        return Err(anyhow::anyhow!("CharacterInfo.txt not found"));
    }

    let mut reader = csv::ReaderBuilder::new()
        .delimiter(b'\t')
        .has_headers(false)
        .comment(Some(b'/'))
        .flexible(true)
        .from_reader(std::fs::File::open(&char_info_path)?);

    let mut max_model_id: u32 = 0;

    for result in reader.deserialize::<Character>() {
        if let Ok(character) = result {
            let model = character.model as u32;
            if model > max_model_id {
                max_model_id = model;
            }
        }
    }

    Ok(max_model_id + 1)
}

/// Find the next available character ID by scanning CharacterInfo.txt.
fn get_next_character_id(project_dir: &Path) -> anyhow::Result<u32> {
    let char_info_path = project_dir.join("scripts/table/CharacterInfo.txt");

    let mut reader = csv::ReaderBuilder::new()
        .delimiter(b'\t')
        .has_headers(false)
        .comment(Some(b'/'))
        .flexible(true)
        .from_reader(std::fs::File::open(&char_info_path)?);

    let mut max_id: u32 = 0;

    for result in reader.deserialize::<Character>() {
        if let Ok(character) = result {
            if character.id > max_id {
                max_id = character.id;
            }
        }
    }

    Ok(max_id + 1)
}

/// Append a new character entry to CharacterInfo.txt.
///
/// Creates a minimal entry with the given model_id and name.
/// The entry uses default values for most fields - the user can
/// customize via the game's data editor tools.
pub fn register_character(
    project_dir: &Path,
    model_id: u32,
    name: &str,
) -> anyhow::Result<u32> {
    let char_info_path = project_dir.join("scripts/table/CharacterInfo.txt");

    if !char_info_path.exists() {
        return Err(anyhow::anyhow!("CharacterInfo.txt not found"));
    }

    // Check model ID is available
    if !is_model_id_available(project_dir, model_id)? {
        return Err(anyhow::anyhow!(
            "Model ID {} is already in use",
            model_id
        ));
    }

    let character_id = get_next_character_id(project_dir)?;

    // Build a tab-separated line matching the CharacterInfo.txt format.
    // Fields: ID, Name, IconName, ModelType, CtrlType, Model, SuitID, SuitNum,
    //         Part0-7, FeffID, EeffID, EffActionID, Shadow, ActionID,
    //         then 131 remaining fields (all 0s for defaults).
    let mut fields: Vec<String> = Vec::with_capacity(154);
    fields.push(character_id.to_string());     // ID
    fields.push(name.to_string());              // Name
    fields.push(String::new());                 // IconName
    fields.push("4".to_string());               // ModelType (4 = NPC-like)
    fields.push("1".to_string());               // CtrlType
    fields.push(model_id.to_string());          // Model (Framework Number)
    fields.push("0".to_string());               // SuitID
    fields.push("1".to_string());               // SuitNum
    fields.push("1".to_string());               // Part0 (has at least 1 mesh)
    for _ in 0..7 {
        fields.push("0".to_string());           // Part1-7
    }
    fields.push("0,0".to_string());             // FeffID
    fields.push("0".to_string());               // EeffID
    fields.push("0".to_string());               // EffActionID
    fields.push("0".to_string());               // Shadow
    fields.push("1".to_string());               // ActionID

    // Fill remaining fields with zeros to match expected column count
    while fields.len() < 154 {
        fields.push("0".to_string());
    }

    let line = fields.join("\t");

    // Append to file
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .append(true)
        .open(&char_info_path)?;
    writeln!(file, "{}", line)?;

    Ok(character_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_id_check_nonexistent_dir() {
        let result = is_model_id_available(Path::new("/nonexistent/path"), 100);
        assert!(result.is_err());
    }
}
