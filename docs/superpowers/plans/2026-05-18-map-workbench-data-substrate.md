# Map Workbench Data Substrate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first read-only high-performance map workbench slice: chunked map data APIs, exact tile inspection, spatial placement overlays, and a canvas-first frontend that can inspect huge maps without loading a monolithic terrain scene.

**Architecture:** Add a Rust `map::workbench` module with pure layer/chunk/inspection functions, expose thin Tauri commands backed by parsed-map caching, then replace the default map page with a 2D canvas workbench that requests only visible chunks. Preserve the existing placement browser as a coordinated editor panel; map-to-glTF terrain export/viewer paths are intentionally out of product scope.

**Tech Stack:** Rust/Tauri commands, existing Kaitai-backed PKO parsers, `image` PNG encoding, React 18, TypeScript, Jotai, Tailwind, Vitest.

---

## File Structure

Backend:

- Create `src-tauri/src/map/workbench.rs`: DTOs, pure map layer extraction, chunk rendering, exact tile inspection, placement bounds filtering, and unit tests.
- Modify `src-tauri/src/map/mod.rs`: export `workbench` module and DTO types needed by commands.
- Modify `src-tauri/src/map/terrain.rs`: expose `tile_height` as `pub(crate)` so workbench inspection and height rendering use the same formula.
- Modify `src-tauri/src/map/commands.rs`: add cache helpers and Tauri commands for manifest, overview, chunks, tile inspection, and placement bounds.
- Modify `src-tauri/src/lib.rs`: add parsed map cache to `AppState` and register new commands.

Frontend:

- Modify `src/types/map.ts`: add workbench DTOs and layer types.
- Modify `src/commands/map.ts`: add invoke wrappers for new commands.
- Modify `src/store/map.ts`: add workbench layer/selection atoms.
- Create `src/features/map/workbench/mapLayerTypes.ts`: layer definitions, defaults, and command serialization.
- Create `src/features/map/workbench/mapChunkMath.ts`: viewport math, tile picking, chunk windows, and LRU cache helper.
- Create `src/features/map/workbench/__tests__/mapChunkMath.test.ts`: viewport/chunk/cache tests.
- Create `src/features/map/workbench/__tests__/mapLayerTypes.test.ts`: layer serialization tests.
- Create `src/features/map/workbench/MapLayerToolbar.tsx`: compact layer toggles and opacity controls.
- Create `src/features/map/workbench/MapTileInspector.tsx`: tile/placement/metadata inspector panel.
- Create `src/features/map/workbench/MapCanvas.tsx`: 2D canvas renderer, pan/zoom/tile picking, chunk drawing, and placement selection.
- Create `src/features/map/workbench/useMapChunks.ts`: command orchestration, request-versioning, and bounded chunk cache.
- Create `src/features/map/workbench/MapWorkbenchShell.tsx`: top-level workbench layout and compatibility with existing placement browser.
- Modify `src/features/map/MapWorkbench.tsx`: make it a thin wrapper around `MapWorkbenchShell`.
- Modify `src/features/map/MapPlacementBrowser.tsx`: accept externally selected placement and optional compact mode synchronization.
- Modify `src/features/actions/ActionKernelProvider.tsx`: keep existing map actions working and add no required global commands for the first slice.

Verification:

- Run `cd src-tauri && cargo test map::workbench`.
- Run `cd src-tauri && cargo test map::terrain`.
- Run `pnpm test:run src/features/map/workbench`.
- Run `pnpm build`.
- Run `cd src-tauri && cargo check`.
- Start `pnpm tauri dev` and manually open `/maps` in the Tauri webview for small-map and large-map checks when project data is available.

---

### Task 1: Backend Workbench Pure Data Layer

**Files:**
- Create: `src-tauri/src/map/workbench.rs`
- Modify: `src-tauri/src/map/mod.rs`
- Modify: `src-tauri/src/map/terrain.rs`

- [ ] **Step 1: Add failing Rust tests for manifest, decoding, chunking, and inspection**

Create `src-tauri/src/map/workbench.rs` with DTO/test scaffolding and tests first. The test module should construct synthetic `ParsedMap` values directly so it does not need filesystem fixtures.

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::map::terrain::{MapHeader, MapSection, MapTile, ParsedMap};

    fn tile(
        dw_tile_info: u32,
        bt_tile_info: u8,
        s_color: i16,
        c_height: i8,
        s_region: i16,
        bt_island: u8,
        bt_block: [u8; 4],
    ) -> MapTile {
        MapTile {
            dw_tile_info,
            bt_tile_info,
            s_color,
            c_height,
            s_region,
            bt_island,
            bt_block,
        }
    }

    fn map_4x4() -> ParsedMap {
        ParsedMap {
            header: MapHeader {
                n_map_flag: 780627,
                n_width: 4,
                n_height: 4,
                n_section_width: 2,
                n_section_height: 2,
            },
            section_cnt_x: 2,
            section_cnt_y: 2,
            section_offsets: vec![20, 80, 140, 200],
            sections: vec![
                Some(MapSection {
                    tiles: vec![
                        tile(0x0000_0000, 7, 0x001f, 10, 0x0003, 2, [0x80, 0x01, 0x41, 0xc1]),
                        tile(0x0000_0000, 8, 0x07e0, 0, 0, 0, [0, 0, 0, 0]),
                        tile(0x0000_0000, 9, 0xf800u16 as i16, -5, 0, 1, [0, 0, 0, 0]),
                        tile(0x0000_0000, 10, 0xffffu16 as i16, 20, 0x0010, 3, [0, 0x80, 0, 0]),
                    ],
                }),
                Some(MapSection {
                    tiles: vec![tile(0, 11, 0, 1, 0, 0, [0; 4]); 4],
                }),
                Some(MapSection {
                    tiles: vec![tile(0, 12, 0, 2, 0, 0, [0; 4]); 4],
                }),
                None,
            ],
        }
    }

    #[test]
    fn manifest_reports_chunk_counts_and_layers() {
        let manifest = build_manifest(&map_4x4(), "puzzle", 2, 5, SourceFileInfo {
            map_modified_ms: 123,
            map_file_len: 456,
        });
        assert_eq!(manifest.name, "puzzle");
        assert_eq!(manifest.width, 4);
        assert_eq!(manifest.height, 4);
        assert_eq!(manifest.chunk_size, 2);
        assert_eq!(manifest.chunk_count_x, 2);
        assert_eq!(manifest.chunk_count_y, 2);
        assert_eq!(manifest.total_sections, 4);
        assert_eq!(manifest.non_empty_sections, 3);
        assert_eq!(manifest.placement_count, 5);
        assert!(manifest.available_layers.contains(&MapWorkbenchLayer::Collision));
    }

    #[test]
    fn decode_tile_exposes_native_and_derived_fields() {
        let decoded = inspect_tile(&map_4x4(), 0, 0, &[]).unwrap();
        assert_eq!(decoded.tile_x, 0);
        assert_eq!(decoded.tile_y, 0);
        assert_eq!(decoded.section_x, 0);
        assert_eq!(decoded.section_y, 0);
        assert_eq!(decoded.local_x, 0);
        assert_eq!(decoded.local_y, 0);
        assert_eq!(decoded.native.bt_tile_info, 7);
        assert_eq!(decoded.native.c_height, 10);
        assert!((decoded.terrain_height - 1.0).abs() < 0.001);
        assert_eq!(decoded.color_rgb, [248, 0, 0]);
        assert_eq!(decoded.region_flags, vec!["land", "not_fight"]);
        assert_eq!(decoded.texture_layers[0].texture_id, 7);
        assert_eq!(decoded.texture_layers[0].alpha, 15);
        assert_eq!(decoded.texture_layers[1].texture_id, 21);
        assert_eq!(decoded.texture_layers[1].alpha, 5);
        assert_eq!(decoded.texture_layers[2].texture_id, 33);
        assert_eq!(decoded.texture_layers[2].alpha, 7);
        assert_eq!(decoded.texture_layers[3].texture_id, 12);
        assert_eq!(decoded.texture_layers[3].alpha, 9);
        assert_eq!(decoded.subtiles[0].blocked, true);
        assert_eq!(decoded.subtiles[0].object_height, 0.0);
        assert_eq!(decoded.subtiles[1].blocked, false);
        assert!((decoded.subtiles[1].object_height - 0.05).abs() < 0.001);
        assert!((decoded.subtiles[2].object_height + 0.05).abs() < 0.001);
        assert!(decoded.subtiles[3].blocked);
    }

    #[test]
    fn chunk_payload_clamps_at_map_edges() {
        let payload = build_chunk_payload(&map_4x4(), MapChunkRequest {
            chunk_x: 1,
            chunk_y: 1,
            layer: MapWorkbenchLayer::TextureBase,
            zoom_bucket: 1,
            include_numeric_payload: true,
        }, 3).unwrap();
        assert_eq!(payload.tile_x, 3);
        assert_eq!(payload.tile_y, 3);
        assert_eq!(payload.tile_width, 1);
        assert_eq!(payload.tile_height, 1);
        assert_eq!(payload.numeric_format.as_deref(), Some("u8"));
        assert!(!payload.image_data_uri.is_empty());
    }

    #[test]
    fn collision_chunk_uses_only_bit_seven() {
        let payload = build_chunk_payload(&map_4x4(), MapChunkRequest {
            chunk_x: 0,
            chunk_y: 0,
            layer: MapWorkbenchLayer::Collision,
            zoom_bucket: 2,
            include_numeric_payload: true,
        }, 2).unwrap();
        let raw = base64::prelude::BASE64_STANDARD.decode(payload.numeric_payload.unwrap()).unwrap();
        assert_eq!(payload.sample_width, 4);
        assert_eq!(payload.sample_height, 4);
        assert_eq!(raw[0], 1);
        assert_eq!(raw[1], 0);
        assert_eq!(raw[4], 0);
        assert_eq!(raw[5], 1);
    }

    #[test]
    fn invalid_chunk_coordinates_are_rejected() {
        let err = build_chunk_payload(&map_4x4(), MapChunkRequest {
            chunk_x: 9,
            chunk_y: 0,
            layer: MapWorkbenchLayer::Height,
            zoom_bucket: 0,
            include_numeric_payload: false,
        }, 2).unwrap_err();
        assert!(err.to_string().contains("Invalid chunk"));
    }
}
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```powershell
Set-Location -LiteralPath 'E:\gamedev\pko-tools\src-tauri'
cargo test map::workbench -- --nocapture
```

Expected: FAIL because types and functions such as `MapWorkbenchLayer`, `build_manifest`, `SourceFileInfo`, `inspect_tile`, `MapChunkRequest`, and `build_chunk_payload` do not exist yet.

- [ ] **Step 3: Implement DTOs and decoding helpers**

In `src-tauri/src/map/workbench.rs`, add the public DTOs used by tests and commands. Use `serde::{Serialize, Deserialize}` and keep enum wire names snake_case.

```rust
use anyhow::{anyhow, Result};
use base64::prelude::BASE64_STANDARD;
use base64::Engine;
use image::{ImageBuffer, ImageFormat, Rgba};
use serde::{Deserialize, Serialize};
use std::io::Cursor;

use super::terrain::{decode_obj_height, get_tile, rgb565_to_float, tile_height, ParsedMap};
use super::MapPlacementRecord;

pub const DEFAULT_CHUNK_SIZE: i32 = 128;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MapWorkbenchLayer {
    TerrainColor,
    TextureBase,
    TextureLayers,
    Height,
    Collision,
    ObjectHeight,
    Region,
    Island,
    Placements,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceFileInfo {
    pub map_modified_ms: u64,
    pub map_file_len: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MapWorkbenchManifest {
    pub name: String,
    pub width: i32,
    pub height: i32,
    pub section_width: i32,
    pub section_height: i32,
    pub section_count_x: i32,
    pub section_count_y: i32,
    pub total_sections: u32,
    pub non_empty_sections: u32,
    pub chunk_size: i32,
    pub chunk_count_x: i32,
    pub chunk_count_y: i32,
    pub available_layers: Vec<MapWorkbenchLayer>,
    pub placement_count: u32,
    pub coordinate_system: String,
    pub source: SourceFileInfo,
    pub recommended_overview_max_size: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MapChunkRequest {
    pub chunk_x: i32,
    pub chunk_y: i32,
    pub layer: MapWorkbenchLayer,
    pub zoom_bucket: u8,
    pub include_numeric_payload: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MapChunkPayload {
    pub chunk_x: i32,
    pub chunk_y: i32,
    pub layer: MapWorkbenchLayer,
    pub tile_x: i32,
    pub tile_y: i32,
    pub tile_width: i32,
    pub tile_height: i32,
    pub sample_width: u32,
    pub sample_height: u32,
    pub image_data_uri: String,
    pub numeric_format: Option<String>,
    pub numeric_payload: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MapOverviewLayer {
    pub layer: MapWorkbenchLayer,
    pub map_width: i32,
    pub map_height: i32,
    pub sample_width: u32,
    pub sample_height: u32,
    pub image_data_uri: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MapNativeTileFields {
    pub dw_tile_info: u32,
    pub bt_tile_info: u8,
    pub s_color: i16,
    pub c_height: i8,
    pub s_region: i16,
    pub bt_island: u8,
    pub bt_block: [u8; 4],
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MapTextureLayerInfo {
    pub slot: u8,
    pub texture_id: u8,
    pub alpha: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MapSubtileInspection {
    pub index: u8,
    pub blocked: bool,
    pub raw: u8,
    pub object_height: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MapTileInspection {
    pub tile_x: i32,
    pub tile_y: i32,
    pub section_x: i32,
    pub section_y: i32,
    pub local_x: i32,
    pub local_y: i32,
    pub native: MapNativeTileFields,
    pub texture_layers: Vec<MapTextureLayerInfo>,
    pub color_rgb: [u8; 3],
    pub terrain_height: f32,
    pub region_flags: Vec<String>,
    pub island: u8,
    pub subtiles: Vec<MapSubtileInspection>,
    pub nearby_placements: Vec<MapPlacementRecord>,
}
```

- [ ] **Step 4: Implement pure functions**

Implement:

```rust
pub fn build_manifest(
    map: &ParsedMap,
    name: &str,
    chunk_size: i32,
    placement_count: usize,
    source: SourceFileInfo,
) -> MapWorkbenchManifest

pub fn build_overview_layer(
    map: &ParsedMap,
    layer: MapWorkbenchLayer,
    max_size: u32,
) -> Result<MapOverviewLayer>

pub fn build_chunk_payload(
    map: &ParsedMap,
    request: MapChunkRequest,
    chunk_size: i32,
) -> Result<MapChunkPayload>

pub fn inspect_tile(
    map: &ParsedMap,
    tile_x: i32,
    tile_y: i32,
    placements: &[MapPlacementRecord],
) -> Result<MapTileInspection>

pub fn placements_in_bounds(
    placements: &[MapPlacementRecord],
    min_x: f32,
    min_y: f32,
    max_x: f32,
    max_y: f32,
    limit: usize,
) -> Vec<MapPlacementRecord>
```

Use these helper rules:

```rust
fn div_ceil_i32(value: i32, divisor: i32) -> i32 {
    (value + divisor - 1) / divisor
}

fn rgb565_bytes(color: i16) -> [u8; 3] {
    let (r, g, b) = rgb565_to_float(color);
    [
        (r * 255.0).round().clamp(0.0, 255.0) as u8,
        (g * 255.0).round().clamp(0.0, 255.0) as u8,
        (b * 255.0).round().clamp(0.0, 255.0) as u8,
    ]
}

fn region_flags(region: i16) -> Vec<String> {
    let bits = region as u16;
    let mut flags = Vec::new();
    if bits & 0x0001 != 0 { flags.push("land".to_string()); }
    if bits & 0x0002 != 0 { flags.push("safe".to_string()); }
    if bits & 0x0008 != 0 { flags.push("bridge".to_string()); }
    if bits & 0x0010 != 0 { flags.push("no_monster".to_string()); }
    if bits & 0x0020 != 0 { flags.push("mining".to_string()); }
    if bits & 0x0040 != 0 { flags.push("pvp_invite".to_string()); }
    flags
}
```

Texture layer decoding must match `TileInfo_5To8` from the PKO client source:

```rust
fn decode_texture_layers(bt_tile_info: u8, dw_tile_info: u32) -> Vec<MapTextureLayerInfo> {
    vec![
        MapTextureLayerInfo { slot: 0, texture_id: bt_tile_info, alpha: 15 },
        MapTextureLayerInfo { slot: 1, texture_id: ((dw_tile_info >> 26) & 0x3f) as u8, alpha: ((dw_tile_info >> 22) & 0x0f) as u8 },
        MapTextureLayerInfo { slot: 2, texture_id: ((dw_tile_info >> 16) & 0x3f) as u8, alpha: ((dw_tile_info >> 12) & 0x0f) as u8 },
        MapTextureLayerInfo { slot: 3, texture_id: ((dw_tile_info >> 6) & 0x3f) as u8, alpha: ((dw_tile_info >> 2) & 0x0f) as u8 },
    ]
}
```

Render layer payloads as RGBA PNGs with the `image` crate. Numeric payloads should be base64 raw bytes:

- `TextureBase`, `Region`, `Island`, `Height`: one sample per tile.
- `Collision`, `ObjectHeight`: two samples per tile in each dimension.
- `TerrainColor`: one sample per tile.
- `TextureLayers`: one sample per tile using exact decoded texture ids and alpha fields; visual color may be palette-based, but inspection/numeric payload must preserve decoded values.
- `Placements`: return a transparent image from chunk payloads; placement geometry is fetched separately.

- [ ] **Step 5: Expose `tile_height` inside the crate**

Modify `src-tauri/src/map/terrain.rs`:

```rust
-fn tile_height(tile: &MapTile) -> f32 {
+pub(crate) fn tile_height(tile: &MapTile) -> f32 {
```

- [ ] **Step 6: Register module exports**

Modify `src-tauri/src/map/mod.rs`:

```rust
pub mod workbench;
```

No re-export is required unless command imports become noisy.

- [ ] **Step 7: Run focused tests and make them GREEN**

Run:

```powershell
Set-Location -LiteralPath 'E:\gamedev\pko-tools\src-tauri'
cargo test --lib map::workbench -- --nocapture
```

Expected: PASS. If failures expose bit/coordinate mistakes, fix the pure functions before moving on.

- [ ] **Step 8: Commit Task 1**

Run:

```powershell
Set-Location -LiteralPath 'E:\gamedev\pko-tools'
git add -- src-tauri/src/map/workbench.rs src-tauri/src/map/mod.rs src-tauri/src/map/terrain.rs
git commit -m "feat: add chunked map workbench data layer"
```

---

### Task 2: Backend Tauri Commands and Parsed Map Cache

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/map/commands.rs`

- [ ] **Step 1: Add failing command/cache tests where practical**

Add pure helper tests to `src-tauri/src/map/commands.rs` for source metadata key construction and placement bounds pagination. Put cache key helpers in normal code so they can be tested without Tauri state.

```rust
#[cfg(test)]
mod workbench_command_tests {
    use super::*;

    #[test]
    fn source_file_info_uses_len_and_modified_ms() {
        let info = source_file_info_from_parts(1234, Some(std::time::UNIX_EPOCH + std::time::Duration::from_millis(5678)));
        assert_eq!(info.map_file_len, 1234);
        assert_eq!(info.map_modified_ms, 5678);
    }

    #[test]
    fn placement_bounds_include_min_and_exclude_max() {
        let placements = vec![
            MapPlacementRecord { index: 1, obj_type: 0, obj_id: 10, kind: "building".to_string(), world_x: 10.0, world_y: 10.0, world_z: 0.0, yaw_angle: 0, scale: 100, display_name: None, asset_name: None, attach_effect_id: None, distance: None },
            MapPlacementRecord { index: 2, obj_type: 0, obj_id: 11, kind: "building".to_string(), world_x: 20.0, world_y: 20.0, world_z: 0.0, yaw_angle: 0, scale: 100, display_name: None, asset_name: None, attach_effect_id: None, distance: None },
        ];
        let page = placement_bounds_page(&placements, 10.0, 10.0, 20.0, 20.0, 50);
        assert_eq!(page.total, 1);
        assert_eq!(page.items[0].index, 1);
    }
}
```

- [ ] **Step 2: Run command tests and confirm RED**

Run:

```powershell
Set-Location -LiteralPath 'E:\gamedev\pko-tools\src-tauri'
cargo test --lib map::commands::workbench_command_tests -- --nocapture
```

Expected: FAIL because helper functions do not exist.

- [ ] **Step 3: Add cache storage to AppState**

Modify `src-tauri/src/lib.rs` imports and `AppState`:

```rust
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

pub struct AppState {
    current_project: Option<projects::project::Project>,
    preferences: preferences::Preferences,
    pub character_gltf_cache: Mutex<HashMap<(uuid::Uuid, u32), String>>,
    pub map_placement_cache:
        Mutex<HashMap<(uuid::Uuid, String), Arc<Vec<map::MapPlacementRecord>>>>,
    pub map_workbench_cache:
        Mutex<HashMap<map::workbench::ParsedMapCacheKey, Arc<map::terrain::ParsedMap>>>,
}
```

Initialize it in setup:

```rust
map_workbench_cache: Mutex::new(HashMap::new()),
```

- [ ] **Step 4: Add cache key and command helpers**

In `src-tauri/src/map/workbench.rs`, add:

```rust
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ParsedMapCacheKey {
    pub project_id: uuid::Uuid,
    pub map_name: String,
    pub modified_ms: u64,
    pub file_len: u64,
}
```

In `src-tauri/src/map/commands.rs`, add helpers:

```rust
fn source_file_info_from_parts(file_len: u64, modified: Option<std::time::SystemTime>) -> super::workbench::SourceFileInfo {
    let map_modified_ms = modified
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0);
    super::workbench::SourceFileInfo {
        map_modified_ms,
        map_file_len: file_len,
    }
}

fn source_file_info(path: &std::path::Path) -> Result<super::workbench::SourceFileInfo, String> {
    let metadata = std::fs::metadata(path).map_err(|e| e.to_string())?;
    Ok(source_file_info_from_parts(metadata.len(), metadata.modified().ok()))
}

fn placement_bounds_page(
    placements: &[MapPlacementRecord],
    min_x: f32,
    min_y: f32,
    max_x: f32,
    max_y: f32,
    limit: u32,
) -> MapPlacementPage {
    let limit = limit.clamp(1, 5000) as usize;
    let (total, filtered) = super::workbench::placements_in_bounds_with_total(placements, min_x, min_y, max_x, max_y, limit);
    MapPlacementPage {
        total: total as u32,
        offset: 0,
        limit: limit as u32,
        items: filtered,
    }
}
```

- [ ] **Step 5: Add cached parsed map loader**

Add to `commands.rs`:

```rust
fn load_parsed_map_cached(
    app_state: &AppState,
    project_id: uuid::Uuid,
    project_dir: &std::path::Path,
    map_name: &str,
) -> Result<(Arc<super::terrain::ParsedMap>, super::workbench::SourceFileInfo), String> {
    let map_path = client_paths::asset_file(project_dir, "map", format!("{map_name}.map"));
    if !map_path.exists() {
        return Err(format!("Map file not found: {}", map_path.display()));
    }
    let source = source_file_info(&map_path)?;
    let cache_key = super::workbench::ParsedMapCacheKey {
        project_id,
        map_name: map_name.to_string(),
        modified_ms: source.map_modified_ms,
        file_len: source.map_file_len,
    };
    {
        let cache = app_state.map_workbench_cache.lock().map_err(|e| e.to_string())?;
        if let Some(cached) = cache.get(&cache_key) {
            return Ok((Arc::clone(cached), source));
        }
    }

    let data = std::fs::read(&map_path).map_err(|e| e.to_string())?;
    let parsed = Arc::new(super::map_loader::load_map(&data).map_err(|e| e.to_string())?);

    let mut cache = app_state.map_workbench_cache.lock().map_err(|e| e.to_string())?;
    cache.insert(cache_key, Arc::clone(&parsed));
    Ok((parsed, source))
}
```

- [ ] **Step 6: Add Tauri commands**

Add command functions to `src-tauri/src/map/commands.rs`:

```rust
#[tauri::command]
pub async fn get_map_workbench_manifest(
    app_state: State<'_, AppState>,
    project_id: String,
    map_name: String,
) -> Result<super::workbench::MapWorkbenchManifest, String>

#[tauri::command]
pub async fn get_map_overview(
    app_state: State<'_, AppState>,
    project_id: String,
    map_name: String,
    layer: super::workbench::MapWorkbenchLayer,
    max_size: Option<u32>,
) -> Result<super::workbench::MapOverviewLayer, String>

#[tauri::command]
pub async fn get_map_chunk(
    app_state: State<'_, AppState>,
    project_id: String,
    map_name: String,
    request: super::workbench::MapChunkRequest,
) -> Result<super::workbench::MapChunkPayload, String>

#[tauri::command]
pub async fn inspect_map_tile(
    app_state: State<'_, AppState>,
    project_id: String,
    map_name: String,
    tile_x: i32,
    tile_y: i32,
) -> Result<super::workbench::MapTileInspection, String>

#[tauri::command]
pub async fn query_map_placements_in_bounds(
    app_state: State<'_, AppState>,
    project_id: String,
    map_name: String,
    min_x: f32,
    min_y: f32,
    max_x: f32,
    max_y: f32,
    limit: Option<u32>,
) -> Result<MapPlacementPage, String>
```

Each command should parse `project_id`, load `Project`, call `load_parsed_map_cached`, load placements only when needed, then delegate to `workbench`.

- [ ] **Step 7: Register commands in Tauri**

Modify `src-tauri/src/lib.rs` `generate_handler!` list:

```rust
map::commands::get_map_workbench_manifest,
map::commands::get_map_overview,
map::commands::get_map_chunk,
map::commands::inspect_map_tile,
map::commands::query_map_placements_in_bounds,
```

- [ ] **Step 8: Run backend checks**

Run:

```powershell
Set-Location -LiteralPath 'E:\gamedev\pko-tools\src-tauri'
cargo test --lib map::commands::workbench_command_tests -- --nocapture
cargo test --lib map::workbench -- --nocapture
cargo check
```

Expected: both commands exit 0.

- [ ] **Step 9: Commit Task 2**

Run:

```powershell
Set-Location -LiteralPath 'E:\gamedev\pko-tools'
git add -- src-tauri/src/lib.rs src-tauri/src/map/commands.rs src-tauri/src/map/workbench.rs
git commit -m "feat: expose map workbench chunk commands"
```

---

### Task 3: Frontend Contracts, Layer State, Viewport Math, and Cache Tests

**Files:**
- Modify: `src/types/map.ts`
- Modify: `src/commands/map.ts`
- Modify: `src/store/map.ts`
- Create: `src/features/map/workbench/mapLayerTypes.ts`
- Create: `src/features/map/workbench/mapChunkMath.ts`
- Create: `src/features/map/workbench/__tests__/mapChunkMath.test.ts`
- Create: `src/features/map/workbench/__tests__/mapLayerTypes.test.ts`

- [ ] **Step 1: Write failing frontend tests**

Create `src/features/map/workbench/__tests__/mapChunkMath.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  ByteBudgetLru,
  getVisibleChunkKeys,
  pickTileFromScreen,
  screenToMap,
} from "../mapChunkMath";

describe("mapChunkMath", () => {
  it("maps screen coordinates to tile coordinates", () => {
    const point = screenToMap(
      { x: 160, y: 96 },
      { offsetX: 32, offsetY: 16, scale: 4, viewportWidth: 640, viewportHeight: 480 },
    );
    expect(point).toEqual({ x: 32, y: 20 });
    expect(pickTileFromScreen({ x: 160, y: 96 }, { offsetX: 32, offsetY: 16, scale: 4, viewportWidth: 640, viewportHeight: 480 })).toEqual({ tileX: 32, tileY: 20 });
  });

  it("computes visible chunks with prefetch and clamps to map bounds", () => {
    const keys = getVisibleChunkKeys(
      { offsetX: 128, offsetY: 128, scale: 2, viewportWidth: 256, viewportHeight: 256 },
      { width: 4096, height: 4096, chunkSize: 128, chunkCountX: 32, chunkCountY: 32 },
      1,
    );
    expect(keys[0]).toEqual({ chunkX: 0, chunkY: 0 });
    expect(keys).toContainEqual({ chunkX: 2, chunkY: 2 });
    expect(keys).not.toContainEqual({ chunkX: -1, chunkY: 0 });
  });

  it("evicts least recently used cache entries by byte budget", () => {
    const cache = new ByteBudgetLru<string>(10);
    cache.set("a", "first", 4);
    cache.set("b", "second", 4);
    expect(cache.get("a")).toBe("first");
    cache.set("c", "third", 4);
    expect(cache.get("a")).toBe("first");
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("c")).toBe("third");
  });
});
```

Create `src/features/map/workbench/__tests__/mapLayerTypes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAP_LAYER_STATE,
  enabledLayerRequests,
  mapLayerOptions,
} from "../mapLayerTypes";

describe("mapLayerTypes", () => {
  it("starts with terrain color and placements enabled", () => {
    const requests = enabledLayerRequests(DEFAULT_MAP_LAYER_STATE);
    expect(requests.map((request) => request.layer)).toEqual(["terrain_color", "placements"]);
  });

  it("serializes enabled overlay layers in draw order", () => {
    const requests = enabledLayerRequests({
      ...DEFAULT_MAP_LAYER_STATE,
      collision: { enabled: true, opacity: 0.7 },
      height: { enabled: true, opacity: 0.45 },
    });
    expect(requests.map((request) => request.layer)).toEqual([
      "terrain_color",
      "height",
      "collision",
      "placements",
    ]);
  });

  it("defines all workbench layer options", () => {
    expect(mapLayerOptions.map((option) => option.layer)).toEqual([
      "terrain_color",
      "texture_base",
      "texture_layers",
      "height",
      "collision",
      "object_height",
      "region",
      "island",
      "placements",
    ]);
  });
});
```

- [ ] **Step 2: Run frontend tests and confirm RED**

Run:

```powershell
Set-Location -LiteralPath 'E:\gamedev\pko-tools'
pnpm test:run src/features/map/workbench
```

Expected: FAIL because the new modules do not exist.

- [ ] **Step 3: Add frontend DTO types**

Modify `src/types/map.ts`:

```ts
export type MapWorkbenchLayer =
  | "terrain_color"
  | "texture_base"
  | "texture_layers"
  | "height"
  | "collision"
  | "object_height"
  | "region"
  | "island"
  | "placements";

export type MapWorkbenchManifest = {
  name: string;
  width: number;
  height: number;
  section_width: number;
  section_height: number;
  section_count_x: number;
  section_count_y: number;
  total_sections: number;
  non_empty_sections: number;
  chunk_size: number;
  chunk_count_x: number;
  chunk_count_y: number;
  available_layers: MapWorkbenchLayer[];
  placement_count: number;
  coordinate_system: string;
  source: { map_modified_ms: number; map_file_len: number };
  recommended_overview_max_size: number;
};

export type MapChunkRequest = {
  chunk_x: number;
  chunk_y: number;
  layer: MapWorkbenchLayer;
  zoom_bucket: number;
  include_numeric_payload: boolean;
};

export type MapChunkPayload = {
  chunk_x: number;
  chunk_y: number;
  layer: MapWorkbenchLayer;
  tile_x: number;
  tile_y: number;
  tile_width: number;
  tile_height: number;
  sample_width: number;
  sample_height: number;
  image_data_uri: string;
  numeric_format: string | null;
  numeric_payload: string | null;
};

export type MapOverviewLayer = {
  layer: MapWorkbenchLayer;
  map_width: number;
  map_height: number;
  sample_width: number;
  sample_height: number;
  image_data_uri: string;
};

export type MapTileInspection = {
  tile_x: number;
  tile_y: number;
  section_x: number;
  section_y: number;
  local_x: number;
  local_y: number;
  native: {
    dw_tile_info: number;
    bt_tile_info: number;
    s_color: number;
    c_height: number;
    s_region: number;
    bt_island: number;
    bt_block: number[];
  };
  texture_layers: { slot: number; texture_id: number; alpha: number }[];
  color_rgb: [number, number, number];
  terrain_height: number;
  region_flags: string[];
  island: number;
  subtiles: { index: number; blocked: boolean; raw: number; object_height: number }[];
  nearby_placements: MapPlacementRecord[];
};

export type MapLayerState = Record<MapWorkbenchLayer, {
  enabled: boolean;
  opacity: number;
}>;
```

- [ ] **Step 4: Add command wrappers**

Modify `src/commands/map.ts` imports and add:

```ts
export const getMapWorkbenchManifest = async (
  projectId: string,
  mapName: string,
): Promise<MapWorkbenchManifest> => {
  return invoke("get_map_workbench_manifest", { projectId, mapName });
};

export const getMapOverview = async (
  projectId: string,
  mapName: string,
  layer: MapWorkbenchLayer,
  maxSize?: number,
): Promise<MapOverviewLayer> => {
  return invoke("get_map_overview", { projectId, mapName, layer, maxSize });
};

export const getMapChunk = async (
  projectId: string,
  mapName: string,
  request: MapChunkRequest,
): Promise<MapChunkPayload> => {
  return invoke("get_map_chunk", { projectId, mapName, request });
};

export const inspectMapTile = async (
  projectId: string,
  mapName: string,
  tileX: number,
  tileY: number,
): Promise<MapTileInspection> => {
  return invoke("inspect_map_tile", { projectId, mapName, tileX, tileY });
};

export const queryMapPlacementsInBounds = async (
  projectId: string,
  mapName: string,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  limit?: number,
): Promise<MapPlacementPage> => {
  return invoke("query_map_placements_in_bounds", {
    projectId,
    mapName,
    minX,
    minY,
    maxX,
    maxY,
    limit,
  });
};
```

- [ ] **Step 5: Add layer definitions**

Create `mapLayerTypes.ts`:

```ts
import { MapLayerState, MapWorkbenchLayer } from "@/types/map";

export const mapLayerOptions: {
  layer: MapWorkbenchLayer;
  label: string;
  drawOrder: number;
  overlay: boolean;
}[] = [
  { layer: "terrain_color", label: "Color", drawOrder: 0, overlay: false },
  { layer: "texture_base", label: "Texture", drawOrder: 10, overlay: false },
  { layer: "texture_layers", label: "Layers", drawOrder: 15, overlay: true },
  { layer: "height", label: "Height", drawOrder: 20, overlay: true },
  { layer: "collision", label: "Blocked", drawOrder: 30, overlay: true },
  { layer: "object_height", label: "Obj Height", drawOrder: 40, overlay: true },
  { layer: "region", label: "Region", drawOrder: 50, overlay: true },
  { layer: "island", label: "Island", drawOrder: 60, overlay: true },
  { layer: "placements", label: "Objects", drawOrder: 90, overlay: true },
];

export const DEFAULT_MAP_LAYER_STATE: MapLayerState = {
  terrain_color: { enabled: true, opacity: 1 },
  texture_base: { enabled: false, opacity: 1 },
  texture_layers: { enabled: false, opacity: 1 },
  height: { enabled: false, opacity: 0.55 },
  collision: { enabled: false, opacity: 0.72 },
  object_height: { enabled: false, opacity: 0.55 },
  region: { enabled: false, opacity: 0.5 },
  island: { enabled: false, opacity: 0.5 },
  placements: { enabled: true, opacity: 1 },
};

export function enabledLayerRequests(state: MapLayerState) {
  return mapLayerOptions
    .filter((option) => state[option.layer]?.enabled)
    .sort((a, b) => a.drawOrder - b.drawOrder)
    .map((option) => ({
      layer: option.layer,
      opacity: state[option.layer].opacity,
      overlay: option.overlay,
    }));
}
```

- [ ] **Step 6: Add viewport math and LRU cache helper**

Create `mapChunkMath.ts`:

```ts
export type MapViewport = {
  offsetX: number;
  offsetY: number;
  scale: number;
  viewportWidth: number;
  viewportHeight: number;
};

export type MapDimensions = {
  width: number;
  height: number;
  chunkSize: number;
  chunkCountX: number;
  chunkCountY: number;
};

export function screenToMap(point: { x: number; y: number }, viewport: MapViewport) {
  return {
    x: viewport.offsetX + point.x / viewport.scale,
    y: viewport.offsetY + point.y / viewport.scale,
  };
}

export function pickTileFromScreen(point: { x: number; y: number }, viewport: MapViewport) {
  const map = screenToMap(point, viewport);
  return {
    tileX: Math.floor(map.x),
    tileY: Math.floor(map.y),
  };
}

export function getVisibleChunkKeys(
  viewport: MapViewport,
  dims: MapDimensions,
  prefetch = 1,
) {
  const minX = Math.max(0, Math.floor(viewport.offsetX / dims.chunkSize) - prefetch);
  const minY = Math.max(0, Math.floor(viewport.offsetY / dims.chunkSize) - prefetch);
  const maxMapX = viewport.offsetX + viewport.viewportWidth / viewport.scale;
  const maxMapY = viewport.offsetY + viewport.viewportHeight / viewport.scale;
  const maxX = Math.min(dims.chunkCountX - 1, Math.floor(maxMapX / dims.chunkSize) + prefetch);
  const maxY = Math.min(dims.chunkCountY - 1, Math.floor(maxMapY / dims.chunkSize) + prefetch);
  const keys: { chunkX: number; chunkY: number }[] = [];
  for (let chunkY = minY; chunkY <= maxY; chunkY += 1) {
    for (let chunkX = minX; chunkX <= maxX; chunkX += 1) {
      keys.push({ chunkX, chunkY });
    }
  }
  return keys;
}

export class ByteBudgetLru<T> {
  private entries = new Map<string, { value: T; bytes: number }>();
  private usedBytes = 0;

  constructor(private readonly maxBytes: number) {}

  get sizeBytes() {
    return this.usedBytes;
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, bytes: number) {
    const existing = this.entries.get(key);
    if (existing) {
      this.usedBytes -= existing.bytes;
      this.entries.delete(key);
    }
    this.entries.set(key, { value, bytes });
    this.usedBytes += bytes;
    this.evict();
  }

  values() {
    return Array.from(this.entries.values()).map((entry) => entry.value);
  }

  private evict() {
    while (this.usedBytes > this.maxBytes && this.entries.size > 0) {
      const firstKey = this.entries.keys().next().value;
      const first = this.entries.get(firstKey);
      if (!first) break;
      this.entries.delete(firstKey);
      this.usedBytes -= first.bytes;
    }
  }
}
```

- [ ] **Step 7: Add store atoms**

Modify `src/store/map.ts`:

```ts
import {
  MapEntry,
  MapLayerState,
  MapMetadata,
  MapPlacementRecord,
  MapTileInspection,
  MapViewConfig,
  MapWorkbenchManifest,
} from "@/types/map";
import { DEFAULT_MAP_LAYER_STATE } from "@/features/map/workbench/mapLayerTypes";

export const mapWorkbenchManifestAtom = atom<MapWorkbenchManifest | null>(null);
export const mapLayerStateAtom = atom<MapLayerState>(DEFAULT_MAP_LAYER_STATE);
export const selectedMapTileAtom = atom<MapTileInspection | null>(null);
export const selectedMapPlacementAtom = atom<MapPlacementRecord | null>(null);
```

- [ ] **Step 8: Run frontend tests and make them GREEN**

Run:

```powershell
Set-Location -LiteralPath 'E:\gamedev\pko-tools'
pnpm test:run src/features/map/workbench
```

Expected: PASS.

- [ ] **Step 9: Commit Task 3**

Run:

```powershell
Set-Location -LiteralPath 'E:\gamedev\pko-tools'
git add -- src/types/map.ts src/commands/map.ts src/store/map.ts src/features/map/workbench
git commit -m "feat: add map workbench frontend contracts"
```

---

### Task 4: Canvas Workbench UI and Chunk Loading

**Files:**
- Create: `src/features/map/workbench/useMapChunks.ts`
- Create: `src/features/map/workbench/MapCanvas.tsx`
- Create: `src/features/map/workbench/MapLayerToolbar.tsx`
- Create: `src/features/map/workbench/MapTileInspector.tsx`
- Create: `src/features/map/workbench/MapWorkbenchShell.tsx`
- Modify: `src/features/map/MapWorkbench.tsx`
- Modify: `src/features/map/MapPlacementBrowser.tsx`

- [ ] **Step 1: Add hook/component smoke tests where low-risk**

Create one test for command request keys if `useMapChunks` exposes pure `chunkPayloadKey`.

```ts
import { describe, expect, it } from "vitest";
import { chunkPayloadKey } from "../useMapChunks";

describe("useMapChunks", () => {
  it("builds stable chunk payload keys", () => {
    expect(chunkPayloadKey("garner", "terrain_color", 3, 4, 1)).toBe("garner:terrain_color:3:4:1");
  });
});
```

Run:

```powershell
Set-Location -LiteralPath 'E:\gamedev\pko-tools'
pnpm test:run src/features/map/workbench
```

Expected: FAIL because `useMapChunks` does not exist.

- [ ] **Step 2: Implement chunk hook**

Create `useMapChunks.ts` with:

- `chunkPayloadKey(mapName, layer, chunkX, chunkY, zoomBucket)`
- `estimatePayloadBytes(payload)`
- `useMapChunks({ projectId, mapName, manifest, viewport, layerState })`

Behavior:

- Use `getVisibleChunkKeys` with prefetch 1.
- Use `enabledLayerRequests`.
- Skip `placements` because it is loaded through `queryMapPlacementsInBounds`.
- Keep a `ByteBudgetLru<MapChunkPayload>` in a ref with a 128 MiB budget.
- Use a monotonically increasing request version to ignore stale responses.
- Return `{ chunks, loadingCount, error }`.

- [ ] **Step 3: Implement layer toolbar**

Create `MapLayerToolbar.tsx`:

- Use `mapLayerStateAtom`.
- Render compact toggle buttons for `mapLayerOptions`.
- Use button text labels from options.
- Add opacity range inputs for enabled overlay layers.
- Keep button heights stable (`h-8`) and use small text.

- [ ] **Step 4: Implement tile inspector**

Create `MapTileInspector.tsx`:

- Props: `manifest`, `metadata`, `selectedTile`, `selectedPlacement`, `placementSummary`, `onClearTile`.
- Tabs can be simple segmented buttons: `Tile`, `Placement`, `Map`.
- Tile tab lists native and decoded fields in dense rows.
- Placement tab shows selected `.obj` record fields.
- Map tab shows dimensions, sections, chunks, loaded layers, object count, and native source/export status.

- [ ] **Step 5: Implement canvas renderer**

Create `MapCanvas.tsx`:

- Props: `projectId`, `mapName`, `manifest`, `overview`, `selectedTile`, `selectedPlacement`, `onTileSelect`, `onPlacementSelect`.
- Internal viewport refs: `offsetX`, `offsetY`, `scale`, `viewportWidth`, `viewportHeight`; use requestAnimationFrame to draw interaction frames without committing every pan/zoom movement to React state.
- Use `ResizeObserver` to track canvas CSS size.
- Draw order:
  1. Clear background.
  2. Draw overview image stretched to map dimensions.
  3. Draw loaded chunk images at `tile_x/tile_y/tile_width/tile_height`.
  4. Draw placement markers from bounds query.
  5. Draw grid when `scale >= 8`.
  6. Draw selected tile rectangle.
- Mouse:
  - drag pans.
  - wheel zooms around cursor, clamped from overview scale to 32 px per tile.
  - click without drag first hit-tests visible placement markers within a 10 px screen radius and calls `onPlacementSelect` when a marker is hit; otherwise it selects a tile and calls `inspectMapTile`.
- Bounds:
  - clamp viewport to map extent.
  - do not pan outside map more than a small margin.

- [ ] **Step 6: Implement shell around the native canvas workbench**

Create `MapWorkbenchShell.tsx`:

- Load manifest and overview on map change.
- Keep maps in the native canvas workbench. Do not preserve the removed terrain viewer path as a fallback mode.
- Render:
  - left/center `MapCanvas`
  - top-left `MapLayerToolbar`
  - right side `MapTileInspector`
  - right side lower/alternate `MapPlacementBrowser`
- Synchronize selected placement through `selectedMapPlacementAtom`.
- Keep `PerfOverlay` if practical, scoped to native canvas workbench performance.

Modify `src/features/map/MapWorkbench.tsx`:

```tsx
import MapWorkbenchShell from "./workbench/MapWorkbenchShell";

export default function MapWorkbench() {
  return <MapWorkbenchShell />;
}
```

- [ ] **Step 7: Update placement browser synchronization**

Modify `MapPlacementBrowser.tsx` props:

```ts
export default function MapPlacementBrowser({
  onSelectPlacement,
  selectedPlacement,
  compact = false,
}: {
  onSelectPlacement: (placement: MapPlacementRecord | null) => void;
  selectedPlacement: MapPlacementRecord | null;
  compact?: boolean;
})
```

Add an effect:

```ts
useEffect(() => {
  setSelectedIndex(selectedPlacement?.index ?? null);
}, [selectedPlacement?.index]);
```

Use `compact` to reduce header text but do not remove search, filters, or paging.

- [ ] **Step 8: Run tests and frontend build**

Run:

```powershell
Set-Location -LiteralPath 'E:\gamedev\pko-tools'
pnpm test:run src/features/map/workbench
pnpm build
```

Expected: both exit 0.

- [ ] **Step 9: Commit Task 4**

Run:

```powershell
Set-Location -LiteralPath 'E:\gamedev\pko-tools'
git add -- src/features/map/MapWorkbench.tsx src/features/map/MapPlacementBrowser.tsx src/features/map/workbench src/store/map.ts src/types/map.ts src/commands/map.ts
git commit -m "feat: add chunked map workbench UI"
```

---

### Task 5: Integration Verification, Agent Reviews, and Fixes

**Files:**
- Modify files only as required by review/verification findings.

- [ ] **Step 1: Run full focused verification**

Run:

```powershell
Set-Location -LiteralPath 'E:\gamedev\pko-tools\src-tauri'
cargo test --lib map::workbench -- --nocapture
cargo test --lib map::commands::workbench_command_tests -- --nocapture
cargo test --lib map::terrain -- --nocapture
cargo check
```

Run:

```powershell
Set-Location -LiteralPath 'E:\gamedev\pko-tools'
pnpm test:run src/features/map/workbench
pnpm build
```

Expected: all commands exit 0. Fix any failures before review.

- [ ] **Step 2: Start the dev server for manual UI verification**

Run:

```powershell
Set-Location -LiteralPath 'E:\gamedev\pko-tools'
pnpm tauri dev
```

Open `/maps` in the in-app browser or a local browser. Verify:

- selecting a map opens the workbench surface.
- overview appears before chunks finish.
- panning/zooming stays responsive.
- layer toggles change the canvas.
- selecting a tile populates native/decoded inspector fields.
- selecting a placement from the map/browser synchronizes selection.
- no map glTF/GLB terrain view or export path is exposed; maps stay in the native workbench flow.

Record actual notes in the final implementation summary. If no large map data is available locally, state that and verify with synthetic/backend tests plus any available map.

- [ ] **Step 3: Request agent spec compliance review**

Dispatch a review agent with:

- Spec: `docs/superpowers/specs/2026-05-18-map-workbench-data-substrate-design.md`
- Plan: `docs/superpowers/plans/2026-05-18-map-workbench-data-substrate.md`
- Diff range: from commit `91973d7` to current `HEAD`
- Ask for missing requirements, incorrect scope, or acceptance criteria gaps.

Fix Critical and Important findings before code quality review.

- [ ] **Step 4: Request agent code quality review**

Dispatch a second review agent with:

- Current diff range.
- Focus: Rust correctness, cache safety, Tauri serialization names, frontend memory/performance, stale request handling, UI layout regressions, and tests.

Fix Critical and Important findings. Document any Minor findings not fixed.

- [ ] **Step 5: Run final verification after fixes**

Run the same commands from Step 1 again. Only claim completion for this slice if the fresh output confirms success.

- [ ] **Step 6: Commit review fixes**

If review or verification changed files, commit them:

```powershell
Set-Location -LiteralPath 'E:\gamedev\pko-tools'
git add -- .
git commit -m "fix: tighten map workbench implementation"
```

Do not commit unrelated user changes if the worktree contains files outside this slice.
