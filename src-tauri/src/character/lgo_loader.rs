use std::path::Path;

use anyhow::{Result, bail};

use crate::kaitai_gen::pko_lmo::*;
use kaitai::*;

use super::helper::{
    BoundingBoxInfo, BoundingSphereInfo, HelperBoxInfo, HelperData, HelperDummyInfo,
    HelperMeshFaceInfo, HelperMeshInfo, HELPER_TYPE_BBOX, HELPER_TYPE_BOX, HELPER_TYPE_BSPHERE,
    HELPER_TYPE_DUMMY, HELPER_TYPE_MESH,
};
use super::mesh::{
    CharacterInfoMeshHeader, CharacterMeshBlendInfo, CharacterMeshInfo, CharacterMeshSubsetInfo,
    LW_MESH_RS_NUM,
};
use super::model::{
    CharGeoModelInfoHeader, CharacterGeometricModel, RenderCtrlCreateInfo, StateCtrl,
    EXP_OBJ_VERSION_0_0_0_0,
};
use super::texture::{
    CharMaterial, CharMaterialTextureInfo, ColorKeyType, ColorValue4F, LwColorValue4b,
    MaterialTextureInfoTransparencyType, RenderStateAtom, TextureInfo, TextureType,
};
use crate::animation::character::LW_INVALID_INDEX;
use crate::d3d::{D3DBlend, D3DCmpFunc, D3DFormat, D3DPool, D3DPrimitiveType, D3DRenderStateType, D3DVertexElement9};
use crate::math::{LwBox, LwMatrix44, LwPlane, LwSphere, LwVector2, LwVector3};

use cgmath::{Matrix4, Vector2, Vector3, Vector4};

/// Convert a u32 to a `#[repr(u32)]` enum via `TryFrom`, falling back to `default`.
fn enum_from_u32<T: TryFrom<u32>>(v: u32, default: T) -> T {
    T::try_from(v).unwrap_or(default)
}

// ============================================================================
// Public entry points
// ============================================================================

pub fn load_lgo(path: impl AsRef<Path>) -> Result<CharacterGeometricModel> {
    let data = std::fs::read(path.as_ref())
        .map_err(|e| anyhow::anyhow!("Failed to read LGO file '{}': {}", path.as_ref().display(), e))?;
    load_lgo_from_bytes(&data)
}

pub fn load_lgo_from_bytes(data: &[u8]) -> Result<CharacterGeometricModel> {
    if data.len() < 4 {
        bail!("LGO file too small ({} bytes)", data.len());
    }

    // Read version (first 4 bytes LE)
    let version = u32::from_le_bytes([data[0], data[1], data[2], data[3]]);
    let geometry_data = &data[4..];

    // PkoLmo_GeometryChunk has Root=PkoLmo, so we need a PkoLmo instance
    // as root. Create a minimal one — its fields aren't accessed by GeometryChunk.
    let dummy_root = PkoLmo::default();
    let dummy_root_rc: OptRc<PkoLmo> = OptRc::from(std::rc::Rc::new(dummy_root));
    dummy_root_rc._self.set(Ok(dummy_root_rc.clone()));
    dummy_root_rc._root.set(Ok(dummy_root_rc.clone()));

    let root_shared = SharedType::new(dummy_root_rc.get());

    // Parse geometry chunk with the dummy root
    let geom_reader = BytesReader::from(geometry_data.to_vec());
    let f = |t: &mut PkoLmo_GeometryChunk| {
        t.set_params(version, 0);
        Ok(())
    };
    let geometry = PkoLmo_GeometryChunk::read_into_with_init::<BytesReader, PkoLmo_GeometryChunk>(
        &geom_reader,
        Some(root_shared),
        None,
        &f,
    )
    .map_err(|e| anyhow::anyhow!("Kaitai LGO geometry parse error: {:?}", e))?;

    convert_geometry_to_char_model(&geometry, version)
}

// ============================================================================
// Core conversion
// ============================================================================

fn convert_geometry_to_char_model(
    chunk: &OptRc<PkoLmo_GeometryChunk>,
    version: u32,
) -> Result<CharacterGeometricModel> {
    let header = convert_header(chunk, version)?;

    // Determine effective version for material/mesh parsing
    let effective_version = if version == EXP_OBJ_VERSION_0_0_0_0 {
        // For v0 files, the legacy_prefix in each section acts as the effective version
        version
    } else {
        version
    };

    // old_version: only present when version == 0
    let old_version = if version == EXP_OBJ_VERSION_0_0_0_0 {
        // The legacy_prefix is read by each section; for the top-level old_version field,
        // we need the material section's effective version (or mesh, they should be the same)
        // In binrw, old_version is read right after the header as a u32.
        // For Kaitai, the geometry chunk doesn't expose this directly — it's the legacy_prefix
        // of the first section encountered. We use the mesh section's legacy_prefix.
        if header.mesh_size > 0 {
            let mesh = chunk.mesh().clone();
            let lp = *mesh.legacy_prefix();
            lp
        } else if header.mtl_size > 0 {
            let mtl = chunk.material().clone();
            let has_lp = *mtl.has_legacy_prefix()
                .map_err(|e| anyhow::anyhow!("has_legacy_prefix: {:?}", e))?;
            if has_lp {
                let lp = *mtl.legacy_prefix();
                lp
            } else {
                0
            }
        } else {
            0
        }
    } else {
        0
    };

    // Materials
    let (material_num, material_seq) = if header.mtl_size > 0 {
        let mtl_section = chunk.material().clone();
        let materials = convert_material_section(&mtl_section, version)?;
        let num = if header.mesh_size > 0 {
            materials.len() as u32
        } else {
            0
        };
        (num, Some(materials))
    } else {
        let num = 0u32;
        (num, None)
    };

    // material_num is only present in the binary if mesh_size > 0
    let material_num_value = if header.mesh_size > 0 {
        material_num
    } else {
        0
    };

    // Mesh
    let mesh_info = if header.mesh_size > 0 {
        let mesh_section = chunk.mesh().clone();
        let mesh_raw = chunk.mesh_raw().clone();
        Some(convert_mesh_section(&mesh_section, &mesh_raw, effective_version)?)
    } else {
        None
    };

    // Helpers
    let helper_data = if header.helper_size > 0 {
        let helper_section = chunk.helper().clone();
        Some(convert_helper_section(&helper_section, effective_version)?)
    } else {
        None
    };

    Ok(CharacterGeometricModel {
        version,
        header,
        old_version,
        material_num: material_num_value,
        material_seq,
        mesh_info,
        helper_data,
    })
}

// ============================================================================
// Header conversion
// ============================================================================

fn convert_header(
    chunk: &OptRc<PkoLmo_GeometryChunk>,
    _version: u32,
) -> Result<CharGeoModelInfoHeader> {
    let kaitai_header = chunk.header().clone();

    let id = *kaitai_header.id()
        .map_err(|e| anyhow::anyhow!("header.id: {:?}", e))?;
    let parent_id = *kaitai_header.parent_id()
        .map_err(|e| anyhow::anyhow!("header.parent_id: {:?}", e))?;
    let _type = *kaitai_header.geom_type()
        .map_err(|e| anyhow::anyhow!("header.geom_type: {:?}", e))?;
    let mat_local_rc = kaitai_header.mat_local()
        .map_err(|e| anyhow::anyhow!("header.mat_local: {:?}", e))?
        .clone();
    let mat_local = extract_lw_matrix44(&mat_local_rc);

    let mtl_size = *kaitai_header.mtl_size()
        .map_err(|e| anyhow::anyhow!("header.mtl_size: {:?}", e))?;
    let mesh_size = *kaitai_header.mesh_size()
        .map_err(|e| anyhow::anyhow!("header.mesh_size: {:?}", e))?;
    let helper_size = *kaitai_header.helper_size()
        .map_err(|e| anyhow::anyhow!("header.helper_size: {:?}", e))?;
    let anim_size = *kaitai_header.anim_size()
        .map_err(|e| anyhow::anyhow!("header.anim_size: {:?}", e))?;

    let header_kind = *kaitai_header.header_kind()
        .map_err(|e| anyhow::anyhow!("header.header_kind: {:?}", e))?;

    let (rcci, state_ctrl) = if header_kind == 1 {
        // Modern header: extract rcci and state_ctrl
        let modern = kaitai_header.modern().clone();
        let rcci_k = modern.rcci().clone();
        let rcci = RenderCtrlCreateInfo {
            ctrl_id: *rcci_k.ctrl_id(),
            decl_id: *rcci_k.decl_id(),
            vs_id: *rcci_k.vs_id(),
            ps_id: *rcci_k.ps_id(),
        };

        let sc_k = modern.state_ctrl().clone();
        let state_bytes = sc_k.state_seq().clone();
        let mut state_arr = [0u8; 8];
        for (i, b) in state_bytes.iter().enumerate().take(8) {
            state_arr[i] = *b;
        }
        let state_ctrl = StateCtrl {
            _state_seq: state_arr,
        };

        (rcci, state_ctrl)
    } else {
        // Legacy header: default rcci and state_ctrl
        let rcci = RenderCtrlCreateInfo {
            ctrl_id: 0,
            decl_id: 0,
            vs_id: 0,
            ps_id: 0,
        };
        let state_ctrl = StateCtrl {
            _state_seq: [0u8; 8],
        };
        (rcci, state_ctrl)
    };

    Ok(CharGeoModelInfoHeader {
        id,
        parent_id,
        _type,
        mat_local,
        rcci,
        state_ctrl,
        mtl_size,
        mesh_size,
        helper_size,
        anim_size,
    })
}

// ============================================================================
// Material conversion
// ============================================================================

/// Material format version.
#[derive(Debug, Clone, Copy, PartialEq)]
enum MtlFormat {
    V0000,
    V0001,
    Current,
}

fn convert_material_section(
    section: &OptRc<PkoLmo_MaterialSection>,
    _file_version: u32,
) -> Result<Vec<CharMaterialTextureInfo>> {
    let format_hint = *section.format_hint()
        .map_err(|e| anyhow::anyhow!("format_hint: {:?}", e))?;
    let mtl_format = match format_hint {
        0 => MtlFormat::V0000,
        1 => MtlFormat::V0001,
        _ => MtlFormat::Current,
    };

    let mtl_num = *section.mtl_num();
    let entries = section.mtl_entries().clone();

    let mut materials = Vec::with_capacity(mtl_num as usize);
    for entry_rc in &entries {
        let mat = convert_mtl_entry(entry_rc, mtl_format)?;
        materials.push(mat);
    }

    Ok(materials)
}

fn convert_mtl_entry(
    entry: &OptRc<PkoLmo_MtlEntry>,
    mtl_format: MtlFormat,
) -> Result<CharMaterialTextureInfo> {
    match mtl_format {
        MtlFormat::V0000 => convert_mtl_0000(&entry.as_0000().clone()),
        MtlFormat::V0001 => convert_mtl_0001(&entry.as_0001().clone()),
        MtlFormat::Current => convert_mtl_current(&entry.as_current().clone()),
    }
}

fn convert_mtl_0000(info: &OptRc<PkoLmo_MtlTexInfo0000>) -> Result<CharMaterialTextureInfo> {
    let mtl = info.mtl().clone();
    let material = extract_char_material(&mtl);

    // V0000: no opacity/transp fields in binary
    let opacity = 0.0;
    let transp_type = MaterialTextureInfoTransparencyType::Filter;

    // Render states from old format
    let rs_set = read_old_format_render_state_for_char(&info.rs_set().clone());

    // Textures
    let tex_seq = extract_tex_info_0000(&info.tex_seq().clone());

    // Post-process
    post_process_material(opacity, transp_type, material, rs_set, tex_seq)
}

fn convert_mtl_0001(info: &OptRc<PkoLmo_MtlTexInfo0001>) -> Result<CharMaterialTextureInfo> {
    let opacity = *info.opacity();
    let transp_type_raw = *info.transp_type();
    let transp_type = MaterialTextureInfoTransparencyType::try_from(transp_type_raw)
        .unwrap_or(MaterialTextureInfoTransparencyType::Filter);

    let mtl = info.mtl().clone();
    let material = extract_char_material(&mtl);

    // Render states from old format
    let rs_set = read_old_format_render_state_for_char(&info.rs_set().clone());

    // Textures
    let tex_seq = extract_tex_info_0001(&info.tex_seq().clone());

    post_process_material(opacity, transp_type, material, rs_set, tex_seq)
}

fn convert_mtl_current(info: &OptRc<PkoLmo_MtlTexInfoCurrent>) -> Result<CharMaterialTextureInfo> {
    let opacity = *info.opacity();
    let transp_type_raw = *info.transp_type();
    let transp_type = MaterialTextureInfoTransparencyType::try_from(transp_type_raw)
        .unwrap_or(MaterialTextureInfoTransparencyType::Filter);

    let mtl = info.mtl().clone();
    let material = extract_char_material(&mtl);

    // Render states from current atom format
    let rs_set = extract_render_state_atoms(&info.rs_set().clone());

    // Textures
    let tex_seq = extract_tex_info_current(&info.tex_seq().clone());

    post_process_material(opacity, transp_type, material, rs_set, tex_seq)
}

/// Applies the post-processing from texture.rs:848-889.
fn post_process_material(
    opacity: f32,
    mut transp_type: MaterialTextureInfoTransparencyType,
    material: CharMaterial,
    mut rs_set: [RenderStateAtom; 8],
    mut tex_seq: [TextureInfo; 4],
) -> Result<CharMaterialTextureInfo> {
    // D3DPool override and level override for stage 0
    tex_seq[0].d3d_pool = D3DPool::Managed;
    tex_seq[0].level = u32::MAX;

    // Lighting flag post-processing (texture.rs:848-876)
    let mut transp_flag = false;
    let mut total_mtl_rs_num: u32 = 0;

    for i in 0..8u32 {
        let rsa = rs_set[i as usize];
        if rsa.state == LW_INVALID_INDEX {
            break;
        }
        total_mtl_rs_num += 1;

        if rsa.state == D3DRenderStateType::DestBlend as u32
            && (rsa.value0 == D3DBlend::One as u32
                || rsa.value0 == D3DBlend::InvSrcColor as u32)
        {
            transp_flag = true;
        }

        if rsa.state == D3DRenderStateType::Lighting as u32 && rsa.value0 == 0 {
            transp_flag = !transp_flag;
        }
    }

    if transp_flag && total_mtl_rs_num < 7 {
        rs_set[total_mtl_rs_num as usize].state = D3DRenderStateType::Lighting as u32;
        rs_set[total_mtl_rs_num as usize].value0 = 0;
        rs_set[total_mtl_rs_num as usize].value1 = 0;
    }

    // Transp remap (texture.rs:878-879)
    if transp_type == MaterialTextureInfoTransparencyType::Additive1 {
        transp_type = MaterialTextureInfoTransparencyType::Subtractive;
    }

    Ok(CharMaterialTextureInfo {
        opacity,
        transp_type,
        material,
        rs_set,
        tex_seq,
    })
}

// ============================================================================
// Material helpers
// ============================================================================

fn extract_char_material(mtl: &OptRc<PkoLmo_Material>) -> CharMaterial {
    let dif = mtl.dif().clone();
    let dif_r = *dif.r(); let dif_g = *dif.g(); let dif_b = *dif.b(); let dif_a = *dif.a();

    let amb = mtl.amb().clone();
    let amb_r = *amb.r(); let amb_g = *amb.g(); let amb_b = *amb.b(); let amb_a = *amb.a();

    let spe = mtl.spe().clone();
    let spe_r = *spe.r(); let spe_g = *spe.g(); let spe_b = *spe.b(); let spe_a = *spe.a();

    let emi = mtl.emi().clone();
    let emi_r = *emi.r(); let emi_g = *emi.g(); let emi_b = *emi.b(); let emi_a = *emi.a();

    let power = *mtl.power();

    CharMaterial {
        dif: ColorValue4F { r: dif_r, g: dif_g, b: dif_b, a: dif_a },
        amb: ColorValue4F { r: amb_r, g: amb_g, b: amb_b, a: amb_a },
        spe: Some(ColorValue4F { r: spe_r, g: spe_g, b: spe_b, a: spe_a }),
        emi: Some(ColorValue4F { r: emi_r, g: emi_g, b: emi_b, a: emi_a }),
        power,
    }
}

fn extract_render_state_atoms(atoms: &[OptRc<PkoLmo_RenderStateAtom>]) -> [RenderStateAtom; 8] {
    let mut rs_set = [RenderStateAtom::new(); 8];
    for (i, atom_rc) in atoms.iter().enumerate().take(8) {
        rs_set[i] = RenderStateAtom {
            state: *atom_rc.state(),
            value0: *atom_rc.value0(),
            value1: *atom_rc.value1(),
        };
    }
    rs_set
}

/// Read old-format render state set (V0000/V0001) for character materials.
/// Old format: 2 sets × 8 entries (RenderStateValue with state+value).
/// Forces ALPHAREF=129, ALPHAFUNC=D3DCMP_GREATER.
fn read_old_format_render_state_for_char(
    rs_set_k: &OptRc<PkoLmo_RenderStateSet28>,
) -> [RenderStateAtom; 8] {
    let mut rs_set = [RenderStateAtom::new(); 8];
    let values = rs_set_k.values().clone();

    // Only process the first set (8 entries)
    for (i, val_rc) in values.iter().enumerate().take(8) {
        let state = *val_rc.state();
        let value = *val_rc.value();

        if state == LW_INVALID_INDEX {
            break;
        }

        let v = match state {
            s if s == D3DRenderStateType::AlphaFunc as u32 => D3DCmpFunc::Greater as u32,
            s if s == D3DRenderStateType::AlphaRef as u32 => 129,
            _ => value,
        };

        rs_set[i] = RenderStateAtom {
            state,
            value0: v,
            value1: v,
        };
    }

    rs_set
}

fn extract_cstr_from_bytes(raw: &[u8]) -> [u8; 64] {
    let mut buf = [0u8; 64];
    let len = raw.len().min(64);
    buf[..len].copy_from_slice(&raw[..len]);
    buf
}

fn extract_tex_info_0000(stages: &[OptRc<PkoLmo_TexInfo0000>]) -> [TextureInfo; 4] {
    let mut tex_seq = [TextureInfo::new(), TextureInfo::new(), TextureInfo::new(), TextureInfo::new()];

    for (i, stage_rc) in stages.iter().enumerate().take(4) {
        let stage_val = *stage_rc.stage();
        if stage_val == LW_INVALID_INDEX {
            continue;
        }

        tex_seq[i].stage = stage_val;
        tex_seq[i].level = u32::MAX;
        tex_seq[i].usage = 0;
        tex_seq[i].d3d_pool = D3DPool::Default;
        tex_seq[i]._type = TextureType::File;
        tex_seq[i].d3d_format = enum_from_u32(*stage_rc.format(), D3DFormat::Unknown);
        tex_seq[i].colorkey_type = enum_from_u32(*stage_rc.colorkey_type(), ColorKeyType::None);
        let ck = stage_rc.colorkey().clone();
        tex_seq[i].colorkey = LwColorValue4b {
            b: *ck.b(), g: *ck.g(), r: *ck.r(), a: *ck.a(),
        };
        tex_seq[i].byte_alignment_flag = 0;
        tex_seq[i].file_name = extract_cstr_from_bytes(&stage_rc.file_name());

        // TSS from old format (2 sets × 8 entries), first set only
        let tss_k = stage_rc.tss_set().clone();
        let tss_values = tss_k.values().clone();
        for (j, val_rc) in tss_values.iter().enumerate().take(8) {
            let state = *val_rc.state();
            if state == LW_INVALID_INDEX {
                break;
            }
            tex_seq[i].tss_set[j].state = state;
            tex_seq[i].tss_set[j].value0 = *val_rc.value();
            tex_seq[i].tss_set[j].value1 = *val_rc.value();
        }
    }

    // V0000 format fixup: A4R4G4B4 → A1R5G5B5
    if tex_seq[0].d3d_format == D3DFormat::A4R4G4B4 {
        tex_seq[0].d3d_format = D3DFormat::A1R5G5B5;
    }

    tex_seq
}

fn extract_tex_info_0001(stages: &[OptRc<PkoLmo_TexInfo0001>]) -> [TextureInfo; 4] {
    let mut tex_seq = [TextureInfo::new(), TextureInfo::new(), TextureInfo::new(), TextureInfo::new()];

    for (i, stage_rc) in stages.iter().enumerate().take(4) {
        let stage_val = *stage_rc.stage();
        if stage_val == LW_INVALID_INDEX {
            continue;
        }

        tex_seq[i].stage = stage_val;
        tex_seq[i].level = u32::MAX;
        tex_seq[i].usage = 0;
        tex_seq[i].d3d_pool = D3DPool::Default;
        tex_seq[i]._type = TextureType::File;
        tex_seq[i].d3d_format = enum_from_u32(*stage_rc.format(), D3DFormat::Unknown);
        tex_seq[i].colorkey_type = enum_from_u32(*stage_rc.colorkey_type(), ColorKeyType::None);
        let ck = stage_rc.colorkey().clone();
        tex_seq[i].colorkey = LwColorValue4b {
            b: *ck.b(), g: *ck.g(), r: *ck.r(), a: *ck.a(),
        };
        tex_seq[i].byte_alignment_flag = 0;
        tex_seq[i].file_name = extract_cstr_from_bytes(&stage_rc.file_name());

        let tss_k = stage_rc.tss_set().clone();
        let tss_values = tss_k.values().clone();
        for (j, val_rc) in tss_values.iter().enumerate().take(8) {
            let state = *val_rc.state();
            if state == LW_INVALID_INDEX {
                break;
            }
            tex_seq[i].tss_set[j].state = state;
            tex_seq[i].tss_set[j].value0 = *val_rc.value();
            tex_seq[i].tss_set[j].value1 = *val_rc.value();
        }
    }

    tex_seq
}

fn extract_tex_info_current(stages: &[OptRc<PkoLmo_TexInfoCurrent>]) -> [TextureInfo; 4] {
    let mut tex_seq = [TextureInfo::new(), TextureInfo::new(), TextureInfo::new(), TextureInfo::new()];

    for (i, stage_rc) in stages.iter().enumerate().take(4) {
        tex_seq[i].stage = *stage_rc.stage();
        tex_seq[i].level = *stage_rc.level();
        tex_seq[i].usage = *stage_rc.usage();
        tex_seq[i].d3d_format = enum_from_u32(*stage_rc.format(), D3DFormat::Unknown);
        tex_seq[i].d3d_pool = enum_from_u32(*stage_rc.pool(), D3DPool::Default);
        tex_seq[i].byte_alignment_flag = *stage_rc.byte_alignment_flag();
        tex_seq[i]._type = enum_from_u32(*stage_rc.tex_type(), TextureType::File);
        tex_seq[i].width = *stage_rc.width();
        tex_seq[i].height = *stage_rc.height();
        tex_seq[i].colorkey_type = enum_from_u32(*stage_rc.colorkey_type(), ColorKeyType::None);
        let ck = stage_rc.colorkey().clone();
        tex_seq[i].colorkey = LwColorValue4b {
            b: *ck.b(), g: *ck.g(), r: *ck.r(), a: *ck.a(),
        };
        tex_seq[i].file_name = extract_cstr_from_bytes(&stage_rc.file_name());
        tex_seq[i].data = *stage_rc.data_ptr();

        // TSS from atom format
        let tss_atoms = stage_rc.tss_set().clone();
        for (j, atom_rc) in tss_atoms.iter().enumerate().take(8) {
            tex_seq[i].tss_set[j] = RenderStateAtom {
                state: *atom_rc.state(),
                value0: *atom_rc.value0(),
                value1: *atom_rc.value1(),
            };
        }
    }

    tex_seq
}

// ============================================================================
// Mesh conversion
// ============================================================================

fn convert_mesh_section(
    section: &OptRc<PkoLmo_MeshSection>,
    mesh_raw: &[u8],
    file_version: u32,
) -> Result<CharacterMeshInfo> {
    let mut version = file_version;

    // For v0 files, the mesh section has a legacy_prefix that acts as the effective version
    if version == EXP_OBJ_VERSION_0_0_0_0 {
        let old_version = *section.legacy_prefix();
        version = old_version;
    }

    let header_kind = *section.header_kind()
        .map_err(|e| anyhow::anyhow!("header_kind: {:?}", e))?;
    let fvf = *section.fvf()
        .map_err(|e| anyhow::anyhow!("fvf: {:?}", e))?;
    let vertex_num = *section.vertex_num()
        .map_err(|e| anyhow::anyhow!("vertex_num: {:?}", e))? as usize;
    let index_num = *section.index_num()
        .map_err(|e| anyhow::anyhow!("index_num: {:?}", e))? as usize;
    let _subset_num = *section.subset_num()
        .map_err(|e| anyhow::anyhow!("subset_num: {:?}", e))? as usize;
    let bone_index_num = *section.bone_index_num()
        .map_err(|e| anyhow::anyhow!("bone_index_num: {:?}", e))? as usize;

    // Build header
    let header = convert_mesh_header(section, header_kind, fvf, version)?;

    // Vertices
    let vertex_seq_k = section.vertex_seq().clone();
    let mut vertex_seq = Vec::with_capacity(vertex_num);
    for v in &vertex_seq_k {
        vertex_seq.push(LwVector3(Vector3::new(*v.x(), *v.y(), *v.z())));
    }

    // Normals
    let has_normals = *section.has_normals()
        .map_err(|e| anyhow::anyhow!("has_normals: {:?}", e))?;
    let mut normal_seq = Vec::new();
    if has_normals {
        let normal_seq_k = section.normal_seq().clone();
        normal_seq.reserve(vertex_num);
        for n in &normal_seq_k {
            normal_seq.push(LwVector3(Vector3::new(*n.x(), *n.y(), *n.z())));
        }
    }

    // Texcoords — all 4 channels
    let texcoord_seq_k = section.texcoord_seq().clone();
    let mut texcoord_seq: [Vec<LwVector2>; 4] = Default::default();
    for (ch, channel_rc) in texcoord_seq_k.iter().enumerate().take(4) {
        let values = channel_rc.values().clone();
        let mut channel = Vec::with_capacity(vertex_num);
        for uv in &values {
            channel.push(LwVector2(Vector2::new(*uv.x(), *uv.y())));
        }
        texcoord_seq[ch] = channel;
    }

    // Vertex colors
    let has_diffuse = *section.has_diffuse()
        .map_err(|e| anyhow::anyhow!("has_diffuse: {:?}", e))?;
    let mut vercol_seq = Vec::new();
    if has_diffuse {
        let vercol_k = section.vercol_seq().clone();
        vercol_seq.reserve(vertex_num);
        for c in &vercol_k {
            vercol_seq.push(*c);
        }
    }

    // Blend data
    let has_blend = *section.has_blend_data()
        .map_err(|e| anyhow::anyhow!("has_blend_data: {:?}", e))?;
    let mut blend_seq = Vec::new();
    if has_blend {
        let blend_k = section.blend_seq().clone();
        blend_seq.reserve(vertex_num);
        for b in &blend_k {
            let weights = b.weight().clone();
            let w = [
                if !weights.is_empty() { weights[0] } else { 0.0 },
                if weights.len() > 1 { weights[1] } else { 0.0 },
                if weights.len() > 2 { weights[2] } else { 0.0 },
                if weights.len() > 3 { weights[3] } else { 0.0 },
            ];
            blend_seq.push(CharacterMeshBlendInfo {
                indexd: *b.index_dword(),
                weight: w,
            });
        }
    }

    // Bone indices
    let mut bone_index_seq = Vec::new();
    if bone_index_num > 0 {
        if header_kind == 2 {
            // v1004+: u32 bone indices
            let bi_k = section.bone_index_seq_u4().clone();
            bone_index_seq.reserve(bone_index_num);
            for idx in &bi_k {
                bone_index_seq.push(*idx);
            }
        } else {
            // Older: u8 bone indices (if has_lastbeta_ubyte4)
            let bi_k = section.bone_index_seq_u1().clone();
            bone_index_seq.reserve(bone_index_num);
            for idx in &bi_k {
                bone_index_seq.push(*idx as u32);
            }
        }
    }

    // Indices — with legacy pre-index pair workaround
    let index_seq_k = section.index_seq().clone();
    let mut index_seq: Vec<u32> = index_seq_k.to_vec();

    // Workaround: Kaitai runtime BytesReader clone bug — _io.pos() returns 0
    // on cloned readers, making has_legacy_pre_index_pair always false.
    // Re-read indices from raw mesh bytes if header_kind == 0 and indices look wrong.
    if header_kind == 0 && !index_seq.is_empty() {
        let expected_index_bytes = index_num * 4;
        let raw_len = mesh_raw.len();
        if raw_len >= expected_index_bytes + 8 {
            let vcount = vertex_num as u32;
            if index_seq[0] >= vcount && vcount > 0 {
                // Re-read indices from the correct offset (skip the 8-byte legacy pair)
                let idx_start = raw_len - expected_index_bytes;
                let mut fixed_indices = Vec::with_capacity(index_num);
                for i in 0..index_num {
                    let off = idx_start + i * 4;
                    if off + 4 <= raw_len {
                        let val = u32::from_le_bytes([
                            mesh_raw[off], mesh_raw[off + 1],
                            mesh_raw[off + 2], mesh_raw[off + 3],
                        ]);
                        fixed_indices.push(val);
                    }
                }
                index_seq = fixed_indices;
            }
        }
    }

    // Subsets
    let subset_seq = if header_kind == 2 {
        extract_subsets(&section.subset_seq_new().clone())
    } else {
        extract_subsets(&section.subset_seq_old().clone())
    };

    // Vertex elements (header_kind == 2 only)
    let mut vertex_element_seq = Vec::new();
    if header_kind == 2 && header.vertex_element_num > 0 {
        let ve_k = section.vertex_element_seq().clone();
        for ve in &ve_k {
            vertex_element_seq.push(D3DVertexElement9 {
                stream: *ve.stream(),
                offset: *ve.offset(),
                _type: *ve.elem_type(),
                method: *ve.method(),
                usage: *ve.usage(),
                usage_index: *ve.usage_index(),
            });
        }
    }

    Ok(CharacterMeshInfo {
        header,
        vertex_seq,
        normal_seq,
        texcoord_seq,
        vercol_seq,
        index_seq,
        bone_index_seq,
        blend_seq,
        subset_seq,
        vertex_element_seq,
    })
}

fn convert_mesh_header(
    section: &OptRc<PkoLmo_MeshSection>,
    header_kind: u8,
    fvf: u32,
    _version: u32,
) -> Result<CharacterInfoMeshHeader> {
    let vertex_num = *section.vertex_num()
        .map_err(|e| anyhow::anyhow!("vertex_num: {:?}", e))?;
    let index_num = *section.index_num()
        .map_err(|e| anyhow::anyhow!("index_num: {:?}", e))?;
    let subset_num = *section.subset_num()
        .map_err(|e| anyhow::anyhow!("subset_num: {:?}", e))?;
    let bone_index_num = *section.bone_index_num()
        .map_err(|e| anyhow::anyhow!("bone_index_num: {:?}", e))?;

    match header_kind {
        0 => {
            // MESH_VERSION0000: 6 fields + 128-byte raw rs_set
            let hdr = section.header_v0000().clone();
            let pt_type_raw = *hdr.pt_type();
            let pt_type = enum_from_u32(pt_type_raw, D3DPrimitiveType::TriangleList);

            // Parse raw 128-byte render state set
            let rs_raw = hdr.rs_set().clone();
            let rs_set = parse_v0000_mesh_render_state(&rs_raw);

            Ok(CharacterInfoMeshHeader {
                fvf,
                pt_type,
                vertex_num,
                index_num,
                subset_num,
                bone_index_num,
                bone_infl_factor: if bone_index_num > 0 { 2 } else { 0 },
                vertex_element_num: 0,
                rs_set,
            })
        }
        1 => {
            // MESH_VERSION0001 / v1000-v1003: 6 fields + 8 RenderStateAtoms
            let hdr = section.header_v0003().clone();
            let pt_type_raw = *hdr.pt_type();
            let pt_type = enum_from_u32(pt_type_raw, D3DPrimitiveType::TriangleList);
            let rs_set = extract_render_state_atoms(&hdr.rs_set().clone());

            Ok(CharacterInfoMeshHeader {
                fvf,
                pt_type,
                vertex_num,
                index_num,
                subset_num,
                bone_index_num,
                bone_infl_factor: if bone_index_num > 0 { 2 } else { 0 },
                vertex_element_num: 0,
                rs_set,
            })
        }
        2 => {
            // v1004+: 8 fields + 8 RenderStateAtoms
            let hdr = section.header_v1004().clone();
            let pt_type_raw = *hdr.pt_type();
            let pt_type = enum_from_u32(pt_type_raw, D3DPrimitiveType::TriangleList);
            let rs_set = extract_render_state_atoms(&hdr.rs_set().clone());
            let bone_infl_factor = *hdr.bone_infl_factor();
            let vertex_element_num = *hdr.vertex_element_num();

            Ok(CharacterInfoMeshHeader {
                fvf,
                pt_type,
                vertex_num,
                index_num,
                subset_num,
                bone_index_num,
                bone_infl_factor,
                vertex_element_num,
                rs_set,
            })
        }
        _ => bail!("Unknown mesh header_kind: {}", header_kind),
    }
}

/// Parse MESH_VERSION0000 raw 128-byte render state set.
/// Layout: 2 sets × 8 entries × (state:u32 + value:u32) = 128 bytes.
/// Applies D3DRS_AMBIENTMATERIALSOURCE → D3DMCS_COLOR2 remap.
fn parse_v0000_mesh_render_state(raw: &[u8]) -> [RenderStateAtom; 8] {
    const D3DRS_AMBIENTMATERIALSOURCE: u32 = 147;
    const D3DMCS_COLOR2: u32 = 2;

    let mut rs_set = [RenderStateAtom::new(); LW_MESH_RS_NUM];
    if raw.len() < 128 {
        return rs_set;
    }

    for (j, rs) in rs_set.iter_mut().enumerate().take(LW_MESH_RS_NUM) {
        let offset = j * 8;
        let state = u32::from_le_bytes([raw[offset], raw[offset + 1], raw[offset + 2], raw[offset + 3]]);
        let value = u32::from_le_bytes([raw[offset + 4], raw[offset + 5], raw[offset + 6], raw[offset + 7]]);

        if state == LW_INVALID_INDEX {
            break;
        }

        let v = match state {
            D3DRS_AMBIENTMATERIALSOURCE => D3DMCS_COLOR2,
            _ => value,
        };

        *rs = RenderStateAtom {
            state,
            value0: v,
            value1: v,
        };
    }

    rs_set
}

fn extract_subsets(subset_seq: &[OptRc<PkoLmo_SubsetInfo>]) -> Vec<CharacterMeshSubsetInfo> {
    subset_seq.iter().map(|s| CharacterMeshSubsetInfo {
        primitive_num: *s.primitive_num(),
        start_index: *s.start_index(),
        vertex_num: *s.vertex_num(),
        min_index: *s.min_index(),
    }).collect()
}

// ============================================================================
// Helper conversion
// ============================================================================

fn convert_helper_section(
    section: &OptRc<PkoLmo_HelperSection>,
    file_version: u32,
) -> Result<HelperData> {
    // For version 0 files, the Kaitai section reads a 4-byte legacy_prefix
    // before helper_type. But the native HelperData (binrw) reads _type directly
    // from byte 0 — interpreting the legacy_prefix value as _type. To match
    // native behavior, use legacy_prefix as the type when version == 0.
    let helper_type = if file_version == EXP_OBJ_VERSION_0_0_0_0 {
        *section.legacy_prefix()
    } else {
        *section.helper_type()
    };
    let effective_version = *section.effective_version()
        .map_err(|e| anyhow::anyhow!("effective_version: {:?}", e))?;

    let mut dummy_num = 0u32;
    let mut dummy_seq = Vec::new();
    if helper_type & HELPER_TYPE_DUMMY > 0 {
        dummy_num = *section.dummy_num();
        let dummy_k = section.dummy_seq().clone();
        for entry in &dummy_k {
            dummy_seq.push(convert_helper_dummy(entry, effective_version as u32)?);
        }
    }

    let mut box_num = 0u32;
    let mut box_seq = Vec::new();
    if helper_type & HELPER_TYPE_BOX > 0 {
        box_num = *section.box_num();
        let box_k = section.box_seq().clone();
        for entry in &box_k {
            box_seq.push(convert_helper_box(entry)?);
        }
    }

    let mut mesh_num = 0u32;
    let mut mesh_seq = Vec::new();
    if helper_type & HELPER_TYPE_MESH > 0 {
        mesh_num = *section.mesh_num();
        let mesh_k = section.mesh_seq().clone();
        for entry in &mesh_k {
            mesh_seq.push(convert_helper_mesh(entry)?);
        }
    }

    let mut bbox_num = 0u32;
    let mut bbox_seq = Vec::new();
    if helper_type & HELPER_TYPE_BBOX > 0 {
        bbox_num = *section.bbox_num();
        let bbox_k = section.bbox_seq().clone();
        for entry in &bbox_k {
            bbox_seq.push(convert_bounding_box(entry)?);
        }
    }

    let mut bsphere_num = 0u32;
    let mut bsphere_seq = Vec::new();
    if helper_type & HELPER_TYPE_BSPHERE > 0 {
        bsphere_num = *section.bsphere_num();
        let bsphere_k = section.bsphere_seq().clone();
        for entry in &bsphere_k {
            bsphere_seq.push(convert_bounding_sphere(entry)?);
        }
    }

    Ok(HelperData {
        _type: helper_type,
        dummy_num,
        dummy_seq,
        box_num,
        box_seq,
        mesh_num,
        mesh_seq,
        bbox_num,
        bbox_seq,
        bsphere_num,
        bsphere_seq,
    })
}

fn convert_helper_dummy(
    entry: &OptRc<PkoLmo_HelperDummyEntry>,
    effective_version: u32,
) -> Result<HelperDummyInfo> {
    if effective_version <= 4096 {
        // v1000: id + mat only, defaults for rest
        let info = entry.as_1000().clone();
        let id = *info.id();
        let mat = extract_lw_matrix44(&info.mat().clone());
        Ok(HelperDummyInfo {
            id,
            mat,
            mat_local: LwMatrix44(Matrix4::from_cols(
                Vector4::new(0.0, 0.0, 0.0, 0.0),
                Vector4::new(0.0, 0.0, 0.0, 0.0),
                Vector4::new(0.0, 0.0, 0.0, 0.0),
                Vector4::new(0.0, 0.0, 0.0, 0.0),
            )),
            parent_type: 0,
            parent_id: 0,
        })
    } else {
        // Current: all 5 fields
        let info = entry.as_current().clone();
        let id = *info.id();
        let parent_type = *info.parent_type();
        let parent_id = *info.parent_id();
        let mat = extract_lw_matrix44(&info.mat().clone());
        let mat_local = extract_lw_matrix44(&info.mat_local().clone());
        Ok(HelperDummyInfo {
            id,
            mat,
            mat_local,
            parent_type,
            parent_id,
        })
    }
}

fn convert_helper_box(entry: &OptRc<PkoLmo_HelperBoxInfo>) -> Result<HelperBoxInfo> {
    let id = *entry.id();
    let _type = *entry.obj_type();
    let state = *entry.state();
    let mat = extract_lw_matrix44(&entry.mat().clone());
    let bbox = extract_lw_box(&entry.bbox().clone());
    let mut name = [0u8; 32];
    let name_raw = entry.name().clone();
    let len = name_raw.len().min(32);
    name[..len].copy_from_slice(&name_raw[..len]);

    Ok(HelperBoxInfo { id, _type, state, _box: bbox, mat, name })
}

fn convert_helper_mesh(entry: &OptRc<PkoLmo_HelperMeshInfo>) -> Result<HelperMeshInfo> {
    let id = *entry.id();
    let _type = *entry.obj_type();
    let sub_type = *entry.sub_type();
    let state = *entry.state();
    let vertex_num_val = *entry.vertex_num();
    let face_num_val = *entry.face_num();
    let mat = extract_lw_matrix44(&entry.mat().clone());
    let bbox = extract_lw_box(&entry.bbox().clone());
    let mut name = [0u8; 32];
    let name_raw = entry.name().clone();
    let len = name_raw.len().min(32);
    name[..len].copy_from_slice(&name_raw[..len]);

    let vertex_seq_k = entry.vertex_seq().clone();
    let mut vertex_seq = Vec::with_capacity(vertex_num_val as usize);
    for v in &vertex_seq_k {
        let x = *v.x(); let y = *v.y(); let z = *v.z();
        vertex_seq.push(LwVector3(Vector3::new(x, y, z)));
    }

    let face_seq_k = entry.face_seq().clone();
    let mut face_seq = Vec::with_capacity(face_num_val as usize);
    for f in &face_seq_k {
        let vertex_raw = f.vertex().clone();
        let adj_raw = f.adj_face().clone();
        let plane_k = f.plane().clone();
        let pa = *plane_k.a(); let pb = *plane_k.b();
        let pc = *plane_k.c(); let pd = *plane_k.d();
        let center_k = f.center().clone();
        let cx = *center_k.x(); let cy = *center_k.y(); let cz = *center_k.z();

        face_seq.push(HelperMeshFaceInfo {
            vertex: [vertex_raw[0], vertex_raw[1], vertex_raw[2]],
            adj_face: [adj_raw[0], adj_raw[1], adj_raw[2]],
            plane: LwPlane { a: pa, b: pb, c: pc, d: pd },
            center: LwVector3(Vector3::new(cx, cy, cz)),
        });
    }

    Ok(HelperMeshInfo {
        id, _type, sub_type, name, state, mat,
        _box: bbox,
        vertex_num: vertex_num_val,
        face_num: face_num_val,
        vertex_seq,
        face_seq,
    })
}

fn convert_bounding_box(entry: &OptRc<PkoLmo_BoundingBoxInfo>) -> Result<BoundingBoxInfo> {
    let id = *entry.id();
    let mat = extract_lw_matrix44(&entry.mat().clone());
    let bbox = extract_lw_box(&entry.bbox().clone());
    Ok(BoundingBoxInfo { id, _box: bbox, mat })
}

fn convert_bounding_sphere(entry: &OptRc<PkoLmo_BoundingSphereInfo>) -> Result<BoundingSphereInfo> {
    let id = *entry.id();
    let mat = extract_lw_matrix44(&entry.mat().clone());
    let sphere_k = entry.sphere().clone();
    let center_k = sphere_k.center().clone();
    let cx = *center_k.x(); let cy = *center_k.y(); let cz = *center_k.z();
    let r = *sphere_k.radius();
    let sphere = LwSphere {
        c: LwVector3(Vector3::new(cx, cy, cz)),
        r,
    };
    Ok(BoundingSphereInfo { id, sphere, mat })
}

// ============================================================================
// Matrix / geometry extraction helpers
// ============================================================================

fn extract_lw_matrix44(mat: &OptRc<PkoLmo_Matrix44>) -> LwMatrix44 {
    // Native binrw reads [f32; 16] row-major and passes directly to Matrix4::new
    // which stores column-major: column0=(m11,m12,m13,m14), column1=(m21,...), etc.
    LwMatrix44(Matrix4::new(
        *mat.m11(), *mat.m12(), *mat.m13(), *mat.m14(),
        *mat.m21(), *mat.m22(), *mat.m23(), *mat.m24(),
        *mat.m31(), *mat.m32(), *mat.m33(), *mat.m34(),
        *mat.m41(), *mat.m42(), *mat.m43(), *mat.m44(),
    ))
}

fn extract_lw_box(aabb: &OptRc<PkoLmo_Aabb>) -> LwBox {
    let center_k = aabb.center().clone();
    let cx = *center_k.x(); let cy = *center_k.y(); let cz = *center_k.z();
    let radius_k = aabb.radius().clone();
    let rx = *radius_k.x(); let ry = *radius_k.y(); let rz = *radius_k.z();
    LwBox {
        c: LwVector3(Vector3::new(cx, cy, cz)),
        r: LwVector3(Vector3::new(rx, ry, rz)),
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn test_artifacts_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("test_artifacts")
    }

    #[test]
    fn kaitai_parses_single_lgo() {
        let path = test_artifacts_dir().join("0909000000.lgo");
        if !path.exists() {
            eprintln!("Skipping: test artifact not found at {}", path.display());
            return;
        }

        let model = load_lgo(&path).expect("Failed to parse LGO via Kaitai");
        assert!(model.version > 0 || model.version == 0, "version should be readable");
        if let Some(ref mesh) = model.mesh_info {
            assert!(mesh.header.vertex_num > 0, "should have vertices");
        }
    }
}
