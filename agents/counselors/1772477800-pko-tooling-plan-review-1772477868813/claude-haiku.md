# PKO Developer Tooling Plan — Critical Review

## Summary
This is a solid foundational plan with clear phases and concrete deliverables. However, there are **significant gaps in Phase 1 definition**, **unclear incremental delivery strategy**, and **risks around the Serialize implementation** that need resolution before work begins.

---

## 1. Completeness

### ✅ What's Well-Defined
- **Phase 1A structure** is clear: add Serialize, build CLI binary, write integration tests
- **Format list** covers the main PKO file types
- **Existing pattern** (export_cli.rs) provides a concrete template
- **Type audit** (36+ types needing Serialize) is thorough

### ❌ What's Missing

**Phase 1A: Major Gaps**

1. **Error handling strategy for CLI**
   - The plan says "exit code 0" for success but doesn't specify error cases (corrupt file, missing format handler, parse failure)
   - Should define: exit codes (0=success, 1=parse error, 2=arg error, 3=file not found), stderr format (plaintext or JSON error?)
   - This affects the integration tests

2. **Serialization scope per type**
   - The plan says "serialize the inner fields" for math types but doesn't specify what that means
   - Example: `LwMatrix44` — serialize as a 4x4 nested array, or flat 16-element array, or object with row keys?
   - This needs explicit schema decisions *before* implementation to avoid rework
   - Include a few example outputs in the plan

3. **Large data handling (Vec<u8> vertex data)**
   - The plan mentions "may want `#[serde(skip)]` or base64" but doesn't decide
   - If skipped, `--summary` becomes the only way to inspect actual vertex data — that's a regression from one-shot inspection
   - If base64, JSON becomes huge for large meshes. Suggest decision: **skip raw vertex arrays by default, add `--include-raw-data` flag** for full dumps (with warning about size)

4. **Error boundaries between formats**
   - What happens if you try `pko-inspect lmo file.lgo`?
   - Should it auto-detect format, fail fast with usage hint, or try all parsers?
   - Plan doesn't specify; auto-detection adds complexity

5. **Test artifact paths**
   - Plan assumes "known test files" exist but doesn't specify where or what
   - CLAUDE.md mentions `./test_artifacts/` but plan should confirm path and which formats have test files ready
   - If test files are missing, tests will be **unit tests** (mocked), not integration tests (real binaries)

**Phase 1B: Source Database Handoff**
- "Pre-extracted topic files" — from where? Who extracts them? When in Phase 1?
- The plan lists 12 topics but doesn't describe extraction scope, format, or update strategy
- Should Phase 1B extraction be a separate step with explicit deliverables (e.g., "pko-source/*.md files in memory/, each ≤2000 lines")

**Phase 2: Validation Oracles**
- "~20 representative files" — where do they come from? Cherry-picked from test artifacts? Generated?
- How are they versioned? If parser changes legitimately improve output, who updates the golden references?
- This is **high-risk** without a decision process

**Phase 3: Skills**
- Completely hand-waved. What do `/pko-ref` and `/pko-inspect` skills actually do?
- `/pko-ref` queries the source database — via grep? Fuzzy search? Link expansion?
- `/pko-inspect` invokes the CLI — does it fetch results back to Claude or save to disk and ask user to read?
- These details affect whether Phase 3 is 1 week or 4 weeks of work

---

## 2. Ordering & Dependencies

### Current Phasing: `1A + 1B (parallel) → 2 → 3`

**Issues:**

1. **Phase 1B extraction blocks Phase 3 skills**
   - If source database topics aren't extracted until mid-Phase 1, you can't implement `/pko-ref` skill (Phase 3) until Phase 1B completes
   - Phase 3 should either start after 1B, or be split: `/pko-inspect` skill early (Phase 1A), `/pko-ref` skill late (after 1B)

2. **Validation Oracles (Phase 2) require Phase 1A output**
   - Can't create golden references without a working `pko-inspect` binary
   - **Dependency is correct**, but Phase 2 should explicitly call out "Phase 1A must be complete and tested before Phase 2 starts"

3. **Integration test data bottleneck**
   - Phase 1A tests need real files; Phase 2 validation needs those same files
   - If you build the CLI first and then realize half your test files are missing or corrupt, you're blocked
   - **Suggest:** Validate test artifact availability as a **prerequisite task** (before Phase 1A starts), not during Phase 1A Step 3

---

## 3. Risk

### High Risk

**1. Serialize implementation for math types (cgmath newtypes)**
- **The risk:** cgmath newtype wrappers have no Serialize impl. Manual impl could:
  - Diverge from how the types are actually used (are matrix rows or columns the natural unit?)
  - Create inconsistency (some types use `#[serde(serialize_with)]`, some use manual impl)
  - Break if cgmath is upgraded and the inner struct changes
- **Mitigation:**
  - Write the first 2-3 math types (LwVector3, LwMatrix44) and create a test that round-trips them: serialize → JSON → deserialize → same values
  - Document the serialization schema (e.g., "matrices are row-major 4x4 nested arrays")
  - Create a shared helper module `src-tauri/src/serde_helpers.rs` with all manual impls, not scattered in each type

**2. LwBoneFile custom BinRead impl**
- **The risk:** `LwBoneFile` uses custom `BinRead` impl, which means the struct doesn't derive `#[derive(Serialize)]` — need manual impl
- This is orthogonal but unusual; adding Serialize by hand to a type with custom BinRead is error-prone
- **Mitigation:** Write tests that:
  - Parse a real `.lab` file into `LwBoneFile`
  - Serialize to JSON
  - Inspect JSON for key fields (bone count, animation count, etc.)
  - Verify counts match the struct

**3. Missing test files = integration tests become unit tests**
- If `./test_artifacts/` is empty or incomplete, Phase 1A tests will be mocked stubs, not real integration tests
- You won't catch serialization bugs until later
- **Mitigation:** Before Phase 1A starts, audit which test files exist and which need to be added (or symlinked from `/Users/anirudh/gamedev/pko-tools/top-client/...`)

**4. Golden reference maintenance (Phase 2)**
- **The risk:** As you fix parser bugs, golden references become stale. Diff-on-mismatch is only useful if there's a process to decide "is this a regression or a legitimate fix?"
- Example: You fix a bone quaternion parsing bug. Now old golden ref doesn't match. Is that expected? Or did you introduce a new bug?
- **Mitigation:** Phase 2 should include a **decision log** (in CLAUDE.md or a separate VALIDATION.md) that documents:
  - Which files are "golden" (frozen, no known bugs)
  - Which files are "known issues" (parser bug exists, don't validate yet)
  - How to add new files to the golden set

### Medium Risk

**1. CLI output size for large meshes**
- A complex character `.lgo` file might serialize to 10–100MB JSON (vertices, normals, colors, vertex weights as arrays)
- If the binary dumps to stdout, piping to jq or writing to disk could be slow
- **Mitigation:** Add `--output <file>` flag to write directly to disk, or document recommended usage (`pko-inspect lgo file.lgo > output.json`)

**2. Format auto-detection vs. explicit format arg**
- Current plan requires explicit format arg (`pko-inspect lmo file.lmo`). This is safer but less user-friendly
- Users might forget or get wrong; auto-detection could help
- **But:** Auto-detection adds complexity (try all parsers, decide on ambiguity)
- **Mitigation:** Start with explicit format (as planned). If user feedback demands it, add auto-detection as a Phase 1 post-release improvement

**3. RenderStateSetTemplate generic const params**
- The plan says "Serialize derive should work but verify"
- This is actually a risk: if the const param isn't Serialize-able, derive will fail
- **Mitigation:** Include this type in Phase 1A testing; if it fails, switch to manual impl or skip

### Low Risk

**1. `serde` and `serde_json` already in Cargo.toml** ✅
**2. No new external dependencies needed** ✅
**3. `export_cli.rs` pattern is proven** ✅

---

## 4. Alternatives

### A. CLI Inspector: Simpler Alternative

**Current plan:** `pko-inspect <format> <file> [options]` — full structured JSON output

**Alternative 1: Grep-based reference only**
- Don't build a CLI at all. Instead, rely on Phase 1B (source database) + Claude skills
- Pro: Less code to maintain
- Con: No automation for regression detection (Phase 2). You're dependent on manual inspection and Claude's ability to infer correctness
- **Verdict:** Not acceptable. Phase 2 validation oracles *require* a tool to generate checksummed outputs

**Alternative 2: Python CLI instead of Rust**
- Expose existing `pko_tools_lib` as a C FFI or WASM, wrap in Python
- Pro: Easier to prototype and test
- Con: Adds Python dependency to build pipeline, slower for large files, harder to distribute
- **Verdict:** Rust is better; stick with the plan

### B. Serialize Strategy: Alternatives to Manual cgmath impl

**Current plan:** Manual `impl Serialize` for math types, serialize inner `cgmath` fields

**Alternative 1: Feature gate or `serde` feature of cgmath**
- If cgmath's latest version has a `serde` feature, just enable it
- Pro: Automatic, maintainable
- Con: Requires cgmath upgrade; may break other things. Would need testing
- **Check:** Verify if cgmath v0.x (your current version) has a `serde` feature in Cargo.lock

**Alternative 2: Wrapper types with transparent Serialize**
- Create `SerializableVector3 { x, y, z }` and convert from `LwVector3` before serializing
- Pro: Decouples serialization from the core types
- Con: Extra conversion boilerplate in every serializer, less clean
- **Verdict:** Manual impl in a shared helper module (as suggested above) is cleaner

**Alternative 3: Skip Serialize entirely; use `serde_json::to_value()` reflection**
- Don't add Serialize to types; use `serde_json::json!` macro or reflection to build JSON at runtime
- Pro: No changes to Rust types
- Con: Fragile; doesn't scale to complex types; hard to maintain schemas
- **Verdict:** Bad; explicit Serialize is the right approach

**Recommended approach:** Check cgmath version in Cargo.lock. If it already has `serde` support, enable the feature. If not, proceed with manual impl in a shared `src-tauri/src/serde_helpers.rs` module.

---

## 5. Incremental Delivery & Linear Tracking

### Current Plan: No Linear Issues, No Explicit PR/Commit Boundaries

**The problem:**
> "The user wants Linear issue tracking, commits, PRs, and tests at EACH phase — not deferred to the end."

The plan doesn't mention:
- How many Linear issues per phase
- Commit/PR granularity (one big PR per phase, or multiple?)
- When tests are written (per step, or end of phase?)

**Proposed breakdown for incremental delivery:**

**Phase 1A — CLI Inspector**
- **Linear Issue 1:** Add Serialize to math types (Step 1)
  - Commit: "feat(serde): add manual Serialize for LwVector3, LwVector2, LwQuaternion" + math type tests
  - PR: Include test that round-trips math types JSON
- **Linear Issue 2:** Add Serialize to D3D types (Step 1)
  - Commit: "feat(serde): derive Serialize for D3D enums"
  - PR: Quick; low risk
- **Linear Issue 3:** Add Serialize to domain types (LMO, terrain, animation, etc.) (Step 1)
  - Commit: "feat(serde): derive Serialize for LMO, terrain, animation types"
  - PR: Verify no compilation errors, type check
- **Linear Issue 4:** Create `pko_inspect` CLI binary (Step 2)
  - Commit: "feat(cli): add pko-inspect binary with lmo, lgo, lab, map, obj format handlers"
  - PR: Tested against real test files from test_artifacts/
- **Linear Issue 5:** Integration tests (Step 3)
  - Commit: "test(cli): add integration tests for pko-inspect CLI"
  - PR: All tests pass, --summary flags work, valid JSON output confirmed

**This gives you 5 PRs for Phase 1A, not 1.**

**Phase 1B — Source Database**
- **Linear Issue 6:** Extract source topics (file-by-file)
  - Commit: "docs(pko-source): add mesh-formats.md, materials.md, ..." (one per topic, or one big commit?)
  - PR: All topics present, line limits respected, linked in MEMORY.md

**Phase 2 — Validation Oracles**
- **Linear Issue 7:** Golden references (per-format)
  - Commit: "test(oracle): add golden references for 5 LMO files, 5 LGO files, etc."
  - PR: Golden files stored with checksums, validation test passes for all

**Phase 3 — Skills**
- **Linear Issue 8:** `/pko-inspect` skill
- **Linear Issue 9:** `/pko-ref` skill
- **Linear Issue 10:** Update CLAUDE.md and MEMORY.md

### Recommendation
- **Rewrite the plan to include 9–10 Linear issues, one per deliverable**
- **One PR per issue**, merged to master
- **Tests included in each PR, not deferred**
- This changes the schedule estimate but gives you working infrastructure at each checkpoint, not a big bang at the end

---

## 6. Serialize Strategy — Detailed Analysis

### The cgmath Newtype Problem

Your math types are:
```rust
pub struct LwVector3(pub cgmath::Vector3<f32>);
pub struct LwMatrix44(pub cgmath::Matrix4<f32>);
// etc.
```

cgmath doesn't have a `serde` feature (or it's broken/unmaintained). You need to:

#### Option A: Manual impl in each type
```rust
impl Serialize for LwVector3 {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error> 
    where S: serde::Serializer {
        serializer.serialize_struct()?
            .serialize_field("x", &self.0.x)?
            .serialize_field("y", &self.0.y)?
            .serialize_field("z", &self.0.z)?
            .end()
    }
}
```

**Pros:** Explicit, controls output format
**Cons:** Boilerplate, scattered across files

#### Option B: Centralized helper with `serialize_with`
```rust
// src-tauri/src/serde_helpers.rs
pub mod math {
    pub fn serialize_vector3<S>(v: &LwVector3, s: S) -> Result<S::Ok, S::Error> {
        // impl here
    }
}

// In type definition:
#[derive(Serialize)]
pub struct LwVector3(/* ... */);
    #[serde(serialize_with = "serde_helpers::math::serialize_vector3")]
```

**Pros:** DRY, easy to update all math types at once
**Cons:** Requires `#[serde(...)]` attrs on every field

#### Option C: Enable a cgmath serde feature (if available)
```toml
cgmath = { version = "0.18", features = ["serde"] }
```

**Verdict:** Check Cargo.lock for cgmath version. If it has `serde` support, use Option C. If not:
- **Use Option B** (centralized helper module) for maintainability
- Math type serialization should be **compact**: `{x, y, z}` for vectors, 4x4 nested array for matrices
- Document the schema in a comment at the top of `serde_helpers.rs`

### Handling Raw Vertex Data

Many types have `Vec<u8>` fields (vertex positions, normals, colors). Serializing these as full base64 arrays makes JSON huge.

**Recommendation:**
1. **Default:** Skip these fields with `#[serde(skip)]`
2. **Add flag:** `--include-raw-data` flag to CLI that re-serializes with a special mode
3. **For --summary:** Never include raw arrays, only counts (e.g., `"vertex_count": 1234`)

This keeps default output readable while allowing deep inspection on demand.

---

## 7. Missing Preconditions (Before Phase 1A Starts)

1. **Audit test artifacts**
   - Where are the test files? Do they cover all 7 formats?
   - Create a checklist in the plan: `lmo: ✅ 3 files, lgo: ✅ 5 files, lab: ✅ 2 files, ...`

2. **Decide math serialization schema**
   - Write example JSON for `LwVector3`, `LwMatrix44`, `LwQuaternion`
   - Add to plan as an appendix

3. **Create serde_helpers.rs module template**
   - Stub out the functions before Phase 1A starts
   - Prevents mid-phase design churn

4. **Verify cgmath version and serde support**
   - Check `src-tauri/Cargo.lock` for cgmath version
   - If serde feature exists, enable it; update plan accordingly
   - If not, plan for manual impl

5. **Define CLI error codes and output format**
   - Explicit table in plan: `exit 0: success, exit 1: parse error, exit 2: usage error`
   - Error output: plaintext to stderr, or JSON?

---

## Summary Table: Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|-----------|
| cgmath Serialize impl diverges or breaks | High | Create serde_helpers.rs with tests before Phase 1A |
| Test artifacts missing for integration tests | High | Audit test_artifacts/ as prerequisite, before Phase 1A |
| LwBoneFile custom BinRead + Serialize | Medium | Write round-trip test (parse → serialize → inspect) in Phase 1A |
| Golden references become stale in Phase 2 | Medium | Document decision log (VALIDATION.md) for what's golden vs. known-issue |
| JSON output size for large meshes | Medium | Add --output flag, --include-raw-data flag, skip Vec<u8> by default |
| Phase 3 skills undefined | Medium | Define skill behavior, I/O, latency expectations before Phase 2 ends |
| No Linear tracking in current plan | Low–Medium | Break plan into 9–10 issues, one PR per issue, tests in each |

---

## Final Recommendation

**The plan is 70% solid.** Proceed with Phase 1A, but resolve these blockers first:

1. ✅ **Decide:** cgmath serde feature (check Cargo.lock) or manual impl strategy
2. ✅ **Define:** Math serialization schema (examples in plan appendix)
3. ✅ **Audit:** Test artifacts availability (create checklist)
4. ✅ **Expand:** Break plan into 9–10 Linear issues with explicit PR boundaries
5. ✅ **Create:** serde_helpers.rs stub and math type tests before implementing CLI binary
6. ✅ **Clarify:** Phase 2 validation oracle decision process (golden vs. known-issue log)
7. ✅ **Sketch:** Phase 3 skills I/O and latency expectations

**Estimated effort after clarifications:**
- Phase 1A: 2–3 weeks (5 PRs, math types take the most time)
- Phase 1B: 1 week (source extraction, can be parallelized)
- Phase 2: 1–2 weeks (collecting test files + golden references)
- Phase 3: 1 week (skills wiring)
- **Total: 5–7 weeks** with incremental delivery, not a big bang

Would you like me to help with any of these blockers, or create an updated plan with the Linear issues breakdown?
