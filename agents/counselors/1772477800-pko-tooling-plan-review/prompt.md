# Review Request

## Question
Review this implementation plan for building PKO developer tooling (CLI inspector, source reference database, validation oracles, Claude Code skills). Focus on:

1. **Completeness**: Are there missing steps, types, or edge cases?
2. **Ordering & dependencies**: Is the phasing correct? Should anything move earlier/later?
3. **Risk**: What's most likely to go wrong or take much longer than expected?
4. **Alternatives**: Is there a simpler or better approach for any phase?
5. **Incremental delivery**: The user wants Linear issue tracking, commits, PRs, and tests at EACH phase — not deferred to the end. Does this plan support that?
6. **Serialize strategy**: Adding Serialize to ~36 types (some wrapping cgmath newtypes) — is the approach sound? Any gotchas?

## Context

### The Plan

# PKO Developer Tooling — CLI Inspector, Source Reference, Validation Oracles, Skills

## Context

Every debugging session involves repetitive, throwaway work: one-off scripts to dump binary fields, re-reading C++ source to verify struct layouts, and manual comparison of parser output against expected values. When a regression appears in a later session, the same work is repeated from scratch. This plan builds permanent infrastructure so that:

1. Any PKO binary file can be dumped to structured JSON in one command
2. C++ engine source truth is pre-indexed and instantly queryable
3. Known-good parser outputs are frozen as golden references for regression detection
4. All of the above is wired into Claude Code skills for zero-friction use

## Phase 1A: CLI Inspector (`pko-inspect`)

**Goal:** A single binary that parses any PKO file format and prints structured JSON to stdout.

### Step 1: Add Serialize to domain types

Add `#[derive(serde::Serialize)]` to all types that will appear in JSON output. These are the types that currently lack it:

**Math types** (`src-tauri/src/math/mod.rs`):
- `LwVector3`, `LwVector2`, `LwQuaternion`, `LwMatrix44`, `LwMatrix43`, `LwBox`, `LwPlane`, `LwSphere`
- These are newtype wrappers around cgmath types. Implement Serialize manually (serialize the inner fields x/y/z/w, or the 4x4 array for matrices).

**D3D types** (`src-tauri/src/d3d/mod.rs`):
- `D3DFormat`, `D3DPool`, `D3DRenderStateType`, `D3DCmpFunc`, `D3DPrimitiveType`, `D3DVertexElement9`
- `GeomObjType`, `RenderStateValue`, `RenderStateSetTemplate`
- Most are repr(u32) enums — derive Serialize directly.

**Map/LMO types** (`src-tauri/src/map/lmo.rs`):
- `LmoModel`, `LmoGeomObject`, `LmoSubset`, `LmoMaterial`, `MaterialRenderState`
- `LmoAnimData`, `LmoTexUvAnim`, `LmoTexImgAnim`, `LmoOpacityKeyframe`, `LmoMtlOpacAnim`

**Map/Terrain types** (`src-tauri/src/map/terrain.rs`):
- `ParsedMap`, `MapSection`, `MapTile`, `MapHeader`

**Map/Scene types** (`src-tauri/src/map/scene_obj.rs`):
- `ParsedObjFile`, `SceneObject`

**Animation types** (`src-tauri/src/animation/character.rs`):
- `LwBoneFile`, `LwBoneKeyInfo`, `LwBoneBaseInfo`, `LwBoneDummyInfo`, `LwBoneInfoHeader`

**Character mesh types** (`src-tauri/src/character/model.rs`):
- `CharacterGeometricModel` and its nested types that don't already have Serialize

**Mesh core types** (`src-tauri/src/mesh/`):
- Any mesh structs used by the character/item/LMO parsers that need serialization

### Step 2: Create the CLI binary

New file: `src-tauri/src/bin/pko_inspect.rs`

Follow the existing `export_cli.rs` pattern (manual arg parsing, no clap dependency).

```
USAGE: pko-inspect <format> <file-path> [options]

FORMATS:
  lmo       Building/object model (.lmo)
  lgo       Character/item mesh (.lgo)
  lab       Animation bone file (.lab)
  map       Terrain map (garner.map etc.)
  obj       Scene object placement (.obj)
  eff       Effect file (.eff/.ini)
  lit       Lighting info (.lit)

OPTIONS:
  --pretty          Pretty-print JSON (default: compact)
  --section <name>  Print only a named section (e.g. "materials", "geometry", "header")
  --summary         Print counts/sizes only, not full data arrays
```

Implementation per format:
- `lmo`: Call existing `map::lmo::load_lmo()` → serialize `LmoModel`
- `lgo`: Call existing `mesh::model::LGOModel::from_reader()` → serialize
- `lab`: Call existing `animation::character::parse_lab_file()` → serialize `LwBoneFile`
- `map`: Call existing `map::terrain::parse_map_file()` → serialize `ParsedMap`
- `obj`: Call existing `map::scene_obj::parse_obj_file()` → serialize `ParsedObjFile`
- `eff`: Call existing `effect::model::parse_effect_file()` → serialize
- `lit`: Call existing `map::lit::parse_lit_file()` → serialize

### Step 3: Integration tests

Add tests in `src-tauri/tests/` that run `pko-inspect` on known test files and verify exit code 0, valid JSON output, key fields present, --summary has count fields.

## Phase 1B: Source Reference Database (parallel with 1A)

Pre-extracted topic files from the C++ engine source, stored in Claude Code memory for instant access.

Location: `/Users/anirudh/.claude/projects/-Users-anirudh-gamedev/memory/pko-source/`

12 topic files covering: mesh-formats, materials, animation, terrain, coordinates, scene-objects, textures, effects, lighting, d3d-constants, lmo-format, character-model.

Each file extracted from C++ source at `top-client/corsairs-online-public/source/Client/engine/sdk/`.

## Phase 2: Validation Oracles (Golden References)

Frozen, known-good parser outputs that detect regressions automatically. ~20 representative files, SHA-256 checksums, diff on mismatch.

## Phase 3: Skills & Integration

/pko-ref skill, /pko-inspect skill, CLAUDE.md updates, MEMORY.md updates.

### Existing CLI Binary Pattern (export_cli.rs)

```rust
use std::collections::HashMap;
use std::path::PathBuf;

fn main() {
    let args: Vec<String> = std::env::args().collect();

    // Manual arg parsing, no clap
    // Calls into pko_tools_lib:: functions
    // Uses eprintln! for status, println! for data
    // std::process::exit(1) on error
}
```

### Types Currently Missing Serialize (audit results)

**36+ types** need Serialize added:
- 7 math types (LwVector3, LwMatrix44, etc.) — cgmath newtype wrappers, need manual impl
- 9 D3D types — repr(u32) enums, can derive directly
- 10 LMO types — domain structs, can derive directly
- 4 terrain types — domain structs, can derive directly
- 2 scene object types — domain structs, can derive directly
- 5 animation types — uses custom BinRead impl, need careful Serialize addition
- Character mesh types — mixed

**23 types** already have Serialize (mostly Tauri command return types).

### Key Constraints
- Project uses `serde = { version = "1", features = ["derive"] }` and `serde_json` already
- cgmath types don't implement Serialize — newtypes need manual impl or `#[serde(serialize_with)]`
- `LwBoneFile` uses custom `BinRead` impl (not `#[derive(BinRead)]`), so adding `#[derive(Serialize)]` should be orthogonal
- `RenderStateSetTemplate` is generic with const params — Serialize derive should work but verify
- Some types have `Vec<u8>` fields (raw vertex data) — may want `#[serde(skip)]` or base64 encoding for JSON readability

## Instructions
You are providing an independent review. Be critical and thorough.
- Analyze the question in the context provided
- Identify risks, tradeoffs, and blind spots
- Suggest alternatives if you see better approaches
- Be direct and opinionated — don't hedge
- Structure your response with clear headings
- Pay special attention to: incremental delivery (commits/PRs/tests per phase), Linear tracking, and the Serialize strategy for cgmath newtypes
