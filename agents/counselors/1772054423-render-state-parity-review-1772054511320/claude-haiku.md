# Render State Parity Pipeline Review

I've reviewed the plan against the PKO engine source code. The approach is sound overall, but there are several critical issues and edge cases that need clarification or correction.

## ✅ Strengths

1. **D3D-to-Unity Mapping is Correct** - The blend mode lookup table faithfully translates the `lwMtlTexAgent::BeginSet()` logic. Your reading of the engine source is accurate.

2. **Suffix Encoding Strategy is Pragmatic** - Using material name suffixes avoids adding custom glTF extensions, which keeps the asset format compatible with standard tooling. The format `__PKO_T{n}_A{n}_O{n}` is unambiguous within the suffix constraint.

3. **Property-Driven Shader is the Right Architecture** - Replacing hardcoded `Blend One One` with `Blend [_SrcBlend] [_DstBlend]` gives you the flexibility needed for 9 transparency types without shader sprawl.

---

## ⚠️ Critical Issues

### 1. **Opacity Override Logic Must Be Runtime, Not Baked**

**The Problem:** The plan says "encode opacity in the suffix" and has the C# replacer "handle opacity override (ADDITIVE + opacity < 1 → SrcAlpha)". But this is backwards.

The PKO engine applies the override **at render time** based on actual opacity. In your glTF export:
- You encode `opacity_pct` in the suffix (e.g., `O75`)
- The C# replacer reads this and sets a material property
- But Unity doesn't have a native "change blend mode at runtime based on a property value"

**The Fix:** 
- Encode opacity as a material property `_Opacity` (float, 0-1)
- In the shader, use the property in `[OffsetUnityInstanceID(x)]` or keyword-based branching **if you need compile-time blend changes**
- OR: Keep blend mode static and rely on alpha-blending the color output: `finalColor.a *= _Opacity` can approximate the effect
- **Better approach**: Add a shader keyword `#pragma multi_compile_local _ _OPACITY_MODULATED` and conditionally override blend in the property replacer based on `_Opacity < 1.0`

The opacity percentage alone cannot be "encoded" as static material state without either:
- Baking multiple material instances (one per opacity value) — not practical
- Using a shader property + runtime adjustment — needs implementation detail

### 2. **DepthOnly Pass for Additive Materials Needs Clarification**

**The Problem:** The plan adds a DepthOnly pass to TOP/Effect, but:
- Additive materials have `ZWrite Off` (lines 109 in engine source shows `SetRenderState(D3DRS_ZWRITEENABLE, 0)` when opacity != 1.0)
- A DepthOnly pass with `ZWrite Off` writes no depth and defeats the purpose

**What's the actual use case?**
- If you're trying to solve z-fighting for alpha-tested additive materials: the DepthOnly pass should only apply when **alpha test is enabled AND transp_type is ADDITIVE** (type 1). It writes depth to establish z-ordering, then the forward pass applies the additive blend.
- If types 2-8 with opacity != 1.0: these also disable Z-write, so DepthOnly passes for them don't help.

**The Fix:**
```hlsl
Pass
{
    Name "DepthOnly"
    ZWrite On
    ColorMask 0
    
    // Only execute if alpha-test enabled AND (not additive OR opacity == 1.0)
    // This requires conditional logic in the C# replacer
}
```
But you need to clarify: **When should DepthOnly execute?**
- Only for type 0 (FILTER) with alpha-test? 
- Or also for alpha-tested additive materials (rare)?

### 3. **Backward Compatibility Transition Is Incomplete**

**The Problem:** The plan says "still detect old `__PKO_BLEND_ADD` suffix", but:
- Old materials: `SomeMat__PKO_BLEND_ADD` (signals type 1, opacity unknown, alpha-test unknown)
- New materials: `SomeMat__PKO_T1_A129_O100` (explicit type, alpha-ref, opacity)

What should the replacer do for old materials?
- Default opacity to 100? **Yes, safe assumption.**
- Default alpha-test to off? **Yes, engine defaults alpha-test off unless explicitly enabled.**
- But you need to explicitly document this, not just say "detect old suffix."

**The Fix:** Add a migration note:
```csharp
if (matName.EndsWith("__PKO_BLEND_ADD"))
{
    // Legacy: assume type 1, alpha-test off, opacity 100%
    config = new BlendConfig { TranspType = 1, AlphaRef = 0, Opacity = 1.0f };
}
```

### 4. **FILTER + Alpha Test Encoding Needs Edge Case Handling**

**The Problem:** You encode `FILTER with alpha test` as `__PKO_T0_A129_O100`. But:
- Type 0 (FILTER) means **no blend set** — SrcBlend/DstBlend are not touched
- Alpha-ref defaults to 129 unless overridden
- Opacity defaults to 1.0

When parsing `T0_A129_O100`, the replacer should:
1. NOT set blend mode (leave it as shader defaults, likely None/Opaque in URP)
2. Set `_Cutoff = 129/255 ≈ 0.506`
3. Set `_AlphaTest = 1` (keyword or toggle)

**Risk:** If the replacer blindly sets _SrcBlend and _DstBlend to "1" (One) as defaults, type 0 materials will incorrectly get additive-like blending. You need a `_BlendMode` parameter or keyword to distinguish:
- BlendMode 0 = Opaque (no blend set, use standard alpha-test)
- BlendMode 1-8 = Apply blend from lookup table

**The Fix:** Add a `_BlendMode` integer parameter or use keywords to gate blend property application.

---

## ⚠️ Secondary Issues

### 5. **Types 6-8 (SUBTRACTIVE1-3) Fall-Through Handling**

**The Plan Says:** "Types 6-8 fall through to ONE/ONE in the engine. Is treating them identically to type 1 correct?"

**Answer:** Yes, **but only if opacity != 1.0**. Looking at the engine code:
- The default `v[2] = {D3DBLEND_ONE, D3DBLEND_ONE}` applies to unhandled types 6-8
- But if opacity != 1.0, they also hit the opacity override block (lines 114-126)
- Since they're not ADDITIVE (type 1), they skip the SRCALPHA override and stay ONE/ONE

This is correct in your plan, but **document explicitly** that types 6-8 are treated as opaque additive blending, not subtractive variations.

### 6. **Render Queue Defaulting**

**The Plan:** "Currently all effect materials use queue 3000."

**Is this right?** In URP:
- Queue 2000 = Opaque
- Queue 3000 = Transparent (default for blended)
- Queue 5000 = Overlay

For pure additive (type 1), queue 3000 is correct. But:
- Type 0 (FILTER) should be queue 2000 (opaque)
- Type 5 (SUBTRACTIVE) visually subtracts, so queue 3000 is reasonable

**The Fix:** Make render queue dynamic:
```csharp
int queue = (config.TranspType == 0) ? 2000 : 3000;
mat.renderQueue = queue;
```

### 7. **Alpha Test + Additive Coexistence**

**The Plan:** "Fix additive+alpha-test: set AlphaMode::Mask instead of Opaque when alpha_test_enabled"

This is correct, but **verify the pipeline end-to-end:**
- Exporter: `AlphaMode::Mask` + `AlphaCutoff` set (your fix)
- C# Replacer: Reads `_AlphaTest` and `_Cutoff`, applies them to shader
- Shader: Uses `clip(tex.a - _Cutoff)` before any blending

**Risk:** If the shader passes alpha to blend equation without clipping first, you'll get artifacts (soft edges on fully-transparent pixels). Verify the shader clip order.

---

## 🔍 Phase Ordering & Implementation Risks

### Phase A → B → C → D: Is the sequence right?

**Current order:** Rust exporter → Shader → C# replacer → (Phase D is redundant naming)

**This is correct, but:**
1. **Phase B (Shader) can start immediately** — the property-driven blend shader is backward compatible with old suffixes (defaults work)
2. **Phase A (Exporter)** depends on lmo.rs constants for types 2-8 (easy add)
3. **Phase C (C# Replacer)** depends on both A and B

**Risk:** If you ship Phase A exporter before Phase C replacer is ready, old scenes will load materials with new suffixes that the old replacer doesn't understand, rendering white/invisible. Mitigate by:
- Ship Phase B (shader) first (backward compatible)
- Then Phase A + C together
- Keep old replacer code as fallback

---

## 📋 Recommended Changes Before Implementation

1. **Document opacity override logic explicitly:**
   - How will the C# replacer handle `O75` (opacity 75%)? Is it a material property only, or does it trigger a keyword?
   - Does the shader implement runtime opacity modulation, or is it baked?

2. **Add DepthOnly pass guard:**
   - Only render DepthOnly when `TranspType == 0 AND AlphaTest == true`
   - Types 1-8 should skip DepthOnly (they disable Z-write)

3. **Add _BlendMode integer parameter** to clearly distinguish "no blend set" (type 0) from "apply blend" (types 1-8)

4. **Render queue logic:** Make it dynamic per transp_type

5. **Alpha test clipping in shader:** Ensure `clip()` happens before blend, not in blend equation

6. **Backward compat migration:** Document exactly what defaults apply to old `__PKO_BLEND_ADD` materials

---

## 💡 Bottom Line

**The plan is 80% correct.** The D3D→Unity blend mapping is faithful, the suffix encoding is pragmatic, and the property-driven shader is the right architecture. But:

- **Opacity override (SrcAlpha when opacity < 1.0) is under-specified** — needs concrete shader/property implementation
- **DepthOnly pass logic needs guarding** — can't write depth with ZWrite Off
- **Type 0 (FILTER) blend mode handling needs a way to disable blend application** — can't use same defaults as types 1-8

Address these three before writing Phase C code, and the implementation should be solid.
