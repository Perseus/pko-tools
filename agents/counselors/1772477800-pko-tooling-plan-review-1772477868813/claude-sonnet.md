Now I have enough context for a thorough review.

---

## Review: PKO Developer Tooling Plan

### Overall Assessment

The plan is solid in direction but has several concrete gaps that will cause friction. The biggest issues are in the Serialize strategy details, the test approach, and the vague specifications for Phases 2 and 3.

---

## 1. Completeness

**Missing: function name mismatches in Phase 1A**

The plan's "Implementation per format" section references functions that don't match what exists:

| Plan says | Actual |
|---|---|
| `effect::model::parse_effect_file()` | `EffFile::from_bytes(&[u8])` — it's a method, not a free function |
| `map::lit::parse_lit_file()` | `map::lit::parse_lit_tx(path: &Path)` — different name, also returns `Vec<LitEntry>`, not a single struct |
| `map::terrain::parse_map_file()` | `map::terrain::parse_map(data: &[u8])` — different name, takes `&[u8]` not a path |

These aren't blockers, but whoever implements this will hit them immediately. The plan should specify exact call sites.

**Missing: `MaterialRenderState` visibility**

`MaterialRenderState` in `lmo.rs` is `pub(crate)`, not `pub`. The CLI binary lives in the same crate, so it can access it, but if you ever want to expose it via a `pko_tools_lib` public API (for testing), you'll need to bump visibility. Note it now.

**Missing: formats that already exist in `export_cli.rs`**

`sceneobjinfo.bin` and `mapinfo.bin` are both already parsed (and used in `export_cli`). They're natural additions to `pko-inspect` and should be in scope since the tooling is meant to eliminate throwaway scripts.

**Missing: `LGOModel` vs `CharacterGeometricModel`**

The plan conflates these. `CharacterGeometricModel` is the character mesh struct. `LGOModel` (if it exists as a distinct type) may be different. The CLAUDE.md mentions both. This needs clarification before adding Serialize — you want to confirm you're serializing the right type for the `lgo` subcommand.

---

## 2. Ordering & Dependencies

The phasing is mostly correct. A few notes:

**Phase 1B (source reference DB) has zero code dependencies.** It's just writing markdown files to the memory directory. It shouldn't be a parallel "phase" — it's a one-time task someone can do in an afternoon. Elevating it to a tracked phase inflates Linear with noise. Downgrade it to a subtask of 1A or a standalone task with no blocking relationship.

**Step 1 (Serialize) should be split by module, not done as one PR.** Adding Serialize to 36 types in a single commit is a large, hard-to-review diff. Better order:
1. Math types (most foundational, needed by everything downstream)
2. D3D types
3. LMO types
4. Terrain/scene types
5. Animation types
6. Character mesh types

Each as a separate PR. The CLI binary (Step 2) can land incrementally — start with just `lmo` and `map` formats, expand as types get Serialize.

**Wrong memory path in Phase 1B.** The plan says:
```
/Users/anirudh/.claude/projects/-Users-anirudh-gamedev/memory/pko-source/
```
The actual path is:
```
/Users/anirudh/.claude/projects/-Users-anirudh-gamedev-pko-tools/memory/
```
This will silently write to the wrong directory and the files will never be loaded.

---

## 3. Risk

**Highest risk: `LwBoneFile` custom BinRead**

`LwBoneKeyInfo` has a `read_key_data<R: Read + Seek>()` method used during deserialization. The animation key data is likely stored as runtime-typed vecs (translation keys, rotation keys, scale keys) where the key type is determined by a flags field read during parsing. If the fields are typed (`Vec<LwVector3>`, `Vec<LwQuaternion>`), derive Serialize works. But if there's any `Vec<Box<dyn ...>>` or enum dispatch, this becomes significantly more involved. **Read `LwBoneKeyInfo`'s full struct definition and field types before committing to "derive should be orthogonal."**

**High risk: `Vec<u8>` raw vertex data**

The plan acknowledges this but doesn't resolve it. A character mesh with 1000 vertices could produce ~40KB of base64 in JSON, making `--summary` essentially mandatory for large files. The plan should decide upfront: skip with `#[serde(skip)]` for raw byte fields (losing data), or base64 with a custom serializer. For a debugging tool, **base64 is more useful** — you can decode it offline if needed. But `#[serde(skip)]` is simpler. Make a decision; don't defer it.

**Medium risk: D3D enum Serialize inconsistency**

`D3DBlend` already exists with `#[serde(into = "u32", try_from = "u32")]` — it serializes as an integer. The plan says other D3D enums "can derive directly." But `#[derive(Serialize)]` on a `repr(u32)` Rust enum with no other attributes serializes as **a string** (the variant name), not a `u32`. `D3DFormat::DXT1` would become `"DXT1"`, not `0x31545844`. That may actually be better for a debugging tool, but it's inconsistent with `D3DBlend`. You need to decide: all enums as strings (better readability) or all as u32 (consistency with existing). If strings, update `D3DBlend` too. If u32, add `#[serde(into = "u32")]` + `From` impls to all, which is ~30 lines of boilerplate per enum.

**Medium risk: `RenderStateSetTemplate<const SET_SIZE, const SEQ_SIZE>`**

`serde::Serialize` derive does support const generics, but there's a subtlety: serde generates `where` bounds requiring `T: Serialize` for each field type. Since `RenderStateValue` contains `D3DRenderStateType`, that enum needs Serialize first. The chain of dependencies needs to be implemented in order: `D3DRenderStateType` → `RenderStateValue` → `RenderStateSetTemplate`. This is manageable but the plan doesn't call out this dependency explicitly.

**Low risk: cgmath newtypes**

The plan correctly identifies these need manual `impl Serialize`. But the existing `to_slice()` methods make this nearly mechanical:
```rust
impl Serialize for LwVector3 {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        self.to_slice().serialize(s)
    }
}
```
`LwMatrix44`, `LwMatrix43`, `LwQuaternion`, `LwVector2` all have `to_slice()` or equivalent. This is ~10 lines per type. Not a risk.

---

## 4. Alternatives

**`--section <name>` flag: cut it from MVP**

Implementing `--section materials` requires the implementation to know the JSON key names for each format, then traverse the JSON tree. This is significant extra work for marginal benefit. For a debugging tool, `jq` already handles this: `pko-inspect lmo foo.lmo | jq .materials`. Cut the flag; document the `jq` pattern instead.

**Consider `clap` for CLI argument parsing**

The plan says "follow existing `export_cli.rs` pattern (manual arg parsing, no clap dependency)." The export CLI has grown into a maze of `if args.len() >= N && args[M] == "--flag"` chains. With 7 subcommands and multiple options, `pko-inspect` will get messier faster. `clap` is already an indirect transitive dependency via Tauri — adding it explicitly costs ~1 line in Cargo.toml and produces much cleaner, self-documenting code with `--help` for free. The "no clap dependency" constraint is worth revisiting.

**Phase 1B: structured files vs. free-form markdown**

The plan proposes 12 markdown topic files. That's fine. But for the `/pko-ref` skill, the value comes from being able to quickly retrieve a specific struct definition without reading a whole file. Consider organizing each topic file with consistent headers (`## Struct: FooBar`, `## Function: read_bar()`) so a grep can locate specific entries. Otherwise a "source reference" is just 12 walls of text to search through.

---

## 5. Incremental Delivery

The plan supports incremental delivery in principle but the Linear/PR structure isn't explicit enough. Concretely:

**What each PR should contain to be independently shippable:**

- PR 1: `#[derive(Serialize)]` for math types + tests (they compile independently)
- PR 2: Serialize for D3D types
- PR 3: CLI binary with `lmo` and `map` subcommands only (already serializable after PR 1-2)
- PR 4: Serialize for animation types + CLI `lab` subcommand
- PR 5: Serialize for character mesh types + CLI `lgo` subcommand
- PR 6: CLI `eff` and `lit` subcommands

Each PR is independently testable. The integration tests (Step 3) should land with PR 3, not deferred — test `lmo` and `map` immediately, add more assertions as formats land.

**The integration test approach needs rethinking.** The plan says "Add tests in `src-tauri/tests/`." Cargo integration tests (`tests/` directory) test the library API, not executables. To test a CLI binary you need `std::process::Command::new(env!("CARGO_BIN_EXE_pko_inspect"))`. This requires the binary to exist when tests run. That works fine, but it's a different approach than "add tests in `tests/`" implies. The test needs a known good input file — this means committing test fixtures or using files from the game client (which can't be committed). The plan doesn't address this. Options:
  1. Include a minimal hand-crafted test fixture (tiny valid LMO/LAB/MAP file) committed to `test_artifacts/`
  2. Skip real-file tests; just test the Serialize impls directly (unit tests)
  3. Gate integration tests behind a feature flag that's only active when game files are present

Option 1 is best for CI. Option 2 is easiest. Decide this before writing the integration test spec.

---

## 6. Serialize Strategy for cgmath Newtypes

The approach is sound. A few concrete gotchas not in the plan:

**`LwMatrix43` stores a `Matrix4` internally but only has 12 meaningful elements.** Your `to_slice()` for it (if it exists) probably returns 16 values (the full Matrix4 including synthetic zeros/ones). For JSON output you likely want only 12 — verify what the serialized form should convey. A dedicated `to_12_slice()` or serialize-as-array-of-12 makes the output less confusing.

**`LwQuaternion` byte order:** The file stores `[x, y, z, w]` but cgmath's `Quaternion::new(w, x, y, z)` puts `w` first internally. Your `to_slice()` returns `[q.v.x, q.v.y, q.v.z, q.s]` which is `[x, y, z, w]` — this matches glTF convention, which is correct for a debugging tool. Just document it in the Serialize impl.

**`LwBox` and `LwPlane` fields are private** (`c`, `r`, `a`, `b`, `d`). Adding Serialize via derive requires the fields to be accessible, or you need a manual impl. Check that these private fields don't block derive before assuming you can "just derive."

**`RenderStateSetTemplate` const generics and serde:** serde's derive works with const generics in Rust 1.65+. The project almost certainly targets a recent enough Rust. But verify `cargo metadata` doesn't pin an older edition that predates const generic derive support.

---

## Summary Priority

| Issue | Severity | Action |
|---|---|---|
| Wrong memory path for Phase 1B | Blocker | Fix path before writing files |
| Function name mismatches (eff/lit/terrain) | High | Audit all call sites before starting Step 2 |
| `LwBoneFile` key data struct audit | High | Read `LwBoneKeyInfo` fields before committing to derive |
| D3D enum string-vs-u32 consistency | Medium | Decide policy, update `D3DBlend` if needed |
| `Vec<u8>` raw data handling | Medium | Decide skip vs base64 upfront |
| `LwBox`/`LwPlane` private fields | Medium | Make fields pub or write manual impl |
| `--section` flag | Medium | Cut from MVP |
| Integration test fixture strategy | Medium | Decide before writing test specs |
| Phase 1B as tracked Linear phase | Low | Downgrade to subtask |
| Clap vs manual arg parsing | Low | Reconsider given 7 subcommands |
