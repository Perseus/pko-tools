use std::path::PathBuf;

use crate::projects;

use super::Character;

fn parse_character_info(path: PathBuf) -> anyhow::Result<Vec<Character>> {
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

pub fn get_all_characters(project_id: uuid::Uuid) -> anyhow::Result<Vec<Character>> {
    if let Ok(project) = projects::project::Project::get_project(project_id) {
        let project_dir = project.project_directory;
        let character_info_file = format!(
            "{}/scripts/table/CharacterInfo.txt",
            project_dir.to_str().unwrap()
        );

        println!("Loading character info from {}", character_info_file);

        return parse_character_info(PathBuf::from(character_info_file));
    }

    Ok(vec![])
}

pub fn get_character(project_id: uuid::Uuid, character_id: u32) -> anyhow::Result<Character> {
    if let Ok(project) = projects::project::Project::get_project(project_id) {
        let project_dir = project.project_directory;
        let character_info_file = format!(
            "{}/scripts/table/CharacterInfo.txt",
            project_dir.to_str().unwrap()
        );

        let characters = parse_character_info(PathBuf::from(character_info_file))?;

        for character in characters {
            if character.id == character_id {
                return Ok(character);
            }
        }
    }

    Err(anyhow::anyhow!("Character not found"))
}
