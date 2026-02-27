Now I have enough context. Here is my review.

---

# Review: Render State Parity Pipeline Plan

## Overall Assessment

The plan is directionally sound but has several correctness gaps, one outright shader bug, and ambiguities that will produce wrong visuals or broken Unity import behavior. It should not be implemented as written.

---

## 1. D3D-to-Unity Blend Mapping Correctness

**The blend factor enum values are different between D3D and Unity.** This is the most dangerous gap.

D3D `D3DBLEND_*` values start at 1: `ZERO=1, ONE=2, SRCCOLOR=3, INVSRCCOLOR=4, SRCALPHA=5, DESTALPHA=7, INVDESTCOLOR=10`.

Unity `BlendMode` enum starts at 0: `Zero=0, One=1, DstColor=2, SrcColor=3, SrcAlpha=5, DstAlpha=7, OneMinusSrcColor=10`.

These overlap coincidentally on some values but not all. Phase A says "Use parsed `src_blend`/`dest_blend` from LMO when available." If those raw D3D integer values ever get written into the suffix or passed directly to `material.SetInt("_SrcBlend", d3dValue)`, it is wrong. The plan must commit to one approach: **only ever encode `transp_type` (0-8) in the suffix, and do all blend factor translation in C# via lookup table.** Do not use raw `src_blend`/`dest_blend` values from the LMO as Unity blend integers anywhere in the pipeline.

**ADDITIVE3 (type 4): `SRCALPHA / DESTALPHA` in URP is problematic.** URP's default framebuffer doesn't store meaningful destination alpha — the alpha channel of the render target is typically 0 or 1 and isn't composited per-fragment in forward rendering. `Blend SrcAlpha DstAlpha` will produce incorrect results or degenerate to no contribution. This type likely needs either its own render texture setup or should be approximated as `Blend SrcAlpha One`. Document this explicitly and pick a practical fallback.

**Types 6-8: The plan is correct.** They fall through in the engine switch to ONE/ONE. But since they are named SUBTRACTIVE1-3, future maintainers will second-guess this. Add an explicit comment in both the Rust constants and the C# lookup table: *"Named SUBTRACTIVE but engine implements ONE/ONE — identical to type 1 ADDITIVE."*

---

## 2. Encoding Strategy: Name Suffixes vs glTF Extras

The suffix approach is the right call **for the current Unity runtime replacer architecture**, but it has a structural weakness that should be acknowledged.

Unity's `TOPMaterialReplacer` runs at runtime in `Awake`. That means it reruns on every scene load, potentially causing a one-frame material flash before replacement completes. A cleaner long-term architecture is an `AssetPostprocessor.OnPostprocessMaterial` that bakes the blend configuration into the imported `.mat` asset at import time. glTF extras on the material would be accessible there and would be more structured than string parsing.

If you stay with the runtime replacer, the suffix is fine. But if you ever move to AssetPostprocessor-based import, glTF extras are a better carrier.

**One practical risk with name suffixes:** Unity's glTF importer (glTFast) generates material `.asset` files named after the glTF material name — including the suffix. If two materials differ only in their PKO suffix (e.g., same base name, different opacity), Unity will correctly create two separate material assets. This is fine. If they share the same full name including suffix, Unity will deduplicate them — also fine. This is not a problem with the approach.

---

## 3. Shader Architecture

**`Blend [_SrcBlend] [_DstBlend]` is sufficient** for types 0-5 excluding type 4's DstAlpha issue noted above. No separate subtractive shader is needed — `Blend Zero OneMinusSrcColor` is achievable with `_SrcBlend=0, _DstBlend=10` (Unity enum values for Zero and OneMinusSrcColor).

**The DepthOnly pass is wrong for pure additive materials.** This is a concrete bug in the plan.

Additive effects deliberately have ZWrite Off so objects behind them remain visible. Adding a DepthOnly pass would write those fragments to the depth buffer, causing objects rendered after (later draw call order, same or higher queue) to be depth-rejected and invisible behind the additive effect. This defeats the purpose of additive blending entirely.

The DepthOnly pass is only justified for **alpha-tested opaque** materials (ZWrite On, alpha clip). For pure additive (ZWrite Off), it must be absent or explicitly disabled. This requires a shader keyword or `multi_compile` variant, not a static pass. Suggested fix: gate the DepthOnly pass behind `#pragma shader_feature _ALPHATEST_ON` and only enable it for non-additive alpha-tested materials.

---

## 4. Opacity Interaction

The engine code has an ambiguity the plan ignores:

```cpp
_rsa_0.GetStateAtom(&rsa, id[0]);   // id[0] = SRCBLEND state
rsa->value0 = D3DBLEND_SRCALPHA;    // Override the src blend value
rsa->value1 = D3DBLEND_SRCALPHA;    // What is value1?
```

`id[0]` is the SRCBLEND state atom. `value1` is likely a second field in the atom struct — possibly the state value index or a secondary override. Without the `lwRenderStateAtom` struct definition, it's unknown whether `value1` affects DestBlend. If it does, opacity-additive becomes `Blend SrcAlpha SrcAlpha` rather than `Blend SrcAlpha One`. These produce visually different results: the former caps contribution by alpha twice, the latter by alpha once. The plan assumes `Blend SrcAlpha One` without verifying this assumption.

The plan also doesn't detail how the shader implements the opacity fade. The engine multiplies texture alpha by opacity via `TEXTUREFACTOR`. In Unity, the shader needs an explicit `_Opacity` property, and the fragment shader must compute `finalAlpha = texAlpha * _Opacity`. This is not mentioned. The C# replacer needs to call `material.SetFloat("_Opacity", opacityFromSuffix)` in addition to setting blend modes.

---

## 5. Render Queue

All effect materials at queue 3000 is a practical default but causes visual issues:

- **Subtractive (type 5, ZERO/INVSRCCOLOR):** Darkens what's behind it. Should queue *before* additive effects (e.g., 2999 or 3000) so additive glow appears on top of darkened areas, matching engine draw order where subtractive objects are typically rendered first.
- **Alpha-tested FILTER (type 0):** These should be queue 2450 (AlphaTest bucket) not 3000. They are effectively opaque with a cutout, and putting them in Transparent queue causes sort-order artifacts against actual transparent objects.
- **Additive glow (types 1, 6-8):** Queue 3001+ after subtractive.

The plan should either assign per-type queues in the C# replacer lookup table, or document that the flat 3000 is an acceptable approximation.

---

## 6. Phase Structure: A and D are Duplicates

Phase A ("Rust exporter encodes blend state") and Phase D ("Exporter suffix encoding") describe the same work. Phase D even references the same suffix format. One of them should be removed. The plan as written makes it appear there are four phases when there are really three.

---

## 7. Backward Compatibility

The `__PKO_BLEND_ADD` → `__PKO_T1_A0_O100` transition is sound as long as the C# replacer detects both. One gap: `A0` in the new suffix for a type 1 material with alpha_test_enabled=false is technically correct (alpha test disabled), but what does the C# side do with `A0`? Does it mean "no alpha test" or "cutoff = 0"? Define `A0` explicitly as the sentinel for "alpha test disabled" in the parser, not as a cutoff value.

Also: existing Unity projects with already-imported glTF assets containing `__PKO_BLEND_ADD` in material names will continue working after C# is updated (backward compat). But they won't get the new per-type blend modes until re-exported from Rust. This should be communicated to users as a re-export requirement, not assumed to be transparent.

---

## 8. Opacity Encoding Precision

`O{opacity_pct}` as integer percentage loses precision. `opacity=0.333` becomes `O33`, decoded as `0.33`. For the common case of `opacity=1.0` → `O100` and `opacity=0.0` → `O0`, this is fine. But for intermediate values driving the `SRCALPHA` blend override, a 1% error could be visible. Consider encoding as a 0-255 integer (`O{floor(opacity*255)}`) to match D3D's `BYTE(_opacity * 255)` in the engine source, which avoids the double-rounding.

---

## Summary of Blockers

| # | Issue | Severity |
|---|-------|----------|
| 1 | DepthOnly pass incorrectly writes depth for additive materials | **Bug** |
| 2 | D3D vs Unity blend enum confusion if raw LMO values used | **Bug (if triggered)** |
| 3 | `value1` ambiguity in opacity override — may be `SrcAlpha/SrcAlpha` not `SrcAlpha/One` | **Unclear correctness** |
| 4 | Opacity uniform not passed to shader / shader doesn't multiply alpha | **Missing implementation** |
| 5 | DstAlpha (type 4) unusable in URP without special setup | **Approximation needed** |
| 6 | Alpha-tested FILTER at queue 3000 instead of AlphaTest bucket | **Visual artifact** |
| 7 | Phase A/D duplication | **Plan clarity** |

Fix items 1, 3, and 4 before implementation. Items 2, 5, 6 need decisions documented. Item 7 is editorial.
