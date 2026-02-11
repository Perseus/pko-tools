use std::io::{Cursor, Read as IoRead};

use anyhow::{anyhow, Result};

// ============================================================================
// .obj scene object file format (version 600)
// ============================================================================

const OBJ_FILE_VER600: i32 = 600;

/// A scene object placed on the map.
#[derive(Debug, Clone)]
pub struct SceneObject {
    /// Raw sTypeID field.
    pub raw_type_id: i16,
    /// Object type: 0 = model, 1 = effect (top 2 bits of sTypeID)
    pub obj_type: u8,
    /// Object ID (lower 14 bits of sTypeID)
    pub obj_id: u16,
    /// Absolute world X position in world units (centimeters / 100)
    pub world_x: f32,
    /// Absolute world Y position in world units
    pub world_y: f32,
    /// Height offset (world units)
    pub world_z: f32,
    /// Yaw angle in degrees
    pub yaw_angle: i16,
    /// Scale (unused in most files)
    pub scale: i16,
}

/// Parsed .obj scene object file.
#[derive(Debug)]
pub struct ParsedObjFile {
    pub section_cnt_x: i32,
    pub section_cnt_y: i32,
    pub section_width: i32,
    pub section_height: i32,
    pub objects: Vec<SceneObject>,
}

// ============================================================================
// Byte reading helpers
// ============================================================================

fn read_i32(cursor: &mut Cursor<&[u8]>) -> Result<i32> {
    let mut buf = [0u8; 4];
    cursor.read_exact(&mut buf)?;
    Ok(i32::from_le_bytes(buf))
}

fn read_i16(cursor: &mut Cursor<&[u8]>) -> Result<i16> {
    let mut buf = [0u8; 2];
    cursor.read_exact(&mut buf)?;
    Ok(i16::from_le_bytes(buf))
}

// ============================================================================
// Parser
// ============================================================================

pub fn parse_obj_file(data: &[u8]) -> Result<ParsedObjFile> {
    let mut cursor = Cursor::new(data);

    // Read header (44 bytes)
    // title[16] + version(i32) + file_size(i32) + section_cnt_x(i32) +
    // section_cnt_y(i32) + section_width(i32) + section_height(i32) + section_obj_num(i32)
    let mut title = [0u8; 16];
    cursor.read_exact(&mut title)?;

    let version = read_i32(&mut cursor)?;
    let _file_size = read_i32(&mut cursor)?;
    let section_cnt_x = read_i32(&mut cursor)?;
    let section_cnt_y = read_i32(&mut cursor)?;
    let section_width = read_i32(&mut cursor)?;
    let section_height = read_i32(&mut cursor)?;
    let _section_obj_num = read_i32(&mut cursor)?;

    if version != OBJ_FILE_VER600 {
        return Err(anyhow!(
            "Unsupported .obj version: {}. Expected {}",
            version,
            OBJ_FILE_VER600
        ));
    }

    let section_cnt = (section_cnt_x * section_cnt_y) as usize;

    // Read section index: offset(i32) + count(i32) per section
    let mut section_offsets = Vec::with_capacity(section_cnt);
    let mut section_counts = Vec::with_capacity(section_cnt);

    for _ in 0..section_cnt {
        section_offsets.push(read_i32(&mut cursor)?);
        section_counts.push(read_i32(&mut cursor)?);
    }

    // Read objects from each section
    let mut objects = Vec::new();

    for section_no in 0..section_cnt {
        let count = section_counts[section_no];
        let offset = section_offsets[section_no];

        if count <= 0 || offset <= 0 {
            continue;
        }

        cursor.set_position(offset as u64);

        // Section coordinates in centimeters
        let section_x = (section_no as i32 % section_cnt_x) * section_width * 100;
        let section_y = (section_no as i32 / section_cnt_x) * section_height * 100;

        for _ in 0..count {
            let raw_type_id = read_i16(&mut cursor)?;
            let nx = read_i32(&mut cursor)?;
            let ny = read_i32(&mut cursor)?;
            let s_height_off = read_i16(&mut cursor)?;
            let s_yaw_angle = read_i16(&mut cursor)?;
            let s_scale = read_i16(&mut cursor)?;

            // In version 600, coordinates are section-relative.
            // The client's ReadSectionObjInfo adds section offset back:
            //   SSceneObj[i].nX += nSectionX
            //   SSceneObj[i].nY += nSectionY
            let abs_x = nx + section_x;
            let abs_y = ny + section_y;

            // Convert centimeters to world units (divide by 100)
            let world_x = abs_x as f32 / 100.0;
            let world_y = abs_y as f32 / 100.0;
            let world_z = s_height_off as f32 / 100.0;

            // Extract type and ID from sTypeID
            // Top 2 bits = type (0=model, 1=effect), lower 14 = ID
            let obj_type = ((raw_type_id as u16) >> 14) as u8;
            let obj_id = (raw_type_id as u16) & 0x3FFF;

            objects.push(SceneObject {
                raw_type_id,
                obj_type,
                obj_id,
                world_x,
                world_y,
                world_z,
                yaw_angle: s_yaw_angle,
                scale: s_scale,
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

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_real_obj_file() {
        let obj_path = std::path::Path::new("../top-client/map/garner.obj");
        if !obj_path.exists() {
            return;
        }

        let data = std::fs::read(obj_path).unwrap();
        let parsed = parse_obj_file(&data).unwrap();

        assert!(parsed.section_cnt_x > 0);
        assert!(parsed.section_cnt_y > 0);
        assert!(!parsed.objects.is_empty(), "should have scene objects");

        let model_count = parsed.objects.iter().filter(|o| o.obj_type == 0).count();
        let effect_count = parsed.objects.iter().filter(|o| o.obj_type == 1).count();

        eprintln!(
            "Obj file: sections {}x{}, {} objects ({} models, {} effects)",
            parsed.section_cnt_x,
            parsed.section_cnt_y,
            parsed.objects.len(),
            model_count,
            effect_count
        );
    }

    #[test]
    fn type_id_extraction() {
        // Model type (type=0) with ID 100
        let raw: i16 = 100;
        let obj_type = ((raw as u16) >> 14) as u8;
        let obj_id = (raw as u16) & 0x3FFF;
        assert_eq!(obj_type, 0);
        assert_eq!(obj_id, 100);

        // Effect type (type=1) with ID 50: bit 14 set → 0x4000 | 50
        let raw2: i16 = (0x4000u16 | 50) as i16;
        let obj_type2 = ((raw2 as u16) >> 14) as u8;
        let obj_id2 = (raw2 as u16) & 0x3FFF;
        assert_eq!(obj_type2, 1);
        assert_eq!(obj_id2, 50);
    }
}
