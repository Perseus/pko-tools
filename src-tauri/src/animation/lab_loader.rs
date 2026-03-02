//! Kaitai-backed LAB file loader.
//!
//! Converts the Kaitai `PkoLab` AST into the existing domain types
//! (`LwBoneFile`, `LwBoneInfoHeader`, `LwBoneBaseInfo`, `LwBoneDummyInfo`,
//! `LwBoneKeyInfo`).

use anyhow::{bail, Context, Result};
use binrw::BinRead;
use cgmath::{Matrix4, Quaternion, Vector3};
use kaitai::*;
use std::io::Cursor;
use std::path::Path;

use super::character::{
    LwBoneBaseInfo, LwBoneDummyInfo, LwBoneFile, LwBoneInfoHeader, LwBoneKeyInfo,
    BONE_KEY_TYPE_MAT43, BONE_KEY_TYPE_MAT44, BONE_KEY_TYPE_QUAT,
};
use crate::kaitai_gen::pko_lab::*;
use crate::math::{LwMatrix43, LwMatrix44, LwQuaternion, LwVector3};

/// Load a `.lab` file from disk via the Kaitai parser.
/// Falls back to native BinRead for files with version < 0x1000.
pub fn load_lab(path: impl AsRef<Path>) -> Result<LwBoneFile> {
    let data = std::fs::read(path.as_ref())
        .with_context(|| format!("Failed to read LAB file: {:?}", path.as_ref()))?;
    load_lab_from_bytes(&data)
}

/// Load a `.lab` from an in-memory byte slice.
/// Uses Kaitai for version >= 0x1000, falls back to native BinRead for older files.
pub fn load_lab_from_bytes(data: &[u8]) -> Result<LwBoneFile> {
    // Check version to decide parser path. Version is first u32 LE.
    if data.len() < 4 {
        bail!("LAB file too small: {} bytes", data.len());
    }
    let version = u32::from_le_bytes([data[0], data[1], data[2], data[3]]);

    if version < 0x1000 {
        // Old format — Kaitai .ksy rejects version < 0x1000. Use native parser.
        let mut cursor = Cursor::new(data);
        let bone_file = LwBoneFile::read_le(&mut cursor)
            .map_err(|e| anyhow::anyhow!("Native LAB parse error (version {}): {:?}", version, e))?;
        return Ok(bone_file);
    }

    let reader = BytesReader::from(data.to_vec());
    let parsed = PkoLab::read_into::<_, PkoLab>(&reader, None, None)
        .map_err(|e| anyhow::anyhow!("Kaitai LAB parse error: {:?}", e))?;

    convert_lab(&parsed)
}

fn convert_lab(parsed: &PkoLab) -> Result<LwBoneFile> {
    let version = *parsed.version();

    // Header — extract values eagerly to avoid Ref lifetime issues.
    // Each accessor returns Ref<'_, T>; we must keep the parent Ref alive
    // while dereferencing, so we bind each field separately.
    let h = parsed.header();
    let bone_num = *h.bone_num();
    let frame_num = *h.frame_num();
    let dummy_num = *h.dummy_num();
    let key_type = *h.key_type();
    drop(h);
    let header = LwBoneInfoHeader {
        bone_num,
        frame_num,
        dummy_num,
        key_type,
    };

    // Base sequence (bone hierarchy)
    let base_seq: Vec<LwBoneBaseInfo> = {
        let bases = parsed.base_seq();
        bases
            .iter()
            .map(|b| {
                let name_bytes = b.name();
                let end = name_bytes
                    .iter()
                    .position(|&byte| byte == 0)
                    .unwrap_or(name_bytes.len());
                let name = String::from_utf8_lossy(&name_bytes[..end]).to_string();
                LwBoneBaseInfo {
                    name,
                    id: *b.id(),
                    parent_id: *b.parent_id(),
                    original_node_index: 0,
                }
            })
            .collect()
    };

    // Inverse bind matrices
    let invmat_seq: Vec<LwMatrix44> = {
        let mats = parsed.invmat_seq();
        mats.iter().map(|m| convert_matrix44(m)).collect()
    };

    // Dummy sequence
    let dummy_seq: Vec<LwBoneDummyInfo> = {
        let dummies = parsed.dummy_seq();
        dummies
            .iter()
            .map(|d| {
                let id = *d.id();
                let parent_bone_id = *d.parent_bone_id();
                let mat = convert_matrix44(&d.mat());
                LwBoneDummyInfo {
                    id,
                    parent_bone_id,
                    mat,
                }
            })
            .collect()
    };

    // Key sequence (animation data per bone)
    let key_seq: Vec<LwBoneKeyInfo> = {
        let keys = parsed.key_seq();
        let mut result = Vec::with_capacity(keys.len());
        for (i, k) in keys.iter().enumerate() {
            let key_info = convert_key_info(k, &header, version, &base_seq, i)
                .with_context(|| format!("Failed to convert key info for bone {}", i))?;
            result.push(key_info);
        }
        result
    };

    Ok(LwBoneFile {
        version,
        old_version: 0, // Kaitai .ksy validates version >= 0x1000, so old_version path not taken
        header,
        base_seq,
        invmat_seq,
        dummy_seq,
        key_seq,
    })
}

fn convert_key_info(
    k: &PkoLab_BoneKeyInfo,
    header: &LwBoneInfoHeader,
    _version: u32,
    _base_seq: &[LwBoneBaseInfo],
    _bone_index: usize,
) -> Result<LwBoneKeyInfo> {
    let key_type = *k.key_type();
    let frame_num = header.frame_num;

    match key_type {
        BONE_KEY_TYPE_MAT43 => {
            let mat43_seq: Vec<LwMatrix43> =
                k.mat43_seq().iter().map(|m| convert_matrix43(m)).collect();
            Ok(LwBoneKeyInfo {
                mat43_seq: Some(mat43_seq),
                mat44_seq: None,
                pos_seq: None,
                quat_seq: None,
            })
        }
        BONE_KEY_TYPE_MAT44 => {
            let mat44_seq: Vec<LwMatrix44> =
                k.mat44_seq().iter().map(|m| convert_matrix44(m)).collect();
            Ok(LwBoneKeyInfo {
                mat43_seq: None,
                mat44_seq: Some(mat44_seq),
                pos_seq: None,
                quat_seq: None,
            })
        }
        BONE_KEY_TYPE_QUAT => {
            // Kaitai reads pos_num entries (1 for non-root in old versions).
            // We need to expand to frame_num if only 1 was read.
            let raw_pos: Vec<LwVector3> = k
                .pos_seq()
                .iter()
                .map(|v| {
                    let x = *v.x();
                    let y = *v.y();
                    let z = *v.z();
                    LwVector3(Vector3::new(x, y, z))
                })
                .collect();

            let pos_seq = if raw_pos.len() == 1 && frame_num > 1 {
                // Old version, non-root bone: expand single position to frame_num copies
                let mut expanded = Vec::with_capacity(frame_num as usize);
                expanded.resize(frame_num as usize, raw_pos[0].clone());
                expanded
            } else {
                raw_pos
            };

            let quat_seq: Vec<LwQuaternion> = k
                .quat_seq()
                .iter()
                .map(|q| {
                    let x = *q.x();
                    let y = *q.y();
                    let z = *q.z();
                    let w = *q.w();
                    LwQuaternion(Quaternion::new(w, x, y, z))
                })
                .collect();

            Ok(LwBoneKeyInfo {
                mat43_seq: None,
                mat44_seq: None,
                pos_seq: Some(pos_seq),
                quat_seq: Some(quat_seq),
            })
        }
        _ => bail!("Unknown key type: {}", key_type),
    }
}

/// Convert Kaitai Matrix44 (16 floats in file order) to LwMatrix44.
///
/// File order: m11,m12,m13,m14, m21,m22,m23,m24, m31,m32,m33,m34, m41,m42,m43,m44
/// cgmath Matrix4::new takes column-major: c0r0,c0r1,c0r2,c0r3, c1r0,...
/// The native BinRead passes raw[0..16] directly to Matrix4::new,
/// so file bytes map directly to cgmath column storage.
fn convert_matrix44(m: &PkoLab_Matrix44) -> LwMatrix44 {
    LwMatrix44(Matrix4::new(
        *m.m11(),
        *m.m12(),
        *m.m13(),
        *m.m14(),
        *m.m21(),
        *m.m22(),
        *m.m23(),
        *m.m24(),
        *m.m31(),
        *m.m32(),
        *m.m33(),
        *m.m34(),
        *m.m41(),
        *m.m42(),
        *m.m43(),
        *m.m44(),
    ))
}

/// Convert Kaitai Matrix43 (12 floats in file order) to LwMatrix43.
///
/// File order: m11,m12,m13, m21,m22,m23, m31,m32,m33, m41,m42,m43
/// Native BinRead maps these as: Matrix4::new(raw[0..12] interleaved with 0.0/1.0)
fn convert_matrix43(m: &PkoLab_Matrix43) -> LwMatrix43 {
    LwMatrix43(Matrix4::new(
        *m.m11(),
        *m.m12(),
        *m.m13(),
        0.0,
        *m.m21(),
        *m.m22(),
        *m.m23(),
        0.0,
        *m.m31(),
        *m.m32(),
        *m.m33(),
        0.0,
        *m.m41(),
        *m.m42(),
        *m.m43(),
        1.0,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use binrw::BinRead;
    use std::io::Cursor;

    /// Compare two f32 values, treating NaN==NaN as equal (bitwise).
    fn f32_eq(a: f32, b: f32) -> bool {
        if a.is_nan() && b.is_nan() {
            a.to_bits() == b.to_bits()
        } else {
            a == b
        }
    }

    fn vec3_eq(a: &LwVector3, b: &LwVector3) -> bool {
        f32_eq(a.0.x, b.0.x) && f32_eq(a.0.y, b.0.y) && f32_eq(a.0.z, b.0.z)
    }

    fn quat_eq(a: &LwQuaternion, b: &LwQuaternion) -> bool {
        f32_eq(a.0.s, b.0.s)
            && f32_eq(a.0.v.x, b.0.v.x)
            && f32_eq(a.0.v.y, b.0.v.y)
            && f32_eq(a.0.v.z, b.0.v.z)
    }

    fn mat44_eq(a: &LwMatrix44, b: &LwMatrix44) -> bool {
        let sa = a.to_slice();
        let sb = b.to_slice();
        sa.iter().zip(sb.iter()).all(|(x, y)| f32_eq(*x, *y))
    }

    fn mat43_eq(a: &LwMatrix43, b: &LwMatrix43) -> bool {
        // Compare the 12 meaningful floats via the BinWrite map
        let sa = [
            a.0.x.x, a.0.x.y, a.0.x.z, a.0.x.w, a.0.y.x, a.0.y.y, a.0.y.z, a.0.y.w, a.0.z.x,
            a.0.z.y, a.0.z.z, a.0.z.w, a.0.w.x, a.0.w.y, a.0.w.z, a.0.w.w,
        ];
        let sb = [
            b.0.x.x, b.0.x.y, b.0.x.z, b.0.x.w, b.0.y.x, b.0.y.y, b.0.y.z, b.0.y.w, b.0.z.x,
            b.0.z.y, b.0.z.z, b.0.z.w, b.0.w.x, b.0.w.y, b.0.w.z, b.0.w.w,
        ];
        sa.iter().zip(sb.iter()).all(|(x, y)| f32_eq(*x, *y))
    }

    fn key_info_eq(a: &LwBoneKeyInfo, b: &LwBoneKeyInfo) -> bool {
        // mat43_seq
        match (&a.mat43_seq, &b.mat43_seq) {
            (Some(va), Some(vb)) => {
                if va.len() != vb.len() {
                    return false;
                }
                if !va.iter().zip(vb.iter()).all(|(x, y)| mat43_eq(x, y)) {
                    return false;
                }
            }
            (None, None) => {}
            _ => return false,
        }
        // mat44_seq
        match (&a.mat44_seq, &b.mat44_seq) {
            (Some(va), Some(vb)) => {
                if va.len() != vb.len() {
                    return false;
                }
                if !va.iter().zip(vb.iter()).all(|(x, y)| mat44_eq(x, y)) {
                    return false;
                }
            }
            (None, None) => {}
            _ => return false,
        }
        // pos_seq
        match (&a.pos_seq, &b.pos_seq) {
            (Some(va), Some(vb)) => {
                if va.len() != vb.len() {
                    return false;
                }
                if !va.iter().zip(vb.iter()).all(|(x, y)| vec3_eq(x, y)) {
                    return false;
                }
            }
            (None, None) => {}
            _ => return false,
        }
        // quat_seq
        match (&a.quat_seq, &b.quat_seq) {
            (Some(va), Some(vb)) => {
                if va.len() != vb.len() {
                    return false;
                }
                if !va.iter().zip(vb.iter()).all(|(x, y)| quat_eq(x, y)) {
                    return false;
                }
            }
            (None, None) => {}
            _ => return false,
        }
        true
    }

    fn bone_file_eq(a: &LwBoneFile, b: &LwBoneFile) -> bool {
        if a.version != b.version {
            return false;
        }
        // old_version: native sets it for version==0, but Kaitai rejects version<0x1000.
        // For all valid .lab files, old_version is 0 in both paths.
        if a.header.bone_num != b.header.bone_num
            || a.header.frame_num != b.header.frame_num
            || a.header.dummy_num != b.header.dummy_num
            || a.header.key_type != b.header.key_type
        {
            return false;
        }
        if a.base_seq.len() != b.base_seq.len() {
            return false;
        }
        for (ba, bb) in a.base_seq.iter().zip(b.base_seq.iter()) {
            if ba.name != bb.name || ba.id != bb.id || ba.parent_id != bb.parent_id {
                return false;
            }
        }
        if a.invmat_seq.len() != b.invmat_seq.len() {
            return false;
        }
        for (ma, mb) in a.invmat_seq.iter().zip(b.invmat_seq.iter()) {
            if !mat44_eq(ma, mb) {
                return false;
            }
        }
        if a.dummy_seq.len() != b.dummy_seq.len() {
            return false;
        }
        for (da, db) in a.dummy_seq.iter().zip(b.dummy_seq.iter()) {
            if da.id != db.id || da.parent_bone_id != db.parent_bone_id || !mat44_eq(&da.mat, &db.mat)
            {
                return false;
            }
        }
        if a.key_seq.len() != b.key_seq.len() {
            return false;
        }
        for (ka, kb) in a.key_seq.iter().zip(b.key_seq.iter()) {
            if !key_info_eq(ka, kb) {
                return false;
            }
        }
        true
    }

    #[test]
    fn load_all_lab_files() {
        let client_dir = std::path::Path::new("../top-client");
        if !client_dir.exists() {
            eprintln!("Skipping LAB parity test: ../top-client not found");
            return;
        }

        let mut lab_files: Vec<std::path::PathBuf> = Vec::new();
        // LAB files are in animation/ directory
        let anim_dir = client_dir.join("animation");
        if anim_dir.exists() {
            collect_lab_files(&anim_dir, &mut lab_files);
        }

        eprintln!("Found {} .lab files", lab_files.len());
        assert!(!lab_files.is_empty(), "No .lab files found");

        let mut pass = 0;
        let mut fail = 0;

        for path in &lab_files {
            let data = match std::fs::read(path) {
                Ok(d) => d,
                Err(e) => {
                    eprintln!("SKIP {}: read error: {}", path.display(), e);
                    continue;
                }
            };

            // Native parse
            let native = {
                let mut cursor = Cursor::new(&data);
                match LwBoneFile::read_le(&mut cursor) {
                    Ok(f) => f,
                    Err(e) => {
                        eprintln!("SKIP {}: native parse error: {}", path.display(), e);
                        continue;
                    }
                }
            };

            // Kaitai parse
            let kaitai = match load_lab_from_bytes(&data) {
                Ok(f) => f,
                Err(e) => {
                    fail += 1;
                    eprintln!("FAIL {}: kaitai parse error: {}", path.display(), e);
                    continue;
                }
            };

            if bone_file_eq(&native, &kaitai) {
                pass += 1;
            } else {
                fail += 1;
                eprintln!("FAIL {}: parity mismatch", path.display());
                // Print first difference for debugging
                if native.version != kaitai.version {
                    eprintln!("  version: native={} kaitai={}", native.version, kaitai.version);
                }
                if native.header.key_type != kaitai.header.key_type {
                    eprintln!(
                        "  key_type: native={} kaitai={}",
                        native.header.key_type, kaitai.header.key_type
                    );
                }
            }
        }

        eprintln!("LAB parity: {} pass, {} fail out of {} files", pass, fail, lab_files.len());
        assert_eq!(fail, 0, "{} files failed parity check", fail);
    }

    fn collect_lab_files(dir: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
        if let Ok(entries) = std::fs::read_dir(dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    collect_lab_files(&path, out);
                } else if path
                    .extension()
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("lab"))
                {
                    out.push(path);
                }
            }
        }
    }
}
