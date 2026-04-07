//! Effect and particle JSON export with coordinate remapping.
//!
//! Serializes `EffFile` and `ParFile` domain types to JSON, applying
//! [`CoordTransform`] extras methods to all position/direction/acceleration
//! vectors. Effects are exported as standalone JSON (not glTF), so they
//! bypass glTFast — hence the use of `extras_*` variants which produce
//! final-space coordinates without profile-specific pre-negation.

use std::path::Path;

use anyhow::Result;

use super::model::{EffFile, ParFile};
use crate::math::coord_transform::CoordTransform;

/// Apply coordinate remap to an `EffFile` for export.
/// Modifies position and angle keyframe arrays in-place.
pub fn remap_eff_for_export(eff: &mut EffFile, ct: &CoordTransform) {
    // Root rotation axis (direction vector)
    eff.rota_vec = ct.extras_position(eff.rota_vec);

    for sub in &mut eff.sub_effects {
        // Position keyframes
        for pos in &mut sub.frame_positions {
            *pos = ct.extras_position(*pos);
        }
        // Size/scale keyframes (axis swap, no negation — same as position)
        for size in &mut sub.frame_sizes {
            *size = ct.extras_position(*size);
        }
        // Angle keyframes (euler angles)
        for angle in &mut sub.frame_angles {
            *angle = ct.extras_euler_angles(*angle);
        }
        // rota_loop_vec: [x, y, z, speed] — xyz is a rotation AXIS (direction vector), not euler angles
        let rlv = sub.rota_loop_vec;
        let remapped = ct.extras_position([rlv[0], rlv[1], rlv[2]]);
        sub.rota_loop_vec = [remapped[0], remapped[1], remapped[2], rlv[3]];
    }
}

/// Apply coordinate remap to a `ParFile` for export.
/// Modifies position/direction/acceleration/range/offset vectors.
pub fn remap_par_for_export(par: &mut ParFile, ct: &CoordTransform) {
    for sys in &mut par.systems {
        sys.range = ct.extras_position(sys.range);
        sys.direction = ct.extras_position(sys.direction);
        sys.acceleration = ct.extras_position(sys.acceleration);
        sys.offset = ct.extras_position(sys.offset);

        // Angle keyframes
        for angle in &mut sys.frame_angles {
            *angle = ct.extras_euler_angles(*angle);
        }

        // Path points and directions
        if let Some(ref mut path) = sys.path {
            for pt in &mut path.points {
                *pt = ct.extras_position(*pt);
            }
            for dir in &mut path.directions {
                *dir = ct.extras_position(*dir);
            }
        }

        // Point ranges
        for pr in &mut sys.point_ranges {
            *pr = ct.extras_position(*pr);
        }
    }
}

/// Export a single .eff file as JSON with coordinate remap applied.
pub fn export_eff_json(data: &[u8]) -> Result<String> {
    let ct = CoordTransform::new();
    let mut eff = EffFile::from_bytes(data)?;
    remap_eff_for_export(&mut eff, &ct);
    Ok(serde_json::to_string_pretty(&eff)?)
}

/// Export a single .par file as JSON with coordinate remap applied.
pub fn export_par_json(data: &[u8]) -> Result<String> {
    let ct = CoordTransform::new();
    let mut par = ParFile::from_bytes(data)?;
    remap_par_for_export(&mut par, &ct);
    Ok(serde_json::to_string_pretty(&par)?)
}

/// Export all .eff files from a directory to JSON.
/// Returns (success_count, error_count).
pub fn export_all_eff(
    effect_dir: &Path,
    output_dir: &Path,
) -> Result<(usize, usize)> {
    let eff_out = output_dir.join("effects");
    std::fs::create_dir_all(&eff_out)?;

    let mut success = 0usize;
    let mut errors = 0usize;

    let mut entries: Vec<_> = std::fs::read_dir(effect_dir)?
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path()
                .extension()
                .map_or(false, |ext| ext.eq_ignore_ascii_case("eff"))
        })
        .collect();
    entries.sort_by_key(|e| e.file_name());

    for entry in entries {
        let path = entry.path();
        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown");

        match std::fs::read(&path).and_then(|data| {
            export_eff_json(&data).map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))
        }) {
            Ok(json) => {
                let out_path = eff_out.join(format!("{}.json", stem));
                std::fs::write(&out_path, json)?;
                success += 1;
            }
            Err(e) => {
                eprintln!("WARN: failed to export {}: {}", path.display(), e);
                errors += 1;
            }
        }
    }

    Ok((success, errors))
}

/// Export all .par files from a directory to JSON.
/// Returns (success_count, error_count).
pub fn export_all_par(
    effect_dir: &Path,
    output_dir: &Path,
) -> Result<(usize, usize)> {
    let par_out = output_dir.join("particles");
    std::fs::create_dir_all(&par_out)?;

    let mut success = 0usize;
    let mut errors = 0usize;

    let mut entries: Vec<_> = std::fs::read_dir(effect_dir)?
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.path()
                .extension()
                .map_or(false, |ext| ext.eq_ignore_ascii_case("par"))
        })
        .collect();
    entries.sort_by_key(|e| e.file_name());

    for entry in entries {
        let path = entry.path();
        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("unknown");

        match std::fs::read(&path).and_then(|data| {
            export_par_json(&data).map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))
        }) {
            Ok(json) => {
                let out_path = par_out.join(format!("{}.json", stem));
                std::fs::write(&out_path, json)?;
                success += 1;
            }
            Err(e) => {
                eprintln!("WARN: failed to export {}: {}", path.display(), e);
                errors += 1;
            }
        }
    }

    Ok((success, errors))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remap_eff_modifies_positions_and_angles() {
        let mut eff = EffFile {
            version: 7,
            idx_tech: 0,
            use_path: false,
            path_name: String::new(),
            use_sound: false,
            sound_name: String::new(),
            rotating: true,
            rota_vec: [1.0, 2.0, 3.0],
            rota_vel: 1.0,
            eff_num: 1,
            sub_effects: vec![super::super::model::SubEffect {
                effect_name: "test".into(),
                effect_type: 3,
                src_blend: crate::d3d::D3DBlend::SrcAlpha,
                dest_blend: crate::d3d::D3DBlend::One,
                length: 1.0,
                frame_count: 1,
                frame_times: vec![0.0],
                frame_sizes: vec![[1.0, 2.0, 3.0]],
                frame_angles: vec![[10.0, 20.0, 30.0]],
                frame_positions: vec![[100.0, 200.0, 300.0]],
                frame_colors: vec![[1.0, 1.0, 1.0, 1.0]],
                ver_count: 0,
                coord_count: 0,
                coord_frame_time: 0.0,
                coord_list: vec![],
                tex_count: 0,
                tex_frame_time: 0.0,
                tex_name: String::new(),
                tex_list: vec![],
                model_name: String::new(),
                billboard: true,
                vs_index: 0,
                segments: 0,
                height: 0.0,
                top_radius: 0.0,
                bot_radius: 0.0,
                frame_tex_count: 0,
                frame_tex_time: 0.0,
                frame_tex_names: vec![],
                frame_tex_time2: 0.0,
                use_param: 0,
                per_frame_cylinder: vec![],
                rota_loop: true,
                rota_loop_vec: [1.0, 2.0, 3.0, 4.0],
                alpha: false,
                rota_board: false,
            }],
        };

        let ct = CoordTransform::new();
        remap_eff_for_export(&mut eff, &ct);

        // StandardGltf extras_position(x,y,z) -> (x, z, y)
        assert_eq!(eff.rota_vec, [1.0, 3.0, 2.0]);
        assert_eq!(eff.sub_effects[0].frame_positions[0], [100.0, 300.0, 200.0]);
        // extras_position(x,y,z) -> (x, z, y) for sizes too
        assert_eq!(eff.sub_effects[0].frame_sizes[0], [1.0, 3.0, 2.0]);
        // extras_euler_angles(ax,ay,az) -> (-ax, -az, -ay)
        assert_eq!(eff.sub_effects[0].frame_angles[0], [-10.0, -30.0, -20.0]);
        // rota_loop_vec xyz is a direction vector → extras_position (no negation)
        assert_eq!(eff.sub_effects[0].rota_loop_vec, [1.0, 3.0, 2.0, 4.0]);
    }

    #[test]
    fn remap_par_modifies_vectors() {
        let mut par = ParFile {
            version: 15,
            name: "test".into(),
            length: 1.0,
            systems: vec![super::super::model::ParSystem {
                r#type: 3,
                name: "sys".into(),
                particle_count: 10,
                texture_name: String::new(),
                model_name: String::new(),
                range: [1.0, 2.0, 3.0],
                frame_count: 0,
                frame_sizes: vec![],
                frame_angles: vec![],
                frame_colors: vec![],
                billboard: true,
                src_blend: 5,
                dest_blend: 2,
                min_filter: 0,
                mag_filter: 0,
                life: 1.0,
                velocity: 1.0,
                direction: [0.0, 1.0, 0.0],
                acceleration: [0.0, 0.0, -9.8],
                step: 0.1,
                model_range_flag: false,
                model_range_name: String::new(),
                offset: [10.0, 20.0, 30.0],
                delay_time: 0.0,
                play_time: 0.0,
                use_path: false,
                path: None,
                shade: false,
                hit_effect: String::new(),
                point_ranges: vec![],
                random_mode: 0,
                model_dir: false,
                media_y: false,
            }],
            strips: vec![],
            models: vec![],
        };

        let ct = CoordTransform::new();
        remap_par_for_export(&mut par, &ct);

        let sys = &par.systems[0];
        // StandardGltf extras_position(x,y,z) -> (x, z, y)
        assert_eq!(sys.range, [1.0, 3.0, 2.0]);
        assert_eq!(sys.direction, [0.0, 0.0, 1.0]);
        assert_eq!(sys.acceleration, [0.0, -9.8, 0.0]);
        assert_eq!(sys.offset, [10.0, 30.0, 20.0]);
    }

    /// Corpus test: export all .eff files to JSON and verify zero failures.
    #[test]
    fn export_all_eff_corpus() {
        let eff_dir = std::path::Path::new("../top-client/effect");
        if !eff_dir.exists() {
            eprintln!("Skipping export_all_eff_corpus: ../top-client/effect not found");
            return;
        }

        let tmp = tempfile::tempdir().unwrap();
        let (success, errors) = export_all_eff(eff_dir, tmp.path()).unwrap();

        assert!(success > 0, "Expected at least 1 .eff export");
        assert_eq!(errors, 0, "Expected zero export failures, got {}", errors);
        eprintln!("export_all_eff_corpus: {} files exported OK", success);
    }

    /// Corpus test: export all .par files to JSON and verify zero failures.
    #[test]
    fn export_all_par_corpus() {
        let par_dir = std::path::Path::new("../top-client/effect");
        if !par_dir.exists() {
            eprintln!("Skipping export_all_par_corpus: ../top-client/effect not found");
            return;
        }

        let tmp = tempfile::tempdir().unwrap();
        let (success, errors) = export_all_par(par_dir, tmp.path()).unwrap();

        assert!(success > 0, "Expected at least 1 .par export");
        assert_eq!(errors, 0, "Expected zero export failures, got {}", errors);
        eprintln!("export_all_par_corpus: {} files exported OK", success);
    }

    /// Verify JSON content for a known .eff file has expected structure.
    #[test]
    fn export_eff_json_structure() {
        let eff_dir = std::path::Path::new("../top-client/effect");
        if !eff_dir.exists() {
            eprintln!("Skipping export_eff_json_structure: corpus not found");
            return;
        }

        // Pick the first .eff file
        let first_eff = std::fs::read_dir(eff_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .find(|e| {
                e.path()
                    .extension()
                    .map_or(false, |ext| ext.eq_ignore_ascii_case("eff"))
            })
            .expect("No .eff files in corpus");

        let data = std::fs::read(first_eff.path()).unwrap();
        let json = export_eff_json(&data).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert!(parsed["version"].is_number());
        assert!(parsed["idxTech"].is_number());
        assert!(parsed["subEffects"].is_array());
    }

    /// Verify JSON content for a known .par file has expected structure.
    #[test]
    fn export_par_json_structure() {
        let par_dir = std::path::Path::new("../top-client/effect");
        if !par_dir.exists() {
            eprintln!("Skipping export_par_json_structure: corpus not found");
            return;
        }

        let first_par = std::fs::read_dir(par_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .find(|e| {
                e.path()
                    .extension()
                    .map_or(false, |ext| ext.eq_ignore_ascii_case("par"))
            })
            .expect("No .par files in corpus");

        let data = std::fs::read(first_par.path()).unwrap();
        let json = export_par_json(&data).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        assert!(parsed["version"].is_number());
        assert!(parsed["name"].is_string());
        assert!(parsed["systems"].is_array());
    }
}
