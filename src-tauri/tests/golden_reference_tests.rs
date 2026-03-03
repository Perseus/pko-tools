//! Golden reference snapshot tests for PKO binary parsers.
//!
//! These tests parse known-good fixture files through the Kaitai adapters and
//! compare the output against previously-reviewed snapshots using `insta`.
//! If the parser output changes, `cargo insta review` shows the diff.

use std::path::Path;

use insta::assert_yaml_snapshot;

fn fixture(name: &str) -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/known_good")
        .join(name)
}

#[test]
fn snapshot_lmo_yyyy080() {
    let model = pko_tools_lib::map::lmo_loader::load_lmo(&fixture("yyyy080.lmo"))
        .expect("parse yyyy080.lmo");
    assert_yaml_snapshot!(model);
}

#[test]
fn snapshot_lgo_dirk() {
    let model = pko_tools_lib::character::lgo_loader::load_lgo(&fixture("dirk.lgo"))
        .expect("parse dirk.lgo");
    assert_yaml_snapshot!(model);
}

#[test]
fn snapshot_lab_0724() {
    let bones = pko_tools_lib::animation::lab_loader::load_lab(&fixture("0724.lab"))
        .expect("parse 0724.lab");
    assert_yaml_snapshot!(bones);
}

#[test]
fn snapshot_eff_lighty() {
    let data = std::fs::read(fixture("lighty.eff")).expect("read lighty.eff");
    let eff = pko_tools_lib::effect::eff_loader::load_eff(&data)
        .expect("parse lighty.eff");
    assert_yaml_snapshot!(eff);
}

#[test]
fn snapshot_obj_hell5() {
    let data = std::fs::read(fixture("hell5.obj")).expect("read hell5.obj");
    let obj = pko_tools_lib::map::obj_loader::load_obj(&data)
        .expect("parse hell5.obj");
    assert_yaml_snapshot!(obj);
}

#[test]
fn snapshot_par_00000001() {
    let data = std::fs::read(fixture("00000001.par")).expect("read 00000001.par");
    let par = pko_tools_lib::effect::par_loader::load_par(&data)
        .expect("parse 00000001.par");
    assert_yaml_snapshot!(par);
}

#[test]
fn snapshot_lit() {
    let entries = pko_tools_lib::map::lit::parse_lit_tx(&fixture("lit.lit"))
        .expect("parse lit.lit");
    assert_yaml_snapshot!(entries);
}
