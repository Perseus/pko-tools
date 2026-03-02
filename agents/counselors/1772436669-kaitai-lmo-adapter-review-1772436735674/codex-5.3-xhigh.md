**Verdict**
The migration goal is good, but this plan is not executable as written. It has hard blockers and parity gaps that will cause compile failures and behavior regressions if implemented directly.

**Critical blockers**
1. Generated Rust is currently invalid Rust syntax due keyword identifiers.
Files include fields/methods named `type` and `box` (for example [pko_lmo.rs](/Users/anirudh/gamedev/pko-tools/src-tauri/gen/kaitai/pko_lmo.rs:4984), [pko_lmo.rs](/Users/anirudh/gamedev/pko-tools/src-tauri/gen/kaitai/pko_lmo.rs:5070), [pko_lmo.rs](/Users/anirudh/gamedev/pko-tools/src-tauri/gen/kaitai/pko_lmo.rs:1321), [pko_lmo.rs](/Users/anirudh/gamedev/pko-tools/src-tauri/gen/kaitai/pko_lmo.rs:1358)).  
This will fail as soon as you wire `gen/kaitai` into the crate.  
Fix: rename those KSY field IDs (`type` -> `obj_type`/`kind`, `box` -> `bbox`) and regenerate, or add a deterministic post-gen sanitizer that rewrites to raw identifiers.

2. `load_lmo_no_animation` parity will break with current Kaitai structure.
No-animation is used in hot path map loading ([scene_model.rs](/Users/anirudh/gamedev/pko-tools/src-tauri/src/map/scene_model.rs:1531)).  
But generated geometry parsing always reads/decodes animation when `anim_size > 0` ([pko_lmo.rs](/Users/anirudh/gamedev/pko-tools/src-tauri/gen/kaitai/pko_lmo.rs:2285), [pko_lmo.rs](/Users/anirudh/gamedev/pko-tools/src-tauri/gen/kaitai/pko_lmo.rs:847)).  
Fix: parameterize KSY to skip animation parse for no-animation mode, or keep native parser for `load_lmo_no_animation`.

3. Robustness semantics differ from native parser.
Native parser is intentionally lenient: it can keep object parsing alive when material/mesh/anim parsing fails ([lmo.rs](/Users/anirudh/gamedev/pko-tools/src-tauri/src/map/lmo.rs:1080), [lmo.rs](/Users/anirudh/gamedev/pko-tools/src-tauri/src/map/lmo.rs:1141), [lmo.rs](/Users/anirudh/gamedev/pko-tools/src-tauri/src/map/lmo.rs:1172)).  
Generated parser is stricter: object type is validated to only `1|2` and errors otherwise ([pko_lmo.rs](/Users/anirudh/gamedev/pko-tools/src-tauri/gen/kaitai/pko_lmo.rs:5013)).  
Header plausibility check also differs (`<=` in generated vs exact match `==` in native) ([pko_lmo.rs](/Users/anirudh/gamedev/pko-tools/src-tauri/gen/kaitai/pko_lmo.rs:1858), [pko_lmo.rs](/Users/anirudh/gamedev/pko-tools/src-tauri/gen/kaitai/pko_lmo.rs:1967), [lmo.rs](/Users/anirudh/gamedev/pko-tools/src-tauri/src/map/lmo.rs:1035), [lmo.rs](/Users/anirudh/gamedev/pko-tools/src-tauri/src/map/lmo.rs:1045)).  
Fix: explicitly define parity policy and update KSY/adapter to match native leniency.

**Major risks**
1. Runtime/codegen coupling is under-specified.
`build.rs` accepts any `ksc` from PATH and only checks `--help` ([build.rs](/Users/anirudh/gamedev/pko-tools/src-tauri/build.rs:52)).  
That is risky with `kaitai` runtime version locking (`kaitai` isn’t even in dependencies yet: [Cargo.toml](/Users/anirudh/gamedev/pko-tools/src-tauri/Cargo.toml:34)).  
Pin KSC version in CI and lock runtime compatibility before adapter work.

2. RefCell/Rc usage can bite hard.
The generated API is borrow-heavy; holding `Ref`s across nested calls can panic at runtime.  
Also `body_geometry`/`body_helper` don’t set cache flags, so repeated calls can reparse ([pko_lmo.rs](/Users/anirudh/gamedev/pko-tools/src-tauri/gen/kaitai/pko_lmo.rs:5022)).  
Adapter must aggressively clone/copy out and avoid long-lived borrows.

3. Phase 1 module wiring is incomplete.
There is no existing `gen` module in crate root ([lib.rs](/Users/anirudh/gamedev/pko-tools/src-tauri/src/lib.rs:3)); only [gen/kaitai/mod.rs](/Users/anirudh/gamedev/pko-tools/src-tauri/gen/kaitai/mod.rs:1).  
Plan should specify exact `#[path]` module strategy and compile checks.

**Phasing assessment**
Current phase order is wrong. You need a new Phase 0 before everything:
1. Make generated Rust compilable (keyword fix), wire modules, add `kaitai` dependency, run `cargo check`.
2. Add no-animation support parity strategy (or explicitly keep native for no-animation).
3. Implement adapter incrementally (mesh/material first, then animations).
4. Add parity tests and perf tests.
5. Keep native fallback; do not remove fallback until sustained soak.

**Testing gaps**
1. “Field-by-field equality” is too vague for floats/quaternions; use epsilon and quaternion sign-invariant compare.
2. Add explicit parity tests for both `load_lmo` and `load_lmo_no_animation` paths ([lmo_loader.rs](/Users/anirudh/gamedev/pko-tools/src-tauri/src/map/lmo_loader.rs:28), [lmo_loader.rs](/Users/anirudh/gamedev/pko-tools/src-tauri/src/map/lmo_loader.rs:35)).
3. Existing real-data tests are often skipped when client data is absent ([lmo.rs](/Users/anirudh/gamedev/pko-tools/src-tauri/src/map/lmo.rs:1877)); parity suite needs deterministic fixtures or checked-in minimal LMOs.

**Bottom line**
Do not proceed with adapter implementation until you fix generated-code compile blockers and no-animation parity. As planned, this will regress reliability and performance before it improves maintainability.
