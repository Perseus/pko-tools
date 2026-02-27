**Findings (ordered by severity)**

1. **High: suffix parser is too permissive and can mis-route materials.**  
In `TOPMaterialReplacer.cs` (`TryParsePkoSuffix` snippet), using `IndexOf("__PKO_T")` plus partial token parsing accepts non-terminal/embedded patterns and ignores trailing junk (for example `"...__PKO_T1_A0_O255_extra"`). That can create false positives and wrong shader routing.  
Fix: require an end-anchored full match (`__PKO_T(\d+)_A(\d+)_O(\d+)$`) or at least `LastIndexOf` + exact end-of-string validation.

2. **High: Rust canonicalization currently maps `>=6` to type 1, not just 6-8.**  
[`scene_model.rs:360`](file:///Users/anirudh/gamedev/pko-tools/src-tauri/src/map/scene_model.rs:360) uses `if mat.transp_type >= 6 { 1 }`, which silently remaps unknown future/corrupt types (9+) to additive. Same pattern exists in default blend helpers (`_ => One/One`) at [`scene_model.rs:336`](file:///Users/anirudh/gamedev/pko-tools/src-tauri/src/map/scene_model.rs:336) and [`scene_model.rs:349`](file:///Users/anirudh/gamedev/pko-tools/src-tauri/src/map/scene_model.rs:349).  
Fix: canonicalize only `6..=8`; keep others explicit (warn + preserve or fail fast).

3. **Medium: effect shader alpha-test materials stay in transparent queue by design, which can cause sorting edge cases.**  
`TOP/Effect` is tagged/render-queued transparent, and replacer sets queue 3000 even when `_ALPHATEST_ON`. That avoids glTFast queue dependence, but alpha-clipped additive objects can still exhibit transparent sorting artifacts in dense overlap cases.  
Verdict: acceptable tradeoff for parity with PKO-style effect rendering, but it is not “free” of regression risk.

4. **Medium: static material caches can accumulate stale entries across scene churn.**  
`s_effectCache` / `s_materialCache` never clear. In long sessions (or domain-reload-disabled play mode), this risks unbounded growth and stale references.  
Fix: clear on scene unload / `OnDestroy`, or cap with LRU.

---

**Answers to your 4 review axes**

1. **Shader correctness (URP/SRP Batcher/DepthOnly):**  
- Property-driven blend mapping is correct for URP fixed-function blend states.  
- `UnityPerMaterial` layout shown is SRP-Batcher compatible (consistent per-pass CBUFFER, 16-byte packing is fine).  
- DepthOnly pass is functionally okay, but mostly inert when `_ZWrite=0`; that’s expected. The real risk is if `_ZWrite=1` is ever used broadly on effect materials.

2. **Suffix parsing robustness / order:**  
- Parsing logic has the false-positive issue above; tighten it.  
- Concern about texture names containing `__PKO_T` is real in principle (low probability, high confusion cost when it happens).  
- Routing order (structured → legacy → terrain → default) is correct.

3. **Rust exporter logic:**  
- D3D blend constants look correct.  
- Suffix generation format is good and consistent with Unity-side decode.  
- Type canonicalization intent is correct, implementation predicate is too broad (`>=6`).

4. **Visual regression from additive+alpha-test `Opaque`→`Mask`:**  
- If replacer succeeds, behavior should improve (cutoff preserved) and queue still ends at transparent effect material.  
- If replacer fails/misses, `Mask` fallback can render more visibly wrong than previous opaque fallback. Parser hardening is therefore critical.

---

**Strong recommendation**
- Lock parser to strict end-anchored format and add negative tests for malformed names.  
- Restrict canonicalization to `6..=8` only and add explicit test for `9` behavior.  
These two changes remove the highest-risk failure modes without changing the overall design.
