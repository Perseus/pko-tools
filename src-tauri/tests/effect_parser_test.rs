use pko_tools_lib::effect::model::EffFile;

#[path = "common/mod.rs"]
mod common;

#[test]
fn parses_eff_header() {
    let path = common::load_known_good_eff("01000005(0).eff");
    let bytes = std::fs::read(path).expect("read effect fixture");
    let eff = EffFile::from_bytes(&bytes).expect("parse effect");

    assert!(eff.version >= 1);
    assert_eq!(eff.eff_num as usize, eff.sub_effects.len());
}

#[test]
fn parses_sub_effect_types() {
    let path = common::load_known_good_eff("01000005(0).eff");
    let bytes = std::fs::read(path).expect("read effect fixture");
    let eff = EffFile::from_bytes(&bytes).expect("parse effect");

    for sub in &eff.sub_effects {
        assert!(matches!(sub.effect_type, 0 | 1 | 2 | 3 | 4));
    }
}

#[test]
fn frame_array_lengths_match_frame_count() {
    let path = common::load_known_good_eff("01000005(0).eff");
    let bytes = std::fs::read(path).expect("read effect fixture");
    let eff = EffFile::from_bytes(&bytes).expect("parse effect");

    for sub in &eff.sub_effects {
        let count = sub.frame_count as usize;
        assert_eq!(sub.frame_times.len(), count);
        assert_eq!(sub.frame_sizes.len(), count);
        assert_eq!(sub.frame_angles.len(), count);
        assert_eq!(sub.frame_positions.len(), count);
        assert_eq!(sub.frame_colors.len(), count);
    }
}

#[test]
fn blend_modes_are_valid() {
    let path = common::load_known_good_eff("01000005(0).eff");
    let bytes = std::fs::read(path).expect("read effect fixture");
    let eff = EffFile::from_bytes(&bytes).expect("parse effect");

    for sub in &eff.sub_effects {
        let src = u32::from(sub.src_blend);
        let dest = u32::from(sub.dest_blend);
        assert!(src <= 13 || src == 0x7fffffff);
        assert!(dest <= 13 || dest == 0x7fffffff);
    }
}

#[test]
fn string_fields_are_valid() {
    let path = common::load_known_good_eff("01000005(0).eff");
    let bytes = std::fs::read(path).expect("read effect fixture");
    let eff = EffFile::from_bytes(&bytes).expect("parse effect");

    assert!(eff.path_name.len() <= 32);
    assert!(eff.sound_name.len() <= 32);
    for sub in &eff.sub_effects {
        assert!(sub.effect_name.len() <= 32);
        assert!(sub.model_name.len() <= 32);
    }
}
