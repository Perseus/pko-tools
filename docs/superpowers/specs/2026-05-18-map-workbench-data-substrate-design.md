# Map Workbench Data Substrate Design

Date: 2026-05-18
Status: approved direction; pending written-spec review

## Objective

Build the first independently shippable slice of the PKO Tools map editor: a high-performance, read-only map workbench and data substrate. This slice must make huge PKO maps, including 4096 x 4096 maps such as `garner`, inspectable without loading the whole terrain into React, Three.js, or any asset-export scene format.

The full product goal remains a best-in-class map viewing and editing experience that can edit terrain, placements, collision, regions, islands, and eventually write client-side `.map` and `.obj` files plus server-side `.atr` and `.blk` files. This design intentionally builds the foundation first: chunked access, layer contracts, exact tile inspection, and a workbench UI that later editing and native writers can reuse.

## Current State

The existing map page already has useful pieces:

- `src/features/map/MapWorkbench.tsx` offers the native 2D map workbench and synchronized placement browsing.
- `src/features/map/MapPlacementBrowser.tsx` streams `.obj` placement records in pages.
- `src-tauri/src/map/map_loader.rs` parses native `.map` files into section and tile structures.
- `src-tauri/src/map/obj_loader.rs` parses `.obj` placement files.
- `src-tauri/src/map/terrain.rs` already derives collision grids, object-height grids, terrain-height grids, area/island grids, region grids, color grids, texture grids, and metadata.

The main limitation was the terrain display path. The removed monolithic terrain-viewer path built one large asset scene and the frontend then loaded it through Three.js. That approach did not fit native PKO map editing or scale to a responsive editor for 16.7 million tiles, 67.1 million sub-tile collision cells, multiple overlays, placement markers, and per-tile inspection.

## Scope

This slice is read-only but complete enough to replace the existing default map viewing experience.

In scope:

- Full-map overview for all maps, including 4096 x 4096 maps.
- Smooth pan and zoom with bounded memory.
- On-demand chunk loading for visible map data.
- Layer toggles for terrain color, texture ids, heightmap, collision/non-walkable cells, object-height cells, region flags, island/area ids, and placements.
- Exact tile and sub-tile inspection at high zoom.
- Spatial `.obj` placement overlay with selection and details.
- Frontend and backend data contracts designed for later dirty-chunk editing and native serialization.
- Rust tests for map layer extraction, chunk boundaries, exact inspection, and collision bit semantics.
- Frontend tests for request-window math, cache eviction, and layer state behavior.

Out of scope for this slice:

- Editing tile data.
- Editing `.obj` placements.
- Writing `.map`, `.obj`, `.atr`, or `.blk` files.
- Rendering every terrain texture as a full material-blended 3D view.
- Solving unknown legacy `.obj` writer details. That belongs to the native writer slice.

## Product Behavior

The map workbench should open into a real map surface, not a text-oriented placement page. The first viewport shows the whole map as a fast overview. Users can pan, zoom, switch layers, inspect tiles, and select placements. The existing right-side placement browser remains useful, but it becomes a coordinated panel for the map surface instead of the primary experience.

Expected user workflow:

1. Select a map from the navigator.
2. See the whole map immediately through an overview layer and metadata.
3. Toggle overlays for blocked cells, height, regions, islands, texture ids, and placements.
4. Zoom toward any part of the map.
5. At high zoom, inspect a tile and see all native fields:
   - tile coordinates
   - section coordinates
   - `dw_tile_info`
   - `bt_tile_info`
   - decoded texture layer ids and alpha fields
   - `s_color`
   - decoded RGB565 color
   - `c_height`
   - derived terrain height
   - `s_region`
   - decoded region flags
   - `bt_island`
   - `bt_block[4]`
   - decoded blocked state and object height for each 2x2 sub-tile
6. Select a placement from the map or placement browser and keep both surfaces synchronized.

## Architecture

The design adds a chunked map workbench layer next to the existing export-oriented terrain code.

### Backend

Add a focused backend module:

- `src-tauri/src/map/workbench.rs`

This module owns read-only, viewport-oriented map data. It should reuse parser and decoding logic from `map_loader.rs`, `obj_loader.rs`, and `terrain.rs`, but it should not build glTF. It should expose serializable DTOs for Tauri commands and small pure functions that can be unit-tested without Tauri.

Keep existing commands:

- `get_map_list`
- `get_map_placement_summary`
- `query_map_placements`

Add new commands:

- `get_map_workbench_manifest(project_id, map_name) -> MapWorkbenchManifest`
- `get_map_overview(project_id, map_name, layer, max_size) -> MapOverviewLayer`
- `get_map_chunk(project_id, map_name, request) -> MapChunkPayload`
- `inspect_map_tile(project_id, map_name, tile_x, tile_y) -> MapTileInspection`
- `query_map_placements_in_bounds(project_id, map_name, min_x, min_y, max_x, max_y, limit) -> MapPlacementPage`

The command layer remains thin. It resolves the project, loads or reuses cached parsed map data, validates coordinates, calls pure workbench functions, and returns DTOs.

### Cache

Add an in-memory parsed-map cache in `AppState`, keyed by `(project_id, map_name, file_modified_time, file_len)`. This prevents repeatedly reading and parsing large `.map` files as the user pans. The cache should store parsed map data and lightweight placement indexes. It should not store unbounded rendered chunks.

Chunk image/data responses can be cached in a bounded least-recently-used cache keyed by `(project_id, map_name, map_file_version, layer, chunk_x, chunk_y, zoom_bucket)`. The cache limit should be based on bytes, not item count. A practical initial cap is 128 MiB for generated chunk payloads. The implementation plan can start with parsed-map caching and add bounded chunk caching once chunk generation is in place.

### Chunk Model

Use fixed terrain chunks of 128 x 128 tiles by default.

For a 4096 x 4096 map:

- 32 x 32 terrain chunks.
- 16,384 tiles per terrain chunk.
- 32,768 bytes for one i16 tile-height plane.
- 16,384 bytes for one u8 tile plane.
- 65,536 sub-tile cells per collision/object-height chunk at 2x resolution.

This size is large enough to avoid too many Tauri calls and small enough that decoding and canvas upload remain bounded. The manifest should expose the chunk size so the frontend does not hardcode it.

### Layer Payloads

The backend should distinguish visual layers from inspection data.

Visual layers should be cheap to draw:

- Overview layers return PNG data URIs or base64 PNG bytes sized to `max_size`, preserving map aspect ratio.
- Chunk visual layers return PNG data URIs or base64 PNG bytes for direct canvas upload.

Inspection data should be exact:

- `inspect_map_tile` returns native fields and decoded fields for a single tile.
- Optional chunk numeric payloads return base64 little-endian typed arrays only when the frontend needs precise per-pixel tools beyond visual display.

Layer types:

- `terrain_color`: RGB565-derived color.
- `texture_base`: base texture id from `bt_tile_info`.
- `texture_layers`: decoded texture ids and alpha slots from `dw_tile_info`.
- `height`: normalized terrain height heatmap from `c_height`.
- `collision`: non-walkable cells from bit 7 of `bt_block[0..4]`, at 2x tile resolution.
- `object_height`: decoded object-height cells from `bt_block[0..4]`, at 2x tile resolution.
- `region`: `s_region` with decoded PKO flags.
- `island`: `bt_island`.
- `placements`: `.obj` placement markers and density/visibility metadata.

### Manifest DTO

`MapWorkbenchManifest` should include:

- map name
- width and height in tiles
- section width and height
- section counts
- total section count
- non-empty section count
- chunk size
- chunk counts
- available layers
- placement counts
- coordinate system description
- source file metadata used for cache invalidation
- recommended overview maximum size

### Chunk Request DTO

`MapChunkRequest` should include:

- `chunk_x`
- `chunk_y`
- `layer`
- `zoom_bucket`
- `include_numeric_payload`

`zoom_bucket` is not a rendering scale. It tells the backend which visual detail level is useful. For example, low zoom can return a coarser color image, while high zoom returns one pixel per tile or two pixels per tile for collision.

### Tile Inspection DTO

`MapTileInspection` should include:

- request coordinates
- clamped or invalid status
- section coordinates and local tile coordinates
- native tile fields
- decoded texture layers
- decoded color
- terrain height in PKO units
- region flag list
- island id
- four sub-tile records, each with blocked state, raw `bt_block` byte, and decoded object height
- placements near the tile, capped by a small limit

This DTO is the correctness anchor for the workbench. The user should be able to verify any visual overlay against exact native data.

## Frontend Design

Replace the current split between placement page and full-terrain mode with a map surface and side panels.

Recommended file structure:

- `src/features/map/workbench/MapWorkbenchShell.tsx`
- `src/features/map/workbench/MapCanvas.tsx`
- `src/features/map/workbench/MapLayerToolbar.tsx`
- `src/features/map/workbench/MapTileInspector.tsx`
- `src/features/map/workbench/MapPlacementOverlay.tsx`
- `src/features/map/workbench/useMapViewport.ts`
- `src/features/map/workbench/useMapChunks.ts`
- `src/features/map/workbench/mapChunkMath.ts`
- `src/features/map/workbench/mapLayerTypes.ts`

`src/features/map/MapWorkbench.tsx` should become a thin compatibility wrapper that renders `MapWorkbenchShell`.

Use a 2D canvas-first renderer for the primary workbench. A map editor needs dense, inspectable raster overlays more than an always-on 3D terrain scene. Asset-level 3D preview can remain available for buildings and other model files, but maps themselves stay in the native workbench rather than an on-demand terrain export/viewer path.

The canvas renderer should:

- Draw overview imagery while chunks load.
- Draw visible chunks in map-coordinate order.
- Draw overlay layers with opacity controls.
- Draw placement markers using viewport culling.
- Draw tile grid only above a high zoom threshold.
- Draw selected tile and selected placement affordances.
- Avoid storing full-map arrays in React state.
- Use refs and requestAnimationFrame for pan/zoom interaction state.
- Commit only semantic state to Jotai: selected map, active layers, selected tile, selected placement, and side-panel mode.

### Workbench Layout

The first screen should be the usable workbench:

- Center: full map canvas.
- Left/top compact toolbar: select, pan, zoom, layer toggles, opacity controls, fit-to-map.
- Right panel: inspector with tabs for tile, placement, and map metadata.
- Bottom/status strip: coordinates, zoom level, loaded chunk count, current layer, and request state.

Avoid explanatory text blocks inside the app. The UI should behave like a tool: controls, inspector fields, and status readouts.

## Performance Strategy

The key rule is that the UI never loads full-resolution data for the entire map unless the specific layer is tiny enough and the user action requires it.

For `garner` scale:

- Overview: one low-resolution image per layer, bounded by `max_size`.
- High detail: only visible chunks plus a small prefetch margin.
- Placements: query by viewport bounds and keep the existing paged browser for search.
- Collision: render as 2x-resolution chunk imagery only for visible chunks.
- Tile inspection: exact one-tile command, not a full chunk decode in React.
- React state: semantic selections and layer settings only.

Target behavior:

- Opening metadata and overview should not require generating a full glTF.
- Pan and zoom should remain responsive while chunks are loading.
- A loading chunk should degrade to overview imagery, not blank the viewport.
- Chunk request cancellation should use the existing `LatestOnly` pattern or equivalent request-versioning.
- Chunk memory should be bounded and evict least-recently-used payloads.

## Correctness Strategy

The backend should treat native PKO fields as the source of truth.

Known format rules to preserve:

- `.map` header is five little-endian i32 values.
- Current map version is `780627`.
- Native tile record is 15 bytes:
  - `dwTileInfo`
  - `btTileInfo`
  - `sColor`
  - `cHeight`
  - `sRegion`
  - `btIsland`
  - `btBlock[4]`
- Terrain height is `cHeight * 10 / 100`.
- `btBlock` bit 7 is collision/non-walkable.
- `btBlock` bits 0-5 are object-height magnitude in 0.05-unit steps.
- `btBlock` bit 6 is object-height sign.
- Server `.blk` uses 2x tile dimensions and bit-packed obstacle cells, but writing `.blk` is not part of this slice.
- Server `.atr` uses per-tile region and island data, but writing `.atr` is not part of this slice.

YAMMI is useful as a parity reference for layer concepts and writer behavior, especially `.atr` and `.blk`, but the PKO client/server source and current Rust parser remain the stronger authority for this slice.

## Error Handling

Backend commands should return clear user-facing errors:

- map not found
- unsupported map version
- malformed or truncated section data
- invalid chunk coordinates
- invalid tile coordinates
- missing `.obj` file for placement layers
- placement query capped because the result set is too large

Frontend behavior:

- A failed layer request shows a compact layer error state without breaking the whole workbench.
- A failed overview request keeps the metadata and inspector usable.
- Missing `.obj` data disables the placement overlay and keeps terrain inspection available.
- Invalid tile inspection clears the inspector selection and leaves the viewport unchanged.

## Testing

Rust tests:

- Decode texture layer metadata from `bt_tile_info` and `dw_tile_info`.
- Generate a manifest for a synthetic map with expected dimensions, section counts, and chunk counts.
- Extract chunks at map edges without reading outside available sections.
- Render collision chunks from `bt_block` using only bit 7.
- Decode object-height cells from `bt_block` bits 0-6.
- Inspect a tile and verify native fields plus decoded fields.
- Query placements in bounds with inclusive/exclusive boundary behavior documented in the test.
- Reject invalid chunk and tile coordinates.

Frontend tests:

- `mapChunkMath` maps viewport rectangles to chunk coordinates.
- Chunk selection includes a prefetch margin and clamps to map bounds.
- Chunk cache evicts least-recently-used entries by byte budget.
- Layer state serializes to command requests correctly.
- Tile selection maps screen coordinates to map tile coordinates at multiple zoom levels.

Manual verification:

- Open a small map and verify overview, chunks, tile inspection, and placement selection.
- Open a large map such as `garner` and verify that the workbench remains responsive while panning and zooming.
- Toggle each layer and compare at least one inspected tile against raw native fields.
- Verify that map-to-glTF terrain export/viewer controls and commands remain absent after the workbench changes.

## Follow-On Slices

Slice 2: native writer foundation.

- `.map` writer with sparse section preservation.
- `.atr` writer from region/island data.
- `.blk` writer from 2x collision data.
- `.obj` writer design and format validation.
- Round-trip tests against known maps.

Slice 3: editing model.

- Dirty chunk tracking.
- Undo/redo command model.
- Tile brush tools for height, texture layer, color, region, island, and collision.
- Placement create/move/delete tools.
- Save/export flow using Slice 2 writers.

Slice 4: advanced editor polish.

- Texture palette and blend authoring.
- Bulk operations.
- Validation warnings for server/client mismatch.
- Optional native chunk or building preview synced to selected map context, without reintroducing map terrain export.

## Acceptance Criteria

This slice is complete when:

1. The maps page opens into the new workbench surface for selected maps.
2. A 4096 x 4096 map can show a full overview without loading a monolithic terrain scene.
3. Panning and zooming request only visible chunks plus a bounded prefetch margin.
4. The user can toggle terrain color, texture id, heightmap, collision, object-height, region, island, and placement layers.
5. The user can inspect any valid tile and see native fields plus decoded values.
6. The user can see and select building/effect placements spatially.
7. The existing placement search remains available and synchronizes with map selection.
8. The removed glTF terrain export and on-demand terrain view stay removed; maps remain native-format workbench data.
9. Rust tests cover manifest, chunk extraction, layer decoding, tile inspection, and placement bounds.
10. Frontend tests cover viewport-to-chunk math, cache behavior, layer request construction, and tile picking.
11. Manual verification has been performed on one small map and one large map, with notes recorded in the implementation summary.
