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

/// Decode section-relative centimeter coordinates to absolute tile positions.
///
/// Version 600 `.obj` files store nX/nY as centimeters relative to the section
/// origin. The original engine (SceneObjFile.cpp:ReadSectionObjInfo) converts
/// these to absolute centimeters, then CSceneObj::_UpdatePos() divides by 100
/// to get tile-space world coordinates.
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

/// Safe abs for i16 that handles i16::MIN without overflow.
fn safe_abs_i16(v: i16) -> i32 {
    (v as i32).abs()
}

fn sanitize_scale(raw_scale: i16) -> i16 {
    // Scale is usually 0 (default) or an int16 percentage.
    // Garbage values appear in some .obj files; clamp to default.
    if safe_abs_i16(raw_scale) > 2000 {
        0
    } else {
        raw_scale
    }
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

        let section_index_x = section_no as i32 % section_cnt_x;
        let section_index_y = section_no as i32 / section_cnt_x;

        for _ in 0..count {
            // SSceneObjInfo is 20 bytes with default MSVC alignment (no #pragma pack):
            //   offset 0: sTypeID (short, 2 bytes)
            //   offset 2: 2 bytes padding (for int alignment)
            //   offset 4: nX (int, 4 bytes)
            //   offset 8: nY (int, 4 bytes)
            //   offset 12: sHeightOff (short, 2 bytes)
            //   offset 14: sYawAngle (short, 2 bytes)
            //   offset 16: sScale (short, 2 bytes)
            //   offset 18: 2 bytes trailing padding (struct alignment to 4)
            let raw_type_id = read_i16(&mut cursor)?;
            let mut _pad = [0u8; 2];
            cursor.read_exact(&mut _pad)?; // alignment padding after short
            let nx = read_i32(&mut cursor)?;
            let ny = read_i32(&mut cursor)?;
            let s_height_off = read_i16(&mut cursor)?;
            let s_yaw_angle = read_i16(&mut cursor)?;
            let s_scale = read_i16(&mut cursor)?;
            cursor.read_exact(&mut _pad)?; // trailing struct padding

            // Extract type and ID from sTypeID
            // Top 2 bits = type (0=model, 1=effect), lower 14 = ID
            let obj_type = ((raw_type_id as u16) >> 14) as u8;
            let obj_id = (raw_type_id as u16) & 0x3FFF;

            // Drop invalid placeholder records early.
            if obj_id == 0 || obj_type > 1 {
                continue;
            }

            // Height offset is centimeters in original client code.
            // Reject obvious garbage rows that produce absurd vertical offsets.
            if safe_abs_i16(s_height_off) > 2000 {
                continue;
            }

            // Version 600 stores nX/nY as section-relative centimeters.
            // Original engine: SceneObjFile.cpp:ReadSectionObjInfo adds
            // sectionOrigin_cm then _UpdatePos() divides by 100 for tiles.
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

    /// Verify 20-byte struct alignment produces many more objects than 16-byte would.
    /// The xmas2 .obj file has ~3247 model placements with correct alignment.
    #[test]
    fn parse_real_obj_file_xmas2_alignment_check() {
        let obj_path = std::path::Path::new("../top-client/map/07xmas2.obj");
        if !obj_path.exists() {
            return;
        }

        let data = std::fs::read(obj_path).unwrap();
        let parsed = parse_obj_file(&data).unwrap();

        let model_count = parsed.objects.iter().filter(|o| o.obj_type == 0).count();

        eprintln!(
            "xmas2 .obj: {} total objects, {} models",
            parsed.objects.len(),
            model_count
        );

        // With correct 20-byte alignment we get ~3247 models.
        // With wrong 16-byte alignment we only got ~289.
        assert!(
            model_count > 1000,
            "Expected >1000 model placements with correct struct alignment, got {}",
            model_count
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

    #[test]
    fn decode_section_relative_cm_validates_bounds() {
        // Section (1,2), section size 8x8 tiles. Local cm=(250,375)
        let (x, y) = decode_section_relative_cm(250, 375, 1, 2, 8, 8).unwrap();
        assert!((x - 10.5).abs() < 0.001);
        assert!((y - 19.75).abs() < 0.001);

        // Out of local section cm range rejected.
        assert!(decode_section_relative_cm(1200, 10, 1, 2, 8, 8).is_none());
        assert!(decode_section_relative_cm(10, 900, 1, 2, 8, 8).is_none());
    }
}
