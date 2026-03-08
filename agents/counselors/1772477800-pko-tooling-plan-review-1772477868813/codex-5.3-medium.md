**Verdict**
The plan is directionally right, but it is not execution-safe yet. It under-specifies schema stability, test data strategy, and rollout granularity. If you run it as written, Phase 1A will sprawl and likely stall on serialization edge cases.

**1) Completeness Gaps**
- Missing explicit JSON schema contract per format.
- Missing fixture curation plan for test files (small/medium/hostile/corrupt variants).
- Missing failure-mode spec: parse error shape, exit codes, stderr conventions.
- Missing performance constraints for large files (`--summary` is listed, but no memory/streaming policy).
- Missing policy for binary blobs (`Vec<u8>`) and huge arrays in output.
- Missing compatibility/versioning strategy for golden outputs (format drift will create noisy diffs).
- Missing ownership map: which module owners handle which `Serialize` additions.
- Missing Linear issue decomposition in the plan itself.

**2) Ordering & Dependencies (What to move)**
- Move a new **Phase 0: Output Contract + Fixtures** before any `Serialize` work.
- Phase 1A should start with 1-2 formats only (`lab`, `obj`) to validate architecture, then fan out.
- Defer `--section` until after baseline full JSON + `--summary` exists.
- Build golden oracle framework immediately after first 2 formats, not after all formats.
- Source reference DB can run in parallel, but it should not block CLI shipping.

**3) Biggest Risks**
- `Serialize` explosion across ~36 types becomes a long tail.
- cgmath newtype wrappers and matrix layout ambiguity (row-major vs column-major confusion).
- `serde_json` failure on non-finite floats (NaN/inf) in parsed data.
- Golden snapshot brittleness if key ordering/float formatting is unstable.
- Output size and runtime for mesh-heavy files without summary/field filtering discipline.
- Mixed concerns in one binary: parser correctness vs UX options vs schema design.

**4) Better/Simpler Alternatives**
- Introduce dedicated DTO/view structs for inspector output instead of serializing domain types directly everywhere.
- Start with a minimal “inspector core”:
  - `format`, `version`, `header`, `counts`, `warnings`
  - optional `details` behind `--full`
- Use deterministic snapshot format:
  - stable key ordering
  - normalized float precision where appropriate
- For raw bytes, output metadata by default (`len`, `sha256`) and gate full dump via `--include-raw`.
- Use `clap` unless binary size/startup is truly critical; manual parsing is usually false economy.

**5) Incremental Delivery (Linear/commits/PRs/tests each phase)**
Current plan does not sufficiently enforce this. Add explicit delivery slices:

1. Linear epic + child issues per format and per infra component.
2. PR 1: contract + fixtures + smoke test harness.
3. PR 2: `pko-inspect lab|obj` + integration tests.
4. PR 3: serialization foundation (math + d3d + shared DTOs).
5. PR 4+: one format per PR (`lmo`, `lgo`, `map`, `eff`, `lit`) each with tests + golden snapshots.
6. PR N: `--section`, `--summary`, docs, skill wiring.

Each PR must include:
- tests green
- at least one golden snapshot update
- Linear issue linked in title/body
- changelog note for output schema changes

**6) Serialize Strategy for ~36 Types**
The approach is workable, but direct derive on domain types is the main trap.

- cgmath wrappers: manual `Serialize` is correct, but define canonical field names and matrix layout once.
- `repr(u32)` enums: derive is fine, but decide now: serialize as numeric, string, or both.
- Generic const types (`RenderStateSetTemplate`): likely derivable, but test compile on all used instantiations.
- `Vec<u8>` fields: do not dump raw by default.
- Custom `BinRead` types: usually orthogonal, but validate no hidden non-serializable internals.
- Add compile-time gate tests: “all inspector-exposed types serialize”.
- Add runtime tests for NaN/inf handling and large payload behavior.

**Recommended revised phasing**
1. Contract + fixtures + harness.
2. Minimal CLI + 2 formats + tests.
3. Serialization infra (DTOs, wrappers, blob policy).
4. Remaining formats one-by-one, each with golden refs.
5. Skills + source DB integration after CLI is reliable.

This sequencing will keep momentum, preserve small PRs, and avoid a Phase-1A serialization swamp.
