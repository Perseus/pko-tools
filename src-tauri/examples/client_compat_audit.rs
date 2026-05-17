//! Audit a Mindpower3D/PKO-style client directory against pko-tools parsers.
//!
//! Usage:
//!   cargo run --example client_compat_audit -- <client_dir> [--bin-details] [--texture-sample N] [--deep-textures] [--gltf-sample N] [--deep-gltf]

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use pko_tools_lib::{
    character, client_paths, effect, effect_v2, item, map, string_set, text_encoding,
};

#[derive(Debug)]
struct AuditArgs {
    client_dir: PathBuf,
    bin_details: bool,
    texture_sample: usize,
    deep_textures: bool,
    gltf_sample: usize,
    deep_gltf: bool,
}

#[derive(Default)]
struct FormatAudit {
    total: usize,
    parsed: usize,
    failed: Vec<String>,
}

impl FormatAudit {
    fn record(&mut self, path: &Path, result: Result<()>) {
        self.total += 1;
        match result {
            Ok(()) => self.parsed += 1,
            Err(err) => {
                if self.failed.len() < 20 {
                    self.failed.push(format!("{}: {err:#}", path.display()));
                }
            }
        }
    }
}

fn main() -> Result<()> {
    let args = parse_args()?;
    let client_dir = args.client_dir;
    if !client_dir.exists() {
        anyhow::bail!("client dir does not exist: {}", client_dir.display());
    }

    println!("Client compatibility audit for {}", client_dir.display());
    print_file_inventory(&client_dir)?;
    print_table_header_inventory(&client_dir)?;
    print_generic_table_probe(&client_dir, args.bin_details)?;
    print_focused_table_audit(&client_dir)?;
    print_binary_asset_audit(&client_dir)?;
    print_texture_decode_audit(&client_dir, args.texture_sample, args.deep_textures)?;
    print_gltf_generation_audit(&client_dir, args.gltf_sample, args.deep_gltf)?;
    Ok(())
}

fn parse_args() -> Result<AuditArgs> {
    let mut args = std::env::args().skip(1);
    let client_dir = args
        .next()
        .map(PathBuf::from)
        .context("usage: cargo run --example client_compat_audit -- <client_dir> [--bin-details] [--texture-sample N] [--deep-textures] [--gltf-sample N] [--deep-gltf]")?;
    let mut bin_details = false;
    let mut texture_sample = 0usize;
    let mut deep_textures = false;
    let mut gltf_sample = 0usize;
    let mut deep_gltf = false;

    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--bin-details" => bin_details = true,
            "--texture-sample" => {
                texture_sample = args
                    .next()
                    .context("--texture-sample requires a number")?
                    .parse()
                    .context("--texture-sample must be a number")?;
            }
            "--deep-textures" => deep_textures = true,
            "--gltf-sample" => {
                gltf_sample = args
                    .next()
                    .context("--gltf-sample requires a number")?
                    .parse()
                    .context("--gltf-sample must be a number")?;
            }
            "--deep-gltf" => deep_gltf = true,
            _ => anyhow::bail!("unknown argument: {arg}"),
        }
    }

    Ok(AuditArgs {
        client_dir,
        bin_details,
        texture_sample,
        deep_textures,
        gltf_sample,
        deep_gltf,
    })
}

fn print_file_inventory(client_dir: &Path) -> Result<()> {
    let data_dir = data_dir(client_dir);
    let mut counts = BTreeMap::<String, usize>::new();
    for path in walk_files(&data_dir)? {
        let ext = path
            .extension()
            .and_then(|ext| ext.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        *counts.entry(ext).or_default() += 1;
    }

    println!("  file inventory:");
    for (ext, count) in counts.iter().rev() {
        println!("    .{ext}: {count}");
    }
    Ok(())
}

fn print_table_header_inventory(client_dir: &Path) -> Result<()> {
    let table_dir = client_paths::asset_dir(client_dir, "Table");
    let mut normal = 0usize;
    let mut text_like = 0usize;
    let mut irregular = Vec::new();

    for path in walk_files(&table_dir)? {
        if path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| !ext.eq_ignore_ascii_case("bin"))
            .unwrap_or(true)
        {
            continue;
        }
        let bytes = std::fs::read(&path)?;
        let Some(record_size) = read_u32(&bytes, 0) else {
            irregular.push(format!("{}: too small", display_name(&path)));
            continue;
        };
        let record_size = record_size as usize;
        let remainder = if record_size == 0 || bytes.len() < 4 {
            bytes.len()
        } else {
            (bytes.len() - 4) % record_size
        };
        if record_size > 0 && remainder == 0 {
            normal += 1;
        } else if display_name(&path).eq_ignore_ascii_case("StringSet.bin")
            && string_set::parse_string_set_file(&path).is_ok()
        {
            text_like += 1;
        } else {
            irregular.push(format!(
                "{}: record_size={} remainder={}",
                display_name(&path),
                record_size,
                remainder
            ));
        }
    }

    println!("  table headers:");
    println!("    raw-data-like tables: {normal}");
    println!("    text-like tables: {text_like}");
    println!("    irregular tables: {}", irregular.len());
    for line in irregular.iter().take(20) {
        println!("      {line}");
    }
    Ok(())
}

fn print_generic_table_probe(client_dir: &Path, print_details: bool) -> Result<()> {
    let table_dir = client_paths::asset_dir(client_dir, "Table");
    let mut tables = Vec::new();
    let mut total_active = 0usize;
    let mut shifted_tables = 0usize;

    for path in walk_files(&table_dir)? {
        if path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| !ext.eq_ignore_ascii_case("bin"))
            .unwrap_or(true)
        {
            continue;
        }

        let bytes = std::fs::read(&path)?;
        let Some(record_size) = read_u32(&bytes, 0).map(|size| size as usize) else {
            continue;
        };
        if record_size == 0 || bytes.len() < 4 || (bytes.len() - 4) % record_size != 0 {
            continue;
        }

        let mut active = 0usize;
        let mut shifted = 0usize;
        let mut first_name = String::new();
        for record in bytes[4..].chunks_exact(record_size) {
            if read_i32(record, 0).unwrap_or_default() == 0 {
                continue;
            }

            active += 1;
            let legacy_id = read_u32(record, 100).unwrap_or_default();
            let demon_id = read_u32(record, 104).unwrap_or_default();
            if legacy_id == 0 && demon_id != 0 {
                shifted += 1;
            }

            if first_name.is_empty() && record.len() >= 80 {
                first_name = text_encoding::decode_gbk_cstr(&record[8..80]);
            }
        }

        total_active += active;
        if shifted > 0 {
            shifted_tables += 1;
        }
        tables.push((
            display_name(&path),
            record_size,
            (bytes.len() - 4) / record_size,
            active,
            shifted,
            first_name,
        ));
    }

    println!("  generic raw table probe:");
    println!("    raw tables inspected: {}", tables.len());
    println!("    active records seen: {total_active}");
    println!("    shifted-id tables: {shifted_tables}");
    if print_details {
        for (name, record_size, records, active, shifted, first_name) in tables {
            println!(
                "      {name}: record_size={record_size}, records={records}, active={active}, shifted_records={shifted}, first_name={first_name:?}"
            );
        }
    }
    Ok(())
}

fn print_focused_table_audit(client_dir: &Path) -> Result<()> {
    println!("  focused parser audit:");

    match pko_tools_lib::character::info::parse_character_table(client_dir) {
        Ok(chars) => println!("    characters: {} parsed", chars.len()),
        Err(err) => println!("    characters: failed: {err:#}"),
    }

    match item::info::parse_item_table(client_dir) {
        Ok(items) => println!("    items: {} parsed", items.len()),
        Err(err) => println!("    items: failed: {err:#}"),
    }

    let string_set_path = client_paths::table_file(client_dir, "StringSet.bin");
    match string_set::parse_string_set_file(&string_set_path) {
        Ok(strings) => {
            let chinese_sample = strings
                .values()
                .find(|value| {
                    value
                        .chars()
                        .any(|ch| ('\u{4e00}'..='\u{9fff}').contains(&ch))
                })
                .map(String::as_str)
                .unwrap_or("<none>");
            println!(
                "    StringSet.bin: {} strings parsed, sample={:?}",
                strings.len(),
                chinese_sample
            );
        }
        Err(err) => println!("    StringSet.bin: failed: {err:#}"),
    }

    match map::mapinfo::load_mapinfo(client_dir) {
        Ok(entries) => println!("    MapInfo.bin: {} active entries", entries.len()),
        Err(err) => println!("    MapInfo.bin: failed: {err:#}"),
    }

    match map::scene_obj_info::load_scene_obj_info(client_dir) {
        Ok(entries) => println!("    SceneObjInfo.bin: {} active entries", entries.len()),
        Err(err) => println!("    SceneObjInfo.bin: failed: {err:#}"),
    }

    let terrain_path = client_paths::table_file(client_dir, "TerrainInfo.bin");
    match std::fs::read(&terrain_path)
        .with_context(|| format!("read {}", terrain_path.display()))
        .and_then(|data| map::texture::parse_terrain_info(&data))
    {
        Ok(entries) => println!("    TerrainInfo.bin: {} texture entries", entries.len()),
        Err(err) => println!("    TerrainInfo.bin: failed: {err:#}"),
    }

    let single_path = client_paths::table_file(client_dir, "MagicSingleInfo.bin");
    match std::fs::read(&single_path)
        .with_context(|| format!("read {}", single_path.display()))
        .and_then(|data| effect_v2::magic_single_loader::load_magic_single(&data))
    {
        Ok(table) => println!(
            "    MagicSingleInfo.bin: {} active entries, record_size={}",
            table.entries.len(),
            table.record_size
        ),
        Err(err) => println!("    MagicSingleInfo.bin: failed: {err:#}"),
    }

    let group_path = client_paths::table_file(client_dir, "MagicGroupInfo.bin");
    match std::fs::read(&group_path)
        .with_context(|| format!("read {}", group_path.display()))
        .and_then(|data| effect_v2::magic_group_loader::load_magic_group(&data))
    {
        Ok(table) => println!(
            "    MagicGroupInfo.bin: {} active entries, record_size={}",
            table.entries.len(),
            table.record_size
        ),
        Err(err) => println!("    MagicGroupInfo.bin: failed: {err:#}"),
    }

    Ok(())
}

fn print_binary_asset_audit(client_dir: &Path) -> Result<()> {
    let data_dir = data_dir(client_dir);
    let mut audits = BTreeMap::<String, FormatAudit>::new();

    for path in walk_files(&data_dir)? {
        let Some(ext) = path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.to_ascii_lowercase())
        else {
            continue;
        };

        match ext.as_str() {
            "eff" => audits.entry(ext).or_default().record(
                &path,
                std::fs::read(&path)
                    .with_context(|| format!("read {}", path.display()))
                    .and_then(|data| effect::eff_loader::load_eff(&data).map(|_| ())),
            ),
            "par" => audits.entry(ext).or_default().record(
                &path,
                std::fs::read(&path)
                    .with_context(|| format!("read {}", path.display()))
                    .and_then(|data| effect::par_loader::load_par(&data).map(|_| ())),
            ),
            "map" => audits.entry(ext).or_default().record(
                &path,
                std::fs::read(&path)
                    .with_context(|| format!("read {}", path.display()))
                    .and_then(|data| map::map_loader::load_map(&data).map(|_| ())),
            ),
            "obj" => audits.entry(ext).or_default().record(
                &path,
                std::fs::read(&path)
                    .with_context(|| format!("read {}", path.display()))
                    .and_then(|data| map::obj_loader::load_obj(&data).map(|_| ())),
            ),
            "lmo" => audits.entry(ext).or_default().record(
                &path,
                map::lmo_loader::load_lmo_no_animation(&path).map(|_| ()),
            ),
            "lgo" => audits.entry(ext).or_default().record(
                &path,
                pko_tools_lib::character::lgo_loader::load_lgo(&path).map(|_| ()),
            ),
            "lab" => audits.entry(ext).or_default().record(
                &path,
                pko_tools_lib::animation::lab_loader::load_lab(&path).map(|_| ()),
            ),
            _ => {}
        }
    }

    println!("  binary asset parser audit:");
    for key in BTreeSet::from([
        "eff".to_string(),
        "par".to_string(),
        "map".to_string(),
        "obj".to_string(),
        "lmo".to_string(),
        "lgo".to_string(),
        "lab".to_string(),
    ]) {
        let audit = audits.remove(&key).unwrap_or_default();
        println!(
            "    .{}: {}/{} parsed, {} failed",
            key,
            audit.parsed,
            audit.total,
            audit.failed.len()
        );
        for failure in audit.failed {
            println!("      {failure}");
        }
    }

    Ok(())
}

fn print_texture_decode_audit(
    client_dir: &Path,
    texture_sample: usize,
    deep_textures: bool,
) -> Result<()> {
    if texture_sample == 0 && !deep_textures {
        println!("  texture decode audit: skipped (pass --texture-sample N or --deep-textures)");
        return Ok(());
    }

    let data_dir = data_dir(client_dir);
    let texture_exts = BTreeSet::from([
        "bmp".to_string(),
        "dds".to_string(),
        "jpg".to_string(),
        "jpeg".to_string(),
        "png".to_string(),
        "tga".to_string(),
    ]);
    let mut by_ext = BTreeMap::<String, Vec<PathBuf>>::new();
    for path in walk_files(&data_dir)? {
        let Some(ext) = path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.to_ascii_lowercase())
        else {
            continue;
        };
        if texture_exts.contains(&ext) {
            by_ext.entry(ext).or_default().push(path);
        }
    }

    println!("  texture decode audit:");
    for (ext, paths) in &mut by_ext {
        paths.sort();
        let total = paths.len();
        let selected: Vec<&PathBuf> = if deep_textures {
            paths.iter().collect()
        } else {
            paths.iter().take(texture_sample).collect()
        };

        let mut decoded = 0usize;
        let mut failures = Vec::new();
        for path in &selected {
            match tauri::async_runtime::block_on(effect::commands::decode_texture(
                path.to_string_lossy().to_string(),
            )) {
                Ok(_) => decoded += 1,
                Err(err) => {
                    if failures.len() < 10 {
                        failures.push(format!("{}: {err}", path.display()));
                    }
                }
            }
        }

        println!(
            "    .{}: {}/{} decoded from {} checked",
            ext,
            decoded,
            total,
            selected.len()
        );
        for failure in failures {
            println!("      {failure}");
        }
    }

    Ok(())
}

fn print_gltf_generation_audit(
    client_dir: &Path,
    gltf_sample: usize,
    deep_gltf: bool,
) -> Result<()> {
    if gltf_sample == 0 && !deep_gltf {
        println!("  glTF generation audit: skipped (pass --gltf-sample N or --deep-gltf)");
        return Ok(());
    }

    println!("  glTF generation audit:");
    audit_character_gltf(client_dir, gltf_sample, deep_gltf)?;
    audit_item_gltf(client_dir, gltf_sample, deep_gltf)?;
    Ok(())
}

fn audit_character_gltf(client_dir: &Path, gltf_sample: usize, deep_gltf: bool) -> Result<()> {
    let mut characters = character::info::parse_character_table(client_dir)?;
    characters.sort_by_key(|character| character.id);
    let total = characters.len();
    let selected: Vec<_> = if deep_gltf {
        characters.iter().collect()
    } else {
        characters.iter().take(gltf_sample).collect()
    };

    let mut generated = 0usize;
    let mut failures = Vec::new();
    for character in &selected {
        match character
            .get_gltf_json(client_dir, None)
            .and_then(|json| validate_gltf_json(&json))
        {
            Ok(()) => generated += 1,
            Err(err) => {
                if failures.len() < 20 {
                    failures.push(format!(
                        "character id={} name={:?}: {err:#}",
                        character.id, character.name
                    ));
                }
            }
        }
    }

    println!(
        "    characters: {}/{} generated from {} checked",
        generated,
        total,
        selected.len()
    );
    for failure in failures {
        println!("      {failure}");
    }
    Ok(())
}

fn audit_item_gltf(client_dir: &Path, gltf_sample: usize, deep_gltf: bool) -> Result<()> {
    let items = item::info::parse_item_table(client_dir)?;
    let mut model_to_item = BTreeMap::<String, &item::Item>::new();
    for item in &items {
        for model_id in [
            &item.model_ground,
            &item.model_lance,
            &item.model_carsise,
            &item.model_phyllis,
            &item.model_ami,
        ] {
            let model_id = model_id.trim();
            if !model_id.is_empty() && model_id != "0" {
                model_to_item.entry(model_id.to_string()).or_insert(item);
            }
        }
    }

    let total = model_to_item.len();
    let selected: Vec<_> = if deep_gltf {
        model_to_item.iter().collect()
    } else {
        model_to_item.iter().take(gltf_sample).collect()
    };

    let mut generated = 0usize;
    let mut failures = Vec::new();
    for (model_id, item) in &selected {
        match item
            .get_gltf_json(client_dir, model_id)
            .and_then(|json| validate_gltf_json(&json))
        {
            Ok(()) => generated += 1,
            Err(err) => {
                if failures.len() < 20 {
                    failures.push(format!(
                        "item id={} name={:?} model={}: {err:#}",
                        item.id, item.name, model_id
                    ));
                }
            }
        }
    }

    println!(
        "    item models: {}/{} generated from {} checked",
        generated,
        total,
        selected.len()
    );
    for failure in failures {
        println!("      {failure}");
    }
    Ok(())
}

fn validate_gltf_json(json: &str) -> Result<()> {
    let value: serde_json::Value = serde_json::from_str(json)?;
    let asset_version = value
        .get("asset")
        .and_then(|asset| asset.get("version"))
        .and_then(|version| version.as_str())
        .unwrap_or_default();
    if asset_version != "2.0" {
        anyhow::bail!("unexpected glTF asset version: {asset_version:?}");
    }

    let scene_count = value
        .get("scenes")
        .and_then(|scenes| scenes.as_array())
        .map(Vec::len)
        .unwrap_or_default();
    let node_count = value
        .get("nodes")
        .and_then(|nodes| nodes.as_array())
        .map(Vec::len)
        .unwrap_or_default();
    if scene_count == 0 || node_count == 0 {
        anyhow::bail!("glTF has scene_count={scene_count}, node_count={node_count}");
    }
    Ok(())
}

fn walk_files(root: &Path) -> Result<Vec<PathBuf>> {
    let mut files = Vec::new();
    if !root.exists() {
        return Ok(files);
    }

    let mut stack = vec![root.to_path_buf()];
    while let Some(path) = stack.pop() {
        for entry in std::fs::read_dir(&path).with_context(|| format!("read {}", path.display()))? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else {
                files.push(path);
            }
        }
    }
    Ok(files)
}

fn read_u32(data: &[u8], offset: usize) -> Option<u32> {
    data.get(offset..offset + 4)
        .and_then(|chunk| chunk.try_into().ok())
        .map(u32::from_le_bytes)
}

fn read_i32(data: &[u8], offset: usize) -> Option<i32> {
    data.get(offset..offset + 4)
        .and_then(|chunk| chunk.try_into().ok())
        .map(i32::from_le_bytes)
}

fn data_dir(client_dir: &Path) -> PathBuf {
    let demon = client_dir.join("Data");
    if demon.is_dir() {
        demon
    } else {
        client_dir.to_path_buf()
    }
}

fn display_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("<unknown>")
        .to_string()
}
