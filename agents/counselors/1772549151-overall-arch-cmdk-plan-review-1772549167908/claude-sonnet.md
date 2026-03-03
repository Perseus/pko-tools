Here is my structured review, grounded in the actual source files.

---

## Plan Review: Frontend Architecture + Contextual Cmd+K

---

### 1. Critical Gaps / Missing Decisions

**Gap A: `currentTime` split design is under-specified — the most important decision in the plan.**

`EffectPlaybackDriver.tsx:51-55` calls `setPlayback(prev => ({ ...prev, currentTime: nextTime }))` every frame. This hits every Jotai subscriber. The plan says "move render-hot clock to refs/store read in `useFrame`" but leaves the consumer interface undefined.

The concrete question: `EffectSubRenderer.tsx:132-133` has a `useMemo` that depends on `playback.currentTime`. That memo runs on every Jotai notification — which is every frame. `PathFollower` in `EffectViewport.tsx:29` also reads `effectPlaybackAtom` and will re-render. How do these consumers get time post-refactor without subscribing to a Jotai atom? The design must specify this *before* Phase 2 starts. Likely answer: a `useRef<number>` inside the driver exposed via a custom context + `usePlaybackTime()` hook readable in `useFrame` only. The plan needs to commit to this interface.

**Gap B: The `listen()` leak in `CharacterNavigator.tsx:61-68` is called without storing or invoking the returned unsubscribe function.**

The plan flags this correctly but does not call for a codebase-wide audit of `listen()` calls from `@tauri-apps/api/event`. There may be others.

**Gap C: `preserveDrawingBuffer` gating has a non-trivial implementation constraint.**

R3F creates the WebGL context once at mount time via the `gl` prop (`EffectViewport.tsx:92`). You cannot re-configure `preserveDrawingBuffer` at runtime — it's a context creation flag. The plan says "gate to capture-only mode" without noting that this requires either (a) destroying and recreating the Canvas when entering capture mode, or (b) using a `THREE.WebGLRenderTarget` for capture instead. Option (b) is the right approach and needs to be specified. Missing this will cause scope bleed during implementation.

**Gap D: History reset lifecycle is ambiguous.**

The plan says "reset effect history on document load." But `effectHistoryAtom` and `effectDataAtom` are set in separate code paths. If they're reset in separate `useEffect` calls, there's a window where stale history from the previous document could be undone into the new one. The fix must co-locate the history clear with the `effectDataAtom` write — synchronously in the same handler. The plan does not specify this.

**Gap E: `ActionContext` derivation strategy is unspecified.**

Phase 3 defines types (`ActionContext`, `AppAction`, `ActionSurface`) but never says how context is *determined* at runtime. Is it derived from the current route? Current Jotai atom state? Focused DOM element? This is the design kernel of the entire system. Without it, Phase 3 has no concrete starting point.

**Gap F: Feature-flag mechanism for Cmd+K rollout is undefined.**

There is no existing feature-flag infrastructure in the codebase. The plan says "feature-flag Cmd+K in first rollout" without specifying whether this is an env var, a Jotai atom, a localStorage toggle, or a build constant. Must be decided before Phase 3.

**Gap G: `cmdk` / Tauri + R3F integration compatibility is unverified.**

`cmdk` uses a portal into the DOM and captures keyboard focus. R3F uses its own pointer/keyboard event capture on the Canvas. Whether these coexist cleanly in a Tauri webview (which has different focus/blur semantics than a browser) is not validated. This is an assumption that needs a short spike before Phase 3 is scoped.

---

### 2. Sequencing / Dependency Risks

**Risk A: Phase 2 playback state split must be complete before Phase 3 playback actions are wired.**

If Phase 3 adds Cmd+K controls for play/pause before Phase 2 fixes the per-frame Jotai writes, every keypress that toggles playback will still trigger the broad re-render storm that Phase 2 is meant to fix. The plan sequences P2 before P3 correctly, but doesn't state this dependency explicitly. It must be enforced — no playback actions in Phase 3 before Phase 2 is validated.

**Risk B: Cylinder deform path in `EffectSubRenderer.tsx:402-429` creates two `THREE.CylinderGeometry` objects per frame.**

This is the most egregious hot-path allocation in the codebase, but the plan's Phase 1 item 5 ("Remove hot-path geometry allocations by preallocation") does not call this out by name. `StripEffectRenderer` already partially pre-allocates via `geometryRef`. The cylinder deform path allocates geometry twice per frame per sub-effect during playback. This should be explicitly named as the target of Phase 1 item 5.

**Risk C: The async race guard in navigators (Phase 1 item 2) must be paired with the `listen()` fix.**

In `CharacterNavigator.tsx`, `selectCharacter()` both registers a new `listen()` without cleanup *and* fires two concurrent async calls without a request guard. Fixing the race without fixing the listener means each rapid selection still leaks a callback. These two fixes are one atomic change, not two independent items.

**Risk D: "Migrate viewers to shared glTF URL utility" (Phase 2 item 4) has unclear scope.**

`characterGltfJsonAtom` stores a raw JSON string. `effectBindingAtom.gltfDataUri` stores a data URI. The character viewer and effect character preview use different formats. The "shared utility" must either normalize them or handle both. This scope ambiguity will cause rework if not resolved during Phase 2 design.

---

### 3. Architecture Adjustments

**Adjustment 1: `currentTime` → ref + read-only context hook, not Jotai atom.**

Concretely:
- `effectPlaybackAtom` keeps `{ isPlaying, isLooping, speed }` — UI controls subscribe to these legitimately
- `EffectPlaybackDriver` holds `const timeRef = useRef(0)` and advances it in `useFrame`
- A `PlaybackTimeContext` exposes `getTime: () => number` which only works inside `useFrame` (not in render)
- `EffectSubRenderer` moves `interpolated` computation from `useMemo` → inside `useFrame`, reading `getTime()` and writing to mesh refs directly
- `PathFollower` reads `getTime()` inside its `useFrame`, not the atom

This eliminates all per-frame Jotai writes while keeping control state (play/pause/loop) in atoms where the UI correctly subscribes.

**Adjustment 2: `ActionRegistry` should be a plain module constant, not a class.**

In a functional Jotai codebase, a class-based registry with mutable internal state is foreign. Better model: actions are an `AppAction[]` array exported from an `actions/` module. A `useContextualActions(surface: ActionSurface)` hook reads current Jotai state and filters/enables/disables actions. The `KeyboardRouter` is a single `useEffect` at the app root that maps shortcut strings to action IDs and dispatches. The `CommandPalette` calls the same hook. No class needed.

**Adjustment 3: `isSaving` and similar guard conditions must be encoded in action `disabled` derivation.**

`EffectWorkbench.tsx:170-176` has explicit `!isDirty` and `!isSaving` guards on Cmd+S. When the action system wraps this, the `disabled` field must be a callback that reads these Jotai atoms — not a static boolean. The action interface must support `disabled: () => boolean | { reason: string }`.

**Adjustment 4: Canvas error boundary should be item 1 of Phase 1.**

It's listed last. It should be first — it acts as a safety net for all other Phase 1 changes which modify the hot render path.

---

### 4. Testing / Rollout Hardening

**Testing gap: No automated test for the `listen()` leak fix.**

"No duplicate callbacks after repeated character selections" (acceptance gate 1) is not testable via manual inspection of production behavior. Write a Vitest unit test with a mocked `listen` that asserts the returned unsubscribe is called before the next `listen()` registration.

**Testing gap: Ref-based playback clock breaks existing effect playback tests.**

Once `currentTime` leaves `effectPlaybackAtom`, any test that reads the atom to assert playback position will stop working. These tests need to be rewritten against the ref-based path, which requires a test harness that runs R3F `useFrame` callbacks. This is non-trivial — plan for it explicitly in Phase 2.

**Testing gap: `pixelDiff.test.ts` exists but is not wired as a regression gate.**

The file `src/features/effect/__tests__/pixelDiff.ts` is present but acceptance gate 3 ("No visual regressions in effect rendering parity samples") is stated as a manual check. Wire the existing pixel diff infrastructure as an automated CI check before Phase 2 lands. Otherwise, render-state refactors will break rendering silently.

**Rollout gap: No accessibility testing for Cmd+K palette.**

In a Tauri desktop app, users expect keyboard-first navigation. The command palette must handle focus trap, Escape to dismiss, and correct focus restoration. None of this is in the testing strategy. Add at minimum a `@testing-library` render test for focus management.

**Rollout gap: Old per-component key handlers must not be removed until the action system handles all their cases.**

The plan says "Remove old per-component key handlers after parity checks" (rollout step 4) but defines no explicit parity checklist. Before removing `EffectViewport.tsx:73-88` (T/R/S/Escape/C) and `EffectWorkbench.tsx:163-191` (Cmd+S, Cmd+Z), there must be a per-action parity table confirming each shortcut is handled in the new system with equivalent guard conditions.

---

### 5. Revised Execution Order

The P1→P2→P3→P4 ordering is sound. These adjustments:

**Phase 1 (reordered):**
1. Canvas error boundaries *(safety net first)*
2. Fix character listener lifecycle — `listen()` cleanup + request versioning guard *(one atomic change)*
3. Reset effect history synchronously in the same handler that sets `effectDataAtom`
4. Remove cylinder deform per-frame `CylinderGeometry` allocations *(highest-impact hot-path allocation)*
5. Gate `preserveDrawingBuffer` via `WebGLRenderTarget` capture approach *(clarify implementation first)*

**Phase 2 (split):**
- **2a:** `currentTime` ref split + frame-clock consumers moved to `useFrame` *(validate perf gate before 2b)*
- **2b:** Shared glTF resource utility *(lower urgency, one-time cost)*
- **2c:** Map marker instancing *(different viewer, low risk, can slip to P4 if needed)*

**Phase 3:** Unchanged, but design spike on `ActionContext` derivation and `cmdk` Tauri compatibility *before* any code is written.

**Phase 4:** Unchanged.

---

### 6. Ship Confidence: **6 / 10**

**Why not higher:** The central design question — how does `currentTime` leave Jotai and how do render consumers read it without re-renders — is completely unresolved. Phase 2 will stall or require multiple revisions without this specified. The `preserveDrawingBuffer` implementation path is incorrect as written and will cause scope bleed. The feature-flag mechanism and `cmdk` Tauri compatibility are unverified assumptions going into Phase 3.

**Why not lower:** Problem identification is accurate and grounded in real bugs visible in the code. Phase ordering is correct in principle. The action system model (`cmdk + registry`) is appropriate for the app architecture. The testing instincts (race tests, parity samples) are right even if the specifics are incomplete.

**To reach 8+:** Resolve Gap A (the clock interface design) as a half-day spike before Phase 2 begins. Validate `cmdk` focus/keyboard behavior in a Tauri webview as a half-day spike before Phase 3 begins. These two spikes are the blocking unknowns.
