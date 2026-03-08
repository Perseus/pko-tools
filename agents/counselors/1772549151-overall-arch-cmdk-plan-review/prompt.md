# Plan Review Request

## Goal
Critically review this implementation plan for `pko-tools` frontend architecture + contextual Cmd+K integration. The review should identify missing decisions, sequencing risks, blind spots, over/under-scoping, test/rollout gaps, and any changes needed to make execution decision-complete.

## Proposed Plan (to review)

### Summary
Performance-first foundation before UX layering. Stabilize render/state architecture and correctness issues, then introduce a contextual action system with Cmd+K.

### Goals / Success Criteria
1. Remove known correctness/performance hazards.
2. Separate render-hot state from UI/editor state.
3. Introduce unified action model powering Cmd+K, shortcuts, toolbar actions, and context menus.
4. Preserve existing behavior during migration.
5. Add measurable perf + UX acceptance gates.

### Key Findings Integrated
1. Character navigator event listener leak on repeated selection.
2. Effect playback `currentTime` updates global state each frame, causing broad rerenders.
3. Per-frame geometry allocations in effect renderer hot path.
4. `preserveDrawingBuffer` enabled continuously.
5. Undo history lifecycle not reset on document switches.
6. Async race risk in asset navigators.
7. Repeated JSON→DataURI conversion across viewers.
8. Non-instanced map object markers.
9. Fragmented keyboard ownership preventing coherent action UX.

### Core Architecture Decisions
1. Keep Jotai for UI/editor state; move render-hot clock/sim state to refs/store read in `useFrame`.
2. Shared blob URL + cache loader for glTF resources; explicit revoke/dispose lifecycle.
3. `cmdk` UI + custom action registry as the action kernel.
4. Incremental rollout with compatibility layers and feature gating.

### Interfaces/Types to Add
1. `ActionContext`, `AppAction`, `ActionSurface` types.
2. `ActionRegistry` with filtering by surface + context and shortcut resolution.
3. Central `KeyboardRouter` and `CommandPalette` using same actions.
4. Shared `gltfResource` utility for create/revoke + optional LRU.
5. Effect playback split: control state separate from frame clock path.

### Phase Plan

#### Phase 1 — Core Stabilization
1. Fix character listener lifecycle (unlisten/cleanup).
2. Add request versioning guards for navigator async loads.
3. Reset effect history on document load.
4. Gate `preserveDrawingBuffer` to capture-only mode.
5. Remove hot-path geometry allocations by preallocation.
6. Add Canvas error boundaries.

#### Phase 2 — Render-State & Loader Refactor
1. Split playback control from frame clock.
2. Remove frame-frequency global state writes.
3. Update effect render consumers to avoid panel rerenders during playback.
4. Migrate viewers to shared glTF URL utility.
5. Add marker instancing in map viewer.

#### Phase 3 — Contextual Action System + Cmd+K
1. Implement `ActionRegistry`, `ActionContext`, `KeyboardRouter`.
2. Build Cmd+K palette using `cmdk` with grouped contextual actions.
3. Migrate scattered shortcuts into action handlers.
4. Add context menu + toolbar surfaces using same action IDs.
5. Implement disabled reasons and contextual filtering.

Initial action domains:
- Navigate routes
- Effect edit/playback/gizmo/save/undo-redo
- Item import/export/workbench
- Map/building export/toggles
- Character import/export/debug toggles

#### Phase 4 — Observability & Hardening
1. Instrument heavy Tauri invoke paths.
2. Add dev perf panel (frame + render timing).
3. Add perf acceptance thresholds.
4. Optimize high-volume lists/actions where needed.

### Testing Strategy
1. Unit tests for action resolution/filtering/shortcut mapping/context.
2. Integration tests for Cmd+K parity across shortcut/toolbar/context surfaces.
3. Race tests in navigators to ensure only latest selection commits.
4. Playback/render responsiveness checks under many sub-effects.
5. Manual large-map marker performance validation.

### Acceptance Gates
1. No duplicate callbacks after repeated character selections.
2. No broad rerender spikes tied to frame clock updates.
3. No visual regressions in effect rendering parity samples.
4. Cmd+K actions context-aware and functionally equivalent to existing flows.

### Rollout Strategy
1. Route legacy shortcuts through new action handlers first.
2. Feature-flag Cmd+K in first rollout.
3. Migrate per feature surface incrementally.
4. Remove old per-component key handlers after parity checks.

### Assumptions
1. Stack is `cmdk + custom registry`.
2. Jotai remains primary app state library.
3. No major route redesign in this plan.
4. Tauri command contracts mostly unchanged.

## Instructions for reviewers
Please structure your response as:
1. Critical gaps / missing decisions
2. Sequencing or dependency risks
3. Architecture adjustments (if any) with rationale
4. Testing/rollout hardening suggestions
5. A revised execution order if you disagree with current phasing
6. A concise “ship confidence” score (0-10) and why

Be specific and opinionated. Prefer concrete changes over vague advice.
