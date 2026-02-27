Good, now I have all the context I need. Let me write the review.

---

# Render State Parity Pipeline — Review

## 1. D3D-to-Unity Blend Mapping: Mostly Correct, One Subtlety

The blend mode table is **accurate** against the engine source. The switch-case in `lwMtlTexAgent::BeginSet()` confirms all 9 types. However:

**Types 6-8 (SUBTRACTIVE1-3) falling through to ONE/ONE is correct but misleading.** The plan says "fall-through, same as type 1" — this is accurate per the C++ `switch` (no `case` for 6-8, so the `v[2]` defaults of `{D3DBLEND_ONE, D3DBLEND_ONE}` apply). But this means the plan should **not** emit `T6`, `T7`, `T8` suffixes at all — they should be canonicalized to `T1` in the Rust exporter. Emitting `T6_A0_O100` creates the illusion that types 6-8 are semantically distinct, when they're indistinguishable from type 1 at the engine level. Canonicalize to `T1` and add a code comment explaining why.

**The D3D blend factor → Unity mapping needs explicit documentation.** The plan says "Map transp_type to Unity BlendMode via lookup table" but doesn't show the actual Unity `UnityEngine.Rendering.BlendMode` enum values. Here's the mapping that must be in the C#:

| D3D Blend | Value | Unity BlendMode | Unity int |
|-----------|-------|----------------|-----------|
| ONE | 2 | One | 1 |
| SRCCOLOR | 3 | SrcColor | — **doesn't exist in Unity's enum** |
| INVSRCCOLOR | 4 | OneMinusSrcColor | 6 |
| SRCALPHA | 5 | SrcAlpha | 5 |
| DESTALPHA | 8 | DstAlpha | 7 |
| ZERO | 1 | Zero | 0 |

**Critical finding: `D3DBLEND_SRCCOLOR` has no direct Unity `BlendMode` equivalent.** Unity's `UnityEngine.Rendering.BlendMode` enum doesn't include `SrcColor`. You'll need to use the raw integer value. In URP's shader `Blend` command, you can use `Blend [_SrcBlend] [_DstBlend]` with integer property values, and `SrcColor` is **3** in Unity's internal numbering. Verify this works in URP — it does in built-in pipeline, but test it. Types 2 and 3 both use SRCCOLOR, so if this doesn't work, those two types break.

## 2. Encoding Strategy: Material Name Suffix is the Right Call

**Agree with the suffix approach over glTF extras.** Reasons:

- Unity's glTF importers (glTFast, UniGLTF) handle material `extras` inconsistently — some drop them, some expose them only through scripting APIs that differ between importers
- Material names survive every glTF → Unity import path reliably
- The suffix is human-readable in the Unity inspector, which helps debugging
- It's grep-able across the asset pipeline

**The format `__PKO_T{n}_A{n}_O{n}` is good but consider one addition:** include the raw src/dest blend when the LMO stores explicit overrides (i.e., when `src_blend`/`dest_blend` are `Some`). The engine's render state atom system allows per-material blend overrides that *differ* from the type-level defaults. The plan says "Use parsed src_blend/dest_blend from LmoMaterial when available, fall back to engine defaults" in Phase A but the suffix format doesn't encode them. If you discover materials where `src_blend` deviates from the type-level default, you'll lose that data.

That said, I'd defer this until you actually find such materials in the wild. Add an `eprintln!` / `tracing::warn!` in the Rust exporter when `src_blend`/`dest_blend` differ from the engine defaults for the given `transp_type`, so you know if the assumption is violated. Ship the simpler suffix for now.

## 3. Shader Architecture: Property-Driven Blend is Sufficient, but...

**`Blend [_SrcBlend] [_DstBlend]` is the right approach.** A single TOP/Effect shader with property-driven blending handles all 9 types. No need for separate shaders for subtractive (type 5). The `Blend Zero OneMinusSrcColor` formula works fine in a single shader pass.

**However, ZWrite behavior should also be property-driven.** The plan adds `_SrcBlend`, `_DstBlend`, `_AlphaTest`, `_Cutoff`, `_Cull` properties but doesn't mention `_ZWrite`. Different blend modes want different ZWrite behavior:

- Type 0 (FILTER): ZWrite On (opaque/alpha-tested, needs depth)
- Types 1-4 (additive variants): ZWrite Off (standard for additive/transparent)
- Type 5 (subtractive): ZWrite Off (it's a transparent blend)
- Opacity < 1.0: Engine explicitly sets `D3DRS_ZWRITEENABLE = 0`

Add `_ZWrite` as a float property (0 or 1), set in the C# replacer based on transp_type. Use `ZWrite [_ZWrite]` in the shader.

## 4. Opacity Interaction: The Plan Underspecifies a Complex Interaction

The plan correctly identifies that `ADDITIVE + opacity < 1.0` overrides SrcBlend to `SRCALPHA`. But the engine does **more** than just the blend override:

```cpp
if(_opacity != 1.0f)
{
    dev_obj->SetRenderState(D3DRS_ZWRITEENABLE, 0);
    dev_obj->SetRenderState(D3DRS_TEXTUREFACTOR, D3DCOLOR_ARGB((BYTE)(_opacity * 255), 0, 0, 0));
    dev_obj->SetTextureStageState(0, D3DTSS_ALPHAARG1, D3DTA_TEXTURE);
    dev_obj->SetTextureStageState(0, D3DTSS_ALPHAARG2, D3DTA_TFACTOR);
```

This sets up a **texture factor alpha blend**: the final alpha comes from `texture_alpha * (opacity * 255)`. The SRCALPHA blend then modulates color output by this combined alpha. In Unity terms, you need the shader to:

1. Sample texture alpha
2. Multiply by `_Opacity` uniform
3. Output that as the fragment alpha
4. Let `Blend SrcAlpha One` do its thing

The plan encodes `O{opacity_pct}` in the suffix but doesn't show how the shader uses it. The C# replacer must set a `_Opacity` float property, and the fragment shader must multiply `output.a *= _Opacity` before the blend. **This is not just a blend-mode switch — it requires shader code changes in the fragment function.** Make sure this is called out explicitly.

**For non-ADDITIVE types with opacity < 1.0:** The engine still does `ZWrite Off` and texture factor modulation, but doesn't override blend modes. These become alpha-blended with the type's blend formula but opacity-modulated alpha. The plan doesn't discuss this case. Is it common in practice? If yes, you need the same `_Opacity` shader support for all blend types, not just ADDITIVE.

## 5. Render Queue: Yes, You Need Different Queues

**Queue 3000 for everything is wrong.** Consider:

- **Type 0 (FILTER) with alpha test only**: Should render at queue 2450 (AlphaTest) with ZWrite On. These are opaque-ish objects that need to be in the depth buffer before transparent objects render. Putting them at 3000 means they render after opaque geometry and can't occlude transparent objects behind them.
- **Types 1-5 (blended)**: Queue 3000 (Transparent) is correct.
- **Type 5 (subtractive)**: Queue 3000 works, but if subtractive objects overlap with additive objects, render order matters. D3D doesn't guarantee order either, so matching PKO means accepting the same artifacts.

Recommendation: Make `_QueueOffset` a material property. Set it from C#:
- Type 0 with alpha test: `renderQueue = 2450`
- Type 0 without alpha test: shouldn't be in TOP/Effect at all (it's opaque, use TOP/Standard)
- Types 1-8: `renderQueue = 3000`

## 6. DepthOnly Pass: Problematic for Additive, Useful for Alpha-Test

**For additive (ZWrite Off) materials, a DepthOnly pass is contradictory.** The DepthOnly pass writes to the depth buffer during the depth prepass. But additive materials with ZWrite Off specifically want to *not* write depth. A DepthOnly pass would cause additive geometry to occlude things behind it, which is wrong.

**For alpha-tested materials (type 0 with alpha test), DepthOnly is correct and necessary.** Without it, alpha-tested geometry won't cast shadows or contribute to the depth prepass in URP.

Solution: Make the DepthOnly pass conditional. In URP, you can't dynamically toggle passes easily, but you can set `_ZWrite` to 0 in the DepthOnly pass too, which effectively makes it a no-op for transparent materials. Or better: use `#pragma shader_feature _ALPHATEST_ON` and only clip in the DepthOnly pass when alpha test is active. When alpha test is off and ZWrite is off, the DepthOnly pass outputs max-depth (no-op).

## 7. Backward Compatibility: Transition is Fine, but Phase It

Replacing `__PKO_BLEND_ADD` with `__PKO_T1_A0_O100` means **existing exported glTF files and Unity scenes break** until the C# replacer is updated. The plan says Phase C adds backward compat detection for the old suffix, which is correct.

**Risk:** If someone updates the Rust exporter (Phase A) but hasn't deployed the Unity changes (Phase C), newly exported buildings will have unrecognized suffixes and get the wrong materials. The plan's phase ordering (A → B → C) makes this worse.

**Recommended phase order:**

1. **Phase B first** (shader) — Adding properties with defaults of One/One is backward-compatible. Existing hardcoded materials still work.
2. **Phase C second** (C# replacer) — Add new suffix parsing + old suffix backward compat. Existing `__PKO_BLEND_ADD` still works. New suffixes also work. No breakage.
3. **Phase A last** (Rust exporter) — Switch from old suffix to new suffix. C# already handles both formats.

This ordering means at no point does an intermediate state break the pipeline.

## 8. Missing: Alpha Test + Blend Coexistence

The plan says "Fix additive+alpha-test: set AlphaMode::Mask instead of Opaque when alpha_test_enabled" — this is correct for glTF spec compliance, but the Unity side needs attention.

In PKO, alpha test and blending can coexist. A material can be `transp_type=1` (additive blend) AND have `alpha_test_enabled=true`. The engine applies both: first alpha test discards fragments below the threshold, then surviving fragments are additively blended.

In Unity's URP, you achieve this by:
1. Setting `Blend SrcBlend DstBlend` (blend mode)
2. Adding `clip(alpha - _Cutoff)` in the fragment shader (alpha test)

The plan's suffix `__PKO_T1_A129_O100` encodes this, and the shader already needs `_Cutoff`. Just make sure the C# replacer sets **both** the blend properties AND the alpha cutoff when `A > 0`. The plan seems to handle this but it's worth calling out as a test case.

## 9. Blind Spots

**A. Vertex color interaction with blending.** PKO buildings use vertex colors (you're already exporting them on the current branch). When `SrcBlend = SRCCOLOR`, the "source color" includes vertex color modulation. If your shader multiplies vertex color * texture before outputting, this works correctly. Just verify the shader does `finalColor = vertexColor * textureColor` before the blend equation applies.

**B. Alpha channel in textures.** For type 4 (`SRCALPHA / DESTALPHA`), the result depends on both source AND destination alpha channels. In URP's render pipeline, the framebuffer alpha isn't always meaningful (it depends on the render target format). If the framebuffer uses R8G8B8A8, this works. If it uses R11G11B10 (no alpha), `DstAlpha` is undefined. Check your URP asset's color format. Type 4 is likely rare — log how many materials actually use it before investing effort here.

**C. Render state restore.** In the engine, `EndSet()` restores the original blend states (saved in `_opacity_reserve_rs`). In Unity, each material has independent blend state, so this isn't an issue. No action needed — just confirming.

**D. Two-sided rendering.** The current shader has `Cull Off`. The plan adds `_Cull` property, which is right. But what does the engine do? The `_rsa_0` render state atoms might contain `D3DRS_CULLMODE` overrides per material. If so, you'd want to encode cull mode in the suffix too. Check if any LMO materials set `D3DRS_CULLMODE` in their render state atoms.

## Summary of Recommendations

1. **Canonicalize types 6-8 to type 1** in the exporter. Don't emit distinct suffix values for indistinguishable behavior.
2. **Verify `SrcColor` (blend factor 3) works in URP** shaders via `Blend [_SrcBlend] [_DstBlend]`. Test types 2 and 3 specifically.
3. **Add `_ZWrite` and `_Opacity` as shader properties.** ZWrite must be property-driven, not hardcoded.
4. **Implement `_Opacity` in the fragment shader** (`output.a *= _Opacity`), not just as a suffix data point.
5. **Reorder phases to B → C → A** to avoid any pipeline breakage during rollout.
6. **Differentiate render queues**: alpha-test-only materials at 2450, blended at 3000.
7. **Make DepthOnly conditional** on alpha test being active. Don't write depth for additive/transparent materials.
8. **Add a warning log** in Rust when `src_blend`/`dest_blend` from the LMO file differ from the engine defaults for the given `transp_type`.
9. **Verify URP framebuffer alpha format** if type 4 (DESTALPHA) is used in practice.
