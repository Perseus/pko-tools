use std::path::{Path, PathBuf};

/// Resolve MindPower client resources without forcing every supported client to
/// have the same on-disk layout.
///
/// PKO-style clients keep assets at the project root:
/// `animation`, `effect`, `map`, `model`, `scripts/table`.
///
/// Demon Online keeps the same engine resources under `Data`:
/// `Data/animation`, `Data/effect`, `Data/map`, `Data/model`, `Data/Table`.
pub fn asset_dir(project_dir: &Path, name: &str) -> PathBuf {
    let direct = project_dir.join(name);
    if direct.is_dir() {
        return direct;
    }

    let demon = project_dir.join("Data").join(name);
    if demon.is_dir() {
        return demon;
    }

    direct
}

pub fn asset_file(project_dir: &Path, dir: &str, file_name: impl AsRef<Path>) -> PathBuf {
    asset_dir(project_dir, dir).join(file_name)
}

pub fn table_dir(project_dir: &Path) -> PathBuf {
    let direct = project_dir.join("scripts").join("table");
    if direct.is_dir() {
        return direct;
    }

    let direct_table = project_dir.join("Table");
    if direct_table.is_dir() {
        return direct_table;
    }

    let demon = project_dir.join("Data").join("Table");
    if demon.is_dir() {
        return demon;
    }

    direct
}

pub fn table_file(project_dir: &Path, file_name: &str) -> PathBuf {
    table_dir(project_dir).join(file_name)
}

pub fn script_txt_file(project_dir: &Path, file_name: &str) -> PathBuf {
    let direct = project_dir.join("scripts").join("txt").join(file_name);
    if direct.exists() {
        return direct;
    }

    let demon = project_dir
        .join("Data")
        .join("scripts")
        .join("txt")
        .join(file_name);
    if demon.exists() {
        return demon;
    }

    direct
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_root(label: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "pko_tools_client_paths_{}_{}_{}",
            label,
            std::process::id(),
            stamp
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn resolves_pko_style_asset_and_table_paths_without_data_redirect() {
        let root = temp_root("pko");
        fs::create_dir_all(root.join("effect")).unwrap();
        fs::create_dir_all(root.join("scripts").join("table")).unwrap();

        assert_eq!(asset_dir(&root, "effect"), root.join("effect"));
        assert_eq!(
            table_file(&root, "MagicGroupInfo.bin"),
            root.join("scripts")
                .join("table")
                .join("MagicGroupInfo.bin")
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn resolves_demon_data_asset_and_table_paths() {
        let root = temp_root("demon");
        fs::create_dir_all(root.join("Data").join("effect")).unwrap();
        fs::create_dir_all(root.join("Data").join("Table")).unwrap();

        assert_eq!(asset_dir(&root, "effect"), root.join("Data").join("effect"));
        assert_eq!(
            table_file(&root, "MagicGroupInfo.bin"),
            root.join("Data").join("Table").join("MagicGroupInfo.bin")
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn resolves_demon_data_folder_used_as_project_root() {
        let root = temp_root("demon_data_root");
        fs::create_dir_all(root.join("effect")).unwrap();
        fs::create_dir_all(root.join("Table")).unwrap();

        assert_eq!(asset_dir(&root, "effect"), root.join("effect"));
        assert_eq!(
            table_file(&root, "ItemFirstInfo.bin"),
            root.join("Table").join("ItemFirstInfo.bin")
        );

        let _ = fs::remove_dir_all(root);
    }
}
