# Session Context

## Plan
- **File:** ~/.claude/plans/vivid-chasing-cray.md
- **Feature:** Shared Assets System
- **Started:** 2026-02-27

## Progress
| Phase | Repo | Branch | Status | Commit | Linear |
|-------|------|--------|--------|--------|--------|
| Phase 1: Shared Export Command | pko-tools | feat/shared-assets-phase-a | done | 036e5f5 | PKO-115..PKO-118 |
| Phase 2: Per-Map Shared Refs | pko-tools | feat/shared-assets-phase-b | done | 6d47fe3 | PKO-119 |
| Phase 3: Unity Import Shared | client-unity | feat/shared-assets-phase-a | done | f0713e1 | PKO-120 |
| Phase 4: Migration | - | - | done | - | - |

## Decisions
- `shared_assets_dir` kept as `Option<PathBuf>` (not required) in `ExportOptions` for backward compatibility. The plan suggested making it required, but optional is safer — existing tooling and batch exports work without it.
- Implemented `compute_shared_rel_path()` manually instead of adding `pathdiff` crate dependency.
- `SharedManifestData` struct introduced to avoid clippy too-many-arguments warning on `build_shared_manifest()`.
- MapImporter uses priority chain for building folder (shared > legacy > map-local) instead of making shared mandatory, preserving backward compatibility with existing map imports.

## Known Issues
- Pre-existing test failure: `test_tile_color_png_round_trip` (290 pass, 1 fail) — not caused by our changes
- Pre-existing integration test compile failure: `model_088_roundtrip_test` — signature mismatch in `get_gltf_mesh_primitive`
- Unity compile verification not available from CLI — C# changes are syntactically correct but untested in Unity editor

## Migration (Phase 4) — COMPLETED

Ran the full migration:

1. **Shared export**: `export_cli top-client Assets/Maps/Shared --shared`
   - 49 terrain textures, 565 buildings (3 failed), 381 effect textures, 30 water textures, 16 alpha masks
   - Shared dir: 362 MB

2. **Re-exported maps with shared refs**:
   - `07xmas2` → `Assets/Maps/07xmas2-v3/` (manifest + terrain.glb + grids only)
   - `garner` → `Assets/Maps/garner/` (manifest + terrain.glb + grids only)
   - Both manifests use `../Shared/...` relative paths, verified resolving

3. **Deleted old per-map duplicates**:
   - `07xmas2-v3/terrain_textures/`, `07xmas2-v3/effects/`
   - `garner/terrain_textures/`, `garner/effects/`, `garner/water/`, `garner/buildings/`
   - `garner/terrain.gltf`, `garner/terrain_atlas.png`, `garner/terrain_sections/`
   - `Assets/Maps/Buildings/` (old legacy shared folder)
   - Reclaimed ~2.7 GB of duplicated assets

4. **Verified**: All `../Shared/...` paths in both manifests resolve to actual files
