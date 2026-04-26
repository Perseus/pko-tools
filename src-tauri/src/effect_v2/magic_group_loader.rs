use anyhow::{anyhow, Result};

use super::model::{MagicGroupEntry, MagicGroupTable};

/// Parse a MagicGroupInfo.bin file from raw bytes.
///
/// Binary layout:
///   4 bytes  — record_size (u32, expected 216 for Group_Param)
///   N × record_size bytes — one Group_Param per record
///
/// Group_Param layout (inheriting CRawDataInfo):
///   Offset 0:   b_exist (u32)
///   Offset 4:   n_index (i32)
///   Offset 8:   sz_data_name (72 bytes, null-terminated ASCII)
///   Offset 80:  dw_last_use_tick (u32)
///   Offset 84:  b_enable (u32)
///   Offset 88:  p_data (u32)
///   Offset 92:  dw_pack_offset (u32)
///   Offset 96:  dw_data_size (u32)
///   Offset 100: n_id (i32)
///   Offset 104: dw_load_cnt (u32)
///   --- CRawDataInfo base ends at 108 ---
///   Offset 108: sz_name (32 bytes, null-terminated ASCII)
///   Offset 140: n_type_num (i32)
///   Offset 144: n_type_id[8] (8 × i32 = 32 bytes)
///   Offset 176: n_num[8] (8 × i32 = 32 bytes)
///   Offset 208: n_total_num (i32)
///   Offset 212: n_render_idx (i32)
///   --- Total: 216 bytes ---
pub fn load_magic_group(data: &[u8]) -> Result<MagicGroupTable> {
    if data.len() < 4 {
        return Err(anyhow!("MagicGroupInfo.bin too small: {} bytes", data.len()));
    }

    let record_size = u32::from_le_bytes(data[0..4].try_into()?) as usize;
    if record_size == 0 {
        return Err(anyhow!("MagicGroupInfo.bin: record_size is 0"));
    }

    let remaining = data.len() - 4;
    let record_count = remaining / record_size;
    let mut entries = Vec::new();

    for i in 0..record_count {
        let offset = 4 + i * record_size;
        let end = offset + record_size;
        if end > data.len() {
            break;
        }
        if let Some(entry) = parse_group_record(&data[offset..end])? {
            entries.push(entry);
        }
    }

    Ok(MagicGroupTable {
        record_size: record_size as u32,
        entries,
    })
}

fn read_u32(data: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(data[offset..offset + 4].try_into().unwrap())
}

fn read_i32(data: &[u8], offset: usize) -> i32 {
    i32::from_le_bytes(data[offset..offset + 4].try_into().unwrap())
}

fn parse_group_record(data: &[u8]) -> Result<Option<MagicGroupEntry>> {
    if data.len() < 216 {
        return Err(anyhow!("Group record too small: {} bytes (need 216)", data.len()));
    }

    // CRawDataInfo base (108 bytes)
    let b_exist = read_u32(data, 0);
    if b_exist == 0 {
        return Ok(None); // inactive record
    }

    let data_name = fixed_str(&data[8..80]);
    let n_id = read_i32(data, 100);

    // Group_Param derived fields (starts at offset 108)
    let name = fixed_str(&data[108..140]);
    let _n_type_num = read_i32(data, 140);

    let mut type_ids = Vec::with_capacity(8);
    for j in 0..8 {
        type_ids.push(read_i32(data, 144 + j * 4));
    }

    let mut counts = Vec::with_capacity(8);
    for j in 0..8 {
        counts.push(read_i32(data, 176 + j * 4));
    }

    let total_count = read_i32(data, 208);
    let render_idx = read_i32(data, 212);

    Ok(Some(MagicGroupEntry {
        id: n_id,
        data_name,
        name,
        type_ids,
        counts,
        total_count,
        render_idx,
    }))
}

/// Convert a fixed-width byte buffer to a String, truncating at the first null byte.
fn fixed_str(buf: &[u8]) -> String {
    let end = buf.iter().position(|b| *b == 0).unwrap_or(buf.len());
    String::from_utf8_lossy(&buf[..end]).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_magic_group_info() {
        let path = std::path::Path::new(
            "../top-client/corsairs-online-public/client/scripts/table/MagicGroupInfo.bin",
        );
        if !path.exists() {
            eprintln!("Skipping: MagicGroupInfo.bin not found at {}", path.display());
            return;
        }

        let data = std::fs::read(path).unwrap();
        let table = load_magic_group(&data).unwrap();

        assert_eq!(table.record_size, 216, "record_size should be 216 (sizeof Group_Param)");

        assert!(
            !table.entries.is_empty(),
            "Should have at least one active entry"
        );

        // Verify structure: all entries should have 8 type_ids and 8 counts
        for entry in &table.entries {
            assert_eq!(entry.type_ids.len(), 8);
            assert_eq!(entry.counts.len(), 8);
        }

        eprintln!(
            "MagicGroupInfo: {} active entries parsed from {} byte file",
            table.entries.len(),
            data.len()
        );

        // Print first few entries for visual inspection
        for entry in table.entries.iter().take(5) {
            let active_types: Vec<_> = entry.type_ids.iter()
                .zip(&entry.counts)
                .filter(|(&id, _)| id >= 0)
                .map(|(&id, &count)| format!("{}x{}", id, count))
                .collect();
            eprintln!(
                "  ID={:4} name={:30} types=[{}] total={} render={}",
                entry.id, entry.name, active_types.join(", "),
                entry.total_count, entry.render_idx
            );
        }
    }
}
