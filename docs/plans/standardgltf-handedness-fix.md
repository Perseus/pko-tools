# Fix StandardGltf Coordinate Transform: det=+1 → det=-1

## Goal

Change the StandardGltf export profile from a pure rotation `(x,y,z) → (x, z, -y)` (det=+1, preserves handedness) to a reflection `(x,y,z) → (x, z, y)` (det=-1, flips handedness). This fixes character mirroring and inside-out faces in the Tauri Three.js viewer, and makes map tile coordinates positive (matching PKO's positive tileX/tileY).

**UnityGltfast profile is NOT touched.** It already achieves det=-1 via glTFast's X negation.

## What Changes

### Phase 1: Update `coord_transform.rs` — transform functions

All StandardGltf branches change from `-y` to `y` (drop the negation):

| Function | Current | New |
|----------|---------|-----|
| `position()` | `[x, z, -y]` | `[x, z, y]` |
| `normal()` | delegates to position | no change needed |
| `quaternion()` | `[x, z, -y, w]` | `[-x, -z, -y, w]` |
| `extras_position()` | `[x, z, -y]` | `[x, z, y]` |
| `extras_quaternion()` | `[x, z, -y, w]` | `[-x, -z, -y, w]` |
| `extras_euler_angles()` | `[ax, az, -ay]` | `[-ax, -az, -ay]` |
| `euler_angles()` | `[ax, az, -ay]` | `[-ax, -az, -ay]` |
| `scale()` | `[x, z, y]` | `[x, z, y]` (no change) |
| `matrix4()` / `matrix4_col_major()` | B with `-1` in (1,2) | B with `+1` in (1,2) |
| `reverse_indices()` | swaps 1↔2 | **no longer called** for StandardGltf |

**Quaternion derivation:** For a Y↔Z swap reflection, the quaternion conversion is: swap qy↔qz components, then conjugate (negate vector part) to account for handedness flip → `[-qx, -qz, -qy, qw]`.

**Euler angles derivation:** Under a reflection, rotation directions reverse. All angle components negate, plus Y↔Z swap → `[-ax, -az, -ay]`.

**Matrix basis change:** B becomes `[1,0,0; 0,0,1; 0,1,0]` (Y↔Z swap, no negation). B is symmetric and self-inverse (B = B^T = B^-1). The formula `B * M * B^-1 = B * M * B` still applies.

### Phase 2: Remove `reverse_indices` calls for StandardGltf

The det=-1 transform automatically flips CW→CCW winding. Manual reversal is no longer needed.

Files with `reverse_indices` calls to remove:

| File | Lines | Context |
|------|-------|---------|
| `map/terrain.rs` | 375, 1079, 1827 | Terrain mesh indices |
| `map/scene_model.rs` | 868, 929 | Building mesh indices |
| `character/mesh.rs` | 500-503 | Already removed (revert comment to explain det=-1) |

**Important:** `reverse_indices` must remain available for UnityGltfast users. The function stays in `coord_transform.rs`, but StandardGltf callers stop invoking it. Since the callers use `ct.reverse_indices()`, and these sites already know their profile, the simplest approach is to **guard the call**: only reverse when profile is UnityGltfast, or remove the call entirely from StandardGltf sites.

Cleanest approach: make `reverse_indices` a no-op for StandardGltf (det=-1 profiles don't need it), and keep it functional for UnityGltfast. This avoids touching every call site — just add a profile check inside the method.

### Phase 3: Update tests in `coord_transform.rs`

Tests that assert StandardGltf outputs need updated expected values:

| Test | Current assertion | New assertion |
|------|-------------------|---------------|
| `standard_position_swizzle` | `[1, 3, -2]` | `[1, 3, 2]` |
| `standard_quaternion_swizzle` | `[0.1, 0.3, -0.2, 0.9]` | `[-0.1, -0.3, -0.2, 0.9]` |
| `quaternion_position_consistency` | Uses StandardGltf | Re-derive expected (still must pass — this is the key correctness test) |
| `matrix4_translation_remapped` | `tz = -20` | `tz = 20` |
| `matrix4_rotation_around_z_becomes_rotation_around_y` | Current expected matrix | Re-derive for new B |
| `standard_euler_angles` | `[0.1, 0.3, -0.2]` | `[-0.1, -0.3, -0.2]` |

### Phase 4: Update effect export tests

`src/effect/export.rs` has test assertions referencing the old `(x, z, -y)` mapping:

| Line | Current | New |
|------|---------|-----|
| 239 | comment: `(x, z, -y)` | `(x, z, y)` |
| 240 | `[1.0, 3.0, -2.0]` | `[1.0, 3.0, 2.0]` |
| 241 | `[100.0, 300.0, -200.0]` | `[100.0, 300.0, 200.0]` |
| 243 | `[10.0, 30.0, -20.0]` | `[-10.0, -30.0, -20.0]` |
| 244 | `[1.0, 3.0, -2.0, 4.0]` | `[-1.0, -3.0, -2.0, 4.0]` |

### Phase 5: Update character mesh winding comment

Revert the incorrect "CCW winding" comment in `character/mesh.rs:500-503` to explain the real reason: det=-1 StandardGltf transform flips winding automatically, so `reverse_indices` is not needed.

## What Does NOT Change

- **UnityGltfast profile** — all branches untouched
- **`scale()` function** — already `[x, z, y]` for both profiles
- **`reverse_indices()` function body** — still available, just not called for StandardGltf
- **Any file that only uses UnityGltfast** (terrain GLB export, Unity map export)
- **Building/terrain positions** — same axis mapping, just z becomes positive instead of negative

## Testing Strategy

1. `cargo test` — all coord_transform and effect export tests must pass with updated assertions
2. `cargo clippy` — clean
3. **Visual test (Tauri viewer):** Load a character → should stand upright, correct left/right, faces not inside-out
4. **Visual test (Tauri viewer):** Load the map viewer if StandardGltf is used there → buildings should render correctly
5. **Regression check:** Export a character glTF with y_up=true, open in Blender → should not be mirrored

## Open Questions

1. **Map/terrain viewer:** Do the Tauri map viewer pages use StandardGltf? If so, terrain and buildings need visual verification after the change. The `shared.rs` and `commands.rs` files create StandardGltf instances for the preview viewer.
2. **Golden reference tests:** Are there snapshot tests in `tests/golden_reference_tests.rs` that compare GLB output byte-for-byte? If so, those snapshots need regeneration.
3. **Bone scale conversion:** Character bone scale at `character.rs:525` passes raw scale without `ct.scale()`. This is a pre-existing bug (unrelated to this change) but should be noted.
