use std::collections::BTreeSet;

use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};

use super::scene_obj::{ParsedObjFile, RawSceneObjectRecord, SceneObject};

const OBJ_FILE_VER600: i32 = 600;
const OBJ_HEADER_SIZE: usize = 44;
const OBJ_SECTION_INDEX_SIZE: usize = 8;
const OBJ_RECORD_SIZE: usize = 20;
const OBJ_TITLE: &[u8; 15] = b"HF Object File!";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MapPlacementPatch {
    pub index: u32,
    pub obj_type: Option<u8>,
    pub obj_id: Option<u16>,
    pub world_x: Option<f32>,
    pub world_y: Option<f32>,
    pub world_z: Option<f32>,
    pub yaw_angle: Option<i16>,
    pub scale: Option<i16>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum MapPlacementEdit {
    Update {
        index: u32,
        obj_type: Option<u8>,
        obj_id: Option<u16>,
        world_x: Option<f32>,
        world_y: Option<f32>,
        world_z: Option<f32>,
        yaw_angle: Option<i16>,
        scale: Option<i16>,
    },
    Add {
        obj_type: u8,
        obj_id: u16,
        world_x: f32,
        world_y: f32,
        world_z: f32,
        yaw_angle: i16,
        scale: i16,
    },
    Delete {
        index: u32,
    },
}

impl From<MapPlacementPatch> for MapPlacementEdit {
    fn from(patch: MapPlacementPatch) -> Self {
        Self::Update {
            index: patch.index,
            obj_type: patch.obj_type,
            obj_id: patch.obj_id,
            world_x: patch.world_x,
            world_y: patch.world_y,
            world_z: patch.world_z,
            yaw_angle: patch.yaw_angle,
            scale: patch.scale,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct MapPlacementEditExportResult {
    pub map_name: String,
    pub obj_path: String,
    pub patch_count: u32,
    pub bytes_written: u64,
}

pub fn apply_placement_patches(
    obj_file: &mut ParsedObjFile,
    patches: &[MapPlacementPatch],
) -> Result<()> {
    let edits = patches
        .iter()
        .cloned()
        .map(MapPlacementEdit::from)
        .collect::<Vec<_>>();
    apply_placement_edits(obj_file, &edits)
}

pub fn apply_placement_edits(
    obj_file: &mut ParsedObjFile,
    edits: &[MapPlacementEdit],
) -> Result<()> {
    validate_raw_record_mapping(obj_file)?;
    let original_object_count = obj_file.objects.len();
    let mut touched_source_indices = BTreeSet::new();

    for edit in edits {
        if let Some(index) = edit.source_index() {
            let index = placement_index_to_usize(index)?;
            if index >= original_object_count {
                return Err(anyhow!("Placement index {} is out of bounds", index));
            }
            if !touched_source_indices.insert(index) {
                return Err(anyhow!(
                    "Placement index {} has more than one staged edit",
                    index
                ));
            }
        }
    }

    for edit in edits {
        match *edit {
            MapPlacementEdit::Update {
                index,
                obj_type,
                obj_id,
                world_x,
                world_y,
                world_z,
                yaw_angle,
                scale,
            } => apply_placement_update(
                obj_file,
                MapPlacementPatch {
                    index,
                    obj_type,
                    obj_id,
                    world_x,
                    world_y,
                    world_z,
                    yaw_angle,
                    scale,
                },
            )?,
            MapPlacementEdit::Add {
                obj_type,
                obj_id,
                world_x,
                world_y,
                world_z,
                yaw_angle,
                scale,
            } => add_placement(
                obj_file, obj_type, obj_id, world_x, world_y, world_z, yaw_angle, scale,
            )?,
            MapPlacementEdit::Delete { .. } => {}
        }
    }

    let mut delete_indices = edits
        .iter()
        .filter_map(|edit| match edit {
            MapPlacementEdit::Delete { index } => Some(placement_index_to_usize(*index)),
            _ => None,
        })
        .collect::<Result<Vec<_>>>()?;
    delete_indices.sort_unstable_by(|left, right| right.cmp(left));
    for index in delete_indices {
        delete_placement(obj_file, index)?;
    }

    Ok(())
}

impl MapPlacementEdit {
    fn source_index(&self) -> Option<u32> {
        match self {
            MapPlacementEdit::Update { index, .. } | MapPlacementEdit::Delete { index } => {
                Some(*index)
            }
            MapPlacementEdit::Add { .. } => None,
        }
    }
}

pub fn serialize_obj(obj_file: &ParsedObjFile) -> Result<Vec<u8>> {
    let section_cnt_x = validate_positive("section_cnt_x", obj_file.section_cnt_x)?;
    let section_cnt_y = validate_positive("section_cnt_y", obj_file.section_cnt_y)?;
    let section_width = validate_positive("section_width", obj_file.section_width)?;
    let section_height = validate_positive("section_height", obj_file.section_height)?;
    let section_obj_num = validate_positive("section_obj_num", obj_file.section_obj_num)?;
    let section_count = section_cnt_x
        .checked_mul(section_cnt_y)
        .ok_or_else(|| anyhow!("OBJ section count overflow"))?;

    if !obj_file.raw_records.is_empty() {
        if obj_file.object_raw_indices.len() != obj_file.objects.len() {
            return Err(anyhow!(
                "OBJ raw record mapping does not match editable placement count"
            ));
        }
        return serialize_obj_preserving_raw_records(
            obj_file,
            section_cnt_x,
            section_cnt_y,
            section_width,
            section_height,
            section_count,
            section_obj_num,
        );
    }

    let mut sections: Vec<Vec<[u8; OBJ_RECORD_SIZE]>> = vec![Vec::new(); section_count];

    for object in &obj_file.objects {
        let (section_no, record) = encode_object_record(
            object,
            section_cnt_x,
            section_cnt_y,
            section_width,
            section_height,
        )?;
        let section = &mut sections[section_no];
        if section.len() >= section_obj_num {
            return Err(anyhow!(
                "OBJ section {} contains more than {} objects",
                section_no,
                section_obj_num
            ));
        }
        section.push(record);
    }

    write_obj_sections(obj_file, &sections, section_count, section_obj_num)
}

#[derive(Clone)]
struct SerializableObjRecord {
    raw_index: usize,
    bytes: [u8; OBJ_RECORD_SIZE],
}

fn serialize_obj_preserving_raw_records(
    obj_file: &ParsedObjFile,
    section_cnt_x: usize,
    section_cnt_y: usize,
    section_width: usize,
    section_height: usize,
    section_count: usize,
    section_obj_num: usize,
) -> Result<Vec<u8>> {
    let mut sections: Vec<Vec<SerializableObjRecord>> = vec![Vec::new(); section_count];
    for (raw_index, raw_record) in obj_file.raw_records.iter().enumerate() {
        if raw_record.section_no >= section_count {
            return Err(anyhow!(
                "OBJ raw record {} points to invalid section {}",
                raw_index,
                raw_record.section_no
            ));
        }
        sections[raw_record.section_no].push(SerializableObjRecord {
            raw_index,
            bytes: raw_record.bytes,
        });
    }

    for object_index in &obj_file.dirty_object_indices {
        let object = obj_file.objects.get(*object_index).ok_or_else(|| {
            anyhow!(
                "Dirty OBJ placement index {} is out of bounds",
                object_index
            )
        })?;
        let raw_index = *obj_file
            .object_raw_indices
            .get(*object_index)
            .ok_or_else(|| {
                anyhow!(
                    "Dirty OBJ placement index {} has no raw record mapping",
                    object_index
                )
            })?;
        let raw_record = obj_file
            .raw_records
            .get(raw_index)
            .ok_or_else(|| anyhow!("OBJ raw record index {} is out of bounds", raw_index))?;
        let (new_section_no, bytes) = encode_object_record(
            object,
            section_cnt_x,
            section_cnt_y,
            section_width,
            section_height,
        )?;
        let old_section_no = raw_record.section_no;
        let old_position = sections[old_section_no]
            .iter()
            .position(|record| record.raw_index == raw_index)
            .ok_or_else(|| {
                anyhow!(
                    "OBJ raw record {} was not found in section {}",
                    raw_index,
                    old_section_no
                )
            })?;

        if old_section_no == new_section_no {
            sections[old_section_no][old_position].bytes = bytes;
        } else {
            sections[old_section_no].remove(old_position);
            sections[new_section_no].push(SerializableObjRecord { raw_index, bytes });
        }
    }

    let sections = sections
        .into_iter()
        .map(|section| {
            section
                .into_iter()
                .map(|record| record.bytes)
                .collect::<Vec<_>>()
        })
        .collect::<Vec<_>>();

    write_obj_sections(obj_file, &sections, section_count, section_obj_num)
}

fn write_obj_sections(
    obj_file: &ParsedObjFile,
    sections: &[Vec<[u8; OBJ_RECORD_SIZE]>],
    section_count: usize,
    section_obj_num: usize,
) -> Result<Vec<u8>> {
    for (section_no, section) in sections.iter().enumerate() {
        if section.len() > section_obj_num {
            return Err(anyhow!(
                "OBJ section {} contains more than {} objects",
                section_no,
                section_obj_num
            ));
        }
    }

    let index_start = OBJ_HEADER_SIZE;
    let data_start = index_start
        .checked_add(section_count * OBJ_SECTION_INDEX_SIZE)
        .ok_or_else(|| anyhow!("OBJ index size overflow"))?;
    let non_empty_sections = sections
        .iter()
        .filter(|section| !section.is_empty())
        .count();
    let section_record_bytes = section_obj_num
        .checked_mul(OBJ_RECORD_SIZE)
        .ok_or_else(|| anyhow!("OBJ section record size overflow"))?;
    let file_size = data_start
        .checked_add(non_empty_sections * section_record_bytes)
        .ok_or_else(|| anyhow!("OBJ file size overflow"))?;
    let file_size_i32 =
        i32::try_from(file_size).map_err(|_| anyhow!("OBJ file is too large to serialize"))?;

    let mut bytes = Vec::with_capacity(file_size);
    let mut title = [0u8; 16];
    title[..OBJ_TITLE.len()].copy_from_slice(OBJ_TITLE);
    bytes.extend_from_slice(&title);
    push_i32(&mut bytes, OBJ_FILE_VER600);
    push_i32(&mut bytes, file_size_i32);
    push_i32(&mut bytes, obj_file.section_cnt_x);
    push_i32(&mut bytes, obj_file.section_cnt_y);
    push_i32(&mut bytes, obj_file.section_width);
    push_i32(&mut bytes, obj_file.section_height);
    push_i32(&mut bytes, obj_file.section_obj_num);

    let mut next_section_offset = data_start;
    for section in sections {
        if section.is_empty() {
            push_i32(&mut bytes, 0);
            push_i32(&mut bytes, 0);
        } else {
            push_i32(&mut bytes, next_section_offset as i32);
            push_i32(&mut bytes, section.len() as i32);
            next_section_offset += section_record_bytes;
        }
    }

    for section in sections {
        if section.is_empty() {
            continue;
        }

        for record in section {
            bytes.extend_from_slice(record);
        }
        for _ in section.len()..section_obj_num {
            bytes.extend_from_slice(&[0u8; OBJ_RECORD_SIZE]);
        }
    }

    Ok(bytes)
}

fn encode_object_record(
    object: &SceneObject,
    section_cnt_x: usize,
    section_cnt_y: usize,
    section_width: usize,
    section_height: usize,
) -> Result<(usize, [u8; OBJ_RECORD_SIZE])> {
    ensure_finite("world_x", object.world_x)?;
    ensure_finite("world_y", object.world_y)?;
    ensure_finite("world_z", object.world_z)?;
    if object.obj_type > 1 {
        return Err(anyhow!(
            "Unsupported OBJ placement type {}",
            object.obj_type
        ));
    }
    if object.obj_id == 0 || object.obj_id > 0x3fff {
        return Err(anyhow!("Invalid OBJ placement id {}", object.obj_id));
    }

    let abs_x_cm = rounded_cm("world_x", object.world_x)?;
    let abs_y_cm = rounded_cm("world_y", object.world_y)?;
    let height_cm = rounded_i16_cm("world_z", object.world_z)?;
    let width_cm = checked_tile_cm(section_width, "section_width")?;
    let height_section_cm = checked_tile_cm(section_height, "section_height")?;
    let map_width_cm = checked_mul_i32(section_cnt_x, width_cm, "map_width")?;
    let map_height_cm = checked_mul_i32(section_cnt_y, height_section_cm, "map_height")?;
    if !(0..map_width_cm).contains(&abs_x_cm) || !(0..map_height_cm).contains(&abs_y_cm) {
        return Err(anyhow!(
            "Placement position ({:.2}, {:.2}) is outside OBJ bounds",
            object.world_x,
            object.world_y
        ));
    }

    let section_x = (abs_x_cm / width_cm) as usize;
    let section_y = (abs_y_cm / height_section_cm) as usize;
    let section_no = section_y * section_cnt_x + section_x;
    let local_x = abs_x_cm - section_x as i32 * width_cm;
    let local_y = abs_y_cm - section_y as i32 * height_section_cm;
    let mut record = [0u8; OBJ_RECORD_SIZE];
    record[0..2].copy_from_slice(&object.raw_type_id.to_le_bytes());
    record[4..8].copy_from_slice(&local_x.to_le_bytes());
    record[8..12].copy_from_slice(&local_y.to_le_bytes());
    record[12..14].copy_from_slice(&height_cm.to_le_bytes());
    record[14..16].copy_from_slice(&object.yaw_angle.to_le_bytes());
    record[16..18].copy_from_slice(&object.scale.to_le_bytes());
    Ok((section_no, record))
}

fn apply_placement_update(obj_file: &mut ParsedObjFile, patch: MapPlacementPatch) -> Result<()> {
    let index = placement_index_to_usize(patch.index)?;
    let mut object = obj_file
        .objects
        .get(index)
        .ok_or_else(|| anyhow!("Placement index {} is out of bounds", patch.index))?
        .clone();

    if patch.obj_type.is_some() || patch.obj_id.is_some() {
        let obj_type = patch.obj_type.unwrap_or(object.obj_type);
        let obj_id = patch.obj_id.unwrap_or(object.obj_id);
        object.raw_type_id = raw_type_id_for(obj_type, obj_id)?;
        object.obj_type = obj_type;
        object.obj_id = obj_id;
    }
    if let Some(world_x) = patch.world_x {
        ensure_finite("world_x", world_x)?;
        object.world_x = world_x;
    }
    if let Some(world_y) = patch.world_y {
        ensure_finite("world_y", world_y)?;
        object.world_y = world_y;
    }
    if let Some(world_z) = patch.world_z {
        ensure_finite("world_z", world_z)?;
        object.world_z = world_z;
    }
    if let Some(yaw_angle) = patch.yaw_angle {
        object.yaw_angle = yaw_angle;
    }
    if let Some(scale) = patch.scale {
        object.scale = scale;
    }

    let encoded = if obj_file.raw_records.is_empty() {
        None
    } else {
        let raw_index = *obj_file.object_raw_indices.get(index).ok_or_else(|| {
            anyhow!(
                "Placement index {} has no raw OBJ record mapping",
                patch.index
            )
        })?;
        let (section_no, bytes) = encode_object_for_file(obj_file, &object)?;
        Some((raw_index, section_no, bytes))
    };

    obj_file.objects[index] = object;
    if let Some((raw_index, section_no, bytes)) = encoded {
        let raw_record = obj_file
            .raw_records
            .get_mut(raw_index)
            .ok_or_else(|| anyhow!("OBJ raw record index {} is out of bounds", raw_index))?;
        raw_record.section_no = section_no;
        raw_record.bytes = bytes;
    } else {
        obj_file.dirty_object_indices.insert(index);
    }

    Ok(())
}

fn add_placement(
    obj_file: &mut ParsedObjFile,
    obj_type: u8,
    obj_id: u16,
    world_x: f32,
    world_y: f32,
    world_z: f32,
    yaw_angle: i16,
    scale: i16,
) -> Result<()> {
    let raw_type_id = raw_type_id_for(obj_type, obj_id)?;
    let object = SceneObject {
        raw_type_id,
        obj_type,
        obj_id,
        world_x,
        world_y,
        world_z,
        yaw_angle,
        scale,
    };
    let encoded = if obj_file.raw_records.is_empty() {
        encode_object_for_file(obj_file, &object)?;
        None
    } else {
        let (section_no, bytes) = encode_object_for_file(obj_file, &object)?;
        Some((section_no, bytes))
    };

    obj_file.objects.push(object);
    if let Some((section_no, bytes)) = encoded {
        obj_file
            .raw_records
            .push(RawSceneObjectRecord { section_no, bytes });
        obj_file
            .object_raw_indices
            .push(obj_file.raw_records.len() - 1);
    }

    Ok(())
}

fn delete_placement(obj_file: &mut ParsedObjFile, index: usize) -> Result<()> {
    if index >= obj_file.objects.len() {
        return Err(anyhow!("Placement index {} is out of bounds", index));
    }

    obj_file.objects.remove(index);
    if !obj_file.raw_records.is_empty() {
        let raw_index = obj_file
            .object_raw_indices
            .get(index)
            .copied()
            .ok_or_else(|| anyhow!("Placement index {} has no raw OBJ record mapping", index))?;
        obj_file.object_raw_indices.remove(index);
        if raw_index >= obj_file.raw_records.len() {
            return Err(anyhow!(
                "OBJ raw record index {} is out of bounds",
                raw_index
            ));
        }
        obj_file.raw_records.remove(raw_index);
        for mapped_raw_index in &mut obj_file.object_raw_indices {
            if *mapped_raw_index > raw_index {
                *mapped_raw_index -= 1;
            }
        }
    }
    adjust_dirty_indices_after_delete(obj_file, index);

    Ok(())
}

fn encode_object_for_file(
    obj_file: &ParsedObjFile,
    object: &SceneObject,
) -> Result<(usize, [u8; OBJ_RECORD_SIZE])> {
    let (section_cnt_x, section_cnt_y, section_width, section_height) = obj_geometry(obj_file)?;
    encode_object_record(
        object,
        section_cnt_x,
        section_cnt_y,
        section_width,
        section_height,
    )
}

fn obj_geometry(obj_file: &ParsedObjFile) -> Result<(usize, usize, usize, usize)> {
    Ok((
        validate_positive("section_cnt_x", obj_file.section_cnt_x)?,
        validate_positive("section_cnt_y", obj_file.section_cnt_y)?,
        validate_positive("section_width", obj_file.section_width)?,
        validate_positive("section_height", obj_file.section_height)?,
    ))
}

fn validate_raw_record_mapping(obj_file: &ParsedObjFile) -> Result<()> {
    if obj_file.raw_records.is_empty() {
        if !obj_file.object_raw_indices.is_empty() {
            return Err(anyhow!("OBJ raw record mapping exists without raw records"));
        }
        return Ok(());
    }

    if obj_file.object_raw_indices.len() != obj_file.objects.len() {
        return Err(anyhow!(
            "OBJ raw record mapping does not match editable placement count"
        ));
    }
    for raw_index in &obj_file.object_raw_indices {
        if *raw_index >= obj_file.raw_records.len() {
            return Err(anyhow!(
                "OBJ raw record index {} is out of bounds",
                raw_index
            ));
        }
    }

    Ok(())
}

fn adjust_dirty_indices_after_delete(obj_file: &mut ParsedObjFile, deleted_index: usize) {
    let dirty_indices = std::mem::take(&mut obj_file.dirty_object_indices);
    obj_file.dirty_object_indices = dirty_indices
        .into_iter()
        .filter_map(|dirty_index| {
            if dirty_index == deleted_index {
                None
            } else if dirty_index > deleted_index {
                Some(dirty_index - 1)
            } else {
                Some(dirty_index)
            }
        })
        .collect();
}

fn raw_type_id_for(obj_type: u8, obj_id: u16) -> Result<i16> {
    if obj_type > 1 {
        return Err(anyhow!("Unsupported OBJ placement type {}", obj_type));
    }
    if obj_id == 0 || obj_id > 0x3fff {
        return Err(anyhow!("Invalid OBJ placement id {}", obj_id));
    }
    Ok((((obj_type as u16) << 14) | obj_id) as i16)
}

fn placement_index_to_usize(index: u32) -> Result<usize> {
    usize::try_from(index).map_err(|_| anyhow!("Placement index {} is too large", index))
}

fn validate_positive(name: &str, value: i32) -> Result<usize> {
    if value <= 0 {
        return Err(anyhow!("{name} must be positive"));
    }
    Ok(value as usize)
}

fn ensure_finite(name: &str, value: f32) -> Result<()> {
    if value.is_finite() {
        Ok(())
    } else {
        Err(anyhow!("{name} must be finite"))
    }
}

fn rounded_cm(name: &str, value: f32) -> Result<i32> {
    ensure_finite(name, value)?;
    let scaled = (value as f64 * 100.0).round();
    if scaled < i32::MIN as f64 || scaled > i32::MAX as f64 {
        return Err(anyhow!("{name} is outside supported OBJ coordinate range"));
    }
    Ok(scaled as i32)
}

fn rounded_i16_cm(name: &str, value: f32) -> Result<i16> {
    let scaled = rounded_cm(name, value)?;
    i16::try_from(scaled).map_err(|_| anyhow!("{name} is outside supported OBJ i16 range"))
}

fn checked_tile_cm(value: usize, name: &str) -> Result<i32> {
    let cm = value
        .checked_mul(100)
        .ok_or_else(|| anyhow!("{name} centimeter size overflow"))?;
    i32::try_from(cm).map_err(|_| anyhow!("{name} centimeter size overflow"))
}

fn checked_mul_i32(left: usize, right: i32, name: &str) -> Result<i32> {
    let left = i32::try_from(left).map_err(|_| anyhow!("{name} overflow"))?;
    left.checked_mul(right)
        .ok_or_else(|| anyhow!("{name} overflow"))
}

fn push_i32(bytes: &mut Vec<u8>, value: i32) {
    bytes.extend_from_slice(&value.to_le_bytes());
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::map::obj_loader::load_obj;
    use crate::map::scene_obj::{ParsedObjFile, RawSceneObjectRecord, SceneObject};

    fn object(index: u16, world_x: f32, world_y: f32) -> SceneObject {
        SceneObject {
            raw_type_id: index as i16,
            obj_type: 0,
            obj_id: index,
            world_x,
            world_y,
            world_z: 1.25,
            yaw_angle: 45,
            scale: 100,
        }
    }

    fn parsed(objects: Vec<SceneObject>) -> ParsedObjFile {
        ParsedObjFile {
            section_cnt_x: 2,
            section_cnt_y: 1,
            section_width: 8,
            section_height: 8,
            section_obj_num: 25,
            objects,
            raw_records: Vec::new(),
            object_raw_indices: Vec::new(),
            dirty_object_indices: Default::default(),
        }
    }

    fn raw_record(raw_type_id: i16, local_x: i32, local_y: i32, height: i16) -> [u8; 20] {
        let mut record = [0u8; 20];
        record[0..2].copy_from_slice(&raw_type_id.to_le_bytes());
        record[4..8].copy_from_slice(&local_x.to_le_bytes());
        record[8..12].copy_from_slice(&local_y.to_le_bytes());
        record[12..14].copy_from_slice(&height.to_le_bytes());
        record[14..16].copy_from_slice(&400i16.to_le_bytes());
        record[16..18].copy_from_slice(&3000i16.to_le_bytes());
        record
    }

    fn single_section_obj_bytes(records: &[[u8; 20]]) -> Vec<u8> {
        let mut bytes = Vec::new();
        let file_size = 52 + 25 * 20;
        bytes.extend_from_slice(b"HF Object File!\0");
        push_i32(&mut bytes, 600);
        push_i32(&mut bytes, file_size);
        push_i32(&mut bytes, 1);
        push_i32(&mut bytes, 1);
        push_i32(&mut bytes, 8);
        push_i32(&mut bytes, 8);
        push_i32(&mut bytes, 25);
        push_i32(&mut bytes, 52);
        push_i32(&mut bytes, records.len() as i32);
        for record in records {
            bytes.extend_from_slice(record);
        }
        for _ in records.len()..25 {
            bytes.extend_from_slice(&[0u8; 20]);
        }
        bytes
    }

    #[test]
    fn serialize_obj_writes_client_header_index_and_fixed_section_records() {
        let bytes = serialize_obj(&parsed(vec![object(7, 1.5, 2.25)])).unwrap();

        assert_eq!(&bytes[0..15], b"HF Object File!");
        assert_eq!(i32::from_le_bytes(bytes[16..20].try_into().unwrap()), 600);
        assert_eq!(
            i32::from_le_bytes(bytes[20..24].try_into().unwrap()) as usize,
            bytes.len()
        );
        assert_eq!(i32::from_le_bytes(bytes[24..28].try_into().unwrap()), 2);
        assert_eq!(i32::from_le_bytes(bytes[28..32].try_into().unwrap()), 1);
        assert_eq!(i32::from_le_bytes(bytes[40..44].try_into().unwrap()), 25);
        assert_eq!(i32::from_le_bytes(bytes[44..48].try_into().unwrap()), 60);
        assert_eq!(i32::from_le_bytes(bytes[48..52].try_into().unwrap()), 1);
        assert_eq!(i32::from_le_bytes(bytes[52..56].try_into().unwrap()), 0);
        assert_eq!(i32::from_le_bytes(bytes[56..60].try_into().unwrap()), 0);

        let record = &bytes[60..80];
        assert_eq!(i16::from_le_bytes(record[0..2].try_into().unwrap()), 7);
        assert_eq!(i32::from_le_bytes(record[4..8].try_into().unwrap()), 150);
        assert_eq!(i32::from_le_bytes(record[8..12].try_into().unwrap()), 225);
        assert_eq!(i16::from_le_bytes(record[12..14].try_into().unwrap()), 125);
        assert_eq!(i16::from_le_bytes(record[14..16].try_into().unwrap()), 45);
        assert_eq!(i16::from_le_bytes(record[16..18].try_into().unwrap()), 100);
        assert_eq!(bytes.len(), 60 + 25 * 20);
    }

    #[test]
    fn serialize_obj_round_trips_through_loader() {
        let source = parsed(vec![
            object(7, 1.5, 2.25),
            SceneObject {
                raw_type_id: 0x4008,
                obj_type: 1,
                obj_id: 8,
                world_x: 9.0,
                world_y: 3.0,
                world_z: -0.5,
                yaw_angle: -90,
                scale: 0,
            },
        ]);

        let loaded = load_obj(&serialize_obj(&source).unwrap()).unwrap();

        assert_eq!(loaded.section_obj_num, 25);
        assert_eq!(loaded.objects.len(), 2);
        assert_eq!(loaded.objects[0].obj_id, 7);
        assert!((loaded.objects[0].world_x - 1.5).abs() < 0.001);
        assert_eq!(loaded.objects[1].obj_type, 1);
        assert_eq!(loaded.objects[1].obj_id, 8);
        assert!((loaded.objects[1].world_z + 0.5).abs() < 0.001);
    }

    #[test]
    fn serialize_obj_preserves_unpatched_raw_records_from_loaded_files() {
        let valid_record = raw_record(7, 150, 225, 125);
        let invalid_record = raw_record(0, 300, 325, 25);
        let mut source = ParsedObjFile {
            section_cnt_x: 1,
            section_cnt_y: 1,
            section_width: 8,
            section_height: 8,
            section_obj_num: 25,
            objects: vec![object(7, 1.5, 2.25)],
            raw_records: vec![
                RawSceneObjectRecord {
                    section_no: 0,
                    bytes: valid_record,
                },
                RawSceneObjectRecord {
                    section_no: 0,
                    bytes: invalid_record,
                },
            ],
            object_raw_indices: vec![0],
            dirty_object_indices: Default::default(),
        };

        apply_placement_patches(
            &mut source,
            &[MapPlacementPatch {
                index: 0,
                obj_type: None,
                obj_id: None,
                world_x: Some(1.75),
                world_y: None,
                world_z: None,
                yaw_angle: None,
                scale: None,
            }],
        )
        .unwrap();

        let bytes = serialize_obj(&source).unwrap();
        let section_offset = i32::from_le_bytes(bytes[44..48].try_into().unwrap()) as usize;

        assert_eq!(i32::from_le_bytes(bytes[48..52].try_into().unwrap()), 2);
        assert_eq!(
            &bytes[section_offset + 20..section_offset + 40],
            &invalid_record
        );
    }

    #[test]
    fn load_then_serialize_obj_keeps_uneditable_raw_records() {
        let valid_record = raw_record(7, 150, 225, 125);
        let invalid_record = raw_record(0, 300, 325, 25);
        let loaded = load_obj(&single_section_obj_bytes(&[valid_record, invalid_record])).unwrap();

        assert_eq!(loaded.objects.len(), 1);
        assert_eq!(loaded.raw_records.len(), 2);

        let exported = serialize_obj(&loaded).unwrap();
        let section_offset = i32::from_le_bytes(exported[44..48].try_into().unwrap()) as usize;

        assert_eq!(i32::from_le_bytes(exported[48..52].try_into().unwrap()), 2);
        assert_eq!(
            &exported[section_offset + 20..section_offset + 40],
            &invalid_record
        );
    }

    #[test]
    fn apply_placement_patch_moves_object_between_sections() {
        let mut source = parsed(vec![object(7, 1.5, 2.25)]);

        apply_placement_patches(
            &mut source,
            &[MapPlacementPatch {
                index: 0,
                obj_type: None,
                obj_id: None,
                world_x: Some(9.25),
                world_y: Some(3.5),
                world_z: None,
                yaw_angle: Some(400),
                scale: None,
            }],
        )
        .unwrap();

        let loaded = load_obj(&serialize_obj(&source).unwrap()).unwrap();

        assert_eq!(loaded.objects.len(), 1);
        assert!((loaded.objects[0].world_x - 9.25).abs() < 0.001);
        assert!((loaded.objects[0].world_y - 3.5).abs() < 0.001);
        assert_eq!(loaded.objects[0].yaw_angle, 400);
    }

    #[test]
    fn apply_placement_update_replaces_object_type_and_id_without_moving() {
        let valid_record = raw_record(7, 150, 225, 125);
        let mut source = ParsedObjFile {
            section_cnt_x: 1,
            section_cnt_y: 1,
            section_width: 8,
            section_height: 8,
            section_obj_num: 25,
            objects: vec![object(7, 1.5, 2.25)],
            raw_records: vec![RawSceneObjectRecord {
                section_no: 0,
                bytes: valid_record,
            }],
            object_raw_indices: vec![0],
            dirty_object_indices: Default::default(),
        };

        apply_placement_edits(
            &mut source,
            &[MapPlacementEdit::Update {
                index: 0,
                obj_type: Some(1),
                obj_id: Some(8),
                world_x: None,
                world_y: None,
                world_z: None,
                yaw_angle: None,
                scale: None,
            }],
        )
        .unwrap();

        let bytes = serialize_obj(&source).unwrap();
        let section_offset = i32::from_le_bytes(bytes[44..48].try_into().unwrap()) as usize;
        let loaded = load_obj(&bytes).unwrap();

        assert_eq!(
            i16::from_le_bytes(
                bytes[section_offset..section_offset + 2]
                    .try_into()
                    .unwrap()
            ),
            0x4008
        );
        assert_eq!(loaded.objects.len(), 1);
        assert_eq!(loaded.objects[0].obj_type, 1);
        assert_eq!(loaded.objects[0].obj_id, 8);
        assert!((loaded.objects[0].world_x - 1.5).abs() < 0.001);
        assert!((loaded.objects[0].world_y - 2.25).abs() < 0.001);
        assert!((loaded.objects[0].world_z - 1.25).abs() < 0.001);
        assert_eq!(loaded.objects[0].yaw_angle, 45);
        assert_eq!(loaded.objects[0].scale, 100);
    }

    #[test]
    fn apply_placement_edits_adds_placements_to_raw_files_without_dropping_uneditable_records() {
        let valid_record = raw_record(7, 150, 225, 125);
        let invalid_record = raw_record(0, 300, 325, 25);
        let mut source = ParsedObjFile {
            section_cnt_x: 1,
            section_cnt_y: 1,
            section_width: 8,
            section_height: 8,
            section_obj_num: 25,
            objects: vec![object(7, 1.5, 2.25)],
            raw_records: vec![
                RawSceneObjectRecord {
                    section_no: 0,
                    bytes: valid_record,
                },
                RawSceneObjectRecord {
                    section_no: 0,
                    bytes: invalid_record,
                },
            ],
            object_raw_indices: vec![0],
            dirty_object_indices: Default::default(),
        };

        apply_placement_edits(
            &mut source,
            &[MapPlacementEdit::Add {
                obj_type: 1,
                obj_id: 8,
                world_x: 2.5,
                world_y: 3.25,
                world_z: -0.5,
                yaw_angle: -90,
                scale: 100,
            }],
        )
        .unwrap();

        let bytes = serialize_obj(&source).unwrap();
        let section_offset = i32::from_le_bytes(bytes[44..48].try_into().unwrap()) as usize;
        let loaded = load_obj(&bytes).unwrap();

        assert_eq!(i32::from_le_bytes(bytes[48..52].try_into().unwrap()), 3);
        assert_eq!(
            &bytes[section_offset + 20..section_offset + 40],
            &invalid_record
        );
        assert_eq!(loaded.objects.len(), 2);
        assert!(loaded
            .objects
            .iter()
            .any(|object| object.obj_type == 1 && object.obj_id == 8));
    }

    #[test]
    fn apply_placement_edits_deletes_source_indices_from_raw_files_without_index_shift_bugs() {
        let first_record = raw_record(7, 150, 225, 125);
        let invalid_record = raw_record(0, 300, 325, 25);
        let second_record = raw_record(8, 400, 500, 25);
        let third_record = raw_record(9, 600, 700, 25);
        let mut source = ParsedObjFile {
            section_cnt_x: 1,
            section_cnt_y: 1,
            section_width: 8,
            section_height: 8,
            section_obj_num: 25,
            objects: vec![
                object(7, 1.5, 2.25),
                object(8, 4.0, 5.0),
                object(9, 6.0, 7.0),
            ],
            raw_records: vec![
                RawSceneObjectRecord {
                    section_no: 0,
                    bytes: first_record,
                },
                RawSceneObjectRecord {
                    section_no: 0,
                    bytes: invalid_record,
                },
                RawSceneObjectRecord {
                    section_no: 0,
                    bytes: second_record,
                },
                RawSceneObjectRecord {
                    section_no: 0,
                    bytes: third_record,
                },
            ],
            object_raw_indices: vec![0, 2, 3],
            dirty_object_indices: Default::default(),
        };

        apply_placement_edits(
            &mut source,
            &[
                MapPlacementEdit::Delete { index: 0 },
                MapPlacementEdit::Delete { index: 2 },
            ],
        )
        .unwrap();

        let bytes = serialize_obj(&source).unwrap();
        let section_offset = i32::from_le_bytes(bytes[44..48].try_into().unwrap()) as usize;
        let loaded = load_obj(&bytes).unwrap();

        assert_eq!(i32::from_le_bytes(bytes[48..52].try_into().unwrap()), 2);
        assert_eq!(&bytes[section_offset..section_offset + 20], &invalid_record);
        assert_eq!(loaded.objects.len(), 1);
        assert_eq!(loaded.objects[0].obj_id, 8);
    }

    #[test]
    fn apply_placement_edits_mixes_update_add_delete_with_uneditable_raw_records() {
        let first_record = raw_record(7, 150, 225, 125);
        let invalid_record = raw_record(0, 300, 325, 25);
        let second_record = raw_record(8, 400, 500, 25);
        let third_record = raw_record(9, 600, 700, 25);
        let mut source = ParsedObjFile {
            section_cnt_x: 1,
            section_cnt_y: 1,
            section_width: 8,
            section_height: 8,
            section_obj_num: 25,
            objects: vec![
                object(7, 1.5, 2.25),
                object(8, 4.0, 5.0),
                object(9, 6.0, 7.0),
            ],
            raw_records: vec![
                RawSceneObjectRecord {
                    section_no: 0,
                    bytes: first_record,
                },
                RawSceneObjectRecord {
                    section_no: 0,
                    bytes: invalid_record,
                },
                RawSceneObjectRecord {
                    section_no: 0,
                    bytes: second_record,
                },
                RawSceneObjectRecord {
                    section_no: 0,
                    bytes: third_record,
                },
            ],
            object_raw_indices: vec![0, 2, 3],
            dirty_object_indices: Default::default(),
        };

        apply_placement_edits(
            &mut source,
            &[
                MapPlacementEdit::Update {
                    index: 0,
                    obj_type: None,
                    obj_id: None,
                    world_x: Some(2.0),
                    world_y: Some(2.5),
                    world_z: Some(1.5),
                    yaw_angle: Some(90),
                    scale: Some(150),
                },
                MapPlacementEdit::Add {
                    obj_type: 1,
                    obj_id: 10,
                    world_x: 3.5,
                    world_y: 3.75,
                    world_z: 0.5,
                    yaw_angle: -30,
                    scale: 120,
                },
                MapPlacementEdit::Delete { index: 2 },
            ],
        )
        .unwrap();

        let bytes = serialize_obj(&source).unwrap();
        let section_offset = i32::from_le_bytes(bytes[44..48].try_into().unwrap()) as usize;
        let loaded = load_obj(&bytes).unwrap();

        assert_eq!(source.object_raw_indices, vec![0, 2, 3]);
        assert_eq!(i32::from_le_bytes(bytes[48..52].try_into().unwrap()), 4);
        assert_eq!(
            i16::from_le_bytes(
                bytes[section_offset..section_offset + 2]
                    .try_into()
                    .unwrap()
            ),
            7
        );
        assert_eq!(
            i32::from_le_bytes(
                bytes[section_offset + 4..section_offset + 8]
                    .try_into()
                    .unwrap()
            ),
            200
        );
        assert_eq!(
            i32::from_le_bytes(
                bytes[section_offset + 8..section_offset + 12]
                    .try_into()
                    .unwrap()
            ),
            250
        );
        assert_eq!(
            i16::from_le_bytes(
                bytes[section_offset + 12..section_offset + 14]
                    .try_into()
                    .unwrap()
            ),
            150
        );
        assert_eq!(
            i16::from_le_bytes(
                bytes[section_offset + 14..section_offset + 16]
                    .try_into()
                    .unwrap()
            ),
            90
        );
        assert_eq!(
            i16::from_le_bytes(
                bytes[section_offset + 16..section_offset + 18]
                    .try_into()
                    .unwrap()
            ),
            150
        );
        assert_eq!(
            &bytes[section_offset + 20..section_offset + 40],
            &invalid_record
        );
        assert_eq!(
            i16::from_le_bytes(
                bytes[section_offset + 40..section_offset + 42]
                    .try_into()
                    .unwrap()
            ),
            8
        );
        assert_eq!(
            i16::from_le_bytes(
                bytes[section_offset + 60..section_offset + 62]
                    .try_into()
                    .unwrap()
            ),
            0x400a
        );
        assert_eq!(loaded.objects.len(), 3);
        assert!(loaded.objects.iter().any(|object| object.obj_id == 7
            && (object.world_x - 2.0).abs() < 0.001
            && object.yaw_angle == 90));
        assert!(loaded.objects.iter().any(|object| object.obj_id == 8));
        assert!(loaded
            .objects
            .iter()
            .any(|object| object.obj_type == 1 && object.obj_id == 10));
        assert!(!loaded.objects.iter().any(|object| object.obj_id == 9));
    }

    #[test]
    fn serialize_obj_rejects_overfilled_sections() {
        let objects = (0..26).map(|i| object(i + 1, 1.0, 1.0)).collect();

        let err = serialize_obj(&parsed(objects)).unwrap_err();

        assert!(err.to_string().contains("more than 25 objects"));
    }
}
