use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use binrw::BinWrite;
use serde::{Deserialize, Serialize};

use crate::character::helper::{
    HelperData, HelperDummyInfo, HELPER_TYPE_BSPHERE, HELPER_TYPE_DUMMY,
};
use crate::character::mesh::CharacterMeshSubsetInfo;
use crate::character::model::CharacterGeometricModel;
use crate::character::texture::CharMaterialTextureInfo;
use crate::math::LwMatrix44;

fn now_iso() -> String {
    let duration = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    let secs = duration.as_secs();
    // Simple ISO-ish timestamp without chrono dependency
    format!("{}", secs)
}

/// Add a glow overlay to an LGO file by cloning subset 0 and inserting it at
/// position 1 (the PKO overlay slot). Also clones material 0 and inserts it at
/// position 1 so material indices stay aligned.
///
/// Works regardless of how many subsets already exist — external models may have
/// multiple subsets from multiple materials/primitives. The caller (UI) is
/// responsible for not calling this twice (tracked via `hasGlowOverlay` state).
pub fn add_glow_overlay(lgo_path: &Path) -> anyhow::Result<()> {
    let mut geom = CharacterGeometricModel::from_file(lgo_path.to_path_buf())?;

    let mesh_info = geom
        .mesh_info
        .as_mut()
        .ok_or_else(|| anyhow::anyhow!("LGO has no mesh data"))?;

    if mesh_info.subset_seq.is_empty() {
        return Err(anyhow::anyhow!("LGO has no subsets"));
    }

    // Clone subset 0 and insert at position 1 (the PKO glow overlay slot)
    let overlay_subset = mesh_info.subset_seq[0].clone();
    mesh_info.subset_seq.insert(1, overlay_subset);
    mesh_info.header.subset_num = mesh_info.subset_seq.len() as u32;

    // Clone material 0 and insert at position 1 (materials are positional: subset N → material N)
    if let Some(ref mut materials) = geom.material_seq {
        if !materials.is_empty() {
            let overlay_material = materials[0].clone();
            materials.insert(1, overlay_material);
            geom.material_num = materials.len() as u32;

            // Recompute mtl_size
            let mut size = std::mem::size_of::<u32>(); // material_num field
            for mat in materials.iter() {
                size += std::mem::size_of_val(&mat.opacity);
                size += std::mem::size_of_val(&mat.transp_type);
                size += std::mem::size_of_val(&mat.material);
                size += std::mem::size_of_val(&mat.rs_set);
                size += std::mem::size_of_val(&mat.tex_seq);
            }
            geom.header.mtl_size = size as u32;
        }
    }

    // Recompute mesh_size (subset count changed)
    recompute_mesh_size(&mut geom);

    // Write back
    let file = std::fs::File::create(lgo_path)?;
    let mut writer = BufWriter::new(file);
    geom.write_le(&mut writer)?;
    writer.flush()?;

    Ok(())
}

fn apply_dummies_to_lgo(lgo_path: &Path, dummies: Vec<WorkbenchDummy>) -> anyhow::Result<()> {
    let mut geom = CharacterGeometricModel::from_file(lgo_path.to_path_buf())?;

    // Build HelperDummyInfo from WorkbenchDummy positions
    let dummy_infos: Vec<HelperDummyInfo> = dummies
        .iter()
        .map(|d| {
            let mat = LwMatrix44::from_translation(cgmath::Vector3::new(
                d.position[0],
                d.position[1],
                d.position[2],
            ));
            HelperDummyInfo {
                id: d.id,
                mat: mat.clone(),
                mat_local: mat,
                parent_type: 0,
                parent_id: 0xFFFFFFFF,
            }
        })
        .collect();

    let dummy_count = dummy_infos.len() as u32;

    if let Some(ref mut helper_data) = geom.helper_data {
        helper_data.dummy_seq = dummy_infos;
        helper_data.dummy_num = dummy_count;
        if dummy_count > 0 {
            helper_data._type |= HELPER_TYPE_DUMMY;
        } else {
            helper_data._type &= !HELPER_TYPE_DUMMY;
        }
    } else {
        let mut _type = 0u32;
        if dummy_count > 0 {
            _type |= HELPER_TYPE_DUMMY;
        }
        geom.helper_data = Some(HelperData {
            _type,
            dummy_num: dummy_count,
            dummy_seq: dummy_infos,
            box_num: 0,
            box_seq: vec![],
            mesh_num: 0,
            mesh_seq: vec![],
            bbox_num: 0,
            bbox_seq: vec![],
            bsphere_num: 0,
            bsphere_seq: vec![],
        });
    }

    // Recompute helper_size
    recompute_helper_size(&mut geom);

    // Write back
    let file = std::fs::File::create(lgo_path)?;
    let mut writer = BufWriter::new(file);
    geom.write_le(&mut writer)?;
    writer.flush()?;

    Ok(())
}

/// Rotate all vertex positions and normals in an LGO file by the given angles (in degrees).
/// Also rotates dummy matrices so they stay aligned with the mesh.
/// Returns regenerated glTF JSON for the viewer.
pub fn rotate_lgo(lgo_path: &Path, x_deg: f32, y_deg: f32, z_deg: f32) -> anyhow::Result<String> {
    use cgmath::{Deg, Matrix3, Rad};

    // Build rotation matrix (apply in order: X, then Y, then Z)
    let rx = Matrix3::from_angle_x(Rad::from(Deg(x_deg)));
    let ry = Matrix3::from_angle_y(Rad::from(Deg(y_deg)));
    let rz = Matrix3::from_angle_z(Rad::from(Deg(z_deg)));
    let rot = rz * ry * rx;

    // Check if rotation is identity (no-op)
    let is_identity = (x_deg.abs() < 0.001) && (y_deg.abs() < 0.001) && (z_deg.abs() < 0.001);
    if is_identity {
        let texture_search_dir = lgo_path
            .parent()
            .and_then(|p| p.parent())
            .unwrap_or(lgo_path);
        return super::model::build_gltf_from_lgo(lgo_path, texture_search_dir);
    }

    let mut geom = CharacterGeometricModel::from_file(lgo_path.to_path_buf())?;

    // Rotate vertex positions and normals
    if let Some(ref mut mesh_info) = geom.mesh_info {
        for v in &mut mesh_info.vertex_seq {
            let rotated = rot * cgmath::Vector3::new(v.0.x, v.0.y, v.0.z);
            v.0.x = rotated.x;
            v.0.y = rotated.y;
            v.0.z = rotated.z;
        }
        for n in &mut mesh_info.normal_seq {
            let rotated = rot * cgmath::Vector3::new(n.0.x, n.0.y, n.0.z);
            n.0.x = rotated.x;
            n.0.y = rotated.y;
            n.0.z = rotated.z;
        }
    }

    // Rotate dummy positions (translation component of their matrices)
    if let Some(ref mut helper_data) = geom.helper_data {
        for dummy in &mut helper_data.dummy_seq {
            // Rotate the translation (row 3 / w row)
            let pos = cgmath::Vector3::new(dummy.mat.0.w.x, dummy.mat.0.w.y, dummy.mat.0.w.z);
            let rotated = rot * pos;
            dummy.mat.0.w.x = rotated.x;
            dummy.mat.0.w.y = rotated.y;
            dummy.mat.0.w.z = rotated.z;

            let pos_local = cgmath::Vector3::new(
                dummy.mat_local.0.w.x,
                dummy.mat_local.0.w.y,
                dummy.mat_local.0.w.z,
            );
            let rotated_local = rot * pos_local;
            dummy.mat_local.0.w.x = rotated_local.x;
            dummy.mat_local.0.w.y = rotated_local.y;
            dummy.mat_local.0.w.z = rotated_local.z;
        }
        // Rotate bounding sphere centers
        for bs in &mut helper_data.bsphere_seq {
            let pos = cgmath::Vector3::new(bs.mat.0.w.x, bs.mat.0.w.y, bs.mat.0.w.z);
            let rotated = rot * pos;
            bs.mat.0.w.x = rotated.x;
            bs.mat.0.w.y = rotated.y;
            bs.mat.0.w.z = rotated.z;

            let c = cgmath::Vector3::new(bs.sphere.c.0.x, bs.sphere.c.0.y, bs.sphere.c.0.z);
            let rotated_c = rot * c;
            bs.sphere.c.0.x = rotated_c.x;
            bs.sphere.c.0.y = rotated_c.y;
            bs.sphere.c.0.z = rotated_c.z;
        }
    }

    // Write back
    let file = std::fs::File::create(lgo_path)?;
    let mut writer = BufWriter::new(file);
    geom.write_le(&mut writer)?;
    writer.flush()?;

    // Regenerate glTF preview
    let texture_search_dir = lgo_path
        .parent()
        .and_then(|p| p.parent())
        .unwrap_or(lgo_path);

    super::model::build_gltf_from_lgo(lgo_path, texture_search_dir)
}

/// Result of exporting a workbench item with a target model ID.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub lgo_path: String,
    pub texture_paths: Vec<String>,
    pub target_model_id: String,
}

/// Export a workbench item (LGO + textures) to the exports folder with a target model ID.
/// This copies the LGO file, renames the internal texture references, and copies textures
/// with the new model ID naming convention.
pub fn export_item(
    project_dir: &Path,
    source_lgo_path: &Path,
    target_model_id: &str,
) -> anyhow::Result<ExportResult> {
    // Read the source LGO
    let mut geom = CharacterGeometricModel::from_file(source_lgo_path.to_path_buf())?;

    // Collect original texture names from materials
    let mut original_textures: Vec<String> = vec![];
    if let Some(ref materials) = geom.material_seq {
        for mat in materials {
            for tex in &mat.tex_seq {
                let name = String::from_utf8_lossy(&tex.file_name)
                    .trim_matches('\0')
                    .to_string();
                if !name.is_empty() && !original_textures.contains(&name) {
                    original_textures.push(name);
                }
            }
        }
    }

    // Create new texture names based on target model ID
    let new_texture_names: Vec<String> = original_textures
        .iter()
        .enumerate()
        .map(|(i, _)| {
            if original_textures.len() == 1 {
                format!("{}.bmp", target_model_id)
            } else {
                format!("{}_{}.bmp", target_model_id, i)
            }
        })
        .collect();

    // Update texture references in the LGO materials
    if let Some(ref mut materials) = geom.material_seq {
        for mat in materials.iter_mut() {
            for tex in &mut mat.tex_seq {
                let old_name = String::from_utf8_lossy(&tex.file_name)
                    .trim_matches('\0')
                    .to_string();
                if let Some(idx) = original_textures.iter().position(|n| n == &old_name) {
                    // Create a new fixed-size filename array
                    let new_name = &new_texture_names[idx];
                    let mut new_file_name = [0u8; 64];
                    let bytes = new_name.as_bytes();
                    let len = bytes.len().min(63);
                    new_file_name[..len].copy_from_slice(&bytes[..len]);
                    tex.file_name = new_file_name;
                }
            }
        }
    }

    // Create export directories
    let export_dir = project_dir.join("pko-tools/exports/item");
    let model_dir = export_dir.join("model");
    let texture_dir = export_dir.join("texture");
    std::fs::create_dir_all(&model_dir)?;
    std::fs::create_dir_all(&texture_dir)?;

    // Write the modified LGO
    let lgo_output_path = model_dir.join(format!("{}.lgo", target_model_id));
    let file = std::fs::File::create(&lgo_output_path)?;
    let mut writer = BufWriter::new(file);
    geom.write_le(&mut writer)?;
    writer.flush()?;

    // Copy textures with new names
    let source_texture_dir = source_lgo_path
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.join("texture"))
        .unwrap_or_else(|| {
            source_lgo_path
                .parent()
                .unwrap_or(Path::new("."))
                .to_path_buf()
        });

    let mut texture_paths: Vec<String> = vec![];
    for (i, orig_name) in original_textures.iter().enumerate() {
        let src_texture = source_texture_dir.join(orig_name);
        if src_texture.exists() {
            let dst_texture = texture_dir.join(&new_texture_names[i]);
            std::fs::copy(&src_texture, &dst_texture)?;
            texture_paths.push(dst_texture.to_string_lossy().to_string());
        }
    }

    Ok(ExportResult {
        lgo_path: lgo_output_path.to_string_lossy().to_string(),
        texture_paths,
        target_model_id: target_model_id.to_string(),
    })
}

/// Rescale all vertex positions in an LGO file by a multiplicative factor.
/// Also rescales dummy translation matrices so they stay aligned with the mesh.
/// Returns regenerated glTF JSON for the viewer.
pub fn rescale_lgo(lgo_path: &Path, factor: f32) -> anyhow::Result<String> {
    if factor <= 0.0 {
        return Err(anyhow::anyhow!("Scale factor must be positive"));
    }
    if (factor - 1.0).abs() < f32::EPSILON {
        // No-op: just return current preview
        let texture_search_dir = lgo_path
            .parent()
            .and_then(|p| p.parent())
            .unwrap_or(lgo_path);
        return super::model::build_gltf_from_lgo(lgo_path, texture_search_dir);
    }

    let mut geom = CharacterGeometricModel::from_file(lgo_path.to_path_buf())?;

    // Scale vertex positions
    if let Some(ref mut mesh_info) = geom.mesh_info {
        for v in &mut mesh_info.vertex_seq {
            v.0.x *= factor;
            v.0.y *= factor;
            v.0.z *= factor;
        }
    }

    // Scale dummy translation matrices
    if let Some(ref mut helper_data) = geom.helper_data {
        for dummy in &mut helper_data.dummy_seq {
            // Translation is in row 3 (w row) of the 4x4 matrix
            dummy.mat.0.w.x *= factor;
            dummy.mat.0.w.y *= factor;
            dummy.mat.0.w.z *= factor;
            dummy.mat_local.0.w.x *= factor;
            dummy.mat_local.0.w.y *= factor;
            dummy.mat_local.0.w.z *= factor;
        }
        // Scale bounding sphere radii and centers
        for bs in &mut helper_data.bsphere_seq {
            bs.mat.0.w.x *= factor;
            bs.mat.0.w.y *= factor;
            bs.mat.0.w.z *= factor;
            bs.sphere.c.0.x *= factor;
            bs.sphere.c.0.y *= factor;
            bs.sphere.c.0.z *= factor;
            bs.sphere.r *= factor;
        }
    }

    // Write back
    let file = std::fs::File::create(lgo_path)?;
    let mut writer = BufWriter::new(file);
    geom.write_le(&mut writer)?;
    writer.flush()?;

    // Regenerate glTF preview
    let texture_search_dir = lgo_path
        .parent()
        .and_then(|p| p.parent())
        .unwrap_or(lgo_path);

    super::model::build_gltf_from_lgo(lgo_path, texture_search_dir)
}

/// Update dummy points in an LGO file and return regenerated glTF JSON.
pub fn update_dummies(lgo_path: &Path, dummies: Vec<WorkbenchDummy>) -> anyhow::Result<String> {
    apply_dummies_to_lgo(lgo_path, dummies)?;

    // Regenerate glTF preview
    let texture_search_dir = lgo_path
        .parent()
        .and_then(|p| p.parent())
        .unwrap_or(lgo_path);

    super::model::build_gltf_from_lgo(lgo_path, texture_search_dir)
}

// ============================================================================
// Workbench Types
// ============================================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkbenchDummy {
    pub id: u32,
    pub label: String,
    pub position: [f32; 3],
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorkbenchState {
    pub model_id: String,
    pub item_name: String,
    pub item_type: u32,
    pub item_description: String,
    pub scale_factor: f32,
    pub source_file: Option<String>,
    pub lgo_path: String,
    pub has_glow_overlay: bool,
    pub registered_item_id: Option<i64>,
    pub created_at: String,
    pub modified_at: String,
    pub dummies: Vec<WorkbenchDummy>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorkbenchSummary {
    pub model_id: String,
    pub item_name: String,
    pub item_type: u32,
    pub dummy_count: u32,
    pub has_glow_overlay: bool,
}

// ============================================================================
// SQLite CRUD
// ============================================================================

pub fn create_workbench(
    conn: &rusqlite::Connection,
    model_id: &str,
    item_name: &str,
    item_type: u32,
    source_file: Option<&str>,
    scale_factor: f32,
    lgo_path: &str,
) -> anyhow::Result<()> {
    let now = now_iso();
    conn.execute(
        "INSERT INTO workbenches (model_id, item_name, item_type, scale_factor, source_file, lgo_path, created_at, modified_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![model_id, item_name, item_type, scale_factor, source_file, lgo_path, now, now],
    )?;
    Ok(())
}

pub fn load_workbench(
    conn: &rusqlite::Connection,
    model_id: &str,
) -> anyhow::Result<WorkbenchState> {
    let mut stmt = conn.prepare(
        "SELECT model_id, item_name, item_type, item_description, scale_factor, source_file,
                lgo_path, has_glow_overlay, registered_item_id, created_at, modified_at
         FROM workbenches WHERE model_id = ?1",
    )?;

    let state = stmt.query_row(rusqlite::params![model_id], |row| {
        Ok(WorkbenchState {
            model_id: row.get(0)?,
            item_name: row.get(1)?,
            item_type: row.get(2)?,
            item_description: row.get(3)?,
            scale_factor: row.get(4)?,
            source_file: row.get(5)?,
            lgo_path: row.get(6)?,
            has_glow_overlay: row.get::<_, i32>(7)? != 0,
            registered_item_id: row.get(8)?,
            created_at: row.get(9)?,
            modified_at: row.get(10)?,
            dummies: vec![],
        })
    })?;

    // Load dummies
    let mut dummy_stmt = conn.prepare(
        "SELECT id, label, position_x, position_y, position_z
         FROM workbench_dummies WHERE model_id = ?1 ORDER BY id",
    )?;

    let dummies: Vec<WorkbenchDummy> = dummy_stmt
        .query_map(rusqlite::params![model_id], |row| {
            Ok(WorkbenchDummy {
                id: row.get(0)?,
                label: row.get(1)?,
                position: [row.get(2)?, row.get(3)?, row.get(4)?],
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(WorkbenchState { dummies, ..state })
}

pub fn save_workbench(conn: &rusqlite::Connection, state: &WorkbenchState) -> anyhow::Result<()> {
    let lgo_path = Path::new(&state.lgo_path);
    if !lgo_path.exists() {
        return Err(anyhow::anyhow!("LGO file not found: {}", state.lgo_path));
    }
    apply_dummies_to_lgo(lgo_path, state.dummies.clone())?;

    let now = now_iso();
    conn.execute(
        "UPDATE workbenches SET item_name = ?1, item_type = ?2, item_description = ?3,
         has_glow_overlay = ?4, registered_item_id = ?5, modified_at = ?6
         WHERE model_id = ?7",
        rusqlite::params![
            state.item_name,
            state.item_type,
            state.item_description,
            state.has_glow_overlay as i32,
            state.registered_item_id,
            now,
            state.model_id,
        ],
    )?;

    // Replace dummies
    conn.execute(
        "DELETE FROM workbench_dummies WHERE model_id = ?1",
        rusqlite::params![state.model_id],
    )?;
    for dummy in &state.dummies {
        conn.execute(
            "INSERT INTO workbench_dummies (id, model_id, label, position_x, position_y, position_z)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                dummy.id,
                state.model_id,
                dummy.label,
                dummy.position[0],
                dummy.position[1],
                dummy.position[2],
            ],
        )?;
    }

    Ok(())
}

pub fn list_workbenches(conn: &rusqlite::Connection) -> anyhow::Result<Vec<WorkbenchSummary>> {
    let mut stmt = conn.prepare(
        "SELECT w.model_id, w.item_name, w.item_type, w.has_glow_overlay,
                COUNT(d.id) as dummy_count
         FROM workbenches w
         LEFT JOIN workbench_dummies d ON w.model_id = d.model_id
         GROUP BY w.model_id
         ORDER BY w.modified_at DESC",
    )?;

    let summaries = stmt
        .query_map([], |row| {
            Ok(WorkbenchSummary {
                model_id: row.get(0)?,
                item_name: row.get(1)?,
                item_type: row.get(2)?,
                has_glow_overlay: row.get::<_, i32>(3)? != 0,
                dummy_count: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(summaries)
}

pub fn delete_workbench(conn: &rusqlite::Connection, model_id: &str) -> anyhow::Result<()> {
    conn.execute(
        "DELETE FROM workbenches WHERE model_id = ?1",
        rusqlite::params![model_id],
    )?;
    Ok(())
}

// ============================================================================
// ItemInfo.txt Generation
// ============================================================================

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ItemInfoPreview {
    pub tsv_line: String,
    pub assigned_id: u32,
}

#[derive(Default, Debug, Clone)]
struct ItemInfoHeader {
    id: Option<usize>,
    name: Option<usize>,
    icon: Option<usize>,
    model_ground: Option<usize>,
    model_lance: Option<usize>,
    model_carsise: Option<usize>,
    model_phyllis: Option<usize>,
    model_ami: Option<usize>,
    item_type: Option<usize>,
    description: Option<usize>,
}

fn parse_iteminfo_header(text: &str) -> ItemInfoHeader {
    for line in text.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with("//ID") {
            continue;
        }
        let header_line = trimmed.trim_start_matches('/');
        let cols: Vec<&str> = header_line.split('\t').collect();
        let mut header = ItemInfoHeader::default();
        for (idx, col) in cols.iter().enumerate() {
            match col.trim() {
                "ID" => header.id = Some(idx),
                "Name" => header.name = Some(idx),
                "Icon Name" => header.icon = Some(idx),
                "Model (Ground)" => header.model_ground = Some(idx),
                "Model (Lance)" => header.model_lance = Some(idx),
                "Model (Carsise)" => header.model_carsise = Some(idx),
                "Model (Phyllis)" => header.model_phyllis = Some(idx),
                "Model (Ami)" => header.model_ami = Some(idx),
                "Item Type" => header.item_type = Some(idx),
                "Description" => header.description = Some(idx),
                _ => {}
            }
        }
        return header;
    }
    ItemInfoHeader::default()
}

fn parse_iteminfo_lines(text: &str) -> Vec<Vec<String>> {
    let mut lines = Vec::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with("//") || trimmed.starts_with('/') {
            continue;
        }
        let fields = trimmed
            .split('\t')
            .map(|s| s.to_string())
            .collect::<Vec<_>>();
        if !fields.is_empty() {
            lines.push(fields);
        }
    }
    lines
}

fn collect_iteminfo_ids(lines: &[Vec<String>]) -> std::collections::HashSet<u32> {
    let mut ids = std::collections::HashSet::new();
    for fields in lines {
        if let Some(id_str) = fields.first() {
            if let Ok(id) = id_str.parse::<u32>() {
                ids.insert(id);
            }
        }
    }
    ids
}

/// Find an existing ItemInfo.txt entry with the given item_type to use as a
/// template. Returns the first matching row's fields so stat/property columns
/// carry reasonable defaults for the weapon category.
fn find_iteminfo_template_by_type(
    lines: &[Vec<String>],
    header: &ItemInfoHeader,
    item_type: u32,
) -> Option<Vec<String>> {
    let type_idx = header.item_type.unwrap_or(10);
    for fields in lines {
        if fields.len() <= type_idx {
            continue;
        }
        if let Ok(t) = fields[type_idx].trim().parse::<u32>() {
            if t == item_type {
                return Some(fields.clone());
            }
        }
    }
    None
}

fn ensure_iteminfo_length(fields: &mut Vec<String>, header: &ItemInfoHeader, min_len: usize) {
    let max_index = [
        header.id,
        header.name,
        header.icon,
        header.model_ground,
        header.model_lance,
        header.model_carsise,
        header.model_phyllis,
        header.model_ami,
        header.item_type,
        header.description,
    ]
    .iter()
    .copied()
    .flatten()
    .max()
    .unwrap_or(0);

    let target_len = std::cmp::max(min_len, max_index + 1);
    while fields.len() < target_len {
        fields.push("0".to_string());
    }
}

fn apply_iteminfo_fields(
    fields: &mut Vec<String>,
    header: &ItemInfoHeader,
    assigned_id: u32,
    state: &WorkbenchState,
    model_id: &str,
) {
    let id_idx = header.id.unwrap_or(0);
    if fields.len() <= id_idx {
        fields.resize(id_idx + 1, "0".to_string());
    }
    fields[id_idx] = assigned_id.to_string();

    let name_idx = header.name.unwrap_or(1);
    if fields.len() <= name_idx {
        fields.resize(name_idx + 1, "0".to_string());
    }
    fields[name_idx] = state.item_name.clone();

    if let Some(item_type_idx) = header.item_type {
        if fields.len() <= item_type_idx {
            fields.resize(item_type_idx + 1, "0".to_string());
        }
        fields[item_type_idx] = state.item_type.to_string();
    }

    // Only override model columns that had a non-zero value in the template.
    // Characters that can't equip this item type have model "0" — preserve that.
    for idx in [
        header.model_ground,
        header.model_lance,
        header.model_carsise,
        header.model_phyllis,
        header.model_ami,
    ]
    .iter()
    .copied()
    .flatten()
    {
        if fields.len() <= idx {
            fields.resize(idx + 1, "0".to_string());
        }
        let current = fields[idx].trim().to_string();
        if !current.is_empty() && current != "0" {
            fields[idx] = model_id.to_string();
        }
    }
}

/// Scan ItemInfo.txt for the next available item ID and generate a TSV entry.
pub fn generate_item_info_entry(
    project_dir: &Path,
    state: &WorkbenchState,
    requested_id: Option<u32>,
) -> anyhow::Result<ItemInfoPreview> {
    let item_info_path = project_dir.join("scripts/table/ItemInfo.txt");

    let (lines, header) = if item_info_path.exists() {
        let content = std::fs::read(&item_info_path)?;
        let text = String::from_utf8_lossy(&content).to_string();
        let lines = parse_iteminfo_lines(&text);
        let header = parse_iteminfo_header(&text);
        (lines, header)
    } else {
        (vec![], ItemInfoHeader::default())
    };

    let used_ids = collect_iteminfo_ids(&lines);

    let assigned_id = if let Some(req_id) = requested_id {
        if req_id == 0 {
            return Err(anyhow::anyhow!("Item ID must be greater than 0"));
        }
        if used_ids.contains(&req_id) {
            return Err(anyhow::anyhow!(
                "Item ID {} already exists in ItemInfo.txt. Pick another ID.",
                req_id
            ));
        }
        req_id
    } else {
        let max_id = used_ids.iter().copied().max().unwrap_or(0);
        max_id + 1
    };

    let model_id = &state.model_id;

    // Find a template entry of the same item_type from existing ItemInfo.txt.
    // This gives us proper defaults for stat columns, equipable slots, character
    // restrictions, etc. — values that vary by weapon category.
    let mut fields =
        find_iteminfo_template_by_type(&lines, &header, state.item_type).unwrap_or_default();

    if fields.is_empty() {
        // No existing entry of this type — build minimal TSV line.
        // Phyllis (col 6) and Ami (col 7) default to "0" since not all
        // character types can equip every weapon category.
        fields = vec![
            assigned_id.to_string(),     // 0: ID
            state.item_name.clone(),     // 1: Name
            String::new(),               // 2: Icon
            model_id.clone(),            // 3: model_ground
            model_id.clone(),            // 4: model_lance
            model_id.clone(),            // 5: model_carsise
            "0".to_string(),             // 6: model_phyllis
            "0".to_string(),             // 7: model_ami
            "0".to_string(),             // 8: Ship Symbol
            "00".to_string(),            // 9: Ship Size
            state.item_type.to_string(), // 10: item_type
        ];
    } else {
        apply_iteminfo_fields(&mut fields, &header, assigned_id, state, model_id);
    }

    ensure_iteminfo_length(&mut fields, &header, 94);

    // Always set the description field if we can locate it.
    if let Some(desc_idx) = header.description {
        if desc_idx < fields.len() {
            fields[desc_idx] = state.item_description.clone();
        }
    } else if fields.len() >= 94 {
        fields[93] = state.item_description.clone();
    }

    let tsv_line = fields.join("\t");

    Ok(ItemInfoPreview {
        tsv_line,
        assigned_id,
    })
}

/// Append the generated item info line to ItemInfo.txt.
pub fn register_item(
    project_dir: &Path,
    conn: &rusqlite::Connection,
    model_id: &str,
    tsv_line: &str,
    assigned_id: u32,
) -> anyhow::Result<()> {
    let item_info_path = project_dir.join("scripts/table/ItemInfo.txt");

    if item_info_path.exists() {
        let content = std::fs::read(&item_info_path)?;
        let text = String::from_utf8_lossy(&content);
        let lines = parse_iteminfo_lines(&text);
        let used_ids = collect_iteminfo_ids(&lines);
        if used_ids.contains(&assigned_id) {
            return Err(anyhow::anyhow!(
                "Item ID {} already exists in ItemInfo.txt. Pick another ID.",
                assigned_id
            ));
        }
    }

    // Append to file
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&item_info_path)?;
    writeln!(file, "{}", tsv_line)?;

    // Update workbench record
    conn.execute(
        "UPDATE workbenches SET registered_item_id = ?1 WHERE model_id = ?2",
        rusqlite::params![assigned_id as i64, model_id],
    )?;

    Ok(())
}

// ============================================================================
// Internal helpers
// ============================================================================

fn recompute_mesh_size(geom: &mut CharacterGeometricModel) {
    if let Some(ref mesh) = geom.mesh_info {
        use crate::character::mesh::CharacterInfoMeshHeader;
        use crate::d3d::D3DVertexElement9;
        use crate::math::{LwVector2, LwVector3};

        let header_size = std::mem::size_of::<CharacterInfoMeshHeader>();
        let ve_size = mesh.vertex_element_seq.len() * std::mem::size_of::<D3DVertexElement9>();
        let vert_size = mesh.vertex_seq.len() * std::mem::size_of::<LwVector3>();
        let norm_size = mesh.normal_seq.len() * std::mem::size_of::<LwVector3>();
        let col_size = mesh.vercol_seq.len() * std::mem::size_of::<u32>();
        let tc_size: usize = mesh
            .texcoord_seq
            .iter()
            .map(|tc| tc.len() * std::mem::size_of::<LwVector2>())
            .sum();
        let idx_size = mesh.index_seq.len() * std::mem::size_of::<u32>();
        let sub_size = mesh.subset_seq.len() * std::mem::size_of::<CharacterMeshSubsetInfo>();

        geom.header.mesh_size = (header_size
            + ve_size
            + vert_size
            + norm_size
            + col_size
            + tc_size
            + idx_size
            + sub_size) as u32;
    }
}

fn recompute_helper_size(geom: &mut CharacterGeometricModel) {
    if let Some(ref helper_data) = geom.helper_data {
        let mut size = 4u32; // _type field
        if helper_data._type & HELPER_TYPE_DUMMY > 0 {
            size += 4; // dummy_num
            size += helper_data.dummy_num * 140;
        }
        if helper_data._type & HELPER_TYPE_BSPHERE > 0 {
            size += 4; // bsphere_num
            size += helper_data.bsphere_num * 84;
        }
        geom.header.helper_size = size;
    } else {
        geom.header.helper_size = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// Helper: read an LGO from the test client, apply dummies, then verify
    /// the file can still be read back (roundtrip).
    #[test]
    fn lgo_roundtrip_with_dummies() {
        let project_dir = PathBuf::from("../top-client");
        // Use a known 1H sword model from the test client
        let src_path = project_dir.join("model/item/01010001.lgo");
        if !src_path.exists() {
            eprintln!("Test file not found at {:?}, skipping", src_path);
            return;
        }

        let tmp = std::env::temp_dir().join("pko_test_roundtrip_dummies.lgo");
        std::fs::copy(&src_path, &tmp).unwrap();

        // Read original to verify it parses
        let geom = CharacterGeometricModel::from_file(tmp.clone()).unwrap();
        let original_vertex_count = geom.mesh_info.as_ref().unwrap().vertex_seq.len();
        assert!(original_vertex_count > 0);

        // Add dummies
        let dummies = vec![
            WorkbenchDummy {
                id: 0,
                label: "Guard".into(),
                position: [0.0, 0.4, 0.0],
            },
            WorkbenchDummy {
                id: 1,
                label: "Blade".into(),
                position: [0.0, 1.2, 0.0],
            },
            WorkbenchDummy {
                id: 2,
                label: "Tip".into(),
                position: [0.0, 2.0, 0.0],
            },
        ];
        apply_dummies_to_lgo(&tmp, dummies).unwrap();

        // Read back and verify
        let geom2 = CharacterGeometricModel::from_file(tmp.clone()).unwrap();
        let helper = geom2
            .helper_data
            .as_ref()
            .expect("should have helper data after adding dummies");
        assert_eq!(helper.dummy_num, 3);
        assert_eq!(helper.dummy_seq.len(), 3);
        assert_eq!(helper.dummy_seq[0].id, 0);
        assert_eq!(helper.dummy_seq[2].id, 2);
        // Vertices should be unchanged
        assert_eq!(
            geom2.mesh_info.as_ref().unwrap().vertex_seq.len(),
            original_vertex_count
        );

        std::fs::remove_file(&tmp).ok();
    }

    /// Verify that add_glow_overlay followed by apply_dummies produces a
    /// readable file (the full workbench pipeline).
    #[test]
    fn lgo_roundtrip_glow_then_dummies() {
        let project_dir = PathBuf::from("../top-client");
        let src_path = project_dir.join("model/item/01010001.lgo");
        if !src_path.exists() {
            eprintln!("Test file not found at {:?}, skipping", src_path);
            return;
        }

        let tmp = std::env::temp_dir().join("pko_test_roundtrip_glow_dummies.lgo");
        std::fs::copy(&src_path, &tmp).unwrap();

        // Step 1: Add glow overlay
        add_glow_overlay(&tmp).unwrap();
        let geom1 = CharacterGeometricModel::from_file(tmp.clone()).unwrap();
        let subset_count = geom1.mesh_info.as_ref().unwrap().subset_seq.len();
        // Should have at least 2 subsets (original + overlay)
        assert!(subset_count >= 2, "glow overlay should add a subset");

        // Step 2: Add dummies
        let dummies = vec![
            WorkbenchDummy {
                id: 0,
                label: "Guard".into(),
                position: [0.0, 0.4, 0.0],
            },
            WorkbenchDummy {
                id: 1,
                label: "Tip".into(),
                position: [0.0, 2.0, 0.0],
            },
        ];
        apply_dummies_to_lgo(&tmp, dummies).unwrap();

        // Step 3: Read back — this is where the reported bug occurred
        let geom2 = CharacterGeometricModel::from_file(tmp.clone()).unwrap();
        let helper = geom2.helper_data.as_ref().expect("should have helper data");
        assert_eq!(helper.dummy_num, 2);
        assert_eq!(helper.dummy_seq.len(), 2);
        // Subsets should be unchanged
        assert_eq!(
            geom2.mesh_info.as_ref().unwrap().subset_seq.len(),
            subset_count
        );

        std::fs::remove_file(&tmp).ok();
    }

    /// Verify rescale_lgo roundtrip after the full pipeline.
    #[test]
    fn lgo_roundtrip_glow_dummies_rescale() {
        let project_dir = PathBuf::from("../top-client");
        let src_path = project_dir.join("model/item/01010001.lgo");
        if !src_path.exists() {
            eprintln!("Test file not found at {:?}, skipping", src_path);
            return;
        }

        let tmp = std::env::temp_dir().join("pko_test_roundtrip_rescale.lgo");
        std::fs::copy(&src_path, &tmp).unwrap();

        // Full pipeline: overlay → dummies → rescale
        add_glow_overlay(&tmp).unwrap();

        let dummies = vec![WorkbenchDummy {
            id: 0,
            label: "Guard".into(),
            position: [0.0, 0.4, 0.0],
        }];
        apply_dummies_to_lgo(&tmp, dummies).unwrap();

        // Record pre-rescale vertex positions
        let geom_before = CharacterGeometricModel::from_file(tmp.clone()).unwrap();
        let v0_before = geom_before.mesh_info.as_ref().unwrap().vertex_seq[0].clone();

        // Rescale by 0.5 — this is the operation that was failing
        rescale_lgo(&tmp, 0.5).unwrap();

        // Read back and verify vertices are halved
        let geom_after = CharacterGeometricModel::from_file(tmp.clone()).unwrap();
        let v0_after = &geom_after.mesh_info.as_ref().unwrap().vertex_seq[0];
        assert!((v0_after.0.x - v0_before.0.x * 0.5).abs() < 1e-5);
        assert!((v0_after.0.y - v0_before.0.y * 0.5).abs() < 1e-5);
        assert!((v0_after.0.z - v0_before.0.z * 0.5).abs() < 1e-5);

        // Dummy should also be scaled
        let helper = geom_after.helper_data.as_ref().unwrap();
        assert_eq!(helper.dummy_num, 1);
        let dummy_y = helper.dummy_seq[0].mat.0.w.y;
        assert!(
            (dummy_y - 0.2).abs() < 1e-5,
            "dummy Y should be 0.4 * 0.5 = 0.2, got {}",
            dummy_y
        );

        std::fs::remove_file(&tmp).ok();
    }

    /// Verify rotate_lgo roundtrip — rotate 90° around X should swap Y/Z coords.
    #[test]
    fn lgo_roundtrip_rotate() {
        let project_dir = PathBuf::from("../top-client");
        let src_path = project_dir.join("model/item/01010001.lgo");
        if !src_path.exists() {
            eprintln!("Test file not found at {:?}, skipping", src_path);
            return;
        }

        let tmp = std::env::temp_dir().join("pko_test_roundtrip_rotate.lgo");
        std::fs::copy(&src_path, &tmp).unwrap();

        // Record pre-rotate vertex positions
        let geom_before = CharacterGeometricModel::from_file(tmp.clone()).unwrap();
        let v0_before = geom_before.mesh_info.as_ref().unwrap().vertex_seq[0].clone();

        // Rotate 90° around X axis: (x, y, z) → (x, -z, y)
        rotate_lgo(&tmp, 90.0, 0.0, 0.0).unwrap();

        // Read back and verify rotation applied
        let geom_after = CharacterGeometricModel::from_file(tmp.clone()).unwrap();
        let v0_after = &geom_after.mesh_info.as_ref().unwrap().vertex_seq[0];

        // X should be unchanged
        assert!(
            (v0_after.0.x - v0_before.0.x).abs() < 1e-4,
            "X should be unchanged"
        );
        // Y should become -Z_before
        assert!(
            (v0_after.0.y - (-v0_before.0.z)).abs() < 1e-4,
            "Y should be -Z_before"
        );
        // Z should become Y_before
        assert!(
            (v0_after.0.z - v0_before.0.y).abs() < 1e-4,
            "Z should be Y_before"
        );

        std::fs::remove_file(&tmp).ok();
    }
}
