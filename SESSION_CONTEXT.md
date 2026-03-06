# Session Context

## Plan
- **File:** plans/named-animation-actions.md
- **Feature:** Named Animation Actions — split .lab animations into named clips
- **Started:** 2026-03-06
- **Completed:** 2026-03-06

## Linear Issues
| Phase | Issue | Status |
|-------|-------|--------|
| 1A: Kaitai spec for characterposeinfo.bin | PKO-163 | Done |
| 1B: Rust adapter for PoseInfo | PKO-164 | Done |
| 1C: CharacterAction.tx parser | PKO-165 | Done |
| 2: Split animation export | PKO-166 | Done |
| 3: Frontend action picker | PKO-167 | Done |
| 4: Unity import adjustments | PKO-168 | Done |
| 5: CLI integration | PKO-169 | Done |

## Progress
| Phase | Branch | Status | Commit |
|-------|--------|--------|--------|
| Phase 1A | feat/named-animation-actions-phase-1a | complete | 5b4d081 |
| Phase 1B | (same branch) | complete | 1323b25 |
| Phase 1C | (same branch) | complete | e9cb33d |
| Phase 2 | (same branch) | complete | 5737367 |
| Phase 3 | (same branch) | complete | 9d13ba0 |
| Phase 4 | client-unity/main | complete | f4641f7 |
| Phase 5 | (same branch) | complete | b46a083 |

## Decisions
1. Used single branch for all pko-tools phases (1A-3, 5) instead of separate phase branches — simpler for a continuous feature.
2. Phase 4 (Unity) committed to client-unity/main since it's a separate repo.
3. --no-split-animations flag logs a note that it's not fully implemented (auto-detect is used). Full override would require a parameter change in get_gltf_json().

## Known Issues
- --no-split-animations flag doesn't fully disable split animations when data files exist (logs a note, auto-detects anyway)
