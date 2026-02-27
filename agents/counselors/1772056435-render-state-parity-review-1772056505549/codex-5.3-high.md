**Findings (ordered by severity)**

1. **High: `TryParsePkoSuffix` is not suffix-anchored and can misroute materials.**  
   It uses `IndexOf("__PKO_T")` and parses from the first hit, not a terminal suffix. This creates false negatives (`...__PKO_T1_A0_O255_extra`) and potential false positives if material names legitimately contain that pattern.  
   Ref: [TOPMaterialReplacer.cs:169](/Users/anirudh/gamedev/client-unity/pko-client/Assets/_Project/Rendering/Runtime/TOPMaterialReplacer.cs), [TOPMaterialReplacer.cs:173](/Users/anirudh/gamedev/client-unity/pko-client/Assets/_Project/Rendering/Runtime/TOPMaterialReplacer.cs)

2. **High: Depth pass alpha logic is inconsistent with forward pass.**  
   Forward alpha uses `tex * vertexColor * opacity`; DepthOnly uses `tex * opacity` and ignores vertex color alpha. If `_ZWrite` is enabled for alpha-tested effects, depth will be written where color pass clips, causing halos/incorrect occlusion.  
   Ref: [TOP_Effect.shader:76](/Users/anirudh/gamedev/client-unity/pko-client/Assets/_Project/Rendering/Shaders/TOP_Effect.shader), [TOP_Effect.shader:143](/Users/anirudh/gamedev/client-unity/pko-client/Assets/_Project/Rendering/Shaders/TOP_Effect.shader)

3. **High: Exporter drops explicit per-material blend overrides.**  
   Rust only warns when `src_blend`/`dest_blend` deviate from transp-type defaults; it does not preserve override data into Unity routing. That is a real parity hole if those overrides exist in content.  
   Ref: [scene_model.rs:396](/Users/anirudh/gamedev/pko-tools/src-tauri/src/map/scene_model.rs), [scene_model.rs:420](/Users/anirudh/gamedev/pko-tools/src-tauri/src/map/scene_model.rs)

4. **Medium: Alpha-tested effects are always forced to transparent queue (`3000`) with `ZWrite=0`, so sorting artifacts remain likely.**  
   Moving glTF alpha mode to `Mask` helps metadata/cutoff preservation, but final Unity material still renders as transparent-queue effect. Intersecting effects can still sort badly.  
   Ref: [TOPMaterialReplacer.cs:338](/Users/anirudh/gamedev/client-unity/pko-client/Assets/_Project/Rendering/Runtime/TOPMaterialReplacer.cs), [TOPMaterialReplacer.cs:349](/Users/anirudh/gamedev/client-unity/pko-client/Assets/_Project/Rendering/Runtime/TOPMaterialReplacer.cs)

5. **Medium: Static material caches are unbounded and never cleared.**  
   `s_effectCache` and `s_materialCache` hold strong refs to `Texture`/`Material` across scene loads, which can leak memory and retain stale state in long sessions.  
   Ref: [TOPMaterialReplacer.cs:61](/Users/anirudh/gamedev/client-unity/pko-client/Assets/_Project/Rendering/Runtime/TOPMaterialReplacer.cs), [TOPMaterialReplacer.cs:64](/Users/anirudh/gamedev/client-unity/pko-client/Assets/_Project/Rendering/Runtime/TOPMaterialReplacer.cs)

6. **Low: Type-0 partial opacity path is effectively unimplemented.**  
   The code computes `opacity` but doesn’t apply blend/alpha to the created static material.  
   Ref: [TOPMaterialReplacer.cs:113](/Users/anirudh/gamedev/client-unity/pko-client/Assets/_Project/Rendering/Runtime/TOPMaterialReplacer.cs), [TOPMaterialReplacer.cs:118](/Users/anirudh/gamedev/client-unity/pko-client/Assets/_Project/Rendering/Runtime/TOPMaterialReplacer.cs)

**Direct answers to your review questions**

1. **Shader correctness:** Property-driven blend mapping is correct for URP; CBUFFER layout is SRP-batcher-safe. DepthOnly pass is the weak part (alpha mismatch + limited practical value for transparent queue).  
2. **Suffix parsing robustness:** Current parsing is brittle. Parsing order is correct (`structured -> legacy -> terrain -> default`), but parser should be strict, terminal, and last-marker based.  
3. **Rust exporter logic:** Canonicalization `6..8 -> 1` is correct. Suffix generation is mostly correct. D3D constants are correct (`ZERO=1, ONE=2, SRCCOLOR=3, INVSRCCOLOR=4, SRCALPHA=5, DESTALPHA=7`).  
   Ref: [scene_model.rs:320](/Users/anirudh/gamedev/pko-tools/src-tauri/src/map/scene_model.rs), [scene_model.rs:360](/Users/anirudh/gamedev/pko-tools/src-tauri/src/map/scene_model.rs)  
4. **Visual regressions from `Opaque -> Mask` for additive+alpha-test:** Safer than old behavior for cutoff fidelity, but it does not eliminate transparent sorting issues because final effect materials stay queue 3000 with `ZWrite=0`.

**Recommended fixes**

1. Replace parser with end-anchored regex and parse from `LastIndexOf`, or require exact terminal format `__PKO_T\d+_A\d+_O\d+$`.  
2. In DepthOnly, multiply by vertex color alpha too, or remove DepthOnly entirely unless you intentionally support `ZWrite=1` effect variants.  
3. Encode blend overrides in suffix (or glTF extras) so Unity can reproduce non-default `src/dst` states.  
4. Add cache lifecycle management (`OnDestroy`, scene-change hook, or bounded/LRU cache).
