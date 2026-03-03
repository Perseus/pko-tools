Now I have enough context. Let me write the review.

---

# Plan Review: PKO Developer Tooling

## 1. Completeness

### Good
- The type audit is thorough — 36+ types mapped to their files with strategy per group.
- CLI format list covers all the major PKO formats the codebase already parses.
- The `--section` and `--summary` flags are smart — raw vertex data arrays will be enormous in JSON.

### Gaps

**`eff` format — function name is wrong.** The plan references `effect::model::parse_effect_file()`, but the actual API is `EffFile::from_bytes()` / `EffFile::read_from()`. The `EffFile` type already has `Serialize` derived, so it needs zero extra work — but the plan should call the correct function.

**`lit` format — function name mismatch and there are TWO lit parsers.** The plan references `map::lit::parse_lit_file()`, but the actual function is `map::lit::parse_lit_tx()`. There's also `item/lit.rs`. The plan should clarify which `.lit` format(s) it covers.

**`lab` — no `parse_lab_file()` exists.** The actual API is `LwBoneFile::from_file(path)`. The plan invented three function names that don't exist. This is a pattern — someone described the plan from memory without verifying against the codebase.

**`mapinfo.bin` is missing.** `parse_mapinfo_bin()` exists and would be useful for inspecting map metadata. Worth adding to the format list.

**`RenderStateSetTemplate` is in `character/model.rs`, not `d3d/mod.rs`.** The plan lists it under "D3D types" but it lives in the character module. Minor, but could cause confusion during implementation.

**`Vec<u8>` raw data fields — the plan mentions them but doesn't decide.** "May want `#[serde(skip)]` or base64 encoding" is not a decision. This needs to be resolved before implementation because it affects the JSON schema. My recommendation: `#[serde(skip)]` by default, with an `--include-raw` flag for the rare cases where someone needs the vertex buffer bytes. Base64 encoding is a trap — nobody wants to decode base64 vertex data manually.

**Missing: what happens when a file is malformed?** The plan should specify error output format. Should `pko-inspect` emit JSON errors (`{"error": "..."}`) or just stderr text? For programmatic consumption (Phase 2 oracles), structured error output matters.

## 2. Ordering & Dependencies

### Phasing is correct, with one reorder suggestion

Phase 1A (CLI) and 1B (source reference) being parallel is good — they're independent.

**However:** Within Phase 1A, the Serialize work (Step 1) should be split into two PRs:

1. **PR 1: Math + D3D types** — These are foundational, used everywhere. The math newtypes are the hardest part (manual impl). Get them reviewed first.
2. **PR 2: Domain types** (LMO, terrain, scene, animation, mesh) — These are straightforward derives once the foundation types serialize.

Lumping all 36+ types into one PR is a review nightmare and a merge conflict magnet. The plan says "incremental delivery" but Step 1 as written is a single monolithic commit.

**Phase 2 (Golden References) depends on the `--pretty` output being stable.** If the JSON key ordering or formatting changes, every golden file breaks. The plan should specify: use `serde_json::to_string_pretty` with sorted keys (`serde_json::ser::PrettyFormatter` with sorted maps), or normalize before diffing. Otherwise golden references will be fragile.

## 3. Risk Assessment

### High Risk

**Manual Serialize for math newtypes is the biggest risk.** `LwVector3(cgmath::Vector3<f32>)` — you need to impl Serialize to emit `{"x": 1.0, "y": 2.0, "z": 3.0}` instead of the opaque newtype. For `LwMatrix44(cgmath::Matrix4<f32>)`, do you serialize as a flat 16-element array or as 4 row arrays? This decision affects Phase 2 golden references. **Decide the schema upfront.** My recommendation:

```rust
// LwVector3 → {"x": f32, "y": f32, "z": f32}
// LwMatrix44 → [[f32; 4]; 4]  (row-major, matches cgmath memory layout)
// LwQuaternion → {"x": f32, "y": f32, "z": f32, "w": f32}
```

**`RenderStateSetTemplate<const SET_SIZE, const SEQ_SIZE>` with Serialize derive** — This should work with `#[derive(Serialize)]` since const generics are supported by serde, but the inner type `[[RenderStateValue; SEQ_SIZE]; SET_SIZE]` requires `RenderStateValue: Serialize` AND serde's array support. Serde supports arrays of any size since 1.0.104. Verify your serde version. If `RenderStateValue` doesn't have Serialize yet, it needs it first — it's currently just `#[derive(Debug, Clone, Copy)]` with `BinRead/BinWrite`.

### Medium Risk

**Test file availability.** Phase 1A Step 3 says "known test files." The existing tests reference `/mnt/d/EA 1.0.1` (a Windows path — presumably WSL) and `./test_artifacts/`. CI will need test fixtures committed to the repo, or these tests only run locally. The plan doesn't address this. If you want CI-green golden references in Phase 2, you need committed test fixtures.

**`--section` filtering complexity.** Implementing `--section materials` means knowing each format's structure well enough to extract named subsections. This is format-specific logic. For v1, consider dropping `--section` and just using `jq` on the output: `pko-inspect lmo foo.lmo --pretty | jq '.materials'`. Simpler, more flexible, no maintenance burden.

### Low Risk

**The `eff` and `lit` types already have Serialize.** Zero work needed there — just wire them into the CLI dispatch.

## 4. Alternatives & Simplifications

### Drop `--section`, use `jq`

As noted above. The `--summary` flag is more valuable because it avoids printing megabytes of vertex data. `--section` is a nice-to-have that adds implementation and testing surface for every format.

### Consider `serde_with` for math newtypes

Instead of fully manual `impl Serialize`:

```rust
use serde_with::{serde_as, DisplayFromStr};

// Or just use a helper:
impl Serialize for LwVector3 {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        let mut map = s.serialize_struct("LwVector3", 3)?;
        map.serialize_field("x", &self.0.x)?;
        map.serialize_field("y", &self.0.y)?;
        map.serialize_field("z", &self.0.z)?;
        map.end()
    }
}
```

This is ~15 lines per type. For 7 math types, that's ~105 lines total. Not worth pulling in `serde_with` — just write the impls directly. But **write them in a single `math/serialize.rs` file** so they're all in one place and easy to review.

### Phase 1B: Source reference files — consider markdown, not raw C++

If the goal is "Claude Code memory for instant access," raw C++ struct dumps are noisy. Pre-processed markdown with field tables (name, type, offset, notes) would be more useful to an LLM. Example:

```markdown
## LwGeomObjInfo (lwExpObj.h:142)
| Field | Type | Size | Notes |
|-------|------|------|-------|
| mtl_size | u32 | 4 | Total material memory |
| mesh_size | u32 | 4 | Total mesh memory |
```

This is denser, more queryable, and fits better in Claude's context.

### Phase 2: Golden references — use `insta` crate

Rather than hand-rolled SHA-256 checksums and diff scripts, use the [`insta`](https://insta.rs) snapshot testing crate. It's designed exactly for this: freeze known-good output, auto-detect regressions, `cargo insta review` to accept changes. It handles pretty-printed JSON natively. This would cut Phase 2 implementation time significantly.

## 5. Incremental Delivery

### The plan talks about it but doesn't structure for it

The plan says "Linear issue tracking, commits, PRs, and tests at EACH phase" but the actual steps don't map cleanly to PRs:

**Suggested PR breakdown:**

| PR | Scope | Tests | Linear Issue |
|----|-------|-------|-------------|
| 1 | `Serialize` for math types (7 types) | Unit tests: serialize/deserialize roundtrip | "Add Serialize to math types" |
| 2 | `Serialize` for D3D + render state types | Unit tests | "Add Serialize to D3D types" |
| 3 | `Serialize` for LMO/terrain/scene/animation types | Unit tests | "Add Serialize to domain types" |
| 4 | `pko-inspect` binary scaffold + `lmo` format | Integration test: parse LMO → valid JSON | "CLI inspector: scaffold + LMO" |
| 5 | Add remaining formats to CLI (`lgo`, `lab`, `map`, `obj`, `eff`, `lit`) | Integration tests per format | "CLI inspector: all formats" |
| 6 | `--pretty` and `--summary` flags | Tests for flag behavior | "CLI inspector: output options" |
| 7 | Source reference files (Phase 1B) | N/A (docs) | "Source reference database" |
| 8 | Golden references (Phase 2) | They ARE the tests | "Validation oracles" |
| 9 | Skills + CLAUDE.md (Phase 3) | N/A (docs) | "Skills integration" |

That's 9 reviewable, mergeable PRs instead of 3 big phases.

## 6. Serialize Strategy — Specific Gotchas

1. **`LwMatrix44(cgmath::Matrix4<f32>)`** — cgmath stores matrices column-major internally. If you serialize the raw memory layout, you'll get column-major arrays. PKO source code uses row-major conventions. **Document which convention your JSON uses**, or consumers will misinterpret transforms.

2. **`LwBoneFile` has custom `BinRead` impl** — Correct that `#[derive(Serialize)]` is orthogonal. But `LwBoneFile` likely contains `Vec<LwBoneKeyInfo>` etc. which also need Serialize. The plan lists 5 animation types but make sure you've traced the full dependency tree. One missing Serialize on a nested type = compile error.

3. **`Option<Vec<...>>` fields in `CharacterGeometricModel`** — These serialize as `null` or array. That's fine, but the `--summary` mode needs to handle `None` vs `Some(vec![])` differently in counts.

4. **`#[binrw]` and `#[derive(Serialize)]` coexistence** — These are fully compatible. No issues expected. The `#[br(...)]`/`#[bw(...)]` attributes are invisible to serde.

5. **Enum representation** — The `repr(u32)` D3D enums will serialize as strings by default (`"D3DFMT_A8R8G8B8"`). If you want numeric values, use `#[serde(serialize_with = "...")]` or a newtype. String names are more readable for the inspector use case — I'd keep the default.

## Summary Verdict

**The plan is sound in direction but sloppy in details.** Three function names are wrong, the PR structure doesn't match the incremental delivery goal, and several decisions are left as "maybe" when they need to be resolved upfront (Vec<u8> handling, matrix serialization convention, error output format).

**Top 3 actions before starting implementation:**
1. Fix the function name references (verify every call site against actual code)
2. Split Step 1 into 2-3 PRs with the math types first
3. Decide the `Vec<u8>` and matrix serialization conventions now, not during implementation

**Biggest time-saver:** Use `insta` for Phase 2 instead of hand-rolled golden reference infrastructure.
