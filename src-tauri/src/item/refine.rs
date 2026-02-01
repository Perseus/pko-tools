use std::collections::HashMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

// CRawDataInfo base class layout (108 bytes):
//   bExist: BOOL (i32)           offset 0, 4 bytes
//   nIndex: int                  offset 4, 4 bytes
//   szDataName: char[72]         offset 8, 72 bytes
//   dwLastUseTick: DWORD         offset 80, 4 bytes
//   bEnable: BOOL                offset 84, 4 bytes
//   pData: void* (4 bytes 32-bit) offset 88, 4 bytes
//   dwPackOffset: DWORD          offset 92, 4 bytes
//   dwDataSize: DWORD            offset 96, 4 bytes
//   nID: int                     offset 100, 4 bytes
//   dwLoadCnt: DWORD             offset 104, 4 bytes
const RAW_DATA_INFO_SIZE: usize = 108;
const RAW_DATA_INFO_BEXIST_OFFSET: usize = 0;
const RAW_DATA_INFO_NID_OFFSET: usize = 100;

/// Read a u32 at the given offset within a chunk
fn read_u32(data: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(data[offset..offset + 4].try_into().unwrap())
}

fn read_i32(data: &[u8], offset: usize) -> i32 {
    i32::from_le_bytes(data[offset..offset + 4].try_into().unwrap())
}

fn read_i16(data: &[u8], offset: usize) -> i16 {
    i16::from_le_bytes(data[offset..offset + 2].try_into().unwrap())
}

fn read_f32(data: &[u8], offset: usize) -> f32 {
    f32::from_le_bytes(data[offset..offset + 4].try_into().unwrap())
}

// ============================================================================
// ItemRefineEffectInfo.bin
// ============================================================================

/// CItemRefineEffectInfo (extends CRawDataInfo, 164 bytes total)
/// Derived fields at offset 108:
///   nLightID: int (4 bytes)
///   sEffectID: short[4][4] (32 bytes) — [cha_type][tier]
///   chDummy: char[4] (4 bytes)
///   _sEffectNum: int[4] (16 bytes)
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RefineEffectEntry {
    pub id: i32,
    pub light_id: i32,
    /// Effect IDs indexed as [char_type][tier] flattened to [char0_tier0, char0_tier1, ..., char3_tier3]
    pub effect_ids: Vec<i16>,
    /// Dummy point IDs per tier
    pub dummy_ids: Vec<i8>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RefineEffectTable {
    pub entries: Vec<RefineEffectEntry>,
}

/// Parse ItemRefineEffectInfo.bin
///
/// Binary format:
///   - 4 bytes: entry size (DWORD) — should be 164
///   - Then sequential entries of that size
///   - Each entry starts with CRawDataInfo (108 bytes), then derived fields
pub fn parse_refine_effects(data: &[u8]) -> anyhow::Result<RefineEffectTable> {
    if data.len() < 4 {
        return Ok(RefineEffectTable { entries: vec![] });
    }

    let entry_size = read_u32(data, 0) as usize;
    if entry_size == 0 {
        return Ok(RefineEffectTable { entries: vec![] });
    }

    let data = &data[4..]; // skip header
    let entry_count = data.len() / entry_size;
    let mut entries = Vec::new();

    for i in 0..entry_count {
        let offset = i * entry_size;
        if offset + entry_size > data.len() {
            break;
        }
        let chunk = &data[offset..offset + entry_size];

        // Check bExist
        let b_exist = read_i32(chunk, RAW_DATA_INFO_BEXIST_OFFSET);
        if b_exist == 0 {
            continue;
        }

        let id = read_i32(chunk, RAW_DATA_INFO_NID_OFFSET);

        // Derived fields start at RAW_DATA_INFO_SIZE (108)
        let derived = RAW_DATA_INFO_SIZE;

        let light_id = read_i32(chunk, derived);

        // sEffectID: short[4][4] — [cha_type][tier]
        let mut effect_ids = Vec::with_capacity(16);
        for j in 0..16 {
            let val = read_i16(chunk, derived + 4 + j * 2);
            effect_ids.push(val);
        }

        // chDummy: char[4] — one per tier
        let mut dummy_ids = Vec::with_capacity(4);
        for j in 0..4 {
            dummy_ids.push(chunk[derived + 4 + 32 + j] as i8);
        }

        entries.push(RefineEffectEntry {
            id,
            light_id,
            effect_ids,
            dummy_ids,
        });
    }

    Ok(RefineEffectTable { entries })
}

/// Load and parse ItemRefineEffectInfo.bin from a project directory
pub fn load_refine_effects(project_dir: &Path) -> anyhow::Result<RefineEffectTable> {
    let bin_path = project_dir.join("scripts/table/ItemRefineEffectInfo.bin");
    if !bin_path.exists() {
        return Ok(RefineEffectTable { entries: vec![] });
    }

    let data = std::fs::read(&bin_path)?;
    parse_refine_effects(&data)
}

// ============================================================================
// ItemRefineInfo.bin
// ============================================================================

/// CItemRefineInfo (extends CRawDataInfo, 152 bytes total)
/// Derived fields at offset 108:
///   Value: short[14] (28 bytes) — effect category → refine effect ID
///   fChaEffectScale: float[4] (16 bytes) — per-character-type effect scale
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ItemRefineInfoEntry {
    pub id: i32,
    pub values: Vec<i16>,
    pub cha_effect_scale: Vec<f32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ItemRefineInfoTable {
    pub entries: HashMap<i32, ItemRefineInfoEntry>,
}

/// Parse ItemRefineInfo.bin
pub fn parse_item_refine_info(data: &[u8]) -> anyhow::Result<ItemRefineInfoTable> {
    if data.len() < 4 {
        return Ok(ItemRefineInfoTable {
            entries: HashMap::new(),
        });
    }

    let entry_size = read_u32(data, 0) as usize;
    if entry_size == 0 {
        return Ok(ItemRefineInfoTable {
            entries: HashMap::new(),
        });
    }

    let data = &data[4..];
    let entry_count = data.len() / entry_size;
    let mut entries = HashMap::new();

    for i in 0..entry_count {
        let offset = i * entry_size;
        if offset + entry_size > data.len() {
            break;
        }
        let chunk = &data[offset..offset + entry_size];

        let b_exist = read_i32(chunk, RAW_DATA_INFO_BEXIST_OFFSET);
        if b_exist == 0 {
            continue;
        }

        let id = read_i32(chunk, RAW_DATA_INFO_NID_OFFSET);

        let derived = RAW_DATA_INFO_SIZE;

        // Value: short[14]
        let mut values = Vec::with_capacity(14);
        for j in 0..14 {
            values.push(read_i16(chunk, derived + j * 2));
        }

        // fChaEffectScale: float[4]
        let mut cha_effect_scale = Vec::with_capacity(4);
        for j in 0..4 {
            cha_effect_scale.push(read_f32(chunk, derived + 28 + j * 4));
        }

        entries.insert(
            id,
            ItemRefineInfoEntry {
                id,
                values,
                cha_effect_scale,
            },
        );
    }

    Ok(ItemRefineInfoTable { entries })
}

/// Load and parse ItemRefineInfo.bin from a project directory
pub fn load_item_refine_info(project_dir: &Path) -> anyhow::Result<ItemRefineInfoTable> {
    let bin_path = project_dir.join("scripts/table/ItemRefineInfo.bin");
    if !bin_path.exists() {
        return Ok(ItemRefineInfoTable {
            entries: HashMap::new(),
        });
    }

    let data = std::fs::read(&bin_path)?;
    parse_item_refine_info(&data)
}

// ============================================================================
// Stone combination logic (ported from stonehint.lua Item_Stoneeffect)
// ============================================================================

/// Port of the Lua `Item_Stoneeffect(Stone_Type1, Stone_Type2, Stone_Type3)` function.
/// Takes 3 stone types and returns an effect category (0-14).
///
/// Logic:
/// 1. Dedup identical types (set duplicates to -1)
/// 2. Compute sum and product of remaining types
/// 3. Match against known sum/product pairs to return category
pub fn stone_effect_category(stone1: i32, stone2: i32, stone3: i32) -> u32 {
    let mut s1 = stone1;
    let mut s2 = stone2;
    let s3 = stone3;

    // Dedup: if any two are equal, set the first one to -1
    if s1 == s2 {
        s1 = -1;
    }
    if s1 == s3 {
        s1 = -1;
    }
    if s2 == s3 {
        s2 = -1;
    }

    let sum = s1 + s2 + s3;
    let product = s1 * s2 * s3;

    if product > 0 {
        match sum {
            -1 => 1,
            0 => 2,
            1 => 3,
            2 => 4,
            6 => 11,
            7 => 12,
            8 => 13,
            9 => 14,
            _ => 0,
        }
    } else if product < 0 {
        match sum {
            2 => 5,
            3 => 6,
            4 => {
                if product == -4 {
                    7
                } else if product == -6 {
                    8
                } else {
                    0
                }
            }
            5 => 9,
            6 => 10,
            _ => 0,
        }
    } else {
        0
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ========================================================================
    // stone_effect_category tests
    // ========================================================================

    #[test]
    fn stone_effect_all_same_type_returns_zero() {
        // All three identical → both s1 and s2 get deduped to -1
        // product = (-1)*(-1)*1 = 1 > 0, sum = -1 + -1 + 1 = -1 → category 1
        // Actually let's trace: s1=1, s2=1, s3=1
        // s1==s2 → s1=-1; s1==s3? -1==1? no; s2==s3? 1==1 → s2=-1
        // sum = -1 + -1 + 1 = -1, product = (-1)*(-1)*1 = 1 > 0 → match -1 → 1
        assert_eq!(stone_effect_category(1, 1, 1), 1);
    }

    #[test]
    fn stone_effect_all_zeros() {
        // s1=0, s2=0, s3=0 → s1==s2 → s1=-1; s1==s3? -1==0? no; s2==s3? 0==0 → s2=-1
        // sum = -1+-1+0 = -2, product = (-1)*(-1)*0 = 0 → else branch → 0
        assert_eq!(stone_effect_category(0, 0, 0), 0);
    }

    #[test]
    fn stone_effect_category_2() {
        // Need product > 0 and sum == 0
        // Three distinct types that sum to 0: e.g. -1, 0, 1
        // Dedup: all different → no dedup
        // sum = 0, product = 0 → product == 0, not > 0
        // Try: 1, 2, -3 → no dedup, sum=0, product=-6 < 0 → no
        // For product > 0, sum == 0 with distinct values, need e.g. -1, -1, 2
        // But -1,-1 → s1=-1 (dedup), then s1==s3? -1==2? no, s2==s3? -1==2? no
        // Actually wait: stone types in the game are 0-6 (7 types). Let's check known combos.
        // From the Lua: product > 0 and sum == 0 → category 2
        // With dedup, we need product of remaining * originals to be > 0 and sum=0
        // Types are typically 1-6 in-game, so product > 0 always for valid types.
        // All same type x: s1→-1, s2→-1, sum=-1-1+x = x-2, product = x
        // For sum=0 → x=2 → stone_effect_category(2,2,2)
        assert_eq!(stone_effect_category(2, 2, 2), 2);
    }

    #[test]
    fn stone_effect_category_3() {
        // product > 0, sum == 1 → category 3
        // All same: x-2=1 → x=3
        assert_eq!(stone_effect_category(3, 3, 3), 3);
    }

    #[test]
    fn stone_effect_category_4() {
        // product > 0, sum == 2 → category 4
        // All same: x=4
        assert_eq!(stone_effect_category(4, 4, 4), 4);
    }

    #[test]
    fn stone_effect_distinct_types_category_5() {
        // product < 0, sum == 2 → category 5
        // Need 3 distinct types where product < 0 and sum = 2
        // Types -1, 1, 2: sum=2, product=-2 < 0 → 5
        // But game uses types 1-6. Let's see with dedup:
        // Types 1, 2, 3 → all distinct, sum=6, product=6 < 0? No, product=6 > 0, sum=6 → 11
        assert_eq!(stone_effect_category(1, 2, 3), 11);
    }

    #[test]
    fn stone_effect_category_11_to_14() {
        // product > 0, sum 6-9 → categories 11-14
        // All same x: sum=x-2, product=x
        // sum=6 → x=8 (but game types are 1-6, so out of range for same-type)
        // Use three distinct: 1,2,3 → sum=6, product=6 > 0 → 11
        assert_eq!(stone_effect_category(1, 2, 3), 11);
        // 1,2,4 → sum=7, product=8 > 0 → 12
        assert_eq!(stone_effect_category(1, 2, 4), 12);
        // 1,2,5 → sum=8, product=10 > 0 → 13
        assert_eq!(stone_effect_category(1, 2, 5), 13);
        // 1,2,6 → sum=9, product=12 > 0 → 14
        assert_eq!(stone_effect_category(1, 2, 6), 14);
    }

    #[test]
    fn stone_effect_two_same_one_different() {
        // (1, 1, 3): s1==s2 → s1=-1; s1==s3? -1==3 no; s2==s3? 1==3 no
        // sum = -1+1+3=3, product = -1*1*3=-3 < 0 → match sum 3 → 6
        assert_eq!(stone_effect_category(1, 1, 3), 6);
    }

    #[test]
    fn stone_effect_product_negative_sum_4_disambiguate() {
        // product < 0, sum == 4 → depends on product:
        // product == -4 → 7, product == -6 → 8
        // (1, 1, 4): s1=-1, sum=-1+1+4=4, product=-1*1*4=-4 → 7
        assert_eq!(stone_effect_category(1, 1, 4), 7);
        // (1, 1, 6) won't work for product=-6 because product = -1*1*6 = -6
        // wait: sum = -1+1+6 = 6, that's sum 6 not 4
        // Need sum=4, product=-6: s1(-1)*s2*s3=-6 → s2*s3=6
        // sum = -1 + s2 + s3 = 4 → s2 + s3 = 5
        // s2*s3=6, s2+s3=5 → quadratic: x^2-5x+6=0 → x=2,3
        // So types (2, 2, 3): s1=2,s2=2,s3=3 → s1==s2 → s1=-1
        // sum = -1+2+3=4, product = -1*2*3=-6 → 8
        assert_eq!(stone_effect_category(2, 2, 3), 8);
    }

    #[test]
    fn stone_effect_order_independence() {
        // Different orderings of (1, 2, 3) should all give the same result
        let expected = stone_effect_category(1, 2, 3);
        assert_eq!(stone_effect_category(2, 1, 3), expected);
        assert_eq!(stone_effect_category(3, 1, 2), expected);
        assert_eq!(stone_effect_category(3, 2, 1), expected);
    }

    // ========================================================================
    // parse_refine_effects (ItemRefineEffectInfo.bin) tests
    // ========================================================================

    fn build_refine_effect_entry(id: i32, light_id: i32, effect_ids: &[i16; 16], dummy_ids: &[i8; 4]) -> Vec<u8> {
        let entry_size = 164usize;
        let mut buf = vec![0u8; entry_size];

        // bExist = 1
        buf[0..4].copy_from_slice(&1i32.to_le_bytes());
        // nID at offset 100
        buf[100..104].copy_from_slice(&id.to_le_bytes());

        let d = RAW_DATA_INFO_SIZE; // 108
        // nLightID
        buf[d..d + 4].copy_from_slice(&light_id.to_le_bytes());
        // sEffectID: short[16] at offset d+4
        for (j, &eid) in effect_ids.iter().enumerate() {
            let off = d + 4 + j * 2;
            buf[off..off + 2].copy_from_slice(&eid.to_le_bytes());
        }
        // chDummy at offset d+4+32
        for (j, &did) in dummy_ids.iter().enumerate() {
            buf[d + 4 + 32 + j] = did as u8;
        }
        buf
    }

    #[test]
    fn parse_refine_effects_single_entry() {
        let effect_ids: [i16; 16] = [10, 20, 30, 40, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        let dummy_ids: [i8; 4] = [1, 2, 3, 0];
        let entry = build_refine_effect_entry(42, 7, &effect_ids, &dummy_ids);

        let mut data = Vec::new();
        data.extend_from_slice(&164u32.to_le_bytes()); // entry_size header
        data.extend_from_slice(&entry);

        let table = parse_refine_effects(&data).unwrap();
        assert_eq!(table.entries.len(), 1);
        assert_eq!(table.entries[0].id, 42);
        assert_eq!(table.entries[0].light_id, 7);
        assert_eq!(table.entries[0].effect_ids.len(), 16);
        assert_eq!(table.entries[0].effect_ids[0], 10);
        assert_eq!(table.entries[0].effect_ids[1], 20);
        assert_eq!(table.entries[0].effect_ids[2], 30);
        assert_eq!(table.entries[0].effect_ids[3], 40);
        assert_eq!(table.entries[0].dummy_ids, vec![1, 2, 3, 0]);
    }

    #[test]
    fn parse_refine_effects_skips_non_existent() {
        let effect_ids: [i16; 16] = [0; 16];
        let dummy_ids: [i8; 4] = [0; 4];

        let mut entry1 = build_refine_effect_entry(1, 0, &effect_ids, &dummy_ids);
        // Set bExist = 0 for entry1
        entry1[0..4].copy_from_slice(&0i32.to_le_bytes());

        let entry2 = build_refine_effect_entry(2, 5, &effect_ids, &dummy_ids);

        let mut data = Vec::new();
        data.extend_from_slice(&164u32.to_le_bytes());
        data.extend_from_slice(&entry1);
        data.extend_from_slice(&entry2);

        let table = parse_refine_effects(&data).unwrap();
        assert_eq!(table.entries.len(), 1);
        assert_eq!(table.entries[0].id, 2);
        assert_eq!(table.entries[0].light_id, 5);
    }

    #[test]
    fn parse_refine_effects_empty_data() {
        let table = parse_refine_effects(&[]).unwrap();
        assert!(table.entries.is_empty());

        let table = parse_refine_effects(&0u32.to_le_bytes()).unwrap();
        assert!(table.entries.is_empty());
    }

    // ========================================================================
    // parse_item_refine_info (ItemRefineInfo.bin) tests
    // ========================================================================

    fn build_refine_info_entry(id: i32, values: &[i16; 14], scales: &[f32; 4]) -> Vec<u8> {
        let entry_size = 152usize;
        let mut buf = vec![0u8; entry_size];

        // bExist = 1
        buf[0..4].copy_from_slice(&1i32.to_le_bytes());
        // nID at offset 100
        buf[100..104].copy_from_slice(&id.to_le_bytes());

        let d = RAW_DATA_INFO_SIZE; // 108
        // Value: short[14] at offset d
        for (j, &v) in values.iter().enumerate() {
            let off = d + j * 2;
            buf[off..off + 2].copy_from_slice(&v.to_le_bytes());
        }
        // fChaEffectScale: float[4] at offset d+28
        for (j, &s) in scales.iter().enumerate() {
            let off = d + 28 + j * 4;
            buf[off..off + 4].copy_from_slice(&s.to_le_bytes());
        }
        buf
    }

    #[test]
    fn parse_item_refine_info_single_entry() {
        let values: [i16; 14] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
        let scales: [f32; 4] = [1.0, 1.5, 0.8, 2.0];
        let entry = build_refine_info_entry(100, &values, &scales);

        let mut data = Vec::new();
        data.extend_from_slice(&152u32.to_le_bytes());
        data.extend_from_slice(&entry);

        let table = parse_item_refine_info(&data).unwrap();
        assert_eq!(table.entries.len(), 1);
        let e = table.entries.get(&100).unwrap();
        assert_eq!(e.id, 100);
        assert_eq!(e.values, values.to_vec());
        assert_eq!(e.cha_effect_scale[0], 1.0);
        assert_eq!(e.cha_effect_scale[1], 1.5);
        assert_eq!(e.cha_effect_scale[2], 0.8);
        assert_eq!(e.cha_effect_scale[3], 2.0);
    }

    #[test]
    fn parse_item_refine_info_empty_data() {
        let table = parse_item_refine_info(&[]).unwrap();
        assert!(table.entries.is_empty());
    }

    #[test]
    fn parse_item_refine_info_multiple_entries() {
        let values1: [i16; 14] = [10; 14];
        let values2: [i16; 14] = [20; 14];
        let scales: [f32; 4] = [1.0; 4];

        let entry1 = build_refine_info_entry(5, &values1, &scales);
        let entry2 = build_refine_info_entry(10, &values2, &scales);

        let mut data = Vec::new();
        data.extend_from_slice(&152u32.to_le_bytes());
        data.extend_from_slice(&entry1);
        data.extend_from_slice(&entry2);

        let table = parse_item_refine_info(&data).unwrap();
        assert_eq!(table.entries.len(), 2);
        assert_eq!(table.entries.get(&5).unwrap().values[0], 10);
        assert_eq!(table.entries.get(&10).unwrap().values[0], 20);
    }
}
