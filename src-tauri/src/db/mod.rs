use rusqlite::Connection;
use std::sync::{Arc, Mutex};

pub struct DB {
    pub db: Arc<Mutex<Connection>>,
}

impl DB {
    pub fn new(file: String) -> Self {
        let db = rusqlite::Connection::open(file).unwrap();
        Self {
            db: Arc::new(Mutex::new(db)),
        }
    }

    pub fn open(file: String) -> anyhow::Result<Self> {
        let db = rusqlite::Connection::open_with_flags(
            file,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE,
        )
        .unwrap();

        Ok(Self {
            db: Arc::new(Mutex::new(db)),
        })
    }
}

pub fn get_db_list() -> Vec<String> {
    let path = "./state";
    if let Err(e) = std::fs::create_dir_all(path) {
        eprintln!("Error creating projects directory: {}", e);
    }

    let mut list = Vec::new();

    if let Ok(paths) = std::fs::read_dir(path) {
        for path in paths {
            let path = path.unwrap().path();
            let path = path.file_name().unwrap().to_str().unwrap();
            // path without extension
            let path = path.split('.').collect::<Vec<&str>>()[0];
            list.push(path.to_string());
        }
    }

    list
}
