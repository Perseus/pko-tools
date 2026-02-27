Now I have a complete picture of the current state. Here's my implementation plan matching the prompt.md spec — I'll go phase by phase:

---

## Plan

### Phase 1 — `TOP_Effect.shader`
- Add properties: `_SrcBlend`, `_DstBlend`, `_ZWrite`, `_Opacity`, `_AlphaTest`, `_Cutoff`, `_Cull`
- Replace hardcoded `Blend One One / ZWrite Off / Cull Off` with `Blend [_SrcBlend] [_DstBlend]`, `ZWrite [_ZWrite]`, `Cull [_Cull]`
- Add `_ALPHATEST_ON` feature keyword; in frag: multiply `result.a *= _Opacity` and `clip(result.a - _Cutoff)` under `#ifdef _ALPHATEST_ON`
- Add DepthOnly pass guarded by `_ALPHATEST_ON` (no-op when ZWrite off)
- **Defaults preserve current behavior**: `_SrcBlend=1 (One)`, `_DstBlend=1 (One)`, `_ZWrite=0`, `_Opacity=1.0`

### Phase 2 — `TOPMaterialReplacer.cs`
- Add `TryParsePkoSuffix()` to parse `__PKO_T{n}_A{n}_O{n}` suffix
- Add `GetBlendForTranspType()` mapping (types 1-5, fallthrough 6-8→One/One)
- Expand `GetOrCreateEffectMaterial()` to accept `transpType`, `alphaRef`, `opacityByte`; sets `_SrcBlend`, `_DstBlend`, `_Opacity`, optionally enables `_ALPHATEST_ON`
- Expand effect cache key to cover new parameters
- In `Awake()` loop: `__PKO_BLEND_ADD` (legacy, type=1) → backwards compat; `__PKO_T0_*` → `GetOrCreateMaterial()` (StaticMesh); `__PKO_T{1-8}_*` → `GetOrCreateEffectMaterial()` with parsed params

### Phase 3 — `lmo.rs` + `scene_model.rs`
- Add `TRANSP_ADDITIVE1` through `TRANSP_SUBTRACTIVE` constants (types 2-5) to `lmo.rs`
- In `scene_model.rs::build_lmo_material()`:
  - Canonicalize types 6-8 → type 1
  - Replace `__PKO_BLEND_ADD` with `__PKO_T{n}_A{n}_O{n}` suffix for any non-FILTER or alpha-test material
  - Fix: when `transp_type != 0` AND `alpha_test_enabled`, use `AlphaMode::Mask` (not `Opaque`)
  - Add `default_blend_for_transp_type()` helper + warning log for deviation
- Add unit tests: helper covering all 9 types, canonicalization 6-8→1, suffix generation for type 3

**Execution order**: Phase 1 → 2 → 3 (Unity consumer ships first with backward compat, then Rust switches suffix format)

---

Shall I proceed with the implementation?
