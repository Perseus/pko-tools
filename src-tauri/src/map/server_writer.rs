use anyhow::{anyhow, Result};

use super::terrain::{get_tile, ParsedMap};

const SERVER_HEADER_SIZE: usize = 8;

pub fn serialize_atr(map: &ParsedMap) -> Result<Vec<u8>> {
    validate_map_structure(map)?;
    let tile_count =
        checked_product_to_usize(map.header.n_width, map.header.n_height, "ATR tile count")?;
    let payload_size = tile_count
        .checked_mul(3)
        .ok_or_else(|| anyhow!("ATR payload is too large"))?;
    let mut out = Vec::with_capacity(SERVER_HEADER_SIZE + payload_size);

    write_i32(&mut out, map.header.n_width);
    write_i32(&mut out, map.header.n_height);

    for tile_y in 0..map.header.n_height {
        for tile_x in 0..map.header.n_width {
            if let Some(tile) = get_tile(map, tile_x, tile_y) {
                out.extend_from_slice(&tile.s_region.to_le_bytes());
                out.push(tile.bt_island);
            } else {
                out.extend_from_slice(&0i16.to_le_bytes());
                out.push(0);
            }
        }
    }

    Ok(out)
}

pub fn serialize_blk(map: &ParsedMap) -> Result<Vec<u8>> {
    validate_map_structure(map)?;
    let collision_width = map
        .header
        .n_width
        .checked_mul(2)
        .ok_or_else(|| anyhow!("BLK width overflows"))?;
    let collision_height = map
        .header
        .n_height
        .checked_mul(2)
        .ok_or_else(|| anyhow!("BLK height overflows"))?;
    // The stock server CBlockData reader reads `_nWidth / 8` bytes per row,
    // so each collision row must be byte-aligned.
    if collision_width % 8 != 0 {
        return Err(anyhow!(
            "BLK collision width {} is not byte-aligned for server row reads",
            collision_width
        ));
    }

    let row_bytes =
        usize::try_from(collision_width / 8).map_err(|_| anyhow!("BLK row width is too large"))?;
    let bitmap_size = row_bytes
        .checked_mul(
            usize::try_from(collision_height)
                .map_err(|_| anyhow!("BLK collision height is too large"))?,
        )
        .ok_or_else(|| anyhow!("BLK collision grid is too large"))?;
    let mut out = Vec::with_capacity(SERVER_HEADER_SIZE + bitmap_size);

    write_i32(&mut out, collision_width);
    write_i32(&mut out, collision_height);
    out.resize(SERVER_HEADER_SIZE + bitmap_size, 0);

    for cell_y in 0..collision_height {
        for cell_x in 0..collision_width {
            let tile_x = cell_x / 2;
            let tile_y = cell_y / 2;
            let subtile_index = ((cell_y % 2) * 2 + (cell_x % 2)) as usize;
            let blocked = get_tile(map, tile_x, tile_y)
                .map(|tile| tile.bt_block[subtile_index] & 0x80 != 0)
                .unwrap_or(false);
            if blocked {
                let row_offset = usize::try_from(cell_y)
                    .map_err(|_| anyhow!("BLK row index is too large"))?
                    .checked_mul(row_bytes)
                    .ok_or_else(|| anyhow!("BLK row offset overflows"))?;
                let byte_index = SERVER_HEADER_SIZE
                    + row_offset
                    + usize::try_from(cell_x / 8)
                        .map_err(|_| anyhow!("BLK column index is too large"))?;
                let bit_index = 7 - (cell_x % 8);
                out[byte_index] |= 1 << bit_index;
            }
        }
    }

    Ok(out)
}

fn validate_map_structure(map: &ParsedMap) -> Result<()> {
    if map.header.n_width <= 0
        || map.header.n_height <= 0
        || map.header.n_section_width <= 0
        || map.header.n_section_height <= 0
    {
        return Err(anyhow!(
            "MAP dimensions and section dimensions must be positive"
        ));
    }
    if map.header.n_width % map.header.n_section_width != 0
        || map.header.n_height % map.header.n_section_height != 0
    {
        return Err(anyhow!(
            "MAP dimensions must be divisible by section dimensions"
        ));
    }

    let section_cnt_x = map.header.n_width / map.header.n_section_width;
    let section_cnt_y = map.header.n_height / map.header.n_section_height;
    if map.section_cnt_x != section_cnt_x || map.section_cnt_y != section_cnt_y {
        return Err(anyhow!(
            "MAP section counts {}x{} do not match header-derived {}x{}",
            map.section_cnt_x,
            map.section_cnt_y,
            section_cnt_x,
            section_cnt_y
        ));
    }

    let section_count =
        checked_product_to_usize(section_cnt_x, section_cnt_y, "MAP section count")?;
    if map.sections.len() != section_count {
        return Err(anyhow!(
            "MAP section array length {} does not match expected {}",
            map.sections.len(),
            section_count
        ));
    }
    if map.section_offsets.len() != section_count {
        return Err(anyhow!(
            "MAP section offset table length {} does not match expected {}",
            map.section_offsets.len(),
            section_count
        ));
    }

    let tiles_per_section = checked_product_to_usize(
        map.header.n_section_width,
        map.header.n_section_height,
        "MAP tiles per section",
    )?;
    for (section_index, section) in map.sections.iter().enumerate() {
        let Some(section) = section else {
            continue;
        };
        if section.tiles.len() != tiles_per_section {
            return Err(anyhow!(
                "MAP section {} has {} tiles; expected {}",
                section_index,
                section.tiles.len(),
                tiles_per_section
            ));
        }
    }

    Ok(())
}

fn checked_product_to_usize(lhs: i32, rhs: i32, label: &str) -> Result<usize> {
    let value = i64::from(lhs)
        .checked_mul(i64::from(rhs))
        .ok_or_else(|| anyhow!("{label} overflows"))?;
    usize::try_from(value).map_err(|_| anyhow!("{label} is negative or too large"))
}

fn write_i32(out: &mut Vec<u8>, value: i32) {
    out.extend_from_slice(&value.to_le_bytes());
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::map::map_loader::load_map;
    use std::{env, fs, path::PathBuf};

    #[test]
    #[ignore = "requires PKO_REFERENCE_CLIENT_DIR and PKO_REFERENCE_SERVER_RESOURCE_DIR"]
    fn reference_client_maps_match_server_atr_blk_resources() {
        let client_dir = PathBuf::from(
            env::var("PKO_REFERENCE_CLIENT_DIR")
                .expect("PKO_REFERENCE_CLIENT_DIR must point to a PKO client root"),
        );
        let server_resource_dir = PathBuf::from(
            env::var("PKO_REFERENCE_SERVER_RESOURCE_DIR")
                .expect("PKO_REFERENCE_SERVER_RESOURCE_DIR must point to server/resource"),
        );

        for map_name in ["PKmap", "darkswamp"] {
            let map_path =
                find_child_case_insensitive(&client_dir.join("map"), &format!("{map_name}.map"))
                    .unwrap_or_else(|| panic!("{map_name} client .map was not found"));
            let server_map_dir = find_child_case_insensitive(&server_resource_dir, map_name)
                .unwrap_or_else(|| panic!("{map_name} server resource dir was not found"));
            let atr_path = find_child_case_insensitive(&server_map_dir, &format!("{map_name}.atr"))
                .unwrap_or_else(|| panic!("{map_name} server .atr was not found"));
            let blk_path = find_child_case_insensitive(&server_map_dir, &format!("{map_name}.blk"))
                .unwrap_or_else(|| panic!("{map_name} server .blk was not found"));

            let parsed = load_map(&fs::read(&map_path).unwrap())
                .unwrap_or_else(|err| panic!("failed to parse {map_name}: {err}"));

            assert_eq!(
                serialize_atr(&parsed).unwrap(),
                fs::read(&atr_path).unwrap(),
                "{map_name} ATR should match the deployed server resource"
            );
            assert_eq!(
                serialize_blk(&parsed).unwrap(),
                fs::read(&blk_path).unwrap(),
                "{map_name} BLK should match the deployed server resource"
            );
        }
    }

    fn find_child_case_insensitive(parent: &PathBuf, expected_name: &str) -> Option<PathBuf> {
        fs::read_dir(parent)
            .ok()?
            .filter_map(Result::ok)
            .find(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .eq_ignore_ascii_case(expected_name)
            })
            .map(|entry| entry.path())
    }
}
