use anyhow::{anyhow, Result};
use kaitai::*;

use crate::kaitai_gen::pko_map::PkoMap;

use super::terrain::{MapHeader, MapSection, MapTile, ParsedMap};

const CUR_VERSION_NO: i32 = 780627;

/// Load a .map terrain file via the Kaitai-generated parser.
///
/// Uses Kaitai for header + section offset table, then reads the
/// 15-byte tile records at each section's absolute file offset.
pub fn load_map(data: &[u8]) -> Result<ParsedMap> {
    let reader = BytesReader::from(data.to_vec());
    let parsed = PkoMap::read_into::<_, PkoMap>(&reader, None, None)
        .map_err(|e| anyhow!("Kaitai MAP parse error: {:?}", e))?;

    let hdr = parsed.header();
    let n_map_flag = *hdr.n_map_flag();
    if n_map_flag != CUR_VERSION_NO {
        return Err(anyhow!(
            "Unsupported map version: {}. Expected {}",
            n_map_flag,
            CUR_VERSION_NO
        ));
    }

    let header = MapHeader {
        n_map_flag,
        n_width: *hdr.n_width(),
        n_height: *hdr.n_height(),
        n_section_width: *hdr.n_section_width(),
        n_section_height: *hdr.n_section_height(),
    };

    let section_cnt_x = header.n_width / header.n_section_width;
    let section_cnt_y = header.n_height / header.n_section_height;
    let section_cnt = (section_cnt_x * section_cnt_y) as usize;
    let tiles_per_section = (header.n_section_width * header.n_section_height) as usize;

    let kaitai_index = parsed.section_index();

    let mut section_offsets = Vec::with_capacity(section_cnt);
    let mut sections = Vec::with_capacity(section_cnt);

    for i in 0..section_cnt {
        let offset = *kaitai_index[i].offset();
        section_offsets.push(offset);

        if offset == 0 {
            sections.push(None);
            continue;
        }

        // Read tiles at absolute file offset (15 bytes per tile):
        // dw_tile_info:u32 bt_tile_info:u8 s_color:i16 c_height:i8 s_region:i16 bt_island:u8 bt_block:[u8;4]
        let mut pos = offset as usize;
        let mut tiles = Vec::with_capacity(tiles_per_section);

        for _ in 0..tiles_per_section {
            if pos + 15 > data.len() {
                return Err(anyhow!("MAP tile data truncated at offset {}", pos));
            }

            let dw_tile_info = u32::from_le_bytes([data[pos], data[pos + 1], data[pos + 2], data[pos + 3]]);
            let bt_tile_info = data[pos + 4];
            let s_color = i16::from_le_bytes([data[pos + 5], data[pos + 6]]);
            let c_height = data[pos + 7] as i8;
            let s_region = i16::from_le_bytes([data[pos + 8], data[pos + 9]]);
            let bt_island = data[pos + 10];
            let bt_block = [data[pos + 11], data[pos + 12], data[pos + 13], data[pos + 14]];

            tiles.push(MapTile {
                dw_tile_info,
                bt_tile_info,
                s_color,
                c_height,
                s_region,
                bt_island,
                bt_block,
            });

            pos += 15;
        }

        sections.push(Some(MapSection { tiles }));
    }

    Ok(ParsedMap {
        header,
        section_cnt_x,
        section_cnt_y,
        section_offsets,
        sections,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Regression test: parse every .map file with the Kaitai-backed loader.
    #[test]
    fn load_all_map_files() {
        let map_dir = std::path::Path::new("../top-client/map");
        if !map_dir.exists() {
            eprintln!("Skipping MAP regression test: ../top-client/map not found");
            return;
        }

        let mut map_files: Vec<_> = std::fs::read_dir(map_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.path()
                    .extension()
                    .map_or(false, |ext| ext.eq_ignore_ascii_case("map"))
            })
            .map(|e| e.path())
            .collect();
        map_files.sort();

        assert!(
            !map_files.is_empty(),
            "No .map files found in {}",
            map_dir.display()
        );

        let mut total_tiles = 0usize;
        for path in &map_files {
            let data = std::fs::read(path).unwrap();
            let parsed = load_map(&data).unwrap();

            assert!(parsed.header.n_width > 0, "{}: n_width", path.display());
            assert!(parsed.header.n_height > 0, "{}: n_height", path.display());
            assert!(parsed.section_cnt_x > 0, "{}: section_cnt_x", path.display());
            assert!(parsed.section_cnt_y > 0, "{}: section_cnt_y", path.display());

            let expected_sections = (parsed.section_cnt_x * parsed.section_cnt_y) as usize;
            assert_eq!(
                parsed.sections.len(),
                expected_sections,
                "{}: section count",
                path.display()
            );

            for section in &parsed.sections {
                if let Some(s) = section {
                    total_tiles += s.tiles.len();
                }
            }
        }

        eprintln!(
            "MAP regression: {} files, {} total tiles — all parsed OK",
            map_files.len(),
            total_tiles
        );
    }
}
