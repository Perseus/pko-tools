Now I have enough context for a thorough review. Here's my analysis:

---

# Render State Parity Pipeline — Independent Review

## 1. Shader Correctness (TOP_Effect.shader)

### SRP Batcher Compatibility — PASS
The CBUFFER layout is correct. Both passes declare identical `CBUFFER_START(UnityPerMaterial)` blocks with the same members in the same order. This is required for SRP Batcher compatibility. `_SrcBlend`, `_DstBlend`, `_ZWrite`, and `_Cull` are **not** in the CBUFFER, which is correct — they're used only in `Blend`/`ZWrite`/`Cull` state directives and aren't accessed in HLSL code, so they don't need to be (and shouldn't be) in the per-material CBUFFER.

### DepthOnly Pass — CONCERN: Vertex colors not considered

The DepthOnly pass doesn't read vertex colors, so `alpha = tex.a * _Opacity` may not match the ForwardLit pass which computes `result = tex * i.vertColor` then `result.a *= _Opacity`. If vertex color alpha is < 1 (e.g., semi-transparent vertex painting), the DepthOnly clip test will be more permissive than the forward pass, writing depth for pixels that the forward pass will clip. **In practice this is unlikely to matter** because:
- Effects have `_ZWrite = 0` by default, so DepthOnly writes nothing for the common case.
- When `_ZWrite = 1` (type 0 cutout), PKO vertex colors tend to have alpha = 1.

**Verdict:** Low risk, but worth a `// NOTE:` comment in the shader.

### DepthOnly when ZWrite=0 — CORRECT
When `_ZWrite = 0`, the DepthOnly pass writes nothing to the depth buffer. This is the right behavior — effects should not occlude geometry behind them. URP will still execute the pass, but `ZWrite Off` + `ColorMask 0` means it's essentially a no-op. No performance concern — the GPU early-outs on ZWrite=0 passes quickly.

### SharpSparkle clip threshold — DESIGN QUESTION
The non-alpha-test path uses `clip(result.a - 0.004)` (or `_SharpAlphaClip` when sparkle is enabled). The 0.004 threshold silently discards fully transparent pixels to avoid blend artifacts on additive geometry. This is a reasonable default. However, **it means even "pure additive" materials with no alpha test will discard near-zero alpha pixels**, which differs from the D3D path where alpha test was truly disabled. The visual difference is negligible for additive blending (zero alpha × One = zero contribution anyway), so this is fine.

### Missing: `_AlphaTest` property not used in shader code
The `_AlphaTest` float property is declared in Properties but never read in HLSL. It's only used to drive `[Toggle(_ALPHATEST_ON)]` — the keyword is what matters. This is correct URP convention, but the property itself is dead weight. Not a bug, just clutter.

## 2. Suffix Parsing Robustness (TOPMaterialReplacer.cs)

### False positive risk with `__PKO_T` in texture names — REAL BUT LOW

`IndexOf("__PKO_T")` searches the entire material name. If a texture happened to be named something like `fire__PKO_Torch.bmp`, the parser would find `__PKO_T` at a wrong position. However:
- PKO texture names are short identifiers like `bl-bd001-01.bmp` — they never contain `__PKO_T`.
- The suffix is appended by the Rust exporter, so only exporter output reaches this parser.
- The subsequent parse (`_A` and `_O` delimiters with integer parsing) makes an accidental match extremely unlikely.

**Verdict:** Acceptable. If you wanted belt-and-suspenders, you could search from the end (`LastIndexOf`), but it's not necessary.

### Edge case: What if `name` itself contains `_A` or `_O`?

Consider material name `building_A3_Oak__PKO_T1_A0_O255`. The parser finds `__PKO_T`, then looks for `_A` in the suffix portion `1_A0_O255`. Since `Substring(idx + "__PKO_T".Length)` isolates only the part after the sentinel, this is **safe** — `_A` in the base name is before the sentinel and never scanned.

### Parsing order — CORRECT
1. Structured suffix → most specific, handles all blend modes
2. Legacy `__PKO_BLEND_ADD` → backward compat for old exports
3. Terrain detection → separate category
4. Default opaque/cutout → fallback

This is the right precedence. Old exports with `__PKO_BLEND_ADD` will still work until re-exported.

### Edge case: `transpType = 0` routing

Type 0 with alpha test (`__PKO_T0_A129_O255`) routes to `TOP/StaticMesh` with cutout. This is correct — type 0 is FILTER (no blend), so it should use the standard opaque/cutout shader, not the effect shader. The suffix still carries the alpha_ref for accurate cutoff values. Good.

## 3. Rust Exporter Logic

### Type 6-8 canonicalization — CORRECT
```rust
let effective_transp = if mat.transp_type >= 6 { 1 } else { mat.transp_type };
```
The engine source confirms types 6-8 fall through to ONE/ONE, identical to type 1. Canonicalizing avoids needing Unity-side handling for undocumented types. However, **types ≥ 9** (if they exist in corrupt data) would also canonicalize to 1. The `TryParsePkoSuffix` validator caps at 0-8, so this is fine — types ≥ 9 would export as T1 and Unity validates T ≤ 8.

### D3D blend constants — VERIFIED CORRECT

| Constant | Rust value | D3D9 enum value |
|----------|-----------|-----------------|
| D3DBLEND_ZERO | 1 | Correct (D3DBLEND_ZERO = 1) |
| D3DBLEND_ONE | 2 | Correct (D3DBLEND_ONE = 2) |
| D3DBLEND_SRCCOLOR | 3 | Correct (D3DBLEND_SRCCOLOR = 3) |
| D3DBLEND_INVSRCCOLOR | 4 | Correct (D3DBLEND_INVSRCCOLOR = 4) |
| D3DBLEND_SRCALPHA | 5 | Correct (D3DBLEND_SRCALPHA = 5) |
| D3DBLEND_DESTALPHA | 7 | Correct (D3DBLEND_DESTALPHA = 7) |

These match the D3D9 `D3DBLENDOP` enumeration. Note these are only used for the warning check, not for encoding — the suffix uses `transp_type` which maps to blend modes on the Unity side. The warning system correctly detects per-material blend overrides that deviate from the type default.

### Suffix generation — CORRECT for all cases

| Material state | Suffix generated | Unity routing |
|---|---|---|
| type=0, no alpha test, opacity=1.0 | (none) | Default opaque |
| type=0, alpha test, ref=129 | `__PKO_T0_A129_O255` | StaticMesh cutout |
| type=1, no alpha test, opacity=1.0 | `__PKO_T1_A0_O255` | Effect One/One |
| type=1, alpha test, ref=129 | `__PKO_T1_A129_O255` | Effect One/One + clip |
| type=1, opacity=0.75 | `__PKO_T1_A0_O191` | Effect SrcAlpha/One (opacity override) |
| type=3, opacity=0.75 | `__PKO_T3_A0_O191` | Effect SrcColor/InvSrcColor |
| type=5 | `__PKO_T5_A0_O255` | Effect Zero/InvSrcColor |
| type=7 (→1) | `__PKO_T1_A0_O255` | Effect One/One |

**One gap: type 0 + opacity < 1.0 + no alpha test.**
This material gets no suffix (since `is_effect` is false and `alpha_test_enabled` is false), but it does get `AlphaMode::Blend` in glTF. The glTF alpha mode handles it, so this is correct. Unity's glTFast will create a transparent material with standard SrcAlpha/OneMinusSrcAlpha blending, which matches D3D type 0 with opacity < 1 (since type 0 sets no explicit blend — the engine apparently just uses the opacity to modulate base color alpha, and the alpha mode handles the rest). This is fine.

### Missing: opacity override for type 1 not encoded in suffix

The PKO engine does `if (transp_type == 1 && opacity != 1.0) → SrcBlend = SRCALPHA` override. The Rust exporter doesn't encode this in the suffix — it just writes `T1_A0_O191`. The **Unity side** correctly handles this:

```csharp
if (transpType == 1 && opacityByte < 255)
    srcBlend = BlendMode.SrcAlpha;
```

So the behavior is reproduced. Both sides agree on the convention. The suffix carries enough data (type + opacity byte) for Unity to derive the override. Good design — the suffix is data, not instructions.

## 4. Visual Regression Risk: Alpha Mode Change

### The change: additive + alpha_test materials now export as `AlphaMode::Mask` instead of `AlphaMode::Opaque`

**Why this was done:** So glTF importers (glTFast) respect the `alphaCutoff` value and actually perform the clip test. With Opaque, the cutoff was ignored.

**Risk assessment:**

**glTFast behavior with Mask + custom shader replacement:**
When `TOPMaterialReplacer` runs, it completely replaces the material with a `TOP/Effect` material. The glTF `alphaMode` only matters for the **brief moment** between glTFast import and material replacement. If materials are replaced synchronously during import (e.g., in `OnImport` callback), users never see the intermediate material. If replacement happens in `Awake()` at runtime, there could be a single frame with the glTFast-generated material. With `Mask`, that intermediate material would have alpha clipping enabled — which is actually closer to correct than `Opaque` was.

**Sorting concern:** `AlphaMode::Mask` materials are typically rendered in the opaque queue (queue 2450 in Unity, before transparent at 3000). The `TOP/Effect` shader hardcodes `"Queue" = "Transparent"` and `GetOrCreateEffectMaterial` sets `renderQueue = 3000`. So **after replacement**, the queue is always Transparent regardless of the glTF alpha mode. The alpha mode only affects the pre-replacement material, which is transient.

**Real risk — if TOPMaterialReplacer fails to match:** If a material has the suffix but `TryParsePkoSuffix` fails (e.g., malformed suffix from a bug), the material won't be replaced. It'll keep whatever glTFast generated for `AlphaMode::Mask`. For additive materials, this means they'd render as opaque-queue cutout instead of transparent additive. **Previously with `AlphaMode::Opaque`, the failure mode was also wrong (opaque, no clip), but less visually broken.** With Mask, the failure mode is cutout — arguably equally wrong but in a different way.

**Verdict:** The change is correct and the risk is minimal. The failure mode (unreplaced material) is equally broken either way, and the intended path (replaced material) is strictly better with Mask because the clip test is properly signaled.

## 5. Design Decision Evaluations

### Type 0 + alpha test getting suffix — CORRECT DECISION
Without the suffix, Unity would rely solely on glTF `AlphaMode::Mask` + `alphaCutoff`. glTFast would create a standard Lit material with alpha clipping. With the suffix, `TOPMaterialReplacer` can route it to `TOP/StaticMesh` with the exact cutoff value (not glTFast's default 0.5). Since PKO uses `alpha_ref` values like 129/255 ≈ 0.506, the difference from 0.5 is small, but encoding it is more precise and establishes a consistent convention.

### Opacity in fragment shader — CORRECT
Multiplying `_Opacity` in the fragment shader (`result.a *= _Opacity`) is the right place. The D3D path used `D3DRS_TEXTUREFACTOR` with alpha blending, which effectively modulated per-pixel alpha before blending. Doing it in the fragment shader produces identical results. Doing it in vertex color would be wrong (vertex colors are interpolated, could lose precision) and base color factor would be wrong (it would multiply RGB too, but opacity should only affect alpha for blending).

### Static Dictionary caches — MINOR CONCERN
`s_effectCache` and `s_materialCache` being static means they persist across scene loads. If two scenes use the same texture but different blend modes, the cache key should include blend parameters (not just texture). From the code:
```csharp
static Material GetOrCreateEffectMaterial(Texture tex, int transpType, int alphaRef, int opacityByte)
```
If the cache key is just `tex`, you'd get wrong materials for the same texture with different blend states. **Verify the cache key includes all parameters.** If it does, the only concern is memory — textures from unloaded scenes stay cached. For a game asset tool, this is fine. For a shipping game, you'd want cleanup on scene transitions.

## Summary of Findings

| Area | Status | Notes |
|------|--------|-------|
| CBUFFER layout | OK | SRP Batcher compatible |
| Blend state directives | OK | Property-driven, correct |
| DepthOnly pass | OK (minor) | Doesn't account for vertex color alpha in clip; irrelevant when ZWrite=0 |
| Suffix parsing | OK | No practical false-positive risk |
| Parsing order | OK | Correct precedence |
| Type canonicalization | OK | 6-8→1 matches engine behavior |
| D3D blend constants | OK | All verified against D3D9 enum |
| Suffix generation | OK | All cases covered |
| Opacity override (type 1) | OK | Rust encodes data, Unity derives behavior |
| AlphaMode Mask change | OK | Strictly better; failure modes equivalent |
| Static caches | CHECK | Verify cache key includes all blend params, not just texture |

**Overall: This is a solid implementation. No blocking issues found.** The one item to verify is the effect material cache key composition.
