# LMO Round-Trip Implementation Session

## Current Status: Phase 2 Complete

## Completed

### Phase 1: Enhanced LMO Parser (Store All Data)
- Extended `LmoGeomObject` with: `rcci`, `state_ctrl`, `fvf`, `pt_type`, `bone_infl_factor`, `vertex_element_num`, `vertex_elements_blob`, `mesh_rs_set`, `helper_blob`, `raw_anim_blob`, `mtl_format_version`
- Extended `LmoMaterial` with: `specular`, `emissive`, `power`, `transp_type`, `rs_set`, `tex_infos` (full 4-slot texture info array)
- Created `LmoTexInfo` struct with all D3D texture metadata (stage, level, usage, format, pool, dimensions, colorkey, tss_set)
- Created `RenderStateAtom` struct (state + value0 + value1) with Serialize/Deserialize
- Created `NonGeomEntry` struct to preserve non-geometry header entries (type=2 helpers)
- Added `MtlFormatVersion` enum made public with Serialize/Deserialize
- Added `LmoMaterial::new_simple()` constructor for backward-compatible creation
- Made FVF constants and version constants public for use by writer
- Updated parser to read all previously-skipped fields instead of seeking past them
- Helper section stored as raw byte blob
- Animation section stored as raw byte blob + decomposed data for glTF visualization
- Old-format material/mesh render state sets (128 bytes) repacked into RenderStateAtom vectors
- Updated `scene_model.rs` tests to use new struct fields
- All 30 existing tests pass (16 lmo + 14 scene_model)

### Phase 2: LMO Writer
- Created `src-tauri/src/map/lmo_writer.rs` with `write_lmo()` function
- Size computation: `compute_mtl_size()`, `compute_mesh_size()` for header size fields
- Per-section writers: materials (with full tex_infos), mesh (FVF-aware), helpers (blob), animation (blob)
- Always outputs v0x1005 format (old versions silently upgraded)
- Animation blob normalization: `normalize_anim_blob()` converts v0/v0x1004 blobs to v0x1005 internal layout
- Vertex elements stored as raw blob (`vertex_elements_blob`) for pass-through
- Non-geometry entries (type=2 helpers) written after geometry objects
- 14 tests: 12 synthetic round-trip + 2 real-data round-trip (by-bd013.lmo animated building)
- All 59 map module tests pass

## Next: Phase 3 — Enhanced glTF Export (with PKO Extras)

## Decisions Made
- Old format render state sets (128 bytes = lwRenderStateValue[2][8]) are repacked into 8 RenderStateAtom entries with value1=0, losing the second set of values. This is acceptable since the writer always outputs v0x1005 format.
- `LmoModel` now stores `non_geom_entries` for global helper entries in the header table.
- Made key constants `pub` for the writer module to use.
- Animation blobs from v0/v0x1004 files are normalized to v0x1005 format during parsing. This means mtlopac_size[16] (64 bytes of zeros) is inserted between data_mat_size and texuv_size, and for v0 the old_version prefix is stripped.
- Vertex elements stored as raw blob rather than parsed D3DVertexElement9 entries, for simpler pass-through.

## Known Issues
- None
