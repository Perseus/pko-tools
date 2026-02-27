# Render State Parity Pipeline

## Context

PKO buildings/scene objects use 9 transparency types (0-8) with distinct D3D blend modes, per-material alpha test with engine-overridden ALPHAREF=129, and opacity-modulated blending. Our current pipeline only distinguishes two cases: **FILTER (type 0)** and **ADDITIVE (type 1)**. Types 2-8 are silently treated as type 0, losing their blend semantics. Additionally, the additive path forces `AlphaMode::Opaque` in glTF, discarding any alpha test that coexists with additive blending.

**The fix:** Encode per-material PKO render state via material name suffixes → read in Unity's `TOPMaterialReplacer` → configure property-driven blend modes on TOP/Effect shader.

### What NOT to change (confirmed against engine source)

- **Sampler state**: Current hardcoded Linear + LinearMipmapLinear + Repeat is **correct** — `RenderStateMgr.cpp` `_rsa_sceneobj` (lines 59-73) overrides device defaults to LINEAR or ANISOTROPIC for all scene objects.
- **TSS atoms**: Dead code in engine — `lwTex::BeginSet()` line 264-266 has TSS application commented out. No need to parse or export.

### PKO Engine Blend Mode Reference (`lwResourceMgr.cpp:2087-2109`)

| transp_type | Name | SrcBlend | DestBlend | Visual |
|-------------|------|----------|-----------|--------|
| 0 | FILTER | (no blend set) | (no blend set) | Opaque / alpha-test |
| 1 | ADDITIVE | ONE | ONE | Pure additive glow |
| 2 | ADDITIVE1 | SRCCOLOR | ONE | High-brightness additive |
| 3 | ADDITIVE2 | SRCCOLOR | INVSRCCOLOR | Soft/low additive |
| 4 | ADDITIVE3 | SRCALPHA | DESTALPHA | Alpha-weighted additive |
| 5 | SUBTRACTIVE | ZERO | INVSRCCOLOR | Darkening/shadow |
| 6-8 | SUBTRACTIVE1-3 | ONE | ONE | (fall-through in switch, identical to type 1) |

**Opacity interaction** (lines 2114-2148): When `opacity != 1.0`:
- Engine sets `ZWrite Off` for ALL types
- Sets `TEXTUREFACTOR` alpha = `opacity * 255`, blends texture alpha with it
- If `transp_type == ADDITIVE` (type 1 only, NOT 6-8): overrides SrcBlend from ONE → SRCALPHA

**Type 4 caveat**: `DstAlpha` depends on framebuffer alpha channel. URP forward rendering may not store meaningful destination alpha. Approximate as `SrcAlpha/One` if artifacts appear.

---

## Phase 1: Property-driven blend in TOP/Effect shader (Unity — backward compatible)

**Files:**
- `pko-client/Assets/_Project/Rendering/Shaders/TOP_Effect.shader`

### Changes

1. Add blend, depth, opacity, and alpha-test properties:
   ```hlsl
   Properties
   {
       _MainTex ("Texture", 2D) = "white" {}
       [Enum(UnityEngine.Rendering.BlendMode)] _SrcBlend ("Src Blend", Float) = 1  // One
       [Enum(UnityEngine.Rendering.BlendMode)] _DstBlend ("Dst Blend", Float) = 1  // One
       [Toggle] _ZWrite ("Z Write", Float) = 0
       _Opacity ("Opacity", Range(0, 1)) = 1.0
       [Toggle] _SharpSparkleAB ("Sharp Sparkle A/B", Float) = 0
       _SharpAlphaClip ("Sharp Alpha Clip", Range(0, 1)) = 0.22
       [Toggle(_ALPHATEST_ON)] _AlphaTest ("Alpha Test", Float) = 0
       _Cutoff ("Alpha Cutoff", Range(0,1)) = 0.5
       [Enum(Off,0,Front,1,Back,2)] _Cull ("Cull", Float) = 0
   }
   ```

2. Property-driven render state:
   ```hlsl
   Blend [_SrcBlend] [_DstBlend]
   ZWrite [_ZWrite]
   Cull [_Cull]
   ```

3. Fragment shader changes:
   ```hlsl
   #pragma shader_feature_local _ALPHATEST_ON

   // in CBUFFER:
   float _Opacity;
   float _Cutoff;

   // in frag():
   float4 result = tex * i.vertColor;
   result.a *= _Opacity;  // Opacity modulation (matches D3D TEXTUREFACTOR alpha)
   #ifdef _ALPHATEST_ON
       clip(result.a - _Cutoff);
   #endif
   // existing sparkle clip logic for non-alpha-test path
   ```

4. **DepthOnly pass**: Only include with `_ALPHATEST_ON` guard. When alpha test is off (additive/transparent), DepthOnly is a no-op (ZWrite Off means nothing written). When alpha test is on, DepthOnly correctly establishes z-ordering for cutout geometry.

### Defaults
- `_SrcBlend=1` (One), `_DstBlend=1` (One), `_ZWrite=0`, `_Opacity=1.0` — **identical to current behavior**. Existing materials without these properties use shader defaults = no visual change.

---

## Phase 2: TOPMaterialReplacer reads suffix and configures materials (Unity)

**Files:**
- `pko-client/Assets/_Project/Rendering/Runtime/TOPMaterialReplacer.cs`

### Changes

1. **Parse material name suffix** `__PKO_T{n}_A{n}_O{n}`:
   - `T{n}` = transp_type (0-8)
   - `A{n}` = alpha_ref (0 = no alpha test, 1-255 = alpha test at that ref)
   - `O{n}` = opacity as byte 0-255 (matching D3D's `BYTE(_opacity * 255)`)

   ```csharp
   static bool TryParsePkoSuffix(string matName, out int transpType, out int alphaRef, out int opacityByte)
   {
       // Look for __PKO_T{n}_A{n}_O{n} at end of name
       int idx = matName.IndexOf("__PKO_T");
       if (idx < 0) { transpType = -1; alphaRef = 0; opacityByte = 255; return false; }
       // Parse T, A, O values...
       return true;
   }
   ```

2. **Routing logic** in the `Awake` material loop:
   - `__PKO_BLEND_ADD` (legacy) → `GetOrCreateEffectMaterial()` with type=1, no alpha test, full opacity (backward compat)
   - `__PKO_T0_A{n}_O{n}` (FILTER with alpha test) → `GetOrCreateMaterial()` with TOP/StaticMesh, NOT TOP/Effect. Type 0 is opaque/cutout.
   - `__PKO_T{1-8}_A{n}_O{n}` → `GetOrCreateEffectMaterial()` with parsed blend config

3. **Updated `GetOrCreateEffectMaterial()`**:
   ```csharp
   static Material GetOrCreateEffectMaterial(Texture tex, int transpType, int alphaRef, int opacityByte,
                                              bool sharpSparkle, float sharpAlphaClip)
   {
       var (srcBlend, dstBlend) = GetBlendForTranspType(transpType);

       // Opacity override: type 1 + opacity < 255 → SrcBlend becomes SrcAlpha
       float opacity = opacityByte / 255f;
       if (transpType == 1 && opacityByte < 255)
           srcBlend = BlendMode.SrcAlpha;

       mat.SetFloat("_SrcBlend", (float)srcBlend);
       mat.SetFloat("_DstBlend", (float)dstBlend);
       mat.SetFloat("_ZWrite", 0f);  // All effect types: ZWrite Off
       mat.SetFloat("_Opacity", opacity);

       // Alpha test
       if (alphaRef > 0)
       {
           mat.EnableKeyword("_ALPHATEST_ON");
           mat.SetFloat("_AlphaTest", 1f);
           mat.SetFloat("_Cutoff", alphaRef / 255f);
       }

       // Render queue: 3000 for blended effects
       mat.renderQueue = 3000;
       mat.SetOverrideTag("RenderType", "Transparent");
   }
   ```

4. **Transp-type → Unity blend mapping** (matches engine switch):
   ```csharp
   static (BlendMode src, BlendMode dst) GetBlendForTranspType(int transpType)
   {
       return transpType switch
       {
           1 => (BlendMode.One, BlendMode.One),
           2 => (BlendMode.SrcColor, BlendMode.One),
           3 => (BlendMode.SrcColor, BlendMode.OneMinusSrcColor),
           4 => (BlendMode.SrcAlpha, BlendMode.DstAlpha),  // May need SrcAlpha/One fallback
           5 => (BlendMode.Zero, BlendMode.OneMinusSrcColor),
           _ => (BlendMode.One, BlendMode.One),  // 6-8 fall through
       };
   }
   ```

5. **Type 0 (FILTER) with alpha test**: Route to `GetOrCreateMaterial()` (TOP/StaticMesh) at queue 2450, NOT to TOP/Effect. Type 0 is opaque/cutout, not transparent.

---

## Phase 3: Rust exporter encodes blend state via structured suffix

**Files:**
- `src-tauri/src/map/lmo.rs` — add missing transparency type constants
- `src-tauri/src/map/scene_model.rs` — replace `__PKO_BLEND_ADD` with structured suffix, fix additive+alpha-test

### Changes to lmo.rs

Add constants for types 2-5 (6-8 canonicalize to type 1):
```rust
pub const TRANSP_FILTER: u32 = 0;
pub const TRANSP_ADDITIVE: u32 = 1;
pub const TRANSP_ADDITIVE1: u32 = 2;  // SrcColor/One
pub const TRANSP_ADDITIVE2: u32 = 3;  // SrcColor/InvSrcColor
pub const TRANSP_ADDITIVE3: u32 = 4;  // SrcAlpha/DestAlpha
pub const TRANSP_SUBTRACTIVE: u32 = 5; // Zero/InvSrcColor
// Types 6-8 fall through to ONE/ONE in engine — identical to type 1
```

### Changes to scene_model.rs `build_lmo_material()`

1. **Canonicalize types 6-8 to type 1** (they are indistinguishable in engine behavior):
   ```rust
   let effective_transp = if mat.transp_type >= 6 { 1 } else { mat.transp_type };
   ```

2. **Structured suffix** replaces `__PKO_BLEND_ADD`:
   ```rust
   let material_name = if effective_transp != TRANSP_FILTER || mat.alpha_test_enabled {
       let alpha_ref = if mat.alpha_test_enabled { mat.alpha_ref as u32 } else { 0 };
       let opacity_byte = (mat.opacity.clamp(0.0, 1.0) * 255.0).round() as u32;
       format!("{}__PKO_T{}_A{}_O{}", name, effective_transp, alpha_ref, opacity_byte)
   } else {
       name.to_string()
   };
   ```

3. **Fix additive+alpha-test**: When `transp_type != 0` AND `alpha_test_enabled`, set `AlphaMode::Mask` with cutoff (currently forced to `Opaque` with no cutoff).

4. **Add warning log** when parsed `src_blend`/`dest_blend` from LMO differ from engine defaults for the given transp_type:
   ```rust
   if let Some(sb) = mat.src_blend {
       let (default_src, _) = default_blend_for_transp_type(effective_transp);
       if sb != default_src {
           eprintln!("WARN: material '{}' has src_blend={} but type {} defaults to {}", name, sb, effective_transp, default_src);
       }
   }
   ```

### Tests
- `cargo test` — existing tests pass
- Unit test for `default_blend_for_transp_type()` covering all 9 types
- Unit test that types 6-8 are canonicalized to type 1
- Test that `build_lmo_material()` with `transp_type=3` produces correct suffix

---

## Verification

1. **Rust**: `cargo test && cargo clippy` — all pass, no warnings
2. **Re-export**: `cargo run --bin export-cli -- <client> <output> --map 07xmas2` — inspect material names for `__PKO_T{n}_A{n}_O{n}` suffixes
3. **Unity compile**: Verify no C# errors after shader/replacer changes
4. **Visual regression**: Re-import buildings in Unity:
   - Opaque/alpha-test buildings look identical (no regression)
   - Additive effects (glows, sparkles) still render correctly
   - Type 2-5 materials now have correct blend modes
5. **Building Probe overlay**: Verify `Additive`/`AlphaTest` still report correctly
6. **Opacity test**: Find a building with `opacity < 1.0` and verify fade behavior matches PKO

## Execution Order (consumer-first)

**Phase 1** → **Phase 2** → **Phase 3**

Unity consumer changes (shader + replacer) ship first with backward compatibility for `__PKO_BLEND_ADD`. Then the Rust exporter switches to the new suffix format. At no point does an intermediate state break the pipeline.

## Open Questions (deferred until implementation)

1. **Type 4 (DstAlpha)**: Verify URP framebuffer stores meaningful alpha. If not, approximate as `SrcAlpha/One`. Log how many materials actually use type 4 before investing effort.
2. **Per-material blend overrides**: The engine's render state atoms can override blend factors beyond the type-level defaults. Add warning logs when `src_blend`/`dest_blend` deviate; defer full support until a real case is found.
