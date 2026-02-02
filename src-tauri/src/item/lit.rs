use std::path::Path;

use serde::{Deserialize, Serialize};

/// C++ constants from lwHeader.h
const LW_MAX_NAME: usize = 64;
const LW_MAX_FILE: usize = 128;

/// lwLitInfo: 4 + 128 + 4 + 4 + 4 = 144 bytes
const LIT_ENTRY_SIZE: usize = 4 + LW_MAX_FILE + 4 + 4 + 4;

/// A single lit (glow texture) entry for an item
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ItemLitEntry {
    pub id: u32,
    pub file: String,
    pub anim_type: u32,
    pub transp_type: u32,
    pub opacity: f32,
}

/// Lit info for an item (maps item ID to glow texture data)
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ItemLitInfo {
    pub item_id: u32,
    pub descriptor: String,
    pub file: String,
    pub lits: Vec<ItemLitEntry>,
}

/// Read a fixed-size char buffer and trim at the first null byte.
fn read_fixed_string(data: &[u8], offset: usize, size: usize) -> anyhow::Result<String> {
    if offset + size > data.len() {
        return Err(anyhow::anyhow!(
            "Not enough data for fixed string at offset {} (need {} bytes, have {})",
            offset,
            size,
            data.len() - offset
        ));
    }
    let buf = &data[offset..offset + size];
    // Find first null byte and trim
    let end = buf.iter().position(|&b| b == 0).unwrap_or(size);
    Ok(String::from_utf8_lossy(&buf[..end]).to_string())
}

/// Parse the binary item.lit file.
///
/// Binary layout (from C++ source ItemLit.h / ItemLit.cpp):
///
/// Header (lwItemLitFileHead):
///   - version: u32
///   - type: u32
///   - mask: [u32; 4]
///   Total: 24 bytes
///
/// item_count: u32
///
/// Per item (lwItemLitInfo):
///   - id: u32
///   - descriptor: char[64]  (LW_MAX_NAME, fixed-size, null-padded)
///   - file: char[128]       (LW_MAX_FILE, fixed-size, null-padded)
///   - lit_count: u32
///   - Per lit (lwLitInfo, read as sizeof(lwLitInfo) = 144 bytes):
///     - id: u32
///     - file: char[128]     (LW_MAX_FILE, fixed-size, null-padded)
///     - anim_type: u32
///     - transp_type: u32
///     - opacity: f32
///
/// Note: The C++ code overwrites item id with sequential index (item_info->id = i)
/// and lit id with sequential index (lit_info->id = j) after reading.
pub fn parse_item_lit(data: &[u8]) -> anyhow::Result<Vec<ItemLitInfo>> {
    const HEADER_SIZE: usize = 24; // version(4) + type(4) + mask(16)

    if data.len() < HEADER_SIZE + 4 {
        return Err(anyhow::anyhow!("item.lit file too small"));
    }

    let mut offset = 0;

    // Read header
    let _version = u32::from_le_bytes(data[offset..offset + 4].try_into()?);
    offset += 4;
    let _type = u32::from_le_bytes(data[offset..offset + 4].try_into()?);
    offset += 4;
    // Skip mask (4 x u32)
    offset += 16;

    let item_count = u32::from_le_bytes(data[offset..offset + 4].try_into()?);
    offset += 4;

    let mut items = Vec::with_capacity(item_count as usize);

    for i in 0..item_count {
        // id: u32
        if offset + 4 > data.len() {
            return Err(anyhow::anyhow!("Unexpected EOF reading item {} id", i));
        }
        let _id = u32::from_le_bytes(data[offset..offset + 4].try_into()?);
        offset += 4;

        // descriptor: char[LW_MAX_NAME] (64 bytes)
        let descriptor = read_fixed_string(data, offset, LW_MAX_NAME)?;
        offset += LW_MAX_NAME;

        // file: char[LW_MAX_FILE] (128 bytes)
        let file = read_fixed_string(data, offset, LW_MAX_FILE)?;
        offset += LW_MAX_FILE;

        // lit_count: u32
        if offset + 4 > data.len() {
            return Err(anyhow::anyhow!(
                "Unexpected EOF reading item {} lit_count",
                i
            ));
        }
        let lit_count = u32::from_le_bytes(data[offset..offset + 4].try_into()?);
        offset += 4;

        let mut lits = Vec::with_capacity(lit_count as usize);
        for j in 0..lit_count {
            // lwLitInfo is read as a single block of LIT_ENTRY_SIZE bytes
            if offset + LIT_ENTRY_SIZE > data.len() {
                return Err(anyhow::anyhow!(
                    "Unexpected EOF reading item {} lit entry {}",
                    i,
                    j
                ));
            }

            let lit_id = u32::from_le_bytes(data[offset..offset + 4].try_into()?);
            offset += 4;

            let lit_file = read_fixed_string(data, offset, LW_MAX_FILE)?;
            offset += LW_MAX_FILE;

            let anim_type = u32::from_le_bytes(data[offset..offset + 4].try_into()?);
            offset += 4;
            let transp_type = u32::from_le_bytes(data[offset..offset + 4].try_into()?);
            offset += 4;
            let opacity = f32::from_le_bytes(data[offset..offset + 4].try_into()?);
            offset += 4;

            lits.push(ItemLitEntry {
                id: lit_id,
                file: lit_file,
                anim_type,
                transp_type,
                opacity,
            });
        }

        // C++ overwrites id with sequential index: item_info->id = i
        items.push(ItemLitInfo {
            item_id: i,
            descriptor,
            file,
            lits,
        });
    }

    Ok(items)
}

/// Load and parse item.lit from a project directory
pub fn load_item_lit(project_dir: &Path) -> anyhow::Result<Vec<ItemLitInfo>> {
    let lit_path = project_dir.join("scripts/txt/item.lit");
    if !lit_path.exists() {
        return Ok(vec![]);
    }

    let data = std::fs::read(&lit_path)?;
    parse_item_lit(&data)
}

/// Get lit info for a specific item ID
pub fn get_item_lit_info(project_dir: &Path, item_id: u32) -> anyhow::Result<Option<ItemLitInfo>> {
    let all_lits = load_item_lit(project_dir)?;
    Ok(all_lits.into_iter().find(|lit| lit.item_id == item_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a minimal valid item.lit binary blob.
    fn build_item_lit_data(items: &[(&str, &str, &[(&str, u32, u32, f32)])]) -> Vec<u8> {
        let mut data = Vec::new();

        // Header: version(4) + type(4) + mask(16) = 24 bytes
        data.extend_from_slice(&1u32.to_le_bytes()); // version
        data.extend_from_slice(&0u32.to_le_bytes()); // type
        data.extend_from_slice(&[0u8; 16]);          // mask

        // item_count
        data.extend_from_slice(&(items.len() as u32).to_le_bytes());

        for (i, (descriptor, file, lits)) in items.iter().enumerate() {
            // id (overwritten to sequential index by parser, but write original)
            data.extend_from_slice(&(i as u32).to_le_bytes());

            // descriptor: char[64]
            let mut desc_buf = [0u8; 64];
            let desc_bytes = descriptor.as_bytes();
            desc_buf[..desc_bytes.len().min(64)].copy_from_slice(&desc_bytes[..desc_bytes.len().min(64)]);
            data.extend_from_slice(&desc_buf);

            // file: char[128]
            let mut file_buf = [0u8; 128];
            let file_bytes = file.as_bytes();
            file_buf[..file_bytes.len().min(128)].copy_from_slice(&file_bytes[..file_bytes.len().min(128)]);
            data.extend_from_slice(&file_buf);

            // lit_count
            data.extend_from_slice(&(lits.len() as u32).to_le_bytes());

            for (j, (lit_file, anim_type, transp_type, opacity)) in lits.iter().enumerate() {
                // lwLitInfo: id(4) + file(128) + anim_type(4) + transp_type(4) + opacity(4) = 144
                data.extend_from_slice(&(j as u32).to_le_bytes());

                let mut lit_file_buf = [0u8; 128];
                let lit_bytes = lit_file.as_bytes();
                lit_file_buf[..lit_bytes.len().min(128)].copy_from_slice(&lit_bytes[..lit_bytes.len().min(128)]);
                data.extend_from_slice(&lit_file_buf);

                data.extend_from_slice(&anim_type.to_le_bytes());
                data.extend_from_slice(&transp_type.to_le_bytes());
                data.extend_from_slice(&opacity.to_le_bytes());
            }
        }

        data
    }

    #[test]
    fn parse_single_item_with_one_lit() {
        let data = build_item_lit_data(&[
            ("sword_glow", "glow_base.tga", &[
                ("glow_tier0.tga", 2, 1, 0.8),
            ]),
        ]);

        let items = parse_item_lit(&data).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].item_id, 0);
        assert_eq!(items[0].descriptor, "sword_glow");
        assert_eq!(items[0].file, "glow_base.tga");
        assert_eq!(items[0].lits.len(), 1);
        assert_eq!(items[0].lits[0].file, "glow_tier0.tga");
        assert_eq!(items[0].lits[0].anim_type, 2);
        assert_eq!(items[0].lits[0].transp_type, 1);
        assert!((items[0].lits[0].opacity - 0.8).abs() < f32::EPSILON);
    }

    #[test]
    fn parse_item_with_multiple_lits() {
        let data = build_item_lit_data(&[
            ("blade", "blade.tga", &[
                ("tier0.tga", 1, 0, 1.0),
                ("tier1.tga", 2, 1, 0.9),
                ("tier2.tga", 3, 2, 0.7),
            ]),
        ]);

        let items = parse_item_lit(&data).unwrap();
        assert_eq!(items[0].lits.len(), 3);
        assert_eq!(items[0].lits[0].file, "tier0.tga");
        assert_eq!(items[0].lits[1].file, "tier1.tga");
        assert_eq!(items[0].lits[2].file, "tier2.tga");
        assert_eq!(items[0].lits[2].anim_type, 3);
    }

    #[test]
    fn parse_multiple_items() {
        let data = build_item_lit_data(&[
            ("item_a", "a.tga", &[("a_lit.tga", 1, 1, 1.0)]),
            ("item_b", "b.tga", &[]),
        ]);

        let items = parse_item_lit(&data).unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].item_id, 0);
        assert_eq!(items[0].descriptor, "item_a");
        assert_eq!(items[0].lits.len(), 1);
        assert_eq!(items[1].item_id, 1);
        assert_eq!(items[1].descriptor, "item_b");
        assert_eq!(items[1].lits.len(), 0);
    }

    #[test]
    fn parse_item_lit_too_small() {
        assert!(parse_item_lit(&[0u8; 10]).is_err());
    }

    #[test]
    fn parse_item_with_no_items() {
        let data = build_item_lit_data(&[]);
        let items = parse_item_lit(&data).unwrap();
        assert!(items.is_empty());
    }

    #[test]
    fn read_fixed_string_trims_at_null() {
        let mut buf = [0u8; 64];
        buf[0] = b'H';
        buf[1] = b'i';
        // rest is zeros
        let s = read_fixed_string(&buf, 0, 64).unwrap();
        assert_eq!(s, "Hi");
    }

    #[test]
    fn read_fixed_string_full_buffer() {
        let buf = [b'A'; 64]; // no null byte
        let s = read_fixed_string(&buf, 0, 64).unwrap();
        assert_eq!(s.len(), 64);
        assert!(s.chars().all(|c| c == 'A'));
    }

    #[test]
    fn read_fixed_string_out_of_bounds() {
        let buf = [0u8; 10];
        assert!(read_fixed_string(&buf, 5, 64).is_err());
    }

    #[test]
    fn test_parse_real_item_lit() {
        let path = std::path::PathBuf::from("../top-client/scripts/txt/item.lit");
        if !path.exists() {
            eprintln!("item.lit not found at {:?}, skipping", path);
            return;
        }

        let data = std::fs::read(&path).unwrap();
        eprintln!("item.lit file size: {} bytes", data.len());

        let items = parse_item_lit(&data).unwrap();
        eprintln!("Parsed {} item lit entries", items.len());

        for item in &items {
            eprintln!(
                "  ItemLit[{}]: descriptor='{}', file='{}', {} lits",
                item.item_id, item.descriptor, item.file, item.lits.len()
            );
            for lit in &item.lits {
                eprintln!(
                    "    Lit[{}]: file='{}', anim_type={}, transp_type={}, opacity={}",
                    lit.id, lit.file, lit.anim_type, lit.transp_type, lit.opacity
                );
            }
        }

        assert!(!items.is_empty(), "Expected at least one item lit entry");

        // Verify entry at index 1 (light_id=1 in forge chain)
        if items.len() > 1 {
            let entry1 = &items[1];
            eprintln!("\nEntry at index 1 (light_id=1):");
            eprintln!("  descriptor: '{}'", entry1.descriptor);
            eprintln!("  file: '{}'", entry1.file);
            assert!(!entry1.lits.is_empty(), "Entry 1 should have lit entries");
            for lit in &entry1.lits {
                eprintln!("  lit file: '{}', anim={}, transp={}, opacity={}", lit.file, lit.anim_type, lit.transp_type, lit.opacity);
                // Verify the lit texture file is a .tga
                assert!(
                    lit.file.to_lowercase().ends_with(".tga") || lit.file.to_lowercase().ends_with(".dds") || lit.file.to_lowercase().ends_with(".bmp"),
                    "Lit texture file should be a valid texture format: '{}'",
                    lit.file
                );
            }
        }
    }
}
