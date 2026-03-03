Now I have a thorough understanding of the codebase. Let me write the review.

---

# Plan Review: PKO Developer Tooling — Kaitai First

## 1. Completeness

**Generally solid.** The plan covers all binary formats, has a clear adapter pattern established from the LMO work, and covers the full lifecycle from schema → codegen → adapter → parity → deletion → CLI → snapshots → docs.

**Missing items:**

- **`load_lmo_no_animation` path in PR 8.** The plan says "Remove Native backend, make Kaitai default" but `lmo_loader.rs:43-47` explicitly hardcodes `load_lmo_no_animation` to call the native parser with the comment "Kaitai parser eagerly parses animation data; keeping this on native avoids that overhead." After deleting `lmo.rs`, this path breaks. You either need to (a) add lazy animation parsing to `pko_lmo.ksy` before PR 8, or (b) accept the perf regression and route `no_animation` through Kaitai too, or (c) keep a minimal stub of the native no-animation parser. This should be called out explicitly.

- **`lmo::tests` test helpers.** `scene_model.rs:1978` references "test helpers from lmo::tests" for building synthetic LMO binaries. Deleting `lmo.rs` deletes these. They need to either move to a test utility module or be replaced.

- **`decompose_matrix43` function.** `lmo_loader.rs:8` imports `decompose_matrix43` from `lmo`. This is used by the Kaitai adapter itself. The plan mentions moving domain types to `lmo_types.rs` but this utility function needs to move too, and it's not a "type" — it's easy to miss.

- **Mapinfo format.** `mapinfo.rs:80` has `parse_mapinfo_bin`. Binary format, not listed. Intentional omission or missed?

- **`scene_obj_info.rs`.** Not mentioned. It parses model info from a binary format. Is it covered?

## 2. Ordering & Dependencies

The dependency graph is mostly correct. Two concerns:

**PR 8 → PR 9 dependency is correct** but the rationale could be stronger. PR 9 reuses `convert_geometry_chunk()` from `lmo_loader.rs`. That function currently imports from `lmo::`. After PR 8 moves types to `lmo_types.rs`, the import paths change. PR 9 building on top of PR 8 avoids double-migration. Good.

**PR 6 → PR 7 split is wise.** LAB has the BinWrite dependency for the import pipeline (`character/mod.rs:337-441`). Separating read deletion from the adapter is the right call.

**Potential reordering suggestion:** PR 5 (EFF) could move earlier, potentially parallel with PR 3. The EFF format already has `Serialize` on its domain types and a `write_to` method. The plan says "keep write_to()" — this is exactly the same pattern as LAB. If EFF's `read_from` helpers are cleanly separable from `write_to`, this could be a quick win.

## 3. Risk Assessment

**Highest risk: PR 8 (LMO extraction + deletion)**

This is the riskiest PR by far. Reasons:
- `scene_model.rs` has **30+ references** to `lmo::` types, not just imports but inline struct literals (`lmo::LmoMaterial { ... }`) scattered throughout ~3500 lines of code including tests
- Const re-exports: `D3DCULL_NONE`, `TRANSP_FILTER`, `TRANSP_ADDITIVE`, `TRANSP_SUBTRACTIVE`, `LW_INVALID_INDEX` are defined in `lmo.rs` and imported by both `lmo_loader.rs` and `scene_model.rs`
- The `lmo::tests` module has synthetic LMO binary builder helpers that `scene_model.rs` tests reference
- 2,579 lines deleted in one PR is a large surface area

**Mitigation:** Consider splitting PR 8 into two sub-PRs:
1. PR 8a: Create `lmo_types.rs`, move types + constants + utility functions, update all imports (no deletion)
2. PR 8b: Remove native backend, delete `lmo.rs`

This way PR 8a is a pure refactor (no behavior change, easy to verify), and PR 8b is the risky cut.

**Second highest risk: Kaitai codegen scaling (PRs 2-6)**

Four known codegen bugs with the current Rust Kaitai codegen. Adding LAB, EFF, and OBJ means 3 new generated `.rs` files to patch. Each format will likely hit different codegen bugs. The plan says "commit patched .rs files" and "PKO_KAITAI_BUILD=0 by default" — this is pragmatic but means manual patching becomes a maintenance tax.

**Key question:** How many patch-hours did the LMO patches require? If the answer is "a few hours," this scales fine. If it was "days of debugging opaque codegen output," expect the same per format.

**Third risk: LAB adapter complexity (PR 6)**

The LAB format has the most complex parsing logic:
- Bone name null-termination with 64-byte fixed buffers
- `key_type 3` with version-dependent `pos_num` expansion (parent_id == INVALID → frame_num, else 1 → expand to frame_num)
- Mat43 → quaternion decomposition
- The existing BinRead impl (`character.rs:131-225`) has ~100 lines of custom read logic per variant

This is substantially more complex than the flat OBJ/MAP/EFF formats. Estimate accordingly.

## 4. Kaitai Codegen Scaling

The four known bugs are well-documented. For the 3 new formats:

- **OBJ:** Simplest. Flat records, no version branching. Likely hits literal overflow bug if OBJ constants include `0xFFFFFFFF`. Low risk.
- **EFF:** Medium. Version-conditional fields (`if version > 1`), nested sub-effects, per-frame arrays with variable counts. May hit arithmetic type mismatches in computed instances if `.ksy` uses `if` expressions with arithmetic.
- **LAB:** Highest. Multi-variant key data (mat43/mat44/quat), conditional `pos_num` expansion, bone hierarchies. The `.ksy` will need complex `switch-on` logic with parameters passed to sub-types. The codegen's "missing struct for renamed types" bug is most likely to trigger here.

**Recommendation:** Author `pko_lab.ksy` early and do a test codegen pass before committing to the PR 6 timeline. If the codegen produces unusable Rust, you may need to consider keeping LAB native longer or writing a completely manual adapter that reads bytes directly (bypassing Kaitai codegen).

## 5. Native Deletion Safety

| PR | Deletion target | Hidden deps? | Safe? |
|----|----------------|-------------|-------|
| PR 3 (OBJ) | `parse_obj_file()` ~130 lines | Used by `terrain.rs:18` (`use crate::map::scene_obj::...`). Also used directly in `glb.rs` (check imports). | **Check `glb.rs`** — if it imports from `scene_obj`, those callers need updating to use the adapter |
| PR 4 (MAP) | `parse_map()` ~105 lines | Called from `glb.rs` terrain export path. The `ParsedMap` struct and `MapTile`/`MapSection` types are used downstream. | Safe if adapter returns identical types, but those types are *defined* in `terrain.rs`. If you delete `parse_map()` but keep the types, that's fine. If the adapter defines its own types, every downstream user needs updating. |
| PR 5 (EFF) | `read_from()` helpers ~200 lines | `EffFile::from_bytes()` calls `read_from()`. Callers: `glb.rs` effect loading. `write_to()` kept. | Safe — `from_bytes` just needs rewiring to adapter. But verify that `EffFile` struct stays identical (it already has Serialize). |
| PR 7 (LAB) | BinRead impl ~235 lines | `LwBoneFile` is read via `BinRead::read_options` in `character/mod.rs`. The struct definitions, BinWrite, and glTF conversion all stay. | **Tricky.** The `BinRead` impl is on the *struct itself* (`#[binrw]` attribute). You can't just delete BinRead without removing the `#[binrw]` attribute. But removing `#[binrw]` breaks `BinWrite`. You'd need to split to `#[derive(BinWrite)]` only, and implement a manual `from_kaitai()` constructor. This is doable but fiddly. |
| PR 8 (LMO) | `lmo.rs` 2,579 lines | See risk section above. 30+ type references in `scene_model.rs`, const exports, test helpers. | **High risk** — needs the sub-PR split described above. |

**PR 7 BinRead/BinWrite entanglement detail:** The `character.rs` animation structs use `#[binrw]` which derives *both* BinRead and BinWrite. Some structs like `LwBoneKeyInfo` have manual `impl BinRead` and `impl BinWrite` separately (`character.rs:25, 109`), so those can have BinRead deleted independently. But `LwBoneInfoHeader`, `LwBoneBaseInfo`, `LwBoneDummyInfo` use `#[binrw]` attribute — you'd need to change these to `#[derive(BinWrite)]` with manual `#[bw(little)]` attributes, and remove the `#[br(...)]` attributes. This is mechanical but easy to miss fields.

## 6. LMO Type Extraction (PR 8)

Examining the actual references in `scene_model.rs`:

**Types used:**
- `LmoMaterial` — 20+ struct literals constructed inline
- `LmoSubset` — struct literals in tests
- `LmoGeomObject` — used as parameter type
- `LmoModel` — used as parameter/return type
- `LmoAnimData` — used in tests
- `D3DCULL_NONE` — const used in material logic
- `TRANSP_FILTER`, `TRANSP_ADDITIVE`, `TRANSP_SUBTRACTIVE` — consts used in transparency classification

**Functions used:**
- `lmo::load_lmo()` — in tests only (`scene_model.rs:3206`)
- `decompose_matrix43` — used by `lmo_loader.rs` (the Kaitai adapter itself)

The extraction is **safe** provided:
1. All type definitions move verbatim (no renames, no field changes)
2. All const values move verbatim
3. `decompose_matrix43` utility function moves too
4. Import paths are mechanically updated (`use super::lmo::` → `use super::lmo_types::`)
5. `lmo_loader.rs` imports are updated to point at `lmo_types` instead of `lmo`

**One subtlety:** `MaterialRenderState` (defined in `lmo.rs:76`) is used by `lmo_loader.rs` but *not* by `scene_model.rs`. It's an internal adapter type. It should probably stay in `lmo_loader.rs` or move to `lmo_types.rs` — either works, but the plan should be explicit about which.

## 7. LGO Adapter (PR 9)

The claim that LGO = `u32 version + LMO GeometryChunk` is confirmed by `pko_lgo.ksy:17-19`:
```yaml
- id: geometry
  size-eos: true
  type: pko_lmo::geometry_chunk(version, 0)
```

**Can the adapter reuse `convert_geometry_chunk()`?** Yes, in principle. `convert_geometry_chunk` in `lmo_loader.rs:119` takes `&OptRc<PkoLmo_GeometryChunk>`. The LGO Kaitai parser will produce the same `PkoLmo_GeometryChunk` type (since it imports `pko_lmo`).

**But there are complications:**

1. **Version parameter semantics differ.** LMO's `convert_geometry_chunk` receives the file-level version. LGO's version field is the *geometry object* version, which maps differently. The `.ksy` passes `(version, 0)` — the second arg is `obj_type_filter=0` (no filtering). Need to verify that version semantics align between the LMO and LGO paths.

2. **The LGO → CharacterGeometricModel mapping is NOT the same as LMO → LmoGeomObject.** Characters have:
   - Bone weights per vertex (`blend_indices`, `blend_weights`)
   - `RenderCtrlCreateInfo` (vertex shader type)
   - `StateCtrl`
   - Helper data (dummy points, bounding spheres)
   - Different material version handling (`MTLTEX_VERSION0000/0001/0002`)

   `convert_geometry_chunk()` produces `LmoGeomObject` which lacks bone weights, render ctrl, and state ctrl. The LGO adapter needs a *superset* conversion function or a separate `convert_lgo_geometry_chunk()` that extends the LMO one.

3. **Serialize on ~15 character types.** Adding `Serialize` to `CharacterGeometricModel`, `CharacterMeshInfo`, `CharMaterialTextureInfo`, etc. These types have complex nested structures with `#[binrw]` attributes. The `Serialize` derive should work alongside `#[binrw]`, but types containing `Option<Vec<_>>` with `#[br(if(...))]` conditions need careful handling — `Serialize` will serialize `None` as null, which may not match the native output for comparison.

**Bottom line:** PR 9 can partially reuse `convert_geometry_chunk()` for the mesh/material/subset conversion, but needs additional conversion logic for bone weights, helpers, and render control info. The plan undersells this — "can reuse LMO adapter's `convert_geometry_chunk()`" is true for maybe 60% of the conversion, not 100%.

## 8. Incremental Delivery

Each PR has tests described, which is good. Checking standalone viability:

- **PR 1:** Pure infra, no behavior change. Standalone. ✓
- **PR 2:** Sync + codegen. `cargo build` passes. Standalone. ✓
- **PR 3-5:** Each has adapter + parity test + deletion. Standalone. ✓
- **PR 6:** Adapter + parity, no deletion. Standalone. ✓
- **PR 7:** Deletion only. Depends on PR 6 for the replacement read path. **But:** Does PR 6 wire the adapter into production code? Or just tests? If PR 6 only has parity tests, then PR 7 needs to also wire the adapter into the actual `load_lab()` call site. This should be explicit.
- **PR 8:** Type extraction + deletion. Standalone if done carefully. ✓
- **PR 9:** Adapter + parity. Standalone. ✓
- **PR 10-12:** CLI, snapshots, docs. Each standalone. ✓

**Missing wiring step:** For each adapter PR (3-6, 9), the plan describes writing the adapter and parity tests. But it doesn't explicitly say "update the call site to use the adapter." For OBJ (PR 3), who calls `parse_obj_file`? Answer: `terrain.rs:18` imports it and `glb.rs` uses it. The adapter needs to either (a) replace the function in-place, or (b) update all callers. The plan says "delete parse_obj_file" but doesn't say "update glb.rs to call the adapter." Make sure each PR includes the caller rewiring.

## Summary of Critical Findings

1. **`load_lmo_no_animation` breaks in PR 8** — hardcoded to native, will fail when `lmo.rs` is deleted
2. **PR 8 should be split** into type-extraction refactor + deletion for safety
3. **PR 7 BinRead removal** requires changing `#[binrw]` → `#[derive(BinWrite)]` on shared structs — mechanical but needs careful attention
4. **PR 9 undersells LGO complexity** — `CharacterGeometricModel` has bone weights, helpers, render ctrl that `LmoGeomObject` doesn't — can't just reuse `convert_geometry_chunk()` wholesale
5. **LAB codegen risk** — do a test codegen pass early before committing to the timeline
6. **Caller rewiring** not explicitly listed in adapter PRs — each deletion PR must also update all call sites
7. **`decompose_matrix43` and other utility functions** need to move alongside types in PR 8
