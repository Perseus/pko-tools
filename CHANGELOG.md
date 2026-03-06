# Changelog

## [0.1.8] - 2026-03-06

### Features

- **Character action browser:** Added `CharacterAction.tx` and `PoseInfo` parsing, split-animation export support, action lookup commands, and a frontend action picker for character preview workflows
- **Shared effect rendering path:** Refactored the standalone effect viewer and item effect viewer onto shared sub-effect frame/material helpers for better parity and less duplicated rendering logic
- **Effect skeleton viewer:** Added a dedicated skeleton inspection mode in the effect viewer with per-sub-effect hierarchy nodes, orientation arrows, geometry labels, and selected-layer proxy wireframes for debugging effect composition

![Effect skeleton viewer hierarchy example](changelog-assets/effect-skeleton-01040014.png)
![Effect skeleton viewer proxy geometry example](changelog-assets/effect-skeleton-jjry03.png)

### Improvements

- **CLI batch export:** Added `export_cli --characters` mode for batch character GLB export
- **Character viewer stability:** Moved the action picker out of the Canvas path, hardened split-animation handling, and fixed action-table lookup to key by character ID instead of model number
- **Item/effect parity:** Wired item effect rendering through the same technique-state and transform/material path used by the standalone effect viewer

---

## [0.1.6] - 2026-03-04

### Improvements

- **Installer cleanup:** CLI-only binaries (`export-cli`, `pko_inspect`) are no longer bundled into the Windows installer — the Start Menu now shows only the main app
- **Dev-only MCP bridge:** `tauri-plugin-mcp-bridge` is now an optional dependency behind the `mcp` feature, excluded from release builds to avoid Windows compile conflicts. Use `pnpm tauri dev --config src-tauri/tauri.dev.conf.json` for dev with MCP support
- **Automated release notes:** GitHub Releases now pull patch notes directly from CHANGELOG.md with image URLs rewritten to render correctly

---

## [0.1.5] - 2026-03-04

### Features

- **Effect rendering engine:** Added a D3D8-accurate effect rendering engine with `.par` binary parser, geometry/state parity fixes matching C++ `I_Effect.cpp` and `eff.fx` shader source, and contextual action menus wired into the effect viewport

![Gem effect](changelog-assets/gem-weapon-effect-1.png)
![Gem effect with sword](changelog-assets/gem-weapon-sword-effect-2.png)

- **Command palette (cmdk):** Centralized action registry and keyboard router with a command palette UI, contextual menus across all workbenches, and usage-ranked suggestions

![CMDK palette](changelog-assets/cmdk-palette.png)

- **Map export pipeline (v3):** Per-section terrain export for large maps, shared asset export system, GLB writer for terrain and buildings, terrain height grid PNG export, and alpha mask atlas splitting into 16 slices

- **Kaitai-only parsing:** Migrated all PKO binary format parsers (LGO, LMO, LAB, OBJ, MAP, EFF) to Kaitai Struct adapters with exhaustive parity tests; deleted all legacy native parsers
- **`pko_inspect` CLI:** New binary that parses any supported PKO format and prints structured JSON for debugging
- **Golden reference snapshot tests:** Snapshot tests covering all Kaitai adapters to catch parser regressions
- **TRS keyframe export:** Animation TRS keyframes and frame rate exported to glTF node extras alongside standard animation channels, with point light data added to the manifest
- **Building debug tools:** Debug tools, cmdk actions, metadata panel, and UX improvements for the buildings workbench

![Building debug tools](changelog-assets/building-debug-tools.png)

- **Scene object parsing:** Full `CSceneObjInfo` semantic field parsing from `sceneobjinfo.bin`, including effect texture copying and `texuv`/`teximg`/`mtlopac` animation data

### Improvements

- **Performance:** Code-split routes, tuned vendor chunking, per-workbench frame probes and dev performance overlay, instrumented Tauri invokes with timing metrics, capped DPR, preferred high-performance WebGL, and instanced mesh rendering for map object markers
- **Effect performance:** Cached cylinder deformation geometry, reused gizmo temporaries, moved playback clock off Jotai frame updates, and disabled persistent draw buffers
- **Blend/material state:** Per-material blend state via structured PKO suffix, `D3DRS_CULLMODE` extraction for double-sided materials, alpha test state parsing from V0000/V0001 render state blocks, and additive blend mode + vertex color export from LMO buildings
- **Terrain export quality:** Clamped boundary vertices to eliminate cliff faces at section edges; removed incorrect 25x height exaggeration from glTF output

### Bug Fixes

- **DXT1 alpha:** Fixed silent alpha channel loss when decoding DXT1/BC1 textures; punch-through alpha now preserved across all DDS-to-PNG conversion paths
- **Scene object height:** Corrected height sampling to match PKO's bilinear terrain interpolation instead of nearest-tile lookup
- **LMO parser:** Fixed V0 parser for legacy headers, blend gating, material detection, and incorrect `transp_type` remapping (subtractive vs. additive)
- **Terrain tile colors:** Default missing-section tile colors to white instead of black; corrected BGR565 vertex color decode and sea floor triangle emission
- **Character animation:** Hardened animation teardown during rapid model switches to prevent stale state
- **Atlas URI in section GLBs:** Removed embedded atlas URI from section GLBs to fix slow Unity import times

---

## [0.1.4] - 2025-02-12

_No changelog entry was written for this release._

---

## [0.1.3] - 2025-02-03

### Features & Improvements

#### Effect Editor

**Full Effect Editing Workspace:**
- New effects workspace with 3D viewport, timeline, and property panels
- Edit sub-effect keyframe properties (position, rotation, scale, color)
- Edit sub-effect blend modes, billboard settings, and texture assignments
- Per-frame texture animation (EFFECT_FRAMETEX) and UV animation (EFFECT_MODELUV, EFFECT_MODELTEXTURE) preview
- Texture loading with TGA/DDS/BMP support and extension fallback
- Save/discard workflow with dirty state tracking and unsaved-changes prompt
- Save As dialog for exporting to new files



https://github.com/user-attachments/assets/c69ac8f9-3317-4aef-8cfc-56ee08d06cea


#### Item Viewer Overhaul

**New Toolbar UI:**
- Replaced floating Leva debug panel with a fixed toolbar at the top of the item viewer
- Model variant selector (Ground/Lance/Carsise/Phyllis/Ami) moved from sidebar to toolbar as segmented tabs
- Debug toggles (Wireframe, Bounding Spheres, Dummies, Glow Overlay) grouped with labeled sections
- Effect controls (Refine Level slider, Glow/Effects/Particles toggles, Character Type selector) integrated into toolbar

**Debug Overlays (Character Viewer Parity):**
- Bounding sphere wireframe indicators at static positions
- Wireframe mesh highlights using EdgesGeometry overlays
- Dummy point helpers with hover/click info tooltips showing position, rotation, and userData
- Glow overlay visualization toggle with semi-transparent green debug material

**Item Import from glTF:**
- New Import button in the item navigator sidebar
- Import glTF files to reconstruct .lgo model and .bmp texture files
- Glow overlay mesh (subset 1) correctly merged back into the .lgo format
- PKO texture encoding/decoding for round-trip compatibility

#### Forge Effect Rendering Fixes

**Lit Glow Rendering (Game-Accurate):**
- Rewrote UV animation shader to match game engine's ItemLitAnim.cpp keyframe data exactly
- Fixed UV rotation center: now rotates around UV origin (0,0) matching D3D9 texture-coordinate transform convention, instead of (0.5, 0.5)
- Fixed animation types 3/4 axis swap: type 3 now correctly scrolls V (not U), type 4 scrolls U (not V)
- Added missing animation type 2 (120-frame UV position scroll)
- Fixed all animation speeds to match 30fps game timing (120f=4s, 360f=12s, 720f=24s) — previous speeds were 3-12x too fast
- Fixed type 7 reverse rotation direction
- Fixed opacity: use lit entry's opacity directly instead of multiplying by refine alpha (the game only applies refine alpha to .eff/.par effects, not the lit glow)
- Fixed blend mode: transp_type 0 (FILTER) now correctly uses NormalBlending (SrcAlpha + InvSrcAlpha), not AdditiveBlending

**Effect Rendering:**
- Fixed D3D9-to-Three.js blend factor mapping — 6 of 10 D3DBLEND enum values were mapped incorrectly
- Fixed effect texture wrapping to RepeatWrapping matching game's D3DTADDRESS_WRAP
- Added texture-ready guard: effects with unloaded textures render as invisible instead of solid white/colored shapes
- Frame texture (EFFECT_FRAMETEX) now resolves initial texture from frameTexNames[0]

**Transform Fixes:**
- Fixed double-rotation bug affecting dummy click targets, info overlays, and effect/particle positions — world matrices now computed relative to scene root to avoid applying the Y-up rotation group twice

#### Item Workspace

**Forge Effect Preview:**
- Category-based forge effect selection with per-item availability checking
- Lit glow, 3D effect (.eff), and particle (.par) preview with forge alpha control
- Refine level slider (0-12) with tier-based lit entry selection
- Character type selector for character-specific effect variants

![Sword of Azure Flame (with glow)](changelog-assets/azure-sword-glow.png)
![Staff of Evanescence (with glow)](changelog-assets/eva-staff-glow.png)



https://github.com/user-attachments/assets/2a33c180-cabe-4281-bd2b-186fbb5bf8ef


---

## [0.1.2] - 2025-01-13

### Features & Improvements

#### Import/Export Fixes

**Critical Bug Fixes:**
- **Fixed mesh index data type mismatch** - Import now correctly handles both U16 and U32 index formats, previously all mesh topology was broken during round-trip conversion
- **Fixed bone hierarchy import** - Parent relationships now use correct bone array positions instead of glTF node indices
- **Fixed inverse bind matrix matching** - IBMs now correctly match to bones via original node index tracking
- **Fixed animation frame count** - Frame calculation now includes endpoint (+1), fixing off-by-one frame loss
- **Fixed quaternion interpolation** - Animation now accounts for quaternion double cover (q and -q equivalence) ensuring shortest rotation path

**Multi-Part Model Support:**
- Fixed multi-part models (like Black Dragon with 2 mesh parts) - all parts now correctly export and import
- Bounding spheres now preserve their mesh association during round-trip conversion
- Model parts display correctly in metadata panel with their LGO file IDs

**Other Import/Export Improvements:**
- LAB version information now preserved during round-trip (was previously hardcoded)
- Dummy node IDs correctly extracted from glTF extras (was using node index instead)
- Vertex element sequence now properly populated during glTF import
- TextureInfo uses correct invalid type marker (0xFFFFFFFF instead of 0x7FFFFFFF)

#### Model Viewer

**New Debug Visualization:**
- **"Show Mesh Outlines" toggle** - Display colored wireframe overlay to distinguish mesh parts
- **Per-mesh visibility controls** - Toggle individual mesh parts on/off (appears when model has multiple parts)
- **Color-coded bounding spheres** - Spheres now colored by their associated mesh (8-color palette)
- **Scaled debug helpers** - Bone and dummy indicators now scale with model size (~1.5% of model dimensions)
- **Improved helper visibility** - Bones and dummies now render on top of mesh (no longer hidden behind geometry)

![Multi-mesh highlight showing colored wireframe overlays](changelog-assets/multi-mesh-highlight.png)

![Bounding spheres display with color-coding by mesh](changelog-assets/bounding-spheres-display.png)

![Bone info tooltip showing detailed bone information](changelog-assets/bone-info-tooltip.png)

**Character Metadata Panel:**
- New panel showing model information at top-left of viewer
- Displays: character name/ID, model ID, animation ID
- Shows skeleton info: bone count, frame count, dummy count
- Shows geometry info: vertex count, triangle count, material count
- Lists model parts with colored indicators
- Shows debug helper counts (bounding spheres, boxes)

#### Removed
- Removed "Ghost Mesh Opacity" slider (no longer needed since helpers render on top)

#### Known Issues
- Toggling debug helpers (bones, dummies, mesh outlines) in certain orders may cause rendering issues - will be fixed in next update

---

### Internal

#### Testing

**New Test Suites:**
- `model_088_roundtrip_test.rs` - Comprehensive LAB+LGO round-trip tests for Attendant model (38 bones, 888 vertices)
- `model_725_black_dragon_test.rs` - Multi-part model tests for Black Dragon (2 mesh parts, 50 bones)
- `hierarchy_tests.rs` - Bone hierarchy validation
- `index_space_tests.rs` - Index space consistency tests
- `skinning_tests.rs` - Skeletal skinning tests
- `byte_equality_test.rs` - Binary comparison tests
- `struct_comparison_test.rs` - Struct field comparison tests

**Test Fixtures Added:**
- Known-good LAB files: 0000.lab, 0001.lab, 0002.lab, 0003.lab, 0088.lab, 0725.lab
- Known-good LGO files: Multiple character model parts (0000-0003 series, 0088, 0725)
- Known-good glTF exports: 1.gltf through 4.gltf, 789.gltf
- Test textures: 0088000000.bmp, 0725000000.bmp

**Test Coverage:**
- LAB round-trip: bones, animation frames, dummies, inverse bind matrices
- LGO round-trip: vertices, indices, materials, textures, bounding spheres
- Mesh header bone fields, vertex element sequences, texture info fields
- Helper data (bounding spheres, boxes, dummies)

#### Tooling

**Claude Code Skills:**
- `tdd` - Test-Driven Development guidance for Rust backend and TypeScript frontend
- `pko-client-reference` - Reference guide for PKO game client source code validation
- `skill-creator` - Tools for creating new Claude Code skills

#### Code Quality
- Added PartialEq/Eq derives to ColorKeyType, TextureType, D3DVertexElement9 enums
- Made D3DVertexElement9 fields public for test access
- Made animation, character, mesh modules public for testing
- Added original_node_index field to LwBoneBaseInfo for IBM matching
- New `MeshHighlights.tsx` component for wireframe overlays
- New `Card` UI component
- Configurable helper size constants (BONE_HELPER_SCALE_PERCENT, etc.)
