**Verdict**
The plan is directionally right, but it has two major correctness risks: opacity behavior is under-specified, and the proposed `DepthOnly` pass is likely wrong for additive-style materials. I would not ship as-is.

**1. D3D-to-Unity Blend Mapping Correctness**
Your mapping for types `1-5` is correct if implemented as Unity `Blend SrcFactor DstFactor` with default `BlendOp Add`:
1. `1`: `ONE, ONE`
2. `2`: `SRC_COLOR, ONE`
3. `3`: `SRC_COLOR, ONE_MINUS_SRC_COLOR`
4. `4`: `SRC_ALPHA, DST_ALPHA`
5. `5`: `ZERO, ONE_MINUS_SRC_COLOR`

Types `6-8` mapping to `ONE, ONE` is also correct based on the provided switch fall-through behavior.

Critical caveat: this assumes no hidden `BlendOp` override elsewhere. From the snippet, no subtractive blend op is used, so type `5` is not true subtract op; it is darkening via factors.

**2. Encoding Strategy (`__PKO_T{n}_A{n}_O{n}`)**
This is practical, but not robust as the primary transport format.
1. Pros: easy to implement now, no importer surgery.
2. Cons: fragile to name edits/sanitization, collisions, and future metadata growth.

Recommendation: dual encode.
1. Primary: `material.extras` (or custom extension) with structured render state.
2. Fallback: keep suffix parsing for compatibility and legacy assets.
3. Keep old `__PKO_BLEND_ADD` reader during transition.

**3. Shader Architecture**
Property-driven blend factors in one shader is sufficient for all 9 types.  
You do not need a separate shader for type `5` if blend op stays additive (as in PKO snippet).  
You may still want separate shader variants for performance/keyword control, but not for correctness.

**4. Opacity Interaction (Most Important Gap)**
You identified the additive override, but implementation detail is missing and must be explicit:
1. If `transp_type == 1` and `opacity < 1.0`, force `SrcBlend = SrcAlpha` (dest remains `One`).
2. Ensure source alpha is actually multiplied by opacity in shader/material path (equivalent to D3D texture-factor alpha modulation).
3. Do not only encode opacity; enforce runtime override deterministically.

Also verify behavior for non-type-1 with opacity < 1.0. Engine snippet shows alpha modulation and zwrite changes, but not full blend-state implications; this needs validation against actual render-state setup (`ALPHABLENDENABLE` path).

**5. Render Queue Strategy**
Single queue `3000` for everything is risky.
1. Keep alpha-tested/filter-like materials in alpha-test queue (`2450`) when effectively cutout.
2. Keep blended/additive materials in transparent (`3000+`).
3. Consider darkening mode (`type 5`) ordering policy explicitly; it is destination-dependent and can produce unstable visuals with naive transparent sorting.

**6. DepthOnly Pass**
Do not add `DepthOnly` globally to `TOP/Effect`.
For additive and other transparent modes with PKO-like `ZWrite Off`, depth prepass will cause occlusion artifacts and break layering.  
Only use depth-writing paths when you intentionally emulate cutout behavior and have clear parity evidence.

**7. Edge Cases 6-8**
Treating `6-8` same as type `1` is correct per provided code path.  
Document clearly that this is engine behavior, not a guess.

**8. Backward Compatibility**
Transition is mostly sound only if reader-first rollout is enforced.
1. First ship Unity parser/shader that supports both old and new suffixes.
2. Then switch exporter to emit new suffix.
3. Keep old suffix support for at least one migration window.

If you reverse this, old clients break on new exports.

**9. Phase Ordering**
Current order (`Rust exporter -> Shader -> C# replacer`) is wrong for safe rollout.
Use:
1. Shader + C# replacer (support old and new formats).
2. Then Rust exporter emits new encoding.
3. Then optional cleanup removing old suffix write path.

**Blind Spots / Risks**
1. Missing explicit validation matrix (type `0-8` × opacity `{1.0,<1.0}` × alpha-test on/off).
2. No stated handling for unknown transp types (should default to engine-consistent `ONE,ONE` or fail loudly).
3. No parity tests with golden screenshots against PKO reference scenes.
4. Potential mismatch between glTF `alphaMode` and runtime shader state; define precedence rules clearly.

**Recommended Adjustments Before Implementation**
1. Add structured metadata in `extras` and keep suffix fallback.
2. Remove/avoid global `DepthOnly` for effect shader.
3. Specify exact opacity override algorithm in Unity runtime.
4. Change rollout order to consumer-first, producer-second.
5. Add parity test cases for all blend modes and opacity combinations.
