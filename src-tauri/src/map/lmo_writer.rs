//! LMO binary writer — serialize `LmoModel` back to the PKO LMO binary format.
//!
//! Always writes version 0x1005 format regardless of the original version.
//! Old-format files (v0, v0x1004) are silently "upgraded" on round-trip.

use super::lmo::{
    D3DFVF_DIFFUSE, D3DFVF_NORMAL, D3DFVF_TEXCOUNT_MASK, D3DFVF_TEXCOUNT_SHIFT,
    EXP_OBJ_VERSION_1_0_0_5, LmoGeomObject, LmoMaterial, LmoModel, LmoTexInfo,
    OBJ_TYPE_GEOMETRY, RenderStateAtom,
};

const LW_MESH_RS_NUM: usize = 8;
const LW_MTL_RS_NUM: usize = 8;
const LW_MAX_TEXTURESTAGE_NUM: usize = 4;

// ============================================================================
// Size computation
// ============================================================================

/// Compute material section size for one geometry object.
fn compute_mtl_size(materials: &[LmoMaterial]) -> u32 {
    if materials.is_empty() {
        return 0;
    }
    // mtl_num(4) + N × material_entry_size
    let per_material = 4 + 4 + 68 + mtl_rs_size() + LW_MAX_TEXTURESTAGE_NUM * tex_info_size();
    (4 + materials.len() * per_material) as u32
}

/// Size of material render state set: 8 × RenderStateAtom = 96 bytes.
const fn mtl_rs_size() -> usize {
    LW_MTL_RS_NUM * 12
}

/// Size of one texture info entry in v0x1005 format.
/// 11 DWORDs (44) + filename(64) + data(4) + tss_set(96) = 208 bytes.
const fn tex_info_size() -> usize {
    11 * 4 + 64 + 4 + LW_MTL_RS_NUM * 12
}

/// Compute mesh section size for one geometry object.
fn compute_mesh_size(geom: &LmoGeomObject) -> u32 {
    if geom.vertices.is_empty() {
        return 0;
    }
    let has_normals = (geom.fvf & D3DFVF_NORMAL) != 0;
    let tex_count = ((geom.fvf & D3DFVF_TEXCOUNT_MASK) >> D3DFVF_TEXCOUNT_SHIFT) as usize;
    let has_colors = (geom.fvf & D3DFVF_DIFFUSE) != 0;
    let vn = geom.vertices.len();
    let in_ = geom.indices.len();
    let sn = geom.subsets.len();

    // Mesh header: fvf(4) + pt_type(4) + vertex_num(4) + index_num(4) + subset_num(4)
    //   + bone_index_num(4) + bone_infl_factor(4) + vertex_element_num(4) + rs_set(96) = 128
    let header = 32 + LW_MESH_RS_NUM * 12;
    // vertex_elements: stored as raw blob (vertex_element_num * 8 bytes)
    let ve = geom.vertex_elements_blob.len();
    let positions = vn * 12;
    let normals = if has_normals { vn * 12 } else { 0 };
    let texcoords = tex_count * vn * 8;
    let colors = if has_colors { vn * 4 } else { 0 };
    let indices = in_ * 4;
    let subsets = sn * 16;

    (header + ve + positions + normals + texcoords + colors + indices + subsets) as u32
}

// ============================================================================
// Byte writing helpers
// ============================================================================

fn write_u32(buf: &mut Vec<u8>, v: u32) {
    buf.extend_from_slice(&v.to_le_bytes());
}

fn write_f32(buf: &mut Vec<u8>, v: f32) {
    buf.extend_from_slice(&v.to_le_bytes());
}

fn write_zeros(buf: &mut Vec<u8>, n: usize) {
    buf.extend(std::iter::repeat(0u8).take(n));
}

fn write_rs_atoms(buf: &mut Vec<u8>, atoms: &[RenderStateAtom], expected_count: usize) {
    for i in 0..expected_count {
        if let Some(atom) = atoms.get(i) {
            write_u32(buf, atom.state);
            write_u32(buf, atom.value0);
            write_u32(buf, atom.value1);
        } else {
            write_zeros(buf, 12);
        }
    }
}

fn write_cstr_fixed(buf: &mut Vec<u8>, s: &str, max_len: usize) {
    let bytes = s.as_bytes();
    let len = bytes.len().min(max_len - 1);
    let mut fixed = vec![0u8; max_len];
    fixed[..len].copy_from_slice(&bytes[..len]);
    buf.extend_from_slice(&fixed);
}

fn write_mat44(buf: &mut Vec<u8>, mat: &[[f32; 4]; 4]) {
    for row in mat {
        for &v in row {
            write_f32(buf, v);
        }
    }
}

// ============================================================================
// Material writer
// ============================================================================

fn write_material(buf: &mut Vec<u8>, mat: &LmoMaterial) {
    // opacity + transp_type
    write_f32(buf, mat.opacity);
    write_u32(buf, mat.transp_type);

    // CharMaterial: dif(16) + amb(16) + spe(16) + emi(16) + power(4) = 68
    for &c in &mat.diffuse { write_f32(buf, c); }
    for &c in &mat.ambient { write_f32(buf, c); }
    for &c in &mat.specular { write_f32(buf, c); }
    for &c in &mat.emissive { write_f32(buf, c); }
    write_f32(buf, mat.power);

    // rs_set: 8 × RenderStateAtom = 96 bytes
    write_rs_atoms(buf, &mat.rs_set, LW_MTL_RS_NUM);

    // tex_seq: 4 × TextureInfo
    for i in 0..LW_MAX_TEXTURESTAGE_NUM {
        write_tex_info(buf, &mat.tex_infos[i]);
    }
}

fn write_tex_info(buf: &mut Vec<u8>, info: &LmoTexInfo) {
    write_u32(buf, info.stage);
    write_u32(buf, info.level);
    write_u32(buf, info.usage);
    write_u32(buf, info.d3d_format);
    write_u32(buf, info.d3d_pool);
    write_u32(buf, info.byte_alignment_flag);
    write_u32(buf, info.tex_type);
    write_u32(buf, info.width);
    write_u32(buf, info.height);
    write_u32(buf, info.colorkey_type);
    write_u32(buf, info.colorkey);
    write_cstr_fixed(buf, &info.filename, 64);
    write_u32(buf, info.data);
    // tss_set: 8 × RenderStateAtom = 96 bytes
    write_rs_atoms(buf, &info.tss_set, LW_MTL_RS_NUM);
}

// ============================================================================
// Mesh writer
// ============================================================================

fn write_mesh(buf: &mut Vec<u8>, geom: &LmoGeomObject) {
    let has_normals = (geom.fvf & D3DFVF_NORMAL) != 0;
    let tex_count = ((geom.fvf & D3DFVF_TEXCOUNT_MASK) >> D3DFVF_TEXCOUNT_SHIFT) as usize;
    let has_colors = (geom.fvf & D3DFVF_DIFFUSE) != 0;

    // Mesh header
    write_u32(buf, geom.fvf);
    write_u32(buf, geom.pt_type);
    write_u32(buf, geom.vertices.len() as u32);
    write_u32(buf, geom.indices.len() as u32);
    write_u32(buf, geom.subsets.len() as u32);
    write_u32(buf, 0); // bone_index_num
    write_u32(buf, geom.bone_infl_factor);
    write_u32(buf, geom.vertex_element_num);
    write_rs_atoms(buf, &geom.mesh_rs_set, LW_MESH_RS_NUM);

    // vertex_elements (raw blob pass-through)
    buf.extend_from_slice(&geom.vertex_elements_blob);

    // Positions
    for v in &geom.vertices {
        for &c in v { write_f32(buf, c); }
    }

    // Normals
    if has_normals {
        for n in &geom.normals {
            for &c in n { write_f32(buf, c); }
        }
    }

    // Texture coordinates
    for tc in 0..tex_count {
        for (vi, _) in geom.vertices.iter().enumerate() {
            if tc == 0 && vi < geom.texcoords.len() {
                write_f32(buf, geom.texcoords[vi][0]);
                write_f32(buf, geom.texcoords[vi][1]);
            } else {
                // Additional tex coord sets or missing data — write zeros
                write_f32(buf, 0.0);
                write_f32(buf, 0.0);
            }
        }
    }

    // Vertex colors
    if has_colors {
        for &c in &geom.vertex_colors {
            write_u32(buf, c);
        }
        // Pad if vertex_colors is shorter than vertices
        for _ in geom.vertex_colors.len()..geom.vertices.len() {
            write_u32(buf, 0xFFFFFFFF);
        }
    }

    // Indices
    for &idx in &geom.indices {
        write_u32(buf, idx);
    }

    // Subsets
    for s in &geom.subsets {
        write_u32(buf, s.primitive_num);
        write_u32(buf, s.start_index);
        write_u32(buf, s.vertex_num);
        write_u32(buf, s.min_index);
    }
}

// ============================================================================
// Per-geometry-object writer
// ============================================================================

fn write_geom_object(geom: &LmoGeomObject) -> Vec<u8> {
    let mtl_size = compute_mtl_size(&geom.materials);
    let mesh_size = compute_mesh_size(geom);
    let helper_size = geom.helper_blob.len() as u32;
    let anim_size = geom.raw_anim_blob.len() as u32;

    let mut buf = Vec::new();

    // Header: 116 bytes (lwGeomObjInfoHeader)
    write_u32(&mut buf, geom.id);
    write_u32(&mut buf, geom.parent_id);
    write_u32(&mut buf, geom.obj_type);
    write_mat44(&mut buf, &geom.mat_local);
    buf.extend_from_slice(&geom.rcci);       // 16 bytes
    buf.extend_from_slice(&geom.state_ctrl); // 8 bytes
    write_u32(&mut buf, mtl_size);
    write_u32(&mut buf, mesh_size);
    write_u32(&mut buf, helper_size);
    write_u32(&mut buf, anim_size);

    // Materials
    if !geom.materials.is_empty() {
        write_u32(&mut buf, geom.materials.len() as u32);
        for mat in &geom.materials {
            write_material(&mut buf, mat);
        }
    }

    // Mesh
    if !geom.vertices.is_empty() {
        write_mesh(&mut buf, geom);
    }

    // Helpers (raw blob pass-through)
    buf.extend_from_slice(&geom.helper_blob);

    // Animation (raw blob pass-through)
    buf.extend_from_slice(&geom.raw_anim_blob);

    buf
}

// ============================================================================
// Top-level writer
// ============================================================================

/// Serialize an `LmoModel` to LMO binary format (always version 0x1005).
pub fn write_lmo(model: &LmoModel) -> Vec<u8> {
    // Collect all entries: geometry objects + non-geometry entries
    let total_entries = model.geom_objects.len() + model.non_geom_entries.len();

    // Pre-build geometry object blobs to compute sizes and addresses
    let geom_blobs: Vec<Vec<u8>> = model.geom_objects.iter().map(write_geom_object).collect();

    // File header: version(4) + obj_num(4) + header_table(entries × 12)
    let header_table_size = total_entries * 12;
    let file_header_size = 4 + 4 + header_table_size;

    // Calculate addresses for each entry
    let mut addr = file_header_size;
    let mut entries: Vec<(u32, usize, usize)> = Vec::with_capacity(total_entries);

    // Geometry objects first
    for blob in &geom_blobs {
        entries.push((OBJ_TYPE_GEOMETRY, addr, blob.len()));
        addr += blob.len();
    }

    // Non-geometry entries after
    for entry in &model.non_geom_entries {
        entries.push((entry.obj_type, addr, entry.data.len()));
        addr += entry.data.len();
    }

    // Write file
    let mut data = Vec::with_capacity(addr);

    // Version
    write_u32(&mut data, EXP_OBJ_VERSION_1_0_0_5);

    // Object count
    write_u32(&mut data, total_entries as u32);

    // Header table
    for &(obj_type, entry_addr, entry_size) in &entries {
        write_u32(&mut data, obj_type);
        write_u32(&mut data, entry_addr as u32);
        write_u32(&mut data, entry_size as u32);
    }

    // Geometry object blobs
    for blob in &geom_blobs {
        data.extend_from_slice(blob);
    }

    // Non-geometry entry blobs
    for entry in &model.non_geom_entries {
        data.extend_from_slice(&entry.data);
    }

    data
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::map::lmo::{
        self, LmoAnimData, LmoModel, LmoSubset, LmoTexInfo, MtlFormatVersion, NonGeomEntry,
    };

    /// Create a simple test geometry object with a triangle.
    fn make_test_geom(id: u32, fvf: u32) -> LmoGeomObject {
        let has_normals = (fvf & D3DFVF_NORMAL) != 0;
        let has_colors = (fvf & D3DFVF_DIFFUSE) != 0;
        let tex_count = ((fvf & D3DFVF_TEXCOUNT_MASK) >> D3DFVF_TEXCOUNT_SHIFT) as usize;

        LmoGeomObject {
            id,
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
            fvf,
            pt_type: 4, // TRIANGLELIST
            bone_infl_factor: 0,
            vertex_element_num: 0,
            vertex_elements_blob: vec![],
            mesh_rs_set: vec![RenderStateAtom::default(); 8],
            vertices: vec![
                [0.0, 0.0, 0.0],
                [1.0, 0.0, 0.0],
                [0.0, 1.0, 0.0],
            ],
            normals: if has_normals {
                vec![[0.0, 0.0, 1.0]; 3]
            } else {
                vec![]
            },
            texcoords: if tex_count > 0 {
                vec![[0.0, 0.0], [1.0, 0.0], [0.0, 1.0]]
            } else {
                vec![]
            },
            vertex_colors: if has_colors {
                vec![0xFFFF0000; 3]
            } else {
                vec![]
            },
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
                Some("wall.bmp".to_string()),
            )],
            helper_blob: vec![],
            raw_anim_blob: vec![],
            animation: None,
            mtl_format_version: MtlFormatVersion::Current,
        }
    }

    fn make_test_model(fvf: u32) -> LmoModel {
        LmoModel {
            version: EXP_OBJ_VERSION_1_0_0_5,
            geom_objects: vec![make_test_geom(42, fvf)],
            non_geom_entries: vec![],
        }
    }

    #[test]
    fn write_and_reparse_positions_only() {
        let model = make_test_model(0x002); // XYZ only
        let data = write_lmo(&model);
        let reparsed = lmo::parse_lmo(&data).unwrap();

        assert_eq!(reparsed.version, EXP_OBJ_VERSION_1_0_0_5);
        assert_eq!(reparsed.geom_objects.len(), 1);
        let geom = &reparsed.geom_objects[0];
        assert_eq!(geom.id, 42);
        assert_eq!(geom.vertices.len(), 3);
        assert_eq!(geom.vertices[0], [0.0, 0.0, 0.0]);
        assert_eq!(geom.vertices[1], [1.0, 0.0, 0.0]);
        assert_eq!(geom.vertices[2], [0.0, 1.0, 0.0]);
        assert!(geom.normals.is_empty());
        assert!(geom.texcoords.is_empty());
        assert!(geom.vertex_colors.is_empty());
        assert_eq!(geom.indices, vec![0, 1, 2]);
        assert_eq!(geom.subsets.len(), 1);
    }

    #[test]
    fn write_and_reparse_full_fvf() {
        // XYZ | NORMAL | DIFFUSE | TEX1
        let fvf = 0x002 | D3DFVF_NORMAL | D3DFVF_DIFFUSE | 0x100;
        let model = make_test_model(fvf);
        let data = write_lmo(&model);
        let reparsed = lmo::parse_lmo(&data).unwrap();

        let geom = &reparsed.geom_objects[0];
        assert_eq!(geom.vertices.len(), 3);
        assert_eq!(geom.normals.len(), 3);
        assert_eq!(geom.texcoords.len(), 3);
        assert_eq!(geom.vertex_colors.len(), 3);
        assert_eq!(geom.normals[0], [0.0, 0.0, 1.0]);
        assert_eq!(geom.texcoords[1], [1.0, 0.0]);
        assert_eq!(geom.vertex_colors[0], 0xFFFF0000);
    }

    #[test]
    fn write_and_reparse_normals_and_texcoords() {
        // XYZ | NORMAL | TEX1
        let fvf = 0x002 | D3DFVF_NORMAL | 0x100;
        let model = make_test_model(fvf);
        let data = write_lmo(&model);
        let reparsed = lmo::parse_lmo(&data).unwrap();

        let geom = &reparsed.geom_objects[0];
        assert_eq!(geom.normals.len(), 3);
        assert_eq!(geom.texcoords.len(), 3);
        assert!(geom.vertex_colors.is_empty());
    }

    #[test]
    fn write_and_reparse_vertex_colors_only() {
        // XYZ | DIFFUSE
        let fvf = 0x002 | D3DFVF_DIFFUSE;
        let model = make_test_model(fvf);
        let data = write_lmo(&model);
        let reparsed = lmo::parse_lmo(&data).unwrap();

        let geom = &reparsed.geom_objects[0];
        assert!(geom.normals.is_empty());
        assert!(geom.texcoords.is_empty());
        assert_eq!(geom.vertex_colors.len(), 3);
    }

    #[test]
    fn write_and_reparse_material_data() {
        let fvf = 0x002 | D3DFVF_NORMAL | 0x100;
        let mut model = make_test_model(fvf);
        // Set specific material values
        let mat = &mut model.geom_objects[0].materials[0];
        mat.specular = [0.1, 0.2, 0.3, 1.0];
        mat.emissive = [0.4, 0.5, 0.6, 0.0];
        mat.power = 32.0;
        mat.transp_type = 2;
        mat.opacity = 0.75;
        // Set a texture filename on the first slot
        mat.tex_infos[0].filename = "test_wall.dds".to_string();
        mat.tex_filename = Some("test_wall.dds".to_string());

        let data = write_lmo(&model);
        let reparsed = lmo::parse_lmo(&data).unwrap();

        let rmat = &reparsed.geom_objects[0].materials[0];
        assert!((rmat.opacity - 0.75).abs() < 1e-5);
        assert_eq!(rmat.transp_type, 2);
        assert!((rmat.diffuse[0] - 0.8).abs() < 0.01);
        assert!((rmat.specular[0] - 0.1).abs() < 1e-5);
        assert!((rmat.emissive[1] - 0.5).abs() < 1e-5);
        assert!((rmat.power - 32.0).abs() < 1e-5);
        assert_eq!(rmat.tex_filename.as_deref(), Some("test_wall.dds"));
        assert_eq!(rmat.tex_infos[0].filename, "test_wall.dds");
    }

    #[test]
    fn write_and_reparse_multiple_geom_objects() {
        let geom1 = make_test_geom(1, 0x002 | D3DFVF_NORMAL);
        let geom2 = make_test_geom(2, 0x002);
        let model = LmoModel {
            version: EXP_OBJ_VERSION_1_0_0_5,
            geom_objects: vec![geom1, geom2],
            non_geom_entries: vec![],
        };

        let data = write_lmo(&model);
        let reparsed = lmo::parse_lmo(&data).unwrap();

        assert_eq!(reparsed.geom_objects.len(), 2);
        assert_eq!(reparsed.geom_objects[0].id, 1);
        assert_eq!(reparsed.geom_objects[1].id, 2);
        assert_eq!(reparsed.geom_objects[0].normals.len(), 3);
        assert!(reparsed.geom_objects[1].normals.is_empty());
    }

    #[test]
    fn write_and_reparse_empty_model() {
        let model = LmoModel {
            version: EXP_OBJ_VERSION_1_0_0_5,
            geom_objects: vec![],
            non_geom_entries: vec![],
        };

        let data = write_lmo(&model);
        let reparsed = lmo::parse_lmo(&data).unwrap();

        assert_eq!(reparsed.version, EXP_OBJ_VERSION_1_0_0_5);
        assert!(reparsed.geom_objects.is_empty());
    }

    #[test]
    fn write_and_reparse_helper_blob() {
        let fvf = 0x002;
        let mut model = make_test_model(fvf);
        // Add a helper blob
        let helper_data = vec![0xDE, 0xAD, 0xBE, 0xEF, 0x42, 0x00, 0xFF, 0x01];
        model.geom_objects[0].helper_blob = helper_data.clone();

        let data = write_lmo(&model);
        let reparsed = lmo::parse_lmo(&data).unwrap();

        assert_eq!(reparsed.geom_objects[0].helper_blob, helper_data);
    }

    #[test]
    fn write_and_reparse_animation_blob() {
        let fvf = 0x002;
        let mut model = make_test_model(fvf);
        // Create a synthetic animation blob (valid v0x1005 format)
        let mut anim_blob = Vec::new();
        // data_bone_size = 0
        anim_blob.extend_from_slice(&0u32.to_le_bytes());
        // data_mat_size = 4 + 2*48 = 100
        anim_blob.extend_from_slice(&100u32.to_le_bytes());
        // mtlopac_size[16] = zeros
        for _ in 0..16 { anim_blob.extend_from_slice(&0u32.to_le_bytes()); }
        // texuv_size[16][4] = zeros
        for _ in 0..64 { anim_blob.extend_from_slice(&0u32.to_le_bytes()); }
        // teximg_size[16][4] = zeros
        for _ in 0..64 { anim_blob.extend_from_slice(&0u32.to_le_bytes()); }
        // Matrix data: frame_num=2
        anim_blob.extend_from_slice(&2u32.to_le_bytes());
        // Frame 0: identity
        let identity_frame = [1.0f32, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0];
        for &v in &identity_frame { anim_blob.extend_from_slice(&v.to_le_bytes()); }
        // Frame 1: identity + translation (5, 0, 0)
        let frame1 = [1.0f32, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 5.0, 0.0, 0.0];
        for &v in &frame1 { anim_blob.extend_from_slice(&v.to_le_bytes()); }

        model.geom_objects[0].raw_anim_blob = anim_blob.clone();

        let data = write_lmo(&model);
        let reparsed = lmo::parse_lmo(&data).unwrap();

        // Animation blob should be byte-exact
        assert_eq!(reparsed.geom_objects[0].raw_anim_blob, anim_blob);
        // Decomposed animation should also work
        let anim = reparsed.geom_objects[0].animation.as_ref().unwrap();
        assert_eq!(anim.frame_num, 2);
        assert!((anim.translations[0][0]).abs() < 1e-5);
        assert!((anim.translations[1][0] - 5.0).abs() < 1e-5);
    }

    #[test]
    fn write_and_reparse_header_fields() {
        let fvf = 0x002 | D3DFVF_NORMAL | 0x100;
        let mut model = make_test_model(fvf);
        let expected_rcci = [1u8, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
        let expected_state_ctrl = [0xAAu8, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF, 0x11, 0x22];
        {
            let geom = &mut model.geom_objects[0];
            geom.rcci = expected_rcci;
            geom.state_ctrl = expected_state_ctrl;
            geom.parent_id = 7;
            geom.obj_type = 3;
            geom.mat_local[3][0] = 100.0;
            geom.mat_local[3][1] = 200.0;
            geom.mat_local[3][2] = 300.0;
        }

        let data = write_lmo(&model);
        let reparsed = lmo::parse_lmo(&data).unwrap();

        let rgeom = &reparsed.geom_objects[0];
        assert_eq!(rgeom.rcci, expected_rcci);
        assert_eq!(rgeom.state_ctrl, expected_state_ctrl);
        assert_eq!(rgeom.parent_id, 7);
        assert_eq!(rgeom.obj_type, 3);
        assert!((rgeom.mat_local[3][0] - 100.0).abs() < 1e-5);
        assert!((rgeom.mat_local[3][1] - 200.0).abs() < 1e-5);
        assert!((rgeom.mat_local[3][2] - 300.0).abs() < 1e-5);
    }

    #[test]
    fn write_and_reparse_mesh_rs_set() {
        let fvf = 0x002;
        let mut model = make_test_model(fvf);
        let geom = &mut model.geom_objects[0];
        geom.mesh_rs_set[0] = RenderStateAtom { state: 7, value0: 42, value1: 99 };
        geom.mesh_rs_set[3] = RenderStateAtom { state: 100, value0: 200, value1: 300 };

        let data = write_lmo(&model);
        let reparsed = lmo::parse_lmo(&data).unwrap();

        let rgeom = &reparsed.geom_objects[0];
        assert_eq!(rgeom.mesh_rs_set[0], RenderStateAtom { state: 7, value0: 42, value1: 99 });
        assert_eq!(rgeom.mesh_rs_set[3], RenderStateAtom { state: 100, value0: 200, value1: 300 });
    }

    #[test]
    fn write_and_reparse_non_geom_entries() {
        let mut model = make_test_model(0x002);
        model.non_geom_entries.push(NonGeomEntry {
            obj_type: 2,
            data: vec![0xCA, 0xFE, 0xBA, 0xBE],
        });

        let data = write_lmo(&model);
        let reparsed = lmo::parse_lmo(&data).unwrap();

        assert_eq!(reparsed.geom_objects.len(), 1);
        assert_eq!(reparsed.non_geom_entries.len(), 1);
        assert_eq!(reparsed.non_geom_entries[0].obj_type, 2);
        assert_eq!(reparsed.non_geom_entries[0].data, vec![0xCA, 0xFE, 0xBA, 0xBE]);
    }

    #[test]
    fn round_trip_real_lmo() {
        // Full round-trip: parse → write → re-parse → compare
        let scene_dir = std::path::Path::new("../top-client/model/scene");
        if !scene_dir.exists() {
            return;
        }

        let lmo_file = std::fs::read_dir(scene_dir)
            .ok()
            .and_then(|mut dir| {
                dir.find(|e| {
                    e.as_ref()
                        .ok()
                        .map(|e| {
                            e.path()
                                .extension()
                                .map(|ext| ext.to_ascii_lowercase() == "lmo")
                                .unwrap_or(false)
                        })
                        .unwrap_or(false)
                })
            })
            .and_then(|e| e.ok())
            .map(|e| e.path());

        let lmo_path = match lmo_file {
            Some(p) => p,
            None => return,
        };

        eprintln!("Round-trip testing with: {}", lmo_path.display());
        let original = lmo::load_lmo(&lmo_path).unwrap();
        let written = write_lmo(&original);
        let reparsed = lmo::parse_lmo(&written).unwrap();

        // Compare structurally
        assert_eq!(reparsed.geom_objects.len(), original.geom_objects.len());
        for (i, (orig, repr)) in original.geom_objects.iter().zip(reparsed.geom_objects.iter()).enumerate() {
            assert_eq!(orig.id, repr.id, "geom[{}] id mismatch", i);
            assert_eq!(orig.parent_id, repr.parent_id, "geom[{}] parent_id mismatch", i);
            assert_eq!(orig.obj_type, repr.obj_type, "geom[{}] obj_type mismatch", i);
            assert_eq!(orig.vertices.len(), repr.vertices.len(), "geom[{}] vertex count mismatch", i);
            assert_eq!(orig.indices.len(), repr.indices.len(), "geom[{}] index count mismatch", i);
            assert_eq!(orig.subsets.len(), repr.subsets.len(), "geom[{}] subset count mismatch", i);
            assert_eq!(orig.materials.len(), repr.materials.len(), "geom[{}] material count mismatch", i);
            assert_eq!(orig.helper_blob, repr.helper_blob, "geom[{}] helper blob mismatch", i);
            assert_eq!(orig.raw_anim_blob, repr.raw_anim_blob, "geom[{}] anim blob mismatch", i);

            // Compare vertices
            for (j, (ov, rv)) in orig.vertices.iter().zip(repr.vertices.iter()).enumerate() {
                for c in 0..3 {
                    assert!((ov[c] - rv[c]).abs() < 1e-5, "geom[{}] vertex[{}][{}] mismatch: {} vs {}", i, j, c, ov[c], rv[c]);
                }
            }

            // Compare materials
            for (j, (om, rm)) in orig.materials.iter().zip(repr.materials.iter()).enumerate() {
                assert!((om.opacity - rm.opacity).abs() < 1e-5, "geom[{}] mat[{}] opacity mismatch", i, j);
                assert_eq!(om.tex_filename, rm.tex_filename, "geom[{}] mat[{}] tex_filename mismatch", i, j);
            }
        }
    }

    #[test]
    fn round_trip_animated_building() {
        let path = std::path::Path::new("../top-client/model/scene/by-bd013.lmo");
        if !path.exists() {
            return;
        }

        let original = lmo::load_lmo(path).unwrap();
        let written = write_lmo(&original);
        let reparsed = lmo::parse_lmo(&written).unwrap();

        assert_eq!(reparsed.geom_objects.len(), original.geom_objects.len());

        let orig_animated = original.geom_objects.iter().filter(|g| g.animation.is_some()).count();
        let repr_animated = reparsed.geom_objects.iter().filter(|g| g.animation.is_some()).count();
        assert_eq!(orig_animated, repr_animated, "animated object count mismatch");

        // Animation blob should be byte-exact
        for (i, (orig, repr)) in original.geom_objects.iter().zip(reparsed.geom_objects.iter()).enumerate() {
            assert_eq!(orig.raw_anim_blob, repr.raw_anim_blob, "geom[{}] animation blob mismatch", i);
        }
    }
}
