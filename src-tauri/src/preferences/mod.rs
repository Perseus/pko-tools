use std::path::Path;

use crate::db;

pub struct Preferences {
    db: db::DB,
}

impl Preferences {
    pub fn new() -> Self {
        let state_dir_path = Path::new("./state");
        if !state_dir_path.exists() {
            std::fs::create_dir(state_dir_path).unwrap();
        }
        let db = db::DB::new("./state/preferences.sqlite".to_string());
        let preferences = Self { db };
        preferences.init();
        preferences
    }

    pub fn init(&self) {
        let db = self.db.db.lock().unwrap();
        db.execute(
            "CREATE TABLE IF NOT EXISTS preferences (
                key TEXT PRIMARY KEY,
                value TEXT
            )",
            [],
        )
        .unwrap();
    }

    pub fn get_current_project(&self) -> Option<String> {
        let db = self.db.db.lock().unwrap();
        let mut stmt = db
            .prepare("SELECT value FROM preferences WHERE key = 'current_project'")
            .unwrap();
        if let Ok(row) = stmt.query_row([], |row| row.get(0)) {
            return Some(row);
        }

        None
    }
}
