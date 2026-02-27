**Findings (Ordered by Severity)**

1. **High: `TryParsePkoSuffix` is not suffix-anchored and uses first marker, so it can misparse or miss valid metadata.**  
   Evidence: [TOPMaterialReplacer.cs:169](/Users/anirudh/gamedev/client-unity/pko-client/Assets/_Project/Rendering/Runtime/TOPMaterialReplacer.cs:169), [TOPMaterialReplacer.cs:173](/Users/anirudh/gamedev/client-unity/pko-client/Assets/_Project/Rendering/Runtime/TOPMaterialReplacer.cs:173), [TOPMaterialReplacer.cs:193](/Users/anirudh/gamedev/client-unity/pko-client/Assets/_Project/Rendering/Runtime/TOPMaterialReplacer.cs:193).  
   Impact: material names containing `__PKO_T` earlier in the string can cause false negatives; names containing a valid-looking token in the middle can cause false routing. This is exactly where parity breaks, because effect behavior depends on this parser.

2. **High: type-0 partial opacity path is effectively a no-op (opacity is calculated then ignored).**  
   Evidence: [TOPMaterialReplacer.cs:113](/Users/anirudh/gamedev/client-unity/pko-client/Assets/_Project/Rendering/Runtime/TOPMaterialReplacer.cs:113), [TOPMaterialReplacer.cs:117](/Users/anirudh/gamedev/client-unity/pko-client/Assets/_Project/Rendering/Runtime/TOPMaterialReplacer.cs:117), [TOPMaterialReplacer.cs:118](/Users/anirudh/gamedev/client-unity/pko-client/Assets/_Project/Rendering/Runtime/TOPMaterialReplacer.cs:118).  
   Impact: if `T0_A0_O<255` ever appears, it gets routed to opaque static mesh behavior with no actual opacity application.

3. **Medium: alpha-tested effect materials are still forced to Transparent queue + `ZWrite=0`, so sorting artifacts remain.**  
   Evidence: [TOPMaterialReplacer.cs:338](/Users/anirudh/gamedev/client-unity/pko-client/Assets/_Project/Rendering/Runtime/TOPMaterialReplacer.cs:338), [TOPMaterialReplacer.cs:349](/Users/anirudh/gamedev/client-unity/pko-client/Assets/_Project/Rendering/Runtime/TOPMaterialReplacer.cs:349), [TOP_Effect.shader:21](/Users/anirudh/gamedev/client-unity/pko-client/Assets/_Project/Rendering/Shaders/TOP_Effect.shader:21), [TOP_Effect.shader:99](/Users/anirudh/gamedev/client-unity/pko-client/Assets/_Project/Rendering/Shaders/TOP_Effect.shader:99).  
   Impact: changing glTF alpha mode to `Mask` helps metadata transport, but final Unity render order is still transparent-object sorting. Expect overdraw/self-sorting issues on intersecting quads.

4. **Medium: static caches are unbounded and never cleared, holding strong refs to textures/materials across scene loads.**  
   Evidence: [TOPMaterialReplacer.cs:61](/Users/anirudh/gamedev/client-unity/pko-client/Assets/_Project/Rendering/Runtime/TOPMaterialReplacer.cs:61), [TOPMaterialReplacer.cs:64](/Users/anirudh/gamedev/client-unity/pko-client/Assets/_Project/Rendering/Runtime/TOPMaterialReplacer.cs:64).  
   Impact: memory growth and stale state risk in long sessions or multi-map workflows.

5. **Low: transp canonicalization is broader than intended (`>=6`), so unknown invalid values are silently mapped to type 1.**  
   Evidence: [scene_model.rs:361](/Users/anirudh/gamedev/pko-tools/src-tauri/src/map/scene_model.rs:361).  
   Impact: hides corrupted/out-of-spec data instead of surfacing it.

6. **Low: DepthOnly clip logic diverges from Forward when `_ALPHATEST_ON` is off.**  
   Evidence: [TOP_Effect.shader:79](/Users/anirudh/gamedev/client-unity/pko-client/Assets/_Project/Rendering/Shaders/TOP_Effect.shader:79), [TOP_Effect.shader:141](/Users/anirudh/gamedev/client-unity/pko-client/Assets/_Project/Rendering/Shaders/TOP_Effect.shader:141).  
   Impact: if `_ZWrite` is later enabled without `_ALPHATEST_ON`, depth can be written for pixels that Forward would clip with sparkle threshold.

**Direct Answers to Your 4 Questions**

1. **Shader correctness:** blend mapping is correct for URP property-driven blend states, and the CBUFFER layout is SRP-batcher safe (same `UnityPerMaterial` layout in both passes). DepthOnly pass is mostly inert in your current setup because effects are queued transparent and forced `ZWrite=0`.

2. **Suffix parser robustness:** not robust enough. `IndexOf` + non-anchored parsing is the main weak point. Parsing order is conceptually right (structured > legacy > terrain > default), but only if parser matching is strict/end-anchored.

3. **Rust exporter logic:** D3D constants/mappings are correct, and `6-8 -> 1` is correct for known PKO semantics. Suffix generation is generally correct, including type 0 + alpha test. Main issue is silent canonicalization of unknown `>8` values and dependency on fragile Unity parsing.

4. **Visual regressions from `Mask` change:** switching additive+alpha-test to `Mask` is defensible and better for transporting cutoff intent, but it does not solve transparent sorting once material is replaced to queue 3000 with `ZWrite=0`.

**Open Questions / Assumptions**

1. Do you have any real materials with `transp_type=0` and `opacity<1`? If yes, current Unity routing is wrong.
2. Should alpha-tested effect materials ever be depth-writing cutout-style (`queue 2450`) in Unity, or must they remain fully transparent-queue for strict PKO look?
3. Are material names guaranteed not to already contain `__PKO_T` before exporter suffixing?

**Best Next Fixes**

1. Make parser end-anchored and last-marker based (or regex `__PKO_T(\d+)_A(\d+)_O(\d+)$`).
2. Either support true type-0 opacity path or explicitly reject/log `T0_A0_O<255`.
3. Clear static caches on scene unload or bound them by map/session.
4. Canonicalize only `6..=8`; warn on other unknown transp values.

I did not run runtime tests/builds in this environment (read-only sandbox).
