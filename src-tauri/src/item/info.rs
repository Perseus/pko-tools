use std::path::PathBuf;

use crate::projects;

use super::Item;

fn parse_item_info(path: PathBuf) -> anyhow::Result<Vec<Item>> {
    let mut reader = csv::ReaderBuilder::new()
        .delimiter(b'\t')
        .has_headers(false)
        .comment(Some(b'/'))
        .flexible(true)
        .from_reader(std::fs::File::open(path)?);

    let mut items = vec![];

    for result in reader.records() {
        match result {
            Ok(record) => {
                // Skip empty rows (rows with all empty fields)
                if record.len() < 10 || record.get(0).unwrap_or("").trim().is_empty() {
                    continue;
                }

                let id = match record.get(0).unwrap_or("0").trim().parse::<u32>() {
                    Ok(id) => id,
                    Err(_) => continue,
                };

                let name = record.get(1).unwrap_or("").to_string();
                let icon_name = record.get(2).unwrap_or("").to_string();
                let model_ground = record.get(3).unwrap_or("0").to_string();
                let model_lance = record.get(4).unwrap_or("0").to_string();
                let model_carsise = record.get(5).unwrap_or("0").to_string();
                let model_phyllis = record.get(6).unwrap_or("0").to_string();
                let model_ami = record.get(7).unwrap_or("0").to_string();
                let item_type = record.get(10).unwrap_or("0").trim().parse::<u32>().unwrap_or(0);
                let display_effect = record.get(87).unwrap_or("0").to_string();
                let bind_effect = record.get(88).unwrap_or("0").to_string();
                let bind_effect_2 = record.get(89).unwrap_or("0").to_string();
                let description = record.get(93).unwrap_or("").to_string();

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
        eprintln!("First item: id={}, name='{}', type={}, model_ground='{}'", first.id, first.name, first.item_type, first.model_ground);
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
        assert!(result.is_ok(), "Should produce valid glTF: {:?}", result.err());
    }
}
