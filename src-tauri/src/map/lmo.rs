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
//!     Helpers:     (skip)
//!     Animation:   (skip)
//! ```

use std::io::{Cursor, Read as IoRead, Seek, SeekFrom};
use std::path::Path;

use anyhow::{anyhow, Result};
use cgmath::{InnerSpace, Matrix3, Matrix4, Quaternion, Vector3};

// FVF flags (matching character/mesh.rs)
const D3DFVF_NORMAL: u32 = 0x010;
const D3DFVF_DIFFUSE: u32 = 0x040;
const D3DFVF_TEXCOUNT_MASK: u32 = 0xf00;
const D3DFVF_TEXCOUNT_SHIFT: u32 = 8;
const D3DFVF_LASTBETA_UBYTE4: u32 = 0x1000;

// Object types in the header table
const OBJ_TYPE_GEOMETRY: u32 = 1;

// Version constants
const EXP_OBJ_VERSION_0_0_0_0: u32 = 0;
const EXP_OBJ_VERSION_1_0_0_4: u32 = 0x1004;

// Mesh render state atom count
const LW_MESH_RS_NUM: usize = 8;

// Material render state + texture constants
const LW_MTL_RS_NUM: usize = 8;
const LW_MAX_TEXTURESTAGE_NUM: usize = 4;
const LW_MAX_SUBSET_NUM: usize = 16;
const RENDER_STATE_ATOM_SIZE: usize = 12; // state(4) + value0(4) + value1(4)

// D3D9 render state constants used by PKO scene materials/meshes.
const D3DRS_ALPHATESTENABLE: u32 = 15;
const D3DRS_SRCBLEND: u32 = 19;
const D3DRS_DESTBLEND: u32 = 20;
const D3DRS_ALPHAREF: u32 = 24;
const D3DRS_CULLMODE: u32 = 22;
const D3DRS_ALPHAFUNC: u32 = 25;
const D3DCMP_GREATER: u32 = 5;
const LW_INVALID_INDEX: u32 = 0xFFFFFFFF;

// D3DCULL values
pub const D3DCULL_NONE: u32 = 1;
#[allow(dead_code)]
pub const D3DCULL_CCW: u32 = 2;

/// Transparency type enum matching lwMtlTexInfoTransparencyTypeEnum.
pub const TRANSP_FILTER: u32 = 0;
pub const TRANSP_ADDITIVE: u32 = 1;
pub const TRANSP_ADDITIVE1: u32 = 2; // SrcColor/One — high-brightness additive
pub const TRANSP_ADDITIVE2: u32 = 3; // SrcColor/InvSrcColor — soft/low additive
pub const TRANSP_ADDITIVE3: u32 = 4; // SrcAlpha/DestAlpha — alpha-weighted additive
pub const TRANSP_SUBTRACTIVE: u32 = 5; // Zero/InvSrcColor — darkening/shadow
// Types 6-8 fall through to ONE/ONE in engine — identical to type 1

#[derive(Debug, Clone, Copy, Default)]
struct MaterialRenderState {
    alpha_enabled: bool,
    alpha_ref: Option<u8>,
    alpha_func: Option<u32>,
    src_blend: Option<u32>,
    dest_blend: Option<u32>,
    cull_mode: Option<u32>,
}

impl MaterialRenderState {
    fn normalized_alpha_enabled(self) -> bool {
        self.alpha_enabled && self.alpha_func.map(|f| f == D3DCMP_GREATER).unwrap_or(true)
    }

    fn effective_alpha_ref(self) -> u8 {
        self.alpha_ref.unwrap_or(129)
    }
}

/// Animation data for a geometry object — decomposed from matrix keyframes.
#[derive(Debug, Clone)]
pub struct LmoAnimData {
    pub frame_num: u32,
    pub translations: Vec<[f32; 3]>, // per-frame translation (Z-up game space)
    pub rotations: Vec<[f32; 4]>,    // per-frame quaternion [x,y,z,w] (Z-up game space)
}

/// UV animation data — per-frame 4×4 texture coordinate transform matrix.
/// Stored per (subset_index, stage_index).
#[derive(Debug, Clone)]
pub struct LmoTexUvAnim {
    pub subset: usize,
    pub stage: usize,
    pub frame_num: u32,
    pub matrices: Vec<[[f32; 4]; 4]>, // per-frame 4×4 UV transform matrix
}

/// Texture image animation — frame-by-frame texture swap.
/// Stored per (subset_index, stage_index).
#[derive(Debug, Clone)]
pub struct LmoTexImgAnim {
    pub subset: usize,
    pub stage: usize,
    pub textures: Vec<String>, // texture filenames per frame
}

/// Material opacity keyframe — sparse keyed float.
#[derive(Debug, Clone)]
pub struct LmoOpacityKeyframe {
    pub frame: u32,
    pub opacity: f32,
}

/// Material opacity animation — sparse keyframes for a single subset.
#[derive(Debug, Clone)]
pub struct LmoMtlOpacAnim {
    pub subset: usize,
    pub keyframes: Vec<LmoOpacityKeyframe>,
}

/// A single geometry object within an LMO file.
#[derive(Debug, Clone)]
pub struct LmoGeomObject {
    pub id: u32,
    pub parent_id: u32,
    pub obj_type: u32,
    pub mat_local: [[f32; 4]; 4],
    pub vertices: Vec<[f32; 3]>,
    pub normals: Vec<[f32; 3]>,
    pub texcoords: Vec<[f32; 2]>,
    pub vertex_colors: Vec<u32>,
    pub indices: Vec<u32>,
    pub subsets: Vec<LmoSubset>,
    pub materials: Vec<LmoMaterial>,
    pub animation: Option<LmoAnimData>,
    pub texuv_anims: Vec<LmoTexUvAnim>,
    pub teximg_anims: Vec<LmoTexImgAnim>,
    pub mtlopac_anims: Vec<LmoMtlOpacAnim>,
}

/// A mesh subset — defines a range of indices rendered with a specific material.
#[derive(Debug, Clone)]
pub struct LmoSubset {
    pub primitive_num: u32,
    pub start_index: u32,
    pub vertex_num: u32,
    pub min_index: u32,
}

/// Material info extracted from an LMO geometry object.
#[derive(Debug, Clone)]
pub struct LmoMaterial {
    pub diffuse: [f32; 4],
    pub ambient: [f32; 4],
    pub emissive: [f32; 4],
    pub opacity: f32,
    pub transp_type: u32,
    pub alpha_test_enabled: bool,
    pub alpha_ref: u8,
    pub src_blend: Option<u32>,
    pub dest_blend: Option<u32>,
    pub cull_mode: Option<u32>,
    pub tex_filename: Option<String>,
}

/// A parsed LMO model containing multiple geometry objects.
#[derive(Debug, Clone)]
pub struct LmoModel {
    pub version: u32,
    pub geom_objects: Vec<LmoGeomObject>,
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

fn read_render_state_atoms(
    cursor: &mut Cursor<&[u8]>,
    atom_count: usize,
) -> Result<MaterialRenderState> {
    let mut rs = MaterialRenderState::default();
    for _ in 0..atom_count {
        let state = read_u32(cursor)?;
        let value0 = read_u32(cursor)?;
        let _value1 = read_u32(cursor)?;

        match state {
            D3DRS_ALPHATESTENABLE => {
                rs.alpha_enabled = value0 != 0;
            }
            D3DRS_CULLMODE => {
                rs.cull_mode = Some(value0);
            }
            D3DRS_ALPHAREF => {
                rs.alpha_ref = Some((value0 & 0xFF) as u8);
            }
            D3DRS_ALPHAFUNC => {
                rs.alpha_func = Some(value0);
            }
            D3DRS_SRCBLEND => {
                rs.src_blend = Some(value0);
            }
            D3DRS_DESTBLEND => {
                rs.dest_blend = Some(value0);
            }
            _ => {}
        }
    }
    Ok(rs)
}

/// Read render states from the old lwRenderStateSetTemplate<2, N> format (V0000/V0001).
///
/// Layout: rsv_seq[2][seq_size], where each lwRenderStateValue = state(DWORD) + value(DWORD).
/// Total bytes: 2 * seq_size * 8.
///
/// The original engine (lwExpObj.cpp) reads only set 0 and converts to lwRenderStateAtom,
/// force-overriding ALPHAREF→129 and ALPHAFUNC→D3DCMP_GREATER for backwards compatibility.
fn read_old_render_state_set(
    cursor: &mut Cursor<&[u8]>,
    seq_size: usize,
) -> Result<MaterialRenderState> {
    let mut rs = MaterialRenderState::default();

    // Read set 0 (the active render states)
    for _ in 0..seq_size {
        let state = read_u32(cursor)?;
        let value = read_u32(cursor)?;

        if state == LW_INVALID_INDEX {
            // End sentinel — continue reading remaining entries to maintain cursor position
            continue;
        }

        // Match original engine: override ALPHAREF and ALPHAFUNC for old formats
        match state {
            D3DRS_ALPHATESTENABLE => {
                rs.alpha_enabled = value != 0;
            }
            D3DRS_CULLMODE => {
                rs.cull_mode = Some(value);
            }
            D3DRS_ALPHAREF => {
                // Original engine forces 129 for old formats (lwExpObj.cpp lines 70-71, 137-138)
                rs.alpha_ref = Some(129);
            }
            D3DRS_ALPHAFUNC => {
                // Original engine forces D3DCMP_GREATER for old formats
                rs.alpha_func = Some(D3DCMP_GREATER);
            }
            D3DRS_SRCBLEND => {
                rs.src_blend = Some(value);
            }
            D3DRS_DESTBLEND => {
                rs.dest_blend = Some(value);
            }
            _ => {}
        }
    }

    // Skip set 1 (end/restore states — not used for material property extraction)
    cursor.seek(SeekFrom::Current((seq_size * 8) as i64))?;

    Ok(rs)
}

// ============================================================================
// Material parsing
// ============================================================================

/// Material format version determined from the mtl_old_version field.
#[derive(Debug, Clone, Copy, PartialEq)]
enum MtlFormatVersion {
    /// MTLTEX_VERSION0000: no opacity/transp, lwTexInfo_0000, old rs/tss (128 bytes each)
    V0000,
    /// MTLTEX_VERSION0001: has opacity/transp, lwTexInfo_0001, old rs/tss (128 bytes each)
    V0001,
    /// MTLTEX_VERSION0002+ / EXP_OBJ >= 1.0.0.0: has opacity/transp, lwTexInfo, new rs/tss (96 bytes each)
    Current,
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
        (1.0, TRANSP_FILTER)
    } else {
        let o = read_f32(cursor)?;
        let mut t = read_u32(cursor)?;
        // V0001 remap: old files only used 0/1/2. Value 2 meant "subtractive" (Zero/InvSrcColor),
        // not ADDITIVE1 (SrcColor/One). The C++ engine (lwExpObj.cpp:225-228) remaps:
        //   1 → MTLTEX_TRANSP_ADDITIVE (1, no change)
        //   2 → MTLTEX_TRANSP_SUBTRACTIVE (5)
        if mtl_ver == MtlFormatVersion::V0001 && t == 2 {
            t = TRANSP_SUBTRACTIVE;
        }
        (o, t)
    };

    // CharMaterial: dif(16) + amb(16) + spe(16) + emi(16) + power(4) = 68 bytes
    let diffuse = [
        read_f32(cursor)?,
        read_f32(cursor)?,
        read_f32(cursor)?,
        read_f32(cursor)?,
    ];
    let ambient = [
        read_f32(cursor)?,
        read_f32(cursor)?,
        read_f32(cursor)?,
        read_f32(cursor)?,
    ];
    cursor.seek(SeekFrom::Current(16))?; // specular (skip)
    let emissive = [
        read_f32(cursor)?,
        read_f32(cursor)?,
        read_f32(cursor)?,
        read_f32(cursor)?,
    ];
    cursor.seek(SeekFrom::Current(4))?; // power

    // rs_set — old formats use lwRenderStateSetMtl2 (128 bytes), new uses lwRenderStateAtom[8] (96 bytes)
    let rs = match mtl_ver {
        MtlFormatVersion::V0000 | MtlFormatVersion::V0001 => {
            // Old format: lwRenderStateSetTemplate<2, LW_MTL_RS_NUM> = lwRenderStateValue[2][8]
            // Total: 2 * 8 * 8 = 128 bytes. Extract render states from set 0, skip set 1.
            read_old_render_state_set(cursor, LW_MTL_RS_NUM)?
        }
        MtlFormatVersion::Current => read_render_state_atoms(cursor, LW_MTL_RS_NUM)?,
    };

    // tex_seq: 4 × TextureInfo — extract filename from first texture slot
    let mut tex_filename = None;
    for i in 0..LW_MAX_TEXTURESTAGE_NUM {
        match mtl_ver {
            MtlFormatVersion::V0000 => {
                // lwTexInfo_0000: stage(4) + colorkey_type(4) + colorkey(4) + format(4) +
                //                 file_name(64) + lwTextureStageStateSetTex2(128) = 208
                cursor.seek(SeekFrom::Current(16))?; // stage + colorkey_type + colorkey + format
                let fname = read_cstr_fixed(cursor, 64)?;
                cursor.seek(SeekFrom::Current(128))?; // tss_set

                if i == 0 && !fname.is_empty() {
                    tex_filename = Some(fname);
                }
            }
            MtlFormatVersion::V0001 => {
                // lwTexInfo_0001: stage(4) + level(4) + usage(4) + format(4) + pool(4) +
                //   byte_align(4) + type(4) + width(4) + height(4) + colorkey_type(4) +
                //   colorkey(4) + file_name(64) + data(4) + lwTextureStageStateSetTex2(128) = 240
                cursor.seek(SeekFrom::Current(44))?; // 11 DWORDs
                let fname = read_cstr_fixed(cursor, 64)?;
                cursor.seek(SeekFrom::Current(4 + 128))?; // data + tss_set

                if i == 0 && !fname.is_empty() {
                    tex_filename = Some(fname);
                }
            }
            MtlFormatVersion::Current => {
                // lwTexInfo: same fields as V0001 but tss_set is lwRenderStateAtom[8] (96 bytes)
                cursor.seek(SeekFrom::Current(44))?; // 11 DWORDs
                let fname = read_cstr_fixed(cursor, 64)?;
                cursor.seek(SeekFrom::Current(
                    4 + (LW_MTL_RS_NUM * RENDER_STATE_ATOM_SIZE) as i64,
                ))?; // data + tss_set

                if i == 0 && !fname.is_empty() {
                    tex_filename = Some(fname);
                }
            }
        }
    }

    Ok(LmoMaterial {
        diffuse,
        ambient,
        emissive,
        opacity,
        transp_type,
        alpha_test_enabled: rs.normalized_alpha_enabled(),
        alpha_ref: if rs.normalized_alpha_enabled() {
            rs.effective_alpha_ref()
        } else {
            rs.alpha_ref.unwrap_or(0)
        },
        src_blend: rs.src_blend,
        dest_blend: rs.dest_blend,
        cull_mode: rs.cull_mode,
        tex_filename,
    })
}

// ============================================================================
// Mesh parsing
// ============================================================================

/// Read mesh data from cursor. Returns (vertices, normals, texcoords, vertex_colors, indices, subsets).
///
/// `file_version` is the top-level LMO file version. For version 0, an extra `old_version`
/// DWORD is read first and used to determine the actual mesh format.
/// `mesh_size` is the total byte size of the mesh section (used for legacy pre-index detection).
fn read_mesh(
    cursor: &mut Cursor<&[u8]>,
    file_version: u32,
    mesh_size: usize,
) -> Result<(
    Vec<[f32; 3]>,
    Vec<[f32; 3]>,
    Vec<[f32; 2]>,
    Vec<u32>,
    Vec<u32>,
    Vec<LmoSubset>,
    MaterialRenderState,
)> {
    // Track the start of the mesh section for pre-index pair detection
    let mesh_start = cursor.position();

    // For version 0, the mesh section has an embedded old_version prefix
    let mesh_version = if file_version == EXP_OBJ_VERSION_0_0_0_0 {
        read_u32(cursor)?
    } else {
        file_version
    };

    let mut mesh_alpha = MaterialRenderState::default();

    // Read mesh header — format depends on version
    let (fvf, vertex_num, index_num, subset_num, bone_index_num, vertex_element_num);

    if mesh_version >= EXP_OBJ_VERSION_1_0_0_4 {
        // Full header: fvf + pt_type + vertex_num + index_num + subset_num +
        //              bone_index_num + bone_infl_factor + vertex_element_num + rs_set[8]
        fvf = read_u32(cursor)?;
        let _pt_type = read_u32(cursor)?;
        vertex_num = read_u32(cursor)? as usize;
        index_num = read_u32(cursor)? as usize;
        subset_num = read_u32(cursor)? as usize;
        bone_index_num = read_u32(cursor)? as usize;
        let _bone_infl_factor = read_u32(cursor)?;
        vertex_element_num = read_u32(cursor)? as usize;

        // rs_set: 8 × RenderStateAtom (12 bytes each)
        mesh_alpha = read_render_state_atoms(cursor, LW_MESH_RS_NUM)?;
    } else {
        // Older header: fvf + pt_type + vertex_num + index_num + subset_num + bone_index_num
        // No bone_infl_factor, no vertex_element_num
        fvf = read_u32(cursor)?;
        let _pt_type = read_u32(cursor)?;
        vertex_num = read_u32(cursor)? as usize;
        index_num = read_u32(cursor)? as usize;
        subset_num = read_u32(cursor)? as usize;
        bone_index_num = read_u32(cursor)? as usize;
        vertex_element_num = 0;

        if mesh_version == 0 {
            // MESH_VERSION0000: rs_set is lwRenderStateSetMesh2 = lwRenderStateValue[2][8]
            // Total: 2 * 8 * 8 = 128 bytes. Extract render states from set 0.
            mesh_alpha = read_old_render_state_set(cursor, LW_MESH_RS_NUM)?;
        } else {
            // MESH_VERSION0001 / EXP_OBJ_VERSION_1_0_0_0..3: rs_set is lwRenderStateAtom[8]
            // lwRenderStateAtom = state(4) + value0(4) + value1(4) = 12 bytes
            // Total: 8 × 12 = 96 bytes
            mesh_alpha = read_render_state_atoms(cursor, LW_MESH_RS_NUM)?;
        }
    }

    if mesh_version >= EXP_OBJ_VERSION_1_0_0_4 {
        // New format: vertex_elements, vertices, normals, texcoords, colors, blending, indices, subsets

        // D3DVertexElement9 entries (8 bytes each)
        if vertex_element_num > 0 {
            cursor.seek(SeekFrom::Current(vertex_element_num as i64 * 8))?;
        }

        // Vertex positions
        let mut vertices = Vec::with_capacity(vertex_num);
        for _ in 0..vertex_num {
            vertices.push([read_f32(cursor)?, read_f32(cursor)?, read_f32(cursor)?]);
        }

        // Normals
        let mut normals = Vec::new();
        if (fvf & D3DFVF_NORMAL) != 0 {
            normals.reserve(vertex_num);
            for _ in 0..vertex_num {
                normals.push([read_f32(cursor)?, read_f32(cursor)?, read_f32(cursor)?]);
            }
        }

        // Texture coordinates
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

        // Vertex colors
        let mut vertex_colors = Vec::new();
        if (fvf & D3DFVF_DIFFUSE) != 0 {
            vertex_colors.reserve(vertex_num);
            for _ in 0..vertex_num {
                vertex_colors.push(read_u32(cursor)?);
            }
        }

        // Skip blend/bone data if present
        if bone_index_num > 0 {
            // lwBlendInfo = { DWORD indexd (4 bytes) + float weight[4] (16 bytes) } = 20 bytes per vertex
            // + DWORD per bone_index
            cursor.seek(SeekFrom::Current(
                vertex_num as i64 * 20 + bone_index_num as i64 * 4,
            ))?;
        }

        // Indices (u32)
        let mut indices = Vec::with_capacity(index_num);
        for _ in 0..index_num {
            indices.push(read_u32(cursor)?);
        }

        // Subsets
        let mut subsets = Vec::with_capacity(subset_num);
        for _ in 0..subset_num {
            subsets.push(LmoSubset {
                primitive_num: read_u32(cursor)?,
                start_index: read_u32(cursor)?,
                vertex_num: read_u32(cursor)?,
                min_index: read_u32(cursor)?,
            });
        }

        Ok((
            vertices,
            normals,
            texcoords,
            vertex_colors,
            indices,
            subsets,
            mesh_alpha,
        ))
    } else {
        // Old format (pre-1.0.0.4): subsets FIRST, then vertices, normals, texcoords, colors, blending, indices

        // Subsets come first
        let mut subsets = Vec::with_capacity(subset_num);
        for _ in 0..subset_num {
            subsets.push(LmoSubset {
                primitive_num: read_u32(cursor)?,
                start_index: read_u32(cursor)?,
                vertex_num: read_u32(cursor)?,
                min_index: read_u32(cursor)?,
            });
        }

        // Vertex positions
        let mut vertices = Vec::with_capacity(vertex_num);
        for _ in 0..vertex_num {
            vertices.push([read_f32(cursor)?, read_f32(cursor)?, read_f32(cursor)?]);
        }

        // Normals
        let mut normals = Vec::new();
        if (fvf & D3DFVF_NORMAL) != 0 {
            normals.reserve(vertex_num);
            for _ in 0..vertex_num {
                normals.push([read_f32(cursor)?, read_f32(cursor)?, read_f32(cursor)?]);
            }
        }

        // Texture coordinates
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

        // Vertex colors
        let mut vertex_colors = Vec::new();
        if (fvf & D3DFVF_DIFFUSE) != 0 {
            vertex_colors.reserve(vertex_num);
            for _ in 0..vertex_num {
                vertex_colors.push(read_u32(cursor)?);
            }
        }

        // Skip blend/bone data if present (old format uses BYTE bone indices).
        // Gate on D3DFVF_LASTBETA_UBYTE4 flag (matching engine behavior) rather than bone_index_num.
        if (fvf & D3DFVF_LASTBETA_UBYTE4) != 0 {
            // lwBlendInfo = { DWORD indexd (4 bytes) + float weight[4] (16 bytes) } = 20 bytes per vertex
            // + BYTE per bone_index
            cursor.seek(SeekFrom::Current(
                vertex_num as i64 * 20 + bone_index_num as i64,
            ))?;
        }

        // For mesh_version 0, some files have 8 extra bytes (2 DWORDs) before the index
        // buffer — a stale artifact from an older save format. Detect by comparing
        // remaining bytes against expected index data size.
        if mesh_version == 0 && mesh_size > 0 {
            let mesh_end = mesh_start + mesh_size as u64;
            let remaining = mesh_end.saturating_sub(cursor.position()) as usize;
            let expected_index_bytes = index_num * 4;
            if remaining == expected_index_bytes + 8 {
                cursor.seek(SeekFrom::Current(8))?;
            }
        }

        // Indices (u32)
        let mut indices = Vec::with_capacity(index_num);
        for _ in 0..index_num {
            indices.push(read_u32(cursor)?);
        }

        Ok((
            vertices,
            normals,
            texcoords,
            vertex_colors,
            indices,
            subsets,
            mesh_alpha,
        ))
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
        raw[0], raw[1], raw[2], 0.0, raw[3], raw[4], raw[5], 0.0, raw[6], raw[7], raw[8], 0.0,
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

    if scale_x > 1e-8 {
        col0 /= scale_x;
    }
    if scale_y > 1e-8 {
        col1 /= scale_y;
    }
    if scale_z > 1e-8 {
        col2 /= scale_z;
    }

    let rotation_matrix = Matrix3::from_cols(col0, col1, col2);
    let q = Quaternion::from(rotation_matrix);

    // glTF quaternion order: [x, y, z, w]
    let rotation = [q.v.x, q.v.y, q.v.z, q.s];

    (translation, rotation)
}

/// All animation data parsed from a geometry object's animation section.
struct ParsedAnimations {
    matrix: Option<LmoAnimData>,
    texuv: Vec<LmoTexUvAnim>,
    teximg: Vec<LmoTexImgAnim>,
    mtlopac: Vec<LmoMtlOpacAnim>,
}

// sizeof(lwTexInfo) on 32-bit MSVC: 9 DWORDs (36) + colorkey_type(4) + colorkey(4)
// + file_name[64] + void*(4) + tss_set[8×12=96] = 208 bytes
const LW_MAX_NAME: usize = 64;
// Bytes to skip per lwTexInfo entry: 36 (pre-filename) + 8 (colorkey) = 44 before filename,
// then 100 after filename (void* + tss_set). Total = 44 + 64 + 100 = 208.

/// Read animation data from the animation section of a geometry object.
///
/// The animation section contains a size header table followed by actual data blocks:
/// bone, matrix, mtlopac[16], texuv[16][4], teximg[16][4].
fn read_animation(
    cursor: &mut Cursor<&[u8]>,
    anim_size: usize,
    file_version: u32,
) -> Result<ParsedAnimations> {
    let mut result = ParsedAnimations {
        matrix: None,
        texuv: Vec::new(),
        teximg: Vec::new(),
        mtlopac: Vec::new(),
    };

    if anim_size == 0 {
        return Ok(result);
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
    let mut mtlopac_sizes = [0usize; LW_MAX_SUBSET_NUM];
    if file_version >= 0x1005 {
        for item in &mut mtlopac_sizes {
            *item = read_u32(cursor)? as usize;
        }
    }

    // data_texuv_size[16][4]
    let mut texuv_sizes = [[0usize; LW_MAX_TEXTURESTAGE_NUM]; LW_MAX_SUBSET_NUM];
    for i in 0..LW_MAX_SUBSET_NUM {
        for j in 0..LW_MAX_TEXTURESTAGE_NUM {
            texuv_sizes[i][j] = read_u32(cursor)? as usize;
        }
    }

    // data_teximg_size[16][4]
    let mut teximg_sizes = [[0usize; LW_MAX_TEXTURESTAGE_NUM]; LW_MAX_SUBSET_NUM];
    for i in 0..LW_MAX_SUBSET_NUM {
        for j in 0..LW_MAX_TEXTURESTAGE_NUM {
            teximg_sizes[i][j] = read_u32(cursor)? as usize;
        }
    }

    // --- Data blocks (in order: bone, matrix, mtlopac[16], texuv[16][4], teximg[16][4]) ---

    // Skip bone animation data (buildings don't use skeletal animation)
    if data_bone_size > 0 {
        cursor.seek(SeekFrom::Current(data_bone_size as i64))?;
    }

    // Read matrix animation data
    if data_mat_size > 0 {
        let mat_start = cursor.position();
        let frame_num = read_u32(cursor)?;

        if frame_num > 0 && frame_num <= 100_000 {
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

            result.matrix = Some(LmoAnimData {
                frame_num,
                translations,
                rotations,
            });
        }

        // Always advance past the full mat data block
        cursor.set_position(mat_start + data_mat_size as u64);
    }

    // Read mtlopac animation data (per-subset sparse keyframes)
    if file_version >= 0x1005 {
        for (subset_idx, &size) in mtlopac_sizes.iter().enumerate() {
            if size == 0 {
                continue;
            }
            let block_start = cursor.position();
            match read_mtlopac_block(cursor, subset_idx) {
                Ok(anim) => result.mtlopac.push(anim),
                Err(e) => {
                    eprintln!(
                        "Warning: failed to read mtlopac anim subset {}: {}",
                        subset_idx, e
                    );
                }
            }
            // Always advance past the full block
            cursor.set_position(block_start + size as u64);
        }
    }

    // Read texuv animation data (per-subset, per-stage 4×4 matrix keyframes)
    for i in 0..LW_MAX_SUBSET_NUM {
        for j in 0..LW_MAX_TEXTURESTAGE_NUM {
            let size = texuv_sizes[i][j];
            if size == 0 {
                continue;
            }
            let block_start = cursor.position();
            match read_texuv_block(cursor, i, j) {
                Ok(anim) => result.texuv.push(anim),
                Err(e) => {
                    eprintln!(
                        "Warning: failed to read texuv anim [{},{}]: {}",
                        i, j, e
                    );
                }
            }
            cursor.set_position(block_start + size as u64);
        }
    }

    // Read teximg animation data (per-subset, per-stage texture filename list)
    for i in 0..LW_MAX_SUBSET_NUM {
        for j in 0..LW_MAX_TEXTURESTAGE_NUM {
            let size = teximg_sizes[i][j];
            if size == 0 {
                continue;
            }
            let block_start = cursor.position();
            match read_teximg_block(cursor, i, j) {
                Ok(anim) => result.teximg.push(anim),
                Err(e) => {
                    eprintln!(
                        "Warning: failed to read teximg anim [{},{}]: {}",
                        i, j, e
                    );
                }
            }
            cursor.set_position(block_start + size as u64);
        }
    }

    // Ensure we end at the right position
    cursor.set_position(end_pos);
    Ok(result)
}

/// Read a texuv animation block: frame_num(4) + frame_num × lwMatrix44(64).
fn read_texuv_block(
    cursor: &mut Cursor<&[u8]>,
    subset: usize,
    stage: usize,
) -> Result<LmoTexUvAnim> {
    let frame_num = read_u32(cursor)?;
    if frame_num > 100_000 {
        return Err(anyhow!("texuv frame_num {} unreasonable", frame_num));
    }

    let mut matrices = Vec::with_capacity(frame_num as usize);
    for _ in 0..frame_num {
        matrices.push(read_mat44(cursor)?);
    }

    Ok(LmoTexUvAnim {
        subset,
        stage,
        frame_num,
        matrices,
    })
}

/// Read a teximg animation block: data_num(4) + data_num × lwTexInfo(208).
/// We only extract the file_name from each lwTexInfo entry.
fn read_teximg_block(
    cursor: &mut Cursor<&[u8]>,
    subset: usize,
    stage: usize,
) -> Result<LmoTexImgAnim> {
    let data_num = read_u32(cursor)?;
    if data_num > 1000 {
        return Err(anyhow!("teximg data_num {} unreasonable", data_num));
    }

    let mut textures = Vec::with_capacity(data_num as usize);
    for _ in 0..data_num {
        // lwTexInfo layout (208 bytes total on 32-bit):
        // 9 DWORDs (36 bytes): stage, level, usage, format, pool, byte_alignment_flag, type, width, height
        cursor.seek(SeekFrom::Current(36))?;
        // colorkey_type(4) + colorkey(4) = 8 bytes
        cursor.seek(SeekFrom::Current(8))?;
        // file_name[64]
        let filename = read_cstr_fixed(cursor, LW_MAX_NAME)?;
        textures.push(filename);
        // void*(4) + tss_set[8×12=96] = 100 bytes remaining
        cursor.seek(SeekFrom::Current(100))?;
    }

    Ok(LmoTexImgAnim {
        subset,
        stage,
        textures,
    })
}

/// Read an mtlopac animation block: num(4) + num × lwKeyFloat(12).
fn read_mtlopac_block(
    cursor: &mut Cursor<&[u8]>,
    subset: usize,
) -> Result<LmoMtlOpacAnim> {
    let num = read_u32(cursor)?;
    if num > 100_000 {
        return Err(anyhow!("mtlopac keyframe count {} unreasonable", num));
    }

    let mut keyframes = Vec::with_capacity(num as usize);
    for _ in 0..num {
        let frame = read_u32(cursor)?;
        let _slerp_type = read_u32(cursor)?;
        let opacity = read_f32(cursor)?;
        keyframes.push(LmoOpacityKeyframe { frame, opacity });
    }

    Ok(LmoMtlOpacAnim { subset, keyframes })
}

// ============================================================================
// Geometry object parsing
// ============================================================================

fn read_geom_object(
    data: &[u8],
    addr: usize,
    size: usize,
    file_version: u32,
    parse_animations: bool,
) -> Result<LmoGeomObject> {
    if addr + size > data.len() {
        return Err(anyhow!(
            "Geometry object at offset {} exceeds file size",
            addr
        ));
    }

    let chunk = &data[addr..addr + size];
    let mut cursor = Cursor::new(chunk);

    // For version 0, skip the extra old_version DWORD prefix and detect header variant
    let header_prefix = if file_version == EXP_OBJ_VERSION_0_0_0_0 {
        let _old_version = read_u32(&mut cursor)?;
        4usize
    } else {
        0usize
    };

    // For v0 files, detect whether the header is legacy (92 bytes, no rcci/state_ctrl)
    // or modern (116 bytes). Probe the 4 size fields at both possible offsets and
    // check which one produces a plausible sum <= chunk payload size.
    let is_legacy_header = if file_version == EXP_OBJ_VERSION_0_0_0_0 {
        let chunk_payload_size = size - header_prefix;

        // Probe candidate size fields at both legacy (offset 76) and modern (offset 100)
        // header positions, and check which set produces a plausible total.
        // Use exact-match check: header_bytes + sum(sizes) must equal chunk_payload_size.
        // This is stricter than the .ksy's <= check and avoids false positives when
        // data bytes happen to look like small size values.

        let legacy_ok = if header_prefix + 92 <= size {
            let s = u32::from_le_bytes(chunk[header_prefix + 76..header_prefix + 80].try_into().unwrap()) as usize
                + u32::from_le_bytes(chunk[header_prefix + 80..header_prefix + 84].try_into().unwrap()) as usize
                + u32::from_le_bytes(chunk[header_prefix + 84..header_prefix + 88].try_into().unwrap()) as usize
                + u32::from_le_bytes(chunk[header_prefix + 88..header_prefix + 92].try_into().unwrap()) as usize;
            92 + s == chunk_payload_size
        } else {
            false
        };

        let modern_ok = if header_prefix + 116 <= size {
            let s = u32::from_le_bytes(chunk[header_prefix + 100..header_prefix + 104].try_into().unwrap()) as usize
                + u32::from_le_bytes(chunk[header_prefix + 104..header_prefix + 108].try_into().unwrap()) as usize
                + u32::from_le_bytes(chunk[header_prefix + 108..header_prefix + 112].try_into().unwrap()) as usize
                + u32::from_le_bytes(chunk[header_prefix + 112..header_prefix + 116].try_into().unwrap()) as usize;
            116 + s == chunk_payload_size
        } else {
            false
        };

        // Prefer modern (matches engine's sizeof(lwGeomObjInfoHeader)); fall back to legacy
        !modern_ok && legacy_ok
    } else {
        false
    };

    // Header: read common fields first
    let id = read_u32(&mut cursor)?;
    let parent_id = read_u32(&mut cursor)?;
    let obj_type = read_u32(&mut cursor)?;
    let mat_local = read_mat44(&mut cursor)?;

    if !is_legacy_header {
        // rcci: lwRenderCtrlCreateInfo — 4 DWORDs = 16 bytes
        cursor.seek(SeekFrom::Current(16))?;
        // state_ctrl: lwStateCtrl — BYTE[8] = 8 bytes
        cursor.seek(SeekFrom::Current(8))?;
    }

    let mtl_size = read_u32(&mut cursor)? as usize;
    let mesh_size = read_u32(&mut cursor)? as usize;
    let helper_size = read_u32(&mut cursor)? as usize;
    let anim_size = read_u32(&mut cursor)? as usize;

    // Compute section offsets within the chunk using sizes (for fallback positioning)
    let actual_header_bytes = if is_legacy_header { 92 } else { 116 };
    let header_size = header_prefix + actual_header_bytes; // old_version prefix (if v0) + header
    let mesh_offset = (header_size + mtl_size) as u64;
    let anim_offset = (header_size + mtl_size + mesh_size + helper_size) as u64;

    // Materials — try to parse; failures are non-fatal
    let mut materials = Vec::new();
    if mtl_size > 0 {
        let parse_result = (|| -> Result<Vec<LmoMaterial>> {
            // Determine material format version.
            // For v0, the section MAY start with a version prefix DWORD — but some
            // legacy files omit it entirely, with the first DWORD being mtl_num.
            // Detect by probing: only consume a prefix if the first DWORD is a known
            // version marker AND the second DWORD is a plausible mtl_num (≤ 65535).
            let mtl_ver = if file_version == EXP_OBJ_VERSION_0_0_0_0 {
                let probe_pos = cursor.position();
                let first = read_u32(&mut cursor)?;
                let second = read_u32(&mut cursor)?;
                cursor.set_position(probe_pos); // rewind

                let is_known_version = matches!(first, 0 | 1 | 2 | 0x1000..=0x1005);
                let has_prefix = is_known_version && second <= 65535;

                if has_prefix {
                    let mtl_old_version = read_u32(&mut cursor)?; // consume prefix
                    match mtl_old_version {
                        0 => MtlFormatVersion::V0000,
                        1 => MtlFormatVersion::V0001,
                        _ => MtlFormatVersion::Current,
                    }
                } else {
                    // No version prefix — first DWORD is mtl_num directly.
                    // These legacy files use Current-format material entries.
                    MtlFormatVersion::Current
                }
            } else {
                MtlFormatVersion::Current
            };

            let mtl_num = read_u32(&mut cursor)? as usize;
            let mut mats = Vec::with_capacity(mtl_num);
            for _ in 0..mtl_num {
                mats.push(read_material(&mut cursor, mtl_ver)?);
            }
            Ok(mats)
        })();

        if let Ok(mats) = parse_result {
            materials = mats;
        }
    }

    // Always jump to mesh section using size-based offset — material parsing may
    // have consumed wrong number of bytes for old format materials
    cursor.set_position(mesh_offset);

    // Mesh
    let mut vertices = Vec::new();
    let mut normals = Vec::new();
    let mut texcoords = Vec::new();
    let mut vertex_colors = Vec::new();
    let mut indices = Vec::new();
    let mut subsets = Vec::new();
    let mut mesh_alpha = MaterialRenderState::default();

    if mesh_size > 0 {
        match read_mesh(&mut cursor, file_version, mesh_size) {
            Ok((v, n, t, c, i, s, alpha)) => {
                vertices = v;
                normals = n;
                texcoords = t;
                vertex_colors = c;
                indices = i;
                subsets = s;
                mesh_alpha = alpha;
            }
            Err(e) => {
                eprintln!("Warning: failed to read mesh: {}", e);
            }
        }
    }

    // Some LMO files store alpha test states at mesh-level rs_set rather than
    // material rs_set. Promote mesh-level state to all materials when needed.
    if mesh_alpha.normalized_alpha_enabled() {
        let mesh_alpha_ref = mesh_alpha.effective_alpha_ref();
        for mat in &mut materials {
            if !mat.alpha_test_enabled {
                mat.alpha_test_enabled = true;
            }
            if mat.alpha_ref == 0 {
                mat.alpha_ref = mesh_alpha_ref;
            }
        }
    }

    // Skip helpers, then optionally parse animation
    let parsed_anim = if parse_animations && anim_size > 0 {
        cursor.set_position(anim_offset);
        match read_animation(&mut cursor, anim_size, file_version) {
            Ok(anim) => anim,
            Err(e) => {
                eprintln!("Warning: failed to read animation: {}", e);
                ParsedAnimations {
                    matrix: None,
                    texuv: Vec::new(),
                    teximg: Vec::new(),
                    mtlopac: Vec::new(),
                }
            }
        }
    } else {
        ParsedAnimations {
            matrix: None,
            texuv: Vec::new(),
            teximg: Vec::new(),
            mtlopac: Vec::new(),
        }
    };

    Ok(LmoGeomObject {
        id,
        parent_id,
        obj_type,
        mat_local,
        vertices,
        normals,
        texcoords,
        vertex_colors,
        indices,
        subsets,
        materials,
        animation: parsed_anim.matrix,
        texuv_anims: parsed_anim.texuv,
        teximg_anims: parsed_anim.teximg,
        mtlopac_anims: parsed_anim.mtlopac,
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

    // Parse geometry objects (type 1), skip helpers (type 2)
    let mut geom_objects = Vec::new();
    for (obj_type, addr, size) in &headers {
        if *obj_type != OBJ_TYPE_GEOMETRY {
            continue;
        }
        match read_geom_object(data, *addr, *size, version, parse_animations) {
            Ok(geom) => geom_objects.push(geom),
            Err(e) => {
                eprintln!(
                    "Warning: failed to read geometry object at offset {}: {}",
                    addr, e
                );
            }
        }
    }

    Ok(LmoModel {
        version,
        geom_objects,
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

    fn push_alpha_test_rs_atoms(buf: &mut Vec<u8>, enabled: bool, alpha_ref: u8) {
        let mut atoms = [[0u32; 3]; LW_MTL_RS_NUM];
        if enabled {
            atoms[0] = [D3DRS_ALPHATESTENABLE, 1, 0];
            atoms[1] = [D3DRS_ALPHAREF, alpha_ref as u32, 0];
            atoms[2] = [D3DRS_ALPHAFUNC, D3DCMP_GREATER, 0];
        }

        for atom in atoms {
            push_u32(buf, atom[0]);
            push_u32(buf, atom[1]);
            push_u32(buf, atom[2]);
        }
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
        push_f32(buf, opacity); // opacity
        push_u32(buf, 0); // transp_type
                          // CharMaterial: diffuse(16) + ambient(16) + specular(16) + emissive(16) + power(4) = 68
        for &c in &diffuse {
            push_f32(buf, c);
        } // diffuse
        push_f32(buf, 0.3);
        push_f32(buf, 0.3);
        push_f32(buf, 0.3);
        push_f32(buf, 1.0); // ambient
        push_zeros(buf, 16); // specular
        push_zeros(buf, 16); // emissive
        push_f32(buf, 0.0); // power
                            // rs_set: 8 × RenderStateAtom (12 bytes)
        push_alpha_test_rs_atoms(buf, false, 0);
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

    fn push_material_with_alpha_test(
        buf: &mut Vec<u8>,
        diffuse: [f32; 4],
        opacity: f32,
        tex: &str,
        enabled: bool,
        alpha_ref: u8,
    ) {
        push_f32(buf, opacity); // opacity
        push_u32(buf, 0); // transp_type
        for &c in &diffuse {
            push_f32(buf, c);
        }
        push_f32(buf, 0.3);
        push_f32(buf, 0.3);
        push_f32(buf, 0.3);
        push_f32(buf, 1.0);
        push_zeros(buf, 16);
        push_zeros(buf, 16);
        push_f32(buf, 0.0);

        push_alpha_test_rs_atoms(buf, enabled, alpha_ref);

        for i in 0..4 {
            push_u32(buf, 0);
            push_u32(buf, 0);
            push_u32(buf, 0);
            push_u32(buf, 0);
            push_u32(buf, 0);
            push_u32(buf, 0);
            push_u32(buf, 0);
            push_u32(buf, 0);
            push_u32(buf, 0);
            push_u32(buf, 0);
            push_u32(buf, 0);
            let mut fname_buf = [0u8; 64];
            if i == 0 {
                let bytes = tex.as_bytes();
                let len = bytes.len().min(63);
                fname_buf[..len].copy_from_slice(&bytes[..len]);
            }
            buf.extend_from_slice(&fname_buf);
            push_u32(buf, 0);
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
        push_u32(&mut geom, id); // id
        push_u32(&mut geom, 0xFFFFFFFF); // parent_id
        push_u32(&mut geom, 0); // type
        push_identity_mat44(&mut geom); // mat_local (64 bytes)
        push_zeros(&mut geom, 16); // rcci
        push_zeros(&mut geom, 8); // state_ctrl
        push_u32(&mut geom, mtl_size as u32);
        push_u32(&mut geom, mesh_size as u32);
        push_u32(&mut geom, 0); // helper_size
        push_u32(&mut geom, 0); // anim_size

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
        push_f32(&mut geom, 0.0);
        push_f32(&mut geom, 0.0);
        push_f32(&mut geom, 0.0);
        push_f32(&mut geom, 1.0);
        push_f32(&mut geom, 0.0);
        push_f32(&mut geom, 0.0);
        push_f32(&mut geom, 0.0);
        push_f32(&mut geom, 1.0);
        push_f32(&mut geom, 0.0);

        // Normals
        if has_normals {
            for _ in 0..vertex_num {
                push_f32(&mut geom, 0.0);
                push_f32(&mut geom, 0.0);
                push_f32(&mut geom, 1.0);
            }
        }

        // Texcoords
        for _ in 0..tex_count {
            push_f32(&mut geom, 0.0);
            push_f32(&mut geom, 0.0);
            push_f32(&mut geom, 1.0);
            push_f32(&mut geom, 0.0);
            push_f32(&mut geom, 0.0);
            push_f32(&mut geom, 1.0);
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
        push_u32(&mut geom, 1); // primitive_num (1 triangle)
        push_u32(&mut geom, 0); // start_index
        push_u32(&mut geom, 3); // vertex_num
        push_u32(&mut geom, 0); // min_index

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
        push_u32(&mut data, 1); // obj_num
                                // Header table entry
        push_u32(&mut data, OBJ_TYPE_GEOMETRY);
        push_u32(&mut data, geom_addr as u32);
        push_u32(&mut data, geom_size as u32);
        data.extend_from_slice(&geom_blob);

        data
    }

    fn build_single_geom_lmo_with_alpha(
        material_alpha: bool,
        mesh_alpha: bool,
        alpha_ref: u8,
    ) -> Vec<u8> {
        let fvf = 0x002u32;
        let vertex_num: u32 = 3;
        let index_num: u32 = 3;
        let subset_num: u32 = 1;

        let mtl_num: u32 = 1;
        let mtl_size = 4 + mtl_num as usize * material_entry_size();
        let mesh_header_size = 32 + LW_MESH_RS_NUM * 12;
        let mesh_data_size =
            vertex_num as usize * 12 + index_num as usize * 4 + subset_num as usize * 16;
        let mesh_size = mesh_header_size + mesh_data_size;

        let mut geom = Vec::new();
        push_u32(&mut geom, 42);
        push_u32(&mut geom, 0xFFFFFFFF);
        push_u32(&mut geom, 0);
        push_identity_mat44(&mut geom);
        push_zeros(&mut geom, 16);
        push_zeros(&mut geom, 8);
        push_u32(&mut geom, mtl_size as u32);
        push_u32(&mut geom, mesh_size as u32);
        push_u32(&mut geom, 0);
        push_u32(&mut geom, 0);

        push_u32(&mut geom, mtl_num);
        push_material_with_alpha_test(
            &mut geom,
            [0.8, 0.2, 0.1, 1.0],
            1.0,
            "wall.bmp",
            material_alpha,
            alpha_ref,
        );

        push_u32(&mut geom, fvf);
        push_u32(&mut geom, 4);
        push_u32(&mut geom, vertex_num);
        push_u32(&mut geom, index_num);
        push_u32(&mut geom, subset_num);
        push_u32(&mut geom, 0);
        push_u32(&mut geom, 0);
        push_u32(&mut geom, 0);
        push_alpha_test_rs_atoms(&mut geom, mesh_alpha, alpha_ref);

        push_f32(&mut geom, 0.0);
        push_f32(&mut geom, 0.0);
        push_f32(&mut geom, 0.0);
        push_f32(&mut geom, 1.0);
        push_f32(&mut geom, 0.0);
        push_f32(&mut geom, 0.0);
        push_f32(&mut geom, 0.0);
        push_f32(&mut geom, 1.0);
        push_f32(&mut geom, 0.0);

        push_u32(&mut geom, 0);
        push_u32(&mut geom, 1);
        push_u32(&mut geom, 2);

        push_u32(&mut geom, 1);
        push_u32(&mut geom, 0);
        push_u32(&mut geom, 3);
        push_u32(&mut geom, 0);

        let header_size = 4 + 4 + 12;
        let mut data = Vec::new();
        push_u32(&mut data, 0x1005);
        push_u32(&mut data, 1);
        push_u32(&mut data, OBJ_TYPE_GEOMETRY);
        push_u32(&mut data, header_size as u32);
        push_u32(&mut data, geom.len() as u32);
        data.extend_from_slice(&geom);
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
        assert!(!mat.alpha_test_enabled);
        assert_eq!(mat.alpha_ref, 0);
        assert_eq!(mat.tex_filename.as_deref(), Some("wall.bmp"));
    }

    #[test]
    fn parse_material_level_alpha_test_state() {
        let data = build_single_geom_lmo_with_alpha(true, false, 129);
        let model = parse_lmo(&data).unwrap();

        let mat = &model.geom_objects[0].materials[0];
        assert!(
            mat.alpha_test_enabled,
            "material rs_set should enable alpha test"
        );
        assert_eq!(mat.alpha_ref, 129, "material alpha ref should be parsed");
    }

    #[test]
    fn parse_mesh_level_alpha_test_state() {
        let data = build_single_geom_lmo_with_alpha(false, true, 129);
        let model = parse_lmo(&data).unwrap();

        let mat = &model.geom_objects[0].materials[0];
        assert!(
            mat.alpha_test_enabled,
            "mesh rs_set alpha test should propagate to materials"
        );
        assert_eq!(
            mat.alpha_ref, 129,
            "mesh alpha ref should propagate to materials"
        );
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
                    r,
                    c,
                    geom.mat_local[r][c],
                    expected
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

        assert!(
            !model.geom_objects.is_empty(),
            "real LMO should have geometry"
        );

        for (i, geom) in model.geom_objects.iter().enumerate() {
            assert!(
                !geom.vertices.is_empty(),
                "geom[{}] should have vertices",
                i
            );
            assert!(!geom.indices.is_empty(), "geom[{}] should have indices", i);
            eprintln!(
                "  geom[{}]: id={}, verts={}, indices={}, mats={}, subsets={}",
                i,
                geom.id,
                geom.vertices.len(),
                geom.indices.len(),
                geom.materials.len(),
                geom.subsets.len()
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
            assert!(
                !geom.vertices.is_empty(),
                "geom[{}] should have vertices",
                i
            );
            assert!(!geom.indices.is_empty(), "geom[{}] should have indices", i);
            eprintln!(
                "  geom[{}]: id={}, verts={}, indices={}, mats={}, subsets={}",
                i,
                geom.id,
                geom.vertices.len(),
                geom.indices.len(),
                geom.materials.len(),
                geom.subsets.len()
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
                    i,
                    j
                );
            }
        }
    }

    #[test]
    fn parse_version0_lmo_alpha_test() {
        // nml-bd022.lmo is a version-0 file with leaf textures that need alpha test.
        // The old lwRenderStateSetMtl2 format stores ALPHATESTENABLE in the 128-byte
        // render state block that we previously skipped.
        let path = std::path::Path::new("../top-client/model/scene/nml-bd022.lmo");
        if !path.exists() {
            return;
        }

        let model = load_lmo(path).unwrap();
        assert_eq!(model.version, 0, "nml-bd022 should be version 0");
        assert!(!model.geom_objects.is_empty());

        // Check that at least one material has alpha test enabled
        let mut found_alpha = false;
        for geom in &model.geom_objects {
            for mat in &geom.materials {
                if mat.alpha_test_enabled {
                    found_alpha = true;
                    // Old format should force alpha_ref to 129
                    assert_eq!(
                        mat.alpha_ref, 129,
                        "V0000 format should force alpha_ref to 129"
                    );
                }
            }
        }
        assert!(
            found_alpha,
            "nml-bd022 leaf textures should have alpha_test_enabled=true"
        );
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
        let mesh_data_size =
            vertex_num as usize * 12 + index_num as usize * 4 + subset_num as usize * 16;
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
        push_zeros(&mut geom, 8); // state_ctrl
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
        push_f32(&mut geom, 0.0);
        push_f32(&mut geom, 0.0);
        push_f32(&mut geom, 0.0);
        push_f32(&mut geom, 1.0);
        push_f32(&mut geom, 0.0);
        push_f32(&mut geom, 0.0);
        push_f32(&mut geom, 0.0);
        push_f32(&mut geom, 1.0);
        push_f32(&mut geom, 0.0);
        // Indices
        push_u32(&mut geom, 0);
        push_u32(&mut geom, 1);
        push_u32(&mut geom, 2);
        // Subset
        push_u32(&mut geom, 1);
        push_u32(&mut geom, 0);
        push_u32(&mut geom, 3);
        push_u32(&mut geom, 0);

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
            push_f32(&mut geom, 1.0);
            push_f32(&mut geom, 0.0);
            push_f32(&mut geom, 0.0);
            // Column 1 (basis Y): [0, 1, 0]
            push_f32(&mut geom, 0.0);
            push_f32(&mut geom, 1.0);
            push_f32(&mut geom, 0.0);
            // Column 2 (basis Z): [0, 0, 1]
            push_f32(&mut geom, 0.0);
            push_f32(&mut geom, 0.0);
            push_f32(&mut geom, 1.0);
            // Translation: (f, 0, 0)
            push_f32(&mut geom, f as f32);
            push_f32(&mut geom, 0.0);
            push_f32(&mut geom, 0.0);
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
        assert!(
            has_animation,
            "lighthouse should have at least one animated object"
        );

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

        let animated_count = model
            .geom_objects
            .iter()
            .filter(|g| g.animation.is_some())
            .count();
        eprintln!("  {} objects have animation", animated_count);
        assert!(animated_count > 0, "whirlpool should have animated objects");

        for (i, geom) in model.geom_objects.iter().enumerate() {
            if let Some(ref anim) = geom.animation {
                eprintln!("  geom[{}] id={}: {} frames", i, geom.id, anim.frame_num);
                assert!(anim.frame_num > 0);
            }
        }
    }

    #[test]
    fn parse_texuv_animation_from_nml_bd201() {
        // nml-bd201.lmo — small building with texuv animation on subset 0, stage 0
        let path = std::path::Path::new(
            "../top-client/corsairs-online-public/client/model/scene/nml-bd201.lmo",
        );
        if !path.exists() {
            return;
        }

        let model = load_lmo(path).unwrap();
        assert!(
            !model.geom_objects.is_empty(),
            "should have geometry objects"
        );

        let has_texuv = model
            .geom_objects
            .iter()
            .any(|g| !g.texuv_anims.is_empty());
        assert!(has_texuv, "nml-bd201 should have texuv animation");

        for (i, geom) in model.geom_objects.iter().enumerate() {
            for uv in &geom.texuv_anims {
                eprintln!(
                    "  geom[{}] id={}: texuv subset={} stage={} frames={}",
                    i, geom.id, uv.subset, uv.stage, uv.frame_num
                );
                assert!(uv.frame_num > 0, "should have frames");
                assert_eq!(
                    uv.matrices.len(),
                    uv.frame_num as usize,
                    "matrix count must match frame_num"
                );
                // First frame's matrix should not be all zeros
                let first = &uv.matrices[0];
                let all_zero = first.iter().all(|row| row.iter().all(|&v| v == 0.0));
                assert!(!all_zero, "first UV matrix should not be all zeros");
            }
        }
    }

    #[test]
    fn parse_teximg_animation_from_cc_bd065() {
        // cc-bd065.lmo — v0x1005 building with teximg animation (22KB)
        let path = std::path::Path::new(
            "../top-client/corsairs-online-public/client/model/scene/cc-bd065.lmo",
        );
        if !path.exists() {
            return;
        }

        let model = load_lmo(path).unwrap();
        assert!(
            !model.geom_objects.is_empty(),
            "should have geometry objects"
        );

        let has_teximg = model
            .geom_objects
            .iter()
            .any(|g| !g.teximg_anims.is_empty());
        assert!(has_teximg, "cc-bd065 should have teximg animation");

        for (i, geom) in model.geom_objects.iter().enumerate() {
            for ti in &geom.teximg_anims {
                eprintln!(
                    "  geom[{}] id={}: teximg subset={} stage={} textures={}",
                    i,
                    geom.id,
                    ti.subset,
                    ti.stage,
                    ti.textures.len()
                );
                assert!(!ti.textures.is_empty(), "should have at least one texture");
                for tex in &ti.textures {
                    assert!(!tex.is_empty(), "texture filename should not be empty");
                    eprintln!("    texture: {}", tex);
                }
            }
        }
    }

    #[test]
    fn parse_mtlopac_animation_from_hdjd_cbd01() {
        // hdjd-cbd01.lmo — v0x1005 building with mtlopac animation
        let path = std::path::Path::new(
            "../top-client/corsairs-online-public/client/model/scene/hdjd-cbd01.lmo",
        );
        if !path.exists() {
            return;
        }

        let model = load_lmo(path).unwrap();
        assert!(
            !model.geom_objects.is_empty(),
            "should have geometry objects"
        );

        let has_mtlopac = model
            .geom_objects
            .iter()
            .any(|g| !g.mtlopac_anims.is_empty());
        assert!(has_mtlopac, "hdjd-cbd01 should have mtlopac animation");

        for (i, geom) in model.geom_objects.iter().enumerate() {
            for mo in &geom.mtlopac_anims {
                eprintln!(
                    "  geom[{}] id={}: mtlopac subset={} keyframes={}",
                    i,
                    geom.id,
                    mo.subset,
                    mo.keyframes.len()
                );
                assert!(
                    !mo.keyframes.is_empty(),
                    "should have at least one keyframe"
                );
                for kf in &mo.keyframes {
                    // Opacity should be in [0, 1] range
                    assert!(
                        (0.0..=1.0).contains(&kf.opacity),
                        "opacity {} out of [0,1] range",
                        kf.opacity
                    );
                    eprintln!("    frame={} opacity={:.3}", kf.frame, kf.opacity);
                }
            }
        }
    }

    // ====================================================================
    // Version-0 legacy header regression tests
    // ====================================================================

    #[test]
    fn parse_v0_legacy_header_kao_bd001() {
        // kao-bd001.lmo has a 92-byte legacy header (no rcci/state_ctrl).
        // Previously broke because we always read 116 bytes.
        let path = std::path::Path::new("../top-client/model/scene/kao-bd001.lmo");
        if !path.exists() {
            return;
        }

        let model = load_lmo(path).unwrap();
        assert_eq!(model.version, 0, "kao-bd001 should be version 0");
        assert!(
            !model.geom_objects.is_empty(),
            "kao-bd001 should have geometry objects"
        );

        for (i, geom) in model.geom_objects.iter().enumerate() {
            assert!(
                !geom.vertices.is_empty(),
                "geom[{}] should have vertices",
                i
            );
            assert!(!geom.indices.is_empty(), "geom[{}] should have indices", i);
            // Verify index validity: all indices should be < vertex count
            let max_idx = geom.indices.iter().copied().max().unwrap_or(0);
            assert!(
                max_idx < geom.vertices.len() as u32,
                "geom[{}] max index {} >= vertex count {}",
                i,
                max_idx,
                geom.vertices.len()
            );
            eprintln!(
                "  geom[{}]: id={}, verts={}, indices={}, mats={}, subsets={}",
                i,
                geom.id,
                geom.vertices.len(),
                geom.indices.len(),
                geom.materials.len(),
                geom.subsets.len()
            );
        }
    }

    #[test]
    fn parse_v0_legacy_header_nml_bd016() {
        // nml-bd016.lmo has a 92-byte legacy header (no rcci/state_ctrl).
        // Previously broke because we always read 116 bytes.
        let path = std::path::Path::new("../top-client/model/scene/nml-bd016.lmo");
        if !path.exists() {
            return;
        }

        let model = load_lmo(path).unwrap();
        assert_eq!(model.version, 0, "nml-bd016 should be version 0");
        assert!(
            !model.geom_objects.is_empty(),
            "nml-bd016 should have geometry objects"
        );

        for (i, geom) in model.geom_objects.iter().enumerate() {
            assert!(
                !geom.vertices.is_empty(),
                "geom[{}] should have vertices",
                i
            );
            assert!(!geom.indices.is_empty(), "geom[{}] should have indices", i);
            let max_idx = geom.indices.iter().copied().max().unwrap_or(0);
            assert!(
                max_idx < geom.vertices.len() as u32,
                "geom[{}] max index {} >= vertex count {}",
                i,
                max_idx,
                geom.vertices.len()
            );
            eprintln!(
                "  geom[{}]: id={}, verts={}, indices={}, mats={}, subsets={}",
                i,
                geom.id,
                geom.vertices.len(),
                geom.indices.len(),
                geom.materials.len(),
                geom.subsets.len()
            );
        }
    }

    /// Build a synthetic version-0 LMO with a 92-byte legacy header (no rcci/state_ctrl).
    fn build_v0_legacy_header_lmo() -> Vec<u8> {
        let fvf = 0x002u32; // positions only
        let vertex_num: u32 = 3;
        let index_num: u32 = 3;
        let subset_num: u32 = 1;

        // Old format mesh: old_version(4) + header + subsets + vertices + indices
        // Old mesh header: fvf(4) + pt_type(4) + vertex_num(4) + index_num(4) + subset_num(4)
        //   + bone_index_num(4) + rs_set(128 bytes for mesh_version=0)
        let mesh_header_size = 4 + 24 + 128; // old_version + 6 DWORDs + lwRenderStateSetMesh2
        let mesh_data_size = subset_num as usize * 16 // subsets FIRST in old format
            + vertex_num as usize * 12      // positions
            + index_num as usize * 4;       // indices
        let mesh_size = mesh_header_size + mesh_data_size;

        // Build the geometry chunk
        let mut geom = Vec::new();

        // old_version prefix (v0 geometry chunk starts with this)
        push_u32(&mut geom, 0); // old_version

        // Legacy geometry header (92 bytes): id + parent_id + type + mat44 + sizes
        // NO rcci, NO state_ctrl
        push_u32(&mut geom, 99); // id
        push_u32(&mut geom, 0xFFFFFFFF); // parent_id
        push_u32(&mut geom, 0); // type
        push_identity_mat44(&mut geom); // mat_local (64 bytes)
        // Sizes immediately after mat_local (no rcci/state_ctrl gap)
        push_u32(&mut geom, 0); // mtl_size
        push_u32(&mut geom, mesh_size as u32);
        push_u32(&mut geom, 0); // helper_size
        push_u32(&mut geom, 0); // anim_size

        // Mesh section (old format, mesh_version=0)
        push_u32(&mut geom, 0); // mesh old_version
        push_u32(&mut geom, fvf);
        push_u32(&mut geom, 4); // pt_type
        push_u32(&mut geom, vertex_num);
        push_u32(&mut geom, index_num);
        push_u32(&mut geom, subset_num);
        push_u32(&mut geom, 0); // bone_index_num
        // rs_set: lwRenderStateSetMesh2 = 2 * 8 * 8 = 128 bytes
        push_zeros(&mut geom, 128);
        // Subsets (old format: subsets FIRST)
        push_u32(&mut geom, 1); // primitive_num
        push_u32(&mut geom, 0); // start_index
        push_u32(&mut geom, 3); // vertex_num
        push_u32(&mut geom, 0); // min_index
        // Vertices
        push_f32(&mut geom, 0.0); push_f32(&mut geom, 0.0); push_f32(&mut geom, 0.0);
        push_f32(&mut geom, 1.0); push_f32(&mut geom, 0.0); push_f32(&mut geom, 0.0);
        push_f32(&mut geom, 0.0); push_f32(&mut geom, 1.0); push_f32(&mut geom, 0.0);
        // Indices
        push_u32(&mut geom, 0);
        push_u32(&mut geom, 1);
        push_u32(&mut geom, 2);

        // Build file
        let header_size = 4 + 4 + 12; // version + obj_num + 1 entry
        let mut data = Vec::new();
        push_u32(&mut data, 0); // file version = 0
        push_u32(&mut data, 1); // obj_num
        push_u32(&mut data, OBJ_TYPE_GEOMETRY);
        push_u32(&mut data, header_size as u32);
        push_u32(&mut data, geom.len() as u32);
        data.extend_from_slice(&geom);
        data
    }

    #[test]
    fn parse_synthetic_v0_legacy_header() {
        let data = build_v0_legacy_header_lmo();
        let model = parse_lmo(&data).unwrap();
        assert_eq!(model.version, 0);
        assert_eq!(model.geom_objects.len(), 1);

        let geom = &model.geom_objects[0];
        assert_eq!(geom.id, 99);
        assert_eq!(geom.vertices.len(), 3);
        assert_eq!(geom.indices.len(), 3);
        assert_eq!(geom.indices, vec![0, 1, 2]);
    }

    #[test]
    fn parse_all_animation_types_roundtrip() {
        // cc-bd044.lmo — v0x1005, has BOTH texuv + teximg
        let path = std::path::Path::new(
            "../top-client/corsairs-online-public/client/model/scene/cc-bd044.lmo",
        );
        if !path.exists() {
            return;
        }

        let model = load_lmo(path).unwrap();
        let total_texuv: usize = model.geom_objects.iter().map(|g| g.texuv_anims.len()).sum();
        let total_teximg: usize = model
            .geom_objects
            .iter()
            .map(|g| g.teximg_anims.len())
            .sum();
        let total_mat: usize = model
            .geom_objects
            .iter()
            .filter(|g| g.animation.is_some())
            .count();

        eprintln!(
            "cc-bd044: {} geoms, {} mat anims, {} texuv, {} teximg",
            model.geom_objects.len(),
            total_mat,
            total_texuv,
            total_teximg
        );

        // cc-bd044 should have teximg (and possibly texuv)
        assert!(
            total_texuv > 0 || total_teximg > 0,
            "should have texuv or teximg animations"
        );
    }

}
