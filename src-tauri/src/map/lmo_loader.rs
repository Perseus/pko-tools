use std::path::Path;

use anyhow::{Context, Result, bail};

use super::lmo::{
    LmoAnimData, LmoGeomObject, LmoMaterial, LmoModel, LmoMtlOpacAnim, LmoOpacityKeyframe,
    LmoSubset, LmoTexImgAnim, LmoTexUvAnim, MaterialRenderState,
    D3DRS_ALPHATESTENABLE, D3DRS_SRCBLEND, D3DRS_DESTBLEND, D3DRS_ALPHAREF,
    D3DRS_CULLMODE, D3DRS_ALPHAFUNC, D3DCMP_GREATER, TRANSP_FILTER, TRANSP_SUBTRACTIVE,
    decompose_matrix43,
};

use crate::kaitai_gen::pko_lmo::*;
use kaitai::*;

const ENV_LMO_PARSER: &str = "PKO_LMO_PARSER";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LmoParserBackend {
    Native,
    Kaitai,
}

fn parse_lmo_backend(raw: Option<&str>) -> LmoParserBackend {
    match raw.map(|v| v.trim().to_ascii_lowercase()) {
        Some(v) if v == "kaitai" || v == "ksy" => LmoParserBackend::Kaitai,
        _ => LmoParserBackend::Native,
    }
}

pub fn selected_lmo_backend() -> LmoParserBackend {
    let raw = std::env::var(ENV_LMO_PARSER).ok();
    parse_lmo_backend(raw.as_deref())
}

pub fn load_lmo(path: &Path) -> Result<LmoModel> {
    match selected_lmo_backend() {
        LmoParserBackend::Native => super::lmo::load_lmo(path),
        LmoParserBackend::Kaitai => load_lmo_kaitai(path, true),
    }
}

pub fn load_lmo_no_animation(path: &Path) -> Result<LmoModel> {
    match selected_lmo_backend() {
        LmoParserBackend::Native => super::lmo::load_lmo_no_animation(path),
        LmoParserBackend::Kaitai => load_lmo_kaitai(path, false),
    }
}

fn load_lmo_kaitai(path: &Path, parse_animations: bool) -> Result<LmoModel> {
    let data = std::fs::read(path)
        .with_context(|| format!("Failed to read LMO file: {}", path.display()))?;
    kaitai_to_lmo(&data, parse_animations)
}

// ============================================================================
// Kaitai → Domain adapter
// ============================================================================

/// Material format version — matches the native parser's MtlFormatVersion enum.
#[derive(Debug, Clone, Copy, PartialEq)]
enum MtlFormat {
    V0000,
    V0001,
    Current,
}

/// Convert raw Kaitai-parsed LMO data into domain types.
pub(crate) fn kaitai_to_lmo(data: &[u8], parse_animations: bool) -> Result<LmoModel> {
    if data.len() < 8 {
        bail!("LMO file too small ({} bytes)", data.len());
    }

    // Check for lwModelInfo tree — reject these files (native parser doesn't handle them)
    if data.len() >= 19 && &data[8..19] == b"lwModelInfo" {
        bail!("lwModelInfo tree files are not supported");
    }

    // Parse using Kaitai runtime
    let reader = BytesReader::from(data.to_vec());
    let pko_lmo = PkoLmo::read_into::<_, PkoLmo>(&reader, None, None)
        .map_err(|e| anyhow::anyhow!("Kaitai parse error: {:?}", e))?;

    let version = *pko_lmo.version();
    let objects = pko_lmo.objects().clone();

    let mut geom_objects = Vec::new();

    for entry_rc in &objects {
        let obj_type = *entry_rc.obj_type();
        if obj_type != 1 {
            continue; // skip non-geometry objects (helpers, etc.)
        }

        // Access geometry chunk via lazy instance
        let body_opt = entry_rc.body_geometry()
            .map_err(|e| anyhow::anyhow!("Kaitai body_geometry error: {:?}", e))?
            .clone();

        if body_opt.is_none() {
            continue;
        }

        match convert_geometry_chunk(&body_opt, version, parse_animations) {
            Ok(geom) => geom_objects.push(geom),
            Err(e) => {
                eprintln!("Warning: failed to convert geometry chunk: {}", e);
            }
        }
    }

    Ok(LmoModel {
        version,
        geom_objects,
    })
}

/// Convert a Kaitai geometry chunk into an LmoGeomObject.
fn convert_geometry_chunk(
    chunk: &OptRc<PkoLmo_GeometryChunk>,
    file_version: u32,
    parse_animations: bool,
) -> Result<LmoGeomObject> {
    let header = chunk.header().clone();

    // Extract header fields
    let id = *header.id()
        .map_err(|e| anyhow::anyhow!("header.id error: {:?}", e))?;
    let parent_id = *header.parent_id()
        .map_err(|e| anyhow::anyhow!("header.parent_id error: {:?}", e))?;
    let obj_type = *header.geom_type()
        .map_err(|e| anyhow::anyhow!("header.geom_type error: {:?}", e))?;

    // Extract mat_local (4x4 matrix)
    let mat_local_rc = header.mat_local()
        .map_err(|e| anyhow::anyhow!("header.mat_local error: {:?}", e))?
        .clone();
    let mat_local = extract_matrix44(&mat_local_rc);

    // Parse materials
    let mtl_size = *header.mtl_size()
        .map_err(|e| anyhow::anyhow!("header.mtl_size error: {:?}", e))?;
    let mut materials = if mtl_size > 0 {
        let mtl_section = chunk.material().clone();
        convert_material_section(&mtl_section, file_version)?
    } else {
        Vec::new()
    };

    // Parse mesh
    let mesh_size = *header.mesh_size()
        .map_err(|e| anyhow::anyhow!("header.mesh_size error: {:?}", e))?;
    let (vertices, normals, texcoords, vertex_colors, indices, subsets, mesh_alpha) = if mesh_size > 0 {
        let mesh_section = chunk.mesh().clone();
        convert_mesh_section(&mesh_section, file_version)?
    } else {
        (Vec::new(), Vec::new(), Vec::new(), Vec::new(), Vec::new(), Vec::new(), MaterialRenderState::default())
    };

    // Mesh-level alpha promotion to materials (semantic parity #1)
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

    // Parse animations
    let anim_size = *header.anim_size()
        .map_err(|e| anyhow::anyhow!("header.anim_size error: {:?}", e))?;
    let (animation, texuv_anims, teximg_anims, mtlopac_anims) =
        if parse_animations && anim_size > 0 {
            let anim_section = chunk.anim().clone();
            convert_anim_section(&anim_section, file_version)?
        } else {
            (None, Vec::new(), Vec::new(), Vec::new())
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
        animation,
        texuv_anims,
        teximg_anims,
        mtlopac_anims,
    })
}

// ============================================================================
// Material conversion
// ============================================================================

fn convert_material_section(
    section: &OptRc<PkoLmo_MaterialSection>,
    _file_version: u32,
) -> Result<Vec<LmoMaterial>> {
    // Determine material format version — mirrors native parser logic
    let format_hint = *section.format_hint()
        .map_err(|e| anyhow::anyhow!("format_hint error: {:?}", e))?;
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
) -> Result<LmoMaterial> {
    match mtl_format {
        MtlFormat::V0000 => {
            let info = entry.as_0000().clone();
            convert_mtl_0000(&info)
        }
        MtlFormat::V0001 => {
            let info = entry.as_0001().clone();
            convert_mtl_0001(&info)
        }
        MtlFormat::Current => {
            let info = entry.as_current().clone();
            convert_mtl_current(&info)
        }
    }
}

/// Convert V0000 material (no opacity/transp, old render state set).
fn convert_mtl_0000(info: &OptRc<PkoLmo_MtlTexInfo0000>) -> Result<LmoMaterial> {
    // V0000: hardcoded opacity=1.0, transp=TRANSP_FILTER
    let opacity = 1.0f32;
    let transp_type = TRANSP_FILTER;

    // Material colors
    let mtl = info.mtl().clone();
    let (diffuse, ambient, emissive) = extract_material_colors(&mtl);

    // Render states — V0000 uses old format with forced alpha values
    let rs = read_old_format_render_state(&info.rs_set().clone());

    // Texture filename — stage 0 only
    let tex_filename = extract_tex_filename_0000(&info.tex_seq().clone());

    build_lmo_material(opacity, transp_type, diffuse, ambient, emissive, rs, tex_filename)
}

/// Convert V0001 material (has opacity/transp, old render state set).
fn convert_mtl_0001(info: &OptRc<PkoLmo_MtlTexInfo0001>) -> Result<LmoMaterial> {
    let opacity = *info.opacity();
    let mut transp_type = *info.transp_type();

    // Semantic parity #2: V0001 transp_type remap
    if transp_type == 2 {
        transp_type = TRANSP_SUBTRACTIVE; // 5
    }

    let mtl = info.mtl().clone();
    let (diffuse, ambient, emissive) = extract_material_colors(&mtl);

    // Render states — V0001 uses old format with forced alpha values
    let rs = read_old_format_render_state(&info.rs_set().clone());

    // Texture filename — stage 0 only
    let tex_filename = extract_tex_filename_0001(&info.tex_seq().clone());

    build_lmo_material(opacity, transp_type, diffuse, ambient, emissive, rs, tex_filename)
}

/// Convert Current-format material (has opacity/transp, new render state atoms).
fn convert_mtl_current(info: &OptRc<PkoLmo_MtlTexInfoCurrent>) -> Result<LmoMaterial> {
    let opacity = *info.opacity();
    let transp_type = *info.transp_type();

    let mtl = info.mtl().clone();
    let (diffuse, ambient, emissive) = extract_material_colors(&mtl);

    // Render states — Current uses atom format
    let rs = read_current_render_state_atoms(&info.rs_set().clone());

    // Texture filename — stage 0 only
    let tex_filename = extract_tex_filename_current(&info.tex_seq().clone());

    build_lmo_material(opacity, transp_type, diffuse, ambient, emissive, rs, tex_filename)
}

fn build_lmo_material(
    opacity: f32,
    transp_type: u32,
    diffuse: [f32; 4],
    ambient: [f32; 4],
    emissive: [f32; 4],
    rs: MaterialRenderState,
    tex_filename: Option<String>,
) -> Result<LmoMaterial> {
    let alpha_test_enabled = rs.normalized_alpha_enabled();
    let alpha_ref = if alpha_test_enabled {
        rs.effective_alpha_ref()
    } else {
        rs.alpha_ref.unwrap_or(0)
    };

    Ok(LmoMaterial {
        diffuse,
        ambient,
        emissive,
        opacity,
        transp_type,
        alpha_test_enabled,
        alpha_ref,
        src_blend: rs.src_blend,
        dest_blend: rs.dest_blend,
        cull_mode: rs.cull_mode,
        tex_filename,
    })
}

fn extract_material_colors(
    mtl: &OptRc<PkoLmo_Material>,
) -> ([f32; 4], [f32; 4], [f32; 4]) {
    let dif = mtl.dif().clone();
    let diffuse = [*dif.r(), *dif.g(), *dif.b(), *dif.a()];

    let amb = mtl.amb().clone();
    let ambient = [*amb.r(), *amb.g(), *amb.b(), *amb.a()];

    let emi = mtl.emi().clone();
    let emissive = [*emi.r(), *emi.g(), *emi.b(), *emi.a()];

    (diffuse, ambient, emissive)
}

/// Read old-format render state set (V0000/V0001).
/// Semantic parity #3: forces ALPHAREF=129, ALPHAFUNC=D3DCMP_GREATER
fn read_old_format_render_state(
    rs_set: &OptRc<PkoLmo_RenderStateSet28>,
) -> MaterialRenderState {
    let mut rs = MaterialRenderState::default();
    let values = rs_set.values().clone();

    // The old format has 2 sets × 8 entries = 16 render_state_value entries.
    // Only process the first 8 (set 0).
    for (i, val_rc) in values.iter().enumerate() {
        if i >= 8 { break; }
        let state = *val_rc.state();
        let value = *val_rc.value();

        if state == super::lmo::LW_INVALID_INDEX {
            continue; // end sentinel
        }

        match state {
            D3DRS_ALPHATESTENABLE => {
                rs.alpha_enabled = value != 0;
            }
            D3DRS_SRCBLEND => {
                rs.src_blend = Some(value);
            }
            D3DRS_DESTBLEND => {
                rs.dest_blend = Some(value);
            }
            D3DRS_ALPHAREF => {
                // Semantic parity #3: force 129 for old formats
                rs.alpha_ref = Some(129);
            }
            D3DRS_CULLMODE => {
                rs.cull_mode = Some(value);
            }
            D3DRS_ALPHAFUNC => {
                // Semantic parity #3: force D3DCMP_GREATER for old formats
                rs.alpha_func = Some(D3DCMP_GREATER);
            }
            _ => {}
        }
    }

    rs
}

/// Read current-format render state atoms.
fn read_current_render_state_atoms(
    atoms: &Vec<OptRc<PkoLmo_RenderStateAtom>>,
) -> MaterialRenderState {
    let mut rs = MaterialRenderState::default();

    for atom_rc in atoms {
        let state = *atom_rc.state();
        let value0 = *atom_rc.value0();

        match state {
            D3DRS_ALPHATESTENABLE => {
                rs.alpha_enabled = value0 != 0;
            }
            D3DRS_SRCBLEND => {
                rs.src_blend = Some(value0);
            }
            D3DRS_DESTBLEND => {
                rs.dest_blend = Some(value0);
            }
            D3DRS_ALPHAREF => {
                rs.alpha_ref = Some((value0 & 0xFF) as u8);
            }
            D3DRS_CULLMODE => {
                rs.cull_mode = Some(value0);
            }
            D3DRS_ALPHAFUNC => {
                rs.alpha_func = Some(value0);
            }
            _ => {}
        }
    }

    rs
}

/// Extract texture filename from stage 0 of a 64-byte fixed buffer (null-terminated).
fn extract_cstr_from_bytes(raw: &[u8]) -> Option<String> {
    let end = raw.iter().position(|&b| b == 0).unwrap_or(raw.len());
    let s = String::from_utf8_lossy(&raw[..end]).to_string();
    if s.is_empty() { None } else { Some(s) }
}

fn extract_tex_filename_0000(stages: &[OptRc<PkoLmo_TexInfo0000>]) -> Option<String> {
    if stages.is_empty() { return None; }
    let stage0 = &stages[0];
    extract_cstr_from_bytes(&stage0.file_name())
}

fn extract_tex_filename_0001(stages: &[OptRc<PkoLmo_TexInfo0001>]) -> Option<String> {
    if stages.is_empty() { return None; }
    let stage0 = &stages[0];
    extract_cstr_from_bytes(&stage0.file_name())
}

fn extract_tex_filename_current(stages: &[OptRc<PkoLmo_TexInfoCurrent>]) -> Option<String> {
    if stages.is_empty() { return None; }
    let stage0 = &stages[0];
    extract_cstr_from_bytes(&stage0.file_name())
}

// ============================================================================
// Mesh conversion
// ============================================================================

#[allow(clippy::type_complexity)]
fn convert_mesh_section(
    section: &OptRc<PkoLmo_MeshSection>,
    _file_version: u32,
) -> Result<(Vec<[f32; 3]>, Vec<[f32; 3]>, Vec<[f32; 2]>, Vec<u32>, Vec<u32>, Vec<LmoSubset>, MaterialRenderState)> {
    let vertex_num = *section.vertex_num()
        .map_err(|e| anyhow::anyhow!("vertex_num error: {:?}", e))? as usize;
    let _fvf = *section.fvf()
        .map_err(|e| anyhow::anyhow!("fvf error: {:?}", e))?;
    let header_kind = *section.header_kind()
        .map_err(|e| anyhow::anyhow!("header_kind error: {:?}", e))?;

    // Vertices
    let vertex_seq = section.vertex_seq().clone();
    let mut vertices = Vec::with_capacity(vertex_num);
    for v in &vertex_seq {
        vertices.push([*v.x(), *v.y(), *v.z()]);
    }

    // Normals
    let has_normals = *section.has_normals()
        .map_err(|e| anyhow::anyhow!("has_normals error: {:?}", e))?;
    let mut normals = Vec::new();
    if has_normals {
        let normal_seq = section.normal_seq().clone();
        normals.reserve(vertex_num);
        for n in &normal_seq {
            normals.push([*n.x(), *n.y(), *n.z()]);
        }
    }

    // Texcoords — channel 0 only (semantic parity #5)
    let texcoord_seq = section.texcoord_seq().clone();
    let mut texcoords = Vec::new();
    if !texcoord_seq.is_empty() {
        let channel0 = &texcoord_seq[0];
        let values = channel0.values().clone();
        texcoords.reserve(vertex_num);
        for uv in &values {
            texcoords.push([*uv.x(), *uv.y()]);
        }
    }

    // Vertex colors
    let has_diffuse = *section.has_diffuse()
        .map_err(|e| anyhow::anyhow!("has_diffuse error: {:?}", e))?;
    let mut vertex_colors = Vec::new();
    if has_diffuse {
        let vercol_seq = section.vercol_seq().clone();
        vertex_colors.reserve(vertex_num);
        for c in &vercol_seq {
            vertex_colors.push(*c);
        }
    }

    // Indices
    let index_seq = section.index_seq().clone();
    let mut indices = Vec::with_capacity(index_seq.len());
    for idx in &index_seq {
        indices.push(*idx);
    }

    // Subsets — new format puts them after indices, old format before vertices
    let subsets = if header_kind == 2 {
        // new format (v1004+)
        extract_subsets(&section.subset_seq_new().clone())
    } else {
        // old format
        extract_subsets(&section.subset_seq_old().clone())
    };

    // Mesh-level render states
    let mesh_alpha = extract_mesh_render_state(section, header_kind as i32)?;

    Ok((vertices, normals, texcoords, vertex_colors, indices, subsets, mesh_alpha))
}

fn extract_subsets(subset_seq: &[OptRc<PkoLmo_SubsetInfo>]) -> Vec<LmoSubset> {
    subset_seq.iter().map(|s| LmoSubset {
        primitive_num: *s.primitive_num(),
        start_index: *s.start_index(),
        vertex_num: *s.vertex_num(),
        min_index: *s.min_index(),
    }).collect()
}

fn extract_mesh_render_state(
    section: &OptRc<PkoLmo_MeshSection>,
    header_kind: i32,
) -> Result<MaterialRenderState> {
    match header_kind {
        0 => {
            // V0000 mesh header — old format render state set (128 bytes raw)
            // The Kaitai parser reads this as a raw 128-byte `rs_set` field.
            // We parse the raw bytes manually.
            let hdr = section.header_v0000().clone();
            let rs_raw = hdr.rs_set().clone();
            Ok(parse_old_rs_from_raw_bytes(&rs_raw))
        }
        1 => {
            // V0003 mesh header — atom format
            let hdr = section.header_v0003().clone();
            let atoms = hdr.rs_set().clone();
            Ok(read_current_render_state_atoms(&atoms))
        }
        2 => {
            // V1004 mesh header — atom format
            let hdr = section.header_v1004().clone();
            let atoms = hdr.rs_set().clone();
            Ok(read_current_render_state_atoms(&atoms))
        }
        _ => Ok(MaterialRenderState::default()),
    }
}

/// Parse old-format render states from raw 128-byte buffer.
/// Layout: 2 sets × 8 entries × (state:u32 + value:u32) = 128 bytes.
/// Only the first set (8 entries) is used.
/// Forces ALPHAREF=129 and ALPHAFUNC=D3DCMP_GREATER (semantic parity #3).
fn parse_old_rs_from_raw_bytes(raw: &[u8]) -> MaterialRenderState {
    let mut rs = MaterialRenderState::default();
    if raw.len() < 128 { return rs; }

    for i in 0..8 {
        let offset = i * 8;
        let state = u32::from_le_bytes([raw[offset], raw[offset+1], raw[offset+2], raw[offset+3]]);
        let value = u32::from_le_bytes([raw[offset+4], raw[offset+5], raw[offset+6], raw[offset+7]]);

        if state == super::lmo::LW_INVALID_INDEX { continue; }

        match state {
            D3DRS_ALPHATESTENABLE => { rs.alpha_enabled = value != 0; }
            D3DRS_SRCBLEND => { rs.src_blend = Some(value); }
            D3DRS_DESTBLEND => { rs.dest_blend = Some(value); }
            D3DRS_ALPHAREF => { rs.alpha_ref = Some(129); } // forced
            D3DRS_CULLMODE => { rs.cull_mode = Some(value); }
            D3DRS_ALPHAFUNC => { rs.alpha_func = Some(D3DCMP_GREATER); } // forced
            _ => {}
        }
    }

    rs
}

// ============================================================================
// Animation conversion
// ============================================================================

#[allow(clippy::type_complexity)]
fn convert_anim_section(
    section: &OptRc<PkoLmo_AnimSection>,
    file_version: u32,
) -> Result<(Option<LmoAnimData>, Vec<LmoTexUvAnim>, Vec<LmoTexImgAnim>, Vec<LmoMtlOpacAnim>)> {
    // Matrix animation (bone data is skipped, same as native parser)
    let data_mat_size = *section.data_mat_size();
    let animation = if data_mat_size > 0 {
        let anim_mat_opt = section.anim_mat().clone();
        if !anim_mat_opt.is_none() {
            convert_matrix_animation(&anim_mat_opt)?
        } else {
            None
        }
    } else {
        None
    };

    // Material opacity animations (only for file_version >= 0x1005)
    let mut mtlopac_anims = Vec::new();
    if file_version >= 0x1005 {
        let slots = section.anim_mtlopac().clone();
        for (subset_idx, slot_rc) in slots.iter().enumerate() {
            if *slot_rc.blob_size() == 0 { continue; }
            let data_opt = slot_rc.data().clone();
            if data_opt.is_none() { continue; }
            let opac_data = &data_opt;
            let key_seq = opac_data.key_seq().clone();
            let mut keyframes = Vec::new();
            for key_rc in &key_seq {
                keyframes.push(LmoOpacityKeyframe {
                    frame: *key_rc.key(),
                    opacity: *key_rc.data(),
                });
            }
            if !keyframes.is_empty() {
                mtlopac_anims.push(LmoMtlOpacAnim {
                    subset: subset_idx,
                    keyframes,
                });
            }
        }
    }

    // Texture UV animations (16 subsets × 4 stages encoded linearly as 64 slots)
    let texuv_sizes = section.data_texuv_size().clone();
    let texuv_slots = section.anim_texuv().clone();
    let mut texuv_anims = Vec::new();
    for (slot_idx, slot_rc) in texuv_slots.iter().enumerate() {
        let size = texuv_sizes[slot_idx];
        if size == 0 { continue; }
        let data_opt = slot_rc.data().clone();
        if data_opt.is_none() { continue; }
        let uv_data = &data_opt;
        let frame_num = *uv_data.frame_num();
        if frame_num == 0 || frame_num > 100_000 { continue; }
        let mat_seq = uv_data.mat_seq().clone();
        let mut matrices = Vec::with_capacity(frame_num as usize);
        for mat_rc in &mat_seq {
            matrices.push(extract_matrix44_array(mat_rc));
        }
        let subset = slot_idx / 4;
        let stage = slot_idx % 4;
        texuv_anims.push(LmoTexUvAnim {
            subset,
            stage,
            frame_num,
            matrices,
        });
    }

    // Texture image animations (16 subsets × 4 stages encoded linearly as 64 slots)
    let teximg_sizes = section.data_teximg_size().clone();
    let teximg_slots = section.anim_teximg().clone();
    let mut teximg_anims = Vec::new();
    for (slot_idx, slot_rc) in teximg_slots.iter().enumerate() {
        let size = teximg_sizes[slot_idx];
        if size == 0 { continue; }
        let data_opt = slot_rc.data().clone();
        if data_opt.is_none() { continue; }
        let img_data = &data_opt;
        // For file_version == 0, teximg has legacy_payload (raw bytes), skip it
        if *img_data.version() == 0 { continue; }
        let data_num = *img_data.data_num();
        if data_num == 0 || data_num > 1000 { continue; }
        let data_seq = img_data.data_seq().clone();
        let mut textures = Vec::new();
        for tex_rc in &data_seq {
            if let Some(name) = extract_cstr_from_bytes(&tex_rc.file_name()) {
                textures.push(name);
            }
        }
        if !textures.is_empty() {
            let subset = slot_idx / 4;
            let stage = slot_idx % 4;
            teximg_anims.push(LmoTexImgAnim {
                subset,
                stage,
                textures,
            });
        }
    }

    Ok((animation, texuv_anims, teximg_anims, mtlopac_anims))
}

fn convert_matrix_animation(
    anim_mat: &OptRc<PkoLmo_AnimDataMatrix>,
) -> Result<Option<LmoAnimData>> {
    let frame_num = *anim_mat.frame_num();
    if frame_num == 0 || frame_num > 100_000 {
        return Ok(None);
    }

    let mat_seq = anim_mat.mat_seq().clone();
    let mut translations = Vec::with_capacity(frame_num as usize);
    let mut rotations = Vec::with_capacity(frame_num as usize);

    for mat_rc in &mat_seq {
        let raw = extract_matrix43_array(mat_rc);
        let (t, q) = decompose_matrix43(&raw);
        translations.push(t);
        rotations.push(q);
    }

    Ok(Some(LmoAnimData {
        frame_num,
        translations,
        rotations,
    }))
}

// ============================================================================
// Matrix extraction helpers
// ============================================================================

fn extract_matrix44(mat: &OptRc<PkoLmo_Matrix44>) -> [[f32; 4]; 4] {
    [
        [*mat.m11(), *mat.m12(), *mat.m13(), *mat.m14()],
        [*mat.m21(), *mat.m22(), *mat.m23(), *mat.m24()],
        [*mat.m31(), *mat.m32(), *mat.m33(), *mat.m34()],
        [*mat.m41(), *mat.m42(), *mat.m43(), *mat.m44()],
    ]
}

fn extract_matrix44_array(mat: &OptRc<PkoLmo_Matrix44>) -> [[f32; 4]; 4] {
    extract_matrix44(mat)
}

fn extract_matrix43_array(mat: &OptRc<PkoLmo_Matrix43>) -> [f32; 12] {
    [
        *mat.m11(), *mat.m12(), *mat.m13(),
        *mat.m21(), *mat.m22(), *mat.m23(),
        *mat.m31(), *mat.m32(), *mat.m33(),
        *mat.m41(), *mat.m42(), *mat.m43(),
    ]
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backend_defaults_to_native() {
        assert_eq!(parse_lmo_backend(None), LmoParserBackend::Native);
        assert_eq!(parse_lmo_backend(Some("")), LmoParserBackend::Native);
    }

    #[test]
    fn backend_accepts_kaitai_markers() {
        assert_eq!(
            parse_lmo_backend(Some("kaitai")),
            LmoParserBackend::Kaitai
        );
        assert_eq!(parse_lmo_backend(Some("KSY")), LmoParserBackend::Kaitai);
    }

    #[test]
    fn backend_ignores_unknown_values() {
        assert_eq!(parse_lmo_backend(Some("manual")), LmoParserBackend::Native);
        assert_eq!(parse_lmo_backend(Some("foo")), LmoParserBackend::Native);
    }

    /// TDD: Verify kaitai adapter produces identical output to native parser
    /// on a single known .lmo file.
    #[test]
    fn kaitai_matches_native_on_single_file() {
        let test_dirs = [
            std::path::Path::new("../top-client/model/scene"),
            std::path::Path::new("../top-client/corsairs-online-public/client/model/scene"),
        ];

        let mut found_file = None;
        for dir in &test_dirs {
            if !dir.exists() { continue; }
            for entry in std::fs::read_dir(dir).unwrap() {
                let path = entry.unwrap().path();
                if path.extension() == Some("lmo".as_ref()) {
                    found_file = Some(path);
                    break;
                }
            }
            if found_file.is_some() { break; }
        }

        let path = match found_file {
            Some(p) => p,
            None => {
                eprintln!("Skipping kaitai parity test: no .lmo files found");
                return;
            }
        };

        let data = std::fs::read(&path).unwrap();

        // Parse with native
        let native = super::super::lmo::parse_lmo(&data);
        // Parse with kaitai
        let kaitai = kaitai_to_lmo(&data, true);

        match (native, kaitai) {
            (Ok(n), Ok(k)) => {
                assert_eq!(
                    n, k,
                    "Parity mismatch on file: {}",
                    path.display()
                );
            }
            (Err(e), Ok(_)) => {
                panic!("Native failed ({}) but kaitai succeeded on {}", e, path.display());
            }
            (Ok(_), Err(e)) => {
                panic!("Kaitai failed ({}) but native succeeded on {}", e, path.display());
            }
            (Err(_), Err(_)) => {
                // Both fail — acceptable
            }
        }

        eprintln!("Parity test passed on: {}", path.display());
    }
}
