# Session Context

## Plan
- **File:** `~/.claude/plans/harmonic-napping-reef.md`
- **Branch:** `feat/kaitai-lmo-adapter-phase-a` (from `feat/kaitai-rust-scaffold`)
- **Started:** 2026-03-02T07:49Z
- **Linear Parent:** [PKO-136](https://linear.app/pko-new/issue/PKO-136) — Kaitai LMO Adapter: Replace Hand-Written Parser

## Progress
| Phase | Branch | Linear | Status | Commit |
|-------|--------|--------|--------|--------|
| Phase 0: Fix compile blockers | feat/kaitai-lmo-adapter-phase-a | PKO-137 | in_progress | - |
| Phase 1: Shared utilities | feat/kaitai-lmo-adapter-phase-b | PKO-138 | pending | - |
| Phase 2: kaitai_to_lmo adapter | feat/kaitai-lmo-adapter-phase-c | PKO-139 | pending | - |
| Phase 3: No-animation path | feat/kaitai-lmo-adapter-phase-d | PKO-140 | pending | - |
| Phase 4: Exhaustive testing | feat/kaitai-lmo-adapter-phase-e | PKO-141 | pending | - |

## Decisions
<none yet>

## Known Issues
- `ksc` (kaitai-struct-compiler) not installed on this machine
- `gen/kaitai/` directory does not exist yet — must generate
- `.ksy` has Rust keyword conflicts: `type` and `box` used as field/type names
