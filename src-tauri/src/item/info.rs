use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};

use crate::client_paths;
use crate::projects;
use crate::text_encoding;

use super::Item;

/// Read a field from a ByteRecord as a GBK string.
/// ItemInfo.txt commonly contains GBK-encoded Chinese/Korean in the name and
/// description fields. ASCII resource names are unchanged by this decoder.
fn byte_field(record: &csv::ByteRecord, index: usize) -> String {
    match record.get(index) {
        Some(bytes) => text_encoding::decode_gbk_cstr(bytes),
        None => String::new(),
    }
}

fn byte_field_or(record: &csv::ByteRecord, index: usize, default: &str) -> String {
    match record.get(index) {
        Some(bytes) if !bytes.is_empty() => text_encoding::decode_gbk_cstr(bytes),
        _ => default.to_string(),
    }
}

fn parse_item_info(path: PathBuf) -> anyhow::Result<Vec<Item>> {
    let mut reader = csv::ReaderBuilder::new()
        .delimiter(b'\t')
        .has_headers(false)
        .comment(Some(b'/'))
        .flexible(true)
        .from_reader(std::fs::File::open(path)?);

    let mut items = vec![];

    for result in reader.byte_records() {
        match result {
            Ok(record) => {
                // Skip empty rows (rows with all empty fields)
                if record.len() < 10 {
                    continue;
                }

                let id_str = byte_field(&record, 0);
                let id_str = id_str.trim();
                if id_str.is_empty() {
                    continue;
                }

                let id = match id_str.parse::<u32>() {
                    Ok(id) => id,
                    Err(_) => continue,
                };

                let name = byte_field(&record, 1);
                let icon_name = byte_field(&record, 2);
                let model_ground = byte_field_or(&record, 3, "0");
                let model_lance = byte_field_or(&record, 4, "0");
                let model_carsise = byte_field_or(&record, 5, "0");
                let model_phyllis = byte_field_or(&record, 6, "0");
                let model_ami = byte_field_or(&record, 7, "0");
                let item_type = byte_field_or(&record, 10, "0")
                    .trim()
                    .parse::<u32>()
                    .unwrap_or(0);
                let display_effect = byte_field_or(&record, 87, "0");
                let bind_effect = byte_field_or(&record, 88, "0");
                let bind_effect_2 = byte_field_or(&record, 89, "0");
                let description = byte_field(&record, 93);

                items.push(Item {
                    id,
                    name,
                    icon_name,
                    model_ground,
                    model_lance,
                    model_carsise,
                    model_phyllis,
                    model_ami,
                    item_type,
                    display_effect,
                    bind_effect,
                    bind_effect_2,
                    description,
                });
            }
            Err(e) => {
                println!("Error parsing item info: {:?}", e);
            }
        }
    }

    Ok(items)
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

fn infer_demon_item_type(id: u32) -> u32 {
    id / 1_000_000
}

fn valid_item_model_ids(project_dir: &Path) -> HashSet<String> {
    let item_dir = client_paths::asset_file(project_dir, "model", "item");
    std::fs::read_dir(item_dir)
        .ok()
        .into_iter()
        .flat_map(|entries| entries.flatten())
        .filter_map(|entry| {
            let path = entry.path();
            let ext = path.extension()?.to_str()?;
            if !ext.eq_ignore_ascii_case("lgo") {
                return None;
            }
            path.file_stem()
                .and_then(|stem| stem.to_str())
                .map(|stem| stem.to_ascii_lowercase())
        })
        .collect()
}

fn sanitize_demon_item_model(candidate: String, valid_models: &HashSet<String>) -> String {
    let candidate = candidate.trim().to_string();
    if candidate.is_empty() || candidate == "0" {
        return "0".to_string();
    }

    if valid_models.contains(&candidate.to_ascii_lowercase()) {
        return candidate;
    }

    // Demon base item tables also contain character equipment model ids. Those
    // are valid assets, but not standalone item models, so keep them out of the
    // item browser to avoid rendering characters when an item is selected.
    "0".to_string()
}

fn parse_demon_item_bin(
    path: impl AsRef<Path>,
    project_dir: &Path,
    model_offset: Option<usize>,
) -> anyhow::Result<Vec<Item>> {
    let data = std::fs::read(path)?;
    if data.len() < 4 {
        anyhow::bail!("Demon item table too small");
    }

    let entry_size = read_u32(&data, 0).unwrap_or(0) as usize;
    if entry_size < 276 {
        anyhow::bail!("Demon item table unexpected entry size: {}", entry_size);
    }

    let valid_models = valid_item_model_ids(project_dir);
    let record_count = (data.len() - 4) / entry_size;
    let mut items = Vec::new();

    for i in 0..record_count {
        let offset = 4 + i * entry_size;
        let record = &data[offset..offset + entry_size];
        if read_i32(record, 0).unwrap_or(0) == 0 {
            continue;
        }

        let id = read_u32(record, 104).unwrap_or(0);
        if id == 0 {
            continue;
        }

        let name = {
            let duplicate_name = read_gbk_cstr(record, 116, 80);
            if duplicate_name.is_empty() {
                read_gbk_cstr(record, 8, 72)
            } else {
                duplicate_name
            }
        };
        let icon_name = read_gbk_cstr(record, 244, 32);
        let model = model_offset
            .map(|offset| {
                sanitize_demon_item_model(read_gbk_cstr(record, offset, 32), &valid_models)
            })
            .unwrap_or_else(|| "0".to_string());

        items.push(Item {
            id,
            name,
            icon_name,
            model_ground: model.clone(),
            model_lance: model.clone(),
            model_carsise: model.clone(),
            model_phyllis: model.clone(),
            model_ami: model,
            item_type: infer_demon_item_type(id),
            display_effect: String::new(),
            bind_effect: String::new(),
            bind_effect_2: String::new(),
            description: String::new(),
        });
    }

    Ok(items)
}

fn parse_demon_item_tables(project_dir: &Path) -> anyhow::Result<Vec<Item>> {
    let mut by_id = BTreeMap::new();

    let first_info = client_paths::table_file(project_dir, "ItemFirstInfo.bin");
    if first_info.exists() {
        for item in parse_demon_item_bin(first_info, project_dir, Some(276))? {
            by_id.insert(item.id, item);
        }
    }

    let second_info = client_paths::table_file(project_dir, "ItemSecondInfo.bin");
    if second_info.exists() {
        for item in parse_demon_item_bin(second_info, project_dir, None)? {
            by_id.entry(item.id).or_insert(item);
        }
    }

    Ok(by_id.into_values().collect())
}

pub fn parse_item_record_bin(path: impl AsRef<Path>) -> anyhow::Result<Vec<Item>> {
    let data = std::fs::read(path)?;
    if data.len() < 4 {
        anyhow::bail!("ItemRecord.bin too small");
    }

    let entry_size = read_u32(&data, 0).unwrap_or(0) as usize;
    if entry_size < 320 {
        anyhow::bail!("ItemRecord.bin unexpected entry size: {}", entry_size);
    }

    let record_count = (data.len() - 4) / entry_size;
    let mut items = Vec::new();

    for i in 0..record_count {
        let offset = 4 + i * entry_size;
        let record = &data[offset..offset + entry_size];
        if read_i32(record, 0).unwrap_or(0) == 0 {
            continue;
        }

        let id = read_u32(record, 104).unwrap_or_else(|| read_u32(record, 112).unwrap_or(0));
        if id == 0 {
            continue;
        }

        let model = |idx: usize| read_gbk_cstr(record, 213 + idx * 19, 19);
        items.push(Item {
            id,
            name: read_gbk_cstr(record, 116, 80),
            icon_name: read_gbk_cstr(record, 196, 17),
            model_ground: model(0),
            model_lance: model(1),
            model_carsise: model(2),
            model_phyllis: model(3),
            model_ami: model(4),
            item_type: read_u16(record, 312).unwrap_or(0) as u32,
            display_effect: String::new(),
            bind_effect: String::new(),
            bind_effect_2: String::new(),
            description: String::new(),
        });
    }

    Ok(items)
}

pub fn parse_item_table(project_dir: &Path) -> anyhow::Result<Vec<Item>> {
    let item_info_file = client_paths::table_file(project_dir, "ItemInfo.txt");
    if item_info_file.exists() {
        return parse_item_info(item_info_file);
    }

    let demon_first_info = client_paths::table_file(project_dir, "ItemFirstInfo.bin");
    let demon_second_info = client_paths::table_file(project_dir, "ItemSecondInfo.bin");
    if demon_first_info.exists() || demon_second_info.exists() {
        return parse_demon_item_tables(project_dir);
    }

    let item_record_bin = client_paths::table_file(project_dir, "ItemRecord.bin");
    if item_record_bin.exists() {
        return parse_item_record_bin(item_record_bin);
    }

    parse_item_info(item_info_file)
}

pub fn get_all_items(project_id: uuid::Uuid) -> anyhow::Result<Vec<Item>> {
    if let Ok(project) = projects::project::Project::get_project(project_id) {
        let project_dir = project.project_directory;
        return parse_item_table(&project_dir);
    }

    Ok(vec![])
}

pub fn get_item(project_id: uuid::Uuid, item_id: u32) -> anyhow::Result<Item> {
    let items = get_all_items(project_id)?;

    for item in items {
        if item.id == item_id {
            return Ok(item);
        }
    }

    Err(anyhow::anyhow!("Item not found: {}", item_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_item_info() {
        let path = PathBuf::from("../top-client/scripts/table/ItemInfo.txt");
        if !path.exists() {
            eprintln!("Test file not found at {:?}, skipping", path);
            return;
        }

        let items = parse_item_info(path).unwrap();
        eprintln!("Parsed {} items", items.len());

        assert!(!items.is_empty(), "Expected at least one item to be parsed");

        let first = &items[0];
        eprintln!(
            "First item: id={}, name='{}', type={}, model_ground='{}'",
            first.id, first.name, first.item_type, first.model_ground
        );
        assert_eq!(first.id, 1);
        assert_eq!(first.name, "Short Sword");
        assert_eq!(first.model_ground, "10100001");
    }

    #[test]
    fn test_load_item_model_gltf() {
        use crate::item::Item;
        let project_dir = std::path::Path::new("../top-client");
        if !project_dir.exists() {
            eprintln!("top-client not found, skipping");
            return;
        }

        let item = Item {
            id: 1,
            name: "Short Sword".to_string(),
            icon_name: "w0001".to_string(),
            model_ground: "10100001".to_string(),
            model_lance: "01010001".to_string(),
            model_carsise: "02010001".to_string(),
            model_phyllis: "0".to_string(),
            model_ami: "0".to_string(),
            item_type: 1,
            display_effect: "0".to_string(),
            bind_effect: "0".to_string(),
            bind_effect_2: "0".to_string(),
            description: "test".to_string(),
        };

        let result = item.get_gltf_json(project_dir, "10100001");
        match &result {
            Ok(json) => eprintln!("glTF JSON length: {} bytes", json.len()),
            Err(e) => eprintln!("Error: {}", e),
        }
        assert!(
            result.is_ok(),
            "Should produce valid glTF: {:?}",
            result.err()
        );
    }

    #[test]
    fn parses_demon_item_record_bin_subset() {
        let entry_size = 320usize;
        let mut data = Vec::new();
        data.extend_from_slice(&(entry_size as u32).to_le_bytes());

        let mut record = vec![0u8; entry_size];
        record[0..4].copy_from_slice(&1i32.to_le_bytes());
        record[104..108].copy_from_slice(&11u32.to_le_bytes());
        record[112..116].copy_from_slice(&11u32.to_le_bytes());
        record[116..126].copy_from_slice(b"ShortSword");
        record[196..201].copy_from_slice(b"w0001");
        record[213..221].copy_from_slice(b"01010001");
        record[232..240].copy_from_slice(b"01010002");
        record[251..259].copy_from_slice(b"01010003");
        record[270..278].copy_from_slice(b"01010004");
        record[289..297].copy_from_slice(b"01010005");
        record[312..314].copy_from_slice(&1u16.to_le_bytes());
        data.extend_from_slice(&record);

        let path = std::env::temp_dir().join(format!(
            "pko_tools_itemrecord_{}_{}.bin",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::write(&path, data).unwrap();

        let items = parse_item_record_bin(&path).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, 11);
        assert_eq!(items[0].name, "ShortSword");
        assert_eq!(items[0].icon_name, "w0001");
        assert_eq!(items[0].model_ground, "01010001");
        assert_eq!(items[0].model_lance, "01010002");
        assert_eq!(items[0].item_type, 1);

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn parses_demon_split_item_tables_and_filters_character_models() {
        let root = std::env::temp_dir().join(format!(
            "pko_tools_demon_items_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let table_dir = root.join("Data").join("Table");
        let model_dir = root.join("Data").join("model").join("item");
        std::fs::create_dir_all(&table_dir).unwrap();
        std::fs::create_dir_all(&model_dir).unwrap();
        std::fs::write(model_dir.join("00100001.lgo"), []).unwrap();

        let entry_size = 320usize;
        let mut first_data = Vec::new();
        first_data.extend_from_slice(&(entry_size as u32).to_le_bytes());

        let mut valid = vec![0u8; entry_size];
        valid[0..4].copy_from_slice(&1i32.to_le_bytes());
        valid[104..108].copy_from_slice(&1_000_000u32.to_le_bytes());
        valid[116..127].copy_from_slice(b"Trial Staff");
        valid[244..252].copy_from_slice(b"slfz.tga");
        valid[276..284].copy_from_slice(b"00100001");
        first_data.extend_from_slice(&valid);

        let mut character_part = vec![0u8; entry_size];
        character_part[0..4].copy_from_slice(&1i32.to_le_bytes());
        character_part[104..108].copy_from_slice(&2_001_001u32.to_le_bytes());
        character_part[116..126].copy_from_slice(b"Robe Piece");
        character_part[244..252].copy_from_slice(b"robe.tga");
        character_part[276..286].copy_from_slice(b"2140010004");
        first_data.extend_from_slice(&character_part);

        std::fs::write(table_dir.join("ItemFirstInfo.bin"), first_data).unwrap();

        let items = parse_item_table(&root).unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].id, 1_000_000);
        assert_eq!(items[0].model_ground, "00100001");
        assert_eq!(items[0].item_type, 1);
        assert_eq!(items[1].id, 2_001_001);
        assert_eq!(items[1].model_ground, "0");
        assert_eq!(items[1].item_type, 2);

        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn parses_demon_split_item_tables_when_data_folder_is_project_root() {
        let data_root = std::env::temp_dir().join(format!(
            "pko_tools_demon_data_items_{}_{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let table_dir = data_root.join("Table");
        let model_dir = data_root.join("model").join("item");
        std::fs::create_dir_all(&table_dir).unwrap();
        std::fs::create_dir_all(&model_dir).unwrap();
        std::fs::write(model_dir.join("00100001.lgo"), []).unwrap();

        let entry_size = 320usize;
        let mut first_data = Vec::new();
        first_data.extend_from_slice(&(entry_size as u32).to_le_bytes());

        let mut item = vec![0u8; entry_size];
        item[0..4].copy_from_slice(&1i32.to_le_bytes());
        item[104..108].copy_from_slice(&1_000_000u32.to_le_bytes());
        item[116..127].copy_from_slice(b"Trial Staff");
        item[244..252].copy_from_slice(b"slfz.tga");
        item[276..284].copy_from_slice(b"00100001");
        first_data.extend_from_slice(&item);

        std::fs::write(table_dir.join("ItemFirstInfo.bin"), first_data).unwrap();

        let items = parse_item_table(&data_root).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].id, 1_000_000);
        assert_eq!(items[0].model_ground, "00100001");

        let _ = std::fs::remove_dir_all(data_root);
    }

    #[test]
    fn demon_item_tables_from_env_use_split_layout() {
        let Ok(project_dir) = std::env::var("PKO_DEMON_PROJECT_DIR") else {
            eprintln!("PKO_DEMON_PROJECT_DIR not set, skipping");
            return;
        };
        let project_dir = PathBuf::from(project_dir);
        if !project_dir.exists() {
            eprintln!("PKO_DEMON_PROJECT_DIR does not exist, skipping");
            return;
        }

        let items = parse_item_table(&project_dir).unwrap();
        assert!(
            items.len() > 1_000,
            "expected Demon split tables, got {} items",
            items.len()
        );
        assert!(items
            .iter()
            .any(|item| item.id == 1_000_000 && item.model_ground == "00100001"));
        assert!(!items.iter().any(|item| item.model_ground == "2140010004"));

        let character_dir = client_paths::asset_file(&project_dir, "model", "character");
        let character_models: HashSet<String> = std::fs::read_dir(character_dir)
            .unwrap()
            .flatten()
            .filter_map(|entry| {
                let path = entry.path();
                if !path
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("lgo"))
                {
                    return None;
                }
                path.file_stem()
                    .and_then(|stem| stem.to_str())
                    .map(|stem| stem.to_string())
            })
            .collect();

        assert!(
            items.iter().all(|item| {
                let models = [
                    &item.model_ground,
                    &item.model_lance,
                    &item.model_carsise,
                    &item.model_phyllis,
                    &item.model_ami,
                ];
                models
                    .iter()
                    .all(|model| model == &&"0" || !character_models.contains(*model))
            }),
            "Demon item list must not expose character-part models as standalone item previews"
        );
    }
}
