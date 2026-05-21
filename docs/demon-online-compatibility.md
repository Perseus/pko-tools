# Demon Online Compatibility Report

Date: 2026-05-11

Scope: `E:/gamedev/Demon Online` and the equivalent `E:/gamedev/Demon Online/Data`
project root. Demon Online is a MindPower3D-derived client with the engine assets
under `Data`, and table files under `Data/Table`.

## Current Status

The Demon client is supported as a separate layout/preset by resolving both:

- PKO-style root layout: `animation`, `effect`, `map`, `model`, `scripts/table`
- Demon layout: `Data/animation`, `Data/effect`, `Data/map`, `Data/model`, `Data/Table`
- Demon `Data` as project root: `animation`, `effect`, `map`, `model`, `Table`

The core binary asset parsers are compatible with the Demon files audited so far.
The running Tauri UI has also been smoke-tested against Demon character, item,
effect, and particle rendering paths.

## Implemented Support

- Added client layout resolution through `client_paths`.
- Added GBK text decoding through `text_encoding`.
- Added `StringSet.bin` parser for Demon text-like `.bin` string tables.
- Added Demon split item table parsing for `ItemFirstInfo.bin` and
  `ItemSecondInfo.bin`.
- Prevented Demon item model loading from falling back to `model/character`.
- Filtered Demon character equipment model IDs out of the item browser model
  variants, and cleared stale GLTF state when selecting a Demon item row that
  has no standalone item model.
- Added Demon character table offsets, GBK names, model/animation path
  resolution, invalid model-id recovery from real `.lgo` prefixes, and static
  mesh fallback when an animation `.lab` is missing.
- Added Demon character material filename GBK decoding, PKO texture
  de-obfuscation for character material textures, color-only fallback for
  missing character textures, and suit/part inference from real `.lgo`
  filenames when a Demon character row leaves those fields blank.
- Added Demon texture path fallbacks for item, character, effect, and particle
  rendering paths.
- Added shifted raw table layout support for Demon `MapInfo.bin` and
  `SceneObjInfo.bin`.
- Changed `TerrainInfo.bin` parsing to derive record count from file length
  instead of assuming the PKO count.
- Added compatibility audit tools:
  - `src-tauri/examples/client_compat_audit.rs`
  - `src-tauri/examples/effect_asset_audit.rs`

## Audit Results

Table and binary asset command:

```powershell
.\src-tauri\target\debug\examples\client_compat_audit.exe 'E:/gamedev/Demon Online/Data' --bin-details --gltf-sample 10
```

Result summary:

- `.bin` files: 73 total
- Raw-data-like `.bin` tables: 72
- Text-like `.bin` tables: 1 (`StringSet.bin`)
- Irregular `.bin` tables: 0
- Generic raw table active records seen: 46,342
- Shifted-id raw tables: 65
- Characters parsed: 2,132
- Items parsed: 3,026
- `StringSet.bin`: 1,583 GBK strings parsed
- `MapInfo.bin`: 86 active entries
- `SceneObjInfo.bin`: 3,006 active entries
- `TerrainInfo.bin`: 144 texture entries
- `MagicSingleInfo.bin`: 39 active entries
- `MagicGroupInfo.bin`: 39 active entries

Binary asset parser audit:

- `.eff`: 1,184/1,184 parsed, 0 failed
- `.par`: 961/961 parsed, 0 failed
- `.lgo`: 1,543/1,543 parsed, 0 failed
- `.lmo`: 2,864/2,864 parsed, 0 failed
- `.lab`: 617/617 parsed, 0 failed
- `.map`: 71/71 parsed, 0 failed
- `.obj`: 71/71 parsed, 0 failed

GLTF sample audit:

```powershell
cargo run --manifest-path src-tauri/Cargo.toml --example client_compat_audit -- 'E:/gamedev/Demon Online' --gltf-sample 50
```

Result summary:

- Characters: 50/2,132 generated from 50 checked
- Item models: 50/141 generated from 50 checked

This covers the previous crash case around character id 48 and verifies that
the first 50 Demon character rows no longer fail when a row has an invalid raw
model field or lacks a matching animation `.lab`.

Fresh Data-root GLTF sample audit:

- Characters: 10/2,132 generated from 10 checked
- Item models: 10/141 generated from 10 checked

Deep GLTF audit:

```powershell
.\src-tauri\target\debug\examples\client_compat_audit.exe 'E:/gamedev/Demon Online' --deep-gltf
```

Result summary:

- Characters: 2,131/2,132 generated from 2,132 checked
- Item models: 141/141 generated from 141 checked

The one remaining zero-node character row is `id=653`, name `疾风卷轴`. Its
`CharRecord.bin` row points to action/model `1908`, but there are no matching
`Data/model/character/1908*.lgo` files in the Demon client. That appears to be
authored as a non-renderable/special record rather than a parser failure.

Deep texture command:

```powershell
cargo run --manifest-path src-tauri/Cargo.toml --example client_compat_audit -- 'E:/gamedev/Demon Online' --deep-textures
```

Deep texture decode audit:

- `.bmp`: 170/170 decoded
- `.dds`: 3,904/3,904 decoded
- `.jpg`: 39,682/39,682 decoded
- `.tga`: 5,213/5,217 decoded

The same audit also passes when using `E:/gamedev/Demon Online/Data` as the
project root, with the same core parser counts, zero binary asset parser
failures, GBK table names decoded correctly, and sample GLTF generation passing
for 10/10 characters and 10/10 item models.

TGA decode failures in the deep texture audit:

- `Data/Editor/Texture/editor/treeframe.tga`
- `Data/UI/Texture/tree/treeframe.tga`
- `Data/texture/effect/a011.tga`
- `Data/texture/effect/lz05c.tga`

## Effect And Particle Asset Audit

Command:

```powershell
cargo run --manifest-path src-tauri/Cargo.toml --example effect_asset_audit -- 'E:/gamedev/Demon Online'
```

Result summary:

- `.eff` files parsed: 1,184
- `.par` files parsed: 961
- Unique referenced effect/particle textures: 1,385
- Resolved referenced textures: 1,347
- Decoded referenced textures: 1,345
- Missing referenced textures: 38
- Decode failures: 2
- `.eff` parse failures: 0
- `.par` parse failures: 0

The two decode failures are source texture files:

- `a011.tga`
- `lz05c.tga`

The missing references appear to be authored missing/garbled texture names in the
Demon asset set rather than parser failures, but they still affect perfect visual
coverage for those specific effects.

## Live UI Smoke Tests

The running Tauri app was restarted against `E:/gamedev/Demon Online` and driven
through the MCP bridge at `http://localhost:1420/`.

- Items: selected `1000000: 试炼法杖`; item GLTF rendered with 233 vertices,
  418 triangles, and the screenshot crop was nonblank. Then selected
  `2001001: 试炼长袍`; the panel switched to `No item loaded`, export became
  disabled, and stale `1000000` / `00100001` model metadata disappeared.
- Characters: selected character `1: 咒诅女裸体`; character GLTF rendered with
  39 bones, 7,324 frames, 28,475 vertices, 31,994 triangles, and Chinese text
  displayed correctly.
- Effects: selected `b ball.eff`; the UI reported 20 sub-effects and the
  canvas screenshot crop contained 1,780 unique sampled colors with 573 bright
  samples and 602 saturated samples.
- Particles: selected `b ball.par`; the UI reported 10 particle systems,
  including nested `.eff` systems, and the canvas screenshot crop contained
  bright/saturated samples.

Screenshots from the live checks are saved under `.tmp/`:

- `.tmp/demon-item-1000000.png`
- `.tmp/demon-character-1.png`
- `.tmp/demon-effect-b-ball.png`
- `.tmp/demon-particle-b-ball.png`

## Verification Commands

Commands run successfully:

```powershell
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml resolves_demon_data_folder_used_as_project_root --lib -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml demon_item_resolution_does_not_fall_back_to_character_models --lib -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml demon_data_root_item_resolution_does_not_fall_back_to_character_models --lib -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml parses_demon_split_item_tables_and_filters_character_models --lib -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml parses_demon_split_item_tables_when_data_folder_is_project_root --lib -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml parses_demon_char_record_bin_uses_action_model_when_raw_model_is_invalid --lib -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml oversized_demon_character_model_ids_do_not_panic --lib -- --nocapture
$env:PKO_DEMON_PROJECT_DIR='E:/gamedev/Demon Online'; cargo test --manifest-path src-tauri/Cargo.toml demon_character_from_env_generates_gltf --lib -- --nocapture
$env:PKO_DEMON_PROJECT_DIR='E:/gamedev/Demon Online'; cargo test --manifest-path src-tauri/Cargo.toml demon_item_tables_from_env_use_split_layout --lib -- --nocapture
pnpm test:run src/features/effect/__tests__/EffectRendering.test.ts src/features/effect-v2/__tests__/useEffectTexture.test.ts
pnpm test:run src/hooks/__tests__/use-gltf-resource.test.ts
pnpm build
```

Known caveat: full `cargo test --lib` is not currently a reliable completion
signal because unrelated pre-existing tests fail elsewhere in the repository.
Focused tests and audit commands above are the evidence for Demon support.

## What Works

- Demon client root and Demon `Data` root are both recognized.
- Demon table location and asset directories resolve without restructuring the
  original client.
- Characters parse from `CharRecord.bin`.
- Demon character rows with invalid raw model IDs recover to the model/action ID
  when that ID matches real `.lgo` prefixes.
- Characters with missing `.lab` animation files can still export/render as
  static mesh GLTF instead of failing outright.
- Character material texture names decode with GBK-safe logic instead of
  panicking on non-UTF8 bytes.
- Character material loading handles PKO-obfuscated texture bytes and falls back
  to color-only materials when a referenced texture is missing.
- Items parse from Demon split item tables.
- Item rows with character equipment model IDs are filtered so clicking an item
  does not load a character model.
- Selecting a Demon item row with no standalone item model clears the previous
  preview instead of leaving stale geometry on screen.
- Chinese/GBK strings in supported tables decode correctly.
- Core model, animation, map, effect, and particle binary formats parse.
- Effect and particle texture lookup covers Demon `Data/texture` layout.

## Remaining Gaps

- Not every raw `.bin` table has a semantic domain parser. The audit confirms
  they are structurally readable, and focused parsers exist for the tables used
  by current pko-tools workflows, but mission/wiki/shop/pet/skill-style tables
  are not all converted into typed Rust APIs.
- Full all-texture deep decode has been run. It passed for every BMP, DDS, and
  JPG, and failed for four TGA files listed above.
- One active `CharRecord.bin` row (`id=653`, `疾风卷轴`) has no matching
  character model files and exports as an empty/non-renderable GLTF.
- The Demon effects that reference missing source textures cannot be rendered
  perfectly unless replacement assets or corrected references are supplied.
