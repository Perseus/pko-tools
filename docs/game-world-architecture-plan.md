# Game World Architecture — Single Map Foundation

## Context
We have xmas map working with click-to-move, animations, camera, and TOP shader. Now we need proper game world architecture: PKO collision grid driving NavMesh, section-based terrain streaming (matching original engine), building optimization, data-driven map definitions, and a foundation that scales to 85 maps.

**Key findings from PKO client source research:**
- **Server-authoritative pathfinding**: Original game uses BFS (not A*) on the server. Server sends up to 32 waypoints via `SMoveInit.SInflexionInfo`. Client interpolates locally using ping latency. Our NavMesh serves as client-side prediction only.
- **Section-based streaming**: Original engine (`MPMapData::DynamicLoading()`) loads/unloads 64x64-tile sections based on camera viewport with LRU eviction. Maps can be up to 512x512 sections.
- **Current manifest.json** was exported before collision grid support was added. Step 0 is re-exporting xmas to get `collision_grid` + `region_grid` data (Rust code at `terrain.rs:1199-1258` already generates them).

## Architecture Decisions (with justification)

| Decision | Choice | Why | Source |
|----------|--------|-----|--------|
| Scene management | Persistent bootstrap + additive map scenes | PKO has discrete zones. Mirrors Albion Online's cluster architecture. | [Albion Online Architecture](https://davidsalz.de/wp-content/uploads/2016/06/Albion-Online-Quo-Vadis-2016-talk.pdf) |
| Terrain streaming | Section-based chunk loading within a map scene | Matches original engine's `DynamicLoading()`. Large maps need it. Preload based on player position + movement direction. | PKO client `MPMapData.cpp:317-399` |
| Game data | ScriptableObjects | Near-instant load vs 78ms for JSON with 10K objects. Inspector-editable. One SO per map. | [Ryan Hipple Unite 2017](https://github.com/roboryantron/Unite2017) |
| Navigation | PKO collision grid → NavMesh (client prediction) + server-authoritative waypoints | NavMesh for local prediction/collision. Server sends authoritative waypoints. Original uses BFS with 32-waypoint paths. | PKO `FindPath.cpp`, `SMoveInit` struct |
| Draw calls | SRP Batcher (baseline) + Static Batching (buildings) | SRP Batcher reduces state changes for same-shader objects. Static batching for never-moving geometry. | [Unity Optimizing Draw Calls](https://docs.unity.cn/Manual/optimizing-draw-calls.html) |
| Culling | Layer distance culling + frustum culling | Occlusion culling poor for isometric cameras. Distance culling is predictable. | [Isometric RTS Culling](https://80.lv/articles/optimizing-isometric-rts-performance-with-frustum-culling) |
| Code style | MonoBehaviour (ECS later if needed) | ECS still missing CharacterController, Animator, NavMeshAgent. MonoBehaviour sufficient at this scale. | [ECS Status Dec 2025](https://discussions.unity.com/t/ecs-development-status-december-2025/1699284) |

## File Structure

```
Assets/
├── Scripts/
│   └── World/
│       ├── MapDefinition.cs          (ScriptableObject: map metadata + grids)
│       ├── MapLoader.cs              (MonoBehaviour: runtime map manager + spawn)
│       ├── TerrainStreamer.cs         (MonoBehaviour: section-based chunk loading/unloading)
│       ├── CollisionGridImporter.cs  (static utility: PKO grid → NavMesh source mesh)
│       └── BuildingCuller.cs         (MonoBehaviour: layer distance culling setup)
│   └── Player/
│       ├── ClickToMove.cs            (existing, updated for walkability check)
│       └── PlayerAnimator.cs         (existing, unchanged)
│   └── Rendering/
│       ├── TOPMaterialReplacer.cs    (existing, unchanged)
│       └── AddCollidersToChildren.cs (existing, unchanged)
├── Data/
│   └── Maps/
│       └── xmas.asset               (MapDefinition ScriptableObject instance)
├── Editor/
│   ├── SetupClickToMove.cs          (existing — keep for player setup)
│   └── MapImporter.cs               (NEW — unified import: terrain sections + buildings + collision + NavMesh)
└── Maps/                            (existing, unchanged)
    ├── xmas/
    │   ├── manifest.json            (re-exported with collision_grid + region_grid)
    │   └── xmas.gltf
    └── buildings/*.gltf
```

## Implementation Steps

### Step 0: Re-export xmas map
Run pko-tools map exporter on xmas to generate manifest.json with `collision_grid` and `region_grid`.
- Rust code already generates these at `src-tauri/src/map/terrain.rs:1199-1258`
- Format: `collision_grid.data` = base64 bytes, 2x tile resolution, 0=walkable
- Replace current `Assets/Maps/xmas/manifest.json`

### Step 1: MapDefinition ScriptableObject
**File:** `Assets/Scripts/World/MapDefinition.cs`

```
Fields:
- mapName (string)
- worldScale (float) — 5.0
- spawnPoint (Vector3)
- sectionWidth, sectionHeight (int) — tile dimensions per section (e.g. 64)
- mapWidthTiles, mapHeightTiles (int) — total map dimensions in tiles
- collisionGridWidth, collisionGridHeight (int) — 2x tile resolution
- collisionGridTileSize (float) — 0.5
- collisionGridData (byte[]) — decoded from manifest base64
- regionGridWidth, regionGridHeight (int)
- regionGridData (byte[]) — decoded from manifest base64
- portalDefinitions (PortalDef[]) — empty array for now
```

### Step 2: CollisionGridImporter (Static Utility)
**File:** `Assets/Scripts/World/CollisionGridImporter.cs`

Static methods:
- `DecodeCollisionGrid(string base64Data)` → `byte[]`
- `BuildNavMeshSourceMesh(byte[] grid, int width, int height, float tileSize, float worldScale)` → `Mesh`
  - For each walkable cell (`grid[y * width + x] == 0`), emit a quad
  - Position: `(x * tileSize * worldScale, 0, -y * tileSize * worldScale)` (Z negated for Unity left-handed)
  - Flat Y=0 initially; terrain height sampling is a future enhancement
  - Optimize: share vertices between adjacent walkable quads
- `IsWalkable(byte[] grid, int width, int height, float tileSize, float worldScale, Vector3 worldPos)` → `bool`
  - Convert world position to grid coords, return `grid[idx] == 0`

### Step 3: TerrainStreamer (Runtime Chunk Manager)
**File:** `Assets/Scripts/World/TerrainStreamer.cs`

Replicates original engine's `MPMapData::DynamicLoading()` pattern:

**Concept:** The full terrain mesh is split into sections at import time. At runtime, only sections near the player are active. Sections are preloaded based on movement direction.

**Fields:**
- `sectionObjects` — `Dictionary<Vector2Int, GameObject>` mapping section coords → instantiated section
- `loadRadius` (int) — how many sections around player to keep loaded (default: 3 = 7x7 grid)
- `preloadRadius` (int) — extra ring to preload (default: loadRadius + 1)
- `maxLoadedSections` (int) — LRU cap (default: 64, matching original engine)

**Update loop (amortized, runs every 0.5s not every frame):**
1. Calculate player's current section: `sectionX = playerPos.x / (sectionWidth * worldScale)`, same for Z
2. For each section within `preloadRadius`: if not loaded, load it (instantiate from prefab or enable GameObject)
3. For sections outside `loadRadius + buffer`: mark for unload
4. LRU eviction: if loaded count > `maxLoadedSections`, unload least-recently-accessed sections
5. Track `lastAccessTime` per section for LRU

**Preloading strategy:**
- Use player's velocity direction to bias preloading: load sections ahead of movement first
- Async: use `Instantiate` on pooled section prefabs (pre-imported as sub-assets)
- Buildings in each section are children of the section root → load/unload together

**For this initial implementation (xmas = moderate size):** Start with all sections loaded but infrastructure in place. Only activate streaming for maps above a threshold (e.g. >16 sections total).

### Step 4: Enhanced MapImporter (Editor Script)
**File:** `Assets/Editor/MapImporter.cs`

Absorbs `ImportMapObjects.cs` (424 lines at `Assets/Maps/ImportMapObjects.cs`). Reuses its building placement logic. Adds:

1. **Parse manifest** — extend existing `ManifestShell` with `collision_grid`/`region_grid` fields + `map_name`
2. **Create MapDefinition SO** — decode base64 grids, save to `Assets/Data/Maps/{mapName}.asset`
3. **Split terrain into sections** — if terrain mesh is large, programmatically split into section-sized chunks at import time. Each section becomes a child GameObject. Tag sections with `(sectionX, sectionY)` in name.
4. **Place buildings per section** — assign each building to its containing section based on world position
5. **Generate collision mesh** — `CollisionGridImporter.BuildNavMeshSourceMesh()`, save as asset
6. **Add NavMeshSurface** — hidden collision mesh child, bake NavMesh
7. **Mark static** — `StaticEditorFlags.BatchingStatic` on terrain + buildings
8. **Apply rendering** — `TOPMaterialReplacer` + `AddCollidersToChildren` on terrain
9. **Setup layers** — assign buildings to "Buildings" layer for distance culling

UI: EditorWindow with manifest browse, collision grid indicator, section count preview.

### Step 5: BuildingCuller (Runtime)
**File:** `Assets/Scripts/World/BuildingCuller.cs`

Attach to buildings root or map root:
- `Start()`: Configure `Camera.main.layerCullDistances` — buildings at 500 units, small props at 150 units
- Set layers on building GameObjects (done at import time in MapImporter)

### Step 6: MapLoader (Runtime)
**File:** `Assets/Scripts/World/MapLoader.cs`

MonoBehaviour on "GameManager" object:
- `public MapDefinition currentMap` — inspector-assigned
- `public static MapLoader Instance` — singleton for easy access
- `Start()`: position player at `currentMap.spawnPoint`
- `IsWalkable(Vector3 worldPos)` → `CollisionGridImporter.IsWalkable()` with `currentMap` grid data
- `OnDrawGizmosSelected()`: visualize collision grid (green=walkable, red=blocked)
- Future: `TransitionToMap(MapDefinition newMap)` for zone changes

### Step 7: Update ClickToMove
**File:** `Assets/Scripts/ClickToMove.cs` (minor change)

After raycast hit, check `MapLoader.Instance.IsWalkable(hit.point)` before `SetDestination`. Provides client-side prediction validation. When server networking is added later, this becomes: send destination to server → receive waypoints → follow them with local interpolation.

## Movement Architecture (Current vs Future)

**Current (offline/singleplayer prototype):**
```
Click → Raycast → IsWalkable? → NavMeshAgent.SetDestination → local pathfinding
```

**Future (server-authoritative, matching original PKO):**
```
Click → Raycast → IsWalkable? → Send destination to server
Server → BFS pathfinding → SMoveInit (32 waypoints + ping)
Client → Receive waypoints → Interpolate along path (NavMesh for prediction/smoothing)
```

The NavMesh stays useful as client-side prediction between server updates.

## Files Summary

| File | Action | Lines Est. |
|------|--------|------------|
| `Assets/Scripts/World/MapDefinition.cs` | **New** | ~70 |
| `Assets/Scripts/World/CollisionGridImporter.cs` | **New** | ~130 |
| `Assets/Scripts/World/TerrainStreamer.cs` | **New** | ~200 |
| `Assets/Scripts/World/MapLoader.cs` | **New** | ~90 |
| `Assets/Scripts/World/BuildingCuller.cs` | **New** | ~40 |
| `Assets/Editor/MapImporter.cs` | **New** (absorbs ImportMapObjects.cs) | ~550 |
| `Assets/Scripts/ClickToMove.cs` | **Modify** — add walkability check | ~5 lines changed |
| `Assets/Maps/ImportMapObjects.cs` | **Delete** — replaced by MapImporter.cs | — |

## Verification
1. Re-export xmas from pko-tools → new manifest.json has `collision_grid` + `region_grid`
2. Copy new manifest to `Assets/Maps/xmas/manifest.json`
3. `Tools > PKO Map Importer` → creates MapDefinition SO, places terrain/buildings, generates collision mesh, bakes NavMesh
4. Check `Assets/Data/Maps/xmas.asset` in Inspector → grids populated, spawn point set
5. Play mode → player spawns at spawn point, walks only on walkable areas
6. Click water/blocked area → character stops at NavMesh boundary
7. Scene view Gizmos → collision grid visualization matches original game
8. Stats window → draw calls reasonable with static batching
9. For large maps: TerrainStreamer loads/unloads sections as player moves (verify with debug logging)

## Future Extensions (not in this implementation)
- **Multi-map**: `MapLoader.TransitionToMap()` + additive scene loading
- **Server networking**: Mirror/FishNet integration, server-authoritative BFS, waypoint interpolation
- **Addressables**: One group per map for async loading
- **Portals**: `MapDefinition.portalDefinitions` + trigger colliders
- **CullingGroup API**: For NPC AI/animation distance management
- **LOD Groups**: 3-level LODs on buildings
- **Terrain height sampling**: Collision mesh Y from terrain for sloped terrain
- **Movement prediction**: Client-side dead reckoning between server waypoint updates
