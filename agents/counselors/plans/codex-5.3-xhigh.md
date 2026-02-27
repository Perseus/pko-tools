I can’t apply the edits directly in this session because the filesystem is read-only.

Write attempts failed with:
- `apply_patch`: `patch rejected: writing outside of the project; rejected by user approval settings`
- shell write test: `operation not permitted`

I did fully read the plan and mapped the exact changes for:

1. [lmo.rs](/Users/anirudh/gamedev/pko-tools/src-tauri/src/map/lmo.rs)
- Add missing transparency constants:
  - `TRANSP_ADDITIVE1 = 2`
  - `TRANSP_ADDITIVE2 = 3`
  - `TRANSP_ADDITIVE3 = 4`
  - `TRANSP_SUBTRACTIVE = 5`

2. [scene_model.rs](/Users/anirudh/gamedev/pko-tools/src-tauri/src/map/scene_model.rs)
- Add transp canonicalization (`6..=8 -> 1`)
- Add `default_blend_for_transp_type()` mapping for 0..8
- Add warning logs when parsed `src_blend` / `dest_blend` differ from transp defaults
- Replace legacy `__PKO_BLEND_ADD` naming with structured `__PKO_T{n}_A{n}_O{n}`
- Fix additive+alpha-test path to use `AlphaMode::Mask` with cutoff
- Add tests:
  - default blend mapping for all 9 transp types
  - canonicalization of 6/7/8 to 1
  - suffix generation for transp type 3

3. [TOP_Effect.shader](/Users/anirudh/gamedev/client-unity/pko-client/Assets/_Project/Rendering/Shaders/TOP_Effect.shader)
- Add property-driven blend/depth/cull/opacity/alpha-test properties
- Switch to `Blend [_SrcBlend] [_DstBlend]`, `ZWrite [_ZWrite]`, `Cull [_Cull]`
- Add `_Opacity` modulation and `_ALPHATEST_ON` cutoff path in fragment
- Keep sparkle clip path when alpha test is off
- Add DepthOnly pass guarded by `_ALPHATEST_ON` behavior

4. [TOPMaterialReplacer.cs](/Users/anirudh/gamedev/client-unity/pko-client/Assets/_Project/Rendering/Runtime/TOPMaterialReplacer.cs)
- Parse `__PKO_T{n}_A{n}_O{n}`
- Keep legacy `__PKO_BLEND_ADD` fallback
- Route type `0` to `TOP/StaticMesh` path (alpha-test cutout queue 2450)
- Route types `1..8` to `TOP/Effect` with per-type blend setup
- Implement transp-type -> Unity blend mapping
- Apply type-1 opacity override (`SrcAlpha` when `opacity < 255`)
- Configure `_Opacity`, `_AlphaTest`, `_Cutoff`, `_SrcBlend`, `_DstBlend`, `_ZWrite`

I could not run `cargo test`, `cargo clippy`, or Unity compile checks because I cannot write/build in this sandbox.  

1. Re-run me in a writable session and I’ll apply all edits and run verification end-to-end.
