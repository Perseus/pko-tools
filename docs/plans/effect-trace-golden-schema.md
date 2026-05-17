# Effect Trace Golden Schema

This is the deterministic JSON contract for comparing pko-tools effect playback against the original PKO C++ client.

## Schema

Golden trace files use:

```json
{
  "schema": "pko-effect-trace/v1",
  "source": "mp-client",
  "coordinateSystem": "pko-z-up",
  "effectName": "lighty.eff",
  "sampleTimes": [0, 0.1, 0.2, 0.5, 1, 1.5, 2, 3],
  "frames": []
}
```

`coordinateSystem` must be `pko-z-up`. Do not dump Three.js/glTF Y-up vectors from the original-client side; the comparison layer is intentionally validating the raw PKO runtime space.

## Frame Fields

Each frame records:

- `time`: requested sample time in seconds.
- `localTime`: effect-local playback time after looping or clamping.
- `idxTech`: `.eff` technique index.
- `groupQuaternion`: file-level group rotation as `[x, y, z, w]`.
- `subEffects`: one entry per `.eff` sub-effect in file order.

Each `subEffects[]` entry records:

- `index`, `effectName`, `modelName`, `textureName`
- `frameIndex`, `nextFrameIndex`, `lerp`, `texFrameIndex`
- `position`, `scale`, `angle`, `color`
- `localMatrix`: the Direct3D row-major local transform matrix from `CEffectCortrol::GetTransformMatrix`, serialized as four matrix rows. This is intentionally not a Three.js matrix; it catches row/column, yaw/pitch/roll, scale-rotation order, and translation-row regressions before any renderer coordinate conversion is applied.
- `renderState`: Direct3D-style PKO state, including `zEnable`, `zWriteEnable`, `alphaBlendEnable`, `alphaTestEnable`, `alphaRef`, `alphaFunc`, `cullMode`, `minFilter`, `magFilter`, `addressU`, `addressV`, `srcBlend`, and `destBlend`.
- `material`: pko-tools Three.js material projection. This is useful for local regressions, but original-client parity should primarily trust `renderState` for source dumps.

## Workflow

1. In pko-tools v2, select the same `.eff` and export `Trace JSON`.
2. In the instrumented C++ client, dump the same sample times, camera, effect origin, target, loop mode, and file.
3. Parse the C++ artifact with `parseEffectTraceArtifactJson`.
4. Compare it to pko-tools output with `diffEffectTraceArtifactJson`.
5. Treat any transform, texture, frame-selection, color, or `renderState` diff as a parity failure until source code explains the difference.

The current pko-tools parser also accepts older raw `{ sampleTimes, frames }` exports, but new captures should use `schema: "pko-effect-trace/v1"` so coordinate-system and source metadata are explicit.

## Local Golden Gate

When both artifacts exist on disk, run:

```powershell
$env:PKO_EFFECT_TRACE_GOLDEN = "E:\path\mp-client-lighty.trace.json"
$env:PKO_EFFECT_TRACE_ACTUAL = "E:\path\pko-tools-lighty.trace.json"
pnpm vitest run src/features/effect-v2/__tests__/effectTraceGolden.test.ts
```

Without those environment variables, the golden test is skipped. With them, any non-empty diff fails the test and prints the mismatched path through Vitest's assertion output.

For a corpus directory, generate matching JSON filenames under two directories and run:

```powershell
$env:PKO_EFFECT_TRACE_GOLDEN_DIR = "E:\path\source-traces"
$env:PKO_EFFECT_TRACE_ACTUAL_DIR = "E:\path\pko-tools-traces"
pnpm vitest run src/features/effect-v2/__tests__/effectTraceGolden.test.ts
```

Or generate and compare both sides in one command:

```powershell
pnpm test:effect-trace-corpus -- `
  --effect-dir "E:\gamedev\mp-client-source\Client\client\effect" `
  --source-dumper "E:\gamedev\mp-client-source\Client\client\system\pko_ref_dump.exe" `
  --tools-dumper "E:\gamedev\pko-tools\src-tauri\target\debug\examples\effect_trace_dump.exe"
```

The local full-corpus gate has been run against `E:\gamedev\mp-client-source\Client\client\effect` with 1178 `.eff` files and sample times `0,0.1,0.2,0.5,1.0`. Both dumpers generated 1178 artifacts with 0 failures, and the directory golden diff passed with `localMatrix` included.

The corpus gate has also been rerun after aligning legacy constructor defaults from `I_Effect::I_Effect`: version <= 5 sub-effects default `alpha=true`, and version <= 6 sub-effects default `rotaBoard=true` when the fields are absent from the file. This guards the older-effect regressions where transparent particle textures can render as opaque black quads or billboard rotation can diverge.

## Source-Side Dumper

`E:/gamedev/mp-client-source/Engine/tools/ref_dump/main.cpp` now parses arbitrary `.eff` files using the `I_Effect::LoadFromFile` binary layout and emits `pko-effect-trace/v1` JSON. Build it with:

```powershell
& "C:\Program Files\Microsoft Visual Studio\2022\Community\MSBuild\Current\Bin\MSBuild.exe" `
  "E:\gamedev\mp-client-source\Engine\tools\ref_dump\ref_dump.vcxproj" `
  /p:Configuration=Release /p:Platform=Win32 /m
```

Example source trace:

```powershell
& "E:\gamedev\mp-client-source\Client\client\system\pko_ref_dump.exe" `
  "E:\gamedev\mp-client-source\Client\client\effect\00000002.eff" `
  "E:\gamedev\pko-tools\exports\effect-trace-refdump-00000002.json" `
  --times 0,0.1,0.2
```

The standalone dumper is useful for deterministic frame, texture, transform matrix, color, and blend-state comparison. It is still not a complete replacement for a live original-client capture because it does not exercise actual D3D effect technique state, asset loading failure behavior, device render ordering, or pixel output. Full parity proof still needs either:

- a real `I_Effect`/`CMPModelEff` instrumentation path that dumps this schema after `FrameMove`, or
- a visual capture path from the running original client at the same timestamps.

Until pko-tools exports are diffed against source traces and pixel captures, this remains source-derived regression evidence, not full golden-captured parity proof.
