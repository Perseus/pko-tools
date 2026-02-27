# Session Context

## Plan
- **File:** ~/.claude/plans/parser-parity-audit-fixes.md
- **Feature:** LMO Parser & Rendering Parity Fixes
- **Started:** 2026-02-26

## Progress
| Phase | Repo | Branch | Status | Commit |
|-------|------|--------|--------|--------|
| Phase A0: Tile color grid default | pko-tools | feat/parser-parity-phase-a0 | pending | - |
| Phase A: Lighting + alpha test | pko-tools + client-unity | feat/parser-parity-phase-a | pending | - |
| Phase B: Cull mode parsing | pko-tools | feat/parser-parity-phase-b-cull | pending | - |
| Phase C: Transp type remapping | pko-tools | feat/parser-parity-phase-c | pending | - |

## Prior Session Context
- Phase A (Quick Fixes + Semantic Pipeline): feat/building-render-phase-a → 02c2f42, 055d67a
- Phase B (Animation Infrastructure): feat/building-render-phase-b → 96250d4

## Decisions
<none yet>

## Known Issues
- Pre-existing test failure: map::grid_images::tests::test_tile_color_png_round_trip
- pko-tools has uncommitted lmo.rs changes (Phase A2 alpha test work) on feat/building-render-phase-b
- client-unity has uncommitted building GLBs and scene changes on feat/building-render-phase-d
