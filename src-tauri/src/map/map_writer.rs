use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};

use super::terrain::{default_missing_tile, MapSection, MapTile, ParsedMap};

const CUR_VERSION_NO: i32 = 780627;
const MAP_HEADER_SIZE: usize = 20;
const MAP_TILE_SIZE: usize = 15;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MapTilePatch {
    pub tile_x: i32,
    pub tile_y: i32,
    pub dw_tile_info: Option<u32>,
    pub bt_tile_info: Option<u8>,
    pub s_color: Option<i16>,
    pub c_height: Option<i8>,
    pub s_region: Option<i16>,
    pub bt_island: Option<u8>,
    pub bt_block: Option<[u8; 4]>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MapTileEditExportResult {
    pub map_name: String,
    pub map_path: String,
    pub atr_path: String,
    pub blk_path: String,
    pub patch_count: u32,
    pub bytes_written: u64,
    pub atr_bytes_written: u64,
    pub blk_bytes_written: u64,
    pub atr_sha256: String,
    pub blk_sha256: String,
}

pub fn serialize_map(_map: &ParsedMap) -> Result<Vec<u8>> {
    let map = _map;
    let section_count = expected_section_count(map)?;
    let tiles_per_section = expected_tiles_per_section(map)?;
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

    let index_size = section_count
        .checked_mul(4)
        .ok_or_else(|| anyhow!("MAP section offset table is too large"))?;
    let data_start = MAP_HEADER_SIZE
        .checked_add(index_size)
        .ok_or_else(|| anyhow!("MAP header is too large"))?;
    let mut out = Vec::with_capacity(data_start);

    write_i32(&mut out, map.header.n_map_flag);
    write_i32(&mut out, map.header.n_width);
    write_i32(&mut out, map.header.n_height);
    write_i32(&mut out, map.header.n_section_width);
    write_i32(&mut out, map.header.n_section_height);
    out.resize(data_start, 0);

    let mut offsets = vec![0u32; section_count];
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

        let offset = u32::try_from(out.len())
            .map_err(|_| anyhow!("MAP output exceeds u32 section offset range"))?;
        offsets[section_index] = offset;
        for tile in &section.tiles {
            write_tile(&mut out, tile);
        }
    }

    for (index, offset) in offsets.iter().enumerate() {
        let start = MAP_HEADER_SIZE + index * 4;
        out[start..start + 4].copy_from_slice(&offset.to_le_bytes());
    }

    Ok(out)
}

pub fn apply_tile_patch(map: &mut ParsedMap, patch: &MapTilePatch) -> Result<()> {
    expected_section_count(map)?;
    let tiles_per_section = expected_tiles_per_section(map)?;
    validate_tile_coordinates(map, patch.tile_x, patch.tile_y)?;

    let section_x = patch.tile_x / map.header.n_section_width;
    let section_y = patch.tile_y / map.header.n_section_height;
    let section_index = (section_y * map.section_cnt_x + section_x) as usize;
    let local_x = (patch.tile_x % map.header.n_section_width) as usize;
    let local_y = (patch.tile_y % map.header.n_section_height) as usize;
    let tile_index = local_y * map.header.n_section_width as usize + local_x;

    let section_slot = map
        .sections
        .get_mut(section_index)
        .ok_or_else(|| anyhow!("Tile patch references invalid section {}", section_index))?;
    if section_slot.is_none() {
        section_slot.replace(MapSection {
            tiles: vec![default_missing_tile(); tiles_per_section],
        });
    }
    let section = section_slot
        .as_mut()
        .ok_or_else(|| anyhow!("Cannot materialize section {}", section_index))?;
    if section.tiles.len() != tiles_per_section {
        return Err(anyhow!(
            "MAP section {} has {} tiles; expected {}",
            section_index,
            section.tiles.len(),
            tiles_per_section
        ));
    }

    let tile = section
        .tiles
        .get_mut(tile_index)
        .ok_or_else(|| anyhow!("Tile patch references invalid tile index {}", tile_index))?;
    if let Some(value) = patch.dw_tile_info {
        tile.dw_tile_info = value;
    }
    if let Some(value) = patch.bt_tile_info {
        tile.bt_tile_info = value;
    }
    if let Some(value) = patch.s_color {
        tile.s_color = value;
    }
    if let Some(value) = patch.c_height {
        tile.c_height = value;
    }
    if let Some(value) = patch.s_region {
        tile.s_region = value;
    }
    if let Some(value) = patch.bt_island {
        tile.bt_island = value;
    }
    if let Some(value) = patch.bt_block {
        tile.bt_block = value;
    }

    Ok(())
}

pub fn apply_tile_patches(map: &mut ParsedMap, patches: &[MapTilePatch]) -> Result<()> {
    for patch in patches {
        apply_tile_patch(map, patch)?;
    }
    Ok(())
}

fn expected_section_count(map: &ParsedMap) -> Result<usize> {
    if map.header.n_map_flag != CUR_VERSION_NO {
        return Err(anyhow!(
            "Unsupported map version: {}. Expected {}",
            map.header.n_map_flag,
            CUR_VERSION_NO
        ));
    }
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

    checked_i32_product_to_usize(section_cnt_x, section_cnt_y, "MAP section count")
}

fn expected_tiles_per_section(map: &ParsedMap) -> Result<usize> {
    checked_i32_product_to_usize(
        map.header.n_section_width,
        map.header.n_section_height,
        "MAP tiles per section",
    )
}

fn validate_tile_coordinates(map: &ParsedMap, tile_x: i32, tile_y: i32) -> Result<()> {
    if tile_x < 0 || tile_y < 0 || tile_x >= map.header.n_width || tile_y >= map.header.n_height {
        return Err(anyhow!(
            "Tile coordinates ({}, {}) are outside map bounds {}x{}",
            tile_x,
            tile_y,
            map.header.n_width,
            map.header.n_height
        ));
    }

    Ok(())
}

fn checked_i32_product_to_usize(lhs: i32, rhs: i32, label: &str) -> Result<usize> {
    let value = i64::from(lhs)
        .checked_mul(i64::from(rhs))
        .ok_or_else(|| anyhow!("{label} overflows"))?;
    usize::try_from(value).map_err(|_| anyhow!("{label} is negative or too large"))
}

fn write_tile(out: &mut Vec<u8>, tile: &MapTile) {
    out.reserve(MAP_TILE_SIZE);
    out.extend_from_slice(&tile.dw_tile_info.to_le_bytes());
    out.push(tile.bt_tile_info);
    out.extend_from_slice(&tile.s_color.to_le_bytes());
    out.push(tile.c_height as u8);
    out.extend_from_slice(&tile.s_region.to_le_bytes());
    out.push(tile.bt_island);
    out.extend_from_slice(&tile.bt_block);
}

fn write_i32(out: &mut Vec<u8>, value: i32) {
    out.extend_from_slice(&value.to_le_bytes());
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::map::map_loader::load_map;
    use crate::map::server_writer::{serialize_atr, serialize_blk};
    use crate::map::terrain::{MapHeader, MapSection, MapTile, ParsedMap};

    const CUR_VERSION_NO: i32 = 780627;

    #[test]
    fn serialize_map_writes_header_offsets_and_tiles_in_client_order() {
        let map = ParsedMap {
            header: MapHeader {
                n_map_flag: CUR_VERSION_NO,
                n_width: 4,
                n_height: 2,
                n_section_width: 2,
                n_section_height: 2,
            },
            section_cnt_x: 2,
            section_cnt_y: 1,
            section_offsets: vec![999, 888],
            sections: vec![
                Some(MapSection {
                    tiles: section_tiles(10),
                }),
                None,
            ],
        };

        let bytes = serialize_map(&map).unwrap();

        assert_eq!(read_i32(&bytes, 0), CUR_VERSION_NO);
        assert_eq!(read_i32(&bytes, 4), 4);
        assert_eq!(read_i32(&bytes, 8), 2);
        assert_eq!(read_i32(&bytes, 12), 2);
        assert_eq!(read_i32(&bytes, 16), 2);
        assert_eq!(read_u32(&bytes, 20), 28);
        assert_eq!(read_u32(&bytes, 24), 0);
        assert_eq!(bytes.len(), 28 + 4 * 15);

        let first_tile = &bytes[28..43];
        assert_eq!(&first_tile[0..4], &0x1234_000au32.to_le_bytes());
        assert_eq!(first_tile[4], 10);
        assert_eq!(&first_tile[5..7], &(0x010ai16).to_le_bytes());
        assert_eq!(first_tile[7] as i8, -5);
        assert_eq!(&first_tile[8..10], &(0x0010i16).to_le_bytes());
        assert_eq!(first_tile[10], 2);
        assert_eq!(&first_tile[11..15], &[0x80, 1, 2, 3]);
    }

    #[test]
    fn serialize_map_round_trips_through_loader_with_empty_sections() {
        let map = ParsedMap {
            header: MapHeader {
                n_map_flag: CUR_VERSION_NO,
                n_width: 4,
                n_height: 4,
                n_section_width: 2,
                n_section_height: 2,
            },
            section_cnt_x: 2,
            section_cnt_y: 2,
            section_offsets: vec![1, 2, 3, 4],
            sections: vec![
                Some(MapSection {
                    tiles: section_tiles(1),
                }),
                None,
                Some(MapSection {
                    tiles: section_tiles(20),
                }),
                None,
            ],
        };

        let bytes = serialize_map(&map).unwrap();
        let round_trip = load_map(&bytes).unwrap();

        assert_eq!(round_trip.header.n_width, 4);
        assert_eq!(round_trip.header.n_height, 4);
        assert_eq!(round_trip.section_offsets, vec![36, 0, 96, 0]);
        assert!(round_trip.sections[1].is_none());
        assert!(round_trip.sections[3].is_none());
        assert_tile_eq(
            &round_trip.sections[0].as_ref().unwrap().tiles[2],
            &map.sections[0].as_ref().unwrap().tiles[2],
        );
        assert_tile_eq(
            &round_trip.sections[2].as_ref().unwrap().tiles[3],
            &map.sections[2].as_ref().unwrap().tiles[3],
        );
    }

    #[test]
    fn apply_tile_patch_updates_only_requested_native_fields() {
        let mut map = ParsedMap {
            header: MapHeader {
                n_map_flag: CUR_VERSION_NO,
                n_width: 2,
                n_height: 2,
                n_section_width: 2,
                n_section_height: 2,
            },
            section_cnt_x: 1,
            section_cnt_y: 1,
            section_offsets: vec![20],
            sections: vec![Some(MapSection {
                tiles: section_tiles(30),
            })],
        };
        let before = map.sections[0].as_ref().unwrap().tiles[3].clone();

        apply_tile_patch(
            &mut map,
            &MapTilePatch {
                tile_x: 1,
                tile_y: 1,
                dw_tile_info: None,
                bt_tile_info: Some(44),
                s_color: None,
                c_height: Some(12),
                s_region: Some(0x0040),
                bt_island: None,
                bt_block: Some([0, 0x80, 7, 8]),
            },
        )
        .unwrap();

        let patched = &map.sections[0].as_ref().unwrap().tiles[3];
        assert_eq!(patched.dw_tile_info, before.dw_tile_info);
        assert_eq!(patched.bt_tile_info, 44);
        assert_eq!(patched.s_color, before.s_color);
        assert_eq!(patched.c_height, 12);
        assert_eq!(patched.s_region, 0x0040);
        assert_eq!(patched.bt_island, before.bt_island);
        assert_eq!(patched.bt_block, [0, 0x80, 7, 8]);

        let round_trip = load_map(&serialize_map(&map).unwrap()).unwrap();
        assert_tile_eq(&round_trip.sections[0].as_ref().unwrap().tiles[3], patched);
    }

    #[test]
    fn apply_tile_patch_materializes_empty_sections_with_underwater_defaults() {
        let mut map = ParsedMap {
            header: MapHeader {
                n_map_flag: CUR_VERSION_NO,
                n_width: 2,
                n_height: 2,
                n_section_width: 2,
                n_section_height: 2,
            },
            section_cnt_x: 1,
            section_cnt_y: 1,
            section_offsets: vec![0],
            sections: vec![None],
        };

        apply_tile_patch(
            &mut map,
            &MapTilePatch {
                tile_x: 0,
                tile_y: 0,
                dw_tile_info: None,
                bt_tile_info: None,
                s_color: None,
                c_height: Some(1),
                s_region: None,
                bt_island: None,
                bt_block: None,
            },
        )
        .unwrap();

        let section = map.sections[0]
            .as_ref()
            .expect("section should be materialized");
        assert_eq!(section.tiles.len(), 4);
        let mut patched_default = default_missing_tile();
        patched_default.c_height = 1;
        assert_tile_eq(&section.tiles[0], &patched_default);

        let default_tile = default_missing_tile();
        for tile in section.tiles.iter().skip(1) {
            assert_tile_eq(tile, &default_tile);
        }

        let round_trip = load_map(&serialize_map(&map).unwrap()).unwrap();
        let round_trip_section = round_trip.sections[0]
            .as_ref()
            .expect("round-tripped section should remain materialized");
        assert_tile_eq(&round_trip_section.tiles[0], &patched_default);
        for tile in round_trip_section.tiles.iter().skip(1) {
            assert_tile_eq(tile, &default_tile);
        }
    }

    #[test]
    fn apply_tile_patch_rejects_invalid_section_dimensions_without_panicking() {
        let mut map = ParsedMap {
            header: MapHeader {
                n_map_flag: CUR_VERSION_NO,
                n_width: 2,
                n_height: 2,
                n_section_width: 0,
                n_section_height: 2,
            },
            section_cnt_x: 1,
            section_cnt_y: 1,
            section_offsets: vec![20],
            sections: vec![Some(MapSection {
                tiles: section_tiles(1),
            })],
        };

        let err = apply_tile_patch(
            &mut map,
            &MapTilePatch {
                tile_x: 0,
                tile_y: 0,
                dw_tile_info: None,
                bt_tile_info: None,
                s_color: None,
                c_height: Some(1),
                s_region: None,
                bt_island: None,
                bt_block: None,
            },
        )
        .unwrap_err();

        assert!(err.to_string().contains("must be positive"));
    }

    #[test]
    fn serialize_atr_writes_region_and_island_in_row_major_order() {
        let map = ParsedMap {
            header: MapHeader {
                n_map_flag: CUR_VERSION_NO,
                n_width: 2,
                n_height: 2,
                n_section_width: 2,
                n_section_height: 2,
            },
            section_cnt_x: 1,
            section_cnt_y: 1,
            section_offsets: vec![20],
            sections: vec![Some(MapSection {
                tiles: vec![
                    tile_with_server_fields(0x0001, 2, [0; 4]),
                    tile_with_server_fields(0x0042, 3, [0; 4]),
                    tile_with_server_fields(-1, 4, [0; 4]),
                    tile_with_server_fields(0x0008, 5, [0; 4]),
                ],
            })],
        };

        let bytes = serialize_atr(&map).unwrap();

        assert_eq!(read_i32(&bytes, 0), 2);
        assert_eq!(read_i32(&bytes, 4), 2);
        assert_eq!(&bytes[8..11], &[0x01, 0x00, 2]);
        assert_eq!(&bytes[11..14], &[0x42, 0x00, 3]);
        assert_eq!(&bytes[14..17], &[0xff, 0xff, 4]);
        assert_eq!(&bytes[17..20], &[0x08, 0x00, 5]);
    }

    #[test]
    fn serialize_blk_writes_blocked_subtiles_msb_first() {
        let map = ParsedMap {
            header: MapHeader {
                n_map_flag: CUR_VERSION_NO,
                n_width: 4,
                n_height: 1,
                n_section_width: 4,
                n_section_height: 1,
            },
            section_cnt_x: 1,
            section_cnt_y: 1,
            section_offsets: vec![20],
            sections: vec![Some(MapSection {
                tiles: vec![
                    tile_with_server_fields(0, 0, [0x80, 0x00, 0x00, 0x80]),
                    tile_with_server_fields(0, 0, [0x80, 0x00, 0x00, 0x80]),
                    tile_with_server_fields(0, 0, [0x80, 0x00, 0x00, 0x80]),
                    tile_with_server_fields(0, 0, [0x80, 0x00, 0x00, 0x80]),
                ],
            })],
        };

        let bytes = serialize_blk(&map).unwrap();

        assert_eq!(read_i32(&bytes, 0), 8);
        assert_eq!(read_i32(&bytes, 4), 2);
        assert_eq!(&bytes[8..10], &[0b1010_1010, 0b0101_0101]);
    }

    #[test]
    fn serialize_blk_rejects_rows_that_are_not_byte_aligned() {
        let map = ParsedMap {
            header: MapHeader {
                n_map_flag: CUR_VERSION_NO,
                n_width: 2,
                n_height: 1,
                n_section_width: 2,
                n_section_height: 1,
            },
            section_cnt_x: 1,
            section_cnt_y: 1,
            section_offsets: vec![20],
            sections: vec![Some(MapSection {
                tiles: vec![
                    tile_with_server_fields(0, 0, [0; 4]),
                    tile_with_server_fields(0, 0, [0; 4]),
                ],
            })],
        };

        let error = serialize_blk(&map).unwrap_err().to_string();
        assert!(error.contains("not byte-aligned"));
    }

    fn section_tiles(seed: u8) -> Vec<MapTile> {
        (0..4)
            .map(|idx| MapTile {
                dw_tile_info: 0x1234_0000 | seed as u32 | ((idx as u32) << 8),
                bt_tile_info: seed + idx,
                s_color: 0x0100 + seed as i16 + idx as i16,
                c_height: -5 + idx as i8,
                s_region: 0x0010 + idx as i16,
                bt_island: 2 + idx as u8,
                bt_block: [
                    0x80 | idx as u8,
                    1 + idx as u8,
                    2 + idx as u8,
                    3 + idx as u8,
                ],
            })
            .collect()
    }

    fn tile_with_server_fields(s_region: i16, bt_island: u8, bt_block: [u8; 4]) -> MapTile {
        MapTile {
            dw_tile_info: 0,
            bt_tile_info: 0,
            s_color: -1,
            c_height: 0,
            s_region,
            bt_island,
            bt_block,
        }
    }

    fn assert_tile_eq(actual: &MapTile, expected: &MapTile) {
        assert_eq!(actual.dw_tile_info, expected.dw_tile_info);
        assert_eq!(actual.bt_tile_info, expected.bt_tile_info);
        assert_eq!(actual.s_color, expected.s_color);
        assert_eq!(actual.c_height, expected.c_height);
        assert_eq!(actual.s_region, expected.s_region);
        assert_eq!(actual.bt_island, expected.bt_island);
        assert_eq!(actual.bt_block, expected.bt_block);
    }

    fn read_i32(bytes: &[u8], offset: usize) -> i32 {
        i32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap())
    }

    fn read_u32(bytes: &[u8], offset: usize) -> u32 {
        u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap())
    }
}
