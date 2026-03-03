# Session Context

## Plan
- **File:** (inline plan — Fix Effect Geometry/State Parity, TDD)
- **Branch:** feat/effect-geom-parity-phase-5
- **Started:** 2026-03-03
- **Completed:** 2026-03-03

## Progress
| Phase | Branch | Status | Commit |
|-------|--------|--------|--------|
| Phase 1: Write Failing Tests | feat/effect-geom-parity-phase-1 | done | 2ce5d05 |
| Phase 2: Fix Geometry (Bugs 2,3,5,6) | feat/effect-geom-parity-phase-2 | done | ba5bf9d |
| Phase 3: Fix Zero-Scale (Bug 1) | feat/effect-geom-parity-phase-3 | done | f77d6e9 |
| Phase 4: Fix Technique Address (Bug 4) | feat/effect-geom-parity-phase-4 | done | fed2118 |
| Phase 5: Corpus Sweep + Verification | feat/effect-geom-parity-phase-5 | done | (this commit) |

## Decisions
1. **Kept `triangleZ` in GeometryConfig type union** — dead variant (nothing maps to it anymore), but removing it is unnecessary churn. Can clean up later.
2. **createCylinderGeometry wraps THREE.CylinderGeometry** — applies rotateX(-π/2) + translateZ(h/2) to convert Y-axis to Z-axis with base at Z=0. This is simpler than building vertices from scratch and ensures correct normals/UVs from Three.js.
3. **PivotControls scale uses Math.max(size[0], 0.01)** — prevents PivotControls from collapsing when scale is exactly 0 (the gizmo needs a minimum size to remain interactive).

## Known Issues
- Pre-existing TypeScript type errors in pkoStateEmulation.ts and other files (unrelated to this PR).
- HitSubEffect still doesn't pass frameIndex to resolveGeometry — per-frame cylinder params are not used for hit effects. This is a minor limitation.

## Corpus Sweep Results (1,152 .eff files, 2,752 sub-effects)
- Geometry: empty=1310, Cylinder=1024, .lgo models=~350, Rect=43, RectZ=19, Triangle=5, RectPlane=4, Cone=3, TrianglePlane=2, Sphere=1
- All 1,152 files use technique 0 → WRAP address mode fix is critical
- 62 zero-scale frames in corpus → || 1 fallback was affecting real effects
- Feature flags: billboard=596, rotaBoard=2250, rotaLoop=1044, useParam=77, alpha=2447

## Test Results
- **354/354** TypeScript tests pass (0 failures)
- **311/311** Rust lib tests pass (9 ignored)
