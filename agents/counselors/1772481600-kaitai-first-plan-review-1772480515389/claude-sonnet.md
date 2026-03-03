I have enough to write a thorough review. Here it is:

---

## Plan Review: PKO Developer Tooling — Kaitai First

### 1. Completeness — Missing Steps

**`load_lmo_no_animation` is unaddressed in PR 8 (breaking bug).**
`lmo_loader.rs:47` hardcodes native backend for this path (`super::lmo::load_lmo_no_animation(path)`) with a comment explaining Kaitai doesn't support lazy animation instances. PR 8 deletes `lmo.rs` entirely. `scene_model.rs:1571` calls `lmo_loader::load_lmo_no_animation` for batch map loading. After deletion this call has no backend. The plan must either: implement a Kaitai path for no-animation loading, add lazy instances to `pko_lmo.ksy`, or accept a performance regression and route through `kaitai_to_lmo(..., parse_animations: false)`. This is a compile-time breakage, not a runtime risk.

**`export_cli.rs` calls `parse_obj_file` directly.**
`src/bin/export_cli.rs:153` imports and calls `scene_obj::parse_obj_file`. PR 3 proposes deleting this function from `scene_obj.rs` but doesn't mention updating the CLI binary. Export CLI will break at compile time.

**`scene_model.rs:3206` calls `lmo::load_lmo` directly in test code.**
This bypasses `lmo_loader` and goes straight to the native parser. PR 8 deletes `lmo.rs`, killing this test. Needs redirection to `lmo_loader::load_lmo`.

**PR 8 moves "10 domain structs" — the actual count is higher.**
`lmo_loader.rs` imports from `lmo.rs`: `LmoAnimData`, `LmoGeomObject`, `LmoMaterial`, `LmoModel`, `LmoMtlOpacAnim`, `LmoOpacityKeyframe`, `LmoSubset`, `LmoTexImgAnim`, `LmoTexUvAnim`, `MaterialRenderState` (with its impl block), plus `decompose_matrix43` (a function), `D3DRS_ALPHATESTENABLE/SRCBLEND/DESTBLEND/ALPHAREF/CULLMODE/ALPHAFUNC/D3DCMP_GREATER` (7 constants), `TRANSP_FILTER/ADDITIVE/ADDITIVE1/ADDITIVE2/ADDITIVE3/SUBTRACTIVE` (6 constants), `D3DCULL_NONE/CCW` (2 constants). That's ~30 items that must move to `lmo_types.rs`, not 10. `scene_model.rs` also uses `lmo::TRANSP_FILTER` and `D3DCULL_NONE` via `use super::lmo::{self, D3DCULL_NONE, ...}` — both need updating.

**EFF PR 5 doesn't specify what happens to callers of `EffFile::from_bytes`.**
`terrain.rs` (2 call sites), `map/shared.rs` (2 call sites), `item/commands.rs`, and `effect/commands.rs` all call `EffFile::from_bytes(&bytes)`. The plan says "delete read_from() helpers" but doesn't say whether `from_bytes` becomes the Kaitai loader or stays as the native shim. These callers need routing decisions before the native path is removed.

**NaN/Inf handling for golden tests is mentioned but not scoped.**
LMO and LAB files can contain degenerate floats in geometry/animation data. `insta::assert_yaml_snapshot!` will panic on NaN/Inf if they go through serde_json. The plan lists "NaN/Inf pre-processing" but that's non-trivial: requires a visitor or custom serializer for every domain type. This work belongs in PR 1 or PR 11 with explicit scope.

---

### 2. Ordering & Dependencies

**PR 2 mixes two very different work types.**
Syncing existing `.ksy` files (copy + codegen + patch) is mechanical. Authoring `pko_obj.ksy` from scratch requires reading C++ source, counting struct sizes, and validating against real files. Splitting into PR 2a (sync lab/eff) and PR 2b (author obj + codegen) would let PRs 5 and 6 start sooner without blocking on OBJ authoring risk.

**PR 10 (CLI) requires ALL adapters to be done.** There's no reason to wait. A CLI that handles just MAP and OBJ (PRs 3-4) validates the auto-detect-by-extension design. Move CLI scaffold (binary skeleton + dispatch logic) into PR 3 or 4 and add format support incrementally.

**LAB split (PR 6 + PR 7) is the right call.** Explicitly confirmed: parity confirmed before BinRead deletion. This pattern should be documented as the template for all format migrations.

**PR 8 → PR 9 sequencing is correct but slow.** Since PR 9 doesn't delete native LGO code, it could theoretically run in parallel with PR 8 if `lmo_types.rs` is stubbed first. Not a blocker, just an observation.

---

### 3. Risk — What Will Go Wrong or Take Longer

**`load_lmo_no_animation` is the highest-likelihood compile failure in the entire plan.** It's unaddressed, it's called in production code, and fixing it after-the-fact requires either `.ksy` changes or a new Kaitai parsing path.

**LAB is the highest-complexity format and should not be in PR 6 alone.** Key risks:
- `key_type = 3` (QUAT) stores position and rotation keyframes separately with their own `pos_num`/`bone_num` counts. Kaitai switch-on types can represent this but the generated Rust will trigger codegen bugs (type mismatches in computed instances, missing structs for unnamed variants).
- Bone names are fixed 64-byte null-padded buffers — common ksy gotcha.
- Frame matrix decomposition (`decompose_matrix43`) into translation+quaternion must produce bit-for-bit identical results to the native path. Floating-point order-of-operations differences will show up in parity tests.

Estimate: LAB parity is 2-3x harder than MAP or OBJ parity. PR 6 should have an explicit fallback strategy if parity is unachievable (e.g., tolerate a small float epsilon in the parity test).

**LMO `scene_model.rs` test count is higher than "30+ references."** The grep shows 40+ uses. Many are inline struct constructions (`lmo::LmoMaterial { diffuse: ..., ... }`) in test functions that span ~800 lines of tests. Updating these is mechanical but voluminous. PR 8 scope estimate should be revisited.

**`build_test_geom_blob` in `scene_model.rs:2098` builds raw LMO binary blobs.** This function currently lives in scene_model.rs tests. After deleting `lmo.rs`, the comment at line 1978 ("using test helpers from lmo::tests") may be misleading — but `build_test_geom_blob` is self-contained in scene_model.rs. Confirm that no tests actually reach into `lmo.rs` test helpers via `#[cfg(test)]` exports.

---

### 4. Kaitai Codegen — Will It Scale to 3 New Formats?

**For OBJ and MAP: yes, with minor patches.** Both are flat sequential formats with simple version branching. The deref bug and literal overflow bug will appear but are easy one-line fixes. Expect 1-3 patches per format.

**For EFF: moderate risk.** EFF has deeply nested variable-length arrays (per-frame coord lists are `Vec<Vec<[f32;2]>>`). Kaitai represents these with nested `repeat: expr` instances. Codegen tends to mistype the inner collection (wrapping `Rc<T>` where a `Vec<T>` is expected). Expect 3-6 patches.

**For LAB: high risk.** The `key_type` switch is a discriminated union over three different layout strategies (Mat43/Mat44/Quat). Kaitai switch-on is the right tool, but the generated Rust for switch-on types has known issues with missing enum variant structs (bug #4). The QUAT variant also has `pos_num` separate from `bone_num`, which likely requires a computed instance — triggering bug #3 (arithmetic type mismatches). Expect 5-10 patches and possible `.ksy` restructuring.

**Recommendation:** Before committing to the LAB ksy approach, spend one spike session generating `pko_lab.rs` from the existing ksy and attempting to fix compilation. This will reveal the true patch count before PR 6 is written.

---

### 5. Native Deletion Safety

**OBJ (PR 3):** `parse_obj_file` is called from `terrain.rs` (4 call sites) AND `export_cli.rs` (1 call site). Both must switch to `obj_loader`. The plan only mentions deleting from `scene_obj.rs`. Flag `export_cli.rs` as an explicit update target.

**MAP (PR 4):** `parse_map` is called from `terrain.rs` (7+ call sites) AND `map/texture.rs:763` in a test. All callers must switch to `map_loader`. Plan says "delete parse_map() from terrain.rs" but `parse_map` is defined IN terrain.rs and called FROM terrain.rs — clarify that `map_loader.rs` becomes the new entry point and all in-file calls reroute through it.

**EFF (PR 5):** Safe to delete `read_from`. `write_to` is kept. But `from_bytes` wraps `read_from` — decide whether `from_bytes` becomes a thin shim that calls `eff_loader` or is deleted too. Caller list above shows 6 call sites that need routing.

**LAB (PR 7):** The `#[binrw]` macro on `LwBoneFile` and related structs derives BOTH `BinRead` and `BinWrite` from a single attribute. Deleting BinRead means changing `#[binrw]` to `#[bw]` (write-only). Confirm that `#[bw]` without `#[br]` compiles cleanly — binrw's attribute splitting is documented but occasionally has issues with complex `#[br(map = ...)]` annotations. The existing `#[br(map)]` on bone name fields (line ~92 of character.rs) will need removal at the same time as the BinRead derive.

**LMO (PR 8):** Confirmed safe to delete after the `load_lmo_no_animation` issue and `scene_model.rs:3206` are fixed. The `lmo.rs` test functions (starting around line 1904) use hardcoded test file paths — these disappear with the file, which is fine.

---

### 6. LMO Type Extraction (PR 8) — Is It Safe?

**Mechanically safe but scope is underestimated.**

The extraction path is: create `lmo_types.rs` → move types → update `use` paths in `lmo_loader.rs` and `scene_model.rs` → delete `lmo.rs`. This is a pure refactor with no semantic change.

The undercount risk: the plan says "10 domain structs." The actual items needed in `lmo_types.rs` for `lmo_loader.rs` to compile include `MaterialRenderState` (struct + impl), `decompose_matrix43` (function), 7 D3DRS constants, 6+ TRANSP constants, 2 D3DCULL constants, and the 9 domain structs. For `scene_model.rs` to compile after deletion: additionally `D3DCULL_NONE`, `TRANSP_FILTER`. These are not a hidden dependency — they're visible in the `use` statements — but they expand the scope beyond what "10 structs" suggests.

**One real hidden dependency:** `scene_model.rs` references `lmo::LmoMaterial { ... }` with struct literal syntax in ~15 test functions. After extraction, these need `lmo_types::LmoMaterial` (or a re-export from `lmo_types` through a new module path). If `lmo_types` is a submodule of `map`, the `use super::lmo_types::LmoMaterial` pattern should work, but the test functions use `lmo::LmoMaterial { ... }` with the module prefix, which means every test needs a `use` statement update, not just the top-level import.

---

### 7. LGO Adapter (PR 9) — Can It Reuse `convert_geometry_chunk`?

**Partially — with a critical caveat about output types.**

The plan states: "LGO = u32 version + LMO GeometryChunk — can reuse LMO adapter's `convert_geometry_chunk()`."

The binary parsing half is correct. `pko_lgo.ksy` embeds `pko_lmo::geometry_chunk`, so if Kaitai codegen correctly handles cross-ksy type references, `pko_lgo.rs` should expose the geometry as a `PkoLmo_GeometryChunk`. The function signature `convert_geometry_chunk(chunk: &OptRc<PkoLmo_GeometryChunk>, version, parse_animations) -> Result<LmoGeomObject>` would be directly callable.

**The output type mismatch is the problem.** `convert_geometry_chunk` returns `LmoGeomObject`. The character LGO pipeline expects `CharacterGeometricModel` (from `character/model.rs`). These are structurally similar but have different field names, different material types (`LmoMaterial` vs `CharMaterialTextureInfo`), different helper data, and different vertex struct layouts. The LGO adapter can't simply forward `convert_geometry_chunk`'s output — it needs a second conversion step: `LmoGeomObject → CharacterGeometricModel`.

This second conversion is non-trivial: `CharMaterialTextureInfo` has render state atoms, texture stage info, and PKO-specific render ctrl fields that don't map cleanly from `LmoMaterial`. The plan should acknowledge this as a `lmo_geom_to_char()` translation function that needs to be written and tested as part of PR 9.

Alternatively, factor out a lower-level `parse_geometry_chunk_raw()` that returns an intermediate type both adapters consume. Either way, the plan currently implies a simpler reuse than is achievable.

**The four-file entanglement is real and correctly noted.** `character/model.rs`, `character/mesh.rs`, `character/texture.rs`, and `character/helper.rs` all participate in writing the binary output. Not deleting native is the right call.

---

### 8. Incremental Delivery — Does Each PR Stand Alone?

| PR | Standalone? | Notes |
|----|-------------|-------|
| 1 | Yes | Serialize infra is self-contained |
| 2 | Yes | Build gate is clear; split into 2a/2b recommended |
| 3 | **Needs fix** | Must include export_cli.rs update |
| 4 | **Needs fix** | texture.rs test calls parse_map; add to scope |
| 5 | **Needs fix** | Caller routing decision for from_bytes unresolved |
| 6 | Yes | Parity test without deletion is clean |
| 7 | Yes | Depends only on PR 6 parity |
| 8 | **Needs fix** | load_lmo_no_animation gap + scene_model.rs:3206 + scope undercount |
| 9 | Yes | Parity test without deletion is clean; but LmoGeomObject→CharModel gap needs acknowledgement |
| 10 | **Simplify** | Stub CLI earlier (in PR 3/4) to validate dispatch design |
| 11 | Yes | Depends on stable serialized output from all adapters |
| 12 | Yes | Documentation only |

---

### Summary of Critical Issues (must fix before execution)

1. **`load_lmo_no_animation` is not handled in PR 8** — will cause compile failure in production map export code.
2. **`export_cli.rs` calls `parse_obj_file` directly** — not in PR 3 scope, will break CLI build.
3. **`scene_model.rs:3206` calls `lmo::load_lmo` directly** — will fail after PR 8.
4. **`convert_geometry_chunk` returns `LmoGeomObject`, not `CharacterGeometricModel`** — LGO adapter needs an additional translation layer; plan currently implies direct reuse.
5. **PR 8 scope undercount** — ~30 items need to move to `lmo_types.rs`, not 10; update effort estimate.

### Recommended Pre-work

- Spike LAB codegen (generate + attempt compilation) before committing to the PR 6 scope.
- Split PR 2 into sync and authoring phases.
- Move CLI skeleton earlier (PR 3 or 4) to de-risk the dispatch design.
