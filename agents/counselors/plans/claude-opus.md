I now have a complete understanding of the codebase. The plan covers 3 phases, but Phases 1 and 2 are for Unity (a different repo). Only **Phase 3** applies to this repo. Let me present the plan for review.

---

## Plan: Phase 3 — Rust Exporter Render State Parity

This is the only phase that applies to this repo. Phases 1 (Unity shader) and 2 (Unity material replacer) target the `pko-client` repo which isn't present here.

### Changes

**1. `src-tauri/src/map/lmo.rs` — Add transparency type constants**

Add constants for types 2-5 (types 6-8 are identical to type 1 in the engine):

```rust
pub const TRANSP_ADDITIVE1: u32 = 2;   // SrcColor/One
pub const TRANSP_ADDITIVE2: u32 = 3;   // SrcColor/InvSrcColor
pub const TRANSP_ADDITIVE3: u32 = 4;   // SrcAlpha/DestAlpha
pub const TRANSP_SUBTRACTIVE: u32 = 5;  // Zero/InvSrcColor
```

**2. `src-tauri/src/map/scene_model.rs` — Replace `__PKO_BLEND_ADD` with structured suffix**

In `build_lmo_material()`:

- Canonicalize types 6-8 → type 1
- Replace the `__PKO_BLEND_ADD` suffix with `__PKO_T{n}_A{n}_O{n}` structured suffix encoding transp_type, alpha_ref, and opacity
- Fix additive + alpha-test: when `transp_type != 0` AND `alpha_test_enabled`, use `AlphaMode::Mask` with cutoff (currently forced to `Opaque`)
- Add warning log when parsed `src_blend`/`dest_blend` differ from engine defaults for the given transp_type

**3. Add a helper `default_blend_for_transp_type()`** returning the expected (src, dst) blend pair for each type

**4. Tests**

- Unit test for `default_blend_for_transp_type()` covering all 9 types
- Unit test that types 6-8 canonicalize to type 1
- Unit test that `build_lmo_material()` with `transp_type=3` produces correct suffix `__PKO_T3_A0_O255`
- Update existing tests if material name assertions break

Shall I proceed with implementation?
