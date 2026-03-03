1. **Critical gaps / missing decisions**
- The action system is not decision-complete yet on conflict resolution and priority. You currently have multiple global `keydown` owners ([EffectWorkbench.tsx](/Users/anirudh/gamedev/pko-tools/src/features/effect/EffectWorkbench.tsx):163, [KeyframeProperties.tsx](/Users/anirudh/gamedev/pko-tools/src/features/effect/KeyframeProperties.tsx):118, [EffectViewport.tsx](/Users/anirudh/gamedev/pko-tools/src/features/effect/EffectViewport.tsx):72, [sidebar.tsx](/Users/anirudh/gamedev/pko-tools/src/components/ui/sidebar.tsx):98). The plan should explicitly define precedence (`modal > text-input > focused surface > global`) and shortcut collision policy.
- Async race handling is under-scoped. It calls out navigators in general, but concrete risk exists in multiple places now: [ItemNavigator.tsx](/Users/anirudh/gamedev/pko-tools/src/features/item/ItemNavigator.tsx):99, [MapNavigator.tsx](/Users/anirudh/gamedev/pko-tools/src/features/map/MapNavigator.tsx):58, [BuildingsNavigator.tsx](/Users/anirudh/gamedev/pko-tools/src/features/buildings/BuildingsNavigator.tsx):64, and selection updates in [CharacterNavigator.tsx](/Users/anirudh/gamedev/pko-tools/src/features/character/CharacterNavigator.tsx):55.
- Render-state split needs a concrete synchronization contract. Right now `currentTime` is updated every frame in global atom state ([EffectPlaybackDriver.tsx](/Users/anirudh/gamedev/pko-tools/src/features/effect/EffectPlaybackDriver.tsx):35), and several components subscribe directly ([EffectViewport.tsx](/Users/anirudh/gamedev/pko-tools/src/features/effect/EffectViewport.tsx):65). The plan should define how UI samples clock state without frame-rate rerender pressure.
- glTF resource unification is missing ownership semantics for `useGLTF` cache and URL lifecycle. Repeated converters exist ([ItemModelViewer.tsx](/Users/anirudh/gamedev/pko-tools/src/features/item/ItemModelViewer.tsx):19, [MapTerrainViewer.tsx](/Users/anirudh/gamedev/pko-tools/src/features/map/MapTerrainViewer.tsx):6, [BuildingsModelViewer.tsx](/Users/anirudh/gamedev/pko-tools/src/features/buildings/BuildingsModelViewer.tsx):5, [CharacterWorkbench.tsx](/Users/anirudh/gamedev/pko-tools/src/features/character/CharacterWorkbench.tsx):13), plus ad-hoc base64 URI creation ([CharacterBinder.tsx](/Users/anirudh/gamedev/pko-tools/src/features/effect/CharacterBinder.tsx):115). You need explicit ref-counting/dispose/`useGLTF.clear` rules.
- `preserveDrawingBuffer` gating is risky without a rendering-context decision. It is always on now ([EffectViewport.tsx](/Users/anirudh/gamedev/pko-tools/src/features/effect/EffectViewport.tsx):92), but capture currently uses `canvas.captureStream` ([ExportDialog.tsx](/Users/anirudh/gamedev/pko-tools/src/features/effect/ExportDialog.tsx):35) which does not require preserving the draw buffer. The plan should choose one capture model and lock it.
- Undo lifecycle reset is listed, but boundary behavior is not defined (when to preserve history vs clear). `resetHistory` exists ([useEffectHistory.ts](/Users/anirudh/gamedev/pko-tools/src/features/effect/useEffectHistory.ts):59) and is not called on effect switch ([EffectNavigator.tsx](/Users/anirudh/gamedev/pko-tools/src/features/effect/EffectNavigator.tsx):67). Decide behavior for switch, save-as, import, and discard.
- The plan assumes `cmdk`, but dependency and integration surface are not in execution details. `cmdk` is not in deps ([package.json](/Users/anirudh/gamedev/pko-tools/package.json):15).

2. **Sequencing or dependency risks**
- Phase 1 says race guards in navigators, but if implemented narrowly (character-only), stale writes will remain in map/item/buildings. This should be an all-navigator invariant before moving on.
- Doing `preserveDrawingBuffer` changes before capture-path decisions can cause export regressions.
- Putting action kernel and keyboard centralization late means you will edit the same files twice (once for stabilization, again for key migration), increasing churn and regression risk.
- Phase 2 combines multiple broad perf changes (state split + loader refactor + marker instancing). That is too much blast radius for one gate.
- Hot-path allocation fixes need method-level specificity. Current allocs are in both [EffectSubRenderer.tsx](/Users/anirudh/gamedev/pko-tools/src/features/effect/EffectSubRenderer.tsx):400 and [StripEffectRenderer.tsx](/Users/anirudh/gamedev/pko-tools/src/features/effect/StripEffectRenderer.tsx):326; grouping them without isolated benchmarks obscures wins/regressions.

3. **Architecture adjustments (with rationale)**
- Add a shared `LatestOnlyRequest` utility (token/version + optional abort) and mandate it for every navigator load path. Rationale: same race class appears across three workbenches.
- Introduce a `PlaybackClockStore` (external mutable store + subscribe) and keep Jotai for control state only (`isPlaying`, `speed`, loop, scrub target). Rationale: remove frame-frequency atom writes while preserving UI control semantics.
- Define action architecture as two layers: pure descriptors (`id`, `title`, `enabled`, `reason`) + effectful executors (`run(ctx)`), with a single `KeyboardRouter` consuming descriptors. Rationale: deterministic parity across shortcuts/palette/toolbar/context menus.
- Create one `gltfResource` service with object-URL cache + ref counting + explicit `release()` and optional LRU. Rationale: remove duplicate JSON→DataURI logic and make cache disposal testable.
- For renderer hot paths, use reusable typed-array pools and prebuilt geometries instead of per-frame `new` patterns. Rationale: current frame loop allocates vectors/geometries repeatedly in strip and sub-effect deformation.
- Make capture behavior explicit: if only video capture is required, disable default `preserveDrawingBuffer`; if still needed for screenshot workflows, isolate screenshot path from live canvas. Rationale: avoid global GPU penalty.

4. **Testing/rollout hardening suggestions**
- Add targeted tests for listener cleanup and leak prevention in character loads (assert unlisten called and callback count stable) around [CharacterNavigator.tsx](/Users/anirudh/gamedev/pko-tools/src/features/character/CharacterNavigator.tsx):61.
- Add race tests for map/item/building selectors: late response must not commit state after a newer selection.
- Add action parity tests: one matrix that verifies each action ID behaves identically from shortcut, toolbar, and palette.
- Add keyboard precedence tests for conflicting shortcuts (`Cmd+B`, `Cmd+S`, `Cmd+Z`, text-input focus).
- Add numeric perf gates, not qualitative ones: e.g., max React commits/sec during playback, p95 frame time, JS heap delta over 30s playback, max allocation rate in strip/effect renderers.
- Use two feature flags, not one: `actionKernelEnabled` and `cmdkUIEnabled`. Keep kill switches until parity and perf pass.

5. **Revised execution order**
1. Phase 0: Lock decisions (action precedence, playback store contract, glTF ownership, capture strategy) and capture baseline metrics.
2. Phase 1: Correctness fixes only (character listener cleanup, all-navigator race guards, history reset on document switch, error boundaries).
3. Phase 2: Introduce action kernel + keyboard router without Cmd+K UI; migrate legacy shortcuts to action IDs first.
4. Phase 3: Render/perf refactor (playback clock split, frame-write removal, hot-path allocation fixes).
5. Phase 4: Shared glTF resource migration across character/item/map/buildings + map marker instancing.
6. Phase 5: Cmd+K UI and contextual surfaces (toolbar/context menus) on top of existing action IDs.
7. Phase 6: Hardening and rollout (threshold gates, feature-flag canary, legacy key-handler removal).

6. **Ship confidence score**
- **6.5/10**
- Why: strong diagnosis and sensible direction, but execution is not yet decision-complete on keyboard precedence, playback-store contract, glTF ownership lifecycle, and capture strategy. With those decisions locked and sequence adjusted, this can move to ~8.5/10 confidence.
