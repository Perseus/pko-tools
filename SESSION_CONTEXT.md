# Session Context

## Plan
- **File:** ~/.claude/plans/lexical-snacking-bumblebee.md
- **Linear Parent:** [PKO-121](https://linear.app/pko-new/issue/PKO-121) — Fix: DXT1 textures losing alpha channel in LMO→GLB export
- **Started:** 2026-02-28T15:11Z

## Progress
| Phase | Branch | Linear | Status | Commit |
|-------|--------|--------|--------|--------|
| Phase A: Add dep + decode helper | feat/dxt1-alpha-phase-a | PKO-122 | done | 0037b6c |
| Phase B: Update scene_model.rs | feat/dxt1-alpha-phase-b | PKO-123 | done | 338e973 |
| Phase C: Fix item/model.rs | feat/dxt1-alpha-phase-c | PKO-124 | done | 26499a0 |
| Phase D: Regression tests | feat/dxt1-alpha-phase-d | PKO-125 | done | e5c588b |
| Phase E: Documentation | feat/dxt1-alpha-phase-e | PKO-126 | done | (this commit) |

## Decisions
- **Other texture sites left unchanged:** `shared.rs`, `texture.rs`, `terrain.rs`, and `effect/commands.rs` also use `image::load_from_memory` after `decode_pko_texture`. These were NOT changed because they output standalone image files (terrain PNGs, effect textures), not embedded GLB materials with alpha test. DXT1 alpha only matters for building/item materials that use `alphaMode: Mask`. If needed later, they can be migrated to `decode_dds_with_alpha()`.
- **BGRA byte order:** `texture2ddecoder` outputs u32 pixels where LE bytes = [B,G,R,A]. We swap to [R,G,B,A] for `image::RgbaImage`.
- **texture2ddecoder v0.1 (latest):** Used v0.1.2 instead of the plan's suggested v0.0.5. Pure Rust, no-std, same API.

## Known Issues
- Pre-existing test failure: `test_tile_color_png_round_trip` (not caused by our changes)
- Pre-existing: `model_088_roundtrip_test` signature mismatch (not caused by our changes)
