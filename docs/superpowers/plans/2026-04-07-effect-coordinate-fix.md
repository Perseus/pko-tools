# Effect Pipeline Coordinate System Fix

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move PKO LH Z-up to glTF/Three.js RH Y-up coordinate conversion from ad-hoc frontend code into the backend Tauri commands, so both effect viewers receive correctly-oriented data.

**Architecture:** The backend already has `remap_eff_for_export` and `remap_par_for_export` (in `src-tauri/src/effect/export.rs`) which apply `CoordTransform` to all position/angle/direction vectors. Currently these are only called from the CLI JSON export path. We wire them into the `load_effect` and `load_par_file` Tauri commands, then strip the frontend's incomplete ad-hoc coordinate handling (`pkoVec`, broken `d3dYawPitchRollQuaternion`).

**Tech Stack:** Rust (Tauri backend), TypeScript/React (Three.js frontend), Vitest (TS tests), `cargo test` (Rust tests)

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `src-tauri/src/effect/export.rs` | Add `frame_sizes` remapping to both remap functions |
| Modify | `src-tauri/src/effect/commands.rs` | Wire remap into `load_effect` and `load_par_file` commands |
| Modify | `src/features/effect-v2/helpers.ts` | Delete `pkoVec` function |
| Modify | `src/features/effect-v2/__tests__/helpers.test.ts` | Remove `pkoVec` tests |
| Modify | `src/features/effect-v2/renderers/models/RectPlane.tsx` | Remove `pkoVec`, fix Euler order |
| Modify | `src/features/effect-v2/renderers/models/Cylinder.tsx` | Remove `pkoVec`, implement angle interpolation |
| Modify | `src/features/effect-v2/renderers/models/Rect.tsx` | Remove broken import, fix geometry + Euler |
| Modify | `src/features/effect-v2/renderers/models/RectZ.tsx` | Remove broken import, fix geometry + Euler |

**NOT modified (and why):**
- `src/features/effect/applySubEffectFrame.ts` — already uses `"YXZ"` Euler order with raw values; backend-transformed data slots in correctly
- `src-tauri/src/map/terrain.rs` and `shared.rs` — map pipeline has its own coordinate handling; out of scope
- `src-tauri/src/effect/commands.rs` save commands — save path out of scope per user request

---

### Task 1: Add `frame_sizes` remapping to backend export functions

The existing `remap_eff_for_export` and `remap_par_for_export` transform positions and angles but skip `frame_sizes`. Size/scale vectors need the same Y<>Z axis swap (no negation) to match the position transform.

**Files:**
- Modify: `src-tauri/src/effect/export.rs:18-67`
- Test: `src-tauri/src/effect/export.rs:180-301` (inline `#[cfg(test)]` module)

- [ ] **Step 1: Add size remapping to `remap_eff_for_export`**

In `src-tauri/src/effect/export.rs`, add `frame_sizes` remapping inside the `for sub in &mut eff.sub_effects` loop, after the `frame_positions` block (after line 26):

```rust
// Size/scale keyframes (axis swap, no negation — same as position)
for size in &mut sub.frame_sizes {
    *size = ct.extras_position(*size);
}
```

- [ ] **Step 2: Add size remapping to `remap_par_for_export`**

In the same file, add `frame_sizes` remapping inside the `for sys in &mut par.systems` loop, after `sys.offset` (after line 45):

```rust
// Size/scale keyframes (axis swap, no negation)
for size in &mut sys.frame_sizes {
    *size = ct.extras_position(*size);
}
```

- [ ] **Step 3: Update `remap_eff_modifies_positions_and_angles` test**

Add a `frame_sizes` entry to the test fixture (around line 204) and an assertion (after line 241):

In the fixture's `SubEffect`, change:
```rust
frame_sizes: vec![[1.0, 2.0, 3.0]],
```

Add assertion after the `frame_positions` assertion:
```rust
// extras_position(x,y,z) -> (x, z, y) for sizes too
assert_eq!(eff.sub_effects[0].frame_sizes[0], [1.0, 3.0, 2.0]);
```

- [ ] **Step 4: Update `remap_par_modifies_vectors` test**

Add `frame_sizes` to the par fixture (around line 261):
```rust
frame_sizes: vec![[4.0, 5.0, 6.0]],
```

Add assertion (after line 300):
```rust
assert_eq!(sys.frame_sizes, vec![[4.0, 6.0, 5.0]]);
```

- [ ] **Step 5: Run Rust tests**

Run: `cd E:/gamedev/pko-tools/src-tauri && cargo test remap_eff_modifies remap_par_modifies -- --nocapture`
Expected: Both tests PASS with the new size assertions.

- [ ] **Step 6: Commit**

```bash
cd E:/gamedev/pko-tools
git add src-tauri/src/effect/export.rs
git commit -m "fix(effect): add frame_sizes remapping to coordinate transform export"
```

---

### Task 2: Wire remap into Tauri `load_effect` and `load_par_file` commands

The Tauri commands currently return raw PKO-space data. Apply the existing remap functions so the frontend receives Y-up data.

**Files:**
- Modify: `src-tauri/src/effect/commands.rs:22-36` (`load_effect`)
- Modify: `src-tauri/src/effect/commands.rs:67-84` (`load_par_file`)

- [ ] **Step 1: Add imports to commands.rs**

At the top of `src-tauri/src/effect/commands.rs`, add the import for the remap functions and `CoordTransform`:

```rust
use super::export::{remap_eff_for_export, remap_par_for_export};
use crate::math::coord_transform::CoordTransform;
```

- [ ] **Step 2: Apply remap in `load_effect`**

Change `load_effect` (line 35) from:
```rust
EffFile::from_bytes(&bytes).map_err(|e| e.to_string())
```
to:
```rust
let mut eff = EffFile::from_bytes(&bytes).map_err(|e| e.to_string())?;
let ct = CoordTransform::new();
remap_eff_for_export(&mut eff, &ct);
Ok(eff)
```

- [ ] **Step 3: Apply remap in `load_par_file`**

Change `load_par_file` (line 83) from:
```rust
ParFile::from_bytes(&bytes).map_err(|e| e.to_string())
```
to:
```rust
let mut par = ParFile::from_bytes(&bytes).map_err(|e| e.to_string())?;
let ct = CoordTransform::new();
remap_par_for_export(&mut par, &ct);
Ok(par)
```

- [ ] **Step 4: Add TODO comments on save commands**

Add a comment above `save_effect` (line 38) and `save_particles` (wherever it is):

```rust
// TODO: Inverse remap (Y-up -> PKO Z-up) needed here once editing is supported.
// The frontend now holds Y-up data; writing it directly produces incorrect PKO files.
```

- [ ] **Step 5: Run Rust compilation check**

Run: `cd E:/gamedev/pko-tools/src-tauri && cargo check`
Expected: Compiles with no errors.

- [ ] **Step 6: Run full Rust test suite**

Run: `cd E:/gamedev/pko-tools/src-tauri && cargo test`
Expected: All tests pass. Note: `export_eff_json` now double-remaps (it calls `remap_eff_for_export` on freshly-parsed data, not on command output), so its behavior is unchanged.

- [ ] **Step 7: Commit**

```bash
cd E:/gamedev/pko-tools
git add src-tauri/src/effect/commands.rs
git commit -m "fix(effect): apply coordinate remap in load_effect and load_par_file Tauri commands"
```

---

### Task 3: Remove `pkoVec` from effect-v2 helpers

The backend now delivers Y-up data, so the frontend Y<>Z swap helper is no longer needed.

**Files:**
- Modify: `src/features/effect-v2/helpers.ts:71-77`
- Modify: `src/features/effect-v2/__tests__/helpers.test.ts:3,142-158`

- [ ] **Step 1: Delete `pkoVec` function from helpers.ts**

Remove lines 71-77 from `src/features/effect-v2/helpers.ts` (the JSDoc comment and function):

```typescript
// DELETE this entire block:
/**
 * Convert a PKO world-space vector (Z-up, right-handed) to Three.js space (Y-up, right-handed).
 * Rule: (x, y, z) → (x, z, y)  — swap Y↔Z, leave X unchanged.
 */
export function pkoVec([x, y, z]: Vec3): Vec3 {
  return [x, z, y];
}
```

- [ ] **Step 2: Remove `pkoVec` from test file import and test suite**

In `src/features/effect-v2/__tests__/helpers.test.ts`:

Remove `pkoVec` from the import on line 3:
```typescript
// Before:
import { getTextureName, getThreeJSBlendFromD3D, getMappedUVs, findFrame, lerp, pkoVec, randf, randfRange } from "../helpers";
// After:
import { getTextureName, getThreeJSBlendFromD3D, getMappedUVs, findFrame, lerp, randf, randfRange } from "../helpers";
```

Delete the entire `describe("pkoVec", ...)` block (lines 142-158).

- [ ] **Step 3: Run TS tests to verify helpers still pass**

Run: `cd E:/gamedev/pko-tools && npx vitest run src/features/effect-v2/__tests__/helpers.test.ts`
Expected: All remaining tests pass. `pkoVec` tests are gone.

- [ ] **Step 4: Commit**

```bash
cd E:/gamedev/pko-tools
git add src/features/effect-v2/helpers.ts src/features/effect-v2/__tests__/helpers.test.ts
git commit -m "fix(effect-v2): remove pkoVec helper, backend now delivers Y-up data"
```

---

### Task 4: Fix RectPlane renderer — remove pkoVec, fix Euler order

`RectPlane.tsx` uses `pkoVec` on positions, sizes, and angles. With backend-transformed data, all `pkoVec` calls are removed. Angle application also needs the correct `"YXZ"` Euler order (matching the old viewer's proven approach).

**Files:**
- Modify: `src/features/effect-v2/renderers/models/RectPlane.tsx`

- [ ] **Step 1: Remove `pkoVec` from import**

Line 8, change:
```typescript
import { getMappedUVs, getThreeJSBlendFromD3D, findFrame, lerp, pkoVec } from "../../helpers";
```
to:
```typescript
import { getMappedUVs, getThreeJSBlendFromD3D, findFrame, lerp } from "../../helpers";
```

- [ ] **Step 2: Remove `pkoVec` from position interpolation**

Lines 91-92, change:
```typescript
const p0 = pkoVec(framePositions[frameIdx]);
const p1 = pkoVec(framePositions[nextIdx] ?? p0);
```
to:
```typescript
const p0 = framePositions[frameIdx];
const p1 = framePositions[nextIdx] ?? p0;
```

- [ ] **Step 3: Remove `pkoVec` from scale interpolation**

Lines 102-103, change:
```typescript
const s0 = pkoVec(frameSizes[frameIdx]);
const s1 = pkoVec(frameSizes[nextIdx] ?? s0);
```
to:
```typescript
const s0 = frameSizes[frameIdx];
const s1 = frameSizes[nextIdx] ?? s0;
```

- [ ] **Step 4: Fix angle interpolation — remove `pkoVec`, use `"YXZ"` Euler order**

Lines 123-131, change:
```typescript
if (frameAngles.length > frameIdx) {
  const a0 = pkoVec(frameAngles[frameIdx]);
  const a1 = pkoVec(frameAngles[nextIdx] ?? a0);
  meshRef.current.rotation.set(
    lerp(a0[0], a1[0], frac),
    lerp(a0[1], a1[1], frac),
    lerp(a0[2], a1[2], frac),
  );
}
```
to:
```typescript
if (frameAngles.length > frameIdx) {
  const a0 = frameAngles[frameIdx];
  const a1 = frameAngles[nextIdx] ?? a0;
  meshRef.current.rotation.set(
    lerp(a0[0], a1[0], frac),
    lerp(a0[1], a1[1], frac),
    lerp(a0[2], a1[2], frac),
    "YXZ",
  );
}
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd E:/gamedev/pko-tools && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
cd E:/gamedev/pko-tools
git add src/features/effect-v2/renderers/models/RectPlane.tsx
git commit -m "fix(effect-v2): RectPlane uses backend Y-up data directly, correct Euler order"
```

---

### Task 5: Fix Cylinder renderer — remove pkoVec, implement angle interpolation

`Cylinder.tsx` uses `pkoVec` on positions and sizes, and has a `// TODO: interp angles` placeholder.

**Files:**
- Modify: `src/features/effect-v2/renderers/models/Cylinder.tsx`

- [ ] **Step 1: Remove `pkoVec` from import**

Line 4, change:
```typescript
import { getThreeJSBlendFromD3D, findFrame, lerp, pkoVec } from '../../helpers';
```
to:
```typescript
import { getThreeJSBlendFromD3D, findFrame, lerp } from '../../helpers';
```

- [ ] **Step 2: Remove `pkoVec` from position interpolation**

Lines 122-123, change:
```typescript
const p0 = pkoVec(framePositions[frameIdx]);
const p1 = pkoVec(framePositions[nextFrameIdx] ?? p0);
```
to:
```typescript
const p0 = framePositions[frameIdx];
const p1 = framePositions[nextFrameIdx] ?? p0;
```

- [ ] **Step 3: Remove `pkoVec` from scale interpolation**

Lines 132-133, change:
```typescript
const s0 = pkoVec(frameSizes[frameIdx]);
const s1 = pkoVec(frameSizes[nextFrameIdx] ?? s0);
```
to:
```typescript
const s0 = frameSizes[frameIdx];
const s1 = frameSizes[nextFrameIdx] ?? s0;
```

- [ ] **Step 4: Implement angle interpolation**

Replace the TODO block (lines 153-155):
```typescript
// Interpolate angles
if (frameAngles.length > frameIdx) {
  // TODO: interp angles
}
```
with:
```typescript
// Interpolate angles
if (frameAngles.length > frameIdx) {
  const a0 = frameAngles[frameIdx];
  const a1 = frameAngles[nextFrameIdx] ?? a0;
  meshRef.current.rotation.set(
    lerp(a0[0], a1[0], frac),
    lerp(a0[1], a1[1], frac),
    lerp(a0[2], a1[2], frac),
    "YXZ",
  );
}
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd E:/gamedev/pko-tools && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
cd E:/gamedev/pko-tools
git add src/features/effect-v2/renderers/models/Cylinder.tsx
git commit -m "fix(effect-v2): Cylinder uses backend Y-up data, implement angle interpolation"
```

---

### Task 6: Fix Rect renderer — remove broken import, fix geometry and Euler

`Rect.tsx` imports the non-existent `d3dYawPitchRollQuaternion` and has geometry vertices in PKO Z-up space.

**Files:**
- Modify: `src/features/effect-v2/renderers/models/Rect.tsx`

- [ ] **Step 1: Fix import — replace `d3dYawPitchRollQuaternion` with `lerp`**

`Rect.tsx` does not import `lerp` but needs it for angle interpolation. Line 8, change:
```typescript
import { getMappedUVs, getThreeJSBlendFromD3D, findFrame, lerp, d3dYawPitchRollQuaternion } from "../../helpers";
```
to:
```typescript
import { getMappedUVs, getThreeJSBlendFromD3D, findFrame, lerp } from "../../helpers";
```

- [ ] **Step 2: Fix geometry vertices — convert from PKO Z-up to Three.js Y-up**

The C++ `CreateRect()` makes a quad extending along +Z (upward in PKO). In Three.js Y-up, "upward" is +Y.

Lines 49-55, change:
```typescript
// C++ CreateRect: XZ plane, extends along +Z (PKO Z-up native)
const positions = new Float32Array([
  -0.5, 0, 0,
  -0.5, 0, 1,
   0.5, 0, 1,
   0.5, 0, 0,
]);
```
to:
```typescript
// C++ CreateRect: vertical quad extending upward.
// PKO (Z-up): XZ plane along +Z. Three.js (Y-up): XY plane along +Y.
const positions = new Float32Array([
  -0.5, 0, 0,
  -0.5, 1, 0,
   0.5, 1, 0,
   0.5, 0, 0,
]);
```

- [ ] **Step 3: Update component JSDoc comment**

Lines 17-26, replace the entire comment block:
```typescript
/**
 * "Rect" mesh -- a vertical quad that extends upward from the origin.
 *
 * C++ CreateRect() vertices (PKO Z-up):
 *   (-0.5, 0, 0), (-0.5, 0, 1), (0.5, 0, 1), (0.5, 0, 0)
 *
 * Remapped to Three.js (Y-up):
 *   (-0.5, 0, 0), (-0.5, 1, 0), (0.5, 1, 0), (0.5, 0, 0)
 *
 * Vertical quad in the XY plane, bottom edge at Y=0, top at Y=1,
 * centered on X.
 */
```

- [ ] **Step 4: Fix angle application — replace d3dYawPitchRollQuaternion with Euler**

Lines 131-140, change:
```typescript
if (frameAngles.length > frameIdx) {
  const a0 = frameAngles[frameIdx];
  const a1 = frameAngles[nextIdx] ?? a0;
  d3dYawPitchRollQuaternion(
    lerp(a0[0], a1[0], frac),
    lerp(a0[1], a1[1], frac),
    lerp(a0[2], a1[2], frac),
    meshRef.current.quaternion
  );
}
```
to:
```typescript
if (frameAngles.length > frameIdx) {
  const a0 = frameAngles[frameIdx];
  const a1 = frameAngles[nextIdx] ?? a0;
  meshRef.current.rotation.set(
    lerp(a0[0], a1[0], frac),
    lerp(a0[1], a1[1], frac),
    lerp(a0[2], a1[2], frac),
    "YXZ",
  );
}
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd E:/gamedev/pko-tools && npx tsc --noEmit`
Expected: No type errors (the broken `d3dYawPitchRollQuaternion` import is gone).

- [ ] **Step 6: Commit**

```bash
cd E:/gamedev/pko-tools
git add src/features/effect-v2/renderers/models/Rect.tsx
git commit -m "fix(effect-v2): Rect geometry converted to Y-up, fix broken rotation import"
```

---

### Task 7: Fix RectZ renderer — remove broken import, fix geometry and Euler

Same pattern as Rect. `RectZ.tsx` has PKO Z-up geometry and the broken `d3dYawPitchRollQuaternion` import.

**Files:**
- Modify: `src/features/effect-v2/renderers/models/RectZ.tsx`

- [ ] **Step 1: Fix import**

Line 8, change:
```typescript
import { getMappedUVs, getThreeJSBlendFromD3D, findFrame, lerp, d3dYawPitchRollQuaternion } from "../../helpers";
```
to:
```typescript
import { getMappedUVs, getThreeJSBlendFromD3D, findFrame, lerp } from "../../helpers";
```

- [ ] **Step 2: Fix geometry vertices — convert from PKO Z-up to Three.js Y-up**

The C++ `CreateRectZ()` makes a quad in the YZ plane. After Y<>Z swap: it becomes a quad in the ZY plane — effectively the same YZ plane but with swapped vertex coordinates.

Lines 48-54, change:
```typescript
// C++ CreateRectZ: YZ plane (PKO Z-up native)
const positions = new Float32Array([
  0, 0, 0,
  0, 0, 1,
  0, 1, 1,
  0, 1, 0,
]);
```
to:
```typescript
// C++ CreateRectZ: YZ plane in PKO. Remapped to Three.js Y-up:
// PKO (0,0,0),(0,0,1),(0,1,1),(0,1,0) -> Three.js (0,0,0),(0,1,0),(0,1,1),(0,0,1)
const positions = new Float32Array([
  0, 0, 0,
  0, 1, 0,
  0, 1, 1,
  0, 0, 1,
]);
```

- [ ] **Step 3: Update component JSDoc comment**

Lines 17-25, replace:
```typescript
/**
 * "RectZ" mesh -- a vertical quad in the YZ plane.
 *
 * C++ CreateRectZ() vertices (PKO Z-up):
 *   (0, 0, 0), (0, 0, 1), (0, 1, 1), (0, 1, 0)
 *
 * Remapped to Three.js (Y-up):
 *   (0, 0, 0), (0, 1, 0), (0, 1, 1), (0, 0, 1)
 *
 * Vertical quad in the YZ plane at X=0.
 */
```

- [ ] **Step 4: Fix angle application — replace d3dYawPitchRollQuaternion with Euler**

Lines 129-139, change:
```typescript
if (frameAngles.length > frameIdx) {
  const a0 = frameAngles[frameIdx];
  const a1 = frameAngles[nextIdx] ?? a0;
  d3dYawPitchRollQuaternion(
    lerp(a0[0], a1[0], frac),
    lerp(a0[1], a1[1], frac),
    lerp(a0[2], a1[2], frac),
    meshRef.current.quaternion
  );
}
```
to:
```typescript
if (frameAngles.length > frameIdx) {
  const a0 = frameAngles[frameIdx];
  const a1 = frameAngles[nextIdx] ?? a0;
  meshRef.current.rotation.set(
    lerp(a0[0], a1[0], frac),
    lerp(a0[1], a1[1], frac),
    lerp(a0[2], a1[2], frac),
    "YXZ",
  );
}
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd E:/gamedev/pko-tools && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 6: Commit**

```bash
cd E:/gamedev/pko-tools
git add src/features/effect-v2/renderers/models/RectZ.tsx
git commit -m "fix(effect-v2): RectZ geometry converted to Y-up, fix broken rotation import"
```

---

### Task 8: Full test suite + clippy verification

Final pass to confirm nothing is broken across the entire codebase.

**Files:** None (verification only)

- [ ] **Step 1: Run cargo clippy**

Run: `cd E:/gamedev/pko-tools/src-tauri && cargo clippy -- -D warnings`
Expected: No warnings or errors.

- [ ] **Step 2: Run full Rust test suite**

Run: `cd E:/gamedev/pko-tools/src-tauri && cargo test`
Expected: All tests pass.

- [ ] **Step 3: Run TypeScript compilation**

Run: `cd E:/gamedev/pko-tools && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 4: Run full Vitest suite**

Run: `cd E:/gamedev/pko-tools && npx vitest run`
Expected: All tests pass.

- [ ] **Step 5: Verify no remaining references to deleted code**

Search for orphaned references:
```bash
cd E:/gamedev/pko-tools
grep -r "pkoVec" src/features/effect-v2/ --include="*.ts" --include="*.tsx"
grep -r "d3dYawPitchRollQuaternion" src/ --include="*.ts" --include="*.tsx"
```
Expected: No matches (all references removed).

---

## Post-Implementation Notes

**What was NOT changed (intentional):**

1. **Old effect viewer** (`src/features/effect/applySubEffectFrame.ts`): Already uses `"YXZ"` Euler order and applies data directly. With backend now delivering Y-up transformed data, positions, angles, and rotaLoopVec all slot in correctly without code changes.

2. **Map pipeline** (`src-tauri/src/map/terrain.rs`, `shared.rs`): These `load_effect_file` functions serve the map export pipeline which has its own coordinate handling. Not part of the Tauri command path.

3. **Save commands**: `save_effect` and `save_particles` now receive Y-up data from the frontend but write it to PKO files that expect Z-up. A TODO comment marks this for future work when editing is needed.

4. **Billboard `rotation={[Math.PI / 2, 0, 0]}`**: Present in all 4 model renderers. This tilts a horizontal quad to face the camera and is independent of the coordinate system fix. Verify visually during testing but no code change expected.
