**Verdict**
The plan is directionally correct, but not complete enough for true PKO parity. The highest-risk gaps are opacity encoding precision, depth/queue behavior, and rollout order.

Current exporter state confirms the baseline problem: only types `0/1` are explicitly handled in Rust ([lmo.rs:59](/Users/anirudh/gamedev/pko-tools/src-tauri/src/map/lmo.rs:59), [scene_model.rs:326](/Users/anirudh/gamedev/pko-tools/src-tauri/src/map/scene_model.rs:326), [scene_model.rs:365](/Users/anirudh/gamedev/pko-tools/src-tauri/src/map/scene_model.rs:365)).

**1. D3D-to-Unity blend mapping correctness**
The proposed factor mapping is correct for the provided PKO code:
1. `0 FILTER`: no blend override (treat as opaque/cutout path, not effect-transparent by default).
2. `1 ADDITIVE`: `One, One`.
3. `2 ADDITIVE1`: `SrcColor, One`.
4. `3 ADDITIVE2`: `SrcColor, OneMinusSrcColor`.
5. `4 ADDITIVE3`: `SrcAlpha, DstAlpha`.
6. `5 SUBTRACTIVE`: `Zero, OneMinusSrcColor`.
7. `6-8`: `One, One` (fallback default in engine switch).

Missing in plan: parity also depends on `ZWrite`, alpha-test behavior, and potentially blend-enable/blend-op state, not just src/dst factors.

**2. Encoding strategy (suffix vs extras)**
Material-name suffix alone is brittle (rename collisions, parsing fragility, precision loss, hard schema evolution).  
Recommended: dual encoding.
1. Canonical: glTF `extras.pko_render_state` (structured JSON).
2. Fallback: suffix for current Unity replacer compatibility.

Also encode resolved blend factors (`src/dst`) and an explicit schema version, not only `transp_type`.

**3. Shader architecture**
`Blend [_SrcBlend] [_DstBlend]` is sufficient for all listed types, including type 5. You do not need a separate subtractive shader if blend op stays additive.

But you likely need `_ZWrite` as a property (or material toggle) and queue/tag handling in C#, otherwise parity still drifts.

**4. Opacity override (critical gap)**
Plan is underspecified here. PKO behavior requires:
1. If `opacity != 1.0`: force `ZWrite Off`.
2. Multiply effective alpha by opacity.
3. Only when `transp_type == 1`: override `SrcBlend` from `One` to `SrcAlpha`.

Do not encode opacity as integer percent. That will misclassify near-1.0 values. Encode raw byte (`0..255`) or high-precision float.

**5. Render queue**
All effect materials at `3000` is too coarse.
1. Opaque/filter no alpha test: `2000`.
2. Alpha-test cutout path: `2450`.
3. True blended effects: `3000+` (with small per-mode offsets only if sorting issues appear).

**6. DepthOnly pass**
Adding DepthOnly broadly to `TOP/Effect` is risky and likely wrong for additive with `ZWrite Off`. It can create occlusion artifacts and break transparent compositing.  
Only use depth prepass behavior for cutout/opaque-like cases that are intended to write depth.

**7. Types 6-8**
Treating them as `One, One` is correct per provided PKO switch/fallback.  
If parsed `src_blend/dest_blend` exists and differs, prefer parsed values.

**8. Backward compatibility**
Keeping old `__PKO_BLEND_ADD` detection is correct.  
Do not remove old encoding immediately; support both for at least one transition window.

**9. Phase ordering**
Current order is risky for incremental rollout. Better order:
1. Unity consumer first (shader + replacer supports old + new).
2. Rust exporter emits new encoding.
3. Switch defaults and keep legacy parser.
4. Remove legacy path later.

**Bottom line**
Ship with: dual encoding, byte-accurate opacity handling, explicit zwrite/queue policy, and no blanket DepthOnly on transparent effect shader. Without these, you will fix some blend modes but still miss visual parity in common edge cases.
