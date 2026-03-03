//! Kaitai-backed LAB file loader.
//!
//! Converts the Kaitai `PkoLab` AST into the existing domain types
//! (`LwBoneFile`, `LwBoneInfoHeader`, `LwBoneBaseInfo`, `LwBoneDummyInfo`,
//! `LwBoneKeyInfo`).

use anyhow::{bail, Context, Result};
use cgmath::{Matrix4, Quaternion, Vector3};
use kaitai::*;
use std::path::Path;

use super::character::{
    LwBoneBaseInfo, LwBoneDummyInfo, LwBoneFile, LwBoneInfoHeader, LwBoneKeyInfo,
    BONE_KEY_TYPE_MAT43, BONE_KEY_TYPE_MAT44, BONE_KEY_TYPE_QUAT,
};
use crate::kaitai_gen::pko_lab::*;
use crate::math::{LwMatrix43, LwMatrix44, LwQuaternion, LwVector3};

/// Load a `.lab` file from disk via the Kaitai parser.
pub fn load_lab(path: impl AsRef<Path>) -> Result<LwBoneFile> {
    let data = std::fs::read(path.as_ref())
        .with_context(|| format!("Failed to read LAB file: {:?}", path.as_ref()))?;
    load_lab_from_bytes(&data)
}

/// Load a `.lab` from an in-memory byte slice.
pub fn load_lab_from_bytes(data: &[u8]) -> Result<LwBoneFile> {
    // Check version to decide parser path. Version is first u32 LE.
    if data.len() < 4 {
        bail!("LAB file too small: {} bytes", data.len());
    }
    let version = u32::from_le_bytes([data[0], data[1], data[2], data[3]]);

    if version < 0x1000 {
        bail!(
            "LAB version {} (< 0x1000) is unsupported. \
             Only 4 ancient files use this format.",
            version
        );
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

    #[test]
    fn load_all_lab_files() {
        let client_dir = std::path::Path::new("../top-client");
        if !client_dir.exists() {
            eprintln!("Skipping LAB regression test: ../top-client not found");
            return;
        }

        let mut lab_files: Vec<std::path::PathBuf> = Vec::new();
        let anim_dir = client_dir.join("animation");
        if anim_dir.exists() {
            collect_lab_files(&anim_dir, &mut lab_files);
        }

        eprintln!("Found {} .lab files", lab_files.len());
        assert!(!lab_files.is_empty(), "No .lab files found");

        let mut pass = 0;
        let mut skip = 0;
        let mut fail = 0;

        for path in &lab_files {
            let data = match std::fs::read(path) {
                Ok(d) => d,
                Err(e) => {
                    eprintln!("SKIP {}: read error: {}", path.display(), e);
                    skip += 1;
                    continue;
                }
            };

            // Files with version < 0x1000 are expected to be unsupported
            if data.len() >= 4 {
                let version = u32::from_le_bytes([data[0], data[1], data[2], data[3]]);
                if version < 0x1000 {
                    skip += 1;
                    continue;
                }
            }

            match load_lab_from_bytes(&data) {
                Ok(bone_file) => {
                    assert_eq!(
                        bone_file.base_seq.len(),
                        bone_file.header.bone_num as usize,
                        "bone count mismatch in {}",
                        path.display()
                    );
                    assert_eq!(
                        bone_file.key_seq.len(),
                        bone_file.header.bone_num as usize,
                        "key_seq count mismatch in {}",
                        path.display()
                    );
                    pass += 1;
                }
                Err(e) => {
                    fail += 1;
                    eprintln!("FAIL {}: {}", path.display(), e);
                }
            }
        }

        eprintln!(
            "LAB regression: {} pass, {} skip, {} fail out of {} files",
            pass, skip, fail, lab_files.len()
        );
        assert_eq!(fail, 0, "{} files failed regression check", fail);
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
