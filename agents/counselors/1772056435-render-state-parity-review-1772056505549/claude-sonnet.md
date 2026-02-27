## Review: Render State Parity Pipeline

---

### 1. Shader Correctness (TOP_Effect.shader)

#### SRP Batcher Compatibility
The CBUFFER layout is **identical** across both passes — `float4 _MainTex_ST; float _Opacity; float _Cutoff; float _SharpSparkleAB; float _SharpAlphaClip;` — which is the key requirement. Render-state properties (`_SrcBlend`, `_DstBlend`, `_ZWrite`, `_Cull`) are correctly excluded from the CBUFFER since they're pipeline state, not shader uniforms. **SRP Batcher compatible as written.**

#### Blend Mode Property Mapping
Unity's `BlendMode` enum ordinals line up correctly with D3D constants for all cases used here. No issues.

#### DepthOnly Pass — Two Problems

**Problem 1 — The pass is dead for these materials.** Effect materials sit at `Queue = Transparent` (3000). URP's opaque depth prepass does not include Transparent queue objects. The DepthOnly pass will never execute for these materials in normal rendering. It's harmless but is dead code.

**Problem 2 — ZWrite [_ZWrite] in DepthOnly is wrong for alpha-tested effects.** The intent of a DepthOnly pass is to establish z-ordering for alpha-clipped surfaces so they occlude objects behind them. But `_ZWrite` is always set to `0f` in `GetOrCreateEffectMaterial`. So even when `_ALPHATEST_ON` is enabled, DepthOnly writes nothing. If you ever promote alpha-tested additive effects out of the Transparent queue (e.g. `renderQueue = 2450`), they'll still fail to write depth. The DepthOnly pass should use `ZWrite On` unconditionally — that's its entire purpose.

#### Unconditional Alpha Clip in Non-AlphaTest Branch
```hlsl
#else
    float clipThreshold = _SharpSparkleAB > 0.5 ? _SharpAlphaClip : 0.004;
    clip(result.a - clipThreshold);
#endif
```
Every fragment, for every effect material, goes through a `clip()`. For pure ONE/ONE additive effects, alpha is irrelevant to blending — discarding near-zero-alpha pixels gives a slightly different look than PKO (which draws them, adding ~zero to the buffer). The discard also interacts badly with temporal effects and MSAA. This should be opt-in, not the default path. A third branch (or just `return result;` when neither flag is set) would be cleaner.

#### `_SharpSparkleAB` Dynamic Branch
It's a float-based runtime branch (`> 0.5`) on a CBUFFER value, not a `#pragma shader_feature` variant. Dynamic branches on uniform values compile on all GPUs but won't be predicated away at compile time. For an effect shader that may run on thousands of particles, define a `_SHARP_SPARKLE` keyword variant instead.

---

### 2. Suffix Parsing Robustness (TryParsePkoSuffix)

#### False Positives
The concern is real but low-risk in practice. The full token `__PKO_T{n}_A{n}_O{n}` is specific enough that accidental matches in organic asset names are unlikely. The validation (`transpType 0–8`, `alphaRef 0–255`, `opacityByte 0–255`) filters out most accidents. The truly dangerous case is a material name like `Rock__PKO_T1_A0_O255_v2` where `oStr = "255_v2"` — `TryParse` fails, returns `false`, and the suffix is silently ignored. If such names exist in the pipeline, that's a silent miss, not a false positive. Better to use a regex (`^__PKO_T(\d+)_A(\d+)_O(\d+)$`) on the suffix portion only, which makes the contract explicit.

#### `_O` Could Appear in `tStr`
If `suffix` is `T1_OPAQUE_A0_O255`, then `aIdx = suffix.IndexOf("_A")` finds `_A` correctly (none in `T1_OPAQUE`... wait, it would find `_A` in `_OPAQUE`). Actually `"T1_OPAQUE_A0_O255".IndexOf("_A")` = 9 (position of `_A0`). `tStr = "T1_OPAQUE"` → `TryParse` fails → returns false. Safe. But this shows the fragility: the first `_A` in the suffix is used regardless of context. If the type string itself somehow contained `_A`, parsing would silently break. Not a realistic PKO texture name, but worth documenting.

#### Parsing Order
**The terrain check should come first, not third.** If a terrain material ever gets a `__PKO_T` suffix appended by a script or re-export, the structured suffix path executes before terrain detection, routing it to `TOP/Effect`. Terrain materials getting additive blend would cause severe visual breakage. The order should be: terrain → structured suffix → legacy suffix → default.

#### Missing: Suffix Must Be at String End
`int idx = matName.IndexOf("__PKO_T")` finds the first occurrence. If the suffix is embedded in the middle (`Fire__PKO_T1_A0_O255_LOD0`), `oStr = "255_LOD0"`, `TryParse` returns false, and the whole thing silently fails. You should validate that the suffix starts and `oStr` terminates the string, or use `LastIndexOf` to find the suffix anchor.

---

### 3. Rust Exporter Logic

#### Type Canonicalization
```rust
let effective_transp = if mat.transp_type >= 6 { 1 } else { mat.transp_type };
```
Correct. Engine source confirms 6–8 fall through to ONE/ONE which is identical to type 1. The only question is whether `mat.transp_type` is unsigned — if it's `u32`, the `>= 6` check is safe. If it's `i32`, negative values pass through unmodified, which would produce invalid suffix tokens. Worth confirming the field type.

#### Alpha Mode for `is_effect && alpha_test_enabled` → `Mask`
Correct change. Previously these materials were `Opaque` in glTF even though they alpha-clip. `Mask` is the correct semantic. Since TOPMaterialReplacer overrides the material anyway, this doesn't affect the runtime path — but it makes the glTF file spec-correct and useful to other tools.

#### Gap: Type 0, Opacity < 0.99, No Alpha Test
```rust
} else if mat.opacity < 0.99 {
    Checked::Valid(AlphaMode::Blend)
} else {
    Checked::Valid(AlphaMode::Opaque)
};
```
Type 0 semi-transparent (`opacity < 0.99, no alpha_test`) gets `AlphaMode::Blend` **and no suffix**. The Unity replacer's default branch handles opaque/cutout only. This material would be imported by glTFast as-is with standard URP Lit transparent — which may be acceptable, but it bypasses all custom routing. If type 0 semi-transparent exists in the scene data, add a suffix (`__PKO_T0_A0_O{opacity_byte}`) so Unity can route it explicitly.

#### `alpha_ref` Cast
```rust
let alpha_ref = if mat.alpha_test_enabled { mat.alpha_ref as u32 } else { 0 };
```
If `mat.alpha_ref` is already `u8`, `as u32` is safe. If it's a signed type like `i32`, a negative value casts to a very large `u32` and produces a suffix like `__PKO_T1_A4294967167_O255` which would fail `alphaRef <= 255` validation in Unity, silently disabling alpha test. Confirm the field type.

#### D3D Blend Constants in lmo.rs
All five named constants match the PKO reference table exactly. ✓

---

### 4. Visual Regressions

#### ZWrite Always Off for Effects — Most Significant Issue
```csharp
mat.SetFloat("_ZWrite", 0f); // forced in GetOrCreateEffectMaterial
```
The PKO engine only forces ZWrite Off when `opacity != 1.0`. For fully-opaque effects (opacity=1.0), the engine may have ZWrite On depending on the effect setup. This code always sets it to 0, which means fully-opaque additive+alpha-test effects don't occlude anything behind them. For single-layer particles this is invisible, but for alpha-tested card effects (e.g. sails, banners encoded as effects) this would cause incorrect depth layering. The fix is to set `_ZWrite = (opacityByte == 255 && transpType == 1 && alphaRef > 0) ? 1f : 0f` or expose it explicitly in the suffix.

#### Mask vs Opaque for Transparent Queue Materials
Since `renderQueue = 3000` (Transparent), glTFast's alpha mode interpretation is overridden entirely by the replacer. No regression from the `Mask` change in the replaced pipeline. However: if the replacer does NOT run (misconfigured scene, editor-only workflow), the fallback behavior is now `Mask` at queue 3000 instead of `Opaque` at queue 3000. This is actually **better** — the material would at least alpha-clip, which is closer to correct.

#### Sorting
No new sorting regression introduced. Queue 3000 + ZWrite Off was already the behavior for additive effects. The alpha mode change doesn't alter renderQueue assignment.

---

### 5. Static Dictionary Cache

```csharp
// s_effectCache and s_materialCache are static and never cleared
```

This **will** cause stale material state in Unity Editor between Play mode sessions. Unity reloads scene objects on Play/Stop but static fields persist for the lifetime of the domain (until domain reload). If a material is cached with one texture from a previous Play session and the scene reinitializes with updated textures, the old cached material is returned. In builds this matters less (single session), but in Editor it's a real pain point.

Fix: implement `[RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]` to clear the static dictionaries on domain reload:
```csharp
[RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.SubsystemRegistration)]
static void ClearCaches() { s_effectCache?.Clear(); s_materialCache?.Clear(); }
```

---

### Summary Table

| Area | Issue | Severity |
|------|-------|----------|
| Shader | ZWrite forced Off for all effects, including opacity=1.0 | High |
| Shader | DepthOnly pass is dead for Transparent queue materials | Medium |
| Shader | DepthOnly `ZWrite [_ZWrite]` defeats its own purpose | Medium |
| Shader | Unconditional 0.004 clip on additive effects | Low |
| Shader | `_SharpSparkleAB` dynamic branch instead of keyword | Low |
| Parsing | Terrain check should precede suffix checks in routing order | High |
| Parsing | `oStr` must be validated as end-of-string or use `LastIndexOf` | Medium |
| Rust | Type 0, opacity < 0.99, no alpha_test: no suffix → bypasses replacer | Medium |
| Rust | `alpha_ref` / `transp_type` field type assumptions unverified | Low |
| C# | Static caches never cleared → stale state across Editor play sessions | High |
