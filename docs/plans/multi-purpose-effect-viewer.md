# Multi-Purpose Effect Viewer

## Goal

Extend the effect-v2 viewer to support four content types through a single dropdown selector in the navigator sidebar, keeping the existing canvas, playback controls, and renderer architecture intact.

| Content Type | Icon | Data Source | Canvas Rendering |
|---|---|---|---|
| **MagicGroup** | `Layers` | MagicGroupInfo.bin | Sequential multi-phase: plays N MagicOne entries in order |
| **MagicOne** | `Wand` | MagicSingleinfo.bin | Current behavior: flight path + target + hit effect |
| **Effects** | `Sparkles` | .eff files on disk | EffectRenderer only, centered at origin, no flight/target |
| **Particles** | `Flame` | .par files on disk | ParticleEffectRenderer only, centered at origin |

## Research Findings

### What exists today

- **Navigator**: Single list of MagicSingleInfo entries with search + virtual scroll
- **Store**: `magicSingleTableAtom`, `selectedMagicEffectAtom` (MagicSingleEntry only)
- **Workbench**: Hardcoded to MagicEffectRenderer
- **Backend commands**: `list_effects()`, `list_par_files()`, `loadMagicSingleTable()` all exist
- **Renderers**: `EffectRenderer` and `ParticleEffectRenderer` already work standalone — they just need to be rendered without the `MagicEffectRenderer`/`FlightPathController` wrapper

### What's missing

- **MagicGroupInfo parser**: No .ksy spec, no Rust loader, no TypeScript types. The binary format is known from C++ source:
  - Record size: 216 bytes (108 CRawDataInfo base + 108 Group_Param fields)
  - Each entry contains up to 8 MagicSingleInfo IDs (`nTypeID[8]`) with counts (`nNum[8]`)
  - C++ struct at `MPEffectCtrl.h:165-184`
- **MagicGroupRenderer**: New component to orchestrate sequential playback of grouped magic entries
- **Unified selection atom**: Currently typed to MagicSingleEntry only

### Rendering approach per type

- **Particles** (.par): Wrap `ParticleEffectRenderer` in `GlobalTimeProvider`. No flight, no target model. Loop by default.
- **Effects** (.eff): Load via `loadEffect()`, render with `EffectRenderer`. No flight, no target. Loop by default.
- **Magic** (MagicSingleInfo): Existing `MagicEffectRenderer` — flight path, target character, hit effect.
- **MagicGroup** (MagicGroupInfo): New `MagicGroupRenderer` that plays magic entries sequentially. Each phase uses `MagicEffectRenderer` internally. Phases advance on hit-effect completion (or flight arrival if no hit effect).

---

## Implementation Plan

### Phase 1: Unified selection model + dropdown

**Files changed:**
- `src/store/effect-v2.ts` — new `effectV2SelectionAtom` discriminated union
- `src/types/effect-v2.ts` — add `EffectV2Selection` type
- `src/features/effect-v2/EffectV2Navigator.tsx` — add dropdown selector, swap list data source
- `src/features/effect-v2/EffectV2Workbench.tsx` — switch renderer based on selection type

**New selection type:**
```ts
type EffectV2Selection =
  | { type: 'magic_group'; entry: MagicGroupEntry }
  | { type: 'magic_one';   entry: MagicSingleEntry }
  | { type: 'effect';   fileName: string }
  | { type: 'particle'; fileName: string }
```

**Navigator changes:**
- Add a `<Select>` dropdown above the search input: MagicGroup / MagicOne / Effects / Particles
- Dropdown value stored in local state (not an atom — it's UI-only)
- Changing the dropdown reloads the list:
  - MagicGroup → `loadMagicGroupTable(projectId)` (Phase 3)
  - MagicOne → `loadMagicSingleTable(projectId)` (existing)
  - Effects → `listEffects(projectId)` (existing command)
  - Particles → `listParFiles(projectId)` (existing command)
- Each list item shows an icon (lucide) + name
- Clicking sets `effectV2SelectionAtom` with the appropriate discriminant

**Workbench changes:**
- Read `effectV2SelectionAtom` instead of `selectedMagicEffectAtom`
- Switch on `selection.type` to render the appropriate component
- Info panel adapts per type (show relevant metadata)

### Phase 2: Standalone .eff and .par viewing

**Files changed:**
- `src/features/effect-v2/EffectV2Workbench.tsx` — add `StandaloneEffectView` and `StandaloneParticleView` wrappers

**StandaloneEffectView:**
```tsx
function StandaloneEffectView({ fileName }: { fileName: string }) {
  const effFiles = useLoadEffect([fileName]);
  if (effFiles.length === 0) return null;
  return <EffectRenderer effect={effFiles[0]} />;
}
```

**StandaloneParticleView:**
```tsx
function StandaloneParticleView({ fileName }: { fileName: string }) {
  return <ParticleEffectRenderer particleEffectName={fileName.replace('.par', '')} loop />;
}
```

Both wrapped in `GlobalTimeProvider` inside the Canvas. Playback controls work as-is.

### Phase 3: MagicGroupInfo backend

**Files changed:**
- `formats/pko_magic_group.ksy` — new Kaitai spec
- `src-tauri/src/effect_v2/magic_group_loader.rs` — new adapter
- `src-tauri/src/effect_v2/model.rs` — add `MagicGroupEntry`, `MagicGroupTable`
- `src-tauri/src/effect_v2/commands.rs` — add `load_magic_group_table` command
- `src-tauri/src/lib.rs` — register command
- `src/types/effect-v2.ts` — add `MagicGroupEntry` type
- `src/commands/effect-v2.ts` — add `loadMagicGroupTable()` wrapper

**MagicGroupEntry type:**
```ts
interface MagicGroupEntry {
  id: number;
  data_name: string;
  name: string;
  typeIds: number[];   // up to 8 MagicSingleInfo IDs (-1 = unused)
  counts: number[];    // play count for each type
  totalCount: number;
  renderIdx: number;
}
```

**Binary layout** (from C++ `Group_Param` inheriting `CRawDataInfo`):
- Offset 0-107: CRawDataInfo base (bExist, nIndex, szDataName[72], nID, etc.)
- Offset 108: szName[32]
- Offset 140: nTypeNum (i32)
- Offset 144: nTypeID[8] (8 × i32)
- Offset 176: nNum[8] (8 × i32)
- Offset 208: nTotalNum (i32)
- Offset 212: nRenderIdx (i32)

### Phase 4: MagicGroupRenderer

**Files changed:**
- `src/features/effect-v2/renderers/MagicGroupRenderer.tsx` — new component
- `src/features/effect-v2/renderers/flight/FlightPathController.tsx` — switch from atom to TimeSource

**Behavior:**
1. Receives a `MagicGroupEntry`
2. Looks up each `typeId` in the loaded `MagicSingleTable` to get the `MagicSingleEntry`
3. Expands counts: if typeIds=[150,151] and counts=[2,1], produces sequence [150, 150, 151]
4. Plays each entry sequentially using `MagicEffectRenderer`
5. Each phase completes when its hit effect finishes (or flight arrives with no hit effect)
6. On completion of all phases: loop back to phase 0 (if looping) or stop

**State machine:**
```
IDLE → PLAYING_PHASE_0 → PLAYING_PHASE_1 → ... → COMPLETE → (loop? → PHASE_0)
```

Each phase mounts a fresh `MagicEffectRenderer` with the corresponding `MagicSingleEntry`. Phase transitions happen on the existing `onComplete` callback chain.

**Time integration — TriggeredClock per phase:**

Each phase is wrapped in a `TriggeredClock` so its effects start at t=0 on mount. This is the same pattern `HitEffectRenderer` already uses. The global clock keeps ticking for display but isn't used for per-phase animation:

```
GlobalTimeProvider (global clock, drives display timer)
  └→ MagicGroupRenderer
       └→ TriggeredClock (resets to t=0 per phase via mount/unmount)
            └→ MagicEffectRenderer (phase N)
                 ├→ FlightPathController (reads TimeSource)
                 ├→ EffectRenderer → SubEffects (reads TimeSource ✓)
                 └→ HitEffectRenderer → TriggeredClock (nested, already works ✓)
```

**Prerequisite — FlightPathController must use TimeSource:**

`FlightPathController` currently reads `playback.time` directly from the `effectV2PlaybackAtom` (line 143: `elapsed: playback.time`). This bypasses the `TriggeredClock` scope, so phases 1+ would get the wrong elapsed time. Fix: switch `FlightPathController` to use `useTimeSource().getTime()` for elapsed time instead of reading the atom. This change is backwards-compatible — for single MagicOne viewing, the `GlobalTimeProvider` feeds the same values as the atom.

### Phase 5: Info panel per type

**Files changed:**
- `src/features/effect-v2/EffectV2Workbench.tsx` — refactor `EffectInfoPanel`

Show contextual metadata:

| Type | Info shown |
|---|---|
| MagicGroup | Group name, phase list (ID + name + count for each), total phases, render idx |
| MagicOne | Current panel (ID, name, velocity, render_idx, light, models, result_effect) |
| Effect | Sub-effect count, model types used, texture names, has sound/path |
| Particle | System count, particle types, total duration, strip/model counts |

---

## Testing Strategy

- **Phase 1-2**: Manual — verify dropdown switches list content, selecting .eff/.par renders correctly in canvas
- **Phase 3**: Rust unit test — parse MagicGroupInfo.bin from test_artifacts, verify entry count and field values match known data
- **Phase 4**: Manual — select a MagicGroup entry, verify phases play in sequence, loop works
- **Phase 5**: Manual — verify info panel shows correct metadata per type

## Resolved Questions

1. **MagicGroup phase timing**: Match the C++ source behavior. Abstract the phase sequencing logic behind a `PhaseScheduler` interface (e.g., `getActivePhases(time): number[]`, `onPhaseComplete(idx): void`) so the timing strategy can be swapped later without touching the renderer. Start with a simple sequential implementation; if the C++ logic is more complex (overlapping, weighted random, etc.), it can be filled in later.

2. **Cross-linking**: Yes. In the MagicGroup info panel, each phase entry is clickable — clicking it switches the dropdown to MagicOne and selects that entry. Implementation: set `effectV2SelectionAtom` to `{ type: 'magic_one', entry }` and update the navigator's local dropdown state to match.

3. **Target model**: Standalone .eff/.par views render at origin only (no target model). Make the canvas renderer accept an optional `targetModel` prop so a target character can be added later for effects that wrap around a character.

4. **List counts**: All four tabs show a count below the search box (e.g., "342 effects", "128 particles"). Already done for MagicOne — extend the pattern to all types.
