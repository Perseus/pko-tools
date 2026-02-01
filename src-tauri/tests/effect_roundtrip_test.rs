use pko_tools_lib::effect::model::EffFile;

#[path = "common/mod.rs"]
mod common;

#[test]
fn roundtrip_preserves_bytes() {
    let fixtures = common::get_known_good_eff_files();
    assert!(!fixtures.is_empty(), "No EFF fixtures found");

    for path in fixtures {
        let original_bytes = std::fs::read(&path).expect("read effect fixture");
        let eff = EffFile::from_bytes(&original_bytes)
            .unwrap_or_else(|e| panic!("Failed to parse {}: {}", path.display(), e));
        let new_bytes = eff
            .to_bytes()
            .unwrap_or_else(|e| panic!("Failed to serialize {}: {}", path.display(), e));
        let roundtrip = EffFile::from_bytes(&new_bytes)
            .unwrap_or_else(|e| panic!("Failed to reparse {}: {}", path.display(), e));

        assert_eq!(eff, roundtrip, "Round-trip mismatch for {}", path.display());
    }
}
