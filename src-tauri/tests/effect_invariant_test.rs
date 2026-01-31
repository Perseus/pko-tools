use pko_tools_lib::effect::model::EffFile;

#[path = "common/mod.rs"]
mod common;

fn load_fixture() -> EffFile {
    let path = common::load_known_good_eff("01000005(0).eff");
    let bytes = std::fs::read(path).expect("read effect fixture");
    EffFile::from_bytes(&bytes).expect("parse effect")
}

#[test]
fn frame_times_non_negative() {
    let eff = load_fixture();
    for sub in &eff.sub_effects {
        for (i, time) in sub.frame_times.iter().enumerate() {
            assert!(
                *time >= 0.0,
                "sub-effect '{}' frame {} has negative time: {}",
                sub.effect_name,
                i,
                time
            );
        }
    }
}

#[test]
fn tex_coord_vertex_count_consistent() {
    let eff = load_fixture();
    for sub in &eff.sub_effects {
        if sub.coord_count > 0 {
            for (i, frame) in sub.coord_list.iter().enumerate() {
                assert_eq!(
                    frame.len(),
                    sub.ver_count as usize,
                    "coord_list[{}] has {} verts, expected {}",
                    i,
                    frame.len(),
                    sub.ver_count
                );
            }
        }
    }
}

#[test]
fn cylinder_params_consistency() {
    let eff = load_fixture();
    for sub in &eff.sub_effects {
        if sub.use_param > 0 {
            assert_eq!(sub.per_frame_cylinder.len(), sub.frame_count as usize);
            for params in &sub.per_frame_cylinder {
                assert!(params.segments >= 3, "Cylinder needs >= 3 segments");
            }
        }
    }
}

#[test]
fn rota_loop_axis_normalized() {
    let eff = load_fixture();
    for sub in &eff.sub_effects {
        if sub.rota_loop {
            let [x, y, z, _w] = sub.rota_loop_vec;
            let len = (x * x + y * y + z * z).sqrt();
            assert!(
                (len - 1.0).abs() < 0.01 || len < 0.001,
                "rota_loop axis not normalized: len={}",
                len
            );
        }
    }
}
