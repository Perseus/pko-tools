Good. Here's my review.

---

## Plan Review: Frontend Architecture + Contextual Cmd+K

### 1. Critical Gaps / Missing Decisions

**A. The `currentTime` atom write-per-frame problem is real but the proposed fix is under-specified.**

`EffectPlaybackDriver.tsx:51` calls `setPlayback()` inside `useFrame` — this writes to Jotai on every frame. The plan says "split playback control from frame clock" and "remove frame-frequency global state writes" but doesn't say *what replaces it*. The consumers that read `effectPlaybackAtom` are significant:

- `EffectSubRenderer` (interpolation depends on `playback.currentTime` — lines 131-133)
- `PathFollower` (reads `playback.currentTime` in `useFrame`)
- `StripEffectRenderer` (reads playback in `useFrame`)
- `ParticleSimulator` (reads playback in `useFrame`)

The concrete decision needed: **Use a `zustand` store or a raw `useRef` + manual subscription for the frame clock, and expose `currentTime` only to `useFrame` consumers via ref.** Jotai should hold `isPlaying`, `isLooping`, `speed` (control state that changes infrequently). The `currentTime` should be a ref that `useFrame` consumers read directly. Components like `KeyframeTimeline` that need to display the scrub position can subscribe at a throttled rate (e.g., `requestAnimationFrame` batching outside the R3F loop).

This is the single highest-impact architectural decision in the plan and it's left vague.

**B. History reset on document switch is mentioned as a finding but not explicitly scoped.**

Looking at the code: `EffectNavigator.tsx:loadEffectData()` (line 67-79) resets sub-effect/frame selection and dirty flag, but **never calls `resetHistory()`**. The `useEffectHistory` hook exposes `resetHistory` but nobody calls it on load. This is a one-line fix — add `resetHistory()` in `loadEffectData`. The plan should make this explicit rather than leaving it as a vague item.

**C. No decision on R3F error boundaries.**

The plan says "Add Canvas error boundaries" but React error boundaries don't catch errors inside R3F's `useFrame` loop — those crash the whole canvas silently. You need R3F-specific error handling (e.g., wrapping in `<ErrorBoundary>` from `react-error-boundary` at the Canvas level, plus `onCreated` error hooks). Specify the approach.

**D. Missing: glTF resource lifecycle is the second-biggest win and needs concrete API.**

Four separate files have identical `jsonToDataURI` functions (`BuildingsModelViewer.tsx:5`, `MapTerrainViewer.tsx:6`, `CharacterWorkbench.tsx:13`, `ItemModelViewer.tsx:19`). Plus `CharacterBinder.tsx:115` uses `btoa()` for the same purpose. The plan mentions "shared `gltfResource` utility" but doesn't specify:
- Blob URL vs data URI (blob is faster for large glTF — should be the default)
- Revocation strategy (component unmount? LRU evict? explicit dispose?)
- Whether to integrate with R3F's `useLoader` cache or bypass it

Recommend: blob URLs created via `URL.createObjectURL`, revoked on component cleanup, with a simple `Map<string, { url: string, refCount: number }>` for deduplication.

**E. No mention of the gizmo drag allocation in `EffectSubRenderer`.**

`handleGizmoDrag` (lines 444-476) creates `new THREE.Vector3()`, `new THREE.Euler()`, `new THREE.Quaternion()` on every drag event. These should be module-level statics like the existing `_rotaAxis`/`_rotaQuat` pattern already used in the same file (line 52-56). The plan catches "per-frame geometry allocations" but misses this drag-path allocation.

**F. Cylinder geometry allocation in `useFrame` is the real hot-path allocation.**

`EffectSubRenderer.tsx:402-429` creates TWO `new THREE.CylinderGeometry()` objects per frame during deformable mesh interpolation, then disposes them. This is the critical per-frame allocation the plan should call out specifically — it's worse than typical Vector3/Quaternion temporaries because geometry creation involves buffer allocation.

### 2. Sequencing or Dependency Risks

**A. Phase 2 before Phase 1 items 5-6 will cause confusion.**

Phase 1 item 5 ("Remove hot-path geometry allocations by preallocation") and Phase 2 item 2 ("Remove frame-frequency global state writes") are deeply entangled in `EffectSubRenderer`. The state architecture refactor will change how `useFrame` consumers access playback data, which directly affects where preallocation code lives. **Merge these into one work unit** to avoid touching the same 580-line file twice with conflicting patterns.

**B. Phase 3 depends on knowing all action domains, but Phase 1-2 may discover new ones.**

The initial action domains list is fine, but the `ActionRegistry` type design should happen *before* Phase 1 starts, as a lightweight types-only PR. This lets Phase 1/2 work add `// TODO: register as action` annotations that Phase 3 can sweep up, rather than doing a second discovery pass.

**C. The listener leak fix (Phase 1.1) is trivially independent — ship it immediately.**

`CharacterNavigator.tsx:61` calls `listen()` inside `selectCharacter()` without storing or cleaning up the unlisten handle. Every click adds another listener. This is a standalone bugfix that shouldn't wait for anything. Just do it now.

### 3. Architecture Adjustments

**A. Don't use `cmdk` as the action kernel — use it only as a UI shell.**

The plan conflates two things: `cmdk` (a headless command palette UI component) and the action registry (a data model). `cmdk` should render actions, not own them. The registry should be a plain TypeScript module with no React dependency so it can be used from keyboard handlers, context menus, toolbar buttons, and tests without mounting components.

```
ActionRegistry (pure TS) → consumed by:
  ├─ CommandPalette (cmdk UI)
  ├─ KeyboardRouter (global listener)
  ├─ ToolbarButton (onClick)
  └─ ContextMenu (right-click)
```

This is implied by the plan but should be made explicit to prevent the common mistake of coupling the registry to React.

**B. Effect playback: use a Zustand store with `subscribe` for the frame clock, not refs.**

A raw ref loses the ability for `KeyframeTimeline` to show a moving playhead. A Zustand store with `transient: true` pattern (write in `useFrame`, subscribe with selector in UI) gives you zero-rerender writes with opt-in subscriptions. This is a well-established R3F pattern.

**C. `preserveDrawingBuffer` toggle is simpler than the plan implies.**

You can just remount the Canvas when capture starts/stops (toggling a key forces Canvas recreation). Or use `gl.readPixels` for single-frame capture and only enable `preserveDrawingBuffer` for video recording. Don't over-engineer this — the performance cost is real but low priority compared to the atom-per-frame issue.

### 4. Testing / Rollout Hardening

**A. Missing: regression test for the listener leak.**

Add a test that calls `selectCharacter` N times and asserts the listener count doesn't grow. This is easy to do with a mock of `@tauri-apps/api/event`.

**B. Missing: frame budget assertion.**

The plan mentions "perf acceptance thresholds" but doesn't specify them. Propose: effect playback with 5+ sub-effects must hold 30fps on an M1 MacBook Air. Measure with `useFrame` delta averaging. This is testable in dev mode with a simple HUD.

**C. Action registry tests should test shortcut conflicts.**

Two actions with the same shortcut in overlapping contexts is a silent bug. The registry should throw or warn at registration time. Test this.

**D. The deformable cylinder interpolation needs a dedicated perf test.**

Since it creates/destroys geometry per frame, add a test that runs 300 frames of deformable cylinder playback and asserts no geometry leak (count `renderer.info.memory.geometries` before/after).

**E. Effect navigator race condition is already partially guarded.**

`EffectWorkbench.tsx:199` uses a `cancelled` flag for the particle load. But `EffectNavigator.tsx:54-79` has no such guard — rapid clicks can cause `setEffectData` to be called with stale data. Add a request ID / cancellation token pattern here.

### 5. Revised Execution Order

The current Phase 1 → 2 → 3 → 4 order is correct in spirit, but I'd restructure the items:

**Phase 0 — Immediate bugfixes (< 1 day, ship independently)**
1. Fix character listener leak (`CharacterNavigator.tsx:61`)
2. Call `resetHistory()` in `loadEffectData` (`EffectNavigator.tsx`)
3. Add request versioning to `EffectNavigator.selectEffect`

**Phase 1 — Render-state refactor (the big one)**
1. Create Zustand transient store for frame clock (`currentTime`)
2. Migrate `EffectPlaybackDriver` to write Zustand, not Jotai
3. Migrate all `useFrame` consumers to read from Zustand
4. Preallocate cylinder geometry pool for deformable mesh (fix the real hot-path allocation)
5. Hoist gizmo drag temporaries to module scope
6. Add Canvas error boundary

**Phase 2 — Shared resource layer**
1. Extract `gltfResource` utility (blob URL + refcount)
2. Migrate all 5 `jsonToDataURI` call sites
3. Gate `preserveDrawingBuffer`
4. Add map marker instancing (if map viewer is active — otherwise defer)

**Phase 3 — Action system + Cmd+K** (unchanged from plan)

**Phase 4 — Observability** (unchanged from plan)

### 6. Ship Confidence: 6/10

**Why not higher:**
- The most impactful item (frame clock architecture) is under-specified. The plan identifies the problem correctly but doesn't commit to a solution. If this decision goes wrong (e.g., using refs without a subscription mechanism), it'll create new problems.
- The cylinder geometry allocation in `useFrame` is the worst real-world perf issue in the codebase and it's not called out specifically. Generic "preallocation" won't fix it — you need a geometry pool or vertex buffer reuse strategy.
- Phase 3 (Cmd+K) is ambitious relative to the current keyboard handling fragmentation. There are 4 separate `window.addEventListener("keydown", ...)` sites plus sidebar shortcuts. Unifying these without regressions requires careful ordering.

**Why not lower:**
- The findings are accurate. Every issue called out in the plan is real and verified in the code.
- The phasing order (stabilize → refactor → layer UX) is correct.
- The testing strategy covers the right areas.
- The incremental rollout approach (route legacy shortcuts first, feature-flag Cmd+K) is sound and will prevent regressions.

**To get to 8/10:** Commit to the Zustand transient store pattern, specify the cylinder geometry pooling strategy, and add concrete frame-budget numbers to the acceptance gates.
