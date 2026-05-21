pub mod commands;
pub mod eff_loader;
pub mod export;
pub mod model;
pub mod par_loader;
pub mod texture_export;
pub mod trace;

use std::path::Path;

use crate::client_paths;

pub fn scan_effects_directory(project_dir: &Path) -> anyhow::Result<Vec<String>> {
    let mut files = Vec::new();
    let path = client_paths::asset_dir(project_dir, "effect");
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

pub fn scan_par_files(project_dir: &Path) -> anyhow::Result<Vec<String>> {
    let mut files = Vec::new();
    let path = client_paths::asset_dir(project_dir, "effect");
    if !path.exists() {
        return Ok(files);
    }

    for entry in std::fs::read_dir(path)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_file() && path.extension().is_some_and(|ext| ext == "par") {
            if let Some(name) = path.file_name().and_then(|name| name.to_str()) {
                files.push(name.to_string());
            }
        }
    }

    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_root(label: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "pko_tools_effect_paths_{}_{}_{}",
            label,
            std::process::id(),
            stamp
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn scans_effect_files_from_demon_data_effect_dir() {
        let root = temp_root("demon_eff");
        let effect_dir = root.join("Data").join("effect");
        fs::create_dir_all(&effect_dir).unwrap();
        fs::write(effect_dir.join("alpha.eff"), []).unwrap();
        fs::write(effect_dir.join("beta.par"), []).unwrap();

        let files = scan_effects_directory(&root).unwrap();
        assert_eq!(files, vec!["alpha.eff"]);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn scans_particle_files_from_demon_data_effect_dir() {
        let root = temp_root("demon_par");
        let effect_dir = root.join("Data").join("effect");
        fs::create_dir_all(&effect_dir).unwrap();
        fs::write(effect_dir.join("alpha.eff"), []).unwrap();
        fs::write(effect_dir.join("beta.par"), []).unwrap();

        let files = scan_par_files(&root).unwrap();
        assert_eq!(files, vec!["beta.par"]);

        let _ = fs::remove_dir_all(root);
    }
}
