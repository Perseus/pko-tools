use anyhow::{anyhow, Result};
use kaitai::*;

use crate::d3d::D3DBlend;
use crate::kaitai_gen::pko_eff::{PkoEff, PkoEff_Effect};

use super::model::{CylinderParams, EffFile, SubEffect};

/// Load a .eff effect file via the Kaitai-generated parser.
pub fn load_eff(data: &[u8]) -> Result<EffFile> {
    let reader = BytesReader::from(data.to_vec());
    let parsed = PkoEff::read_into::<_, PkoEff>(&reader, None, None)
        .map_err(|e| anyhow!("Kaitai EFF parse error: {:?}", e))?;

    // Extract all scalar fields eagerly to avoid borrow lifetime issues.
    let version = *parsed.version();
    let idx_tech = *parsed.idx_tech();
    let use_path = *parsed.use_path() != 0;
    let path_name = kaitai_fixed_str(&parsed.path_name());
    let use_sound = *parsed.use_sound() != 0;
    let sound_name = kaitai_fixed_str(&parsed.sound_name());
    let rotating = *parsed.rotating() != 0;
    let rota_vec = {
        let a = parsed.rota_axis();
        let x = *a.x();
        let y = *a.y();
        let z = *a.z();
        [x, y, z]
    };
    let rota_vel = *parsed.rota_vel();
    let eff_num = *parsed.effect_count();

    // Convert sub-effects while the borrow on effects is scoped.
    let sub_effects = {
        let effects = parsed.effects();
        let mut subs = Vec::with_capacity(eff_num.max(0) as usize);
        for eff in effects.iter() {
            subs.push(convert_effect(eff, version)?);
        }
        subs
    };

    Ok(EffFile {
        version,
        idx_tech,
        use_path,
        path_name,
        use_sound,
        sound_name,
        rotating,
        rota_vec,
        rota_vel,
        eff_num,
        sub_effects,
    })
}

fn convert_effect(eff: &PkoEff_Effect, version: u32) -> Result<SubEffect> {
    let frame_count = *eff.frame_count();

    // Frame time array
    let frame_times: Vec<f32> = eff.frame_time().clone();

    // Frame size/angle/position arrays (Vec3 → [f32; 3])
    let frame_sizes: Vec<[f32; 3]> = eff
        .frame_size()
        .iter()
        .map(|v| [*v.x(), *v.y(), *v.z()])
        .collect();

    let frame_angles: Vec<[f32; 3]> = eff
        .frame_angle()
        .iter()
        .map(|v| [*v.x(), *v.y(), *v.z()])
        .collect();

    let frame_positions: Vec<[f32; 3]> = eff
        .frame_pos()
        .iter()
        .map(|v| [*v.x(), *v.y(), *v.z()])
        .collect();

    // Frame colors (Color4f → [f32; 4])
    let frame_colors: Vec<[f32; 4]> = eff
        .frame_color()
        .iter()
        .map(|c| [*c.r(), *c.g(), *c.b(), *c.a()])
        .collect();

    // Texture coordinate lists
    let coord_list: Vec<Vec<[f32; 2]>> = eff
        .texcoord_lists()
        .iter()
        .map(|set| set.coords().iter().map(|v| [*v.x(), *v.y()]).collect())
        .collect();

    let tex_list: Vec<Vec<[f32; 2]>> = eff
        .tex_lists()
        .iter()
        .map(|entry| entry.coords().iter().map(|v| [*v.x(), *v.y()]).collect())
        .collect();

    // Version-gated texture frame names
    let frame_tex_names: Vec<String> = eff
        .texframe_names()
        .iter()
        .map(|s| kaitai_fixed_str(s))
        .collect();

    // Version-gated cylinder params
    let per_frame_cylinder: Vec<CylinderParams> = eff
        .cylinder_params()
        .iter()
        .map(|cp| CylinderParams {
            segments: *cp.segments(),
            height: *cp.hei(),
            top_radius: *cp.top_radius(),
            bot_radius: *cp.bottom_radius(),
        })
        .collect();

    // Version-gated rota_loop_vec — scope the Ref borrow
    let rota_loop_vec: [f32; 4] = if version > 4 {
        let rv = eff.rota_loop_v();
        let x = *rv.x();
        let y = *rv.y();
        let z = *rv.z();
        let w = *rv.w();
        [x, y, z, w]
    } else {
        [0.0, 0.0, 0.0, 0.0]
    };

    // D3DBlend from i32
    let src_blend = D3DBlend::try_from(*eff.src_blend() as u32)
        .map_err(|e| anyhow!("Invalid src_blend: {}", e))?;
    let dest_blend = D3DBlend::try_from(*eff.dest_blend() as u32)
        .map_err(|e| anyhow!("Invalid dest_blend: {}", e))?;

    Ok(SubEffect {
        effect_name: kaitai_fixed_str(&eff.effect_name()),
        effect_type: *eff.effect_type(),
        src_blend,
        dest_blend,
        length: *eff.length(),
        frame_count,
        frame_times,
        frame_sizes,
        frame_angles,
        frame_positions,
        frame_colors,
        ver_count: *eff.texcoord_ver_count(),
        coord_count: *eff.texcoord_coord_count(),
        coord_frame_time: *eff.texcoord_frame_time(),
        coord_list,
        tex_count: *eff.tex_count(),
        tex_frame_time: *eff.tex_frame_time(),
        tex_name: kaitai_fixed_str(&eff.tex_name()),
        tex_list,
        model_name: kaitai_fixed_str(&eff.model_name()),
        billboard: *eff.billboard() != 0,
        vs_index: *eff.vs_index(),
        segments: *eff.n_segments(),
        height: *eff.r_height(),
        top_radius: *eff.r_radius(),
        bot_radius: *eff.r_bot_radius(),
        frame_tex_count: *eff.texframe_count(),
        frame_tex_time: *eff.texframe_time_a(),
        frame_tex_names,
        frame_tex_time2: *eff.texframe_time_b(),
        use_param: *eff.use_param(),
        per_frame_cylinder,
        rota_loop: *eff.rota_loop() != 0,
        rota_loop_vec,
        alpha: *eff.alpha() != 0,
        rota_board: *eff.rota_board() != 0,
    })
}

/// Convert a Kaitai fixed-width string to match native `from_utf8_lossy` behavior.
///
/// Kaitai's `bytes_to_str("ASCII")` maps each byte to a unicode code point (latin-1).
/// The native parser uses `String::from_utf8_lossy` on the raw bytes up to the first
/// null byte. We convert back to raw bytes, truncate at the first null, and apply
/// `from_utf8_lossy` for exact parity.
fn kaitai_fixed_str(s: &str) -> String {
    let bytes: Vec<u8> = s.chars().map(|c| c as u8).collect();
    let end = bytes.iter().position(|b| *b == 0).unwrap_or(bytes.len());
    String::from_utf8_lossy(&bytes[..end]).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Regression test: parse every .eff file and roundtrip through to_bytes.
    #[test]
    fn load_all_eff_files() {
        let eff_dir = std::path::Path::new("../top-client/effect");
        if !eff_dir.exists() {
            eprintln!("Skipping EFF regression test: ../top-client/effect not found");
            return;
        }

        let mut eff_files: Vec<_> = std::fs::read_dir(eff_dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.path()
                    .extension()
                    .map_or(false, |ext| ext.eq_ignore_ascii_case("eff"))
            })
            .map(|e| e.path())
            .collect();
        eff_files.sort();

        assert!(
            !eff_files.is_empty(),
            "No .eff files found in {}",
            eff_dir.display()
        );

        let mut total_sub_effects = 0usize;
        for path in &eff_files {
            let data = std::fs::read(path).unwrap();
            let parsed = load_eff(&data).unwrap();

            assert!(parsed.version > 0, "{}: version", path.display());

            // Roundtrip: parse → serialize → parse again
            let bytes = parsed.to_bytes().unwrap();
            let reparsed = load_eff(&bytes).unwrap();
            let rebytes = reparsed.to_bytes().unwrap();
            assert_eq!(
                bytes, rebytes,
                "{}: roundtrip bytes mismatch",
                path.display()
            );

            total_sub_effects += parsed.sub_effects.len();
        }

        eprintln!(
            "EFF regression: {} files, {} total sub-effects — all parsed and roundtripped OK",
            eff_files.len(),
            total_sub_effects
        );
    }
}
