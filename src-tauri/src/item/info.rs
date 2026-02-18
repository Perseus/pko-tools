use std::path::PathBuf;

use crate::projects;

use super::Item;

/// Read a field from a ByteRecord as a lossy UTF-8 string.
/// ItemInfo.txt contains non-UTF-8 text (GBK-encoded Chinese/Korean) in
/// the name and description fields, so we must use lossy conversion to
/// avoid skipping entire rows.
fn byte_field(record: &csv::ByteRecord, index: usize) -> String {
    match record.get(index) {
        Some(bytes) => String::from_utf8_lossy(bytes).to_string(),
        None => String::new(),
    }
}

fn byte_field_or(record: &csv::ByteRecord, index: usize, default: &str) -> String {
    match record.get(index) {
        Some(bytes) if !bytes.is_empty() => String::from_utf8_lossy(bytes).to_string(),
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

pub fn get_all_items(project_id: uuid::Uuid) -> anyhow::Result<Vec<Item>> {
    if let Ok(project) = projects::project::Project::get_project(project_id) {
        let project_dir = project.project_directory;
        let item_info_file = project_dir.join("scripts/table/ItemInfo.txt");

        return parse_item_info(item_info_file);
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
}
