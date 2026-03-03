**Verdict**
The plan is directionally right, but not execution-ready. It underestimates scope in Phase 1A, has stale API assumptions, and does not currently satisfy “Linear issue + commit + PR + tests at each phase.”

**Findings (ordered by severity)**
1. `High`: Several parser entrypoints in the plan do not match current code.
- `map` parser is `parse_map`, not `parse_map_file`: [terrain.rs:134](/Users/anirudh/gamedev/pko-tools/src-tauri/src/map/terrain.rs:134)
- `lab` parser path is `LwBoneFile::from_file`, not `parse_lab_file`: [character.rs:1265](/Users/anirudh/gamedev/pko-tools/src-tauri/src/animation/character.rs:1265)
- `lgo` parser path is `CharacterGeometricModel::from_file`, not `from_reader`: [model.rs:327](/Users/anirudh/gamedev/pko-tools/src-tauri/src/character/model.rs:327)
- `.lit` support is text `lit.tx` via `parse_lit_tx`, not a `.lit` binary parser: [lit.rs:41](/Users/anirudh/gamedev/pko-tools/src-tauri/src/map/lit.rs:41)
- Plan references `src-tauri/src/mesh/`, but mesh code is under `character/mesh.rs`.

2. `High`: The “36 types” estimate is low if you serialize `CharacterGeometricModel` deeply.
- Nested non-serializable types in `character/model.rs`, `character/mesh.rs`, `character/helper.rs`, `character/texture.rs` expand quickly.
- This is likely 2-3x the effort implied.

3. `High`: Enum serialization strategy is underspecified and likely wrong by default.
- `serde` derive on enums emits variant names, not numeric discriminants.
- For D3D constants you probably want numeric JSON (as done for `D3DBlend` already): [d3d/mod.rs:196](/Users/anirudh/gamedev/pko-tools/src-tauri/src/d3d/mod.rs:196)

4. `High`: Incremental delivery requirement is not met by current phase design.
- “1B parallel with 1A” and memory-only artifacts do not map cleanly to PR-based, test-gated increments.

5. `Medium`: `lmo` loader choice is important and omitted.
- There is backend selection logic (`Native` vs `Kaitai`) in `lmo_loader`; calling `map::lmo::load_lmo` bypasses that behavior: [lmo_loader.rs:36](/Users/anirudh/gamedev/pko-tools/src-tauri/src/map/lmo_loader.rs:36)

6. `Medium`: CLI naming mismatch risk.
- File `pko_inspect.rs` produces binary `pko_inspect`; plan UX says `pko-inspect`.
- Decide one and wire it explicitly (docs/tests/CI).

7. `Medium`: Golden oracle phase lacks determinism details.
- No schema versioning, canonical JSON policy, float precision policy, or hash strategy (input-only vs output+schema).

8. `Medium`: Source-reference DB path is user-local and not reproducible.
- `/Users/.../.claude/...` is not a repo artifact; difficult to review, version, or share in PRs.

**Ordering / dependency corrections**
1. Start with a thin CLI skeleton and 2 easy formats (`eff`, `lit.tx`) first.
2. Lock JSON contract before mass `Serialize` work.
3. Add math + D3D serialization primitives next.
4. Then `lab` + `lgo`.
5. Then `obj` + `map` + `lmo`.
6. After CLI works, do golden oracles.
7. Do source-reference indexing and skills after core tooling is stable.

**Simpler alternative**
Use explicit inspector DTOs per format instead of deriving `Serialize` on all domain structs.  
This avoids contaminating parser internals, keeps JSON stable, and drastically reduces scope/risk.

**Serialize strategy for cgmath newtypes**
The direction is sound, but add strict rules:
1. Use explicit JSON shapes and freeze them.
- `LwVector3`/`LwVector2`: `[x,y,z]`, `[x,y]`
- `LwQuaternion`: `[x,y,z,w]` (be explicit about order)
- `LwMatrix44`: `[16]` in one declared order
2. Add snapshot tests for these exact encodings.
3. Add `#[serde(skip)]` for transient fields (for example `original_node_index` in bone base info).
4. For D3D enums, serialize as integers (or `{name,value}`), not ad hoc mixed styles.

**Incremental delivery blueprint (Linear + PR + tests each phase)**
1. Phase A1: CLI skeleton + `eff` + `lit.tx`, with integration tests for command exit/JSON validity.
2. Phase A2: Math/D3D serde foundation + unit tests for encoding contracts.
3. Phase A3: `lab` + `lgo` support + fixture-based integration tests.
4. Phase A4: `obj` + `map` + `lmo` support + `--summary`.
5. Phase B: Golden oracle framework + checksum + diff tooling.
6. Phase C: Source reference pipeline as repo-managed artifacts/scripts.
7. Phase D: Skills integration and docs.

Current plan can work, but only after these corrections; otherwise Phase 1A will sprawl and miss the “incremental, testable, PR-by-PR” requirement.
