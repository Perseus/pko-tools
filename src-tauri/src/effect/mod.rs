pub mod commands;
pub mod model;

use std::path::Path;

pub fn scan_effects_directory(project_dir: &Path) -> anyhow::Result<Vec<String>> {
    let mut files = Vec::new();
    let path = project_dir.join("effect");
    if !path.exists() {
        return Ok(files);
    }

    for entry in std::fs::read_dir(path)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_file() && path.extension().is_some_and(|ext| ext == "eff") {
            if let Some(name) = path.file_name().and_then(|name| name.to_str()) {
                files.push(name.to_string());
            }
        }
    }

    Ok(files)
}
