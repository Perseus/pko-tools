**Verdict**
The plan is directionally correct, but it is not complete enough to implement safely. You are missing several parity-critical behaviors and one major architectural mismatch (`parse_animations=false` cannot currently be honored with the generated parser shape).

**What’s Solid**
- Replacing the hand-written parser with a Kaitai adapter is the right long-term move.
- Keeping `LmoModel` as the stable domain boundary is correct.
- Dual-backend rollout via `PKO_LMO_PARSER` is the right migration strategy.
- Calling out version branches (`0`, `0x1004`, `0x1005`) is necessary and correct.

**Critical Gaps**
- `parse_animations=false` is not actually supported by the current generated model.
  - In `geometry_chunk`, `anim` is in `seq`, so it is eagerly parsed whenever `anim_size > 0`.
  - Your loader flag only controls adaptation, not parsing cost/failure surface.
- Module wiring in the plan is underspecified and likely wrong.
  - Generated files are under `src-tauri/gen/kaitai`, not `src-tauri/src/gen`.
  - `mod gen;` in `lib.rs` will fail unless you add explicit `#[path = "../gen/..."]`.
- Native parser behavior is intentionally tolerant; Kaitai defaults are stricter.
  - Native skips non-geometry objects silently.
  - Generated `object_entry.type` has validation `any-of [1,2]`, so unknown object types hard-fail root parsing.
- Plan does not include parity for native quirks that materially affect output:
  - mesh-level alpha-test promotion to materials
  - old material alpha overrides (`ALPHAREF=129`, `ALPHAFUNC=GREATER`)
  - first texcoord channel only
  - legacy header detection behavior differences (`exact` vs Kaitai’s current `<=` plausibility)

**Kaitai Runtime Risks (0.1.2)**
- `kaitai` Rust runtime is niche and old; treat as high-risk dependency.
- Generated code uses heavy `Rc<RefCell<...>>` and `Weak` upgrade/unwrap patterns.
  - If root ownership is mishandled, runtime panics are possible.
- Error type mismatch (`KResult/KError` vs `anyhow`) needs explicit mapping with context.
- Memory overhead is non-trivial: object bodies are copied into `*_raw` buffers and reparsed from `BytesReader`.

**RefCell/Rc Pitfalls You Must Design Around**
- Do not hold long-lived `Ref<'_, T>` borrows while traversing children.
- Clone/copy primitive data out immediately; keep borrow scopes tiny.
- Keep root object alive through full adaptation pass.
- Never assume `OptRc<T>` is always present; handle `None` and `KError` per object.

**Phasing Issues**
- Current phase order is too optimistic.
- “Remove fallback and make Kaitai default” should not be in the initial implementation plan.
- You need a shadow phase with differential testing and telemetry before default switch.

**Recommended Revised Plan**
1. Add compile-only integration first.
   - Wire generated module via explicit `#[path]`.
   - Pin runtime version exactly (`=0.1.2`) to avoid drift.
2. Build adapter for core geometry/material/mesh only (no animations).
   - Keep fallback active.
   - Add strict per-object error context.
3. Add parity behaviors from native parser quirks.
   - Alpha promotion, old-version overrides, texcoord channel selection.
4. Add animation adaptation.
   - Either accept eager parse cost, or change `.ksy` so animation is lazily parsed/kept raw.
5. Differential test suite on real corpus.
   - Compare both backends object-by-object with float tolerance.
   - Include known bad files (e.g., prior blend-info failures, v0 legacy headers).
6. Rollout.
   - Keep native fallback for at least one release behind env toggle.
   - Switch default only after corpus pass and no regressions in export paths.

**Testing Additions You Need**
- Golden corpus across all 3 versions.
- Property-level parity tests for:
  - material alpha/cull/blend extraction
  - subset/index/vertex counts
  - animation frame counts and matrix decomposition output
- Failure-mode tests:
  - unknown object type in table
  - malformed section sizes
  - partial-parse recovery parity with native behavior

**Bottom Line**
Do it, but not with the current plan as-is. The adapter concept is right; the implementation plan needs explicit handling of parser strictness, animation parse semantics, and native behavior quirks before it is safe to ship.
