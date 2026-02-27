# Analysis: Can manifest.json Data Be Encoded Into glTF?

## Summary

The `manifest.json` currently contains **~30 distinct data fields** spanning 7 categories. About half could be moved into glTF using standard extensions, but the other half (large binary grids, effect definitions, runtime metadata) genuinely cannot or should not live in glTF. The right architecture is a **hybrid**: use glTF extensions for what fits naturally, and keep a slimmer manifest for the rest.

---

## Current Manifest Field Inventory

### Category A: Map Metadata
| Field | Type | Size |
|-------|------|------|
| `version` | int | tiny |
| `map_name` | string | tiny |
| `coordinate_system` | string | tiny |
| `world_scale` | float | tiny |
| `unit_scale_contract` | string | tiny |
| `map_width_tiles` | int | tiny |
| `map_height_tiles` | int | tiny |
| `section_width` | int | tiny |
| `section_height` | int | tiny |

### Category B: Scene Lighting & Environment
| Field | Type | Size |
|-------|------|------|
| `light_direction` | vec3 | tiny |
| `light_color` | vec3 | tiny |
| `ambient` | vec3 | tiny |
| `background_color` | vec3 | tiny |
| `spawn_point` | {tile_x, tile_y} | tiny |

### Category C: Building Placements
| Field | Type | Size |
|-------|------|------|
| `buildings` | dict {obj_id → gltf path} | small |
| `placements` | array of {obj_id, position, rotation_y, scale} | medium (hundreds of entries) |

### Category D: Binary Grids (sidecar .bin files)
| Field | Type | Size |
|-------|------|------|
| `collision_grid` | u8[] at 2x resolution | large (e.g., 512x512 = 256KB) |
| `obj_height_grid` | i16[] at 2x resolution | large (~512KB) |
| `region_grid` | i16[] at 1x resolution | medium (~64KB) |
| `area_grid` | u8[] at 1x resolution | small (~32KB) |
| `tile_texture_grid` | u8[] at 1x resolution | small (~32KB) |
| `tile_color_grid` | i16[] at 1x resolution | medium (~64KB) |
| `tile_layer_grid` | 7 bytes/tile at 1x resolution | medium (~224KB) |

### Category E: Effects
| Field | Type | Size |
|-------|------|------|
| `effect_placements` | array of {eff_id, position, rotation_y, scale} | medium |
| `effect_definitions` or `effect_definitions_file` | full EffFile structs as JSON | large (can exceed 5MB) |
| `missing_effect_ids` | array of ints | tiny |

### Category F: Areas (Zone Data)
| Field | Type | Size |
|-------|------|------|
| `areas` | dict {area_id → {color, music, env_color, light_color, light_dir, zone_type}} | small |

### Category G: Terrain Textures & Water
| Field | Type | Size |
|-------|------|------|
| `terrain_textures` | dict {tex_id → path} | small |
| `alpha_atlas` | path string | tiny |
| `water_textures` | array of paths | small |
| `terrain_gltf` | path string | tiny |

---

## What glTF Can and Cannot Do

### glTF Extension Points

glTF has several mechanisms for custom/extra data:

1. **`extras`** — Arbitrary JSON on any glTF object (scene, node, mesh, etc.). Universal support.
2. **`extensions`** — Namespaced JSON blocks. Can define custom extensions (e.g., `PKO_map_metadata`).
3. **Scenes** — A glTF file can have multiple scenes. One scene = terrain, another = buildings, etc.
4. **Nodes** — Hierarchical. Building placements can be node transforms referencing shared meshes.
5. **Buffers / BufferViews / Accessors** — Binary data embedded in `.glb` or referenced as external `.bin` files.
6. **Images** — Textures can be embedded or external.
7. **`KHR_lights_punctual`** — Standard extension for directional/point/spot lights.

### What Maps Well to glTF

| Manifest Data | glTF Mechanism | How |
|--------------|----------------|-----|
| **Building placements** | **Nodes** | Each placement becomes a node with transform (position/rotation/scale) referencing a mesh. This is *the* natural glTF pattern — it's literally what scene graphs are for. |
| **Scene lighting** | **KHR_lights_punctual** | `light_direction` + `light_color` → directional light node. `ambient` → scene-level extras. Standard extension, supported by Unity's glTF importers. |
| **Building models** | **Meshes** (already glTF) | Already exported as separate `.gltf` files. Could be merged into one big `.glb` as shared meshes. |
| **Terrain mesh** | **Mesh** (already glTF) | Already a glTF file. |
| **Map metadata** | **Scene `extras`** | `version`, `map_name`, `coordinate_system`, `world_scale`, dimensions — all fit in scene-level extras JSON. |
| **Spawn point** | **Empty node** | A named node `"SpawnPoint"` with a transform. Natural glTF pattern. |
| **Water textures** | **Images** | Could be embedded as texture resources in the glTF. |

### What Does NOT Map Well to glTF

| Manifest Data | Why Not glTF | Better Alternative |
|--------------|-------------|-------------------|
| **Binary grids** (collision, height, region, area, texture, color, layer) | These are 2D grid textures, not 3D geometry. glTF has no concept of "gameplay data grids." You *could* encode them as buffer views, but no importer would understand them — you'd still need custom parsing code. **The binary sidecar approach is already correct.** | Keep as `.bin` sidecars, OR encode as single-channel images (PNG/EXR) which Unity can natively read as Texture2D |
| **Effect definitions** | Full particle system specs (keyframes, blend modes, billboard settings, cone/cylinder params). This is a proprietary particle format with no glTF equivalent. `KHR_particle` doesn't exist. | Keep as JSON sidecar — this is genuinely custom game data |
| **Effect placements** | Positions could be nodes, but the `eff_id` linking to effect definitions is game-specific | Could use empty nodes with extras, but gains little |
| **Areas (zone data)** | Per-zone music IDs, PK flags, zone colors — pure game logic, not renderable | Keep in manifest or a separate zones config |
| **Tile layer grid** | 7 bytes/tile of texture blending IDs — a terrain splatmap lookup table | Encode as a multi-channel image |

---

## Recommended Architecture

### Option 1: Single-GLB-per-map (Maximum Integration)

```
{map_name}/
  map.glb                    ← Everything renderable in one file
  grids/                     ← Game logic data (non-renderable)
    collision.png            ← R8 image (Unity can read natively)
    obj_height.exr           ← R16 float image
    region.png               ← R16 or R8 image
    area.png                 ← R8 image
    tile_texture.png         ← R8 image
    tile_color.png           ← RGB image (decoded from RGB565)
    tile_layer.png           ← Multi-channel image (RGBA + separate)
  effects.json               ← Particle system definitions (no glTF equivalent)
```

The `map.glb` would contain:
- **Scene extras**: map metadata (name, dimensions, scale contract, version)
- **Terrain mesh**: existing terrain geometry + materials
- **Building instances**: each placement as a Node with transform, referencing shared Mesh resources
- **Directional light**: via `KHR_lights_punctual`
- **Spawn point**: named empty Node
- **Water textures**: as Image resources
- **Area data**: as scene-level extras JSON
- **Effect placements**: as named empty Nodes with `eff_id` in extras

**Pros:**
- One file to load for all renderable content
- Building instancing is native (shared meshes, many nodes)
- Unity glTF importers (GLTFast, UniGLTF) handle nodes/transforms/lights natively
- No manifest needed for scene setup

**Cons:**
- Large file (all buildings + terrain + textures in one `.glb`)
- Longer parse time, higher memory peak
- Building mesh deduplication is tricky (current approach: one `.gltf` per building type, multiple placements reference it)
- Still need sidecars for grids + effects

### Option 2: Manifest-Lite + Separate glTFs (Pragmatic Hybrid) — RECOMMENDED

```
{map_name}/
  manifest.json              ← Slimmed: only grid metadata + effect data + areas
  terrain.glb                ← Terrain mesh (unchanged, but use .glb for efficiency)
  buildings/
    {stem}.glb               ← One per unique building type
  grids/
    collision.png            ← Binary grids as images (Unity-native)
    obj_height.exr
    ...
  effects.json               ← Particle definitions
  water/
    ocean_h_{01-30}.png
  terrain_textures/
    ...
```

**What moves INTO glTF files:**

1. **terrain.glb scene extras** → map metadata (name, dimensions, scale, coordinate_system)
2. **terrain.glb KHR_lights_punctual** → directional light (direction + color)
3. **terrain.glb scene extras** → ambient, background_color
4. **terrain.glb named node** → spawn point as empty node with transform
5. **terrain.glb scene extras** → areas dict (zone data keyed to area grid)

**What moves INTO building placement nodes:**

Currently placements are a JSON array. Instead, each building `.glb` stays as-is, but the **terrain.glb** gets empty nodes for each placement:
```
Scene
  ├── TerrainMesh
  ├── SpawnPoint (node, position from spawn_point)
  ├── DirectionalLight (KHR_lights_punctual)
  ├── Buildings (parent node)
  │   ├── building_42_inst_0 (node, extras: {obj_id: 42, source_gltf: "buildings/tree01.glb"})
  │   ├── building_42_inst_1 (node, extras: {obj_id: 42, source_gltf: "buildings/tree01.glb"})
  │   └── building_99_inst_0 (node, extras: {obj_id: 99, source_gltf: "buildings/house03.glb"})
  └── Effects (parent node)
      ├── effect_5_inst_0 (node, extras: {eff_id: 5})
      └── effect_12_inst_0 (node, extras: {eff_id: 12})
```

**What stays in manifest.json (much slimmer):**
- `version`, `unit_scale_contract` (schema versioning)
- Grid file references + metadata (dimensions, encoding, tile_size)
- `effect_definitions` / `effect_definitions_file`
- `terrain_textures` dict (tex_id → path mapping for splatmap reconstruction)
- `alpha_atlas` path
- `water_textures` paths
- `buildings` dict (obj_id → glb path mapping, so the importer knows which file to instantiate)

**Pros:**
- Placements become actual scene-graph nodes — Unity importers handle transforms natively
- Lighting uses a standard extension — no custom parsing needed
- Map metadata is self-describing (open the glTF in any viewer, see the scene)
- Grids as images means Unity can `AssetDatabase.LoadAssetAtPath<Texture2D>()` directly
- Manifest shrinks from ~30 fields to ~10 fields (just file references + grid metadata)
- Individual building files stay separate for memory/streaming efficiency

**Cons:**
- Still need a manifest (but much simpler)
- terrain.glb grows slightly (empty placement nodes add ~100 bytes each, so ~50KB for 500 placements)
- Two places to look for data (glTF + manifest) instead of one

### Option 3: Pure glTF (No Manifest At All)

Theoretically possible by encoding grids as buffer views with custom accessors and effects as extension blocks. But:
- No Unity importer would understand any of it
- You'd write just as much custom parsing code as you do now
- You'd lose the ability to read grids as Unity Texture2D assets
- The glTF file becomes a container format pretending to be standard

**Not recommended.**

---

## Grid Encoding: Binary → Image Format

The biggest manifest simplification comes from encoding grids as images instead of custom binary:

| Grid | Current | Image Format | Unity Access |
|------|---------|-------------|--------------|
| collision | u8 per cell | R8 PNG (0=walkable, 255=blocked) | `Texture2D`, threshold at 128 |
| obj_height | i16 LE millimeters | R16 EXR or R16 PNG | `Texture2D.GetPixel()` → float |
| region | i16 LE | R16 PNG | `Texture2D` |
| area | u8 | R8 PNG | `Texture2D` → index into areas dict |
| tile_texture | u8 | R8 PNG | `Texture2D` |
| tile_color | i16 (RGB565) | RGB8 PNG (pre-decoded) | `Texture2D` directly |
| tile_layer | 7 bytes/tile | RGBA PNG + RGB PNG (two images, 3+4 channels) | Two `Texture2D`s |

This eliminates all custom binary parsing on the Unity side. Import becomes:
```csharp
var collisionTex = AssetDatabase.LoadAssetAtPath<Texture2D>("grids/collision.png");
// Done. No binary reader needed.
```

---

## Migration Path

### Phase 1: Move metadata + lighting into terrain.glb
- Add scene-level `extras` with map metadata
- Add `KHR_lights_punctual` directional light
- Add spawn point as named node
- Remove these fields from manifest

### Phase 2: Move placements into terrain.glb
- Add empty nodes for building + effect placements
- Keep `buildings` dict in manifest (obj_id → file mapping)
- Remove `placements` and `effect_placements` arrays from manifest

### Phase 3: Convert grids to images
- Export grids as PNG/EXR instead of custom `.bin`
- Update manifest grid entries to reference `.png`/`.exr` files
- Simplify Unity importer to load textures directly

### Phase 4: Slim manifest
- Manifest becomes just: version, file references (grids, effects, buildings, textures), and areas dict
- All spatial/renderable data lives in glTF

---

## Open Questions

1. **GLB vs glTF for terrain?** GLB is more efficient (single file, binary buffers) but harder to debug. Currently using `.gltf` with embedded base64.
2. **Building instancing approach?** Should buildings be merged into terrain.glb as actual meshes (true instancing via `EXT_mesh_gpu_instancing`), or kept as separate files referenced by empty nodes?
3. **Grid image format?** PNG is universal but limited to 8/16-bit. EXR supports float but needs Unity's EXR importer. For i16 grids, R16 PNG (non-standard) vs EXR vs keeping binary?
4. **Unity importer maturity?** How far along is the Unity-side importer? Changing the export format means updating the importer too.
