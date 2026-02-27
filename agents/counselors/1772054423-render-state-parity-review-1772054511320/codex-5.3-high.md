**Verdict**
The direction is good, but the current plan is not parity-safe yet. The biggest gaps are opacity handling, render/depth behavior, and over-reliance on material-name encoding.

**1) Blend mapping correctness**
Your table is mostly correct, but implementation details matter:

- `T0 FILTER`: must be treated as non-blended (`ZWrite On`, alpha test optional). Do not route this through transparent effect defaults.
- `T1`: `One/One`, but when `opacity < 1`, override to `SrcAlpha/One` (only for type 1).
- `T2`: `SrcColor/One`.
- `T3`: `SrcColor/OneMinusSrcColor`.
- `T4`: `SrcAlpha/DstAlpha`.
- `T5`: `Zero/OneMinusSrcColor` (this is achievable in one shader; no special blend op needed).
- `T6-8`: default fallthrough to `One/One` is correct.

Critical nuance: opacity override applies to `T1` only, not `T6-8`.

**2) Encoding strategy (name suffix)**
Name suffixes are acceptable as a short-term transport, but weak as primary truth:

- Fragile to renaming, dedup/sanitization, and tooling changes.
- Poor precision if opacity is percent (`O{n}`); this can break edge behavior.

Best approach: write structured data in `material.extras` (or extension) and keep suffix as fallback/back-compat. If suffix remains, encode opacity as byte (`0-255`), not percent.

**3) Shader architecture**
Property-driven `Blend [_SrcBlend] [_DstBlend]` is sufficient for all listed modes, including type 5. No separate subtractive shader is required.

But do not assume blend factors alone give parity. You also need explicit control of:
- `ZWrite`
- queue/tag behavior
- alpha clip cutoff source
- opacity multiplier path (fragment alpha/content path)

**4) Opacity interaction**
Current plan is underspecified and will likely be wrong unless you implement both parts:

- Runtime override: `if (transpType == 1 && opacity < 1) SrcBlend = SrcAlpha`.
- Shader/data path: opacity must actually modulate source alpha/color as PKO does (TFACTOR path in D3D fixed-function). If you only change blend factors without applying opacity in shader/material values, parity fails.

Also: do not apply the type-1 override to types 6-8.

**5) Render queue**
Using queue `3000` for all effect materials is a simplification, not true parity.

Recommended minimum:
- `T0` alpha-tested/filter materials: cutout-style queue (`AlphaTest`, ~2450), `ZWrite On`.
- Non-filter blend types: transparent queue (`3000`), usually `ZWrite Off`.

Type 4 and type 5 are order-sensitive; expect scene-dependent differences unless you enforce deterministic draw ordering.

**6) DepthOnly pass**
Adding `DepthOnly` for transparent additive materials is risky and usually wrong.

- For `ZWrite Off` transparent effects, depth prewrite can cause incorrect occlusion/halo clipping.
- If you keep DepthOnly, gate it strictly to cutout cases that intentionally need depth writes (not generic additive).

**7) Types 6-8 treatment**
Treating 6-8 as `One/One` is correct per provided code path.  
But parity requires preserving the fact that opacity special-case is only for type 1.

**8) Backward compatibility**
Keeping old suffix detection is good.  
Two additional requirements:
- New parser must be robust and end-anchored.
- Cache keys/material identity should strip or normalize suffix to avoid unintended material duplication.

**9) Phase ordering**
Current order is not ideal. Do this instead:

1. Unity side first (shader + replacer) with support for both old and new metadata.
2. Then exporter emits new encoding.
3. Then remove old-path dependency after validation.

This avoids a broken intermediate state where exported assets carry data Unity cannot yet consume.

**Blind spots to fix before implementation**
- Precision loss from `%` opacity encoding.
- `DstAlpha` behavior (type 4) can differ depending on render target alpha semantics in URP.
- No explicit validation plan (you need a 9-type parity matrix with opacity on/off and alpha-test on/off, screenshot diffed).

