use anyhow::{anyhow, Result};
use kaitai::*;

use crate::kaitai_gen::pko_magic_single::{PkoMagicSingle, PkoMagicSingle_EffParam};

use super::model::{MagicSingleEntry, MagicSingleTable};

/// Parse a MagicSingleinfo.bin file from raw bytes.
pub fn load_magic_single(data: &[u8]) -> Result<MagicSingleTable> {
    let reader = BytesReader::from(data.to_vec());
    let parsed = PkoMagicSingle::read_into::<_, PkoMagicSingle>(&reader, None, None)
        .map_err(|e| anyhow!("Kaitai MagicSingle parse error: {:?}", e))?;

    let record_size = *parsed.record_size();

    let records = parsed.records();
    let mut entries = Vec::new();

    for rec in records.iter() {
        // Skip inactive records.
        if *rec.b_exist() == 0 {
            continue;
        }
        entries.push(convert_record(rec));
    }

    Ok(MagicSingleTable {
        record_size,
        entries,
    })
}

fn convert_record(rec: &PkoMagicSingle_EffParam) -> MagicSingleEntry {
    let model_num = (*rec.n_model_num()).max(0) as usize;
    let par_num = (*rec.n_par_num()).max(0) as usize;

    let models: Vec<String> = rec
        .str_model()
        .iter()
        .take(model_num)
        .map(|s| kaitai_fixed_str(s))
        .collect();

    let particles: Vec<String> = rec
        .str_part()
        .iter()
        .take(par_num)
        .map(|s| kaitai_fixed_str(s))
        .collect();

    let dummies: Vec<i32> = rec.n_dummy().clone();

    MagicSingleEntry {
        id: *rec.n_id(),
        data_name: kaitai_fixed_str(&rec.sz_data_name()),
        name: kaitai_fixed_str(&rec.sz_name()),
        models,
        velocity: *rec.n_vel(),
        particles,
        dummies,
        render_idx: *rec.n_render_idx(),
        light_id: *rec.n_light_id(),
        result_effect: kaitai_fixed_str(&rec.str_result()),
    }
}

/// Convert a Kaitai fixed-width ASCII string to a Rust String,
/// truncating at the first null byte.
fn kaitai_fixed_str(s: &str) -> String {
    let bytes: Vec<u8> = s.chars().map(|c| c as u8).collect();
    let end = bytes.iter().position(|b| *b == 0).unwrap_or(bytes.len());
    String::from_utf8_lossy(&bytes[..end]).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::effect_v2::magic_group_loader::load_magic_group;
    use std::collections::{BTreeMap, BTreeSet};
    use std::path::{Path, PathBuf};

    #[test]
    fn parse_magic_single_info() {
        let path = std::path::Path::new(
            "../top-client/corsairs-online-public/client/scripts/table/MagicSingleinfo.bin",
        );
        if !path.exists() {
            eprintln!(
                "Skipping: MagicSingleinfo.bin not found at {}",
                path.display()
            );
            return;
        }

        let data = std::fs::read(path).unwrap();
        let table = load_magic_single(&data).unwrap();

        // Verify header
        assert_eq!(
            table.record_size, 600,
            "record_size should be 600 (sizeof EFF_Param)"
        );

        // File is 39004 bytes → (39004 - 4) / 600 = 65 records total
        // Not all may be active (b_exist=1), but we should have some
        assert!(
            !table.entries.is_empty(),
            "Should have at least one active entry"
        );

        // Verify first entry (from hex dump: ID=10, name="Dual Shot Path of Flight Element")
        let first = &table.entries[0];
        assert_eq!(first.id, 10);
        assert_eq!(first.name, "Dual Shot Path of Flight Element");
        assert_eq!(first.models.len(), 1);
        assert_eq!(first.models[0], "runningattack.eff");
        assert_eq!(first.velocity, 10);
        assert_eq!(first.particles.len(), 0);
        assert_eq!(first.render_idx, 2);
        assert_eq!(first.result_effect, "0");

        // All dummies should be -1 for this entry
        assert!(
            first.dummies.iter().all(|&d| d == -1),
            "First entry dummies should all be -1"
        );

        eprintln!(
            "MagicSingleinfo: {} active entries parsed from {} byte file",
            table.entries.len(),
            data.len()
        );

        // Print a few entries for visual inspection
        for entry in table.entries.iter().take(5) {
            eprintln!(
                "  ID={:4} name={:40} models={:?} vel={} render={}",
                entry.id, entry.name, entry.models, entry.velocity, entry.render_idx
            );
        }
    }

    /// Optional real-client corpus gate for magic table dispatch and asset references.
    ///
    /// `MagicList[]` in this client contains render indices 0..=6 for single
    /// magic effects. `GroupList[]` contains group modes 0..=1. This test
    /// keeps the v2 renderer from silently drifting away from the actual table
    /// data shipped with the client corpus.
    #[test]
    fn magic_table_from_env_uses_source_defined_dispatch_and_assets() {
        let Ok(table_dir) = std::env::var("PKO_MAGIC_TABLE_DIR") else {
            eprintln!("Skipping magic table corpus gate: PKO_MAGIC_TABLE_DIR not set");
            return;
        };
        let table_dir = PathBuf::from(table_dir);
        assert!(
            table_dir.exists(),
            "PKO_MAGIC_TABLE_DIR does not exist: {}",
            table_dir.display(),
        );

        let magic_single_path = table_dir.join("MagicSingleinfo.bin");
        let magic_group_path = table_dir.join("MagicGroupInfo.bin");
        assert!(
            magic_single_path.exists(),
            "MagicSingleinfo.bin not found at {}",
            magic_single_path.display(),
        );
        assert!(
            magic_group_path.exists(),
            "MagicGroupInfo.bin not found at {}",
            magic_group_path.display(),
        );

        let single_data = std::fs::read(&magic_single_path).unwrap();
        let group_data = std::fs::read(&magic_group_path).unwrap();
        let single_table = load_magic_single(&single_data).unwrap();
        let group_table = load_magic_group(&group_data).unwrap();

        assert_eq!(single_table.record_size, 600);
        assert_eq!(group_table.record_size, 216);
        assert!(
            !single_table.entries.is_empty(),
            "MagicSingleinfo has no active entries"
        );
        assert!(
            !group_table.entries.is_empty(),
            "MagicGroupInfo has no active entries"
        );

        let effect_dir = infer_effect_dir_from_table_dir(&table_dir);
        assert!(
            effect_dir.exists(),
            "effect directory inferred from table dir does not exist: {}",
            effect_dir.display(),
        );

        let mut single_render_counts = BTreeMap::<i32, usize>::new();
        let mut group_render_counts = BTreeMap::<i32, usize>::new();
        let mut missing_assets = Vec::<String>::new();
        let single_ids = single_table
            .entries
            .iter()
            .map(|entry| entry.id)
            .collect::<BTreeSet<_>>();

        for entry in &single_table.entries {
            assert!(
                (0..=6).contains(&entry.render_idx),
                "MagicSingle id {} has unsupported render_idx {}",
                entry.id,
                entry.render_idx,
            );
            *single_render_counts.entry(entry.render_idx).or_insert(0) += 1;

            for model in &entry.models {
                collect_missing_referenced_asset(
                    &effect_dir,
                    model,
                    "eff",
                    entry.id,
                    "model",
                    &mut missing_assets,
                );
            }
            for particle in &entry.particles {
                collect_missing_referenced_asset(
                    &effect_dir,
                    particle,
                    "par",
                    entry.id,
                    "particle",
                    &mut missing_assets,
                );
            }
            if !is_empty_magic_asset_ref(&entry.result_effect) {
                collect_missing_referenced_asset(
                    &effect_dir,
                    &entry.result_effect,
                    "par",
                    entry.id,
                    "result_effect",
                    &mut missing_assets,
                );
            }
        }

        for entry in &group_table.entries {
            assert!(
                (0..=1).contains(&entry.render_idx),
                "MagicGroup id {} has unsupported render_idx {}",
                entry.id,
                entry.render_idx,
            );
            *group_render_counts.entry(entry.render_idx).or_insert(0) += 1;

            for (&type_id, &count) in entry.type_ids.iter().zip(&entry.counts) {
                if type_id < 0 || count <= 0 {
                    continue;
                }
                assert!(
                    single_ids.contains(&type_id),
                    "MagicGroup id {} references missing MagicSingle id {}",
                    entry.id,
                    type_id,
                );
            }
        }

        eprintln!(
            "Magic table corpus: {} single entries, {} group entries",
            single_table.entries.len(),
            group_table.entries.len(),
        );
        eprintln!("  single render_idx counts: {:?}", single_render_counts);
        eprintln!("  group render_idx counts: {:?}", group_render_counts);
        eprintln!("  missing referenced assets: {}", missing_assets.len());
        assert!(
            !single_render_counts.contains_key(&7),
            "Part_dist2/render_idx 7 is not dispatched by this client's MagicList[]",
        );
        for missing in missing_assets.iter().take(10) {
            eprintln!("    {missing}");
        }
        if std::env::var("PKO_MAGIC_STRICT_ASSETS").is_ok() {
            assert!(
                missing_assets.is_empty(),
                "Magic table references missing assets: {:?}",
                missing_assets,
            );
        }
    }

    fn infer_effect_dir_from_table_dir(table_dir: &Path) -> PathBuf {
        table_dir
            .parent()
            .and_then(Path::parent)
            .map(|client_dir| client_dir.join("effect"))
            .unwrap_or_else(|| table_dir.join("..").join("..").join("effect"))
    }

    fn is_empty_magic_asset_ref(name: &str) -> bool {
        let trimmed = name.trim();
        trimmed.is_empty() || trimmed == "0"
    }

    fn collect_missing_referenced_asset(
        effect_dir: &Path,
        name: &str,
        default_extension: &str,
        entry_id: i32,
        field_name: &str,
        missing_assets: &mut Vec<String>,
    ) {
        if is_empty_magic_asset_ref(name) {
            return;
        }

        let direct = effect_dir.join(name);
        let with_extension = if Path::new(name).extension().is_some() {
            direct.clone()
        } else {
            effect_dir.join(format!("{name}.{default_extension}"))
        };

        if !(direct.exists() || with_extension.exists()) {
            missing_assets.push(format!(
                "MagicSingle id {} missing {} asset {:?} under {}",
                entry_id,
                field_name,
                name,
                effect_dir.display(),
            ));
        }
    }
}
