use pko_tools_lib::effect::model::EffFile;

#[path = "common/mod.rs"]
mod common;

fn diff_bytes(original: &[u8], new: &[u8]) -> Vec<String> {
    original
        .iter()
        .zip(new.iter())
        .enumerate()
        .filter_map(|(i, (a, b))| {
            if a == b {
                None
            } else {
                Some(format!("offset 0x{:04X}: 0x{:02X} -> 0x{:02X}", i, a, b))
            }
        })
        .collect()
}

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

        if original_bytes != new_bytes {
            let diffs = diff_bytes(&original_bytes, &new_bytes);
            panic!(
                "Round-trip produced {} byte differences for {}:\n{}",
                diffs.len(),
                path.display(),
                diffs.join("\n")
            );
        }
    }
}
