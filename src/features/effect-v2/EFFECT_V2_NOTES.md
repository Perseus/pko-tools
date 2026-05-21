# Effect Workbench — Rendering Notes & Unity Migration Guide

## UV Coordinate Conventions

- **PKO/D3D**: U=0 at left, V=0 at top
- **OpenGL/Three.js/glTF**: U=0 at left, V=0 at bottom
- **Unity**: V=0 at top (same as D3D)

### What we learned
- Three.js `CanvasTexture` defaults to `flipY = true`, which handles the V-axis flip automatically when loading raw pixel data
- The U axis is mirrored: we apply `1 - u` in `getMappedUVs()` to match the original rendering
- **For Unity**: UVs from PKO can be used as-is (both are D3D convention). No `1 - u` or `1 - v` needed.

## Texture Decoding

- PKO textures are `.tga` files in `texture/effect/`
- The Rust backend `decode_texture` command handles standard TGA, BMP, PNG, DDS, plus two non-standard PKO TGA variants (ARGB with footer, BGRA with header)
- Decoded output is always RGBA 8-bit per channel
- Effect resource calls pass `D3DFMT_A4R4G4B4`, but `lwTex::LoadVideoMemory` overrides the upload format to `D3DFMT_A8R8G8B8`; preserve decoded 8-bit alpha in the renderer.
- **For Unity**: Use the same decode pipeline or let Unity's TGA/DDS importers handle it. Alpha channel preservation is critical for effects.

## Blend Modes

PKO uses D3D blend factors directly. The mapping:

| D3D Value | D3D Name | Three.js | Unity |
|-----------|----------|----------|-------|
| 1 | ZERO | ZeroFactor | Zero |
| 2 | ONE | OneFactor | One |
| 3 | SRCCOLOR | SrcColorFactor | SrcColor |
| 4 | INVSRCCOLOR | OneMinusSrcColorFactor | OneMinusSrcColor |
| 5 | SRCALPHA | SrcAlphaFactor | SrcAlpha |
| 6 | INVSRCALPHA | OneMinusSrcAlphaFactor | OneMinusSrcAlpha |
| 7 | DESTALPHA | DstAlphaFactor | DstAlpha |
| 8 | INVDESTALPHA | OneMinusDstAlphaFactor | OneMinusDstAlpha |
| 9 | DESTCOLOR | DstColorFactor | DstColor |
| 10 | INVDESTCOLOR | OneMinusDstColorFactor | OneMinusDstColor |

- Most common PKO combo: `srcBlend=5, destBlend=2` (SrcAlpha / One) — additive blending weighted by alpha
- In Three.js: set `material.blending = CustomBlending` then `blendSrc`/`blendDst`
- **For Unity**: Use a custom shader with `Blend [_SrcBlend] [_DstBlend]` and pass the values as material properties

## Coordinate System

- **PKO effect runtime**: Z-up. `D3DXVECTOR3` effect, magic, particle, dummy, and link-beam positions are evaluated as raw X/Y/Z values; Z is vertical.
- **Effect v2 scene**: also Z-up for effect runtime data. Do not Y/Z swap raw `.eff`, `.par`, dummy, magic target, or link-beam vectors.
- **Imported glTF/model assets**: may have their own mesh-space conversion before they enter the effect scene. Keep mesh conversion separate from runtime effect vectors.

### Rules
- Keep raw effect vector data as `(x, y, z)`.
- Do NOT rotate ground-plane range rings or shade decals into X/Z. In z-up runtime space, their default XY plane is already the ground plane.
- Billboard quad geometry stays in its native XY plane; the billboard quaternion copy handles camera-facing.
- For target-facing magic/effects, match `CMagicCtrl::RotatingXZ`: the C++ D3D row-vector matrix is `RotationX(pitch) * RotationZ(yaw)`, which must be applied in Three as `RotationZ(yaw) * RotationX(pitch)` so local `+Y` points at the target.
- `CMagicCtrl` does not continuously re-aim every flight mode. It applies `RotatingXZ` during `Emission`; only `Part_trace` calls `ResetDir` when a moving target changes enough. Do not replace this with per-frame `lookAt`/target-facing for arc, fly, fshade, dist, or drop paths.
- Character glTF loaded through `load_character` is already converted to glTF Y-up by the backend. When it is rendered inside the v2 z-up effect scene, rotate it by `+90deg` around X so the model's local up axis maps to PKO/effect `+Z`.
- **For Unity**: treat runtime vectors as PKO z-up inputs and perform any engine-specific conversion at the Unity scene boundary, separate from glTF mesh import conversion.

## Billboard Behaviour

- Billboard copies the camera quaternion onto the group wrapping the mesh
- Flight path position changes must happen on a **parent** group, not the same group as the billboard — otherwise `lookAt` from flight paths overwrites the billboard rotation
- The hierarchy is: `FlightPathGroup (position) → BillboardGroup (quaternion) → Mesh`
- A zero-axis `rotaLoop` still rebuilds the base transform every frame. It must not retain a stale Three.js quaternion from a previous render.
- **For Unity**: Use `transform.LookAt(Camera.main.transform)` or a billboard shader. Same parent/child separation applies.

## Particle Texture State

- `CMPPartSys` defaults to `eff.fx` technique 3, so particle model and shade textures clamp U/V in the DX8 shader.
- `CMPStrip` and `CMPLink` render with technique 0; in the DX8 shader this also clamps U/V.
- Keep texture-address state separate from blend factors. Reverting particle textures to Three.js repeat wrapping can reintroduce dark boxed edges around soft alpha sprites.

## Flight Paths (MagicList)

Render index maps to flight algorithm. Array matches `EffectObj.cpp`:

| Index | Name | Description |
|-------|------|-------------|
| 0 | drop | Falls from above onto target |
| 1 | fly | Straight line origin → target |
| 2 | trace | Homing/tracking toward target |
| 3 | fshade | Fade/shade effect |
| 4 | arc | Arc trajectory |
| 5 | dirlight | Directional light movement |
| 6 | dist | Fixed distance from origin |
| 7 | dist2 | `Part_dist2` exists in source but is not present in this client's `MagicList[]`; v2 does not dispatch it |

### Trace implementation details
- `velocity` is `nVel` from MagicSingleinfo, cast to float — units per second where 1 unit = 1 tile
- Per-frame distance: `fDist = velocity * deltaTime`, clamped to **1.5 units max** per frame
- Delta time is in **seconds** (matching PKO's `GetTickCount() / 1000`)
- Target-motion compensation: when the target moves between frames, the projectile is nudged proportionally — `correction = (targetMovedSq / totalDistSq) * stepDist` applied along the target's movement direction. This creates smooth curving toward moving targets without sharp turns.
- Done condition: distance to aim point < 1.5 units (must check against the same point used for direction, not the target's feet)
- Aim point is offset +1Z above target position (chest height, not feet)
- `MagicSingleinfo.bin` in `E:/gamedev/mp-client-source/Client/client/scripts/table` contains render indices 0-6 for this client.

### Quirks
- If done-check uses a different point than the movement direction (e.g., checking distance to feet but aiming at chest), the projectile can orbit/get stuck inside the target
- Do not route render index 7 unless targeting a different client source whose `MagicList[]` actually includes `Part_dist2`.
- The 1.5 clamp means at very low framerates, the projectile still can't teleport — it moves max 1.5 units per frame regardless
- **For Unity**: Use `Time.deltaTime` (already in seconds). Same 1.5 clamp. Same target-compensation formula.

## Playback System

- Shared playback atom `effectV2PlaybackAtom`: `{ playing, loop, time, fps }`
- `PlaybackClock` component inside Canvas advances time each frame
- FPS selector: 0 = uncapped (real delta), or fixed 15/30/60 fps stepping
- Fixed FPS uses accumulator pattern — only steps in `1/fps` increments
- On loop/reset: flight state bag is cleared, group position/rotation reset to origin
- **For Unity**: Map to a MonoBehaviour with `Time.deltaTime`. Looping is handled by resetting elapsed time and clearing per-flight-path state.

## MagicSingleinfo.bin Format

- 4-byte header: record size (always 600 = sizeof(EFF_Param))
- Followed by N × 600-byte records (only records with `bExist=1` are written)
- `CRawDataInfo` base class (108 bytes) + `EFF_Param` derived fields (492 bytes)
- Key fields: `nID` (primary key), `szName`, `strModel[8][24]` (effect .eff files), `nVel` (velocity), `strPart[8][24]` (particle .par files), `nDummy[8]`, `nRenderIdx` (flight path), `nLightID`, `strResult` (hit effect)
- Kaitai spec: `formats/pko_magic_single.ksy`
