//! LMO file parser — multi-geometry-object container format for scene buildings/models.
//!
//! Binary layout:
//! ```text
//! [4 bytes]  version (DWORD, typically 0x1005)
//! [4 bytes]  obj_num (geometry objects + optional global helper)
//! [obj_num × 12 bytes]  Header table:
//!     type(4) — 1=GEOMETRY, 2=HELPER
//!     addr(4) — absolute file offset
//!     size(4) — data size
//!
//! TYPE 1 (Geometry Object) at each addr:
//!     [116 bytes]  Header: id(4) + parent_id(4) + type(4) + mat_local(64) +
//!                  rcci(16) + state_ctrl(8) + mtl_size(4) + mesh_size(4) +
//!                  helper_size(4) + anim_size(4)
//!     Materials:   mtl_num(4) + mtl_num × lwMtlTexInfo
//!     Mesh:        lwMeshInfoHeader + vertices + normals + texcoords + colors + indices + subsets
//!     Helpers:     helper_blob (raw bytes)
//!     Animation:   raw_anim_blob (raw bytes) — also decomposed for glTF visualization
//! ```

use std::io::{Cursor, Read as IoRead, Seek, SeekFrom};
use std::path::Path;

use anyhow::{anyhow, Result};
use cgmath::{InnerSpace, Matrix3, Matrix4, Quaternion, Vector3};
use serde::{Deserialize, Serialize};

// FVF flags (matching character/mesh.rs)
pub const D3DFVF_NORMAL: u32 = 0x010;
pub const D3DFVF_DIFFUSE: u32 = 0x040;
pub const D3DFVF_TEXCOUNT_MASK: u32 = 0xf00;
pub const D3DFVF_TEXCOUNT_SHIFT: u32 = 8;

// Object types in the header table
pub const OBJ_TYPE_GEOMETRY: u32 = 1;
pub const OBJ_TYPE_HELPER: u32 = 2;

// Version constants
pub const EXP_OBJ_VERSION_0_0_0_0: u32 = 0;
pub const EXP_OBJ_VERSION_1_0_0_4: u32 = 0x1004;
pub const EXP_OBJ_VERSION_1_0_0_5: u32 = 0x1005;

// Mesh render state atom count
const LW_MESH_RS_NUM: usize = 8;

// Material render state + texture constants
const LW_MTL_RS_NUM: usize = 8;
const LW_MAX_TEXTURESTAGE_NUM: usize = 4;
const LW_MAX_SUBSET_NUM: usize = 16;
const RENDER_STATE_ATOM_SIZE: usize = 12; // state(4) + value0(4) + value1(4)

/// A render state atom: state(u32) + value0(u32) + value1(u32) = 12 bytes.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct RenderStateAtom {
    pub state: u32,
    pub value0: u32,
    pub value1: u32,
}

impl Default for RenderStateAtom {
    fn default() -> Self {
        Self { state: 0, value0: 0, value1: 0 }
    }
}

/// Texture stage info — all D3D metadata for a single texture slot.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LmoTexInfo {
    pub stage: u32,
    pub level: u32,
    pub usage: u32,
    pub d3d_format: u32,
    pub d3d_pool: u32,
    pub byte_alignment_flag: u32,
    pub tex_type: u32,
    pub width: u32,
    pub height: u32,
    pub colorkey_type: u32,
    pub colorkey: u32,
    pub filename: String,
    pub data: u32,
    pub tss_set: Vec<RenderStateAtom>,
}

impl Default for LmoTexInfo {
    fn default() -> Self {
        Self {
            stage: 0, level: 0, usage: 0, d3d_format: 0, d3d_pool: 0,
            byte_alignment_flag: 0, tex_type: 0, width: 0, height: 0,
            colorkey_type: 0, colorkey: 0, filename: String::new(), data: 0,
            tss_set: vec![RenderStateAtom::default(); LW_MTL_RS_NUM],
        }
    }
}

/// Animation data for a geometry object — decomposed from matrix keyframes.
#[derive(Debug, Clone)]
pub struct LmoAnimData {
    pub frame_num: u32,
    pub translations: Vec<[f32; 3]>,  // per-frame translation (Z-up game space)
    pub rotations: Vec<[f32; 4]>,     // per-frame quaternion [x,y,z,w] (Z-up game space)
}

/// A single geometry object within an LMO file.
#[derive(Debug, Clone)]
pub struct LmoGeomObject {
    pub id: u32,
    pub parent_id: u32,
    pub obj_type: u32,
    pub mat_local: [[f32; 4]; 4],

    // --- Round-trip header fields ---
    pub rcci: [u8; 16],
    pub state_ctrl: [u8; 8],

    // --- Mesh header fields (needed for binary writer) ---
    pub fvf: u32,
    pub pt_type: u32,
    pub bone_infl_factor: u32,
    pub vertex_element_num: u32,
    pub vertex_elements_blob: Vec<u8>,
    pub mesh_rs_set: Vec<RenderStateAtom>,

    // --- Geometry data ---
    pub vertices: Vec<[f32; 3]>,
    pub normals: Vec<[f32; 3]>,
    pub texcoords: Vec<[f32; 2]>,
    pub vertex_colors: Vec<u32>,
    pub indices: Vec<u32>,
    pub subsets: Vec<LmoSubset>,
    pub materials: Vec<LmoMaterial>,

    // --- Pass-through blobs for round-trip ---
    pub helper_blob: Vec<u8>,
    pub raw_anim_blob: Vec<u8>,

    // --- Decomposed animation for glTF visualization ---
    pub animation: Option<LmoAnimData>,

    // --- Material format version for writer ---
    pub mtl_format_version: MtlFormatVersion,
}

/// A mesh subset — defines a range of indices rendered with a specific material.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LmoSubset {
    pub primitive_num: u32,
    pub start_index: u32,
    pub vertex_num: u32,
    pub min_index: u32,
}

/// Material info for an LMO geometry object — stores ALL fields for round-trip.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LmoMaterial {
    pub diffuse: [f32; 4],
    pub ambient: [f32; 4],
    pub specular: [f32; 4],
    pub emissive: [f32; 4],
    pub power: f32,
    pub opacity: f32,
    pub transp_type: u32,
    pub rs_set: Vec<RenderStateAtom>,
    pub tex_infos: [LmoTexInfo; 4],
    // Convenience accessor — first texture's filename (backward-compatible)
    pub tex_filename: Option<String>,
}

impl LmoMaterial {
    /// Create a material with minimal required fields and defaults for round-trip fields.
    pub fn new_simple(diffuse: [f32; 4], ambient: [f32; 4], opacity: f32, tex_filename: Option<String>) -> Self {
        let mut tex_infos: [LmoTexInfo; 4] = std::array::from_fn(|_| LmoTexInfo::default());
        // Sync tex_filename into tex_infos[0] so the writer picks it up
        if let Some(ref name) = tex_filename {
            tex_infos[0].filename = name.clone();
        }
        Self {
            diffuse,
            ambient,
            specular: [0.0; 4],
            emissive: [0.0; 4],
            power: 0.0,
            opacity,
            transp_type: 0,
            rs_set: vec![RenderStateAtom::default(); LW_MTL_RS_NUM],
            tex_infos,
            tex_filename,
        }
    }
}

/// A parsed LMO model containing multiple geometry objects.
#[derive(Debug, Clone)]
pub struct LmoModel {
    pub version: u32,
    pub geom_objects: Vec<LmoGeomObject>,
    /// Non-geometry header table entries (e.g., global helpers type=2) — stored for round-trip.
    pub non_geom_entries: Vec<NonGeomEntry>,
}

/// A non-geometry entry in the header table (type != 1), stored as raw bytes for round-trip.
#[derive(Debug, Clone)]
pub struct NonGeomEntry {
    pub obj_type: u32,
    pub data: Vec<u8>,
}

/// Material format version determined from the mtl_old_version field.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum MtlFormatVersion {
    /// MTLTEX_VERSION0000: no opacity/transp, lwTexInfo_0000, old rs/tss (128 bytes each)
    V0000,
    /// MTLTEX_VERSION0001: has opacity/transp, lwTexInfo_0001, old rs/tss (128 bytes each)
    V0001,
    /// MTLTEX_VERSION0002+ / EXP_OBJ >= 1.0.0.0: has opacity/transp, lwTexInfo, new rs/tss (96 bytes each)
    Current,
}

// ============================================================================
// Byte reading helpers
// ============================================================================

fn read_u32(cursor: &mut Cursor<&[u8]>) -> Result<u32> {
    let mut buf = [0u8; 4];
    cursor.read_exact(&mut buf)?;
    Ok(u32::from_le_bytes(buf))
}

fn read_f32(cursor: &mut Cursor<&[u8]>) -> Result<f32> {
    let mut buf = [0u8; 4];
    cursor.read_exact(&mut buf)?;
    Ok(f32::from_le_bytes(buf))
}

fn read_cstr_fixed(cursor: &mut Cursor<&[u8]>, max_len: usize) -> Result<String> {
    let mut buf = vec![0u8; max_len];
    cursor.read_exact(&mut buf)?;
    let end = buf.iter().position(|&b| b == 0).unwrap_or(max_len);
    Ok(String::from_utf8_lossy(&buf[..end]).to_string())
}

fn read_mat44(cursor: &mut Cursor<&[u8]>) -> Result<[[f32; 4]; 4]> {
    let mut mat = [[0.0f32; 4]; 4];
    for row in &mut mat {
        for val in row.iter_mut() {
            *val = read_f32(cursor)?;
        }
    }
    Ok(mat)
}

// ============================================================================
// Material parsing
// ============================================================================

fn read_rs_atoms(cursor: &mut Cursor<&[u8]>, count: usize) -> Result<Vec<RenderStateAtom>> {
    let mut atoms = Vec::with_capacity(count);
    for _ in 0..count {
        atoms.push(RenderStateAtom {
            state: read_u32(cursor)?,
            value0: read_u32(cursor)?,
            value1: read_u32(cursor)?,
        });
    }
    Ok(atoms)
}

fn read_bytes(cursor: &mut Cursor<&[u8]>, n: usize) -> Result<Vec<u8>> {
    let mut buf = vec![0u8; n];
    cursor.read_exact(&mut buf)?;
    Ok(buf)
}

/// Read a single material entry from cursor, format determined by `mtl_ver`.
///
/// Three formats exist with different render state sizes and texture info layouts:
///   - V0000: lwMaterial(68) + lwRenderStateSetMtl2(128) + lwTexInfo_0000[4]
///   - V0001: opacity(4) + transp(4) + lwMaterial(68) + lwRenderStateSetMtl2(128) + lwTexInfo_0001[4]
///   - Current: opacity(4) + transp(4) + lwMaterial(68) + lwRenderStateAtom[8](96) + lwTexInfo[4]
fn read_material(cursor: &mut Cursor<&[u8]>, mtl_ver: MtlFormatVersion) -> Result<LmoMaterial> {
    // Opacity / transp_type — absent in V0000
    let (opacity, transp_type) = if mtl_ver == MtlFormatVersion::V0000 {
        (1.0, 0u32)
    } else {
        let o = read_f32(cursor)?;
        let t = read_u32(cursor)?;
        (o, t)
    };

    // CharMaterial: dif(16) + amb(16) + spe(16) + emi(16) + power(4) = 68 bytes
    let diffuse = [read_f32(cursor)?, read_f32(cursor)?, read_f32(cursor)?, read_f32(cursor)?];
    let ambient = [read_f32(cursor)?, read_f32(cursor)?, read_f32(cursor)?, read_f32(cursor)?];
    let specular = [read_f32(cursor)?, read_f32(cursor)?, read_f32(cursor)?, read_f32(cursor)?];
    let emissive = [read_f32(cursor)?, read_f32(cursor)?, read_f32(cursor)?, read_f32(cursor)?];
    let power = read_f32(cursor)?;

    // rs_set — old formats use lwRenderStateSetMtl2 (128 bytes), new uses lwRenderStateAtom[8] (96 bytes)
    let rs_set = match mtl_ver {
        MtlFormatVersion::V0000 | MtlFormatVersion::V0001 => {
            // Old format: 128 bytes — store as raw bytes, converted to 8 atoms padded with zeros
            // We read raw 128 bytes but store as Vec<RenderStateAtom> for uniformity
            let raw = read_bytes(cursor, 128)?;
            // Interpret old format: lwRenderStateValue[2][8] — each value = state(4) + value(4) = 8 bytes
            // Repack into RenderStateAtom with value1=0
            let mut atoms = Vec::with_capacity(LW_MTL_RS_NUM);
            let mut off = 0;
            for _ in 0..LW_MTL_RS_NUM.min(raw.len() / 8) {
                let state = u32::from_le_bytes([raw[off], raw[off+1], raw[off+2], raw[off+3]]);
                let value0 = u32::from_le_bytes([raw[off+4], raw[off+5], raw[off+6], raw[off+7]]);
                atoms.push(RenderStateAtom { state, value0, value1: 0 });
                off += 8;
            }
            while atoms.len() < LW_MTL_RS_NUM {
                atoms.push(RenderStateAtom::default());
            }
            atoms
        }
        MtlFormatVersion::Current => {
            read_rs_atoms(cursor, LW_MTL_RS_NUM)?
        }
    };

    // tex_seq: 4 × TextureInfo — read ALL fields for round-trip
    let mut tex_infos: [LmoTexInfo; 4] = std::array::from_fn(|_| LmoTexInfo::default());
    let mut tex_filename = None;

    for i in 0..LW_MAX_TEXTURESTAGE_NUM {
        match mtl_ver {
            MtlFormatVersion::V0000 => {
                // lwTexInfo_0000: stage(4) + colorkey_type(4) + colorkey(4) + format(4) +
                //                 file_name(64) + lwTextureStageStateSetTex2(128) = 208
                let stage = read_u32(cursor)?;
                let colorkey_type = read_u32(cursor)?;
                let colorkey = read_u32(cursor)?;
                let d3d_format = read_u32(cursor)?;
                let fname = read_cstr_fixed(cursor, 64)?;
                // Old tss_set: 128 bytes
                let raw_tss = read_bytes(cursor, 128)?;
                let mut tss_set = Vec::with_capacity(LW_MTL_RS_NUM);
                let mut off = 0;
                for _ in 0..LW_MTL_RS_NUM.min(raw_tss.len() / 8) {
                    let s = u32::from_le_bytes([raw_tss[off], raw_tss[off+1], raw_tss[off+2], raw_tss[off+3]]);
                    let v = u32::from_le_bytes([raw_tss[off+4], raw_tss[off+5], raw_tss[off+6], raw_tss[off+7]]);
                    tss_set.push(RenderStateAtom { state: s, value0: v, value1: 0 });
                    off += 8;
                }
                while tss_set.len() < LW_MTL_RS_NUM {
                    tss_set.push(RenderStateAtom::default());
                }

                if i == 0 && !fname.is_empty() {
                    tex_filename = Some(fname.clone());
                }
                tex_infos[i] = LmoTexInfo {
                    stage, level: 0, usage: 0, d3d_format, d3d_pool: 0,
                    byte_alignment_flag: 0, tex_type: 0, width: 0, height: 0,
                    colorkey_type, colorkey, filename: fname, data: 0, tss_set,
                };
            }
            MtlFormatVersion::V0001 => {
                // lwTexInfo_0001: stage(4) + level(4) + usage(4) + format(4) + pool(4) +
                //   byte_align(4) + type(4) + width(4) + height(4) + colorkey_type(4) +
                //   colorkey(4) + file_name(64) + data(4) + lwTextureStageStateSetTex2(128) = 240
                let stage = read_u32(cursor)?;
                let level = read_u32(cursor)?;
                let usage = read_u32(cursor)?;
                let d3d_format = read_u32(cursor)?;
                let d3d_pool = read_u32(cursor)?;
                let byte_alignment_flag = read_u32(cursor)?;
                let tex_type = read_u32(cursor)?;
                let width = read_u32(cursor)?;
                let height = read_u32(cursor)?;
                let colorkey_type = read_u32(cursor)?;
                let colorkey = read_u32(cursor)?;
                let fname = read_cstr_fixed(cursor, 64)?;
                let data = read_u32(cursor)?;
                // Old tss_set: 128 bytes
                let raw_tss = read_bytes(cursor, 128)?;
                let mut tss_set = Vec::with_capacity(LW_MTL_RS_NUM);
                let mut off = 0;
                for _ in 0..LW_MTL_RS_NUM.min(raw_tss.len() / 8) {
                    let s = u32::from_le_bytes([raw_tss[off], raw_tss[off+1], raw_tss[off+2], raw_tss[off+3]]);
                    let v = u32::from_le_bytes([raw_tss[off+4], raw_tss[off+5], raw_tss[off+6], raw_tss[off+7]]);
                    tss_set.push(RenderStateAtom { state: s, value0: v, value1: 0 });
                    off += 8;
                }
                while tss_set.len() < LW_MTL_RS_NUM {
                    tss_set.push(RenderStateAtom::default());
                }

                if i == 0 && !fname.is_empty() {
                    tex_filename = Some(fname.clone());
                }
                tex_infos[i] = LmoTexInfo {
                    stage, level, usage, d3d_format, d3d_pool,
                    byte_alignment_flag, tex_type, width, height,
                    colorkey_type, colorkey, filename: fname, data, tss_set,
                };
            }
            MtlFormatVersion::Current => {
                // lwTexInfo: same fields as V0001 but tss_set is lwRenderStateAtom[8] (96 bytes)
                let stage = read_u32(cursor)?;
                let level = read_u32(cursor)?;
                let usage = read_u32(cursor)?;
                let d3d_format = read_u32(cursor)?;
                let d3d_pool = read_u32(cursor)?;
                let byte_alignment_flag = read_u32(cursor)?;
                let tex_type = read_u32(cursor)?;
                let width = read_u32(cursor)?;
                let height = read_u32(cursor)?;
                let colorkey_type = read_u32(cursor)?;
                let colorkey = read_u32(cursor)?;
                let fname = read_cstr_fixed(cursor, 64)?;
                let data = read_u32(cursor)?;
                let tss_set = read_rs_atoms(cursor, LW_MTL_RS_NUM)?;

                if i == 0 && !fname.is_empty() {
                    tex_filename = Some(fname.clone());
                }
                tex_infos[i] = LmoTexInfo {
                    stage, level, usage, d3d_format, d3d_pool,
                    byte_alignment_flag, tex_type, width, height,
                    colorkey_type, colorkey, filename: fname, data, tss_set,
                };
            }
        }
    }

    Ok(LmoMaterial {
        diffuse,
        ambient,
        specular,
        emissive,
        power,
        opacity,
        transp_type,
        rs_set,
        tex_infos,
        tex_filename,
    })
}

// ============================================================================
// Mesh parsing
// ============================================================================

/// Mesh data parsed from a geometry object.
struct MeshData {
    fvf: u32,
    pt_type: u32,
    bone_infl_factor: u32,
    vertex_element_num: u32,
    vertex_elements_blob: Vec<u8>,
    mesh_rs_set: Vec<RenderStateAtom>,
    vertices: Vec<[f32; 3]>,
    normals: Vec<[f32; 3]>,
    texcoords: Vec<[f32; 2]>,
    vertex_colors: Vec<u32>,
    indices: Vec<u32>,
    subsets: Vec<LmoSubset>,
}

/// Read mesh data from cursor, returning all header fields + geometry data.
fn read_mesh(cursor: &mut Cursor<&[u8]>, file_version: u32) -> Result<MeshData> {
    // For version 0, the mesh section has an embedded old_version prefix
    let mesh_version = if file_version == EXP_OBJ_VERSION_0_0_0_0 {
        read_u32(cursor)?
    } else {
        file_version
    };

    // Read mesh header — format depends on version
    let (fvf, pt_type, vertex_num, index_num, subset_num, bone_index_num, bone_infl_factor, vertex_element_num);
    let mesh_rs_set;

    if mesh_version >= EXP_OBJ_VERSION_1_0_0_4 {
        fvf = read_u32(cursor)?;
        pt_type = read_u32(cursor)?;
        vertex_num = read_u32(cursor)? as usize;
        index_num = read_u32(cursor)? as usize;
        subset_num = read_u32(cursor)? as usize;
        bone_index_num = read_u32(cursor)? as usize;
        bone_infl_factor = read_u32(cursor)?;
        vertex_element_num = read_u32(cursor)?;
        mesh_rs_set = read_rs_atoms(cursor, LW_MESH_RS_NUM)?;
    } else {
        fvf = read_u32(cursor)?;
        pt_type = read_u32(cursor)?;
        vertex_num = read_u32(cursor)? as usize;
        index_num = read_u32(cursor)? as usize;
        subset_num = read_u32(cursor)? as usize;
        bone_index_num = read_u32(cursor)? as usize;
        bone_infl_factor = 0;
        vertex_element_num = 0;

        if mesh_version == 0 {
            // MESH_VERSION0000: 128 bytes — old format
            let raw = read_bytes(cursor, 128)?;
            let mut atoms = Vec::with_capacity(LW_MESH_RS_NUM);
            let mut off = 0;
            for _ in 0..LW_MESH_RS_NUM.min(raw.len() / 8) {
                let state = u32::from_le_bytes([raw[off], raw[off+1], raw[off+2], raw[off+3]]);
                let value0 = u32::from_le_bytes([raw[off+4], raw[off+5], raw[off+6], raw[off+7]]);
                atoms.push(RenderStateAtom { state, value0, value1: 0 });
                off += 8;
            }
            while atoms.len() < LW_MESH_RS_NUM {
                atoms.push(RenderStateAtom::default());
            }
            mesh_rs_set = atoms;
        } else {
            mesh_rs_set = read_rs_atoms(cursor, LW_MESH_RS_NUM)?;
        }
    }

    if mesh_version >= EXP_OBJ_VERSION_1_0_0_4 {
        // D3DVertexElement9 entries (8 bytes each) — store as raw blob for round-trip
        let vertex_elements_blob = if vertex_element_num > 0 {
            read_bytes(cursor, vertex_element_num as usize * 8)?
        } else {
            Vec::new()
        };

        let mut vertices = Vec::with_capacity(vertex_num);
        for _ in 0..vertex_num {
            vertices.push([read_f32(cursor)?, read_f32(cursor)?, read_f32(cursor)?]);
        }

        let mut normals = Vec::new();
        if (fvf & D3DFVF_NORMAL) != 0 {
            normals.reserve(vertex_num);
            for _ in 0..vertex_num {
                normals.push([read_f32(cursor)?, read_f32(cursor)?, read_f32(cursor)?]);
            }
        }

        let tex_count = ((fvf & D3DFVF_TEXCOUNT_MASK) >> D3DFVF_TEXCOUNT_SHIFT) as usize;
        let mut texcoords = Vec::new();
        for tc in 0..tex_count {
            for _ in 0..vertex_num {
                let u = read_f32(cursor)?;
                let v = read_f32(cursor)?;
                if tc == 0 {
                    texcoords.push([u, v]);
                }
            }
        }

        let mut vertex_colors = Vec::new();
        if (fvf & D3DFVF_DIFFUSE) != 0 {
            vertex_colors.reserve(vertex_num);
            for _ in 0..vertex_num {
                vertex_colors.push(read_u32(cursor)?);
            }
        }

        if bone_index_num > 0 {
            cursor.seek(SeekFrom::Current(vertex_num as i64 * 8 + bone_index_num as i64 * 4))?;
        }

        let mut indices = Vec::with_capacity(index_num);
        for _ in 0..index_num {
            indices.push(read_u32(cursor)?);
        }

        let mut subsets = Vec::with_capacity(subset_num);
        for _ in 0..subset_num {
            subsets.push(LmoSubset {
                primitive_num: read_u32(cursor)?,
                start_index: read_u32(cursor)?,
                vertex_num: read_u32(cursor)?,
                min_index: read_u32(cursor)?,
            });
        }

        Ok(MeshData { fvf, pt_type, bone_infl_factor, vertex_element_num, vertex_elements_blob, mesh_rs_set,
            vertices, normals, texcoords, vertex_colors, indices, subsets })
    } else {
        // Old format (pre-1.0.0.4): subsets FIRST
        let mut subsets = Vec::with_capacity(subset_num);
        for _ in 0..subset_num {
            subsets.push(LmoSubset {
                primitive_num: read_u32(cursor)?,
                start_index: read_u32(cursor)?,
                vertex_num: read_u32(cursor)?,
                min_index: read_u32(cursor)?,
            });
        }

        let mut vertices = Vec::with_capacity(vertex_num);
        for _ in 0..vertex_num {
            vertices.push([read_f32(cursor)?, read_f32(cursor)?, read_f32(cursor)?]);
        }

        let mut normals = Vec::new();
        if (fvf & D3DFVF_NORMAL) != 0 {
            normals.reserve(vertex_num);
            for _ in 0..vertex_num {
                normals.push([read_f32(cursor)?, read_f32(cursor)?, read_f32(cursor)?]);
            }
        }

        let tex_count = ((fvf & D3DFVF_TEXCOUNT_MASK) >> D3DFVF_TEXCOUNT_SHIFT) as usize;
        let mut texcoords = Vec::new();
        for tc in 0..tex_count {
            for _ in 0..vertex_num {
                let u = read_f32(cursor)?;
                let v = read_f32(cursor)?;
                if tc == 0 {
                    texcoords.push([u, v]);
                }
            }
        }

        let mut vertex_colors = Vec::new();
        if (fvf & D3DFVF_DIFFUSE) != 0 {
            vertex_colors.reserve(vertex_num);
            for _ in 0..vertex_num {
                vertex_colors.push(read_u32(cursor)?);
            }
        }

        if bone_index_num > 0 {
            cursor.seek(SeekFrom::Current(vertex_num as i64 * 8 + bone_index_num as i64))?;
        }

        let mut indices = Vec::with_capacity(index_num);
        for _ in 0..index_num {
            indices.push(read_u32(cursor)?);
        }

        Ok(MeshData { fvf, pt_type, bone_infl_factor, vertex_element_num, vertex_elements_blob: Vec::new(), mesh_rs_set,
            vertices, normals, texcoords, vertex_colors, indices, subsets })
    }
}

// ============================================================================
// Animation parsing
// ============================================================================

/// Decompose a 4x3 matrix (stored as 12 floats) into translation + quaternion rotation.
///
/// File layout: 12 floats in row-major order → 3 basis vectors (rows 0-2) + translation (row 3).
/// We construct a column-major Matrix4 matching the `LwMatrix43` convention from `math/mod.rs`.
fn decompose_matrix43(raw: &[f32; 12]) -> ([f32; 3], [f32; 4]) {
    // Construct column-major Matrix4 (same layout as LwMatrix43's br(map)):
    // Column 0: [raw[0], raw[1], raw[2], 0]
    // Column 1: [raw[3], raw[4], raw[5], 0]
    // Column 2: [raw[6], raw[7], raw[8], 0]
    // Column 3: [raw[9], raw[10], raw[11], 1]
    let mat = Matrix4::new(
        raw[0], raw[1], raw[2], 0.0,
        raw[3], raw[4], raw[5], 0.0,
        raw[6], raw[7], raw[8], 0.0,
        raw[9], raw[10], raw[11], 1.0,
    );

    // Translation = 4th column
    let translation = [mat.w.x, mat.w.y, mat.w.z];

    // Extract column vectors for rotation
    let mut col0 = Vector3::new(mat.x.x, mat.x.y, mat.x.z);
    let mut col1 = Vector3::new(mat.y.x, mat.y.y, mat.y.z);
    let mut col2 = Vector3::new(mat.z.x, mat.z.y, mat.z.z);

    let scale_x = col0.magnitude();
    let scale_y = col1.magnitude();
    let scale_z = col2.magnitude();

    if scale_x > 1e-8 { col0 /= scale_x; }
    if scale_y > 1e-8 { col1 /= scale_y; }
    if scale_z > 1e-8 { col2 /= scale_z; }

    let rotation_matrix = Matrix3::from_cols(col0, col1, col2);
    let q = Quaternion::from(rotation_matrix);

    // glTF quaternion order: [x, y, z, w]
    let rotation = [q.v.x, q.v.y, q.v.z, q.s];

    (translation, rotation)
}

/// Read animation data from the animation section of a geometry object.
///
/// The animation section contains a size header table followed by actual data blocks.
/// We only extract lwAnimDataMatrix (matrix keyframe animation), which is the format
/// used by building animations (spinning lamps, rotating objects, etc.).
fn read_animation(
    cursor: &mut Cursor<&[u8]>,
    anim_size: usize,
    file_version: u32,
) -> Result<Option<LmoAnimData>> {
    if anim_size == 0 {
        return Ok(None);
    }

    let start_pos = cursor.position();
    let end_pos = start_pos + anim_size as u64;

    // Size header table (version-dependent layout)
    if file_version == EXP_OBJ_VERSION_0_0_0_0 {
        let _old_version = read_u32(cursor)?;
    }

    let data_bone_size = read_u32(cursor)? as usize;
    let data_mat_size = read_u32(cursor)? as usize;

    // mtlopac_size[16] — only present in version >= 0x1005
    if file_version >= 0x1005 {
        for _ in 0..LW_MAX_SUBSET_NUM {
            let _ = read_u32(cursor)?;
        }
    }

    // data_texuv_size[16][4]
    for _ in 0..(LW_MAX_SUBSET_NUM * LW_MAX_TEXTURESTAGE_NUM) {
        let _ = read_u32(cursor)?;
    }

    // data_teximg_size[16][4]
    for _ in 0..(LW_MAX_SUBSET_NUM * LW_MAX_TEXTURESTAGE_NUM) {
        let _ = read_u32(cursor)?;
    }

    // Skip bone animation data (buildings don't use skeletal animation)
    if data_bone_size > 0 {
        cursor.seek(SeekFrom::Current(data_bone_size as i64))?;
    }

    // Read matrix animation data
    if data_mat_size > 0 {
        let frame_num = read_u32(cursor)?;

        if frame_num == 0 || frame_num > 100_000 {
            // Sanity check — skip if 0 or unreasonably large
            cursor.set_position(end_pos);
            return Ok(None);
        }

        let mut translations = Vec::with_capacity(frame_num as usize);
        let mut rotations = Vec::with_capacity(frame_num as usize);

        for _ in 0..frame_num {
            let mut raw = [0.0f32; 12];
            for val in &mut raw {
                *val = read_f32(cursor)?;
            }
            let (t, r) = decompose_matrix43(&raw);
            translations.push(t);
            rotations.push(r);
        }

        cursor.set_position(end_pos);
        return Ok(Some(LmoAnimData {
            frame_num,
            translations,
            rotations,
        }));
    }

    // No matrix animation
    cursor.set_position(end_pos);
    Ok(None)
}

/// Normalize an animation blob to v0x1005 internal format.
///
/// Animation section layout differs by version:
/// - v0:      [old_version(4)] [data_bone_size(4)] [data_mat_size(4)] [texuv(256)] [teximg(256)] [data...]
/// - v0x1004: [data_bone_size(4)] [data_mat_size(4)] [texuv(256)] [teximg(256)] [data...]
/// - v0x1005: [data_bone_size(4)] [data_mat_size(4)] [mtlopac(64)] [texuv(256)] [teximg(256)] [data...]
///
/// The writer always outputs v0x1005, so the blob must match that layout.
fn normalize_anim_blob(blob: &[u8], file_version: u32) -> Vec<u8> {
    if file_version >= EXP_OBJ_VERSION_1_0_0_5 || blob.is_empty() {
        return blob.to_vec();
    }

    // For v0: skip the old_version prefix (4 bytes)
    let skip = if file_version == EXP_OBJ_VERSION_0_0_0_0 { 4 } else { 0 };
    if blob.len() < skip + 8 {
        return blob.to_vec(); // Too short to normalize
    }

    let src = &blob[skip..];
    // Insert 64 zero bytes (mtlopac_size[16]) after data_bone_size(4) + data_mat_size(4)
    let mut result = Vec::with_capacity(src.len() + 64);
    result.extend_from_slice(&src[..8]); // data_bone_size + data_mat_size
    result.extend(std::iter::repeat(0u8).take(64)); // mtlopac_size[16] = all zeros
    result.extend_from_slice(&src[8..]); // rest: texuv + teximg + data
    result
}

// ============================================================================
// Geometry object parsing
// ============================================================================

fn read_geom_object(data: &[u8], addr: usize, size: usize, file_version: u32, parse_animations: bool) -> Result<LmoGeomObject> {
    if addr + size > data.len() {
        return Err(anyhow!("Geometry object at offset {} exceeds file size", addr));
    }

    let chunk = &data[addr..addr + size];
    let mut cursor = Cursor::new(chunk);

    // For version 0, skip the extra old_version DWORD prefix
    let header_prefix = if file_version == EXP_OBJ_VERSION_0_0_0_0 {
        let _old_version = read_u32(&mut cursor)?;
        4usize
    } else {
        0usize
    };

    // Header: 116 bytes (lwGeomObjInfoHeader)
    let id = read_u32(&mut cursor)?;
    let parent_id = read_u32(&mut cursor)?;
    let obj_type = read_u32(&mut cursor)?;
    let mat_local = read_mat44(&mut cursor)?;

    // rcci: lwRenderCtrlCreateInfo — 4 DWORDs = 16 bytes (store for round-trip)
    let mut rcci = [0u8; 16];
    cursor.read_exact(&mut rcci)?;

    // state_ctrl: lwStateCtrl — BYTE[8] = 8 bytes (store for round-trip)
    let mut state_ctrl = [0u8; 8];
    cursor.read_exact(&mut state_ctrl)?;

    let mtl_size = read_u32(&mut cursor)? as usize;
    let mesh_size = read_u32(&mut cursor)? as usize;
    let helper_size = read_u32(&mut cursor)? as usize;
    let anim_size = read_u32(&mut cursor)? as usize;

    // Compute section offsets within the chunk using sizes (for fallback positioning)
    let header_size = header_prefix + 116;
    let mesh_offset = (header_size + mtl_size) as u64;
    let helper_offset = (header_size + mtl_size + mesh_size) as u64;
    let anim_offset = (header_size + mtl_size + mesh_size + helper_size) as u64;

    // Materials — try to parse; failures are non-fatal
    let mut materials = Vec::new();
    let mut mtl_format_version = MtlFormatVersion::Current;
    if mtl_size > 0 {
        let parse_result = (|| -> Result<(Vec<LmoMaterial>, MtlFormatVersion)> {
            let mtl_ver = if file_version == EXP_OBJ_VERSION_0_0_0_0 {
                let mtl_old_version = read_u32(&mut cursor)?;
                match mtl_old_version {
                    0 => MtlFormatVersion::V0000,
                    1 => MtlFormatVersion::V0001,
                    _ => MtlFormatVersion::Current,
                }
            } else {
                MtlFormatVersion::Current
            };

            let mtl_num = read_u32(&mut cursor)? as usize;
            let mut mats = Vec::with_capacity(mtl_num);
            for _ in 0..mtl_num {
                mats.push(read_material(&mut cursor, mtl_ver)?);
            }
            Ok((mats, mtl_ver))
        })();

        if let Ok((mats, ver)) = parse_result {
            materials = mats;
            mtl_format_version = ver;
        }
    }

    // Always jump to mesh section using size-based offset
    cursor.set_position(mesh_offset);

    // Mesh — store all header fields
    let mut fvf = 0u32;
    let mut pt_type = 4u32; // TRIANGLELIST default
    let mut bone_infl_factor = 0u32;
    let mut vertex_element_num = 0u32;
    let mut vertex_elements_blob = Vec::new();
    let mut mesh_rs_set = vec![RenderStateAtom::default(); LW_MESH_RS_NUM];
    let mut vertices = Vec::new();
    let mut normals = Vec::new();
    let mut texcoords = Vec::new();
    let mut vertex_colors = Vec::new();
    let mut indices = Vec::new();
    let mut subsets = Vec::new();

    if mesh_size > 0 {
        match read_mesh(&mut cursor, file_version) {
            Ok(md) => {
                fvf = md.fvf;
                pt_type = md.pt_type;
                bone_infl_factor = md.bone_infl_factor;
                vertex_element_num = md.vertex_element_num;
                vertex_elements_blob = md.vertex_elements_blob;
                mesh_rs_set = md.mesh_rs_set;
                vertices = md.vertices;
                normals = md.normals;
                texcoords = md.texcoords;
                vertex_colors = md.vertex_colors;
                indices = md.indices;
                subsets = md.subsets;
            }
            Err(e) => {
                eprintln!("Warning: failed to read mesh: {}", e);
            }
        }
    }

    // Helper section — store as raw byte blob for round-trip
    let helper_blob = if helper_size > 0 {
        cursor.set_position(helper_offset);
        let mut blob = vec![0u8; helper_size];
        cursor.read_exact(&mut blob)?;
        blob
    } else {
        Vec::new()
    };

    // Animation section — store normalized raw blob AND decomposed data
    // The blob is normalized to v0x1005 format so the writer can always output v0x1005.
    let raw_anim_blob;
    let animation;
    if anim_size > 0 {
        cursor.set_position(anim_offset);
        let mut blob = vec![0u8; anim_size];
        cursor.read_exact(&mut blob)?;
        raw_anim_blob = normalize_anim_blob(&blob, file_version);

        if parse_animations {
            // Re-parse for decomposed translation/rotation (for glTF visualization)
            // Use the normalized blob with v0x1005 format
            let normalized_size = raw_anim_blob.len();
            let mut anim_cursor = Cursor::new(raw_anim_blob.as_slice());
            animation = match read_animation(&mut anim_cursor, normalized_size, EXP_OBJ_VERSION_1_0_0_5) {
                Ok(anim) => anim,
                Err(e) => {
                    eprintln!("Warning: failed to read animation: {}", e);
                    None
                }
            };
        } else {
            animation = None;
        }
    } else {
        raw_anim_blob = Vec::new();
        animation = None;
    };

    Ok(LmoGeomObject {
        id,
        parent_id,
        obj_type,
        mat_local,
        rcci,
        state_ctrl,
        fvf,
        pt_type,
        bone_infl_factor,
        vertex_element_num,
        vertex_elements_blob,
        mesh_rs_set,
        vertices,
        normals,
        texcoords,
        vertex_colors,
        indices,
        subsets,
        materials,
        helper_blob,
        raw_anim_blob,
        animation,
        mtl_format_version,
    })
}

// ============================================================================
// Top-level LMO parser
// ============================================================================

/// Parse an LMO file from raw bytes (with animation data).
pub fn parse_lmo(data: &[u8]) -> Result<LmoModel> {
    parse_lmo_opts(data, true)
}

/// Parse an LMO file from raw bytes, optionally skipping animation parsing.
fn parse_lmo_opts(data: &[u8], parse_animations: bool) -> Result<LmoModel> {
    if data.len() < 8 {
        return Err(anyhow!("LMO file too small ({} bytes)", data.len()));
    }

    let mut cursor = Cursor::new(data);

    let version = read_u32(&mut cursor)?;
    let obj_num = read_u32(&mut cursor)? as usize;

    // Read header table: type(4) + addr(4) + size(4) per entry
    let mut headers = Vec::with_capacity(obj_num);
    for _ in 0..obj_num {
        let obj_type = read_u32(&mut cursor)?;
        let addr = read_u32(&mut cursor)? as usize;
        let size = read_u32(&mut cursor)? as usize;
        headers.push((obj_type, addr, size));
    }

    // Parse geometry objects (type 1), store non-geometry entries as raw blobs
    let mut geom_objects = Vec::new();
    let mut non_geom_entries = Vec::new();
    for (obj_type, addr, size) in &headers {
        if *obj_type == OBJ_TYPE_GEOMETRY {
            match read_geom_object(data, *addr, *size, version, parse_animations) {
                Ok(geom) => geom_objects.push(geom),
                Err(e) => {
                    eprintln!("Warning: failed to read geometry object at offset {}: {}", addr, e);
                }
            }
        } else {
            // Non-geometry entry (e.g., global helper type=2) — store raw bytes
            let end = (*addr + *size).min(data.len());
            let blob = if *addr < data.len() {
                data[*addr..end].to_vec()
            } else {
                Vec::new()
            };
            non_geom_entries.push(NonGeomEntry {
                obj_type: *obj_type,
                data: blob,
            });
        }
    }

    Ok(LmoModel {
        version,
        geom_objects,
        non_geom_entries,
    })
}

/// Load and parse an LMO file from disk (with animation data).
pub fn load_lmo(path: &Path) -> Result<LmoModel> {
    let data = std::fs::read(path)?;
    parse_lmo(&data)
}

/// Load and parse an LMO file from disk, skipping animation data.
/// Use this for batch loading (maps) where animation isn't needed.
pub fn load_lmo_no_animation(path: &Path) -> Result<LmoModel> {
    let data = std::fs::read(path)?;
    parse_lmo_opts(&data, false)
}

#[cfg(test)]
mod tests {
    use super::*;

    // ====================================================================
    // Helpers for building synthetic LMO binary data
    // ====================================================================

    fn push_u32(buf: &mut Vec<u8>, v: u32) {
        buf.extend_from_slice(&v.to_le_bytes());
    }

    fn push_f32(buf: &mut Vec<u8>, v: f32) {
        buf.extend_from_slice(&v.to_le_bytes());
    }

    fn push_zeros(buf: &mut Vec<u8>, n: usize) {
        buf.extend(std::iter::repeat(0u8).take(n));
    }

    /// Write an identity 4×4 matrix (64 bytes).
    fn push_identity_mat44(buf: &mut Vec<u8>) {
        for r in 0..4u32 {
            for c in 0..4u32 {
                push_f32(buf, if r == c { 1.0 } else { 0.0 });
            }
        }
    }

    /// Write a material (opacity + transp_type + CharMaterial + rs_set[8] + tex_seq[4]).
    fn push_material(buf: &mut Vec<u8>, diffuse: [f32; 4], opacity: f32, tex: &str) {
        push_f32(buf, opacity);          // opacity
        push_u32(buf, 0);                // transp_type
        // CharMaterial: diffuse(16) + ambient(16) + specular(16) + emissive(16) + power(4) = 68
        for &c in &diffuse { push_f32(buf, c); }   // diffuse
        push_f32(buf, 0.3); push_f32(buf, 0.3); push_f32(buf, 0.3); push_f32(buf, 1.0); // ambient
        push_zeros(buf, 16);             // specular
        push_zeros(buf, 16);             // emissive
        push_f32(buf, 0.0);             // power
        // rs_set: 8 × RenderStateAtom (12 bytes)
        push_zeros(buf, 8 * 12);
        // tex_seq: 4 × TextureInfo
        for i in 0..4 {
            push_u32(buf, 0); // stage
            push_u32(buf, 0); // level
            push_u32(buf, 0); // usage
            push_u32(buf, 0); // d3d_format
            push_u32(buf, 0); // d3d_pool
            push_u32(buf, 0); // byte_alignment_flag
            push_u32(buf, 0); // _type
            push_u32(buf, 0); // width
            push_u32(buf, 0); // height
            push_u32(buf, 0); // colorkey_type
            push_u32(buf, 0); // colorkey
            // file_name[64]
            let mut fname_buf = [0u8; 64];
            if i == 0 {
                let bytes = tex.as_bytes();
                let len = bytes.len().min(63);
                fname_buf[..len].copy_from_slice(&bytes[..len]);
            }
            buf.extend_from_slice(&fname_buf);
            push_u32(buf, 0); // data
            // tss_set: 8 × RenderStateAtom
            push_zeros(buf, 8 * 12);
        }
    }

    /// Total byte size of one material entry.
    /// opacity(4) + transp_type(4) + CharMaterial(68) + rs_set(8×12=96) +
    /// 4 × TextureInfo(11×4 + fname(64) + data(4) + tss_set(8×12=96) = 208) = 1004
    fn material_entry_size() -> usize {
        4 + 4 + 68 + 8 * 12 + 4 * (11 * 4 + 64 + 4 + 8 * 12)
    }

    /// Build a geometry object blob (everything after the container header table).
    /// Creates a triangle with 3 vertices, normals, 1 material, 1 subset.
    fn build_geom_blob(id: u32, fvf: u32) -> Vec<u8> {
        let has_normals = (fvf & D3DFVF_NORMAL) != 0;
        let tex_count = ((fvf & D3DFVF_TEXCOUNT_MASK) >> D3DFVF_TEXCOUNT_SHIFT) as usize;
        let has_colors = (fvf & D3DFVF_DIFFUSE) != 0;

        let vertex_num: u32 = 3;
        let index_num: u32 = 3;
        let subset_num: u32 = 1;

        // Pre-compute section sizes
        let mtl_num: u32 = 1;
        let mtl_size = 4 + mtl_num as usize * material_entry_size();
        let mesh_header_size = 32 + LW_MESH_RS_NUM * 12;
        let mesh_data_size = (vertex_num as usize * 12) // positions
            + if has_normals { vertex_num as usize * 12 } else { 0 }
            + tex_count * vertex_num as usize * 8
            + if has_colors { vertex_num as usize * 4 } else { 0 }
            + index_num as usize * 4 // u32 indices
            + subset_num as usize * 16;
        let mesh_size = mesh_header_size + mesh_data_size;

        let mut geom = Vec::new();

        // Geometry header (116 bytes)
        push_u32(&mut geom, id);          // id
        push_u32(&mut geom, 0xFFFFFFFF);  // parent_id
        push_u32(&mut geom, 0);           // type
        push_identity_mat44(&mut geom);   // mat_local (64 bytes)
        push_zeros(&mut geom, 16);        // rcci
        push_zeros(&mut geom, 8);         // state_ctrl
        push_u32(&mut geom, mtl_size as u32);
        push_u32(&mut geom, mesh_size as u32);
        push_u32(&mut geom, 0);           // helper_size
        push_u32(&mut geom, 0);           // anim_size

        // Materials
        push_u32(&mut geom, mtl_num);
        push_material(&mut geom, [0.8, 0.2, 0.1, 1.0], 1.0, "wall.bmp");

        // Mesh header
        push_u32(&mut geom, fvf);
        push_u32(&mut geom, 4); // pt_type = TRIANGLELIST
        push_u32(&mut geom, vertex_num);
        push_u32(&mut geom, index_num);
        push_u32(&mut geom, subset_num);
        push_u32(&mut geom, 0); // bone_index_num
        push_u32(&mut geom, 0); // bone_infl_factor
        push_u32(&mut geom, 0); // vertex_element_num
        push_zeros(&mut geom, LW_MESH_RS_NUM * 12); // rs_set

        // Vertex positions: a simple triangle
        push_f32(&mut geom, 0.0); push_f32(&mut geom, 0.0); push_f32(&mut geom, 0.0);
        push_f32(&mut geom, 1.0); push_f32(&mut geom, 0.0); push_f32(&mut geom, 0.0);
        push_f32(&mut geom, 0.0); push_f32(&mut geom, 1.0); push_f32(&mut geom, 0.0);

        // Normals
        if has_normals {
            for _ in 0..vertex_num {
                push_f32(&mut geom, 0.0); push_f32(&mut geom, 0.0); push_f32(&mut geom, 1.0);
            }
        }

        // Texcoords
        for _ in 0..tex_count {
            push_f32(&mut geom, 0.0); push_f32(&mut geom, 0.0);
            push_f32(&mut geom, 1.0); push_f32(&mut geom, 0.0);
            push_f32(&mut geom, 0.0); push_f32(&mut geom, 1.0);
        }

        // Vertex colors
        if has_colors {
            for _ in 0..vertex_num {
                push_u32(&mut geom, 0xFFFF0000); // red
            }
        }

        // Indices (u32)
        push_u32(&mut geom, 0);
        push_u32(&mut geom, 1);
        push_u32(&mut geom, 2);

        // Subsets
        push_u32(&mut geom, 1);  // primitive_num (1 triangle)
        push_u32(&mut geom, 0);  // start_index
        push_u32(&mut geom, 3);  // vertex_num
        push_u32(&mut geom, 0);  // min_index

        geom
    }

    /// Build a complete LMO binary with one geometry object.
    fn build_single_geom_lmo(fvf: u32) -> Vec<u8> {
        let geom_blob = build_geom_blob(42, fvf);

        // File header: version(4) + obj_num(4) + header_table(1 × 12) + geom_blob
        let header_size = 4 + 4 + 12;
        let geom_addr = header_size;
        let geom_size = geom_blob.len();

        let mut data = Vec::new();
        push_u32(&mut data, 0x1005); // version
        push_u32(&mut data, 1);      // obj_num
        // Header table entry
        push_u32(&mut data, OBJ_TYPE_GEOMETRY);
        push_u32(&mut data, geom_addr as u32);
        push_u32(&mut data, geom_size as u32);
        data.extend_from_slice(&geom_blob);

        data
    }

    // ====================================================================
    // Parser tests
    // ====================================================================

    #[test]
    fn parse_lmo_too_small() {
        assert!(parse_lmo(&[0, 0, 0]).is_err());
    }

    #[test]
    fn parse_lmo_empty_objects() {
        let mut data = Vec::new();
        push_u32(&mut data, 0x1005);
        push_u32(&mut data, 0);
        let model = parse_lmo(&data).unwrap();
        assert_eq!(model.version, 0x1005);
        assert!(model.geom_objects.is_empty());
    }

    #[test]
    fn parse_lmo_skips_helper_objects() {
        // One helper (type 2) with some dummy data — should be skipped
        let dummy_blob = vec![0u8; 64];
        let header_size = 4 + 4 + 12;

        let mut data = Vec::new();
        push_u32(&mut data, 0x1005);
        push_u32(&mut data, 1);
        push_u32(&mut data, 2); // type = HELPER
        push_u32(&mut data, header_size as u32);
        push_u32(&mut data, dummy_blob.len() as u32);
        data.extend_from_slice(&dummy_blob);

        let model = parse_lmo(&data).unwrap();
        assert!(model.geom_objects.is_empty(), "helpers should be skipped");
    }

    #[test]
    fn parse_single_geom_positions_only() {
        // FVF with just positions (0x002 = D3DFVF_XYZ, no normals, no tex, no colors)
        let fvf = 0x002;
        let data = build_single_geom_lmo(fvf);
        let model = parse_lmo(&data).unwrap();

        assert_eq!(model.version, 0x1005);
        assert_eq!(model.geom_objects.len(), 1);

        let geom = &model.geom_objects[0];
        assert_eq!(geom.id, 42);
        assert_eq!(geom.vertices.len(), 3);
        assert!(geom.normals.is_empty());
        assert!(geom.texcoords.is_empty());
        assert!(geom.vertex_colors.is_empty());
        assert_eq!(geom.indices.len(), 3);
        assert_eq!(geom.subsets.len(), 1);
        assert_eq!(geom.materials.len(), 1);

        // Verify vertex positions
        assert_eq!(geom.vertices[0], [0.0, 0.0, 0.0]);
        assert_eq!(geom.vertices[1], [1.0, 0.0, 0.0]);
        assert_eq!(geom.vertices[2], [0.0, 1.0, 0.0]);

        // Verify indices
        assert_eq!(geom.indices, vec![0, 1, 2]);

        // Verify subset
        assert_eq!(geom.subsets[0].primitive_num, 1);
        assert_eq!(geom.subsets[0].start_index, 0);

        // Verify material
        let mat = &geom.materials[0];
        assert!((mat.opacity - 1.0).abs() < f32::EPSILON);
        assert!((mat.diffuse[0] - 0.8).abs() < 0.01);
        assert_eq!(mat.tex_filename.as_deref(), Some("wall.bmp"));
    }

    #[test]
    fn parse_single_geom_with_normals_and_texcoords() {
        // D3DFVF_XYZ | D3DFVF_NORMAL | D3DFVF_TEX1
        let fvf = 0x002 | D3DFVF_NORMAL | 0x100;
        let data = build_single_geom_lmo(fvf);
        let model = parse_lmo(&data).unwrap();

        let geom = &model.geom_objects[0];
        assert_eq!(geom.vertices.len(), 3);
        assert_eq!(geom.normals.len(), 3);
        assert_eq!(geom.texcoords.len(), 3);
        assert!(geom.vertex_colors.is_empty());

        // Normals should all be (0,0,1)
        for n in &geom.normals {
            assert_eq!(*n, [0.0, 0.0, 1.0]);
        }
    }

    #[test]
    fn parse_single_geom_with_vertex_colors() {
        // D3DFVF_XYZ | D3DFVF_DIFFUSE
        let fvf = 0x002 | D3DFVF_DIFFUSE;
        let data = build_single_geom_lmo(fvf);
        let model = parse_lmo(&data).unwrap();

        let geom = &model.geom_objects[0];
        assert_eq!(geom.vertex_colors.len(), 3);
        for &c in &geom.vertex_colors {
            assert_eq!(c, 0xFFFF0000);
        }
    }

    #[test]
    fn parse_single_geom_full_fvf() {
        // D3DFVF_XYZ | D3DFVF_NORMAL | D3DFVF_DIFFUSE | D3DFVF_TEX1
        let fvf = 0x002 | D3DFVF_NORMAL | D3DFVF_DIFFUSE | 0x100;
        let data = build_single_geom_lmo(fvf);
        let model = parse_lmo(&data).unwrap();

        let geom = &model.geom_objects[0];
        assert_eq!(geom.vertices.len(), 3);
        assert_eq!(geom.normals.len(), 3);
        assert_eq!(geom.texcoords.len(), 3);
        assert_eq!(geom.vertex_colors.len(), 3);
        assert_eq!(geom.indices.len(), 3);
        assert_eq!(geom.subsets.len(), 1);
    }

    #[test]
    fn parse_identity_mat_local() {
        let fvf = 0x002;
        let data = build_single_geom_lmo(fvf);
        let model = parse_lmo(&data).unwrap();

        let geom = &model.geom_objects[0];
        // mat_local should be identity
        for r in 0..4 {
            for c in 0..4 {
                let expected = if r == c { 1.0 } else { 0.0 };
                assert!(
                    (geom.mat_local[r][c] - expected).abs() < 1e-6,
                    "mat_local[{}][{}] = {}, expected {}",
                    r, c, geom.mat_local[r][c], expected
                );
            }
        }
    }

    #[test]
    fn parse_multiple_geom_objects() {
        let geom1 = build_geom_blob(1, 0x002 | D3DFVF_NORMAL);
        let geom2 = build_geom_blob(2, 0x002);

        // File header: version + obj_num + 2 header entries + 2 geom blobs
        let header_size = 4 + 4 + 2 * 12;
        let addr1 = header_size;
        let addr2 = addr1 + geom1.len();

        let mut data = Vec::new();
        push_u32(&mut data, 0x1005);
        push_u32(&mut data, 2);
        // Entry 1
        push_u32(&mut data, OBJ_TYPE_GEOMETRY);
        push_u32(&mut data, addr1 as u32);
        push_u32(&mut data, geom1.len() as u32);
        // Entry 2
        push_u32(&mut data, OBJ_TYPE_GEOMETRY);
        push_u32(&mut data, addr2 as u32);
        push_u32(&mut data, geom2.len() as u32);
        data.extend_from_slice(&geom1);
        data.extend_from_slice(&geom2);

        let model = parse_lmo(&data).unwrap();
        assert_eq!(model.geom_objects.len(), 2);
        assert_eq!(model.geom_objects[0].id, 1);
        assert_eq!(model.geom_objects[1].id, 2);
        assert_eq!(model.geom_objects[0].normals.len(), 3); // has normals
        assert!(model.geom_objects[1].normals.is_empty()); // no normals
    }

    #[test]
    fn parse_mixed_geom_and_helper() {
        let geom_blob = build_geom_blob(10, 0x002);
        let helper_blob = vec![0u8; 64];

        let header_size = 4 + 4 + 2 * 12;
        let geom_addr = header_size;
        let helper_addr = geom_addr + geom_blob.len();

        let mut data = Vec::new();
        push_u32(&mut data, 0x1005);
        push_u32(&mut data, 2);
        // Geometry entry
        push_u32(&mut data, OBJ_TYPE_GEOMETRY);
        push_u32(&mut data, geom_addr as u32);
        push_u32(&mut data, geom_blob.len() as u32);
        // Helper entry
        push_u32(&mut data, 2); // OBJ_TYPE_HELPER
        push_u32(&mut data, helper_addr as u32);
        push_u32(&mut data, helper_blob.len() as u32);
        data.extend_from_slice(&geom_blob);
        data.extend_from_slice(&helper_blob);

        let model = parse_lmo(&data).unwrap();
        assert_eq!(model.geom_objects.len(), 1, "helper should be skipped");
        assert_eq!(model.geom_objects[0].id, 10);
    }

    // ====================================================================
    // Real-data test (skipped if top-client not present)
    // ====================================================================

    #[test]
    fn parse_real_lmo() {
        // LMO files live in model/scene/ in the PKO client
        let scene_dir = std::path::Path::new("../top-client/model/scene");
        let model_dir = std::path::Path::new("../top-client/model");
        let search_dir = if scene_dir.exists() {
            scene_dir
        } else if model_dir.exists() {
            model_dir
        } else {
            return;
        };

        let lmo_file = std::fs::read_dir(search_dir)
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

        eprintln!("Testing with: {}", lmo_path.display());
        let model = load_lmo(&lmo_path).unwrap();
        eprintln!(
            "  version=0x{:04x}, {} geometry objects",
            model.version,
            model.geom_objects.len()
        );

        assert!(!model.geom_objects.is_empty(), "real LMO should have geometry");

        for (i, geom) in model.geom_objects.iter().enumerate() {
            assert!(!geom.vertices.is_empty(), "geom[{}] should have vertices", i);
            assert!(!geom.indices.is_empty(), "geom[{}] should have indices", i);
            eprintln!(
                "  geom[{}]: id={}, verts={}, indices={}, mats={}, subsets={}",
                i, geom.id, geom.vertices.len(), geom.indices.len(),
                geom.materials.len(), geom.subsets.len()
            );
        }
    }

    #[test]
    fn parse_version0_lmo() {
        // lt-bd025-01.lmo is a version-0 file
        let path = std::path::Path::new("../top-client/model/scene/lt-bd025-01.lmo");
        if !path.exists() {
            return;
        }

        let model = load_lmo(path).unwrap();
        eprintln!(
            "version-0 test: version=0x{:04x}, {} geometry objects",
            model.version,
            model.geom_objects.len()
        );
        assert_eq!(model.version, 0, "should be version 0");
        assert!(
            !model.geom_objects.is_empty(),
            "version-0 LMO should have geometry"
        );

        for (i, geom) in model.geom_objects.iter().enumerate() {
            assert!(!geom.vertices.is_empty(), "geom[{}] should have vertices", i);
            assert!(!geom.indices.is_empty(), "geom[{}] should have indices", i);
            eprintln!(
                "  geom[{}]: id={}, verts={}, indices={}, mats={}, subsets={}",
                i, geom.id, geom.vertices.len(), geom.indices.len(),
                geom.materials.len(), geom.subsets.len()
            );

            // Verify materials have texture filenames (old format should parse correctly)
            for (j, mat) in geom.materials.iter().enumerate() {
                eprintln!(
                    "    mat[{}]: opacity={:.2}, tex={:?}",
                    j, mat.opacity, mat.tex_filename
                );
                assert!(
                    mat.tex_filename.is_some(),
                    "geom[{}].mat[{}] should have a texture filename",
                    i, j
                );
            }
        }
    }

    // ====================================================================
    // Animation parsing tests
    // ====================================================================

    /// Build a geometry blob WITH animation data (version 0x1005 format).
    fn build_geom_blob_with_animation(id: u32, frame_num: u32) -> Vec<u8> {
        let fvf = 0x002u32; // positions only
        let vertex_num: u32 = 3;
        let index_num: u32 = 3;
        let subset_num: u32 = 1;

        let mtl_num: u32 = 1;
        let mtl_size = 4 + mtl_num as usize * material_entry_size();
        let mesh_header_size = 32 + LW_MESH_RS_NUM * 12;
        let mesh_data_size = vertex_num as usize * 12 + index_num as usize * 4 + subset_num as usize * 16;
        let mesh_size = mesh_header_size + mesh_data_size;

        // Animation size: header table + data
        // Version 0x1005 header: data_bone_size(4) + data_mat_size(4) + mtlopac[16](64)
        //   + texuv[64](256) + teximg[64](256) = 584
        let anim_header_size = 4 + 4 + 16 * 4 + 64 * 4 + 64 * 4;
        // Matrix data: frame_num(4) + frame_num * 48 bytes (12 floats)
        let anim_data_size = 4 + frame_num as usize * 48;
        let anim_size = anim_header_size + anim_data_size;

        let mut geom = Vec::new();

        // Geometry header (116 bytes)
        push_u32(&mut geom, id);
        push_u32(&mut geom, 0xFFFFFFFF);
        push_u32(&mut geom, 0);
        push_identity_mat44(&mut geom);
        push_zeros(&mut geom, 16); // rcci
        push_zeros(&mut geom, 8);  // state_ctrl
        push_u32(&mut geom, mtl_size as u32);
        push_u32(&mut geom, mesh_size as u32);
        push_u32(&mut geom, 0); // helper_size
        push_u32(&mut geom, anim_size as u32);

        // Materials
        push_u32(&mut geom, mtl_num);
        push_material(&mut geom, [0.8, 0.2, 0.1, 1.0], 1.0, "wall.bmp");

        // Mesh
        push_u32(&mut geom, fvf);
        push_u32(&mut geom, 4);
        push_u32(&mut geom, vertex_num);
        push_u32(&mut geom, index_num);
        push_u32(&mut geom, subset_num);
        push_u32(&mut geom, 0); // bone_index_num
        push_u32(&mut geom, 0); // bone_infl_factor
        push_u32(&mut geom, 0); // vertex_element_num
        push_zeros(&mut geom, LW_MESH_RS_NUM * 12);
        // Vertices
        push_f32(&mut geom, 0.0); push_f32(&mut geom, 0.0); push_f32(&mut geom, 0.0);
        push_f32(&mut geom, 1.0); push_f32(&mut geom, 0.0); push_f32(&mut geom, 0.0);
        push_f32(&mut geom, 0.0); push_f32(&mut geom, 1.0); push_f32(&mut geom, 0.0);
        // Indices
        push_u32(&mut geom, 0); push_u32(&mut geom, 1); push_u32(&mut geom, 2);
        // Subset
        push_u32(&mut geom, 1); push_u32(&mut geom, 0);
        push_u32(&mut geom, 3); push_u32(&mut geom, 0);

        // Animation section (version 0x1005 header)
        push_u32(&mut geom, 0); // data_bone_size
        let mat_data_size = 4 + frame_num as u32 * 48;
        push_u32(&mut geom, mat_data_size); // data_mat_size
        push_zeros(&mut geom, 16 * 4); // mtlopac_size[16]
        push_zeros(&mut geom, 64 * 4); // texuv_size[16][4]
        push_zeros(&mut geom, 64 * 4); // teximg_size[16][4]

        // Matrix animation data
        push_u32(&mut geom, frame_num);
        for f in 0..frame_num {
            // Identity rotation + translation that changes per frame
            // Column 0 (basis X): [1, 0, 0]
            push_f32(&mut geom, 1.0); push_f32(&mut geom, 0.0); push_f32(&mut geom, 0.0);
            // Column 1 (basis Y): [0, 1, 0]
            push_f32(&mut geom, 0.0); push_f32(&mut geom, 1.0); push_f32(&mut geom, 0.0);
            // Column 2 (basis Z): [0, 0, 1]
            push_f32(&mut geom, 0.0); push_f32(&mut geom, 0.0); push_f32(&mut geom, 1.0);
            // Translation: (f, 0, 0)
            push_f32(&mut geom, f as f32); push_f32(&mut geom, 0.0); push_f32(&mut geom, 0.0);
        }

        geom
    }

    #[test]
    fn parse_geom_with_animation() {
        let geom_blob = build_geom_blob_with_animation(5, 10);
        let header_size = 4 + 4 + 12;

        let mut data = Vec::new();
        push_u32(&mut data, 0x1005);
        push_u32(&mut data, 1);
        push_u32(&mut data, OBJ_TYPE_GEOMETRY);
        push_u32(&mut data, header_size as u32);
        push_u32(&mut data, geom_blob.len() as u32);
        data.extend_from_slice(&geom_blob);

        let model = parse_lmo(&data).unwrap();
        assert_eq!(model.geom_objects.len(), 1);

        let geom = &model.geom_objects[0];
        assert_eq!(geom.id, 5);
        assert!(geom.animation.is_some(), "should have animation data");

        let anim = geom.animation.as_ref().unwrap();
        assert_eq!(anim.frame_num, 10);
        assert_eq!(anim.translations.len(), 10);
        assert_eq!(anim.rotations.len(), 10);

        // Frame 0: translation = (0, 0, 0)
        assert!((anim.translations[0][0]).abs() < 1e-5);
        // Frame 5: translation = (5, 0, 0)
        assert!((anim.translations[5][0] - 5.0).abs() < 1e-5);
        // Frame 9: translation = (9, 0, 0)
        assert!((anim.translations[9][0] - 9.0).abs() < 1e-5);

        // Rotations should be identity quaternion (0, 0, 0, 1) for all frames
        for r in &anim.rotations {
            assert!((r[0]).abs() < 1e-3, "x should be ~0, got {}", r[0]);
            assert!((r[1]).abs() < 1e-3, "y should be ~0, got {}", r[1]);
            assert!((r[2]).abs() < 1e-3, "z should be ~0, got {}", r[2]);
            assert!((r[3] - 1.0).abs() < 1e-3, "w should be ~1, got {}", r[3]);
        }
    }

    #[test]
    fn parse_geom_without_animation() {
        // Standard build_geom_blob has anim_size=0
        let data = build_single_geom_lmo(0x002);
        let model = parse_lmo(&data).unwrap();
        assert!(model.geom_objects[0].animation.is_none());
    }

    #[test]
    fn parse_animation_from_by_bd013() {
        // by-bd013.lmo is the lighthouse — object 2 (the lamp) should have animation
        let path = std::path::Path::new("../top-client/model/scene/by-bd013.lmo");
        if !path.exists() {
            return;
        }

        let model = load_lmo(path).unwrap();
        eprintln!("by-bd013: {} geometry objects", model.geom_objects.len());

        let has_animation = model.geom_objects.iter().any(|g| g.animation.is_some());
        assert!(has_animation, "lighthouse should have at least one animated object");

        for (i, geom) in model.geom_objects.iter().enumerate() {
            if let Some(ref anim) = geom.animation {
                eprintln!(
                    "  geom[{}] id={}: animation with {} frames",
                    i, geom.id, anim.frame_num
                );
                assert!(anim.frame_num > 0);
                assert_eq!(anim.translations.len(), anim.frame_num as usize);
                assert_eq!(anim.rotations.len(), anim.frame_num as usize);
            }
        }
    }

    #[test]
    fn parse_animation_from_nml_bd141() {
        // nml-bd141.lmo is the whirlpool — should have animation data
        let path = std::path::Path::new("../top-client/model/scene/nml-bd141.lmo");
        if !path.exists() {
            return;
        }

        let model = load_lmo(path).unwrap();
        eprintln!("nml-bd141: {} geometry objects", model.geom_objects.len());

        let animated_count = model.geom_objects.iter().filter(|g| g.animation.is_some()).count();
        eprintln!("  {} objects have animation", animated_count);
        assert!(animated_count > 0, "whirlpool should have animated objects");

        for (i, geom) in model.geom_objects.iter().enumerate() {
            if let Some(ref anim) = geom.animation {
                eprintln!(
                    "  geom[{}] id={}: {} frames",
                    i, geom.id, anim.frame_num
                );
                assert!(anim.frame_num > 0);
            }
        }
    }
}
