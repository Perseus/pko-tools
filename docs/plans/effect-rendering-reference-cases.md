# Effect Rendering Reference Cases

This file tracks real-client assets to use while validating source-derived effect parity. The scan source is `E:/gamedev/mp-client-source/Client/client/effect`.

## Particle Corpus Inventory

Scan date: 2026-05-07

Command gate:

```powershell
$env:PKO_PAR_FIXTURE_DIR='E:\gamedev\mp-client-source\Client\client\effect'
cd src-tauri
cargo test particle_type_ids_from_env_fixture_dir_are_source_defined -- --nocapture
```

The local client corpus contains 974 `.par` files and currently uses 15 of the 18 C++ `CMPPartSys` type ids. Types 14, 17, and 18 are source-defined and renderer-supported, but were not represented in this corpus scan.

| Type | Name | Count | First Asset | First System | Texture | Model | Version |
| --- | --- | ---: | --- | --- | --- | --- | ---: |
| 1 | SNOW | 562 | `00000001.par` | `tmep` | `1.tga` | `30light.eff` | 7 |
| 2 | FIRE | 512 | `00000004.par` | `temp` | `1` | `obeyhurt.eff` | 14 |
| 3 | BLAST | 423 | `01000004.par` | `<non-ascii>` | `smoke1` | `RectPlane` | 12 |
| 4 | RIPPLE | 23 | `01000011.par` | `temp5` | `range` | `RectPlane` | 13 |
| 5 | MODEL | 720 | `01000013.par` | `bomb` | `1` | `speed up.eff` | 12 |
| 6 | STRIP | 1039 | `00000002.par` | `00000002` | `1.tga` | `00000002.eff` | 7 |
| 7 | WIND | 4 | `bdwindaa.par` | `bdwinda2` | `zztree` | `RectPlane` | 15 |
| 8 | ARROW | 8 | `fzdabian.par` | `fzdabian1` | `zztree` | `fdabian1.eff` | 15 |
| 9 | ROUND | 42 | `01040004.par` | `temp` | `eff0139` | `01040004.eff` | 12 |
| 10 | BLAST2 | 1 | `miss2.par` | `temp` | `submiss2` | `RectPlane` | 13 |
| 11 | BLAST3 | 1 | `fushe.par` | `fus2h2e.par` | `1` | `kulou.eff` | 15 |
| 12 | SHRINK | 42 | `01000014.par` | `gfgsdf` | `eff0166` | `RectPlane` | 13 |
| 13 | SHADE | 8 | `01010002.par` | `no name` | `eff0267` | `RectPlane` | 14 |
| 15 | RANGE2 | 35 | `00000006.par` | `temp` | `eff0075` | `RectPlane` | 14 |
| 16 | DUMMY | 1 | `01040009.par` | `temp` | `eff0139` | `01040009.eff` | 12 |

## Source-Only Particle Types In This Corpus

These still need source-derived tests and synthetic fixtures because the scanned client assets did not include them:

| Type | Name | Current Renderer |
| --- | --- | --- |
| 14 | RANGE | `RangeSystem` |
| 17 | LINE_SINGLE | `LineSingleSystem` |
| 18 | LINE_ROUND | `LineRoundSystem` |

## Effect Corpus Inventory

Scan date: 2026-05-07

Command gate:

```powershell
$env:PKO_EFF_FIXTURE_DIR='E:\gamedev\mp-client-source\Client\client\effect'
cd src-tauri
cargo test effect_feature_ids_from_env_fixture_dir_are_source_defined -- --nocapture
```

The local client corpus contains 1178 `.eff` files and 2798 serialized sub-effects. All scanned files use `idxTech = 0`, but pko-tools still keeps source-derived support for techniques 0 through 6 because `eff.fx` defines more than the represented client corpus exercises.

| Feature | Distribution |
| --- | --- |
| Effect-level technique ids | `0: 1178` |
| Sub-effect type ids | `1: 2`, `2: 4`, `3: 1310`, `4: 1482` |
| Billboard sub-effects | `608` |
| RotaBoard sub-effects | `2292` |
| RotaLoop sub-effects | `1048` |
| UseParam sub-effects | `79` |
| Alpha-enabled sub-effects | `2490` |
| UsePath files | `0` |
| Rotating files | `80` |

Top model references in the scanned `.eff` corpus:

| Model | Count |
| --- | ---: |
| `RectPlane` | 1642 |
| `Rect` | 580 |
| `Cylinder` | 322 |
| `ice.lgo` | 28 |
| `1chim1.lgo` | 10 |
| `wings01.lgo` | 9 |
| `angel_wing2.lgo` | 8 |
| `foot.lgo` | 6 |
| `h206_xlaa1.lgo` | 6 |
| `cylinder00.lgo` | 4 |
| `dun.lgo` | 4 |
| `gunwing.lgo` | 4 |

## Magic Table Corpus Inventory

Scan date: 2026-05-07

Command gate:

```powershell
$env:PKO_MAGIC_TABLE_DIR='E:\gamedev\mp-client-source\Client\client\scripts\table'
cd src-tauri
cargo test magic_table_from_env_uses_source_defined_dispatch_and_assets -- --nocapture
```

The local client `MagicSingleinfo.bin` contains 65 active single magic entries. Their render indices are all source-defined by this client's `MagicList[]`; `Part_dist2` exists in source but is not referenced by this table.

| MagicSingle Render Idx | Count |
| ---: | ---: |
| 0 | 4 |
| 2 | 54 |
| 3 | 2 |
| 4 | 2 |
| 5 | 2 |
| 6 | 1 |

The local client `MagicGroupInfo.bin` contains 4 active group entries. Their render indices are all source-defined by this client's group dispatch.

| MagicGroup Render Idx | Count |
| ---: | ---: |
| 0 | 1 |
| 1 | 3 |

The gate also verifies that every active nonnegative `MagicGroupInfo` type id resolves to an active `MagicSingleinfo` id. It inventories, but does not fail on, missing asset references in the local effect folder because this corpus has table rows whose referenced `.par` basenames are not present under `Client/client/effect`.

Current missing referenced asset count: 19. First reported examples:

| Entry | Field | Asset |
| ---: | --- | --- |
| 14 | particle | `4000005` |
| 16 | particle | `4000007` |
| 17 | particle | `4000008` |
| 19 | particle | `4000010` |
| 36 | result_effect | `1030006` |
| 40 | result_effect | `1010515` |
| 41 | particle | `4000321` |
| 41 | result_effect | `1060007` |
| 42 | result_effect | `1030006` |
| 43 | result_effect | `1060007` |

## Next Golden-Capture Targets

- Capture one representative asset for each represented particle type above at fixed timestamps `0`, `0.1`, `0.5`, `1.0`, and the system lifetime boundary.
- Capture at least one version-8+ `.par` asset with `ParFile.models` / `CChaModel` character-model records; this is not covered by the `CMPPartSys` type-id list.
- Capture `.eff` representatives that exercise billboard, rotaBoard, rotaLoop, useParam, alpha, built-in primitives, and external `.lgo` model references.
- Capture MagicSingle representatives for every represented render index above, plus MagicGroup fan and sequence representatives.
- For source-only types, use synthetic `.par` fixtures whose fields exercise the C++ branches already covered by unit tests.
- Record material state with each capture: texture name, wrap mode, blend factors, depth test/write, alpha, and active live particle count.
