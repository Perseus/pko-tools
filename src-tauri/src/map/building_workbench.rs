//! Building workbench operations: rescale, rotate, export to game directory.
//!
//! Follows the `item/workbench.rs` pattern with SQLite persistence for workbench state.

use std::path::Path;
use std::time::SystemTime;

use anyhow::Result;
use serde::{Deserialize, Serialize};

use super::lmo;
use super::lmo_writer::write_lmo;
use super::scene_model;

// ============================================================================
// Workbench state
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BuildingWorkbenchState {
    pub building_id: String,
    pub source_file: String,
    pub scale_factor: f32,
    pub lmo_path: String,
    pub created_at: String,
}

pub fn now_timestamp() -> String {
    let duration = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    format!("{}", duration.as_secs())
}

// ============================================================================
// Rescale
// ============================================================================

/// Rescale all vertex positions in an LMO by a given factor.
/// Returns the updated glTF JSON for preview.
pub fn rescale_building(lmo_path: &Path, factor: f32, project_dir: &Path) -> Result<String> {
    let mut model = lmo::load_lmo(lmo_path)?;

    for geom in &mut model.geom_objects {
        for v in &mut geom.vertices {
            v[0] *= factor;
            v[1] *= factor;
            v[2] *= factor;
        }
    }

    // Write modified LMO back
    let lmo_data = write_lmo(&model);
    std::fs::write(lmo_path, &lmo_data)?;

    // Regenerate glTF preview
    scene_model::build_gltf_from_lmo(lmo_path, project_dir)
}

// ============================================================================
// Rotate
// ============================================================================

/// Rotate all vertices and normals in an LMO by Euler angles (in degrees).
/// Applies rotation around X, then Y, then Z in PKO space.
/// Returns the updated glTF JSON for preview.
pub fn rotate_building(
    lmo_path: &Path,
    x_deg: f32,
    y_deg: f32,
    z_deg: f32,
    project_dir: &Path,
) -> Result<String> {
    let mut model = lmo::load_lmo(lmo_path)?;

    let rx = x_deg.to_radians();
    let ry = y_deg.to_radians();
    let rz = z_deg.to_radians();

    // Rotation matrices (row-major, applied in order: Rz * Ry * Rx)
    let (sx, cx) = (rx.sin(), rx.cos());
    let (sy, cy) = (ry.sin(), ry.cos());
    let (sz, cz) = (rz.sin(), rz.cos());

    // Combined rotation matrix Rz * Ry * Rx
    let m = [
        [cy * cz, sx * sy * cz - cx * sz, cx * sy * cz + sx * sz],
        [cy * sz, sx * sy * sz + cx * cz, cx * sy * sz - sx * cz],
        [-sy, sx * cy, cx * cy],
    ];

    for geom in &mut model.geom_objects {
        for v in &mut geom.vertices {
            let [x, y, z] = *v;
            v[0] = m[0][0] * x + m[0][1] * y + m[0][2] * z;
            v[1] = m[1][0] * x + m[1][1] * y + m[1][2] * z;
            v[2] = m[2][0] * x + m[2][1] * y + m[2][2] * z;
        }
        for n in &mut geom.normals {
            let [x, y, z] = *n;
            n[0] = m[0][0] * x + m[0][1] * y + m[0][2] * z;
            n[1] = m[1][0] * x + m[1][1] * y + m[1][2] * z;
            n[2] = m[2][0] * x + m[2][1] * y + m[2][2] * z;
            // Re-normalize
            let len = (n[0] * n[0] + n[1] * n[1] + n[2] * n[2]).sqrt();
            if len > 1e-8 {
                n[0] /= len;
                n[1] /= len;
                n[2] /= len;
            }
        }
    }

    let lmo_data = write_lmo(&model);
    std::fs::write(lmo_path, &lmo_data)?;

    scene_model::build_gltf_from_lmo(lmo_path, project_dir)
}

// ============================================================================
// Export to game directory
// ============================================================================

/// Export a building LMO + textures to the project exports directory.
pub fn export_building(
    lmo_path: &Path,
    import_dir: &Path,
    export_dir: &Path,
    building_id: &str,
) -> Result<String> {
    std::fs::create_dir_all(export_dir)?;

    // Copy LMO
    let lmo_filename = format!("{}.lmo", building_id);
    let dest_lmo = export_dir.join(&lmo_filename);
    std::fs::copy(lmo_path, &dest_lmo)?;

    // Copy textures from import_dir/texture/ to export_dir/
    let tex_dir = import_dir.join("texture");
    if tex_dir.exists() {
        let export_tex_dir = export_dir.join("texture");
        std::fs::create_dir_all(&export_tex_dir)?;
        for entry in std::fs::read_dir(&tex_dir)? {
            let entry = entry?;
            if entry.file_type()?.is_file() {
                std::fs::copy(entry.path(), export_tex_dir.join(entry.file_name()))?;
            }
        }
    }

    Ok(dest_lmo.to_string_lossy().to_string())
}

// ============================================================================
// SQLite persistence
// ============================================================================

/// Ensure the building_workbenches table exists.
pub fn ensure_table(conn: &rusqlite::Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS building_workbenches (
            building_id TEXT PRIMARY KEY,
            source_file TEXT NOT NULL,
            scale_factor REAL NOT NULL DEFAULT 1.0,
            lmo_path TEXT NOT NULL,
            created_at TEXT NOT NULL
        )",
        [],
    )?;
    Ok(())
}

/// Save workbench state.
pub fn save_workbench(
    conn: &rusqlite::Connection,
    state: &BuildingWorkbenchState,
) -> Result<()> {
    ensure_table(conn)?;
    conn.execute(
        "INSERT OR REPLACE INTO building_workbenches (building_id, source_file, scale_factor, lmo_path, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![
            state.building_id,
            state.source_file,
            state.scale_factor,
            state.lmo_path,
            state.created_at,
        ],
    )?;
    Ok(())
}

/// Load workbench state.
pub fn load_workbench(
    conn: &rusqlite::Connection,
    building_id: &str,
) -> Result<Option<BuildingWorkbenchState>> {
    ensure_table(conn)?;
    let mut stmt = conn.prepare(
        "SELECT building_id, source_file, scale_factor, lmo_path, created_at
         FROM building_workbenches WHERE building_id = ?1",
    )?;
    let mut rows = stmt.query(rusqlite::params![building_id])?;
    if let Some(row) = rows.next()? {
        Ok(Some(BuildingWorkbenchState {
            building_id: row.get(0)?,
            source_file: row.get(1)?,
            scale_factor: row.get(2)?,
            lmo_path: row.get(3)?,
            created_at: row.get(4)?,
        }))
    } else {
        Ok(None)
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use crate::map::lmo::{
        LmoGeomObject, LmoMaterial, LmoModel, LmoSubset, MtlFormatVersion, RenderStateAtom,
        EXP_OBJ_VERSION_1_0_0_5,
    };

    fn make_test_lmo() -> LmoModel {
        LmoModel {
            version: EXP_OBJ_VERSION_1_0_0_5,
            geom_objects: vec![LmoGeomObject {
                id: 0,
                parent_id: 0xFFFFFFFF,
                obj_type: 0,
                mat_local: [
                    [1.0, 0.0, 0.0, 0.0],
                    [0.0, 1.0, 0.0, 0.0],
                    [0.0, 0.0, 1.0, 0.0],
                    [0.0, 0.0, 0.0, 1.0],
                ],
                rcci: [0u8; 16],
                state_ctrl: [0u8; 8],
                fvf: 0x112, // XYZ | NORMAL | TEX1
                pt_type: 4,
                bone_infl_factor: 0,
                vertex_element_num: 0,
                vertex_elements_blob: vec![],
                mesh_rs_set: vec![RenderStateAtom::default(); 8],
                vertices: vec![
                    [1.0, 0.0, 0.0],
                    [0.0, 2.0, 0.0],
                    [0.0, 0.0, 3.0],
                ],
                normals: vec![
                    [1.0, 0.0, 0.0],
                    [0.0, 1.0, 0.0],
                    [0.0, 0.0, 1.0],
                ],
                texcoords: vec![[0.0, 0.0], [1.0, 0.0], [0.0, 1.0]],
                vertex_colors: vec![],
                indices: vec![0, 1, 2],
                subsets: vec![LmoSubset {
                    primitive_num: 1,
                    start_index: 0,
                    vertex_num: 3,
                    min_index: 0,
                }],
                materials: vec![LmoMaterial::new_simple(
                    [0.8, 0.2, 0.1, 1.0],
                    [0.3, 0.3, 0.3, 1.0],
                    1.0,
                    None,
                )],
                helper_blob: vec![],
                raw_anim_blob: vec![],
                animation: None,
                mtl_format_version: MtlFormatVersion::Current,
            }],
            non_geom_entries: vec![],
        }
    }

    fn write_test_lmo(dir: &Path, name: &str) -> std::path::PathBuf {
        let model = make_test_lmo();
        let data = write_lmo(&model);
        let path = dir.join(name);
        std::fs::write(&path, &data).unwrap();
        path
    }

    #[test]
    fn rescale_vertices() {
        let temp_dir = std::env::temp_dir().join("pko_wb_rescale");
        let _ = std::fs::create_dir_all(&temp_dir);

        let lmo_path = write_test_lmo(&temp_dir, "test_rescale.lmo");

        // Rescale by 2x
        let _json = rescale_building(&lmo_path, 2.0, &temp_dir).unwrap();

        // Read back and verify
        let model = lmo::load_lmo(&lmo_path).unwrap();
        let verts = &model.geom_objects[0].vertices;

        assert!((verts[0][0] - 2.0).abs() < 1e-5, "x should be 2.0");
        assert!((verts[1][1] - 4.0).abs() < 1e-5, "y should be 4.0");
        assert!((verts[2][2] - 6.0).abs() < 1e-5, "z should be 6.0");

        let _ = std::fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn rotate_90_z() {
        let temp_dir = std::env::temp_dir().join("pko_wb_rotate");
        let _ = std::fs::create_dir_all(&temp_dir);

        let lmo_path = write_test_lmo(&temp_dir, "test_rotate.lmo");

        // Rotate 90° around Z axis
        let _json = rotate_building(&lmo_path, 0.0, 0.0, 90.0, &temp_dir).unwrap();

        let model = lmo::load_lmo(&lmo_path).unwrap();
        let verts = &model.geom_objects[0].vertices;

        // Original (1,0,0) → after Rz(90°) → (0,1,0)
        assert!((verts[0][0]).abs() < 1e-4, "vertex0 x should be ~0");
        assert!((verts[0][1] - 1.0).abs() < 1e-4, "vertex0 y should be ~1");
        assert!((verts[0][2]).abs() < 1e-4, "vertex0 z should be ~0");

        // Normals should also be rotated
        let norms = &model.geom_objects[0].normals;
        assert!((norms[0][0]).abs() < 1e-4, "normal0 x should be ~0");
        assert!((norms[0][1] - 1.0).abs() < 1e-4, "normal0 y should be ~1");

        let _ = std::fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn export_copies_files() {
        let temp_dir = std::env::temp_dir().join("pko_wb_export");
        let import_dir = temp_dir.join("import");
        let export_dir = temp_dir.join("export");
        let tex_dir = import_dir.join("texture");
        let _ = std::fs::create_dir_all(&tex_dir);

        let lmo_path = write_test_lmo(&import_dir, "test_export.lmo");
        std::fs::write(tex_dir.join("test.bmp"), b"fake texture").unwrap();

        let result = export_building(&lmo_path, &import_dir, &export_dir, "bd001").unwrap();

        // LMO should exist at export path
        assert!(std::path::Path::new(&result).exists(), "exported LMO should exist");
        // Texture should be copied
        assert!(
            export_dir.join("texture").join("test.bmp").exists(),
            "texture should be copied"
        );

        let _ = std::fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn sqlite_save_load() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        ensure_table(&conn).unwrap();

        let state = BuildingWorkbenchState {
            building_id: "test_001".to_string(),
            source_file: "/path/to/source.gltf".to_string(),
            scale_factor: 1.5,
            lmo_path: "/path/to/output.lmo".to_string(),
            created_at: now_timestamp(),
        };

        save_workbench(&conn, &state).unwrap();
        let loaded = load_workbench(&conn, "test_001").unwrap();

        assert!(loaded.is_some());
        let loaded = loaded.unwrap();
        assert_eq!(loaded.building_id, "test_001");
        assert_eq!(loaded.source_file, "/path/to/source.gltf");
        assert!((loaded.scale_factor - 1.5).abs() < 1e-5);

        // Not found case
        let missing = load_workbench(&conn, "nonexistent").unwrap();
        assert!(missing.is_none());
    }
}
