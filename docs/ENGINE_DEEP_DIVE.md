# TOP/PKO Engine - Deep Dive Technical Analysis

## Engine Identity

The TOP/PKO engine is a **custom C++ engine built on Direct3D 9** (with remnants of DX8 compatibility paths). It was developed in-house by the original Chinese studio and is structured as three layers:

| Layer | Location | Role |
|-------|----------|------|
| **Engine SDK** | `engine/sdk/` | Core 3D rendering, file I/O, math, animation |
| **Client** | `Client/src/` | Game logic, UI, networking, scenes |
| **Common** | `Common/` | Shared libs (audio, Lua, DBC networking, pak files) |

---

## 1. Rendering Pipeline

### Graphics API & Shader Model

- **Direct3D 9** fixed-function pipeline as primary path
- **Vertex shaders** supported via `CMPEffectFile` (D3DX Effect framework / .fx files)
- Shader technique selection per-material via `idxTech` index
- Four render control modes per mesh object:
  - `RENDERCTRL_VS_FIXEDFUNCTION (1)` — standard FFP
  - `RENDERCTRL_VS_VERTEXBLEND (2)` — hardware vertex blending (skeletal)
  - `RENDERCTRL_VS_VERTEXBLEND_DX9 (3)` — DX9 indexed vertex blending
  - `RENDERCTRL_VS_USER (0x100-0x200)` — custom user vertex shaders

### Vertex Declarations

Each mesh carries `RenderCtrlCreateInfo` with:
- `ctrl_id` — pipeline type
- `decl_id` — vertex declaration ID (format layout)
- `vs_id` — vertex shader ID
- `ps_id` — pixel shader ID (set to INVALID in most content, **unused but wired**)

### Material System

- Up to **4 texture stages** per material (`LW_MAX_TEXTURESTAGE_NUM = 4`)
- 8 render state slots per material (`LW_MTL_RS_NUM = 8`)
- Per-material state flags: visible, enabled, transparency update, transparent, frame culling
- Alpha testing via `D3DRS_ALPHAFUNC` / `D3DRS_ALPHAREF`
- Alpha blending with full D3DBLEND enum support (src/dest blend per sub-effect)

### Per-Object State Control

`StateCtrl` provides 8 flags per geometric object:
| Flag | Bit | Purpose |
|------|-----|---------|
| STATE_VISIBLE | 0 | Render on/off |
| STATE_ENABLE | 1 | Update/interaction on/off |
| STATE_UPDATETRANSPSTATE | 3 | Dynamic transparency recalc |
| STATE_TRANSPARENT | 4 | Is transparent (sort order) |
| STATE_FRAMECULLING | 5 | Frustum culling enable |
| STATE_INVALID | 6 | Uninitialized marker |

### Terrain Rendering

- Tile-based with up to **512x512 sections** (array `_ActiveSectionArray[512][512]`)
- Per-tile: 4 texture layers with blending, height, vertex color, collision blocks, region ID
- Vertex format: `D3DFVF_XYZ | D3DFVF_DIFFUSE | D3DFVF_TEX2` (position + color + 2 UV sets)
- Two-stage multi-texturing for terrain blending
- Optional batch rendering mode
- Mipmap control per-pass

### Water System

- Fixed sea level (`SEA_LEVEL = 0.0f`)
- 30-frame animated bump-map cycle (`ocean_h.01.bmp` → `ocean_h.30.bmp`)
- Separate vertex buffer from terrain for optimization
- Alpha-blended with per-tile color variation
- Default color: `0xCF8C8CDC` (semi-transparent blue)
- Toggleable via `SetSeaVisible()`

### Sky & Atmosphere

- **SkyDoom** hemispherical dome centered on camera
- Vertex shader support for animated cloud textures
- Configurable texture path and movement speed
- **Pixel fog**: Linear (`D3DFOG_LINEAR`) and Exponential (`D3DFOG_EXP2`)
- Range-based fog with configurable start/end/density/color
- Fog parameters exposed in game config

### Lighting

- Global ambient via `D3DRS_AMBIENT`
- Up to **3 simultaneous point lights** (indexed 0-2)
- Per-light: position, range, diffuse/ambient color, 3 attenuation factors
- **Animated lights** via `AnimCtrlLight` with pose-based interpolation
- Per-material ambient (default 0.8 for terrain)
- Light enable/disable per render pass

---

## 2. Effect System (VFX)

The engine has two distinct effect systems: **`.eff` files** (keyframed geometry effects) and **`.par` files** (particle systems via `CMPParticleSys`).

### Particle System (`CMPParticleSys`, `.par` files)

18 distinct particle types:

| ID | Type | Description |
|----|------|-------------|
| 1 | SNOW | Snow/rain |
| 2 | FIRE | Fire |
| 3 | BLAST | Explosion |
| 4 | RIPPLE | Water ripples |
| 5 | MODEL | Mesh-based particles |
| 6 | STRIP | Ribbon/trail |
| 7 | WIND | Wind force |
| 8 | ARROW | Projectile |
| 9 | ROUND | Spherical |
| 10-11 | BLAST2/3 | Secondary/tertiary explosions |
| 12 | SHRINK | Shrinking |
| 13 | SHADE | Shadow projection |
| 14-15 | RANGE/2 | Area range indicators |
| 16 | DUMMY | Placeholder |
| 17-18 | LINE_SINGLE/ROUND | Linear movement |

Per-particle controller: type, count (1-100), lifespan, velocity/acceleration, emission rate, spawn bounds, delay, texture, blend modes, billboard flag, path following, hit effects, per-frame keyframes.

### Keyframed Effect Architecture (`MPModelEff.h`, `.eff` files)

Each `.eff` file contains:
- **Global properties**: technique index, path following, sound, global rotation
- **N sub-effects**, each with:
  - Effect type (plane, cylinder, model-based, billboard)
  - Keyframed animation: size, angle, position, color (all linear interpolation)
  - Per-frame UV animation (coord lists) — vertex shader or software path
  - Texture animation (frame tex names for flipbook)
  - Blend modes (full D3DBLEND for src/dest)
  - Billboard mode, alpha mode, rotation-board mode
  - Cylinder geometry (segments, height, top/bot radius) — animatable per-frame

### Effect Vertex Format

```cpp
struct {
    D3DXVECTOR3 m_SPos;      // Position
    float       m_fIdx;      // VS constant index for UV animation
    DWORD       m_dwDiffuse; // Per-vertex ARGB color
    D3DXVECTOR2 m_SUV;       // Texture coords
};
// FVF: D3DFVF_XYZB1 | D3DFVF_DIFFUSE | D3DFVF_TEX1
```

The `m_fIdx` field is unique — it indexes into vertex shader constant registers (`c9+i`) for UV animation without re-locking the vertex buffer.

### Trail/Ribbon System

- Tracks two dummy points per weapon (tip + base) each frame
- Builds triangle strip connecting successive position pairs
- Configurable max trail length and fade rate
- Time-based vertex pair addition (`_fStep`)

### Scene Effects (`sceneffectinfo.txt/bin`)

- 200+ registered effects with metadata:
  - Filename, display name, photo thumbnail
  - Effect type, object type
  - Dummy attachment list, height offset
  - Play time, light ID, base size
- Binary format via `CRawDataSet` for fast loading

---

## 3. Animation & Character System

### Hard Limits

| Resource | Max | Constant |
|----------|-----|----------|
| Bones per skeleton | 25 | `LW_MAX_BONE_NUM` |
| Bone dummies per skeleton | 64 | `LW_MAX_BONEDUMMY_NUM` |
| Blend weights per vertex | 4 | `LW_MAX_BLENDWEIGHT_NUM` |
| Sub-skins/parts per character | 10 | `LW_MAX_SUBSKIN_NUM` |
| Link items per character | 16 | `LW_MAX_LINK_ITEM_NUM` |
| Object dummies per primitive | 16 | `LW_MAX_OBJ_DUMMY_NUM` |
| Object dummies with inverse mat | 4 | `LW_MAX_OBJ_DUMMY_INV_NUM` |
| Helper meshes | 8 | `LW_MAX_HELPER_MESH_NUM` |
| Bounding spheres | 8 | `LW_MAX_BOUNDING_SPHERE_NUM` |

### Skeleton/Bone System

- **Bone data** (`lwAnimDataBone`): bone_num, frame_num, dummy_num, key_type
- Per-bone: name (32 chars), ID, parent_id
- Key storage modes (compile-time selected):
  - `USE_ANIM_MAT43` — 4x3 matrix per bone per frame (current default)
  - `USE_ANIM_QUAT` — quaternion + position (commented out)
  - `USE_ANIM_MAT44` — full 4x4 matrix (commented out)
  - `USE_ANIMKEY_PRS` — Position/Rotation/Scale keyframes (commented out but structures exist)
- Inverse bind matrices stored per-bone (`_invmat_seq`)
- Runtime bone transform matrices (`_rtmat_ptr`)
- Runtime frame buffer caching: pre-computes bone matrices at full frames, SLERPs between cached frames
- Version 1.0.0.3+: per-frame position data for quaternion mode
- Version 1.0.0.5: material opacity animation (`lwAnimDataMtlOpacity`)

### Animation Controllers

The engine has 6 distinct animation controller types:

| Controller | Class | Purpose |
|-----------|-------|---------|
| Bone | `lwAnimCtrlBone` | Skeletal animation (primary) |
| Matrix | `lwAnimCtrlMatrix` | Simple matrix transform animation |
| Tex UV | `lwAnimCtrlTexUV` | Texture coordinate animation (scroll/rotate) |
| Tex Image | `lwAnimCtrlTexImg` | Texture swapping (flipbook) |
| Mtl Opacity | `lwAnimCtrlMtlOpacity` | Material fade in/out |
| Light | `lwAnimCtrlLight` | Animated light properties |

### Pose Playback Modes

| Mode | Behavior |
|------|----------|
| `PLAY_ONCE` | Play once, stop |
| `PLAY_LOOP` | Loop indefinitely |
| `PLAY_FRAME` | Jump to specific frame |
| `PLAY_ONCE_SMOOTH` | Play once with blend-in |
| `PLAY_LOOP_SMOOTH` | Loop with blend-in |
| `PLAY_PAUSE` | Pause current animation |
| `PLAY_CONTINUE` | Resume paused animation |

### Animation Blending

- Smooth pose blending with configurable duration (`op_frame_length`)
- Weighted blending (`weight` 0-1) with speed factor
- Dual-pose interpolation: blend current and target simultaneously
- Uses matrix SLERP for rotation blending between bones

### Interpolation Easing Curves

Beyond linear, the engine supports **10 easing curves** via `AKST` (Animation Key Set Slerp Type):

| Type | Curve |
|------|-------|
| `AKST_LINEAR` | Linear |
| `AKST_SIN1-4` | Sine (4 variants: 0-90, 90-180, 180-270, 270-360) |
| `AKST_COS1-4` | Cosine (4 variants) |
| `AKST_TAN1` | Tangent (0-45) |
| `AKST_CTAN1` | Cotangent |

### Keyframe Event Callbacks

- Up to **8 keyframe triggers per pose** for game events
- Callback receives: animation type, pose ID, key ID, frame number, custom parameter
- Used for: footstep sounds, attack hit detection, particle spawn, etc.

### PRS Keyframe System (Hidden Capability)

`lwAnimKeySetPRS` structure exists with:
- `pos_seq` — `lwKeyDataVector3*` (position keyframes)
- `rot_seq` — `lwKeyDataQuaternion*` (rotation keyframes)
- `scl_seq` — `lwKeyDataVector3*` (scale keyframes — **not used in production**)
- `_interpolate_type` — interpolation mode selector
- Sparse keyframe support (key + data pairs, not every-frame)

**This is significant**: The engine has a complete PRS keyframe animation system that could dramatically reduce animation file sizes vs the current every-frame matrix approach, but it's compiled out.

### Dummy/Link Point System

- Up to **16 link items** per character (`LW_MAX_LINK_ITEM_NUM = 16`)
- Dummy points 0-3: require inverse matrices (for precise bone attachment)
- Dummy points 4-7: effect/utility attachment (no inverse matrix needed)
- Dummy points 8-15: additional attachment slots
- Per-dummy: ID, parent_bone_id, transform matrix
- Runtime matrix retrieval: `GetObjDummyRunTimeMatrix(mat, obj_id, dummy_id)`

### Character Part System

- Characters assembled from multiple mesh parts (up to `LW_MAX_SUBSKIN_NUM` slots)
- Equipment changes swap individual parts without reloading entire character
- `AttachItem()` links items to dummy points with full transform inheritance
- Pixel shader assignable per-character (`MPChaLoadInfo.pixel_shader_file`)

### Animation Controller

- `lwAnimCtrlBone` — bone animation with pose system
- `lwAnimCtrlMatrix` — simple matrix animation (for items/props)
- Pose system: `UpdatePose()`, `UpdateAnimData()`, `UpdatePoseKeyFrameProc()`
- Frame boundary clamping for animation segments
- Runtime frame buffer enable/disable per bone
- Animation data extraction (`ExtractAnimData`) and debug dump support

### What's NOT There

- **No physics/ragdoll** — search for physics, ragdoll, constraint, joint, rigid body yields nothing
- **No morph targets/blend shapes** — mesh deformation is skeletal only
- **No IK (Inverse Kinematics)** — all animation is baked
- **No LOD system** for characters — single mesh detail level

---

## 4. Map & World System

### Tile-Based Streaming Architecture

- Map divided into **sections** (chunks of 8x8 or 16x16 tiles)
- Dynamic section loading based on camera frustum:
  1. Calculate visible section range from camera center + show width/height
  2. Load missing sections on-demand
  3. Unload far sections when buffer limit exceeded (configurable, default 16)
  4. LRU eviction based on `dwActiveTime`
- Full-load mode available for editor (`FullLoading()`)
- Performance tracking: per-frame terrain/sea render times, loading time history

### Tile Data

Per tile stores:
- 4 texture layers with blending
- Height (float, centimeter precision)
- Vertex color (DWORD ARGB)
- Region attribute (16-bit — 16 gameplay zones)
- Island flag
- 4 sub-block collision flags (2x finer than tile grid)

### Collision & Pathfinding

- **ZRBlock** — separate collision grid at 2x terrain resolution
- Per-block: region attributes + 4 sub-block flags
- **A\* pathfinding** (`CFindPath`): short/long path, configurable range
- Line-of-sight checks (`IsCross`)
- Character-specific walkability

### Scene Objects

- Per-section object lists (`.obj` files)
- Per-object: type ID, position, height offset, yaw angle, scale
- **Really Big Objects (RBO)**: separate `.rbo` files for large static props with quaternion orientation

### Minimap

- Render-to-surface approach (`LPD3DRENDERTOSURFACE`)
- Orthographic camera, configurable window size (default 256x256)
- Multiple variants: small minimap, big map, larger map

---

## 5. Networking

- **Custom TCP protocol** via DBC (Distributed Base Component) library
- `WPacket` (write) / `RPacket` (read) for serialization
- **Encryption support**: `OnEncrypt`/`OnDecrypt` virtual methods, configurable algorithm
- Connection states: CONNECTING, FAILURE, CONNECTED, TIMEOUT
- Ping tracking for latency-aware client prediction
- **200+ packet commands** covering movement, skills, chat, items, trade, etc.
- **RPC system**: `CommRPC` / `RPCMGR` for synchronous request-reply with timeout

---

## 6. Scripting (Lua 5.1)

### Embedded Lua APIs

| Module | Functions |
|--------|-----------|
| `lua_app` | Scene management, caption, sound |
| `lua_input` | `IsKeyDown`, keyboard queries |
| `lua_scene` | Object creation/manipulation, items, characters, effects |
| `lua_object` | Property get/set on game objects |
| `lua_camera` | Camera positioning and control |
| `lua_ui` | UI widget creation and management |
| `lua_network` | Network operations |
| `lua_platform` | Platform-level functions |
| `lua_util` | Utility helpers |

Scripts loaded via `CScriptMgr::LoadScript()` / `DoFile()` / `DoString()`.

---

## 7. Audio

- **Dual audio backend**: DirectSound (`DSoundManager`) + BASS library (DLL-loaded)
- **Separate audio thread** (`CAudioThread`) for non-blocking music playback
- **AudioSDL wrapper** — singleton over BASS with fade-in/fade-out, pause/resume
- Resource management with timeout-based cleanup (default 300s)
- Formats: MP3, OGG, WAV, tracker formats (MOD/XM via BASS)

---

## 8. Resource Management

- **PAK archive system** (`CPackFile`, `CMiniPack`) — binary packages with directory metadata
- Filter-based selective packing (e.g., `*.bmp`)
- **Multi-threaded resource loading** (`m_bMThreadRes` config flag)
- Texture loading via `lwLoadTex()` with caching
- INI file parser for configuration

---

## 9. Threading

- **Thread pool** via DBC: IOCP-based (Windows I/O Completion Ports) or queue-based fallback
- Task interface: `Task::Process()` with `Lastly()` cleanup
- **Synchronization**: Mutex (with spin counts), RWMutex, InterLockedLong (atomics), CriticalSection
- Pre-allocated memory pools for thread-safe allocation

---

## 10. Hidden/Unused Capabilities & Upgrade Opportunities

### Already Coded But Inactive

| Feature | Evidence | Status |
|---------|----------|--------|
| **PRS keyframe animation** | `lwAnimKeySetPRS` with pos/rot/scale sparse keys | Compiled out (`#define USE_ANIMKEY_PRS` commented) |
| **Quaternion bone storage** | `USE_ANIM_QUAT` define, quat + pos storage | Compiled out, mat43 used instead |
| **Pixel shader per-object** | `ps_id` in `RenderCtrlCreateInfo` | Set to INVALID_INDEX, never assigned |
| **Custom vertex shaders** | `RENDERCTRL_VS_USER (0x100)` range | Range allocated but no content ships with it |
| **Material opacity animation** | `lwAnimDataMtlOpacity` (version 1.0.0.5) | Format exists, unclear if used in content |
| **Sky vertex/pixel shaders** | `m_SkyDoomVertexShaderHandle`, `m_SkyDoomPixelShaderHandle` | Handles exist, may be legacy |
| **Scale keyframes in animation** | `scl_seq` in `lwAnimKeySetPRS` | Wired but not populated |
| **Editor mode for maps** | Full read/write tile editing, section save | Built in, toggleable |

### Practical Upgrade Paths

1. **Shader Model 2.0/3.0 Upgrade**: The `CMPEffectFile` infrastructure already supports HLSL technique selection. You can add new `.fx` files with modern techniques and route objects to them via `idxTech` without changing the loading pipeline.

2. **Per-Pixel Lighting**: The `ps_id` field is wired through the entire pipeline but never used. Enabling it would allow per-object pixel shaders for normal mapping, specular highlights, etc.

3. **Sparse Keyframe Animation**: Enable `USE_ANIMKEY_PRS` to dramatically reduce animation file sizes. The interpolation code exists — it just needs testing and content pipeline support.

4. **Shadow Mapping**: The render-to-texture infrastructure exists (minimap uses it). A shadow map pass could reuse this pattern with a depth-only shader.

5. **Post-Processing**: Add a screen-space quad pass after the main render. The engine already manages render targets for minimaps — extend this for bloom, color grading, SSAO.

6. **Terrain LOD**: The section streaming system is already distance-aware. Adding mesh simplification for far sections is straightforward.

7. **Instanced Rendering**: Scene objects are currently drawn individually. DX9 hardware instancing could batch identical objects (trees, rocks) dramatically.

8. **Normal Mapping**: Materials already support 4 texture stages. Stage 2-3 could carry normal/specular maps with a matching pixel shader.

9. **Water Shader**: Replace the 30-frame bump-map cycle with a real-time water shader using the existing sea vertex buffer.

10. **Physics Integration**: No physics exists. Adding a library (Bullet, PhysX) for ragdoll, cloth, or breakable objects would be entirely new.
