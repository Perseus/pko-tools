---
name: pko-inspect
description: Inspect PKO binary files by parsing them through Kaitai adapters and printing structured JSON. Use this skill when asked to inspect, dump, examine, or debug a PKO game file (.lmo, .lgo, .lab, .map, .obj, .eff, .lit). Also triggers on /pko-inspect.
---

# PKO File Inspector

## Overview

The `pko_inspect` CLI binary parses PKO binary files through Kaitai-backed adapters and outputs pretty-printed JSON to stdout. It auto-detects format by file extension.

## Usage

```bash
cd src-tauri
cargo run --example pko_inspect -- <path-to-file>
```

## Supported Formats

| Extension | Parser | Domain Type |
|-----------|--------|-------------|
| `.lmo` | `map::lmo_loader::load_lmo` | `LmoModel` |
| `.lgo` | `character::lgo_loader::load_lgo` | `CharacterGeometricModel` |
| `.lab` | `animation::lab_loader::load_lab` | `LwBoneFile` |
| `.map` | `map::map_loader::load_map` | `ParsedMap` |
| `.obj` | `map::obj_loader::load_obj` | `ParsedObjFile` |
| `.eff` | `effect::eff_loader::load_eff` | `EffFile` |
| `.lit` | `map::lit::parse_lit_tx` | `Vec<LitEntry>` |

## Notes

- NaN/Inf float values are replaced with `null` in the JSON output
- Kaitai code regeneration is disabled by default (`.cargo/config.toml`)
- The binary lives at `src-tauri/examples/pko_inspect.rs` (it's a cargo example, not a bin target)
- All domain types derive `serde::Serialize`

## Examples

```bash
# Inspect a building model
pko_inspect top-client/model/scene/nml-bd114.lmo

# Inspect an animation skeleton
pko_inspect top-client/animation/0301.lab

# Inspect an effect definition
pko_inspect top-client/effect/lighty.eff

# Pipe to jq for specific fields
pko_inspect top-client/model/scene/nml-bd114.lmo | jq '.geom_objects[0].materials'
```
