use pko_tools_lib::effect::model::EffFile;
use std::path::PathBuf;

#[path = "common/mod.rs"]
mod common;

/// Generate JSON fixture from a known .eff file for frontend schema validation.
/// The TypeScript test (`src/types/__tests__/effectSchema.test.ts`) reads this
/// fixture and validates that the `EffectFile` interface matches the Rust output.
#[test]
fn generate_frontend_fixture() {
    let fixtures = common::get_known_good_eff_files();
    assert!(!fixtures.is_empty(), "No EFF fixtures found");

    // Use the first fixture for the schema sync
    let path = &fixtures[0];
    let bytes = std::fs::read(path).expect("read effect fixture");
    let eff = EffFile::from_bytes(&bytes)
        .unwrap_or_else(|e| panic!("Failed to parse {}: {}", path.display(), e));

    let json = serde_json::to_string_pretty(&eff).expect("serialize to JSON");

    // Write to frontend test fixtures directory
    let output_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("src/types/__tests__/fixtures");
    std::fs::create_dir_all(&output_dir).expect("create fixtures dir");

    let output_path = output_dir.join("known_effect.json");
    std::fs::write(&output_path, &json).expect("write fixture JSON");

    // Sanity check: the JSON round-trips back to the same struct
    let reparsed: EffFile = serde_json::from_str(&json).expect("reparse JSON");
    assert_eq!(eff, reparsed, "JSON round-trip mismatch");

    println!("Wrote fixture to: {}", output_path.display());
}

/// Verify all known .eff files produce valid JSON that round-trips through serde.
#[test]
fn all_effects_produce_valid_json() {
    let fixtures = common::get_known_good_eff_files();
    assert!(!fixtures.is_empty(), "No EFF fixtures found");

    for path in &fixtures {
        let bytes = std::fs::read(path).expect("read fixture");
        let eff = EffFile::from_bytes(&bytes)
            .unwrap_or_else(|e| panic!("Failed to parse {}: {}", path.display(), e));

        let json = serde_json::to_string(&eff)
            .unwrap_or_else(|e| panic!("Failed to serialize {}: {}", path.display(), e));

        let reparsed: EffFile = serde_json::from_str(&json)
            .unwrap_or_else(|e| panic!("Failed to reparse JSON for {}: {}", path.display(), e));

        assert_eq!(
            eff,
            reparsed,
            "JSON round-trip mismatch for {}",
            path.display()
        );
    }
}
