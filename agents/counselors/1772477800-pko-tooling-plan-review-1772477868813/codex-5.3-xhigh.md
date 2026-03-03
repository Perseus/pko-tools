**Findings (Ordered by Severity)**

1. The plan’s API/module map is incorrect, and that will block execution immediately. There is no `src-tauri/src/mesh/` module in the library surface ([lib.rs:15](/Users/anirudh/gamedev/pko-tools/src-tauri/src/lib.rs:15), [lib.rs:25](/Users/anirudh/gamedev/pko-tools/src-tauri/src/lib.rs:25)). Several function names in the plan also do not exist as written: it is `parse_map` not `parse_map_file` ([terrain.rs:134](/Users/anirudh/gamedev/pko-tools/src-tauri/src/map/terrain.rs:134)), `parse_lit_tx` not `parse_lit_file` ([lit.rs:41](/Users/anirudh/gamedev/pko-tools/src-tauri/src/map/lit.rs:41)), `EffFile::from_bytes` not `parse_effect_file` ([effect/model.rs:77](/Users/anirudh/gamedev/pko-tools/src-tauri/src/effect/model.rs:77)), `LwBoneFile::from_file` not `parse_lab_file` ([animation/character.rs:1265](/Users/anirudh/gamedev/pko-tools/src-tauri/src/animation/character.rs:1265)), and `CharacterGeometricModel::from_file` for `.lgo` ([character/model.rs:327](/Users/anirudh/gamedev/pko-tools/src-tauri/src/character/model.rs:327)).

2. The Serialize scope is underestimated and partly wrong. `MaterialRenderState` is internal (`pub(crate)`) parser state and should not be in external inspector JSON scope ([lmo.rs:75](/Users/anirudh/gamedev/pko-tools/src-tauri/src/map/lmo.rs:75)). Meanwhile, serializing `CharacterGeometricModel` cascades into many non-Serialize nested types (`CharMaterial`, `TextureInfo`, `CharMaterialTextureInfo`) ([character/model.rs:183](/Users/anirudh/gamedev/pko-tools/src-tauri/src/character/model.rs:183), [character/texture.rs:123](/Users/anirudh/gamedev/pko-tools/src-tauri/src/character/texture.rs:123), [character/texture.rs:216](/Users/anirudh/gamedev/pko-tools/src-tauri/src/character/texture.rs:216), [character/texture.rs:321](/Users/anirudh/gamedev/pko-tools/src-tauri/src/character/texture.rs:321)). The “~36 types” estimate is low for full recursive serialization.

3. Format definitions in the plan are inaccurate. `lit` in this codebase is `lit.tx` text parsing, not a `.lit` binary format ([lit.rs:40](/Users/anirudh/gamedev/pko-tools/src-tauri/src/map/lit.rs:40)). `.ini` is not currently part of the referenced effect parser path; effect parsing is binary `.eff` (`EffFile::from_bytes`) ([effect/model.rs:77](/Users/anirudh/gamedev/pko-tools/src-tauri/src/effect/model.rs:77)).

4. The enum serialization strategy is not safe as proposed. A blanket `derive(Serialize)` on D3D enums will output symbolic variants by default; for inspection/oracle diffs you want stable numeric values and unknown-value handling. Existing code already shows the correct pattern with `#[serde(into = "u32", try_from = "u32")]` on `D3DBlend` ([d3d/mod.rs:196](/Users/anirudh/gamedev/pko-tools/src-tauri/src/d3d/mod.rs:196)).

5. The plan does not satisfy incremental delivery as stated. “Add Serialize to everything” before CLI value is a long, high-risk batch. That contradicts “issues, commits, PRs, tests at each phase.” It should be vertical slices by format, each independently shippable.

6. The testing strategy is currently non-deterministic unless reworked. Existing parser tests often depend on external `../top-client` and short-circuit if files are absent ([scene_obj.rs:250](/Users/anirudh/gamedev/pko-tools/src-tauri/src/map/scene_obj.rs:250), [lit.rs:142](/Users/anirudh/gamedev/pko-tools/src-tauri/src/map/lit.rs:142)). CLI integration tests should rely on committed fixtures, not workstation paths.

7. LMO output stability risk is unaddressed. `load_lmo` can route to native or Kaitai based on `PKO_LMO_PARSER` ([lmo_loader.rs:16](/Users/anirudh/gamedev/pko-tools/src-tauri/src/map/lmo_loader.rs:16), [lmo_loader.rs:36](/Users/anirudh/gamedev/pko-tools/src-tauri/src/map/lmo_loader.rs:36)). Golden references will drift unless backend is pinned or exposed as an explicit CLI flag.

**Recommended Reorder (Supports Linear + PR + Tests Per Phase)**

1. Add a preflight phase first: freeze exact parser entrypoints, output contract, and CLI format names based on real code APIs.
2. Ship CLI skeleton early with 2 low-risk formats (`eff`, `obj`) and binary integration tests.
3. Add `lit.tx` and `map --summary` next, then full map dump behind an explicit opt-in flag.
4. Add `lab` and `lgo` via inspector DTOs (not direct domain serialization).
5. Add `lmo` with explicit backend selection and parity tests.
6. Add golden oracle generation only after output schema/backends are stable.
7. Add skills + docs last.

**Serialize Strategy Verdict**

1. The current “derive Serialize on domain everywhere” strategy is not the best approach.
2. Better approach: define inspector DTOs and map from domain structs, which decouples debugging JSON from parser internals.
3. For cgmath wrappers, use explicit stable serialization from existing helper methods (`to_slice`) so matrix/quaternion representation is deterministic ([math/mod.rs:14](/Users/anirudh/gamedev/pko-tools/src-tauri/src/math/mod.rs:14), [math/mod.rs:82](/Users/anirudh/gamedev/pko-tools/src-tauri/src/math/mod.rs:82), [math/mod.rs:227](/Users/anirudh/gamedev/pko-tools/src-tauri/src/math/mod.rs:227)).
4. For enums, follow the numeric serde pattern already used by `D3DBlend` ([d3d/mod.rs:196](/Users/anirudh/gamedev/pko-tools/src-tauri/src/d3d/mod.rs:196)).
5. For large arrays/raw buffers, default to summary output and gate raw dumps; otherwise oracle files become too large to be useful.
