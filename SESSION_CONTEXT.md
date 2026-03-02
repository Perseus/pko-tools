# Session Context

## Plan
- **File:** `~/.claude/plans/harmonic-napping-reef.md`
- **Started:** 2026-03-02T07:49Z
- **Completed:** 2026-03-02T09:00Z
- **Linear Parent:** [PKO-136](https://linear.app/pko-new/issue/PKO-136) — Kaitai LMO Adapter: Replace Hand-Written Parser

## Progress
| Phase | Branch | Linear | Status | Commit |
|-------|--------|--------|--------|--------|
| Phase 0: Fix compile blockers | feat/kaitai-lmo-adapter-phase-a | PKO-137 | done | bed3fef |
| Phase 1: Shared utilities | feat/kaitai-lmo-adapter-phase-b | PKO-138 | done | 7286ca3 |
| Phase 2: kaitai_to_lmo adapter | feat/kaitai-lmo-adapter-phase-c | PKO-139 | done | c690f63 |
| Phase 3: No-animation path | feat/kaitai-lmo-adapter-phase-d | PKO-140 | done | 2dcc25d |
| Phase 4: Exhaustive testing | feat/kaitai-lmo-adapter-phase-e | PKO-141 | done | c94b949 |

## Decisions
1. **Kaitai runtime**: Used `kaitai-io/kaitai_struct_rust_runtime` git dep (rev 9959613) instead of `kaitai = "0.1.2"` crate (requires nightly Rust).
2. **Generated code fixes**: Applied 4 categories of post-generation patches to `pko_lmo.rs` (deref usize, type mismatches, literal overflow, arithmetic overflow).
3. **BytesReader clone bug**: `_io.pos()` returns stale position on cloned reader. Worked around in adapter by re-reading indices from raw mesh bytes for header_kind=0 files with legacy pre-index pair.
4. **load_lmo_no_animation**: Pinned to native backend for perf-critical batch path.

## Known Issues
- BytesReader clone bug in kaitai_struct_rust_runtime makes `_io.pos` unreliable in computed instances. Filed workaround in adapter, upstream fix would need shared ReaderState.
- Generated `pko_lmo.rs` requires manual post-generation patches. Documented in Phase 0 commit.

## Test Results
- **1,177/1,177** .lmo files pass exhaustive parity test (0 both-failed)
- **376** total tests pass (321 lib + 55 integration), 0 failures
