# Effect Rendering Parity Feedback Loop

## Goal

Reach rendering and animation parity with the original PKO C++ client before expanding effect authoring workflows.

Parity means each supported effect path has evidence from the original client or source code, a matching pko-tools implementation path, and a verification gate that catches regressions.

## Reference Strategy

The strongest loop is a runnable original client that can produce deterministic captures and state dumps. If that is available, every parity item should use:

- Fixed asset, camera, start position, target position, and playback time.
- C++ state dump for active effect instances, matrices, texture frame, color, blend state, and particle counts.
- pko-tools state dump for the same fields.
- Visual capture at the same timestamps.
- Diff result and human review note when blending or transparency cannot be judged numerically.

The `.eff` state dump contract is `docs/plans/effect-trace-golden-schema.md`. pko-tools v2 exports this as `pko-effect-trace/v1` from the effect workbench Trace JSON action, including raw PKO `pko-z-up` runtime vectors, Direct3D-style `localMatrix` rows, and Direct3D-style `renderState` fields so C++ dumps can be compared without Three.js coordinate conversion hiding parity bugs. `E:/gamedev/mp-client-source/Engine/tools/ref_dump/main.cpp` now builds a standalone `pko_ref_dump.exe` that parses arbitrary `.eff` files and emits the same schema for source-side frame/texture/transform/color/blend comparison.

The repeatable local corpus gate is:

```powershell
pnpm test:effect-trace-corpus -- `
  --effect-dir "E:\gamedev\mp-client-source\Client\client\effect" `
  --source-dumper "E:\gamedev\mp-client-source\Client\client\system\pko_ref_dump.exe" `
  --tools-dumper "E:\gamedev\pko-tools\src-tauri\target\debug\examples\effect_trace_dump.exe"
```

The consolidated local effect parity gate is:

```powershell
$env:PKO_EFFECT_TRACE_CORPUS_DIR="E:\gamedev\mp-client-source\Client\client\effect"
$env:PKO_EFFECT_TRACE_SOURCE_DUMPER="E:\gamedev\mp-client-source\Client\client\system\pko_ref_dump.exe"
$env:PKO_EFFECT_TRACE_TOOLS_DUMPER="E:\gamedev\pko-tools\src-tauri\target\debug\examples\effect_trace_dump.exe"
pnpm test:effect-parity-local
```

With those environment variables set, the gate runs effect frontend parity tests, the real-browser Three/WebGL alpha smoke, Rust effect tests, Rust effect-v2 loader tests, and the full source-derived `.eff` trace corpus diff. A passing run proves the current deterministic state/matrix/material regression suite, but it is still not a substitute for original-client rendered pixel captures.

If the original client cannot be run, the fallback loop is source-derived parity:

- Cite the exact C++ function and branch.
- Build a focused TypeScript/Rust test for the equivalent pko-tools behavior.
- Verify visually in the workbench against representative assets.
- Mark the matrix entry as source-derived, not golden-captured.

## Parity Matrix

| Area | C++ Reference | Current pko-tools Surface | Required Evidence | Status |
| --- | --- | --- | --- | --- |
| `.eff` keyframe interpolation | `I_Effect`, `CEffectCortrol`, `CMPModelEff::FrameMove` | `src/features/effect/animation.ts`, `src/features/effect-v2/renderers/SubEffectRenderer.tsx`, `src/features/effect-v2/effectTrace.ts`, `src-tauri/src/effect/trace.rs`, `src-tauri/examples/effect_trace_dump.rs`, `E:/gamedev/mp-client-source/Engine/tools/ref_dump/main.cpp`, `docs/plans/effect-rendering-reference-cases.md`, `docs/plans/effect-trace-golden-schema.md` | Timestamped transform/color/render-state snapshots plus diff report | Source-derived partial; interpolation is covered by focused animation tests and v2 now has deterministic `pko-effect-trace/v1` artifact export, parser, diff helpers, and a buildable source-side `pko_ref_dump.exe`. The full local `.eff` corpus of 1178 files generated source and pko-tools trace artifacts with 0 dumper failures, and the directory golden diff passed for 1178 files at sample times `0,0.1,0.2,0.5,1.0`, including texture keys, frame indices, position/scale/angle/color, blend state, and D3D row-major `localMatrix`. An env-gated real-client `.eff` corpus inventory guards unknown technique and sub-effect type ids across 1178 files / 2798 sub-effects. Remaining work is live original-client visual captures and pixel/material verification |
| Built-in primitives | `CEffectModel`, mesh constants, `CMPModelEff::RenderVS` | `src/features/effect/rendering.ts`, `SubEffectRenderer.tsx` | Geometry vertex/index parity tests | Source-derived partial; Rect, RectPlane, RectZ, Triangle, TrianglePlane vertex/UV layouts and Cylinder/Cone Z-axis extent covered. `Sphere` is documented by the source as a named default candidate but the client resource manager does not create a procedural sphere mesh, so pko-tools no longer invents one. Remaining work is golden visual capture |
| External `.lgo` sub-effects | `I_Effect::BoundingRes`, `GetMeshByName` | `SubEffectRenderer.tsx` uses `load_effect_model` via `useEffectModel`; `effect-tools-capture` can consume an effect model bundle generated from real `model/effect/*.lgo` files | Asset render capture and fallback behavior | Source-derived partial; v2 renders external meshes only after the requested model resolves and clears stale geometry on model-name changes or load failures, matching the C++ `m_pCModel` null/no-draw behavior instead of showing a previous mesh. The pko-tools headless candidate capture now renders bundled external models; remaining work is original-client output and pixel corpus coverage |
| `EFFECT_FRAMETEX` texture switching | `CTexFrame::GetCurTexture`, `CMPModelEff::FrameMove` | `SubEffectRenderer.tsx` resolves active frame texture over local effect-loop playback time | Texture-name timeline test plus visual flipbook capture | Source-derived partial; one-frame, exact-boundary, and effect-loop reset cases covered |
| UV coordinate animation | `CTexCoordList::GetCurCoord`, `CTexList::GetCurTexture` | `applySubEffectFrame.ts`, `animation.ts`, `SubEffectRenderer.tsx` | UV-buffer snapshots at frame boundaries | Source-derived partial; MODELUV final-frame hold, one-frame UV, and exact-boundary MODELTEXTURE cases covered |
| Blend/render state | D3D render states in `CMPModelEff::RenderVS`, `MPParticleCtrl` | `pkoStateEmulation.ts`, `buildEffectMaterialProps.ts`, `SubEffectRenderer.tsx`, `docs/plans/effect-rendering-reference-cases.md` | Material-state tests and visual blend captures | Source-derived partial; v2 sub-effects now route through shared PKO material props and parent `idxTech` cull/depth state, with alpha=false, alpha=true custom blending, technique 1 no-blend, technique 5 component tests, and a CPU pixel regression showing transparent black texels remain invisible under `SRCALPHA+ONE` and `SRCALPHA+INVSRCALPHA` covered. The Rust loader now preserves source constructor defaults for legacy `.eff` versions: `alpha=true` for version <= 5 and `rotaBoard=true` for version <= 6, preventing older transparent particles from becoming opaque black quads. The local `.eff` corpus currently exercises only `idxTech = 0`, so nonzero technique parity remains source-derived until synthetic or alternate-client fixtures are captured. Remaining work is visual blend/depth captures against original D3D output |
| Billboard and rotaBoard | `I_Effect` billboard matrix branches, `MPResManger` inverse-view billboard matrix, `CMPModelEff::FrameMove` billboard branch | `applySubEffectFrame.ts` | Camera-facing quaternion snapshots | Source-derived partial; billboard now uses camera orientation/inverse-view semantics instead of object-position `lookAt`. Billboard sub-effects ignore authored frame-angle interpolation like `CMPModelEff::FrameMove`, while `rotaBoard` still preserves rotaLoop/local matrix before camera billboard composition. Focused quaternion tests are covered. Remaining work is original-client matrix capture and visual billboard snapshots |
| Group rotation/path/sound flags | `CMPModelEff` file-level fields | `EffectRenderer.tsx`, item renderer group rotator, Rust `.csf` loader | Rotation/path matrix snapshots; sound documented or implemented | Source-derived partial for rotation and path; v2 `EffectRenderer` now applies file-level `rotating`/`rotaVec`/`rotaVel` as a group quaternion from local time, and `usePath/pathName` loads `.csf` points and offsets the whole effect group at C++ default velocity `1.0`. Rust `.csf` parsing now matches the C++ 4-byte `csf\0` header layout and applies the source coordinate remap `x, -z, y`, with focused tests covered. Remaining work is original-client rotation/path matrix captures and sound behavior |
| Magic single render modes | `EffectObj.cpp` `MagicList` / `Part_*` functions, `CMagicCtrl::_vecPartCtrl`, `MagicSingleinfo.bin` render indices | `MagicEffectRenderer.tsx`, `FlightPathController.tsx`, `HitEffectRenderer.tsx`, `ParticleEffectRenderer.tsx`, `useEffectModel.ts`, `magicDummyKinematics.ts`, `magicFlightTrace.ts`, `docs/plans/effect-rendering-reference-cases.md` | Per-render-index path tests and arrival/hit timing captures | Partial; flight orientation and hit-result transform source-derived, dispatch now matches this client's `MagicList[]` entries 0-6 and leaves unrouted `Part_dist2`/index 7 unsupported, an env-gated real-client magic table corpus gate proves all 65 active single entries use render indices 0/2/3/4/5/6 and all 4 active group entries use group modes 0/1, deterministic magic-flight trace/diff helpers capture path position, source-style quaternion, and done state at fixed timestamps, non-trace paths keep their emission-time `RotatingXZ` orientation instead of per-frame re-aiming, `Part_trace` now starts the flight group at the emission origin like `CMagicCtrl::_vPos = *vStart`, `Part_trace` can update orientation through source-style `ResetDir`, hit/result particles receive the current source `_vDir` equivalent through `CMPPartCtrl::setDir`/modelDir without rotating the whole result `.par` root, `MagicSingleinfo.strPart[]` primary non-dummy particle controllers follow `CMagicCtrl::MoveTo` position without inheriting model `RotatingXZ`, and dummy-indexed particles can drive a runtime emitter position from helper nodes on the first model sub-effect's `.lgo` after composing the current first sub-effect frame transform. Remaining work includes resolving/inventoring 19 missing table asset references in this local corpus and original-client captures |
| Magic group fan/sequence | `EffectObj.cpp` `GroupList`, `Part_fan`, `Part_sequence` | `MagicGroupRenderer.tsx`, `docs/plans/effect-rendering-reference-cases.md` | Phase timing and direction snapshots | Source-derived partial; group expansion, fan target flattening/Z-rotation mapped into Three XZ targets, sequence `n * 0.2f` delay covered, and the env-gated magic table corpus gate verifies every active group type id resolves to an active MagicSingle id. Remaining work is original-client phase captures |
| Particle type coverage | `MPParticleSys.cpp`, `MPParticleCtrl.cpp`, `MPParticleSys.h` particle type ids | `ParticleEffectRenderer.tsx`, `renderers/particles/*`, `docs/plans/effect-rendering-reference-cases.md` | One golden/reference case per type; dispatch test proving all type ids route to a renderer | Partial; Snow velocity signs/reject-zero-Z/signed acceleration plus dead-slot step emission, Fire normalized direction/range/signed acceleration plus dead-slot step emission, Blast random velocity signs, Blast2 forward-font-direction spawn/triple-speed first phase/lateral frame-one cycle, Blast3 deterministic ring direction/fixed-life motion, Ripple placement plus source-primed first step emission, Model/Arrow center placement plus fixed-life reset behavior, Strip frame-0 static size/color/base placement, Shade source frame timing plus fixed shade size/base placement, Round deterministic distribution/rotation, Range static frame-0 particles, Range2 fixed-Z spawn/source-style stepped emission/fixed visual state/stop-drain lifecycle, Shrink target-seeking behavior, Wind accumulated-rotation/fixed-life behavior plus dead-slot step emission, Dummy/LineSingle dummy-span formulas plus C++ `SetItemDummy` routing, LineRound source formula helper and no-dummy no-render gating, CMPStrip endpoint track order/UV/alpha/triangle-strip expansion, explicit renderer dispatch coverage for all `CMPPartSys` type ids 1-18, and an env-gated real-client corpus inventory for unknown serialized type ids are source-derived. The local corpus reference list currently covers 15 represented type ids and marks Range/LineSingle/LineRound as source-only in that asset set |
| Particle system origin/range placement | `CMPPartSys::MoveTo`, `_vOffset`, per-type `_Create*` placement | `particlePlacement.ts`, `useParticleLifecycle.ts`, Blast/Ripple/Fire/Snow/Model/Strip/Arrow/Round/Range/Range2/Shade/Shrink/Wind helpers | Local transform snapshots for zero origin, nonzero origin, nonzero offset, and model-range point cases | Source-derived partial; shared `offset - range/2 + random*range` helper covered for Blast/Ripple/Fire/Snow/Range/Shrink/Wind, C++ model-range point placement covered and wired for Fire/Snow/Blast/Ripple, center placement covered for Model/Arrow/Round/Shrink target, base placement covered for Strip/Shade, Range2 fixed-Z spawn covered, and `CMPPartCtrl::MoveTo` now feeds particle-system emitter placement without wrapping/dragging the whole particle renderer. Remaining work is original-client matrix snapshots and audit of any less common point-range users |
| Particle lifecycle variants | `GetCurFrame`, per-type reset branches in `_FrameMove*` | `useParticleLifecycle.ts` shared frame/death handling, `particleTrace.ts` | Per-type lifetime/frame-wrap tests for looping and non-looping systems; particle trace/diff snapshots | Source-derived partial; default kill/hold behavior is preserved, Snow/Fire/Ripple/Wind now use C++ `_fStep` dead-slot respawn mode instead of initial all-particle spawn, Model/Arrow use fixed system-life frame timing with reset behavior, Strip and Range no longer use keyframe lifetime animation where the source is static, Shade uses source `frameTime = life` timing with fixed shade size, Round opts into reset/wrap frame behavior, Blast2 uses its C++ custom frame-time override and frame-one skip branch, Range2 no longer uses the shared keyframe lifecycle and instead uses the C++ dead-slot step emitter plus particle-0 stop timer/drain completion, and particle trace/diff helpers can capture alive count plus sampled position, direction, acceleration, size, color, alpha, angle, frame, elapsed, and lifetime. Remaining per-type lifecycle branches still need original-client particle state captures |
| Particle model visuals | `CMPPartCtrl::NewModel`, `CMPPartCtrl::Render`, `CMPPartCtrl::MoveTo`, `CMPPartSys::_pCModel/_CPPart`, `CChaModel`, `_eMinFilter/_eMagFilter` | `ParticleVisual.tsx` handles nested `.eff`, static effect mesh model names, particle texture/blend/filtering, alpha/color, and C++ per-type visual rotation branches; `ParticleEffectRenderer.tsx` routes version-8+ `ParFile.models` through `CharacterModelParticleRenderer` | Separate nested `.eff`, model-particle, character-model, ARRAW no-rotation, SHRINK RotatingXZ, and particle texture filter cases | Source-derived partial; character-model records load `load_character` by model id, rotate the backend's glTF Y-up output upright into the v2 z-up effect scene, apply `CChaModel` color/blend state, seek the monolithic glTF animation to the current pose/action range, stop one-shot models when the C++ end keyframe would clear playing state, receive parent `.par` runtime emitter movement like `CMPPartCtrl::MoveTo`, and participate in parent `.par` completion tracking, with focused renderer and kinematics tests. `ARRAW` now avoids generic frame-angle rotation, `SHRINK` uses source-style `RotatingXZ(x, y)`, and direct model/shade particle textures honor `.par` min/mag filter fields. Remaining work is original-client captures and visual validation on real `ParFile.models` assets |
| Particle nested `.eff` timing | `CMPPartSys::FrameMove`, per-type `_CPPart->FrameMove`, `CMPModelEff::FrameMove`/`SetAlpha` per spawned model | `ParticleVisual.tsx`, `SubEffectRenderer.tsx`, `useParticleLifecycle.ts`, `TimeContext.tsx` | Shared-vs-mediaY nested clock tests, per-type nested loop-mode tests, nested sub-effect opacity tests | Source-derived partial; nested `.eff` visuals now distinguish C++'s shared `_CPPart` clock from mediaY per-particle `CMPModelEff[]`, and `MODEL`/`STRIP`/`ARRAW` inherit parent loop mode like `Play(!_bLoop)` while blast-style branches force nested looping like `Play(0)`. Particle alpha now multiplies into nested sub-effect material opacity like `CMPModelEff::SetAlpha`. Remaining work is original-client state captures for reset/play edge cases and live visual validation on assets with mediaY nested effects |
| Dummy/item/character attachment | `CMagicEff::setFollowObj`, `CMPPartCtrl::SetItemDummy`, `CMPPartSys::GetDummyPosList`, `CMPModelEff::GetRunningDummyMatrix` | item renderer, magic renderer, workbench dummy support; `load_effect_model` now preserves `.lgo` helper nodes; `ParticleEffectRenderer` can pass optional dummy1/dummy2 spans and runtime emitter positions to particle systems; item particle preview now computes dummy1/dummy2 span from runtime item dummy matrices and routes through v2 particle rendering | Runtime matrix snapshots from dummies | Partial; C++ dummy span derivation, Dummy/LineSingle initial placement/velocity formulas, item dummy-matrix span extraction, `SetItemDummy` gating so LineRound does not receive item dummy spans, LineSingle/LineRound `GetDummyPosList` failure now completes without invented fallback particles, non-dummy MagicSingle particle placement under the flight group, MagicSingle dummy-index anchoring from the first model sub-effect's helper nodes plus current sub-effect transform, and emitter movement without dragging existing free-moving particles are covered. Remaining work is true item/skeleton `GetObjDummyRunTimeMatrix` animation parity, character attachment wiring, and golden matrix snapshots |
| Strip/link effects | `CMPStrip`, `CMPLink` | `StripRenderer.tsx`, `stripTrailKinematics.ts`, `LinkBeamRenderer.tsx`, `linkBeamKinematics.ts`, strip/link tests | Ribbon geometry and texture-state captures | Source-derived partial for `CMPStrip`: item dummy spans now feed source-style endpoint track samples instead of only a synthetic camera-facing preview, with vertex order, UV progression, max-length stop, alpha fade, D3D triangle-strip expansion, strip renderer completion, and strip-only parent `.par` completion tracking covered. Source-derived partial for `CMPLink`: arc radius, pair order, UV progression, D3D triangle-strip expansion, texture-frame timing, additive blend, and raw PKO z-up runtime axes with no Y/Z swap are covered. Remaining work is discovering any live caller/table for `CMPLink` because `CMPPartCtrl` serialization only stores systems, strips, and character models, plus golden captures and strip/link texture-state captures |

## Verification Gates

Every parity fix should add or update at least one of these:

- Unit test for deterministic math, state, frame selection, geometry, or material mapping.
- Renderer test using `@react-three/test-renderer` when component behavior is involved.
- Trace snapshot diff when particle or effect lifecycle state matters.
- Pixel or screenshot comparison when material blending, billboard orientation, or visual density is the behavior.
- Manual capture note for cases where alpha blending and depth ordering require human judgment.

Passing tests alone is not enough unless the test directly covers the parity row being claimed.

Current repo note: there is no checked-in browser screenshot/pixel harness such as Playwright. The repo has RGBA buffer diff helpers and a minimal real-browser Three/WebGL alpha smoke gate:

```powershell
pnpm test:effect-alpha-smoke
```

That smoke gate runs through Vite, imports pko-tools `buildEffectMaterialProps`, renders real Three/WebGL pixels in headless Edge, and verifies the transparent-black blend regression against the app's material projection. Final pixel parity still needs a capture runner that renders representative pko-tools scenes and compares them to original-client captures at fixed camera/time/asset settings.

The broader local gate is:

```powershell
pnpm test:effect-parity-local
```

When the three `PKO_EFFECT_TRACE_*` environment variables above are present and point to existing paths, this command also runs the 1178-file source-vs-tools trace corpus. Without those variables it deliberately skips the corpus path, so a no-env pass should be treated as a local regression smoke rather than full corpus evidence.

The completion-grade full parity gate is:

```powershell
$env:PKO_EFFECT_TRACE_CORPUS_DIR="E:\gamedev\mp-client-source\Client\client\effect"
$env:PKO_EFFECT_TRACE_SOURCE_DUMPER="E:\gamedev\mp-client-source\Client\client\system\pko_ref_dump.exe"
$env:PKO_EFFECT_TRACE_TOOLS_DUMPER="E:\gamedev\pko-tools\src-tauri\target\debug\examples\effect_trace_dump.exe"
$env:PKO_EFFECT_PIXEL_CORPUS_MANIFEST="E:\gamedev\effect-captures\effect-pixel-corpus.json"
pnpm test:effect-parity-full
```

Unlike the local gate, `pnpm test:effect-parity-full` fails immediately if the source trace corpus inputs or rendered pixel-corpus manifest are missing. This is the gate to use before claiming full rendering parity; it runs the local trace/material/matrix gate with corpus evidence, then runs the rendered BMP pixel corpus.

The initial rendered-capture diff utility is:

```powershell
node scripts/effect-pixel-diff.mjs `
  --source original-client.bmp `
  --candidate pko-tools.bmp `
  --out diff.bmp
```

It currently supports uncompressed 24-bit and 32-bit BMP captures, which matches the original client's `MPRender::CaptureScreen` path through `SurfaceToBMP`. It reports dimensions, differing-pixel count, max channel delta, and mean absolute channel delta, then exits nonzero when the configured tolerance budget is exceeded. This establishes the comparison side of the pixel gate; the missing part is still deterministic capture generation for both renderers across the reference cases.

The initial pko-tools candidate capture utility is:

```powershell
New-Item -ItemType Directory -Force captures/parsed, captures/pko-tools | Out-Null

cd src-tauri
cargo run --example pko_inspect -- `
  "E:\gamedev\mp-client-source\Client\client\effect\00000002.eff" `
  > ..\captures\parsed\00000002.json
cd ..

pnpm bundle:effect-textures -- `
  "E:\gamedev\mp-client-source\Client\client" `
  "E:\gamedev\mp-client-source\Client\client\effect\00000002.eff" `
  captures/parsed/00000002-textures.json

pnpm bundle:effect-models -- `
  "E:\gamedev\mp-client-source\Client\client" `
  "E:\gamedev\mp-client-source\Client\client\effect\00000002.eff" `
  captures/parsed/00000002-models.json

pnpm capture:effect-tools -- `
  --effect-json captures/parsed/00000002.json `
  --texture-bundle captures/parsed/00000002-textures.json `
  --model-bundle captures/parsed/00000002-models.json `
  --out captures/pko-tools/00000002-0.5.bmp `
  --time 0.5 `
  --width 512 `
  --height 512 `
  --fail-on-skipped
```

The input JSON is the parsed pko-tools `EffectFile` shape, such as output from `src-tauri/examples/pko_inspect` for a `.eff` file. The optional texture bundle maps normalized texture names to decoded RGBA bytes. The headless candidate renderer quantizes those bytes through the same A4R4G4B4 effect-texture emulation used by the runtime hook, so low alpha nibbles are dropped like the D3D client instead of producing faint black/red square artifacts in BMP captures:

```json
{
  "textures": {
    "eff0139": {
      "width": 64,
      "height": 64,
      "rgba": "base64 RGBA bytes"
    }
  }
}
```

The optional model bundle maps normalized `.lgo` names to glTF JSON generated from `model/effect/*.lgo` through the same Rust effect-model conversion used by the app:

```json
{
  "models": {
    "magic": {
      "gltf": "{ glTF JSON string }",
      "source": "E:/gamedev/mp-client-source/Client/client/model/effect/magic.lgo"
    }
  }
}
```

This utility runs Vite plus headless Edge, renders through the shared pko-tools geometry/material/frame functions, loads bundled external `.lgo` meshes with `GLTFLoader`, and writes a BMP candidate capture without launching Tauri or the game client. Use `--fail-on-skipped` for corpus captures so missing model bundles or embedded magic effects cannot silently produce incomplete candidate BMPs; the full gate, manifest audit, and pixel-corpus gate reject rendered-coverage cases that set `candidateCapture.failOnSkipped` to `false`. Each manifest case must choose exactly one primary candidate capture input: `effectJson`, `parJson`, or `magicScenario`, because the capture CLI renders only one mode per invocation. Coverage labels are validated by the full gate, manifest audit, and direct pixel-corpus gate, so typos cannot silently pass as evidence. Current candidate generation covers direct `.eff` sub-effect captures, parsed `CMPPartSys` particle-system captures, version-8 `ParFile.models` / `CChaModel` character-model particle captures, embedded `magicScenario` primary flight-effect captures, in-flight `MagicSingleinfo.particles[]` captures at the moved particle-controller position, and `magicScenario` hit/result particle captures at the computed arrival transform with arrival direction threaded into source-style modelDir/setDir particle visuals; full pixel parity still needs original-client source BMPs and real corpus coverage for these modes.

For a rendered-capture corpus, use a manifest:

```json
{
  "schema": "pko-effect-pixel-corpus/v1",
  "channelTolerance": 0,
  "maxDifferentPixels": 0,
  "coverage": {
    "effectFeatures": [
      "alpha",
      "transparentBlackAlpha",
      "billboard",
      "rotaBoard",
      "rotaLoop",
      "frameTexture",
      "uvAnimation",
      "builtinRect",
      "builtinRectPlane",
      "builtinCylinder",
      "externalLgo",
      "useParam",
      "groupRotation",
      "magicTargetOrientation"
    ],
    "particleTypes": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
    "particleFeatures": ["characterModel"],
    "magicSingleRenderIdx": [0, 2, 3, 4, 5, 6],
    "magicGroupRenderIdx": [0, 1]
  },
  "cases": [
    {
      "name": "00000002.eff at 0.5s",
      "source": "original-client/00000002-0.5.bmp",
      "candidate": "pko-tools/00000002-0.5.bmp",
      "diff": "diffs/00000002-0.5.bmp",
      "sourceCapture": {
        "effectId": 2,
        "time": 0.5
      },
      "candidateCapture": {
        "effectJson": "parsed/00000002.json",
        "textureBundle": "parsed/00000002-textures.json",
        "modelBundle": "parsed/00000002-models.json",
        "time": 0.5,
        "width": 512,
        "height": 512
      }
    }
  ]
}
```

Run it with:

```powershell
pnpm test:effect-pixel-corpus -- --manifest captures/effect-pixel-corpus.json
```

The manifest paths resolve relative to the manifest file. When `candidateCapture` is present, the pixel corpus gate regenerates the pko-tools BMP with `scripts/effect-tools-capture.mjs` before diffing and passes `--fail-on-skipped` by default, so missing external `.lgo` bundles cannot silently pass as incomplete candidate images. When `sourceCapture` is present, the gate validates the original-client capture parameters and echoes them into the report so each source BMP remains tied to a reproducible source command. Direct particle cases must include `sourceCapture.parName`, which the source runner emits as `effect_capture_par=...` so `.par` goldens do not rely on an unrelated scene-effect id. Dummy-line particle cases may also include `sourceCapture.dummy1` and `sourceCapture.dummy2`; the capture worktree wires those to `effect_capture_dummy1=...` / `effect_capture_dummy2=...` and a capture-only `CMPPartSys::SetCaptureDummySpan` hook so type-16 `DUMMY` evidence exercises the same `_vDummyPos`, `_vDummyDir`, and `_fDummyDist` runtime branch without requiring a noisy item-scene launch. This gate is intentionally separate from `pnpm test:effect-parity-local` until the original-client BMP corpus exists, because running it without real source/client images would be false confidence.

Coverage for the strict full parity gate must be declared on rendered cases with `case.coverage` using the same keys. Global manifest coverage may be kept as human-readable summary metadata, but `pnpm test:effect-parity-full -- --validate-only` only accepts case-level coverage so a manifest cannot pass by declaring branches that are not tied to concrete BMP pairs. Any case that declares rendered coverage must also include an existing original-client source BMP plus `sourceCapture` metadata with the original-client capture parameters used to reproduce that BMP. Cases covering `effectFeatures` must include an existing `candidateCapture.effectJson`, texture-dependent effect features (`alpha`, `transparentBlackAlpha`, `frameTexture`, `uvAnimation`) must include an existing `candidateCapture.textureBundle`, cases covering `externalLgo` must include an existing `candidateCapture.modelBundle`, cases covering `particleTypes` must include an existing `candidateCapture.parJson`, and direct `candidateCapture.parJson` cases must include `sourceCapture.parName` so the original-client BMP is tied to the same `.par` file instead of an unrelated scene-effect id. Particle coverage containing model-backed types (`3`, `5`, `6`, `8`, `10`, `11`, `12`, `16`, `17`, `18`) must include an existing `candidateCapture.modelBundle`. Magic render-index cases must include an existing `candidateCapture.magicScenario`, ensuring pko-tools candidate images are reproducible from parsed inputs rather than opaque BMP files. Unknown effect feature labels, particle type ids outside `1..18`, and unsupported magic render indices are rejected instead of being treated as harmless manifest notes. `scripts/effect-pixel-corpus-gate.mjs` now regenerates pko-tools `parJson` BMP candidates for the first ring-only particle capture slice (`RANGE`/`RANGE2`), type-5 `MODEL` particle captures with bundled `.lgo` geometry including source frame color/size/angle animation, `modelDir` orientation, and low-alpha texture-bundle A4R4G4B4 discard coverage, type-3 `BLAST` plus type-11 `BLAST3` model particles after deterministic lifecycle stepping, type-10 `BLAST2` particles with the custom source frame-advance branch, type-9 `ROUND` particles with reset/wrap lifecycle stepping, type-8 `ARROW` particles with single-particle reset lifecycle stepping, type-12 `SHRINK` particles with deterministic target-seeking movement, type-2 `FIRE` particles after dead-slot step emission, type-1 `SNOW` particles after source-style dead-slot step emission and zero-Z spawn rejection handling, type-4 `RIPPLE` particles after source-primed step emission, type-7 `WIND` particles after dead-slot step emission with deterministic spawn/origin tracking for spiral movement, type-6 `STRIP` particles as fixed frame-0 model particles at source base placement, type-13 `SHADE` particles as fixed-size ground decals with source frame color timing, and dummy-span model particles for type-16 `DUMMY`, type-17 `LINE_SINGLE`, and type-18 `LINE_ROUND` using explicit `dummyLineSpan` metadata in the parsed particle JSON. The headless capture tests also include asymmetric model BMP regressions for direct `MODEL modelDir`, ARROW's no-frame-angle branch, SHRINK's source RotatingXZ branch, low-alpha particle texture discard, and magic hit/result modelDir `setDir` orientation so these branches cannot pass by only lighting the center pixel. The same gate also regenerates embedded `magicScenario` BMP candidates for primary magic flight `.eff` models using the source-style render-index flight transform helpers, for in-flight `MagicSingleinfo.particles[]` `.par` effects at source `MoveTo` positions, and for hit/result `.par` effects using the computed arrival position plus source `_vDir`/`setDir` modelDir orientation. Required unknown particle system types, missing embedded magic `.eff` records, missing embedded in-flight magic `.par` records, and missing embedded magic result `.par` records still fail through `--fail-on-skipped`; original-client goldens are still required before claiming parity.

Before generating original-client rendered captures, run:

```powershell
pnpm test:effect-source-capture-preflight -- --source-root "E:\gamedev\mp-client-source"
```

This verifies that the effect corpus exists, the C++ client still has the `MPRender::CaptureScreen(char*)` backbuffer capture path, the deterministic `effect_capture_id=` and `effect_capture_par=` command entrypoints, capture-only DUMMY particle span wiring, fixed-tick frame stepping, requested BMP output wiring, minimal renderable capture-scene initialization, and no local `CMPModelEff::Render` debug overlay/dump contamination. As of the latest local check, `E:\gamedev\mp-client-source` fails this preflight because `Engine/sdk/src/MPModelEff.cpp` contains debug render overlay and hardcoded `E:\gamedev\effect_dumps` dump code. Do not use captures from that checkout for golden pixel parity until those local debug edits are removed or fully disabled for capture builds.

To avoid reverting local source edits, use a detached clean worktree for capture builds and point the preflight at the real asset corpus:

```powershell
cd E:\gamedev\mp-client-source
git worktree add --detach E:\gamedev\mp-client-source-effect-capture HEAD

cd E:\gamedev\pko-tools
pnpm test:effect-source-capture-preflight -- `
  --source-root "E:\gamedev\mp-client-source-effect-capture" `
  --effect-corpus-root "E:\gamedev\mp-client-source\Client\client\effect"
```

The current detached capture worktree at `E:\gamedev\mp-client-source-effect-capture` passes this stricter preflight when paired with the original asset corpus, including the capture harness checks. `devenv.com` is not usable in this environment because Visual Studio reports invalid license data, but the solution builds through MSBuild:

```powershell
& "C:\Program Files\Microsoft Visual Studio\2022\Community\MSBuild\Current\Bin\MSBuild.exe" `
  "E:\gamedev\mp-client-source-effect-capture\Client\proj\kop.sln" `
  /p:Configuration=Release `
  /p:Platform=x86 `
  /m `
  /v:minimal
```

That produces a clean `Client\bin\system\Game.exe`; the remaining capture task is running the deterministic launch path for fixed effect, magic, and direct particle cases and collecting golden BMPs without contaminating them with local debug rendering.

Audit the pixel manifest before launching anything:

```powershell
pnpm audit:effect-pixel-manifest -- `
  --manifest captures/effect-pixel-corpus.json `
  --source-root "E:\gamedev\mp-client-source-effect-capture" `
  --effect-corpus-root "E:\gamedev\mp-client-source\Client\client\effect"
```

The manifest audit prints one row per case with `captureMode`, missing original-client BMPs, missing pko-tools candidate inputs, a safe `sourceDryRunCommand`, a single-case `sourceLaunchCommand`, and the pko-tools `candidateCommand`. The launch command always includes `--case "..." --missing-only --allow-launch` and never includes `--allow-bulk-launch`, so copying one case from the audit cannot accidentally launch the whole manifest. It infers required `candidateCapture` fields from coverage using the same strict-gate rules, so effect feature cases require `effectJson`, texture features require `textureBundle`, external/model-backed cases require `modelBundle`, particle cases require `parJson`, and magic cases require `magicScenario`. It also reports the current `coverage` summary, `missingCoverage` against the strict full-gate branches, `unknownCoverage` labels, malformed `sourceCapture` and `candidateCapture` metadata, and bad numeric capture parameters so draft manifests expose missing files, missing render paths, typos, and bad capture parameters before source preflight or capture launch. Its `pass` flag is only true when `filesComplete`, `coverageComplete`, and `metadataValid` are all true; it is not just a loose informational report.

```powershell
pnpm capture:effect-source -- `
  --manifest captures/effect-pixel-corpus.json `
  --source-root "E:\gamedev\mp-client-source-effect-capture" `
  --effect-corpus-root "E:\gamedev\mp-client-source\Client\client\effect" `
  --case "00000002.eff at 0.5s" `
  --missing-only `
  --dry-run
```

Use `--case` while bringing up a new corpus so only one named case is launched or dry-run at a time. Use `--missing-only` for normal corpus fill-in passes so existing source BMPs are reported as skipped instead of relaunched. The runner refuses to start `Game.exe` unless `--allow-launch` is present, and launch mode also requires `--case` unless `--allow-bulk-launch` is explicitly present. That means the safe default is to dry-run first, inspect the command report, then rerun the selected case with `--case "..." --missing-only --allow-launch` for an intentional single golden-capture pass. Only use `--allow-bulk-launch` when deliberately regenerating or filling the whole source corpus. The runner preflights the source tree first, resolves each case's `source` path relative to the manifest, reports whether the C++ capture path is `scene-effect` (`effectId < 1000` or `>= 3000`), `magic` (`1000 <= effectId < 3000`), or direct `particle` (`sourceCapture.parName`), and passes `effect_capture_id`, optional `effect_capture_par`, `effect_capture_time`, optional `effect_capture_start`, optional `effect_capture_target`, optional `effect_capture_dummy1`, optional `effect_capture_dummy2`, and `effect_capture_out` to the clean client's deterministic capture entrypoint. `effect_capture_out` is value-quoted when the resolved output path contains spaces, matching the source-side `ReadCommandValue` parser.

## First Slices

1. Add `EFFECT_FRAMETEX` texture switching to the current effect workbench renderer.
   - Reason: C++ behavior is clear, item renderer already implements it, and current workbench renderer has a direct gap.
   - Gate: failing renderer test proving frame-texture timeline selection, then passing test after implementation.

2. Fix or confirm magic flight direction math.
   - Reason: `FlightPathController` has a suspicious zero-vector direction calculation.
   - Gate: path test for non-zero source-to-target orientation and arrival timing.

3. Build a reference-case list for all particle system types.
   - Reason: all particle types route to components, but many are approximations without per-type evidence.
   - Gate: one representative `.par` asset per type, documented expected C++ behavior, and current pko-tools status.

4. External `.lgo` sub-effect rendering.
   - Reason: C++ loads named meshes for non-built-in models; current workbench drops them.
   - Gate: known `.eff` with external model sub-effect renders an imported mesh at correct transform.

## Open Input Needed

Can the original client be run to generate golden captures and `pko-effect-trace/v1` C++ state dumps?

If yes, the next infrastructure task is a deterministic capture mode in the client and matching pko-tools trace export. If no, parity status must distinguish source-derived confidence from golden-captured proof.
