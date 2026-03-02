**Findings (Highest Severity First)**

1. **Critical: the plan will likely break material/alpha parity unless it explicitly ports native compatibility logic.**  
Current native behavior includes V0001 transp remap `2 -> TRANSP_SUBTRACTIVE`, old render-state overrides for alpha (`ALPHAREF=129`, `ALPHAFUNC=GREATER`), and mesh-level alpha promotion into materials. Your plan mentions generic render-state mapping but not these semantics, which are required for visual equivalence. References: [lmo.rs:334](/Users/anirudh/gamedev/pko-tools/src-tauri/src/map/lmo.rs#L334), [lmo.rs:343](/Users/anirudh/gamedev/pko-tools/src-tauri/src/map/lmo.rs#L343), [lmo.rs:263](/Users/anirudh/gamedev/pko-tools/src-tauri/src/map/lmo.rs#L263), [lmo.rs:1157](/Users/anirudh/gamedev/pko-tools/src-tauri/src/map/lmo.rs#L1157).

2. **Critical: `load_lmo_no_animation` parity is not achievable with the current generated parser shape.**  
`load_lmo_no_animation` is used in batch scene loading, but generated `GeometryChunk` eagerly parses `anim` when `anim_size > 0`, regardless of your adapter flag. If you switch backend there, you risk major perf regressions. References: [scene_model.rs:1531](/Users/anirudh/gamedev/pko-tools/src-tauri/src/map/scene_model.rs#L1531), [pko_lmo.rs:2285](/Users/anirudh/gamedev/pko-tools/src-tauri/gen/kaitai/pko_lmo.rs#L2285), [lmo_loader.rs:35](/Users/anirudh/gamedev/pko-tools/src-tauri/src/map/lmo_loader.rs#L35).

3. **Critical: generated Rust has a memoization bug pattern that can cause repeated reparsing and borrow panics if used carelessly.**  
`PkoLmo_ObjectEntry` has `f_body_geometry` / `f_body_helper`, but those flags are never set to `true`; repeated accessor calls reparse and mutate again. Adapter code must call once, clone out, and drop borrows immediately, or patch generator/template output. References: [pko_lmo.rs:4990](/Users/anirudh/gamedev/pko-tools/src-tauri/gen/kaitai/pko_lmo.rs#L4990), [pko_lmo.rs:5029](/Users/anirudh/gamedev/pko-tools/src-tauri/gen/kaitai/pko_lmo.rs#L5029), [pko_lmo.rs:5052](/Users/anirudh/gamedev/pko-tools/src-tauri/gen/kaitai/pko_lmo.rs#L5052).

4. **High: generated parser strict validation may hard-fail files that native parser currently degrades through.**  
Native parser skips non-geometry entries and continues on per-geometry failures. Generated parser validates object/model node type enums and can fail the whole parse early. Decide if strictness is desired; if not, remove/relax `valid` in `.ksy`. References: [lmo.rs:1245](/Users/anirudh/gamedev/pko-tools/src-tauri/src/map/lmo.rs#L1245), [lmo.rs:1249](/Users/anirudh/gamedev/pko-tools/src-tauri/src/map/lmo.rs#L1249), [pko_lmo.rs:5014](/Users/anirudh/gamedev/pko-tools/src-tauri/gen/kaitai/pko_lmo.rs#L5014), [pko_lmo.rs:4532](/Users/anirudh/gamedev/pko-tools/src-tauri/gen/kaitai/pko_lmo.rs#L4532).

5. **High: plan ignores `is_model_info_tree` branch.**  
Generated root parser supports a separate model-node tree mode where `objects` is not populated. If adapter only iterates `objects`, those files produce empty/incorrect models. References: [pko_lmo.rs:63](/Users/anirudh/gamedev/pko-tools/src-tauri/gen/kaitai/pko_lmo.rs#L63), [pko_lmo.rs:78](/Users/anirudh/gamedev/pko-tools/src-tauri/gen/kaitai/pko_lmo.rs#L78).

6. **High: module/dependency wiring phase is incomplete as written.**  
`lib.rs` currently has no generated module declaration, and `Cargo.toml` currently has no `kaitai` dependency. Also, this repo checks in `Cargo.lock`, so lock update must be part of the phase. References: [lib.rs:3](/Users/anirudh/gamedev/pko-tools/src-tauri/src/lib.rs#L3), [Cargo.toml:34](/Users/anirudh/gamedev/pko-tools/src-tauri/Cargo.toml#L34).

7. **Medium: adapter mapping details are underspecified for data-shape mismatches.**  
Domain expects single `texcoords: Vec<[f32;2]>`, while generated mesh exposes multiple texcoord channels. Generated texture names are raw 64-byte buffers and must be C-string decoded exactly like native logic. References: [lmo.rs:145](/Users/anirudh/gamedev/pko-tools/src-tauri/src/map/lmo.rs#L145), [pko_lmo.rs:4025](/Users/anirudh/gamedev/pko-tools/src-tauri/gen/kaitai/pko_lmo.rs#L4025), [pko_lmo.rs:5929](/Users/anirudh/gamedev/pko-tools/src-tauri/gen/kaitai/pko_lmo.rs#L5929), [lmo.rs:389](/Users/anirudh/gamedev/pko-tools/src-tauri/src/map/lmo.rs#L389).

8. **Medium: runtime/toolchain reproducibility risk is real.**  
You rely on external `ksc` from PATH with no pinned version; generated Rust API compatibility with `kaitai` crate must be pinned in CI. References: [build.rs:52](/Users/anirudh/gamedev/pko-tools/src-tauri/build.rs#L52), [build.rs:70](/Users/anirudh/gamedev/pko-tools/src-tauri/build.rs#L70).

**Phasing Verdict**

Current phasing is directionally right but not sufficient for safe rollout. Do not make Kaitai default after only field-equality tests; add behavior, tolerance, and performance gates first.

**What I’d Change**

1. Add an explicit **compatibility contract** document for adapter semantics (all legacy overrides listed above).  
2. Keep `load_lmo_no_animation` on native backend initially; only switch after proving no perf regression.  
3. Build a **differential harness** that compares native vs Kaitai across corpus with normalization rules (float epsilon, quaternion sign equivalence, order guarantees).  
4. Relax or handle Kaitai validation failures so behavior matches native resilience policy.  
5. Add handling (or explicit rejection with telemetry) for `is_model_info_tree` files.  
6. Gate default-backend switch on: zero semantic diffs on corpus, no panic cases from `RefCell` access patterns, and acceptable perf/memory.

Static review only; I did not run build/tests in this read-only session.
