use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde::Serialize;

use crate::db;

#[derive(Serialize, Debug)]
struct ProjectConfig {}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: uuid::Uuid,
    pub name: String,
    pub project_directory: Box<PathBuf>,
    config: ProjectConfig,

    #[serde(skip)]
    db: db::DB,
}

impl Project {
    pub fn create_new(
        project_name: String,
        project_directory_location: String,
    ) -> anyhow::Result<Self> {
        let id = uuid::Uuid::new_v4();
        let db = db::DB::new(format!("state/{}.sqlite", id));
        let project_directory = Path::new(&project_directory_location).to_path_buf();

        if !project_directory.exists() {
            return Err(anyhow::anyhow!("Project directory does not exist"));
        }

        let mut project = Self {
            id,
            name: project_name,
            config: ProjectConfig {},
            db,
            project_directory: Box::new(project_directory),
        };

        project.init_tables()?;
        Ok(project)
    }

    pub fn get_project(project_id: uuid::Uuid) -> anyhow::Result<Self> {
        if let Ok(db) = db::DB::open(format!("./state/{}.sqlite", project_id)) {
            let mut name = "".to_string();
            let mut project_directory_path = "".to_string();

            let cloned_db = db.db.clone();

            if let Ok(cloned_db) = cloned_db.lock() {
                let mut stmt = cloned_db.prepare(
                    "SELECT key, value FROM info WHERE key IN ('name', 'project_directory')",
                )?;
                let mut rows = stmt.query([])?;
                while let Some(row) = rows.next()? {
                    let key: String = row.get(0)?;
                    let value = row.get(1)?;

                    match key.as_str() {
                        "name" => {
                            name = value;
                        }
                        "project_directory" => {
                            project_directory_path = value;
                        }
                        _ => {}
                    }
                }
            }

            let project_directory = Path::new(&project_directory_path).to_path_buf();
            if !project_directory.exists() {
                return Err(anyhow::anyhow!(
                    "Project directory does not exist: ".to_owned() + &project_directory_path
                ));
            }

            let project = Self {
                id: project_id,
                name,
                config: ProjectConfig {},
                db,
                project_directory: Box::new(project_directory),
            };

            return Ok(project);
        }

        Err(anyhow::anyhow!("Could not open project"))
    }

    pub fn get_projects_list() -> anyhow::Result<Vec<Self>> {
        let path = "./state";
        if let Err(e) = std::fs::create_dir_all(path) {
            eprintln!("Error creating projects directory: {}", e);
        }

        let mut list = Vec::new();

        if let Ok(paths) = std::fs::read_dir(path) {
            for path in paths {
                let path = path.unwrap().path();
                let path = path.file_name().unwrap().to_str().unwrap();
                if path.starts_with("preferences") {
                    continue;
                }

                // path without extension
                let path = path.split('.').collect::<Vec<&str>>()[0];
                let project_id = uuid::Uuid::parse_str(path).unwrap();
                match Project::get_project(project_id) {
                    Ok(project) => {
                        list.push(project);
                    }
                    Err(e) => {
                        eprintln!("Error opening project: {}", e);
                    }
                }
            }
        }

        Ok(list)
    }

    fn init_tables(&mut self) -> anyhow::Result<()> {
        let db = self.db.db.clone();
        if let Ok(mut db) = db.lock() {
            Project::init_info_table(&mut db, &self.name, &self.project_directory)?;
            Project::init_characters_table(&mut db)?;
        } else {
            return Err(anyhow::anyhow!("Could not lock database"));
        }

        Ok(())
    }

    fn init_info_table(
        conn: &mut Connection,
        project_name: &str,
        project_directory: &PathBuf,
    ) -> anyhow::Result<()> {
        conn.execute(
            "CREATE TABLE IF NOT EXISTS info (
                key TEXT PRIMARY KEY,
                value TEXT
            )",
            [],
        )?;
        conn.execute(
            "
            INSERT INTO info (key, value) VALUES ('name', ?1)",
            [project_name],
        )?;
        conn.execute(
            "
            INSERT INTO info (key, value) VALUES ('project_directory', ?1)",
            [project_directory.to_str().unwrap()],
        )?;
        Ok(())
    }

    fn init_characters_table(conn: &mut Connection) -> anyhow::Result<()> {
        conn.execute(
            "CREATE TABLE IF NOT EXISTS characters (
                id INTEGER PRIMARY KEY,
                name TEXT,
                animation_id INTEGER,
                model_id TEXT
            )",
            [],
        )?;

        Ok(())
    }

    // client-specific commands and methods

    pub fn get_animation_files(&self) -> anyhow::Result<Vec<String>> {
        let mut files = Vec::new();
        let path = self.project_directory.join("animation");
        if path.exists() {
            if let Ok(entries) = std::fs::read_dir(path) {
                for entry in entries {
                    let entry = entry?;
                    let path = entry.path();

                    let file_extension = path.extension();
                    if path.is_file() && file_extension.is_some_and(|ext| ext == "lab") {
                        files.push(path.file_name().unwrap().to_str().unwrap().to_string());
                    }
                }
            }
        }

        Ok(files)
    }
}
