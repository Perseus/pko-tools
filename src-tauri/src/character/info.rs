use std::{
    collections::{BTreeMap, HashSet},
    path::{Path, PathBuf},
};

use crate::client_paths;
use crate::projects;
use crate::text_encoding;

use super::Character;

pub fn parse_character_info(path: PathBuf) -> anyhow::Result<Vec<Character>> {
    let mut reader = csv::ReaderBuilder::new()
        .delimiter(b'\t')
        .has_headers(false)
        .comment(Some(b'/'))
        .flexible(true)
        .from_reader(std::fs::File::open(path)?);

    let mut characters = vec![];

    for result in reader.deserialize::<Character>() {
        match result {
            Ok(char) => {
                characters.push(char);
            }
            Err(e) => {
                println!("Error parsing character info: {:?}", e);
            }
        }
    }

    Ok(characters)
}

fn read_u16(data: &[u8], offset: usize) -> Option<u16> {
    data.get(offset..offset + 2)
        .and_then(|bytes| bytes.try_into().ok())
        .map(u16::from_le_bytes)
}

fn read_u32(data: &[u8], offset: usize) -> Option<u32> {
    data.get(offset..offset + 4)
        .and_then(|bytes| bytes.try_into().ok())
        .map(u32::from_le_bytes)
}

fn read_i32(data: &[u8], offset: usize) -> Option<i32> {
    data.get(offset..offset + 4)
        .and_then(|bytes| bytes.try_into().ok())
        .map(i32::from_le_bytes)
}

fn read_gbk_cstr(data: &[u8], offset: usize, max_len: usize) -> String {
    text_encoding::read_gbk_cstr(data, offset, max_len).unwrap_or_default()
}

fn character_model_dir_for_bin(path: &Path) -> Option<PathBuf> {
    let table_dir = path.parent()?;
    if table_dir
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.eq_ignore_ascii_case("table"))
        && table_dir
            .parent()
            .and_then(|parent| parent.file_name())
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.eq_ignore_ascii_case("scripts"))
    {
        return Some(
            table_dir
                .parent()?
                .parent()?
                .join("model")
                .join("character"),
        );
    }

    if table_dir
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.eq_ignore_ascii_case("table"))
    {
        return Some(table_dir.parent()?.join("model").join("character"));
    }

    None
}

fn collect_character_model_prefixes(path: &Path) -> HashSet<String> {
    collect_character_model_parts(path)
        .keys()
        .map(|(model, suit_id)| format!("{:0>4}{:0>2}", model, suit_id))
        .collect()
}

fn collect_character_model_parts(path: &Path) -> BTreeMap<(u16, u16), u16> {
    let mut parts: BTreeMap<(u16, u16), u16> = BTreeMap::new();
    character_model_dir_for_bin(path)
        .and_then(|dir| std::fs::read_dir(dir).ok())
        .into_iter()
        .flat_map(|entries| entries.filter_map(Result::ok))
        .filter_map(|entry| {
            let path = entry.path();
            if !path
                .extension()
                .and_then(|ext| ext.to_str())
                .is_some_and(|ext| ext.eq_ignore_ascii_case("lgo"))
            {
                return None;
            }

            let stem = path.file_stem()?.to_str()?;
            if stem.len() != 10 || !stem.chars().all(|ch| ch.is_ascii_digit()) {
                return None;
            }
            let model = stem.get(0..4)?.parse::<u16>().ok()?;
            let suit_id = stem.get(4..6)?.parse::<u16>().ok()?;
            let part = stem.get(6..10)?.parse::<u16>().ok()?;
            Some(((model, suit_id), part))
        })
        .for_each(|(key, part)| {
            parts
                .entry(key)
                .and_modify(|existing| *existing = (*existing).min(part))
                .or_insert(part);
        });
    parts
}

fn compose_model_file_id(model: u16, suit_id: u16, part: u16) -> Option<u32> {
    (model as u32)
        .checked_mul(1_000_000)?
        .checked_add((suit_id as u32).checked_mul(10_000)?)?
        .checked_add(part as u32)
}

fn model_prefix(model: u16, suit_id: u16) -> Option<String> {
    compose_model_file_id(model, suit_id, 0)
        .map(|id| format!("{:0>10}", id).chars().take(6).collect::<String>())
}

fn has_model_prefix(prefixes: &HashSet<String>, model: u16, suit_id: u16) -> bool {
    model_prefix(model, suit_id).is_some_and(|prefix| prefixes.contains(&prefix))
}

fn select_model_and_suit(
    raw_model: u16,
    raw_suit: u16,
    alt_suit: u16,
    action_id: u16,
    first_part: u16,
    model_prefixes: &HashSet<String>,
    model_parts: &BTreeMap<(u16, u16), u16>,
) -> (u16, u16) {
    let suit = if raw_suit != 0 && raw_suit != u16::MAX {
        raw_suit
    } else {
        alt_suit
    };

    let candidates = [
        (raw_model, suit),
        (raw_model, alt_suit),
        (action_id, suit),
        (action_id, alt_suit),
    ];

    if !model_prefixes.is_empty() {
        if let Some((model, suit_id)) = candidates.iter().copied().find(|(model, suit_id)| {
            *model != 0 && has_model_prefix(model_prefixes, *model, *suit_id)
        }) {
            return (model, suit_id);
        }

        for model in [raw_model, action_id] {
            if model == 0 {
                continue;
            }
            if let Some(((model, suit_id), _)) = model_parts
                .iter()
                .find(|((candidate_model, _), _)| *candidate_model == model)
            {
                return (*model, *suit_id);
            }
        }
    }

    if raw_model != 0 && compose_model_file_id(raw_model, suit, first_part).is_some() {
        return (raw_model, suit);
    }

    if action_id != 0 && compose_model_file_id(action_id, alt_suit, first_part).is_some() {
        return (action_id, alt_suit);
    }

    (raw_model, suit)
}

/// Parse Demon Online's 64-bit CRawDataSet `CharRecord.bin` dump into the
/// subset of fields pko-tools needs for character/model workflows.
pub fn parse_char_record_bin(path: impl AsRef<Path>) -> anyhow::Result<Vec<Character>> {
    let path = path.as_ref();
    let data = std::fs::read(path)?;
    if data.len() < 4 {
        anyhow::bail!("CharRecord.bin too small");
    }

    let entry_size = read_u32(&data, 0).unwrap_or(0) as usize;
    if entry_size < 360 {
        anyhow::bail!("CharRecord.bin unexpected entry size: {}", entry_size);
    }

    let record_count = (data.len() - 4) / entry_size;
    let mut characters = Vec::new();
    let model_parts = collect_character_model_parts(path);
    let model_prefixes = collect_character_model_prefixes(path);

    for i in 0..record_count {
        let offset = 4 + i * entry_size;
        let record = &data[offset..offset + entry_size];
        if read_i32(record, 0).unwrap_or(0) == 0 {
            continue;
        }

        let id = read_u32(record, 104)
            .filter(|id| *id != 0)
            .unwrap_or_else(|| read_u32(record, 112).unwrap_or(0));
        if id == 0 {
            continue;
        }

        let name = read_gbk_cstr(record, 116, 64);
        let icon_name = read_gbk_cstr(record, 180, 32);
        let action_id = read_u16(record, 320).unwrap_or_else(|| read_u16(record, 254).unwrap_or(0));
        let first_part = read_u16(record, 324).unwrap_or(0);
        let (model, suit_id) = select_model_and_suit(
            read_u16(record, 292).unwrap_or(0),
            read_u16(record, 286).unwrap_or(0),
            read_u16(record, 322).unwrap_or(0),
            action_id,
            first_part,
            &model_prefixes,
            &model_parts,
        );
        let first_part = if first_part == 0 {
            model_parts.get(&(model, suit_id)).copied().unwrap_or(0)
        } else {
            first_part
        };

        characters.push(Character {
            id,
            name,
            icon_name,
            model_type: record.get(212).copied().unwrap_or(0),
            ctrl_type: record.get(213).copied().unwrap_or(0),
            model,
            suit_id,
            suit_num: if first_part == 0 { 0 } else { 1 },
            mesh_part_0: first_part,
            mesh_part_1: 0,
            mesh_part_2: 0,
            mesh_part_3: 0,
            mesh_part_4: 0,
            mesh_part_5: 0,
            mesh_part_6: 0,
            mesh_part_7: 0,
            feff_id: String::new(),
            eeff_id: 0,
            effect_action_id: String::new(),
            shadow: read_u16(record, 252).unwrap_or(0),
            action_id,
        });
    }

    Ok(characters)
}

pub fn parse_character_table(project_dir: &Path) -> anyhow::Result<Vec<Character>> {
    let character_info_file = client_paths::table_file(project_dir, "CharacterInfo.txt");
    if character_info_file.exists() {
        return parse_character_info(character_info_file);
    }

    let char_record_bin = client_paths::table_file(project_dir, "CharRecord.bin");
    if char_record_bin.exists() {
        return parse_char_record_bin(char_record_bin);
    }

    parse_character_info(character_info_file)
}

pub fn get_all_characters(project_id: uuid::Uuid) -> anyhow::Result<Vec<Character>> {
    if let Ok(project) = projects::project::Project::get_project(project_id) {
        let project_dir = project.project_directory;
        return parse_character_table(&project_dir);
    }

    Ok(vec![])
}

pub fn get_character(project_id: uuid::Uuid, character_id: u32) -> anyhow::Result<Character> {
    if let Ok(project) = projects::project::Project::get_project(project_id) {
        let project_dir = project.project_directory;
        let characters = parse_character_table(&project_dir)?;

        for character in characters {
            if character.id == character_id {
                return Ok(character);
            }
        }
    }

    Err(anyhow::anyhow!("Character not found"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_file(label: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "pko_tools_{}_{}_{}.bin",
            label,
            std::process::id(),
            stamp
        ))
    }

    fn temp_dir(label: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "pko_tools_{}_{}_{}",
            label,
            std::process::id(),
            stamp
        ))
    }

    fn put_u16(record: &mut [u8], offset: usize, value: u16) {
        record[offset..offset + 2].copy_from_slice(&value.to_le_bytes());
    }

    fn put_u32(record: &mut [u8], offset: usize, value: u32) {
        record[offset..offset + 4].copy_from_slice(&value.to_le_bytes());
    }

    #[test]
    fn parses_demon_char_record_bin_subset() {
        let entry_size = 360usize;
        let mut data = Vec::new();
        data.extend_from_slice(&(entry_size as u32).to_le_bytes());

        let mut record = vec![0u8; entry_size];
        put_u32(&mut record, 0, 1);
        put_u32(&mut record, 4, 7);
        put_u32(&mut record, 104, 3001);
        put_u32(&mut record, 112, 3001);
        record[116..120].copy_from_slice(b"Test");
        record[180..184].copy_from_slice(b"Icon");
        record[212] = 2;
        record[213] = 5;
        put_u16(&mut record, 286, 1);
        put_u16(&mut record, 292, 100);
        put_u16(&mut record, 320, 3001);
        put_u16(&mut record, 324, 100);
        data.extend_from_slice(&record);

        let path = temp_file("charrecord");
        fs::write(&path, data).unwrap();

        let characters = parse_char_record_bin(&path).unwrap();
        assert_eq!(characters.len(), 1);
        assert_eq!(characters[0].id, 3001);
        assert_eq!(characters[0].name, "Test");
        assert_eq!(characters[0].icon_name, "Icon");
        assert_eq!(characters[0].model_type, 2);
        assert_eq!(characters[0].ctrl_type, 5);
        assert_eq!(characters[0].model, 100);
        assert_eq!(characters[0].suit_id, 1);
        assert_eq!(characters[0].mesh_part_0, 100);
        assert_eq!(characters[0].action_id, 3001);

        let _ = fs::remove_file(path);
    }

    #[test]
    fn parses_demon_char_record_bin_uses_action_model_when_raw_model_is_invalid() {
        let root = temp_dir("demon_charrecord_models");
        let table_dir = root.join("Data").join("Table");
        let character_dir = root.join("Data").join("model").join("character");
        fs::create_dir_all(&table_dir).unwrap();
        fs::create_dir_all(&character_dir).unwrap();
        fs::write(character_dir.join("1107010002.lgo"), []).unwrap();

        let entry_size = 360usize;
        let mut data = Vec::new();
        data.extend_from_slice(&(entry_size as u32).to_le_bytes());

        let mut record = vec![0u8; entry_size];
        put_u32(&mut record, 0, 1);
        put_u32(&mut record, 104, 48);
        put_u32(&mut record, 112, 48);
        record[116..120].copy_from_slice(b"Test");
        put_u16(&mut record, 286, 0);
        put_u16(&mut record, 292, 32530);
        put_u16(&mut record, 320, 1107);
        put_u16(&mut record, 322, 1);
        put_u16(&mut record, 324, 1);
        data.extend_from_slice(&record);

        let path = table_dir.join("CharRecord.bin");
        fs::write(&path, data).unwrap();

        let characters = parse_char_record_bin(&path).unwrap();
        assert_eq!(characters.len(), 1);
        assert_eq!(characters[0].id, 48);
        assert_eq!(characters[0].model, 1107);
        assert_eq!(characters[0].suit_id, 1);
        assert_eq!(characters[0].action_id, 1107);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn parses_demon_char_record_bin_infers_missing_suit_and_part_from_model_files() {
        let root = temp_dir("demon_charrecord_infer_part");
        let table_dir = root.join("Data").join("Table");
        let character_dir = root.join("Data").join("model").join("character");
        fs::create_dir_all(&table_dir).unwrap();
        fs::create_dir_all(&character_dir).unwrap();
        fs::write(character_dir.join("2032010002.lgo"), []).unwrap();

        let entry_size = 360usize;
        let mut data = Vec::new();
        data.extend_from_slice(&(entry_size as u32).to_le_bytes());

        let mut record = vec![0u8; entry_size];
        put_u32(&mut record, 0, 1);
        put_u32(&mut record, 104, 1100);
        put_u32(&mut record, 112, 1100);
        put_u16(&mut record, 286, 0);
        put_u16(&mut record, 292, 0);
        put_u16(&mut record, 320, 2032);
        put_u16(&mut record, 322, 0);
        put_u16(&mut record, 324, 0);
        data.extend_from_slice(&record);

        let path = table_dir.join("CharRecord.bin");
        fs::write(&path, data).unwrap();

        let characters = parse_char_record_bin(&path).unwrap();
        assert_eq!(characters.len(), 1);
        assert_eq!(characters[0].model, 2032);
        assert_eq!(characters[0].suit_id, 1);
        assert_eq!(characters[0].mesh_part_0, 2);
        assert_eq!(characters[0].suit_num, 1);

        let _ = fs::remove_dir_all(root);
    }
}
