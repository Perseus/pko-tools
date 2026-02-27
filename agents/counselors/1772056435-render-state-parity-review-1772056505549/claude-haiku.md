# Render State Parity Pipeline Review

I'll provide a critical analysis across the four focus areas.

---

## 1. Shader Correctness for URP

**CBUFFER Layout: SRP-Batcher Compatible** ✓
- Both passes use identical `CBUFFER_START(UnityPerMaterial)` blocks with the same variable order—this is correct for batching. The material property names (`_MainTex_ST`, `_Opacity`, `_Cutoff`, etc.) match the float properties defined in the Properties block.
- **No issue here.**

**Blend & ZWrite Logic** ⚠️ **Minor concern**
- Both ForwardLit and DepthOnly respect `[_ZWrite]`, which is good for consistency.
- **However**: When `_ZWrite = 0` (effect materials), the DepthOnly pass writes nothing. This is correct for additive effects but may cause sorting issues with overlapping transparent objects that share the same depth. If two effect meshes occupy the same screen space, neither will occlude the other, and the order is purely paint-order dependent. This is acceptable for typical effects but could be a problem for layered/composite effects.
- **Recommendation**: Document this limitation or consider adding a `_DepthPrepass` toggle if depth-sorting becomes an issue in specific scenarios.

**DepthOnly Alpha Test** ✓
- The DepthOnly pass skips alpha-testing when `_ALPHATEST_ON` is OFF, writing zero (rejecting all pixels for depth). This correctly handles non-alpha-tested effects. When enabled, it tests before writing.
- **No issue.**

**ForwardLit Fragment Output** ✓
- Line 101: `result = tex * i.vertColor` correctly modulates vertex color.
- Line 102: `result.a *= _Opacity` applies opacity as a scalar multiplier, matching the PKO engine's TEXTUREFACTOR α approach.
- **Clip logic (lines 104–109)**: Correctly routes between _ALPHATEST_ON (uses _Cutoff) and sparkle thresholds. The 0.004 default threshold is aggressive but acceptable for "hidden" alpha dithering.

**Missing: Emissive or GI Concerns?** 
- The shader has no explicit emissive output, so there's no per-pixel emission. This is correct for additive blend materials (they shouldn't also emit light). For Mask mode (alpha-test additive), this is also fine because the alpha-test removes fragments, no emission needed.

---

## 2. Suffix Parsing Robustness

**Main Concern: False Positives from Texture Names** ⚠️ **Critical issue**

```csharp
int idx = matName.IndexOf("__PKO_T");
```

This is **vulnerable to false positives**:
- A material named `"MyTexture__PKO_Torch_Diffuse"` contains `"__PKO_T"` and would attempt parsing.
- The parser would then look for `"_A"` in `"orch_Diffuse"`, fail (aIdx = -1), and return false gracefully.
- **But**: If someone names a texture `"Effect__PKO_T5_A128_O255_Glow"`, the suffix parser will match and consume the valid format, even though the rest of the name (`_Glow`) is garbage. The parser returns `true` because the regex portion is valid, but the full material name is malformed.

**Recommendation**: 
- Use a regex anchor: `"__PKO_T\\d+_A\\d+_O\\d+$"` (suffix must be at string end).
- Or validate that after parsing `oStr`, the remaining string is empty: `if (oIdx + 2 + oStr.Length != afterA.Length) return false;`

**Parsing Order Correctness** ✓
- Structured suffix → legacy → terrain → default is the right priority. Structured is most explicit, legacy is fallback.

**Edge Cases in Parsing Logic:**
- ✓ Handles negative transpType (line 188: `transpType >= 0`)
- ✓ Handles out-of-range alphaRef and opacityByte (lines 189–190)
- ⚠️ `int.TryParse` will silently fail if `tStr`, `aStr`, or `oStr` contain non-digit characters, returning `false`. This is OK (safe failure), but consider adding logging for debugging malformed suffixes.

---

## 3. Rust Exporter Logic

**Type Canonicalization (6-8 → 1)** ✓ **Correct**
```rust
let effective_transp = if mat.transp_type >= 6 { 1 } else { mat.transp_type };
```
- PKO engine lines 2087–2109 confirm types 6–8 fall through to ONE/ONE, same as type 1.
- Canonicalizing to 1 is the right choice (maintains consistency with engine behavior).

**Alpha Mode Assignment** ⚠️ **Potential visual regression**
```rust
let alpha_mode = if is_effect {
    if mat.alpha_test_enabled {
        Checked::Valid(AlphaMode::Mask)  // NEW: was Opaque
    } else {
        Checked::Valid(AlphaMode::Opaque)
    }
} ...
```

**Risk**: Changing effect + alpha_test from `Opaque` to `Mask`:
- glTFast/Unity interprets `AlphaMode::Mask` as "use alpha cutoff, place in AlphaTest render queue (2450)".
- This is **correct behavior** for PKO alpha-tested additive effects.
- **However**: If the previous exporter output `Opaque` and shipped models relied on that, Unity may have been rendering them in the Opaque queue (1700-2400 range), and switching to Mask will place them in AlphaTest (2450), potentially changing sort order relative to other geometry.
- **Verdict**: This change is **correct from a spec standpoint** but could cause visual regressions if existing scenes rely on the old queue order.
- **Mitigation**: Verify a sample model's render behavior before/after in a Unity project to confirm no regression in a real scene.

**Alpha Cutoff Generation** ✓
```rust
let alpha_cutoff = if mat.alpha_test_enabled {
    Some(AlphaCutoff((mat.alpha_ref as f32 / 255.0).clamp(0.0, 1.0)))
} else {
    None
};
```
- Correctly normalizes alpha_ref from [0, 255] to [0.0, 1.0].
- **Clamp is redundant** (alpha_ref already in [0, 255]), but defensive programming is fine.

**Structured Suffix Generation** ✓
```rust
let alpha_ref = if mat.alpha_test_enabled { mat.alpha_ref as u32 } else { 0 };
let opacity_byte = (mat.opacity.clamp(0.0, 1.0) * 255.0).round() as u32;
format!("{}__PKO_T{}_A{}_O{}", name, effective_transp, alpha_ref, opacity_byte)
```
- Correctly encodes:
  - `effective_transp` (types 0–8, with 6–8 mapped to 1)
  - `alpha_ref` (0 if no alpha_test, else the threshold)
  - `opacity_byte` (rounded, clamped opacity as 0–255)
- **Good practice**: Using `round()` for opacity conversion.

**Issue with Type 0 + Alpha Test** ⚠️ **Design question**
- The condition `is_effect || mat.alpha_test_enabled` on line 269 means **type 0 with alpha_test_enabled will get a suffix** (`__PKO_T0_A{n}_O{n}`).
- This deviates from the original plan ("suffix for types 1–8 only").
- **Justification in prompt**: Type 0 with alpha test needs suffix so Unity routes to cutout queue (2450) instead of relying on glTF alpha mode alone.
- **Counter-argument**: Type 0 is FILTER (no blend), so it should be opaque or cutout anyway. Adding a suffix complicates the parsing without changing blend behavior.
- **Verdict**: The design is **debatable** but **defensible**. If TOPMaterialReplacer.cs explicitly handles `__PKO_T0_A{n}_O{n}` (routes to cutout/mask queue), then it's consistent. **Verify that the C# code actually routes type 0 with alpha to the correct queue.**

---

## 4. Visual Regression Risks

**Mask vs. Opaque Queue Sorting** ⚠️ **Real risk**
- Changing alpha mode from Opaque → Mask moves the material from Opaque render queue (~1700–2400) to AlphaTest queue (2450).
- **Symptom**: Additive effects with alpha-test may now sort *behind* transparent objects that previously sorted in front.
- **Example**: An effect that alpha-tests (removes some pixels) and adds light should render *after* all opaque geometry but *before* other transparent effects. Changing it to Mask ensures it goes to AlphaTest queue (correct), but if glTFast's material instantiation doesn't respect the suffix-based queue override, it will use the default queue for Mask (2450), which may not align with the intended sort order.
- **Test required**: Load an LMO with alpha-tested additive effects in Unity, compare render order before/after.

**Potential glTFast Issue** ⚠️
- glTFast may not respect custom material properties set *after* material instantiation. If TOPMaterialReplacer sets `mat.renderQueue = 3000` (line 226) *after* glTFast creates the material with alpha mode Mask (default queue 2450), the override should win. **Verify this with a test scene.**

**Memory/Cache Static Dictionary** ⚠️ **Not a blocker, but suboptimal**
- Line 226 and the static caches (`s_effectCache`, `s_materialCache`) are never cleared.
- **Risk**: If a scene has 100+ unique effect materials, the caches grow unbounded. Not a major issue for typical scenes, but could be a concern for production tools with long lifetime.
- **Recommendation**: Add a method to clear caches on scene unload, or use a max-size LRU cache.

---

## Summary & Recommendations

| Category | Status | Action |
|----------|--------|--------|
| **Shader URP Compatibility** | ✓ Good | None (document DepthOnly depth-sort limitation) |
| **Suffix Parsing False Positives** | ⚠️ Risk | Add regex anchor or end-of-string validation |
| **Type 6-8 Canonicalization** | ✓ Correct | OK as-is |
| **Type 0 + Alpha Test Suffix** | ⚠️ Design | Verify C# routing; if intended, document decision |
| **Alpha Mode Regression** | ⚠️ Test Required | Render test before shipping; confirm queue sort order |
| **glTFast Material Override** | ⚠️ Test Required | Verify `renderQueue` override persists after glTFast instantiation |
| **Static Cache Unbounded Growth** | ⚠️ Minor | Consider LRU or clear on scene unload |

**Go/No-Go**: The implementation is **mostly correct** with **one critical issue** (suffix parsing false positives) and **two medium-risk areas** (visual regression testing, glTFast interaction). Fix the suffix parsing before shipping; test the visual regression on real scenes before claiming parity.
