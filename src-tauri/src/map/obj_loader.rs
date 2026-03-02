use anyhow::{anyhow, Result};
use kaitai::*;

use crate::kaitai_gen::pko_obj::PkoObj;

use super::scene_obj::{ParsedObjFile, SceneObject};

const OBJ_FILE_VER600: i32 = 600;

/// Load a .obj scene object file via the Kaitai-generated parser.
///
/// Uses Kaitai for header + section index, then reads the 20-byte
/// SSceneObjInfo records at each section's offset.
pub fn load_obj(data: &[u8]) -> Result<ParsedObjFile> {
    let reader = BytesReader::from(data.to_vec());
    let parsed = PkoObj::read_into::<_, PkoObj>(&reader, None, None)
        .map_err(|e| anyhow!("Kaitai OBJ parse error: {:?}", e))?;

    let version = *parsed.version();
    if version != OBJ_FILE_VER600 {
        return Err(anyhow!(
            "Unsupported .obj version: {}. Expected {}",
            version,
            OBJ_FILE_VER600
        ));
    }

    let section_cnt_x = *parsed.section_cnt_x();
    let section_cnt_y = *parsed.section_cnt_y();
    let section_width = *parsed.section_width();
    let section_height = *parsed.section_height();
    let section_cnt = (section_cnt_x * section_cnt_y) as usize;

    let section_index = parsed.section_index();

    let mut objects = Vec::new();

    for section_no in 0..section_cnt {
        let entry = &section_index[section_no];
        let offset = *entry.offset();
        let count = *entry.count();

        if count <= 0 || offset <= 0 {
            continue;
        }

        let section_index_x = section_no as i32 % section_cnt_x;
        let section_index_y = section_no as i32 / section_cnt_x;

        // Read 20-byte SSceneObjInfo records at the section offset.
        // Layout per pko_obj.ksy scene_obj_info:
        //   type_id:s2 pad1:2 nx:s4 ny:s4 height_off:s2 yaw_angle:s2 scale:s2 pad2:2
        let offset_usize = offset as usize;
        let count_usize = count as usize;

        for i in 0..count_usize {
            let rec_start = offset_usize + i * 20;
            if rec_start + 20 > data.len() {
                break;
            }
            let rec = &data[rec_start..rec_start + 20];

            let raw_type_id = i16::from_le_bytes([rec[0], rec[1]]);
            // rec[2..4] is padding
            let nx = i32::from_le_bytes([rec[4], rec[5], rec[6], rec[7]]);
            let ny = i32::from_le_bytes([rec[8], rec[9], rec[10], rec[11]]);
            let s_height_off = i16::from_le_bytes([rec[12], rec[13]]);
            let s_yaw_angle = i16::from_le_bytes([rec[14], rec[15]]);
            let s_scale = i16::from_le_bytes([rec[16], rec[17]]);
            // rec[18..20] is padding

            let obj_type = ((raw_type_id as u16) >> 14) as u8;
            let obj_id = (raw_type_id as u16) & 0x3FFF;

            if obj_id == 0 || obj_type > 1 {
                continue;
            }

            if safe_abs_i16(s_height_off) > 2000 {
                continue;
            }

            let (world_x, world_y) = if let Some(p) = decode_section_relative_cm(
                nx,
                ny,
                section_index_x,
                section_index_y,
                section_width,
                section_height,
            ) {
                p
            } else {
                continue;
            };

            let world_z = s_height_off as f32 / 100.0;

            objects.push(SceneObject {
                raw_type_id,
                obj_type,
                obj_id,
                world_x,
                world_y,
                world_z,
                yaw_angle: sanitize_yaw_degrees(s_yaw_angle),
                scale: sanitize_scale(s_scale),
            });
        }
    }

    Ok(ParsedObjFile {
        section_cnt_x,
        section_cnt_y,
        section_width,
        section_height,
        objects,
    })
}

fn decode_section_relative_cm(
    nx: i32,
    ny: i32,
    section_index_x: i32,
    section_index_y: i32,
    section_width_tiles: i32,
    section_height_tiles: i32,
) -> Option<(f32, f32)> {
    let max_x_cm = section_width_tiles * 100;
    let max_y_cm = section_height_tiles * 100;
    if !(0..max_x_cm).contains(&nx) || !(0..max_y_cm).contains(&ny) {
        return None;
    }
    let section_x_cm = section_index_x * section_width_tiles * 100;
    let section_y_cm = section_index_y * section_height_tiles * 100;
    let abs_x_cm = nx + section_x_cm;
    let abs_y_cm = ny + section_y_cm;
    Some((abs_x_cm as f32 / 100.0, abs_y_cm as f32 / 100.0))
}

fn sanitize_yaw_degrees(raw_yaw: i16) -> i16 {
    let mut yaw = raw_yaw as i32;
    if yaw.abs() > 360 {
        yaw %= 360;
    }
    yaw as i16
}

fn safe_abs_i16(v: i16) -> i32 {
    (v as i32).abs()
}

fn sanitize_scale(raw_scale: i16) -> i16 {
    if safe_abs_i16(raw_scale) > 2000 {
        0
    } else {
        raw_scale
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Regression test: parse xmas2.obj and verify expected object counts.
    /// The 20-byte alignment regression guard (formerly in the native parser tests).
    #[test]
    fn load_xmas2_obj_alignment_check() {
        let obj_path = std::path::Path::new("../top-client/map/07xmas2.obj");
        if !obj_path.exists() {
            eprintln!("Skipping: ../top-client/map/07xmas2.obj not found");
            return;
        }

        let data = std::fs::read(obj_path).unwrap();
        let parsed = load_obj(&data).unwrap();

        assert!(parsed.section_cnt_x > 0);
        assert!(parsed.section_cnt_y > 0);

        let model_count = parsed.objects.iter().filter(|o| o.obj_type == 0).count();

        // With correct 20-byte alignment we get ~3247 models.
        // With wrong 16-byte alignment we only get ~289.
        assert!(
            model_count > 1000,
            "Expected >1000 model placements with correct struct alignment, got {}",
            model_count
        );
    }

    /// Parse all .obj files in the client directory to verify no crashes.
    #[test]
    fn load_all_obj_files() {
        let map_dir = std::path::Path::new("../top-client/map");
        if !map_dir.exists() {
            eprintln!("Skipping: ../top-client/map not found");
            return;
        }

        let mut obj_files: Vec<_> = std::fs::read_dir(map_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.path()
                    .extension()
                    .map_or(false, |ext| ext.eq_ignore_ascii_case("obj"))
            })
            .map(|e| e.path())
            .collect();
        obj_files.sort();

        let mut total = 0;
        for path in &obj_files {
            let data = std::fs::read(path).unwrap();
            let parsed = load_obj(&data).unwrap();
            total += parsed.objects.len();
        }

        eprintln!("Loaded {} .obj files, {} total objects", obj_files.len(), total);
    }
}
