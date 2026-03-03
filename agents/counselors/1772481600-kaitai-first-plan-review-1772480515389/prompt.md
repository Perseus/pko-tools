# Review Request

## Question
Review this implementation plan for "PKO Developer Tooling — Kaitai First". This plan replaces all native binary parsers with Kaitai Struct schemas + adapters, then builds a CLI inspector, golden reference tests, source reference database, and Claude Code skills on top.

Focus on:
1. **Completeness**: Missing steps, types, edge cases?
2. **Ordering & dependencies**: Is the PR graph correct? Should anything move?
3. **Risk**: What's most likely to go wrong or take longer than expected?
4. **Kaitai codegen**: The Rust codegen has known bugs (deref, literal overflow, missing structs). Will this scale to 3 new formats?
5. **Native deletion safety**: For each format, is the deletion scope correct? Any hidden dependencies?
6. **LMO type extraction (PR 8)**: `scene_model.rs` has 30+ references to `lmo::LmoMaterial` etc. Is the extraction to `lmo_types.rs` safe?
7. **LGO adapter (PR 9)**: The character LGO parser is entangled across 4 files. Can the Kaitai adapter actually reuse LMO's `convert_geometry_chunk()`?
8. **Incremental delivery**: Does each PR stand alone with its own tests?

## The Plan

# PKO Developer Tooling — Kaitai First

## Context

Every debugging session involves repetitive, throwaway work: one-off scripts to dump binary fields, re-reading C++ source to verify struct layouts, and manual comparison of parser output against expected values. Meanwhile, the codebase has two parallel parsing implementations for LMO (native + Kaitai) and hand-written parsers for every other format.

This plan:
1. Makes Kaitai .ksy schemas the single source of truth for all binary formats
2. Writes adapters converting Kaitai AST → domain types, with exhaustive parity tests
3. Deletes native parsers after parity is confirmed
4. Builds a CLI inspector on top of the Kaitai adapters
5. Creates source reference files and golden reference tests
6. Wires everything into Claude Code skills

## Upfront Decisions
1. Kaitai-first: .ksy files are the specification. Native parsers deprecated and deleted after parity.
2. .ksy authoring: In pko-map-lab/formats/, synced to pko-tools/formats/ via pnpm kaitai:sync.
3. Codegen patches: Commit patched .rs files. PKO_KAITAI_BUILD=0 by default. Regenerate manually when .ksy changes.
4. LIT stays native: It's a text format.
5. Serialize: Enable cgmath serde feature. D3D enums as string variants. Vec<u8>: #[serde(skip)].
6. Golden references: Use insta crate for snapshot tests.

## Existing .ksy Status
| Format | .ksy exists? | Generated .rs? | Adapter? | Production? |
|--------|-------------|---------------|---------|------------|
| LMO | pko_lmo.ksy (both repos) | pko_lmo.rs (patched) | lmo_loader.rs (800+ lines) | Yes (opt-in env var) |
| LGO | pko_lgo.ksy (both repos) | pko_lgo.rs | None | No |
| MAP | pko_map.ksy (both repos) | pko_map.rs | None | No |
| LAB | pko_lab.ksy (pko-map-lab only) | Not synced | None | No |
| EFF | pko_eff.ksy (pko-map-lab only) | Not synced | None | No |
| OBJ | Does not exist | N/A | N/A | N/A |
| LIT | N/A (text format) | N/A | N/A | Stays native |

## PR Breakdown (12 PRs)

### PR 1: Serialize Infrastructure
- Cargo.toml: cgmath serde feature + insta dev-dep
- Add #[derive(Serialize)] to math types (LwVector3, LwMatrix44, etc.) and D3D enums
- LwBox and LwPlane have private fields — make pub(crate)
- Unit tests for JSON schema shape

### PR 2: Sync .ksy Files + Generate + Author pko_obj.ksy
- Author pko_obj.ksy for scene object placement format (44-byte header + section index + 20-byte MSVC-aligned records)
- pnpm kaitai:sync to bring pko_lab.ksy, pko_eff.ksy, pko_obj.ksy into formats/
- Generate .rs with PKO_KAITAI_BUILD=1, apply patches, commit
- cargo build passes

### PR 3: OBJ Adapter + Parity + Native Deletion
- New src/map/obj_loader.rs — simplest format (flat records, no version branching)
- Parity test: exhaustive over all .obj files
- Delete parse_obj_file() from scene_obj.rs (~130 lines)

### PR 4: MAP Adapter + Parity + Native Deletion
- New src/map/map_loader.rs — .ksy already exists and is generated
- Parity test: on 07xmas2.map and garner.map
- Delete parse_map() from terrain.rs (~105 lines)

### PR 5: EFF Adapter + Parity + Native Deletion
- New src/effect/eff_loader.rs — domain types already have Serialize
- Parity test: all fixture .eff files + round-trip validation
- Delete read_from() helpers from model.rs (~200 lines), keep write_to()

### PR 6: LAB Adapter + Parity
- New src/animation/lab_loader.rs
- Key challenges: bone name null-termination, key_type 3 pos_num expansion, matrix conversion
- Parity test: exhaustive over all .lab files
- Native NOT deleted yet (BinWrite dependency)

### PR 7: LAB Native Parser Deletion
- Delete BinRead impl from character.rs (~235 lines)
- Keep struct definitions, BinWrite, glTF conversion

### PR 8: LMO Domain Type Extraction + Native Deletion
- Create src/map/lmo_types.rs — move 10 domain structs + helpers from lmo.rs
- Update lmo_loader.rs and scene_model.rs (30+ references)
- Remove Native backend, make Kaitai default
- Delete lmo.rs (2,579 lines)

### PR 9: LGO Adapter + Parity
- New src/character/lgo_loader.rs
- LGO = u32 version + LMO GeometryChunk — can reuse LMO adapter's convert_geometry_chunk()
- Add Serialize to ~15 character types (CharacterGeometricModel, CharacterMeshInfo, TextureInfo, HelperData, etc.)
- Parity test: exhaustive over .lgo files
- Native NOT deleted (BinWrite entangled across 4 files)

### PR 10: CLI Inspector Binary
- New src/bin/pko_inspect.rs — auto-detect from extension
- All formats use Kaitai adapters (except LIT which stays native)
- --pretty, --summary flags
- Integration tests

### PR 11: Golden Reference Snapshot Tests
- tests/golden_reference_tests.rs using insta::assert_yaml_snapshot!
- ~20 files covering edge cases across all formats
- NaN/Inf pre-processing

### PR 12: Source Reference + Skills + Docs
- 12 C++ source topic files in memory/pko-source/
- /pko-ref and /pko-inspect skills
- CLAUDE.md + MEMORY.md updates

## Dependency Graph
```
PR 1 → PR 2 → PR 3 (OBJ)
              → PR 4 (MAP)
              → PR 5 (EFF)
              → PR 6 (LAB) → PR 7 (LAB delete)
              → PR 8 (LMO delete) → PR 9 (LGO)
       All adapters → PR 10 (CLI) → PR 11 (Golden) → PR 12 (Skills)
```

## Key Technical Details

**Adapter pattern (from lmo_loader.rs):**
1. BytesReader::from(data) → PkoXxx::read_into(...) for Kaitai AST
2. Convert Kaitai types to domain types (LmoModel, ParsedObjFile, etc.)
3. Parity test: compare adapter output vs native parser output on real files

**Known Kaitai codegen bugs:**
- `*_io.size()` spurious deref (should be `_io.size()`)
- u32::MAX literal emitted as `4294967295 as i32` (overflow)
- Arithmetic type mismatches in computed instances
- Missing struct for renamed types

**LMO type extraction (PR 8):**
scene_model.rs uses lmo::LmoMaterial, lmo::LmoSubset, lmo::LmoAnimData etc. in 30+ places for constructing building materials. These types must move to lmo_types.rs before lmo.rs is deleted.

**LGO format:**
pko_lgo.ksy is: `u32 version` + rest parsed as `pko_lmo::geometry_chunk(version, 0)`. The character LGO format IS the LMO geometry chunk format. CharacterGeometricModel in Rust maps to the same binary layout.

## Instructions
Be critical and thorough. This is a large plan touching many files. Look for hidden dependencies, ordering mistakes, and scope underestimation. Pay special attention to PR 8 (LMO extraction) and PR 9 (LGO adapter) as the highest-risk items.
