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

    #[test]
    fn parse_magic_single_info() {
        let path = std::path::Path::new(
            "../top-client/corsairs-online-public/client/scripts/table/MagicSingleinfo.bin",
        );
        if !path.exists() {
            eprintln!("Skipping: MagicSingleinfo.bin not found at {}", path.display());
            return;
        }

        let data = std::fs::read(path).unwrap();
        let table = load_magic_single(&data).unwrap();

        // Verify header
        assert_eq!(table.record_size, 600, "record_size should be 600 (sizeof EFF_Param)");

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
}
