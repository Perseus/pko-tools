#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultRepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const repoRoot = resolve(args.repoRoot ?? defaultRepoRoot);
const sourceRoot = resolve(args.sourceRoot ?? process.env.PKO_CLIENT_SOURCE_ROOT ?? "E:/gamedev/mp-client-source");

const PARTICLE_NAME_MAP = new Map([
  ["SNOW", "SNOW"],
  ["FIRE", "FIRE"],
  ["BLAST", "BLAST"],
  ["RIPPLE", "RIPPLE"],
  ["MODEL", "MODEL"],
  ["STRIP", "STRIP"],
  ["WIND", "WIND"],
  ["ARRAW", "ARROW"],
  ["ROUND", "ROUND"],
  ["BLAST2", "BLAST2"],
  ["BLAST3", "BLAST3"],
  ["SHRINK", "SHRINK"],
  ["SHADE", "SHADE"],
  ["RANGE", "RANGE"],
  ["RANGE2", "RANGE2"],
  ["DUMMY", "DUMMY"],
  ["LINE_SINGLE", "LINE_SINGLE"],
  ["LINE_ROUND", "LINE_ROUND"],
]);

const MAGIC_PATH_MAP = new Map([
  ["Part_drop", "drop"],
  ["Part_fly", "fly"],
  ["Part_trace", "trace"],
  ["Part_fshade", "fshade"],
  ["Part_arc", "arc"],
  ["Part_dirlight", "dirlight"],
  ["Part_dist", "dist"],
]);

const GROUP_MODE_MAP = new Map([
  ["Part_fan", "fan"],
  ["Part_sequence", "sequence"],
]);

const EFFECT_TYPE_COVERAGE = new Map([
  ["EFFECT_NONE", "base"],
  ["EFFECT_FRAMETEX", "frameTexture"],
  ["EFFECT_MODELUV", "uvCoords"],
  ["EFFECT_MODELTEXTURE", "uvTextureFrames"],
  ["EFFECT_MODEL", "externalModel"],
]);

if (args.help) {
  printHelp();
  process.exit(0);
}

const failures = [];

const sourceParticleHeader = requiredFile(sourceRoot, "Engine/sdk/include/MPParticleSys.h");
const sourceParticleImpl = requiredFile(sourceRoot, "Engine/sdk/src/MPParticleSys.cpp");
const sourceEffectHeader = requiredFile(sourceRoot, "Engine/sdk/include/I_Effect.h");
const sourceEffectImpl = requiredFile(sourceRoot, "Engine/sdk/src/I_Effect.cpp");
const sourceModelEffectImpl = requiredFile(sourceRoot, "Engine/sdk/src/MPModelEff.cpp");
const sourceModelEffectHeader = requiredFile(sourceRoot, "Engine/sdk/include/MPModelEff.h");
const sourceMagicCtrlImpl = requiredFile(sourceRoot, "Engine/sdk/src/MPEffectCtrl.cpp");
const sourceEffectObj = requiredFile(sourceRoot, "Client/src/EffectObj.cpp");
const sourceResManager = requiredFile(sourceRoot, "Engine/sdk/src/MPResManger.cpp");
const sourceEffectShader = requiredFile(sourceRoot, "Client/client/shader/dx8/eff.fx");
const sourceTexUtil = requiredFile(sourceRoot, "Engine/sdk/src/lwIUtil.cpp");
const sourceTexResource = requiredFile(sourceRoot, "Engine/sdk/src/lwResourceMgr.cpp");
const sourceTexTypes = requiredFile(sourceRoot, "Engine/sdk/include/lwITypes2.h");
const tsParticleTypes = requiredFile(repoRoot, "src/features/effect-v2/renderers/particles/types.ts");
const tsEffectV2Workbench = requiredFile(repoRoot, "src/features/effect-v2/EffectV2Workbench.tsx");
const tsParticleRenderer = requiredFile(repoRoot, "src/features/effect-v2/renderers/ParticleEffectRenderer.tsx");
const tsFlightController = requiredFile(repoRoot, "src/features/effect-v2/renderers/flight/FlightPathController.tsx");
const tsMagicGroupRenderer = requiredFile(repoRoot, "src/features/effect-v2/renderers/MagicGroupRenderer.tsx");
const tsParticleVisual = requiredFile(repoRoot, "src/features/effect-v2/renderers/particles/ParticleVisual.tsx");
const tsFrameTexture = requiredFile(repoRoot, "src/features/effect-v2/frameTexture.ts");
const tsApplySubEffectFrame = requiredFile(repoRoot, "src/features/effect/applySubEffectFrame.ts");
const tsEffectColor = requiredFile(repoRoot, "src/features/effect/color.ts");
const tsEffectRendering = requiredFile(repoRoot, "src/features/effect/rendering.ts");
const tsPkoStateEmulation = requiredFile(repoRoot, "src/features/effect/pkoStateEmulation.ts");
const tsMaterialProps = requiredFile(repoRoot, "src/features/effect/buildEffectMaterialProps.ts");
const tsUseEffectTexture = requiredFile(repoRoot, "src/features/effect-v2/useEffectTexture.ts");
const rustEffectModel = requiredFile(repoRoot, "src-tauri/src/effect/model.rs");
const rustParLoader = requiredFile(repoRoot, "src-tauri/src/effect/par_loader.rs");

const sourceParticleTypes = parseSourceParticleTypes(read(sourceParticleHeader));
const tsParticleTypeValues = parseTsParticleTypes(read(tsParticleTypes));
const tsParticleRendererText = read(tsParticleRenderer);
const sourceParticleHeaderText = read(sourceParticleHeader);
const sourceParticleImplText = read(sourceParticleImpl);

for (const sourceType of sourceParticleTypes) {
  const tsName = PARTICLE_NAME_MAP.get(sourceType.sourceName);
  if (!tsName) {
    failures.push(`No pko-tools ParticleType mapping exists for C++ PARTTICLE_${sourceType.sourceName}.`);
    continue;
  }
  if (tsParticleTypeValues.get(tsName) !== sourceType.value) {
    failures.push(
      `ParticleType.${tsName} must equal C++ PARTTICLE_${sourceType.sourceName} (${sourceType.value}).`,
    );
  }
  const dispatchPattern = new RegExp(`case\\s+ParticleType\\.${escapeRegExp(tsName)}\\s*:`);
  if (!dispatchPattern.test(tsParticleRendererText)) {
    failures.push(`ParticleEffectRenderer is missing dispatch for ParticleType.${tsName}.`);
  }
}

const particleImplementations = sourceParticleTypes.map((sourceType) =>
  validateParticleImplementationCoverage(
    sourceType,
    sourceParticleHeaderText,
    sourceParticleImplText,
    repoRoot,
  )
);

const sequentialValues = sourceParticleTypes.map((entry) => entry.value).sort((a, b) => a - b);
const expectedSequentialValues = Array.from({ length: sourceParticleTypes.length }, (_, index) => index + 1);
if (JSON.stringify(sequentialValues) !== JSON.stringify(expectedSequentialValues)) {
  failures.push(
    `C++ particle type ids must be sequential 1..${sourceParticleTypes.length}; got ${sequentialValues.join(",")}.`,
  );
}

const effectObjText = read(sourceEffectObj);
const sourceMagicList = parseFunctionTable(effectObjText, "MagicList");
const sourceGroupList = parseFunctionTable(effectObjText, "GroupList");
const tsFlightPaths = parseFlightPaths(read(tsFlightController));
const magicFlightPaths = sourceMagicList.map((entry) => MAGIC_PATH_MAP.get(entry) ?? `unknown:${entry}`);
const magicGroupModes = sourceGroupList.map((entry) => GROUP_MODE_MAP.get(entry) ?? `unknown:${entry}`);

for (const [index, expectedPath] of magicFlightPaths.entries()) {
  if (expectedPath.startsWith("unknown:")) {
    failures.push(`No pko-tools magic flight mapping exists for C++ ${sourceMagicList[index]}.`);
    continue;
  }
  if (tsFlightPaths[index] !== expectedPath) {
    failures.push(
      `Magic flight path index ${index} must map to C++ ${sourceMagicList[index]} (${expectedPath}); got ${tsFlightPaths[index] ?? "missing"}.`,
    );
  }
}

if (tsFlightPaths.length !== magicFlightPaths.length) {
  failures.push(
    `FlightPathController FLIGHT_PATHS length must match C++ MagicList[] length ${magicFlightPaths.length}; got ${tsFlightPaths.length}.`,
  );
}

for (const [index, expectedMode] of magicGroupModes.entries()) {
  if (expectedMode.startsWith("unknown:")) {
    failures.push(`No pko-tools magic group mapping exists for C++ ${sourceGroupList[index]}.`);
    continue;
  }
  const constant = expectedMode === "fan" ? "GROUP_MODE_FAN" : "GROUP_MODE_SEQUENCE";
  const constantPattern = new RegExp(`const\\s+${constant}\\s*=\\s*${index}\\s*;`);
  if (!constantPattern.test(read(tsMagicGroupRenderer))) {
    failures.push(`MagicGroupRenderer ${constant} must equal C++ GroupList[] index ${index}.`);
  }
}

if (!/default\s*:\s*return\s+null\s*;/.test(read(tsMagicGroupRenderer))) {
  failures.push("MagicGroupRenderer must return null for render_idx values outside C++ GroupList[].");
}

const effectHeaderText = read(sourceEffectHeader);
const tsFrameTextureText = read(tsFrameTexture);
const tsApplySubEffectFrameText = read(tsApplySubEffectFrame);
const tsEffectRenderingText = read(tsEffectRendering);
const sourceEffectTypes = parseEffectTypes(effectHeaderText);
const effectTypes = sourceEffectTypes.map((entry) => ({
  sourceName: entry.sourceName,
  value: entry.value,
  tsCoverage: EFFECT_TYPE_COVERAGE.get(entry.sourceName) ?? null,
}));

for (const effectType of sourceEffectTypes) {
  validateEffectTypeCoverage(effectType, {
    tsFrameTextureText,
    tsApplySubEffectFrameText,
    tsEffectRenderingText,
  });
}

const effectMeshes = parseEffectMeshes(effectHeaderText);
validateEffectMeshCoverage(effectMeshes, tsEffectRenderingText);

const effectShaderPath = parseEffectShaderPath(read(sourceResManager));
if (effectShaderPath !== "shader\\dx8\\eff.fx") {
  failures.push(`CMPResManger must load shader\\dx8\\eff.fx for effect rendering; got ${effectShaderPath ?? "missing"}.`);
}
const renderTechniques = parseFxTechniques(read(sourceEffectShader));
const tsTechniqueStates = parseTsTechniqueStates(read(tsPkoStateEmulation));
validateTechniqueCoverage(renderTechniques, tsTechniqueStates);

const alphaMaterialPaths = validateAlphaMaterialCoverage({
  sourceEffectImplText: read(sourceEffectImpl),
  sourceModelEffectImplText: read(sourceModelEffectImpl),
  sourceParticleImplText: read(sourceParticleImpl),
  rustEffectModelText: read(rustEffectModel),
  tsEffectColorText: read(tsEffectColor),
  tsApplySubEffectFrameText: read(tsApplySubEffectFrame),
  tsParticleVisualText: read(tsParticleVisual),
  tsMaterialPropsText: read(tsMaterialProps),
});

const textureUploadPath = validateEffectTextureUploadCoverage({
  sourceResManagerText: read(sourceResManager),
  sourceTexUtilText: read(sourceTexUtil),
  sourceTexResourceText: read(sourceTexResource),
  sourceTexTypesText: read(sourceTexTypes),
  tsUseEffectTextureText: read(tsUseEffectTexture),
});

const billboardTransformPaths = validateBillboardTransformCoverage({
  sourceResManagerText: read(sourceResManager),
  sourceModelEffectImplText: read(sourceModelEffectImpl),
  sourceParticleImplText: read(sourceParticleImpl),
  tsApplySubEffectFrameText: read(tsApplySubEffectFrame),
  tsParticleVisualText: read(tsParticleVisual),
});

const particleBuiltinMeshes = validateParticleBuiltinMeshCoverage({
  sourceResManagerText: read(sourceResManager),
  sourceEffectHeaderText: effectHeaderText,
  tsParticleVisualText: read(tsParticleVisual),
});

const particleResourceBindingPath = validateParticleResourceBindingCoverage({
  sourceParticleImplText: read(sourceParticleImpl),
  tsParticleVisualText: read(tsParticleVisual),
});

const particlePlaybackPath = validateParticlePlaybackCoverage({
  sourceParticleHeaderText: read(sourceParticleHeader),
  sourceParticleImplText: read(sourceParticleImpl),
  tsParticleVisualText: read(tsParticleVisual),
  tsEffectV2WorkbenchText: read(tsEffectV2Workbench),
  tsParticleRendererText: read(tsParticleRenderer),
  tsParticleLifecycleText: read(join(repoRoot, "src/features/effect-v2/renderers/particles/useParticleLifecycle.ts")),
  tsRangeSystemText: read(join(repoRoot, "src/features/effect-v2/renderers/particles/RangeSystem.tsx")),
  tsRange2SystemText: read(join(repoRoot, "src/features/effect-v2/renderers/particles/Range2System.tsx")),
  tsRangeKinematicsText: read(join(repoRoot, "src/features/effect-v2/renderers/particles/rangeKinematics.ts")),
  tsSnowSystemText: read(join(repoRoot, "src/features/effect-v2/renderers/particles/SnowSystem.tsx")),
  tsFireSystemText: read(join(repoRoot, "src/features/effect-v2/renderers/particles/FireSystem.tsx")),
  tsShrinkSystemText: read(join(repoRoot, "src/features/effect-v2/renderers/particles/ShrinkSystem.tsx")),
  tsDummySystemText: read(join(repoRoot, "src/features/effect-v2/renderers/particles/DummySystem.tsx")),
  tsDummyLineKinematicsText: read(join(repoRoot, "src/features/effect-v2/renderers/particles/dummyLineKinematics.ts")),
  tsBlast2SystemText: read(join(repoRoot, "src/features/effect-v2/renderers/particles/Blast2System.tsx")),
  tsBlast3SystemText: read(join(repoRoot, "src/features/effect-v2/renderers/particles/Blast3System.tsx")),
});

const particleModelDirPath = validateParticleModelDirCoverage({
  sourceParticleHeaderText: read(sourceParticleHeader),
  sourceParticleImplText: read(sourceParticleImpl),
  tsParticleVisualText: read(tsParticleVisual),
  tsFireSystemText: read(join(repoRoot, "src/features/effect-v2/renderers/particles/FireSystem.tsx")),
  tsFireKinematicsText: read(join(repoRoot, "src/features/effect-v2/renderers/particles/fireKinematics.ts")),
});

const particleModelPlacementPath = validateParticleModelPlacementCoverage({
  sourceParticleImplText: read(sourceParticleImpl),
  sourceModelEffectImplText: read(sourceModelEffectImpl),
  tsModelKinematicsText: read(join(repoRoot, "src/features/effect-v2/renderers/particles/modelKinematics.ts")),
  tsModelSystemText: read(join(repoRoot, "src/features/effect-v2/renderers/particles/ModelSystem.tsx")),
  tsParticleVisualText: read(tsParticleVisual),
  tsArrowKinematicsText: read(join(repoRoot, "src/features/effect-v2/renderers/particles/arrowKinematics.ts")),
  tsArrowSystemText: read(join(repoRoot, "src/features/effect-v2/renderers/particles/ArrowSystem.tsx")),
  tsStripKinematicsText: read(join(repoRoot, "src/features/effect-v2/renderers/particles/stripKinematics.ts")),
  tsStripSystemText: read(join(repoRoot, "src/features/effect-v2/renderers/particles/StripSystem.tsx")),
  tsStripRendererText: read(join(repoRoot, "src/features/effect-v2/renderers/StripRenderer.tsx")),
  tsShadeKinematicsText: read(join(repoRoot, "src/features/effect-v2/renderers/particles/shadeKinematics.ts")),
  tsShadeSystemText: read(join(repoRoot, "src/features/effect-v2/renderers/particles/ShadeSystem.tsx")),
  tsRoundKinematicsText: read(join(repoRoot, "src/features/effect-v2/renderers/particles/roundKinematics.ts")),
  tsRoundSystemText: read(join(repoRoot, "src/features/effect-v2/renderers/particles/RoundSystem.tsx")),
});

const standaloneStripPath = validateStandaloneStripCoverage({
  sourceModelEffectImplText: read(sourceModelEffectImpl),
  sourceModelEffectHeaderText: read(sourceModelEffectHeader),
  tsStripRendererText: read(join(repoRoot, "src/features/effect-v2/renderers/StripRenderer.tsx")),
  tsStripTrailKinematicsText: read(join(repoRoot, "src/features/effect-v2/renderers/stripTrailKinematics.ts")),
  tsStripTrailTestText: read(join(repoRoot, "src/features/effect-v2/__tests__/StripTrailKinematics.test.ts")),
  rustParLoaderText: read(rustParLoader),
});

const magicOrientationPath = validateMagicOrientationCoverage({
  sourceMagicCtrlImplText: read(sourceMagicCtrlImpl),
  sourceEffectObjText: effectObjText,
  tsFlightControllerText: read(tsFlightController),
  tsTracePathText: read(join(repoRoot, "src/features/effect-v2/renderers/flight/paths/trace.ts")),
  tsDropPathText: read(join(repoRoot, "src/features/effect-v2/renderers/flight/paths/drop.ts")),
  tsFlyPathText: read(join(repoRoot, "src/features/effect-v2/renderers/flight/paths/fly.ts")),
  tsFshadePathText: read(join(repoRoot, "src/features/effect-v2/renderers/flight/paths/fshade.ts")),
  tsArcPathText: read(join(repoRoot, "src/features/effect-v2/renderers/flight/paths/arc.ts")),
  tsDirlightPathText: read(join(repoRoot, "src/features/effect-v2/renderers/flight/paths/dirlight.ts")),
  tsDistPathText: read(join(repoRoot, "src/features/effect-v2/renderers/flight/paths/dist.ts")),
});

const report = {
  schema: "pko-effect-source-parity-gate/v1",
  sourceRoot,
  repoRoot,
  pass: failures.length === 0,
  failures,
  particleTypes: sourceParticleTypes.map((entry) => ({
    sourceName: entry.sourceName,
    tsName: PARTICLE_NAME_MAP.get(entry.sourceName) ?? null,
    value: entry.value,
  })),
  particleImplementations,
  magicFlightPaths,
  magicGroupModes,
  effectTypes,
  effectMeshes,
  effectShaderPath,
  renderTechniques,
  alphaMaterialPaths,
  textureUploadPath,
  billboardTransformPaths,
  particleBuiltinMeshes,
  particleResourceBindingPath,
  particlePlaybackPath,
  particleModelDirPath,
  particleModelPlacementPath,
  standaloneStripPath,
  magicOrientationPath,
};

console.log(JSON.stringify(report, null, 2));
process.exit(report.pass ? 0 : 1);

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") continue;
    switch (arg) {
      case "--source-root":
        parsed.sourceRoot = requireValue(argv, ++i, arg);
        break;
      case "--repo-root":
        parsed.repoRoot = requireValue(argv, ++i, arg);
        break;
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return parsed;
}

function requireValue(argv, index, arg) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${arg}`);
  }
  return value;
}

function printHelp() {
  console.log(`Usage:
  node scripts/effect-source-parity-gate.mjs --source-root E:/gamedev/mp-client-source

Optional:
  --repo-root <path>       Override pko-tools checkout root for tests

Checks:
  - C++ PARTTICLE_* ids from MPParticleSys.h match ParticleType constants and dispatch
  - C++ MagicList[] entries match FlightPathController FLIGHT_PATHS order
  - C++ GroupList[] entries match MagicGroupRenderer modes and unknown indices do not fall back
  - C++ EFFECT_TYPE enum and built-in effect mesh names from I_Effect.h have matching render branches
  - C++ shader/dx8/eff.fx technique render states match pkoStateEmulation.ts
  - C++ texture-factor color/alpha render paths and effect texture upload paths match TS/Rust renderer assumptions`);
}

function requiredFile(root, relativePath) {
  const path = join(root, relativePath);
  if (!existsSync(path)) {
    failures.push(`Missing required file: ${path}`);
  }
  return path;
}

function read(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function parseSourceParticleTypes(text) {
  const matches = [...text.matchAll(/#define\s+PARTTICLE_([A-Z0-9_]+)\s+(\d+)/g)];
  return matches
    .map((match) => ({ sourceName: match[1], value: Number(match[2]) }))
    .filter((entry) => PARTICLE_NAME_MAP.has(entry.sourceName));
}

function validateParticleImplementationCoverage(sourceType, sourceHeaderText, sourceImplText, root) {
  const tsName = PARTICLE_NAME_MAP.get(sourceType.sourceName);
  const cppSuffix = getParticleCppSuffix(sourceType.sourceName);
  const coverage = getParticleTsCoverage(tsName);

  const report = {
    sourceName: sourceType.sourceName,
    cppSuffix,
    tsName,
    systemFile: coverage?.systemFile ?? null,
    kinematicsFile: coverage?.kinematicsFile ?? null,
    testFile: coverage?.testFile ?? null,
  };

  if (!tsName || !coverage) {
    failures.push(`No pko-tools particle implementation coverage mapping exists for C++ PARTTICLE_${sourceType.sourceName}.`);
    return report;
  }

  const createPattern = new RegExp(`\\b_Create${cppSuffix}\\s*\\(`);
  const framePattern = new RegExp(`\\b_FrameMove${cppSuffix}\\s*\\(`);
  if (!createPattern.test(sourceHeaderText) || !createPattern.test(sourceImplText)) {
    failures.push(`C++ PARTTICLE_${sourceType.sourceName} must have _Create${cppSuffix} declared and implemented.`);
  }
  if (!framePattern.test(sourceHeaderText) || !framePattern.test(sourceImplText)) {
    failures.push(`C++ PARTTICLE_${sourceType.sourceName} must have _FrameMove${cppSuffix} declared and implemented.`);
  }

  const systemPath = join(root, "src/features/effect-v2/renderers/particles", coverage.systemFile);
  if (!existsSync(systemPath)) {
    failures.push(`C++ PARTTICLE_${sourceType.sourceName} must render through ${coverage.systemFile}.`);
  }

  const kinematicsPath = join(root, "src/features/effect-v2/renderers/particles", coverage.kinematicsFile);
  if (!existsSync(kinematicsPath)) {
    failures.push(`C++ PARTTICLE_${sourceType.sourceName} must have TS kinematics in src/features/effect-v2/renderers/particles/${coverage.kinematicsFile}.`);
  }

  const testPath = join(root, "src/features/effect-v2/__tests__", coverage.testFile);
  if (!existsSync(testPath)) {
    failures.push(`C++ PARTTICLE_${sourceType.sourceName} must have TS kinematics coverage in src/features/effect-v2/__tests__/${coverage.testFile}.`);
  }

  return report;
}

function getParticleCppSuffix(sourceName) {
  if (sourceName === "ARRAW") return "Arraw";
  return sourceName
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function getParticleTsCoverage(tsName) {
  const coverage = {
    SNOW: ["SnowSystem.tsx", "snowKinematics.ts", "SnowKinematics.test.ts"],
    FIRE: ["FireSystem.tsx", "fireKinematics.ts", "FireKinematics.test.ts"],
    BLAST: ["BlastSystem.tsx", "blastKinematics.ts", "BlastKinematics.test.ts"],
    RIPPLE: ["RippleSystem.tsx", "rippleKinematics.ts", "RippleKinematics.test.ts"],
    MODEL: ["ModelSystem.tsx", "modelKinematics.ts", "ModelKinematics.test.ts"],
    STRIP: ["StripSystem.tsx", "stripKinematics.ts", "StripKinematics.test.ts"],
    WIND: ["WindSystem.tsx", "windKinematics.ts", "WindKinematics.test.ts"],
    ARROW: ["ArrowSystem.tsx", "arrowKinematics.ts", "ArrowKinematics.test.ts"],
    ROUND: ["RoundSystem.tsx", "roundKinematics.ts", "RoundKinematics.test.ts"],
    BLAST2: ["Blast2System.tsx", "blastKinematics.ts", "BlastKinematics.test.ts"],
    BLAST3: ["Blast3System.tsx", "blastKinematics.ts", "BlastKinematics.test.ts"],
    SHRINK: ["ShrinkSystem.tsx", "shrinkKinematics.ts", "ShrinkKinematics.test.ts"],
    SHADE: ["ShadeSystem.tsx", "shadeKinematics.ts", "ShadeKinematics.test.ts"],
    RANGE: ["RangeSystem.tsx", "rangeKinematics.ts", "RangeKinematics.test.ts"],
    RANGE2: ["Range2System.tsx", "rangeKinematics.ts", "RangeKinematics.test.ts"],
    DUMMY: ["DummySystem.tsx", "dummyLineKinematics.ts", "DummyLineKinematics.test.ts"],
    LINE_SINGLE: ["LineSingleSystem.tsx", "dummyLineKinematics.ts", "DummyLineKinematics.test.ts"],
    LINE_ROUND: ["LineRoundSystem.tsx", "dummyLineKinematics.ts", "DummyLineKinematics.test.ts"],
  };
  const entry = coverage[tsName];
  if (!entry) return null;
  return {
    systemFile: entry[0],
    kinematicsFile: entry[1],
    testFile: entry[2],
  };
}

function parseTsParticleTypes(text) {
  const values = new Map();
  for (const match of text.matchAll(/\b([A-Z][A-Z0-9_]*)\s*:\s*(\d+)/g)) {
    values.set(match[1], Number(match[2]));
  }
  return values;
}

function parseFunctionTable(text, tableName) {
  const tableMatch = text.match(new RegExp(`${tableName}\\s*\\[[^\\]]*\\][\\s\\S]*?=\\s*\\{([\\s\\S]*?)\\}\\s*;`));
  if (!tableMatch) {
    failures.push(`Could not find C++ ${tableName}[] table.`);
    return [];
  }
  return tableMatch[1]
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, "").trim())
    .flatMap((line) => line.split(","))
    .map((entry) => entry.trim())
    .filter((entry) => /^Part_[A-Za-z0-9_]+$/.test(entry));
}

function parseFlightPaths(text) {
  const tableMatch = text.match(/FLIGHT_PATHS[^=]*=\s*\[([\s\S]*?)\]\s*;/);
  if (!tableMatch) {
    failures.push("Could not find FlightPathController FLIGHT_PATHS table.");
    return [];
  }
  return tableMatch[1]
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, "").trim())
    .flatMap((line) => line.split(","))
    .map((entry) => entry.trim())
    .filter((entry) => /^flight[A-Z][A-Za-z0-9_]*$/.test(entry))
    .map((entry) => entry.replace(/^flight/, ""))
    .map((entry) => entry.charAt(0).toLowerCase() + entry.slice(1));
}

function parseEffectTypes(text) {
  const enumMatch = text.match(/enum\s+EFFECT_TYPE\s*\{([\s\S]*?)\}\s*;/);
  if (!enumMatch) {
    failures.push("Could not find C++ EFFECT_TYPE enum.");
    return [];
  }

  return enumMatch[1]
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, "").trim())
    .flatMap((line) => line.split(","))
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const match = entry.match(/^(EFFECT_[A-Z0-9_]+)\s*=\s*(\d+)$/);
      if (!match) {
        failures.push(`Could not parse C++ EFFECT_TYPE entry: ${entry}.`);
        return null;
      }
      return { sourceName: match[1], value: Number(match[2]) };
    })
    .filter(Boolean);
}

function validateEffectTypeCoverage(effectType, texts) {
  const expectedCoverage = EFFECT_TYPE_COVERAGE.get(effectType.sourceName);
  if (!expectedCoverage) {
    failures.push(`No pko-tools EFFECT_TYPE coverage mapping exists for C++ ${effectType.sourceName}.`);
    return;
  }

  switch (effectType.sourceName) {
    case "EFFECT_NONE":
      if (effectType.value !== 0) {
        failures.push(`EFFECT_NONE must remain the base type id 0; got ${effectType.value}.`);
      }
      break;
    case "EFFECT_FRAMETEX":
      if (!new RegExp(`EFFECT_FRAMETEX\\s*=\\s*${effectType.value}\\b`).test(texts.tsFrameTextureText)) {
        failures.push(`frameTexture.ts EFFECT_FRAMETEX must equal C++ EFFECT_FRAMETEX (${effectType.value}).`);
      }
      if (!/effectType\s*!==\s*EFFECT_FRAMETEX/.test(texts.tsFrameTextureText)) {
        failures.push("resolveFrameTextureName must branch only for C++ EFFECT_FRAMETEX.");
      }
      break;
    case "EFFECT_MODELUV":
      if (!hasIfBranchForEffectType(texts.tsApplySubEffectFrameText, effectType.value, "coordList", "interpolateUVCoords")) {
        failures.push("applySubEffectFrame must handle C++ EFFECT_MODELUV (2) with coordList UV interpolation.");
      }
      break;
    case "EFFECT_MODELTEXTURE":
      if (!hasIfBranchForEffectType(texts.tsApplySubEffectFrameText, effectType.value, "texList", "getTexListFrameIndex")) {
        failures.push("applySubEffectFrame must handle C++ EFFECT_MODELTEXTURE (3) with texList UV frame selection.");
      }
      break;
    case "EFFECT_MODEL":
      if (!/type:\s*"model"\s*,\s*modelName/.test(texts.tsEffectRenderingText)) {
        failures.push("resolveGeometry must route C++ EFFECT_MODEL-style external model names to model geometry.");
      }
      if (new RegExp(`effectType\\s*(?:={2,3}|!={1,2})\\s*${effectType.value}\\b`).test(texts.tsApplySubEffectFrameText)) {
        failures.push("applySubEffectFrame must not suppress transforms or billboard behavior based on EFFECT_MODEL (4).");
      }
      break;
  }
}

function hasIfBranchForEffectType(text, effectTypeValue, requiredField, requiredCall) {
  const branchPattern = new RegExp(
    `if\\s*\\([^)]*effectType\\s*===\\s*${effectTypeValue}\\b[^)]*${requiredField}[\\s\\S]*?\\)\\s*\\{([\\s\\S]*?)\\n\\s*\\}`,
  );
  const branchMatch = text.match(branchPattern);
  return Boolean(branchMatch && branchMatch[1].includes(requiredCall));
}

function parseEffectMeshes(text) {
  const meshDefines = new Map();
  for (const match of text.matchAll(/#define\s+(MESH_[A-Z]+)\s+"([^"]+)"/g)) {
    meshDefines.set(match[1], match[2]);
  }

  const defaultMeshNames = parseMeshNameList(text, "IsDefaultMesh", meshDefines);
  const tobMeshNames = parseMeshExpression(text, "IsTobMesh", meshDefines);
  const createTobNames = parseCreateTobNames(text, meshDefines);
  const nonProceduralTob = tobMeshNames.filter((name) => !createTobNames.includes(name));
  const procedural = defaultMeshNames.filter((name) => !nonProceduralTob.includes(name));

  return { procedural, nonProceduralTob };
}

function parseMeshNameList(text, functionName, meshDefines) {
  const functionMatch = text.match(new RegExp(`${functionName}[\\s\\S]*?static\\s+s_string\\s+str\\[\\]\\s*=\\s*\\{([\\s\\S]*?)\\}`));
  if (!functionMatch) {
    failures.push(`Could not find C++ ${functionName} mesh list.`);
    return [];
  }
  return functionMatch[1]
    .split(/\r?\n/)
    .map((line) => line.replace(/\/\/.*$/, "").trim())
    .flatMap((line) => line.split(","))
    .map((entry) => entry.trim())
    .filter((entry) => /^MESH_[A-Z]+$/.test(entry))
    .map((entry) => meshDefines.get(entry) ?? `unknown:${entry}`);
}

function parseMeshExpression(text, functionName, meshDefines) {
  const functionMatch = text.match(new RegExp(`${functionName}[\\s\\S]*?return\\s*\\(([\\s\\S]*?)\\)\\s*;`));
  if (!functionMatch) {
    failures.push(`Could not find C++ ${functionName} expression.`);
    return [];
  }
  return [...functionMatch[1].matchAll(/MESH_[A-Z]+/g)]
    .map((match) => meshDefines.get(match[0]) ?? `unknown:${match[0]}`);
}

function parseCreateTobNames(text, meshDefines) {
  const functionMatch = text.match(/CreateTob[\s\S]*?\{([\s\S]*?)return\s+false\s*;/);
  if (!functionMatch) {
    failures.push("Could not find C++ CreateTob implementation.");
    return [];
  }
  return [...functionMatch[1].matchAll(/str\s*==\s*(MESH_[A-Z]+)/g)]
    .map((match) => meshDefines.get(match[1]) ?? `unknown:${match[1]}`);
}

function validateEffectMeshCoverage(effectMeshes, tsEffectRenderingText) {
  for (const meshName of effectMeshes.procedural) {
    if (!new RegExp(`"${escapeRegExp(meshName)}"`).test(tsEffectRenderingText)) {
      failures.push(`resolveGeometry is missing C++ procedural effect mesh "${meshName}".`);
    }
  }

  for (const meshName of effectMeshes.nonProceduralTob) {
    const builtinSetMatch = tsEffectRenderingText.match(/BUILTIN_NAMES\s*=\s*new\s+Set\s*\(\s*\[([\s\S]*?)\]\s*\)/);
    if (builtinSetMatch && new RegExp(`"${escapeRegExp(meshName)}"`).test(builtinSetMatch[1])) {
      failures.push(`resolveGeometry must not treat C++ non-created tob mesh "${meshName}" as procedural.`);
    }
  }
}

function parseEffectShaderPath(text) {
  const match = text.match(/LoadEffectFromFile\s*\(\s*"([^"]+)"/);
  return match ? match[1].replace(/\\\\/g, "\\") : null;
}

function parseFxTechniques(text) {
  const techniques = [];
  for (const match of text.matchAll(/technique\s+t(\d+)\s*\{([\s\S]*?)(?=\n\s*technique\s+t\d+\s*\{|$)/g)) {
    const index = Number(match[1]);
    const body = stripLineComments(match[2]);
    const technique = { index };
    assignFxValue(technique, "zEnable", readFxValue(body, "ZEnable"));
    assignFxValue(technique, "zWriteEnable", readFxValue(body, "ZWriteEnable"));
    assignFxValue(technique, "alphaBlendEnable", readFxValue(body, "AlphaBlendEnable"));
    assignFxValue(technique, "alphaTestEnable", readFxValue(body, "AlphaTestEnable"));
    assignFxValue(technique, "alphaRef", readFxValue(body, "AlphaRef"));
    assignFxValue(technique, "alphaFunc", readFxValue(body, "AlphaFunc"));
    assignFxValue(technique, "cullMode", readFxValue(body, "CullMode"));
    assignFxValue(technique, "minFilter", readFxValue(body, "Minfilter"));
    assignFxValue(technique, "magFilter", readFxValue(body, "Magfilter"));
    assignFxValue(technique, "addressU", readFxValue(body, "AddressU\\[0\\]"));
    assignFxValue(technique, "addressV", readFxValue(body, "AddressV\\[0\\]"));
    assignFxValue(technique, "srcBlend", readFxValue(body, "SrcBlend"));
    assignFxValue(technique, "destBlend", readFxValue(body, "DestBlend"));
    techniques.push(technique);
  }
  if (techniques.length === 0) {
    failures.push("Could not parse shader/dx8/eff.fx techniques.");
  }
  return techniques.sort((a, b) => a.index - b.index);
}

function stripLineComments(text) {
  return text.replace(/\/\/.*$/gm, "");
}

function readFxValue(text, keyPattern) {
  const match = text.match(new RegExp(`\\b${keyPattern}\\s*=\\s*([^;\\r\\n]+)`, "i"));
  if (!match) return undefined;
  const raw = match[1].trim();
  if (/^true$/i.test(raw)) return true;
  if (/^false$/i.test(raw)) return false;
  if (/^0x[0-9a-f]+$/i.test(raw)) return Number(raw);
  if (/^\d+$/.test(raw)) return Number(raw);
  return raw;
}

function assignFxValue(target, key, value) {
  if (value !== undefined) {
    target[key] = value;
  }
}

function parseTsTechniqueStates(text) {
  const constants = new Map();
  for (const match of text.matchAll(/export\s+const\s+(D3D[A-Z0-9_]+)\s*=\s*([^;\n]+)/g)) {
    constants.set(match[1], Number(match[2]));
  }

  const defaultMatch = text.match(/DEFAULT_PKO_TECHNIQUE[^=]*=\s*\{([\s\S]*?)\}\s*;/);
  const overridesMatch = text.match(/PKO_EFFECT_TECHNIQUE_OVERRIDES[^=]*=\s*\{([\s\S]*?)\}\s*;/);
  if (!defaultMatch) {
    failures.push("Could not find DEFAULT_PKO_TECHNIQUE.");
    return new Map();
  }
  if (!overridesMatch) {
    failures.push("Could not find PKO_EFFECT_TECHNIQUE_OVERRIDES.");
    return new Map();
  }

  const defaults = parseTsObjectProperties(defaultMatch[1], constants);
  const states = new Map();
  for (let index = 0; index <= 6; index += 1) {
    const overrideMatch = overridesMatch[1].match(new RegExp(`\\b${index}\\s*:\\s*\\{([\\s\\S]*?)\\}\\s*,?`));
    const overrides = overrideMatch ? parseTsObjectProperties(overrideMatch[1], constants) : {};
    states.set(index, { ...defaults, ...overrides });
  }
  return states;
}

function parseTsObjectProperties(body, constants) {
  const state = {};
  for (const match of body.matchAll(/\b([a-zA-Z][a-zA-Z0-9_]*)\s*:\s*([^,\n}]+)/g)) {
    state[match[1]] = evaluateTsTechniqueValue(match[2].trim(), constants);
  }
  return state;
}

function evaluateTsTechniqueValue(raw, constants) {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^0x[0-9a-f]+$/i.test(raw)) return Number(raw);
  if (/^\d+$/.test(raw)) return Number(raw);
  if (constants.has(raw)) return mapTsConstantToFx(raw, constants.get(raw));
  return raw;
}

function mapTsConstantToFx(name, value) {
  const byName = new Map([
    ["D3DTADDRESS_WRAP", "WRAP"],
    ["D3DTADDRESS_CLAMP", "CLAMP"],
    ["D3DTADDRESS_MIRROR", "MIRROR"],
    ["D3DTEXF_POINT", "Point"],
    ["D3DTEXF_LINEAR", "Linear"],
    ["D3DCULL_NONE", "None"],
    ["D3DCULL_CW", "CW"],
    ["D3DCULL_CCW", "CCW"],
    ["D3DCMP_GREATER", "Greater"],
    ["D3DCMP_NOTEQUAL", "NOTEQUAL"],
    ["D3DBLEND_SRCALPHA", "SrcAlpha"],
    ["D3DBLEND_INVSRCALPHA", "InvSrcAlpha"],
    ["D3DBLEND_ONE", "One"],
    ["D3DBLEND_ZERO", "Zero"],
  ]);
  return byName.get(name) ?? value;
}

function validateTechniqueCoverage(renderTechniques, tsTechniqueStates) {
  const comparedKeys = [
    "zEnable",
    "zWriteEnable",
    "alphaBlendEnable",
    "alphaTestEnable",
    "alphaRef",
    "alphaFunc",
    "cullMode",
    "minFilter",
    "magFilter",
    "addressU",
    "addressV",
    "srcBlend",
    "destBlend",
  ];

  for (const technique of renderTechniques) {
    const tsState = tsTechniqueStates.get(technique.index);
    if (!tsState) {
      failures.push(`pkoStateEmulation is missing technique ${technique.index} from shader/dx8/eff.fx.`);
      continue;
    }
    for (const key of comparedKeys) {
      if (!(key in technique)) continue;
      const expectedRaw = technique[key];
      const expected = normalizeTechniqueValue(expectedRaw);
      const actual = normalizeTechniqueValue(tsState[key]);
      if (actual !== expected) {
        failures.push(
          `pkoStateEmulation technique ${technique.index} ${key} must match shader/dx8/eff.fx ${expectedRaw}.`,
        );
      }
    }
  }
}

function validateAlphaMaterialCoverage({
  sourceEffectImplText,
  sourceModelEffectImplText,
  sourceParticleImplText,
  rustEffectModelText,
  tsEffectColorText,
  tsApplySubEffectFrameText,
  tsParticleVisualText,
  tsMaterialPropsText,
}) {
  const coverage = {
    defaultAlphaTrue: /\b_bAlpha\s*=\s*true\s*;/.test(sourceEffectImplText),
    savedAlpha: /fwrite\s*\(\s*&_bAlpha\s*,\s*sizeof\s*\(\s*bool\s*\)/.test(sourceEffectImplText),
    versionedAlphaLoad: /dwVersion\s*>\s*5[\s\S]{0,80}fread\s*\(\s*&_bAlpha\s*,\s*sizeof\s*\(\s*bool\s*\)/.test(sourceEffectImplText),
    alphaFalseDisablesBlend: /!m_pCEffect->IsAlpah\s*\(\s*\)[\s\S]{0,220}D3DRS_ALPHABLENDENABLE\s*,\s*FALSE[\s\S]{0,220}D3DRS_ZWRITEENABLE\s*,\s*TRUE/.test(sourceModelEffectImplText),
    particleNestedEffectSetAlpha: /m_SCurColor\.a\s*<\s*1\.0f[\s\S]{0,120}SetAlpha\s*\(\s*pParticle->m_SCurColor\.a\s*\)/.test(sourceParticleImplText),
    textureFactorColorModulate: /D3DTSS_COLORARG1\s*,\s*D3DTA_TEXTURE[\s\S]{0,240}D3DTSS_COLORARG2\s*,\s*D3DTA_TFACTOR[\s\S]{0,240}D3DTSS_COLOROP\s*,\s*D3DTOP_MODULATE/.test(sourceModelEffectImplText),
    textureFactorAlphaModulate: /D3DTSS_ALPHAARG1\s*,\s*D3DTA_TEXTURE[\s\S]{0,240}D3DTSS_ALPHAARG2\s*,\s*D3DTA_TFACTOR[\s\S]{0,240}D3DTSS_ALPHAOP\s*,\s*D3DTOP_MODULATE/.test(sourceModelEffectImplText),
    rustAlphaVersionGate: /if\s+version\s*>\s*5[\s\S]{0,120}write_bool\s*\(\s*writer\s*,\s*self\.alpha\s*\)/.test(rustEffectModelText),
    tsTextureFactorColorSrgb: /setPkoTextureFactorColor[\s\S]{0,260}setRGB\s*\(\s*red\s*,\s*green\s*,\s*blue\s*,\s*THREE\.SRGBColorSpace\s*\)/.test(tsEffectColorText)
      && /setPkoTextureFactorColor\s*\(\s*mat\.color\s*,\s*color\[0\]\s*,\s*color\[1\]\s*,\s*color\[2\]\s*\)/.test(tsApplySubEffectFrameText)
      && /createPkoTextureFactorColor\s*\(\s*particle\.color\.r\s*,\s*particle\.color\.g\s*,\s*particle\.color\.b\s*\)/.test(tsParticleVisualText),
    tsParticleNestedEffectOpacity: /ParticleOpacityContext\.Provider[\s\S]{0,120}value=\{\(particle\?\.alpha\s*\?\?\s*1\)\s*\*\s*opacityScale\}/.test(tsParticleVisualText)
      && /<EffectRenderer\s+effect=\{effFiles\[0\]\}/.test(tsParticleVisualText),
    tsAlphaFalseDisablesBlend: /const\s+useAlpha\s*=\s*sub\.alpha\s*!==\s*false/.test(tsMaterialPropsText)
      && /techAlphaBlend[\s\S]{0,240}\?\s*\(useAlpha\s*\?\s*THREE\.CustomBlending\s*:\s*THREE\.NormalBlending\)[\s\S]{0,120}:\s*THREE\.NoBlending/.test(tsMaterialPropsText)
      && /depthWrite:\s*techDepthWrite/.test(tsMaterialPropsText),
    tsTextureAlphaMultipliedByMaterial: /map:\s*texture/.test(tsMaterialPropsText)
      && /opacity:\s*useAlpha\s*\?\s*1\s*:\s*1/.test(tsMaterialPropsText),
  };

  if (!coverage.defaultAlphaTrue) {
    failures.push("C++ I_Effect constructor must default _bAlpha to true.");
  }
  if (!coverage.savedAlpha) {
    failures.push("C++ I_Effect::SaveToFile must serialize _bAlpha.");
  }
  if (!coverage.versionedAlphaLoad) {
    failures.push("C++ I_Effect::LoadFromFile must read _bAlpha only for dwVersion > 5.");
  }
  if (!coverage.alphaFalseDisablesBlend) {
    failures.push("C++ CMPModelEff render path must disable alpha blend and enable depth write when IsAlpah() is false.");
  }
  if (!coverage.particleNestedEffectSetAlpha) {
    failures.push("C++ CMPPartSys::RenderSoft must push MODEL/STRIP particle alpha into nested CMPModelEff::SetAlpha.");
  }
  if (!coverage.textureFactorColorModulate) {
    failures.push("C++ CMPModelEff::RenderSoft must modulate texture color with texture factor color.");
  }
  if (!coverage.textureFactorAlphaModulate) {
    failures.push("C++ CMPModelEff::RenderSoft must modulate texture alpha with texture factor alpha.");
  }
  if (!coverage.rustAlphaVersionGate) {
    failures.push("Rust effect model writer must preserve the C++ version > 5 alpha serialization gate.");
  }
  if (!coverage.tsTextureFactorColorSrgb) {
    failures.push("Three renderers must interpret PKO texture factor RGB as sRGB before linear texture modulation.");
  }
  if (!coverage.tsParticleNestedEffectOpacity) {
    failures.push("ParticleVisual must multiply nested .eff opacity by parent particle alpha like CMPModelEff::SetAlpha.");
  }
  if (!coverage.tsAlphaFalseDisablesBlend) {
    failures.push("buildEffectMaterialProps must preserve the C++ alpha=false opaque/depth-write branch.");
  }
  if (!coverage.tsTextureAlphaMultipliedByMaterial) {
    failures.push("buildEffectMaterialProps must keep the texture map and material alpha path together like D3DTOP_MODULATE.");
  }

  return coverage;
}

function validateEffectTextureUploadCoverage({
  sourceResManagerText,
  sourceTexUtilText,
  sourceTexResourceText,
  sourceTexTypesText,
  tsUseEffectTextureText,
}) {
  const coverage = {
    effectRequestsA4R4G4B4: /lwLoadTex\s*\([^;]+D3DFMT_A4R4G4B4\s*\)/.test(sourceResManagerText),
    lwLoadTexUsesDefaultTexInfo: /lwTexInfo_Construct\s*\(\s*&tex_info\s*\)/.test(sourceTexUtilText)
      && /tex_info\.format\s*=\s*fmt\s*;/.test(sourceTexUtilText)
      && /tex->LoadVideoMemory\s*\(\s*\)/.test(sourceTexUtilText),
    defaultNoColorKey: /colorkey_type\s*=\s*COLORKEY_TYPE_NONE\s*;/.test(sourceTexTypesText)
      && /colorkey\.color\s*=\s*0\s*;/.test(sourceTexTypesText),
    uploadForcesA8R8G8B8: /_format\s*=\s*D3DFMT_A8R8G8B8\s*;/.test(sourceTexResourceText),
    d3dxReceivesSourceColorKey: /D3DXCreateTextureFromFile(?:InMemory)?Ex[\s\S]{0,900}_colorkey\.color/.test(sourceTexResourceText),
    tsPreservesDecodedAlpha: /emulateD3dA8R8G8B8[\s\S]*return\s+new\s+Uint8Array\s*\(\s*rgba\s*\)/.test(tsUseEffectTextureText)
      && /THREE\.RGBAFormat/.test(tsUseEffectTextureText),
    tsDoesNotColorKeyBlack: !/(colorKey|colorkey|alpha\s*=\s*0)[\s\S]{0,120}(black|0,\s*0,\s*0)/i.test(tsUseEffectTextureText),
  };

  if (!coverage.effectRequestsA4R4G4B4) {
    failures.push("CMPResManger effect texture loads must request D3DFMT_A4R4G4B4 in the C++ source.");
  }
  if (!coverage.lwLoadTexUsesDefaultTexInfo) {
    failures.push("C++ lwLoadTex must construct default lwTexInfo and upload through LoadVideoMemory.");
  }
  if (!coverage.defaultNoColorKey) {
    failures.push("C++ lwTexInfo_Construct must default to no color key and color 0.");
  }
  if (!coverage.uploadForcesA8R8G8B8) {
    failures.push("C++ lwTex::LoadVideoMemory must force effect texture upload to D3DFMT_A8R8G8B8.");
  }
  if (!coverage.d3dxReceivesSourceColorKey) {
    failures.push("C++ D3DX texture creation must pass the lw texture color key field.");
  }
  if (!coverage.tsPreservesDecodedAlpha) {
    failures.push("useEffectTexture must preserve decoded RGBA alpha for the A8R8G8B8 upload path.");
  }
  if (!coverage.tsDoesNotColorKeyBlack) {
    failures.push("useEffectTexture must not synthesize black RGB color-key transparency for effect textures.");
  }

  return coverage;
}

function validateBillboardTransformCoverage({
  sourceResManagerText,
  sourceModelEffectImplText,
  sourceParticleImplText,
  tsApplySubEffectFrameText,
  tsParticleVisualText,
}) {
  const coverage = {
    sourceBillboardIsInverseViewNoTranslation: /D3DXMatrixInverse\s*\(\s*&_MatBBoard\s*,\s*NULL\s*,\s*_pMatView\s*\)/.test(sourceResManagerText)
      && /_MatBBoard\._41\s*=\s*0\.0f\s*;/.test(sourceResManagerText)
      && /_MatBBoard\._42\s*=\s*0\.0f\s*;/.test(sourceResManagerText)
      && /_MatBBoard\._43\s*=\s*0\.0f\s*;/.test(sourceResManagerText),
    sourceEffectBillboardMultipliesAfterAuthoredTransform: /m_pCEffect->IsBillBoard\s*\(\s*\)[\s\S]{0,420}D3DXMatrixMultiply\s*\(\s*&m_SMatResult\s*,\s*&m_SMatResult\s*,\s*m_pCEffect->getBillBoardMatrix\s*\(\s*\)\s*\)/.test(sourceModelEffectImplText),
    sourceRotaBoardCanDiscardAuthoredRotation: /!m_pCEffect->IsRotaBoard\s*\(\s*\)[\s\S]{0,80}D3DXMatrixIdentity\s*\(\s*&m_SMatResult\s*\)/.test(sourceModelEffectImplText),
    sourceParticleBillboardBindsInverseViewAtParticlePosition: /_bBillBoard[\s\S]{0,180}D3DXMATRIX\s+tm\s*=\s*\*_SpmatBBoard[\s\S]{0,260}tm\._41\s*=\s*pParticle->m_vPos\.x[\s\S]{0,260}pPart->BindingBone\s*\(\s*tm\s*,\s*true\s*\)/.test(sourceParticleImplText),
    sourceParticleFrameMovePremultipliesBillboard: /D3DXMatrixMultiply\s*\(\s*&pParticle->m_SCurMat\s*,\s*pPart->_SpmatBBoard\s*,\s*&pParticle->m_SCurMat\s*\)/.test(sourceParticleImplText),
    tsSubEffectBillboardUsesParentLocalCameraQuaternion: /parent\.getWorldQuaternion\s*\(\s*_parentWorldQuat\s*\)/.test(tsApplySubEffectFrameText)
      && /_parentInverseQuat\.copy\s*\(\s*_parentWorldQuat\s*\)\.invert\s*\(\s*\)/.test(tsApplySubEffectFrameText)
      && /mesh\.quaternion\.copy\s*\(\s*_parentInverseQuat\s*\)\.multiply\s*\(\s*_desiredWorldQuat\s*\)/.test(tsApplySubEffectFrameText),
    tsParticleBillboardUsesParentLocalCameraQuaternion: /parent\.getWorldQuaternion\s*\(\s*parentWorldQuatRef\.current\s*\)/.test(tsParticleVisualText)
      && /parentInverseQuatRef\.current\.copy\s*\(\s*parentWorldQuatRef\.current\s*\)\.invert\s*\(\s*\)/.test(tsParticleVisualText)
      && /groupRef\.current\.quaternion\.copy\s*\(\s*parentInverseQuatRef\.current\s*\)\.multiply\s*\(\s*camera\.quaternion\s*\)/.test(tsParticleVisualText),
  };

  if (!coverage.sourceBillboardIsInverseViewNoTranslation) {
    failures.push("CMPResManger must build the billboard matrix from inverse view with translation cleared.");
  }
  if (!coverage.sourceEffectBillboardMultipliesAfterAuthoredTransform) {
    failures.push("CMPModelEff billboard sub-effects must multiply the authored transform by the billboard matrix.");
  }
  if (!coverage.sourceRotaBoardCanDiscardAuthoredRotation) {
    failures.push("CMPModelEff billboard handling must keep the IsRotaBoard branch that can discard authored rotation.");
  }
  if (!coverage.sourceParticleBillboardBindsInverseViewAtParticlePosition) {
    failures.push("CMPPartSys billboard render path must bind the inverse-view matrix at the particle position.");
  }
  if (!coverage.sourceParticleFrameMovePremultipliesBillboard) {
    failures.push("CMPPartSys frame paths must premultiply particle matrices by the source billboard matrix.");
  }
  if (!coverage.tsSubEffectBillboardUsesParentLocalCameraQuaternion) {
    failures.push("applySubEffectFrame must convert camera billboard orientation into parent-local space.");
  }
  if (!coverage.tsParticleBillboardUsesParentLocalCameraQuaternion) {
    failures.push("ParticleVisual must convert .par billboard orientation into parent-local space.");
  }

  return coverage;
}

function validateParticleBuiltinMeshCoverage({
  sourceResManagerText,
  sourceEffectHeaderText,
  tsParticleVisualText,
}) {
  const meshDefines = new Map();
  for (const match of sourceEffectHeaderText.matchAll(/#define\s+(MESH_[A-Z]+)\s+"([^"]+)"/g)) {
    meshDefines.set(match[1], match[2]);
  }

  const loadTotalMeshMatch = sourceResManagerText.match(/CMPResManger::LoadTotalMesh\s*\(\s*\)[\s\S]*?\{([\s\S]*?)_CShadeModel/);
  if (!loadTotalMeshMatch) {
    failures.push("Could not find CMPResManger::LoadTotalMesh built-in mesh preload block.");
    return [];
  }

  const sourceMeshes = [...loadTotalMeshMatch[1].matchAll(/_mapMesh\s*\[\s*(MESH_[A-Z]+)\s*\]/g)]
    .map((match) => meshDefines.get(match[1]) ?? `unknown:${match[1]}`);

  for (const meshName of sourceMeshes) {
    if (meshName.startsWith("unknown:")) {
      failures.push(`Could not resolve C++ particle built-in mesh ${meshName}.`);
      continue;
    }
    if (!new RegExp(`case\\s+"${escapeRegExp(meshName)}"`).test(tsParticleVisualText)) {
      failures.push(`ParticleVisual must render C++ CMPResManger::LoadTotalMesh built-in mesh "${meshName}" without external model loading.`);
    }
  }

  return sourceMeshes;
}

function validateParticleResourceBindingCoverage({
  sourceParticleImplText,
  tsParticleVisualText,
}) {
  const bindingResMatch = sourceParticleImplText.match(/void\s+CMPPartSys::BindingRes\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
  const bindingResBody = bindingResMatch?.[1] ?? "";
  const coverage = {
    sourceBindingResFound: Boolean(bindingResMatch),
    sourceMeshLookupBeforeEffectLookup: /GetMeshID\s*\(\s*_strModelName\s*\)[\s\S]*?id\s*<\s*0[\s\S]*?GetEffectID\s*\(\s*_strModelName\s*\)/.test(bindingResBody),
    sourceMeshIdBindsModel: /_pCModel\s*=\s*pCResMagr->GetMeshByID\s*\(\s*id\s*\)/.test(bindingResBody),
    sourceEffectIdBindsNestedEffect: /BindingEffect\s*\(\s*pCResMagr->GetEffectByID\s*\(\s*id\s*\)\s*\)/.test(bindingResBody),
    tsNestedEffectUsesEffExtension: /isNestedEffect\s*=\s*modelName\.toLowerCase\s*\(\s*\)\.endsWith\s*\(\s*["']\.eff["']\s*\)/.test(tsParticleVisualText),
    tsBuiltinGeometryBeforeExternalModel: /const\s+builtinGeometry\s*=\s*useMemo[\s\S]*?createBuiltinParticleGeometry\s*\(\s*modelName\s*\)[\s\S]*?const\s+effFiles\s*=/.test(tsParticleVisualText),
    tsExternalModelOnlyWhenNoBuiltin: /useEffectModel\s*\(\s*[\s\S]*?!isNestedEffect\s*&&\s*modelName\s*&&\s*!builtinGeometry\s*\?\s*modelName\s*:\s*undefined/.test(tsParticleVisualText),
    tsParticleDirectModelDoubleSided: /side=\{THREE\.DoubleSide\}/.test(tsParticleVisualText),
  };

  if (!coverage.sourceBindingResFound) {
    failures.push("Could not find C++ CMPPartSys::BindingRes resource binding path.");
  }
  if (!coverage.sourceMeshLookupBeforeEffectLookup) {
    failures.push("CMPPartSys::BindingRes must look up GetMeshID(_strModelName) before GetEffectID(_strModelName).");
  }
  if (!coverage.sourceMeshIdBindsModel) {
    failures.push("CMPPartSys::BindingRes mesh hits must bind _pCModel from GetMeshByID(id).");
  }
  if (!coverage.sourceEffectIdBindsNestedEffect) {
    failures.push("CMPPartSys::BindingRes effect hits must bind CMPModelEff from GetEffectByID(id).");
  }
  if (!coverage.tsNestedEffectUsesEffExtension) {
    failures.push("ParticleVisual must classify nested .eff particle resources before external model loading.");
  }
  if (!coverage.tsBuiltinGeometryBeforeExternalModel) {
    failures.push("ParticleVisual must resolve C++ built-in particle mesh geometry before external model loading.");
  }
  if (!coverage.tsExternalModelOnlyWhenNoBuiltin) {
    failures.push("ParticleVisual must call useEffectModel only after C++ built-in mesh names fail to resolve.");
  }
  if (!coverage.tsParticleDirectModelDoubleSided) {
    failures.push("ParticleVisual direct model materials must be double-sided to match CMPPartSys technique 3 CullMode=None.");
  }

  return coverage;
}

function validateParticlePlaybackCoverage({
  sourceParticleHeaderText,
  sourceParticleImplText,
  tsParticleVisualText,
  tsEffectV2WorkbenchText,
  tsParticleRendererText,
  tsParticleLifecycleText,
  tsRangeSystemText,
  tsRange2SystemText,
  tsRangeKinematicsText,
  tsSnowSystemText,
  tsFireSystemText,
  tsShrinkSystemText,
  tsDummySystemText,
  tsDummyLineKinematicsText,
  tsBlast2SystemText,
  tsBlast3SystemText,
}) {
  const setLoopMatch = sourceParticleImplText.match(/void\s+CMPPartSys::SetLoop\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
  const setLoopBody = setLoopMatch?.[1] ?? "";
  const playMatch = sourceParticleImplText.match(/void\s+CMPPartSys::Play\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
  const playBody = playMatch?.[1] ?? "";
  const updateDelayMatch = sourceParticleImplText.match(/bool\s+CMPPartSys::UpdateDelay\s*\([^)]*\)\s*\{([\s\S]*?)\n\}/);
  const updateDelayBody = updateDelayMatch?.[1] ?? "";

  const coverage = {
    sourceSetLoopFound: Boolean(setLoopMatch),
    sourceUpdateDelayFound: Boolean(updateDelayMatch),
    sourceSetLoopReplaysNestedEffectsWithInverseLoop: /_CPPart[\s\S]*?Play\s*\(\s*!_bLoop\s*\)/.test(setLoopBody),
    sourceLoopClearsPlayTime: /if\s*\(\s*_bLoop\s*\)[\s\S]*?SetPlayTime\s*\(\s*0\s*\)/.test(setLoopBody),
    sourcePlayMapsZeroToLoop: /_bLoop\s*=\s*iTime\s*==\s*0\s*\?\s*true\s*:\s*false/.test(playBody),
    sourceUpdateDelayStopsAtFinitePlayTime:
      /_fPlayTime\s*<=\s*0/.test(updateDelayBody)
      && /_fCurPlayTime\s*>=\s*_fPlayTime[\s\S]*?Stop\s*\(\s*\)/.test(updateDelayBody),
    sourceUpdateDelayDefersFinitePlayTimeUntilDelay:
      /_fCurPlayTime\s*>=\s*_fDelayTime[\s\S]*?_fCurPlayTime\s*>=\s*_fPlayTime[\s\S]*?Stop\s*\(\s*\)/.test(updateDelayBody),
    sourceStopDrainsSnowFireShrink:
      /case\s+PARTTICLE_SNOW:[\s\S]*?case\s+PARTTICLE_FIRE:[\s\S]*?_bStop\s*=\s*true/.test(sourceParticleImplText)
      && /case\s+PARTTICLE_SHRINK:[\s\S]*?_wDeath\s*=\s*0[\s\S]*?_bStop\s*=\s*true/.test(sourceParticleImplText),
    sourceFireDrainClearsPlayAfterLiveParticlesDie:
      /void\s+_FrameMoveFire\s*\([^)]*\)[\s\S]*?if\s*\(\s*pPart->_bStop\s*\)[\s\S]*?_wDeath\+\+[\s\S]*?_bPlay\s*=\s*false/.test(sourceParticleImplText),
    sourceShrinkDrainClearsPlayAfterTargetsReached:
      /void\s+_FrameMoveShrink\s*\([^)]*\)[\s\S]*?PointPointRange[\s\S]*?m_bLive\s*=\s*false[\s\S]*?if\s*\(\s*pPart->_bStop\s*\)[\s\S]*?_bPlay\s*=\s*false/.test(sourceParticleImplText),
    sourceModelStripArrowNestedEffectsUseInverseLoop:
      /case\s+PARTTICLE_MODEL[\s\S]*?Play\s*\(\s*!_bLoop\s*\)/.test(playBody)
      && /case\s+PARTTICLE_STRIP[\s\S]*?Play\s*\(\s*!_bLoop\s*\)/.test(playBody)
      && /case\s+PARTTICLE_ARRAW[\s\S]*?Play\s*\(\s*!_bLoop\s*\)/.test(playBody),
    sourceBlastLoopRestarts:
      /void\s+_FrameMoveBlast\s*\([^)]*\)[\s\S]*?if\s*\(\s*pPart->_bLoop\s*\)[\s\S]*?_CreateBlast\s*\(\s*pPart\s*,\s*NULL\s*\)/.test(sourceParticleImplText),
    sourceBlast2Blast3IgnoreLoopAtEnd:
      /void\s+_FrameMoveBlast2\s*\([^)]*\)[\s\S]*?wCurFrame\s*==\s*pPart->_wFrameCount[\s\S]*?pPart->_bPlay\s*=\s*false[\s\S]*?return/.test(sourceParticleImplText)
      && /void\s+_FrameMoveBlast3\s*\([^)]*\)[\s\S]*?wCurFrame\s*==\s*pPart->_wFrameCount[\s\S]*?pPart->_bPlay\s*=\s*false[\s\S]*?return/.test(sourceParticleImplText),
    sourceFireSendsHitEffect:
      /void\s+_FrameMoveFire\s*\([^)]*\)[\s\S]*?m_strHitEff\s*!=\s*""[\s\S]*?_pcPath->IsEnd\s*\(\s*\)[\s\S]*?SendResMessage\s*\(\s*pPart->m_strHitEff/.test(sourceParticleImplText)
      && /void\s+_FrameMoveFire\s*\([^)]*\)[\s\S]*?_vPos\.z\s*<=\s*0\.1f\s*\|\|\s*pPart->_vPos\.z\s*>\s*50\.0f[\s\S]*?SendResMessage\s*\(\s*pPart->m_strHitEff/.test(sourceParticleImplText),
    sourceRange2SendsHitEffect:
      /void\s+_FrameMoveRange2\s*\([^)]*\)[\s\S]*?pParticle->m_vPos\.z\s*<\s*fei\s*\|\|\s*pParticle->m_vPos\.z\s*>\s*50\.0f[\s\S]*?SendResMessage\s*\(\s*pPart->m_strHitEff\s*,\s*pParticle->m_vPos/.test(sourceParticleImplText)
      && /void\s+_FrameMoveRange2\s*\([^)]*\)[\s\S]*?pParticle->m_vPos\.z\s*<\s*0\s*\|\|\s*pParticle->m_vPos\.z\s*>\s*50\.0f[\s\S]*?SendResMessage\s*\(\s*pPart->m_strHitEff\s*,\s*pParticle->m_vPos/.test(sourceParticleImplText),
    sourceSetItemDummyGatesLineRound:
      /void\s+SetItemDummy\s*\([^)]*\)\s*\{[\s\S]*?_iType\s*!=\s*PARTTICLE_DUMMY\s*&&\s*_iType\s*!=\s*PARTTICLE_LINE_SINGLE[\s\S]*?return[\s\S]*?_iDummy1\s*=\s*idummy1[\s\S]*?_iDummy2\s*=\s*idummy2/.test(sourceParticleHeaderText),
    sourceDummyRequiresDummySpanAndMoves:
      /bool\s+_CreateDummy\s*\([^)]*\)[\s\S]*?D3DXVec3Normalize\s*\(\s*&pCtrl->m_vOldPos\s*,\s*&pPart->_vDir\s*\)[\s\S]*?Randf\s*\(\s*pPart->_fDummyDist\s*,\s*pPart->_iParNum\s*\)[\s\S]*?pCtrl->m_vPos\s*=\s*pPart->_vDummyPos\s*\+\s*pPart->_vDummyDir\s*\*\s*dist/.test(sourceParticleImplText)
      && /void\s+_FrameMoveDummy\s*\([^)]*\)[\s\S]*?!pPart->GetDummyPosList\s*\(\s*\)[\s\S]*?pPart->_bPlay\s*=\s*false[\s\S]*?pParticle->m_vVel\s*=\s*pParticle->m_vOldPos\s*\*\s*\(\s*pPart->_fVecl\s*\*\s*\*pPart->_pfDailTime\s*\)[\s\S]*?pParticle->m_vPos\s*\+=\s*pParticle->m_vVel/.test(sourceParticleImplText),
    tsStandaloneWorkbenchReplaysPreviewWithoutPropagatingLoop:
      /previewReplayKey/.test(tsEffectV2WorkbenchText)
      && /onComplete=\{handlePreviewComplete\}/.test(tsEffectV2WorkbenchText)
      && /!\s*playback\.loop\s*\|\|\s*!\s*playback\.playing\s*\|\|\s*playback\.time\s*<=\s*0/.test(tsEffectV2WorkbenchText)
      && /estimateStandaloneParticlePreviewDuration\s*\(\s*previewPar\s*,\s*nestedEffects\s*\)/.test(tsEffectV2WorkbenchText)
      && /previewDuration\s*>\s*0\s*&&\s*playback\.time\s*>=\s*previewDuration/.test(tsEffectV2WorkbenchText)
      && /setPlayback\s*\(\s*\([^)]*\)\s*=>\s*\(\s*\{\s*\.\.\.[^,]+,\s*time:\s*0\s*\}\s*\)\s*\)/.test(tsEffectV2WorkbenchText)
      && /setPreviewReplayKey\s*\(/.test(tsEffectV2WorkbenchText)
      && !/loop=\{playback\.loop\}/.test(tsEffectV2WorkbenchText),
    tsStandaloneParticleReceivesLoopProp: /<System[\s\S]*?loop=\{loop\}/.test(tsParticleRendererText),
    tsDummySpanRoutingMatchesSetItemDummy:
      /if\s*\(\s*type\s*===\s*ParticleType\.DUMMY\s*\|\|\s*type\s*===\s*ParticleType\.LINE_SINGLE\s*\)\s*\{[\s\S]*?return\s+span[\s\S]*?return\s+null/.test(tsParticleRendererText)
      && !/type\s*===\s*ParticleType\.LINE_ROUND[\s\S]*?return\s+span/.test(tsParticleRendererText),
    tsDummyRequiresDummySpanAndMoves:
      /if\s*\(\s*!dummyLineSpan\s*\)\s*onComplete\?\.\(\s*\)/.test(tsDummySystemText)
      && /if\s*\(\s*!dummyLineSpan\s*\)\s*return\s+null/.test(tsDummySystemText)
      && /p\.dir\.set\s*\(\s*system\.direction\[0\]\s*,\s*system\.direction\[1\]\s*,\s*system\.direction\[2\]\s*\)/.test(tsDummySystemText)
      && /p\.dir\.normalize\s*\(\s*\)/.test(tsDummySystemText)
      && /p\.accel\.set\s*\(\s*system\.acceleration\[0\]\s*,\s*system\.acceleration\[1\]\s*,\s*system\.acceleration\[2\]\s*\)/.test(tsDummySystemText)
      && /computeDummySpawnPosition\s*\(\s*dummyLineSpan\s*,\s*system\.particleCount\s*\)/.test(tsDummySystemText)
      && /computeDummyMovementDelta\s*\(\s*p\.dir\s*,\s*p\.accel\s*,\s*system\.velocity\s*,\s*dt\s*\)/.test(tsDummySystemText)
      && /Math\.floor\s*\(\s*random\s*\(\s*\)\s*\*\s*particleCount\s*\)/.test(tsDummyLineKinematicsText)
      && /direction\.clone\s*\(\s*\)[\s\S]*?multiplyScalar\s*\(\s*velocity\s*\*\s*dt\s*\)[\s\S]*?addScaledVector\s*\(\s*acceleration\s*,\s*signedAccel\s*\*\s*dt\s*\)/.test(tsDummyLineKinematicsText),
    tsNestedEffectLoopMatchesSourceSpecialCases:
      /if\s*\(\s*systemType\s*===\s*5\s*\|\|\s*systemType\s*===\s*6\s*\|\|\s*systemType\s*===\s*8\s*\)/.test(tsParticleVisualText)
      && /systemPlayTime\s*<=\s*0/.test(tsParticleVisualText)
      && /return\s+parentLoop\s*;/.test(tsParticleVisualText)
      && /return\s+true\s*;/.test(tsParticleVisualText),
    tsParticleRendererRoutesHitEffects:
      /onHitEffect=\{handleHitEffect\}/.test(tsParticleRendererText)
      && /TriggeredClock/.test(tsParticleRendererText)
      && /triggeredHitEffects\.map/.test(tsParticleRendererText)
      && /getParticleEffectBaseName\s*\(\s*particleEffectName\s*\)/.test(tsParticleRendererText)
      && /replace\s*\(\s*\/\\\.par\$\/i\s*,\s*["']["']\s*\)/.test(tsParticleRendererText),
    tsFireSendsHitEffect:
      /system\.hitEffect\.trim\s*\(\s*\)/.test(tsFireSystemText)
      && /advanceEffPathRuntimeState\s*\(\s*hitPathStateRef\.current\s*,\s*system\.path\s*,\s*dt\s*\)/.test(tsFireSystemText)
      && /hitPathStateRef\.current\.ended\s*\|\|\s*curPos\.z\s*<=\s*0\.1\s*\|\|\s*curPos\.z\s*>\s*50/.test(tsFireSystemText)
      && /onHitEffect\?\.\(\s*hitEffectName/.test(tsFireSystemText),
    tsRange2SendsHitEffect:
      /onHitEffect/.test(tsRange2SystemText)
      && /stepRange2Particles\s*\([\s\S]*?onHitEffect/.test(tsRange2SystemText)
      && /system\.hitEffect\.trim\s*\(\s*\)/.test(tsRangeKinematicsText)
      && /onHitEffect\?\.\(\s*system\.hitEffect\s*,\s*p\.pos\s*,\s*p\.dir\s*\)/.test(tsRangeKinematicsText),
    tsFinitePlayTimeExpiresLikeUpdateDelay:
      /export\s+function\s+isParticlePlayTimeExpired/.test(tsParticleLifecycleText)
      && /playTime\s*<=\s*0[\s\S]*?return\s+false/.test(tsParticleLifecycleText)
      && /delayTime\s*>\s*0\s*&&\s*elapsed\s*<\s*delayTime[\s\S]*?return\s+false/.test(tsParticleLifecycleText)
      && /return\s+elapsed\s*>=\s*playTime/.test(tsParticleLifecycleText),
    tsLoopModeIgnoresFinitePlayTime:
      /if\s*\(\s*loop\s*\|\|\s*playTime\s*<=\s*0\s*\)\s*return\s+false/.test(tsParticleLifecycleText),
    tsLoopRestartCanMatchSourceExceptions:
      /restartOnLoop\s*=\s*true/.test(tsParticleLifecycleText)
      && /loop\s*&&\s*restartOnLoop\s*&&\s*!finiteStopReachedRef\.current/.test(tsParticleLifecycleText)
      && /restartOnLoop:\s*false/.test(tsBlast2SystemText)
      && /restartOnLoop:\s*false/.test(tsBlast3SystemText),
    tsFiniteStopDrainBehaviorExists:
      /finitePlayTimeStopBehavior\s*=\s*["']clear["']/.test(tsParticleLifecycleText)
      && /finitePlayTimeStopBehavior\s*===\s*["']drain["'][\s\S]*?finiteStopReachedRef\.current\s*=\s*true/.test(tsParticleLifecycleText)
      && /respawnDeadParticles\s*&&\s*!finiteStopReachedRef\.current/.test(tsParticleLifecycleText),
    tsSnowFireShrinkOptIntoDrainStop:
      /finitePlayTimeStopBehavior:\s*["']drain["']/.test(tsSnowSystemText)
      && /finitePlayTimeStopBehavior:\s*["']drain["']/.test(tsFireSystemText)
      && /finitePlayTimeStopBehavior:\s*["']drain["']/.test(tsShrinkSystemText),
    tsScrubRewindResetsTimeline:
      /const\s+reset\s*=\s*safeCurrent\s*<\s*safePrevious/.test(tsParticleLifecycleText)
      && /if\s*\(\s*timeline\.reset\s*\)[\s\S]*?resetLifecycleState\s*\(\s*\)/.test(tsParticleLifecycleText),
    sourceRangePinsOldPosToRuntimePos:
      /void\s+_FrameMoveRange\s*\([^)]*\)[\s\S]*?pParticle->m_vPos\s*=\s*pParticle->m_vOldPos\s*\+\s*pPart->_vPos/.test(sourceParticleImplText),
    sourceFrameMoveAppliesEffPathToRuntimePos:
      /void\s+CMPPartSys::FrameMove\s*\([^)]*\)[\s\S]*?if\s*\(\s*_pcPath\s*\)[\s\S]*?_pcPath->FrameMove\s*\(\s*\*_pfDailTime\s*\)[\s\S]*?_vPos\s*=\s*_vSavePos\s*\+\s*\*_pcPath->GetCurPos\s*\(\s*\)/.test(sourceParticleImplText),
    tsLifecycleAppliesEffPathToSpawnPosition:
      /useParticleSystemPathOffset\s*\(\s*system\s*\)/.test(tsParticleLifecycleText)
      && /const\s+pathOffset\s*=\s*getPathOffset\s*\(\s*dt\s*\)/.test(tsParticleLifecycleText)
      && /spawnParticle\s*\([\s\S]*?pathOffset/.test(tsParticleLifecycleText)
      && /createParticles\s*\([\s\S]*?pathOffset/.test(tsParticleLifecycleText)
      && /if\s*\(\s*pathOffset\s*\)\s*p\.pos\.add\s*\(\s*pathOffset\s*\)/.test(tsParticleLifecycleText),
    sourceRange2CreatesThroughStepAccumulator:
      /bool\s+_CreateRange2\s*\([^)]*\)[\s\S]*?_fCurTime\s*\+=\s*\*pPart->_pfDailTime[\s\S]*?_fCurTime\s*>=\s*pPart->_fStep/.test(sourceParticleImplText),
    sourceRangeRange2UseBoundResourceRenderPath:
      /void\s+_FrameMoveRange\s*\([^)]*\)[\s\S]*?if\s*\(\s*pPart->_CPPart\s*\)[\s\S]*?pPart->_CPPart->FrameMove\s*\(\s*dwDailTime\s*\)/.test(sourceParticleImplText)
      && /void\s+_FrameMoveRange2\s*\([^)]*\)[\s\S]*?if\s*\(\s*pPart->_CPPart\s*\)[\s\S]*?pPart->_CPPart->FrameMove\s*\(\s*dwDailTime\s*\)/.test(sourceParticleImplText),
    sourceRangePathRotatesNestedEffect:
      /void\s+_FrameMoveRange\s*\([^)]*\)[\s\S]*?if\s*\(\s*pPart->_pcPath\s*\)[\s\S]*?GetNextPos\s*\(\s*\)[\s\S]*?GetCurPos\s*\(\s*\)[\s\S]*?vdir\s*=\s*\*pend\s*-\s*\*pstart[\s\S]*?RotatingXZ\s*\(\s*dirxz\[0\]\s*,\s*dirxz\[1\]\s*\)/.test(sourceParticleImplText),
    sourceRangePathEndStopsOrResetsNestedEffect:
      /void\s+_FrameMoveRange\s*\([^)]*\)[\s\S]*?if\s*\(\s*pPart->_fLife\s*>\s*1\s*\)[\s\S]*?_pcPath->IsEnd\s*\(\s*\)[\s\S]*?_wDeath\+\+[\s\S]*?_wDeath\s*>=\s*\(int\)\s*pPart->_fLife[\s\S]*?_bPlay\s*=\s*false[\s\S]*?_CreateRange\s*\(\s*pPart\s*,\s*NULL\s*\)[\s\S]*?_pcPath->Reset\s*\(\s*\)/.test(sourceParticleImplText),
    sourceRange2CreateRotatesNestedEffect:
      /bool\s+_CreateRange2\s*\([^)]*\)[\s\S]*?if\s*\(\s*pPart->_CPPart\s*\)[\s\S]*?pPart->_CPPart->RotatingXZ\s*\(\s*dirxz\[0\]\s*,\s*dirxz\[1\]\s*\)/.test(sourceParticleImplText),
    tsRangeRenderUsesUpdateDelayVisibility:
      /isParticleRenderVisibleAtTime\s*\(\s*[\s\S]*?system\.playTime[\s\S]*?system\.delayTime[\s\S]*?loop/.test(tsRangeSystemText),
    tsRangePinsParticlesToRuntimeEmitter:
      (
        /updateRangeParticlePositions\s*\(\s*[\s\S]*?alive\s*,[\s\S]*?emitterPositionRef\?\.current/.test(tsRangeSystemText)
        || /updateRangeParticlePositions\s*\(\s*[\s\S]*?particlesRef\.current\s*,[\s\S]*?emitterPositionRef\?\.current/.test(tsRangeSystemText)
      )
      && /rangeLocalPos/.test(tsRangeKinematicsText),
    tsRangeAppliesEffPathRuntimePosition:
      /createEffPathRuntimeState\s*\(\s*system\.path\s*\)/.test(tsRangeSystemText)
      && /advanceEffPathRuntimeState\s*\(\s*pathStateRef\.current\s*,\s*system\.usePath\s*\?\s*system\.path\s*:\s*null\s*,\s*dt\s*\)/.test(tsRangeSystemText)
      && /pathStateRef\.current\.curPos/.test(tsRangeSystemText)
      && /state\.curDist\s*\+=\s*path\.velocity\s*\*\s*dt/.test(tsRangeKinematicsText)
      && /p\.pos\.add\s*\(\s*pathOffset\s*\)/.test(tsRangeKinematicsText),
    tsRangePathRotatesNestedEffect:
      /computeEffPathRangeDirection\s*\(\s*pathStateRef\.current\s*,\s*system\.path\s*\)/.test(tsRangeSystemText)
      && /path\.points\[state\.curFrame\s*-\s*1\]/.test(tsRangeKinematicsText)
      && /p\.dir\.copy\s*\(\s*pathDirection\s*\)/.test(tsRangeKinematicsText)
      && /system\.type\s*===\s*15\s*\|\|\s*\(\s*system\.type\s*===\s*14\s*&&\s*system\.usePath\s*\)/.test(tsParticleVisualText),
    tsRangePathEndStopsOrResetsNestedEffect:
      /pathStateRef\.current\.ended/.test(tsRangeSystemText)
      && /pathDeathRef\.current\+\+/.test(tsRangeSystemText)
      && /pathDeathRef\.current\s*>=\s*Math\.trunc\s*\(\s*system\.life\s*\)/.test(tsRangeSystemText)
      && /pathStoppedRef\.current\s*=\s*true/.test(tsRangeSystemText)
      && /particlesRef\.current\s*=\s*createRangeParticles\s*\(/.test(tsRangeSystemText)
      && /pathStateRef\.current\s*=\s*createEffPathRuntimeState\s*\(\s*system\.path\s*\)/.test(tsRangeSystemText),
    tsRangeRange2RenderThroughParticleVisual:
      /<ParticleVisual\s+system=\{system\}\s+particle=\{p\}\s+loop=\{loop\}/.test(tsRangeSystemText)
      && /<ParticleVisual\s+system=\{system\}\s+particle=\{p\}\s+loop=\{loop\}/.test(tsRange2SystemText)
      && !/<ringGeometry/.test(tsRangeSystemText)
      && !/<ringGeometry/.test(tsRange2SystemText),
    tsRangeRange2UseSharedNestedEffectClock:
      /const\s+sharedEffectElapsedRef\s*=\s*useRef\s*\(\s*0\s*\)/.test(tsRangeSystemText)
      && /sharedEffectElapsedRef\.current\s*=\s*visible[\s\S]*?Math\.max\s*\(\s*0\s*,\s*elapsed\s*-\s*Math\.max\s*\(\s*0\s*,\s*system\.delayTime\s*\)\s*\)/.test(tsRangeSystemText)
      && /sharedEffectElapsedRef=\{sharedEffectElapsedRef\}/.test(tsRangeSystemText)
      && /const\s+sharedEffectElapsedRef\s*=\s*useRef\s*\(\s*0\s*\)/.test(tsRange2SystemText)
      && /sharedEffectElapsedRef\.current\s*\+=\s*activeDt/.test(tsRange2SystemText)
      && /sharedEffectElapsedRef=\{sharedEffectElapsedRef\}/.test(tsRange2SystemText),
    tsRange2NestedEffectRotatesWithoutModelDir:
      /system\.type\s*===\s*15[\s\S]{0,180}system\.modelName\.trim\(\)\.toLowerCase\(\)\.endsWith\(["']\.eff["']\)/.test(tsParticleVisualText)
      && /makeRotatingXZFromDirection\s*\(\s*modelDirMatrixRef\.current\s*,\s*particleRef\.current\.dir\s*\)/.test(tsParticleVisualText),
    tsRange2UsesScrubTimeline:
      /getParticleTimelineAdvanceSteps\s*\(/.test(tsRange2SystemText)
      && /if\s*\(\s*timeline\.reset\s*\)[\s\S]*?resetRange2State\s*\(\s*\)/.test(tsRange2SystemText),
    tsRange2UsesUpdateDelayVisibility:
      /isParticlePlayTimeExpired\s*\(\s*nextElapsed\s*,\s*system\.playTime\s*,\s*system\.delayTime\s*,\s*loop\s*\)/.test(tsRange2SystemText)
      && /isParticleRenderVisibleAtTime\s*\(\s*systemElapsedRef\.current\s*,\s*system\.playTime\s*,\s*system\.delayTime\s*,\s*loop\s*,?\s*\)/.test(tsRange2SystemText),
  };

  if (!coverage.sourceUpdateDelayFound) {
    failures.push("Could not find C++ CMPPartSys::UpdateDelay playback timing path.");
  }
  if (!coverage.sourceSetLoopFound) {
    failures.push("Could not find C++ CMPPartSys::SetLoop playback path.");
  }
  if (!coverage.sourceSetLoopReplaysNestedEffectsWithInverseLoop) {
    failures.push("CMPPartSys::SetLoop must replay nested CMPModelEff instances with Play(!_bLoop).");
  }
  if (!coverage.sourceLoopClearsPlayTime) {
    failures.push("CMPPartSys::SetLoop(true) must clear finite play time with SetPlayTime(0).");
  }
  if (!coverage.sourcePlayMapsZeroToLoop) {
    failures.push("CMPPartSys::Play must map iTime == 0 to _bLoop = true.");
  }
  if (!coverage.sourceUpdateDelayStopsAtFinitePlayTime) {
    failures.push("CMPPartSys::UpdateDelay must stop finite-play systems when _fCurPlayTime reaches _fPlayTime.");
  }
  if (!coverage.sourceUpdateDelayDefersFinitePlayTimeUntilDelay) {
    failures.push("CMPPartSys::UpdateDelay must defer finite play-time stopping until delay has elapsed when _fDelayTime is set.");
  }
  if (!coverage.sourceStopDrainsSnowFireShrink) {
    failures.push("CMPPartSys::Stop must set _bStop instead of clearing _bPlay immediately for SNOW, FIRE, and SHRINK.");
  }
  if (!coverage.sourceFireDrainClearsPlayAfterLiveParticlesDie) {
    failures.push("_FrameMoveFire must clear _bPlay only after stopped live particles drain.");
  }
  if (!coverage.sourceShrinkDrainClearsPlayAfterTargetsReached) {
    failures.push("_FrameMoveShrink must clear _bPlay only after stopped particles reach their targets.");
  }
  if (!coverage.sourceModelStripArrowNestedEffectsUseInverseLoop) {
    failures.push("CMPPartSys::Play must use Play(!_bLoop) for MODEL, STRIP, and ARRAW nested effects.");
  }
  if (!coverage.sourceBlastLoopRestarts) {
    failures.push("_FrameMoveBlast must restart with _CreateBlast when _bLoop is true.");
  }
  if (!coverage.sourceBlast2Blast3IgnoreLoopAtEnd) {
    failures.push("_FrameMoveBlast2 and _FrameMoveBlast3 must clear _bPlay at end-of-life without checking _bLoop.");
  }
  if (!coverage.sourceFireSendsHitEffect) {
    failures.push("_FrameMoveFire must send m_strHitEff through CMPResManger::SendResMessage on path/height stop.");
  }
  if (!coverage.sourceRange2SendsHitEffect) {
    failures.push("_FrameMoveRange2 must send m_strHitEff through CMPResManger::SendResMessage when projectiles leave the source height range.");
  }
  if (!coverage.sourceSetItemDummyGatesLineRound) {
    failures.push("CMPPartSys::SetItemDummy must route attached item dummy spans only to DUMMY and LINE_SINGLE, not LINE_ROUND.");
  }
  if (!coverage.sourceDummyRequiresDummySpanAndMoves) {
    failures.push("_CreateDummy/_FrameMoveDummy must require GetDummyPosList, spawn along the dummy span, and move by _vDir/_fVecl with signed acceleration.");
  }
  if (!coverage.tsStandaloneWorkbenchReplaysPreviewWithoutPropagatingLoop) {
    failures.push("EffectV2Workbench standalone .par preview loop must replay active, advanced previews using completion or preview-duration fallback without propagating playback.loop into ParticleEffectRenderer runtime loop.");
  }
  if (!coverage.tsStandaloneParticleReceivesLoopProp) {
    failures.push("ParticleEffectRenderer must pass the shared loop prop into particle system renderers.");
  }
  if (!coverage.tsDummySpanRoutingMatchesSetItemDummy) {
    failures.push("ParticleEffectRenderer dummyLineSpan routing must match CMPPartSys::SetItemDummy and exclude LINE_ROUND.");
  }
  if (!coverage.tsDummyRequiresDummySpanAndMoves) {
    failures.push("DummySystem must require a dummy span and move DUMMY particles like _FrameMoveDummy.");
  }
  if (!coverage.tsNestedEffectLoopMatchesSourceSpecialCases) {
    failures.push("ParticleVisual nested effect loop handling must match C++ MODEL/STRIP/ARRAW Play(!_bLoop) special cases.");
  }
  if (!coverage.tsParticleRendererRoutesHitEffects) {
    failures.push("ParticleEffectRenderer must route particle SendResMessage hit effects into nested one-shot ParticleEffectRenderer instances.");
  }
  if (!coverage.tsFireSendsHitEffect) {
    failures.push("FireSystem must trigger system.hitEffect when the source FIRE path/height stop condition is reached.");
  }
  if (!coverage.tsRange2SendsHitEffect) {
    failures.push("Range2System must trigger system.hitEffect when source RANGE2 projectiles leave the valid height range.");
  }
  if (!coverage.tsFinitePlayTimeExpiresLikeUpdateDelay) {
    failures.push("useParticleLifecycle must implement CMPPartSys::UpdateDelay finite play-time semantics.");
  }
  if (!coverage.tsLoopModeIgnoresFinitePlayTime) {
    failures.push("useParticleLifecycle loop mode must ignore finite playTime like CMPPartSys::SetLoop(true).");
  }
  if (!coverage.tsLoopRestartCanMatchSourceExceptions) {
    failures.push("useParticleLifecycle must allow BLAST2/BLAST3 to ignore loop restarts like the C++ frame movers.");
  }
  if (!coverage.tsFiniteStopDrainBehaviorExists) {
    failures.push("useParticleLifecycle must support C++ Stop drain behavior without respawning dead slots after finite playTime.");
  }
  if (!coverage.tsSnowFireShrinkOptIntoDrainStop) {
    failures.push("SnowSystem, FireSystem, and ShrinkSystem must opt into finite playTime drain behavior.");
  }
  if (!coverage.tsScrubRewindResetsTimeline) {
    failures.push("useParticleLifecycle must reset and replay when the shared scrub timeline rewinds.");
  }
  if (!coverage.sourceRangePinsOldPosToRuntimePos) {
    failures.push("_FrameMoveRange must pin RANGE particles to m_vOldPos + current _vPos.");
  }
  if (!coverage.sourceFrameMoveAppliesEffPathToRuntimePos) {
    failures.push("CMPPartSys::FrameMove must add _pcPath->GetCurPos() to _vSavePos before particle frame updates.");
  }
  if (!coverage.tsLifecycleAppliesEffPathToSpawnPosition) {
    failures.push("useParticleLifecycle must apply CEffPath current position to generic particle spawns before type-specific FrameUpdate.");
  }
  if (!coverage.sourceRange2CreatesThroughStepAccumulator) {
    failures.push("_CreateRange2 must emit dead RANGE2 slots through the source _fCurTime/_fStep accumulator.");
  }
  if (!coverage.sourceRangeRange2UseBoundResourceRenderPath) {
    failures.push("_FrameMoveRange and _FrameMoveRange2 must advance bound nested particle resources when _CPPart exists.");
  }
  if (!coverage.sourceRangePathRotatesNestedEffect) {
    failures.push("_FrameMoveRange must rotate nested _CPPart effects from CEffPath GetCurPos/GetNextPos direction.");
  }
  if (!coverage.sourceRangePathEndStopsOrResetsNestedEffect) {
    failures.push("_FrameMoveRange must stop or reset path-backed nested _CPPart RANGE effects on CEffPath end.");
  }
  if (!coverage.sourceRange2CreateRotatesNestedEffect) {
    failures.push("_CreateRange2 must orient nested _CPPart effects with RotatingXZ when they spawn.");
  }
  if (!coverage.tsRangeRenderUsesUpdateDelayVisibility) {
    failures.push("RangeSystem must use CMPPartSys::UpdateDelay-style delay/playTime render visibility.");
  }
  if (!coverage.tsRangePinsParticlesToRuntimeEmitter) {
    failures.push("RangeSystem must re-pin RANGE particles to the current runtime emitter position each frame.");
  }
  if (!coverage.tsRangeAppliesEffPathRuntimePosition) {
    failures.push("RangeSystem must apply CEffPath runtime position to RANGE particles when usePath is enabled.");
  }
  if (!coverage.tsRangePathRotatesNestedEffect) {
    failures.push("RangeSystem must orient RANGE nested .eff visuals from the CEffPath GetCurPos/GetNextPos direction.");
  }
  if (!coverage.tsRangePathEndStopsOrResetsNestedEffect) {
    failures.push("RangeSystem must stop or reset path-backed nested .eff RANGE effects when CEffPath reaches the end.");
  }
  if (!coverage.tsRangeRange2RenderThroughParticleVisual) {
    failures.push("RangeSystem and Range2System must render through ParticleVisual instead of hard-coded geometry.");
  }
  if (!coverage.tsRangeRange2UseSharedNestedEffectClock) {
    failures.push("RangeSystem and Range2System must drive nested .eff visuals from a shared _CPPart-style clock.");
  }
  if (!coverage.tsRange2NestedEffectRotatesWithoutModelDir) {
    failures.push("ParticleVisual must apply Range2 nested .eff RotatingXZ from particle direction even when modelDir is false.");
  }
  if (!coverage.tsRange2UsesScrubTimeline) {
    failures.push("Range2System must use the shared scrub timeline and reset on rewind.");
  }
  if (!coverage.tsRange2UsesUpdateDelayVisibility) {
    failures.push("Range2System must use CMPPartSys::UpdateDelay-style delay/playTime visibility and stop behavior.");
  }

  return coverage;
}

function validateParticleModelDirCoverage({
  sourceParticleHeaderText,
  sourceParticleImplText,
  tsParticleVisualText,
  tsFireSystemText,
  tsFireKinematicsText,
}) {
  const coverage = {
    sourceDirRotationHelperExists: /GetDirRotation\s*\(\s*D3DXVECTOR2\*\s*pOut\s*,\s*D3DXVECTOR3\*\s*pDir\s*\)/.test(sourceParticleHeaderText),
    sourceModelDirTempDirDefaultsZero: /_vTemDir\s*=\s*D3DXVECTOR2\s*\(\s*0\s*,\s*0\s*\)/.test(sourceParticleImplText),
    sourceSetDirPopulatesFireSystemDirAndTempDir:
      /case\s+PARTTICLE_FIRE:[\s\S]*?SetSysDirX\s*\(\s*fx\s*\)[\s\S]*?SetSysDirY\s*\(\s*fy\s*\)[\s\S]*?SetSysDirZ\s*\(\s*fz\s*\)[\s\S]*?GetDirRotation\s*\(\s*&_vTemDir\s*,\s*&vDir\s*\)/.test(sourceParticleImplText),
    sourceCreateFireModelDirOverwritesOldPosXYWithTempAngles:
      /bool\s+_CreateFire\s*\([^)]*\)[\s\S]*?D3DXVec3Normalize\s*\(\s*&pCtrl->m_vOldPos\s*,\s*&pPart->_vDir\s*\)[\s\S]*?if\s*\(\s*pPart->_bModelDir&&\s*pPart->_CPPart\s*\)[\s\S]*?m_vOldPos\.x\s*=\s*pPart->_vTemDir\.x[\s\S]*?m_vOldPos\.y\s*=\s*pPart->_vTemDir\.y/.test(sourceParticleImplText),
    sourceSetDirPopulatesTempDirForModelStrip:
      /case\s+PARTTICLE_MODEL:[\s\S]*?case\s+PARTTICLE_STRIP:[\s\S]*?GetDirRotation\s*\(\s*&_vTemDir\s*,\s*&vDir\s*\)/.test(sourceParticleImplText),
    sourceFrameMoveUsesTempDirForModelStrip:
      /if\s*\(\s*_iType\s*==\s*PARTTICLE_MODEL\s*\|\|\s*_iType\s*==\s*PARTTICLE_STRIP\s*\)[\s\S]*?RotatingXZ\s*\(\s*&mat\s*,\s*_vTemDir\.x\s*,\s*_vTemDir\.y\s*\)/.test(sourceParticleImplText),
    tsModelDirUsesRuntimeSourceDirection: /sourceDirectionRef\?\.current[\s\S]*?directionRef\.current\.copy\s*\(\s*sourceDirectionRef\.current\s*\)/.test(tsParticleVisualText),
    tsModelStripIgnoresSerializedDirectionWithoutRuntimeSetDir:
      /system\.type\s*===\s*5\s*\|\|\s*system\.type\s*===\s*6[\s\S]*?directionRef\.current\.set\s*\(\s*0\s*,\s*0\s*,\s*0\s*\)/.test(tsParticleVisualText)
      && !/directionRef\.current\.set\s*\(\s*system\.direction/.test(tsParticleVisualText),
    tsFireModelDirUsesSourceAnglesForMovement:
      /computeFireModelDirMovementDirection/.test(tsFireSystemText)
      && /function\s+computeFireModelDirMovementDirection/.test(tsFireKinematicsText)
      && /const\s+normalized\s*=\s*direction\.clone\(\)\.normalize\(\)/.test(tsFireKinematicsText)
      && /const\s+pitch\s*=[\s\S]*?Math\.asin/.test(tsFireKinematicsText)
      && /yaw\s*=[\s\S]*?Math\.acos/.test(tsFireKinematicsText)
      && /return\s+new\s+THREE\.Vector3\s*\(\s*pitch\s*,\s*yaw\s*,\s*normalized\.z\s*\)/.test(tsFireKinematicsText),
  };

  if (!coverage.sourceDirRotationHelperExists) {
    failures.push("MPParticleSys.h must expose GetDirRotation for source modelDir angle calculation.");
  }
  if (!coverage.sourceModelDirTempDirDefaultsZero) {
    failures.push("CMPPartSys must default _vTemDir to zero for modelDir systems before runtime setDir.");
  }
  if (!coverage.sourceSetDirPopulatesFireSystemDirAndTempDir) {
    failures.push("CMPPartSys::setDir must update FIRE _vDir and _vTemDir when modelDir is enabled.");
  }
  if (!coverage.sourceCreateFireModelDirOverwritesOldPosXYWithTempAngles) {
    failures.push("_CreateFire must overwrite modelDir FIRE m_vOldPos.x/y with _vTemDir angles after normalizing movement direction.");
  }
  if (!coverage.sourceSetDirPopulatesTempDirForModelStrip) {
    failures.push("CMPPartSys::setDir must populate _vTemDir for MODEL/STRIP modelDir systems.");
  }
  if (!coverage.sourceFrameMoveUsesTempDirForModelStrip) {
    failures.push("CMPPartSys frame/render binding must rotate MODEL/STRIP modelDir systems from _vTemDir, not serialized _vDir.");
  }
  if (!coverage.tsModelDirUsesRuntimeSourceDirection) {
    failures.push("ParticleVisual modelDir must use runtime sourceDirectionRef when CMPPartSys::setDir supplies one.");
  }
  if (!coverage.tsModelStripIgnoresSerializedDirectionWithoutRuntimeSetDir) {
    failures.push("ParticleVisual MODEL/STRIP modelDir must not use serialized system.direction when runtime setDir is absent.");
  }
  if (!coverage.tsFireModelDirUsesSourceAnglesForMovement) {
    failures.push("FireSystem modelDir movement must use GetDirRotation-style X/Y angles plus normalized Z, not raw runtime setDir.");
  }

  return coverage;
}

function validateParticleModelPlacementCoverage({
  sourceParticleImplText,
  sourceModelEffectImplText,
  tsModelKinematicsText,
  tsModelSystemText,
  tsParticleVisualText,
  tsArrowKinematicsText,
  tsArrowSystemText,
  tsStripKinematicsText,
  tsStripSystemText,
  tsStripRendererText,
  tsShadeKinematicsText,
  tsShadeSystemText,
  tsRoundKinematicsText,
  tsRoundSystemText,
}) {
  const coverage = {
    sourceMoveToAppliesEmitterMinusHalfRangePlusOffset:
      /void\s+CMPPartSys::MoveTo\s*\([^)]*\)[\s\S]*?_vPos\s*=\s*D3DXVECTOR3\s*\(\s*vPos->x\s*-\s*_fRange\[0\]\s*\/\s*2\s*,\s*vPos->y\s*-\s*_fRange\[1\]\s*\/\s*2\s*,\s*vPos->z\s*-\s*_fRange\[2\]\s*\/\s*2\s*\)[\s\S]*?_vPos\s*\+=\s*_vOffset/.test(sourceParticleImplText),
    sourceFrameMoveModelPinsToRangeCenter:
      /void\s+_FrameMoveModel\s*\([^)]*\)[\s\S]*?pParticle->m_vPos\s*=\s*pPart->_vPos\s*\+\s*D3DXVECTOR3\s*\(\s*pPart->_fRange\[0\]\s*\/\s*2\s*,\s*pPart->_fRange\[1\]\s*\/\s*2\s*,\s*pPart->_fRange\[2\]\s*\/\s*2\s*\)/.test(sourceParticleImplText),
    sourceFrameMoveArrowPinsToRangeCenter:
      /void\s+_FrameMoveArraw\s*\([^)]*\)[\s\S]*?pParticle->m_vPos\s*=\s*pPart->_vPos\s*\+\s*D3DXVECTOR3\s*\(\s*pPart->_fRange\[0\]\s*\/\s*2\s*,\s*pPart->_fRange\[1\]\s*\/\s*2\s*,\s*pPart->_fRange\[2\]\s*\/\s*2\s*\)/.test(sourceParticleImplText),
    sourceFrameMoveStripPinsToBasePos:
      /void\s+_FrameMoveStrip\s*\([^)]*\)[\s\S]*?pParticle->m_vPos\s*=\s*pPart->_vPos/.test(sourceParticleImplText),
    sourceFrameMoveShadePinsToBasePos:
      /void\s+_FrameMoveShade\s*\([^)]*\)[\s\S]*?pParticle->m_vPos\s*=\s*pPart->_vPos[\s\S]*?m_cShade\.MoveTo\s*\(\s*pParticle->m_vPos/.test(sourceParticleImplText),
    sourceFrameMoveRoundPinsToRangeCenter:
      /void\s+_FrameMoveRound\s*\([^)]*\)[\s\S]*?D3DXVec3Transform\s*\(\s*&pos\s*,\s*&pParticle->m_vOldPos\s*,\s*&mat\s*\)[\s\S]*?D3DXVECTOR3\s+vt\s*=\s*pPart->_vPos\s*\+\s*D3DXVECTOR3\s*\(\s*pPart->_fRange\[0\]\s*\/\s*2\s*,\s*pPart->_fRange\[1\]\s*\/\s*2\s*,\s*pPart->_fRange\[2\]\s*\/\s*2\s*\)[\s\S]*?pParticle->m_vPos\s*\+=\s*vt/.test(sourceParticleImplText),
    sourceModelStripStopWhenNestedEffectStops:
      /void\s+_FrameMoveModel\s*\([^)]*\)[\s\S]*?pPart->_CPPart->FrameMove\s*\(\s*dwDailTime\s*\)[\s\S]*?!pPart->_CPPart->IsPlay\s*\(\s*\)[\s\S]*?pPart->_bPlay\s*=\s*false/.test(sourceParticleImplText)
      && /void\s+_FrameMoveStrip\s*\([^)]*\)[\s\S]*?pPart->_CPPart->FrameMove\s*\(\s*dwDailTime\s*\)[\s\S]*?!pPart->_CPPart->IsPlay\s*\(\s*\)[\s\S]*?pPart->_bPlay\s*=\s*false/.test(sourceParticleImplText),
    sourceStandaloneStripRequiresAttachedDummySource:
      /void\s+CMPStrip::Play\s*\(\s*\)[\s\S]*?if\s*\(\s*_pItem\s*\)[\s\S]*?else\s+if\s*\(\s*_pCha\s*\)[\s\S]*?else\s+return[\s\S]*?_bPlay\s*=\s*true/.test(sourceModelEffectImplText),
    tsModelSpawnUsesOffsetAsLocalCenter:
      /computeModelSpawnPosition[\s\S]*?new\s+THREE\.Vector3\s*\(\s*system\.offset\[0\]\s*,\s*system\.offset\[1\]\s*,\s*system\.offset\[2\]\s*\)/.test(tsModelKinematicsText),
    tsModelMovePinsToEmitterPlusOffset:
      /withEmitterPosition\s*\(\s*computeModelSpawnPosition\s*\(\s*system\s*\)\s*,\s*emitterPosition\s*\)/.test(tsModelKinematicsText),
    tsModelSystemPassesRuntimeEmitterToMove:
      /moveParticle:\s*\([^)]*sys[^)]*pathOffset[^)]*\)\s*=>[\s\S]*?moveModelParticle\s*\([\s\S]*?sys\s*,\s*emitterPositionRef\?\.current\s*,\s*pathOffset\s*\)/.test(tsModelSystemText),
    tsPinnedSingleParticleSystemsApplyEffPathOffset:
      /moveModelParticle\s*\([\s\S]*?emitterPositionRef\?\.current\s*,\s*pathOffset\s*\)/.test(tsModelSystemText)
      && /moveArrowParticle\s*\([\s\S]*?emitterPositionRef\?\.current\s*,\s*pathOffset\s*\)/.test(tsArrowSystemText)
      && /moveStripParticle\s*\([\s\S]*?emitterPositionRef\?\.current\s*,\s*pathOffset\s*\)/.test(tsStripSystemText)
      && /moveShadeParticle\s*\([\s\S]*?emitterPositionRef\?\.current\s*,\s*pathOffset\s*\)/.test(tsShadeSystemText)
      && /moveRoundParticle\s*\([\s\S]*?emitterPositionRef\?\.current\s*,\s*pathOffset\s*\)/.test(tsRoundSystemText)
      && /if\s*\(\s*pathOffset\s*\)\s*p\.pos\.add\s*\(\s*pathOffset\s*\)/.test(tsModelKinematicsText)
      && /if\s*\(\s*pathOffset\s*\)\s*p\.pos\.add\s*\(\s*pathOffset\s*\)/.test(tsArrowKinematicsText)
      && /if\s*\(\s*pathOffset\s*\)\s*p\.pos\.add\s*\(\s*pathOffset\s*\)/.test(tsStripKinematicsText)
      && /if\s*\(\s*pathOffset\s*\)\s*p\.pos\.add\s*\(\s*pathOffset\s*\)/.test(tsShadeKinematicsText)
      && /if\s*\(\s*pathOffset\s*\)\s*p\.pos\.add\s*\(\s*pathOffset\s*\)/.test(tsRoundKinematicsText),
    tsModelStripStopWhenNestedEffectCompletes:
      /EffectRenderer\s+effect=\{effFiles\[0\]\}\s+onComplete=\{onNestedEffectComplete\}/.test(tsParticleVisualText)
      && /onNestedEffectComplete=\{handleNestedEffectComplete\}/.test(tsModelSystemText)
      && /onNestedEffectComplete=\{handleNestedEffectComplete\}/.test(tsStripSystemText)
      && /setNestedEffectComplete\s*\(\s*true\s*\)/.test(tsModelSystemText)
      && /setNestedEffectComplete\s*\(\s*true\s*\)/.test(tsStripSystemText),
    tsArrowMovePinsToEmitterPlusOffset:
      /p\.pos\.copy\s*\(\s*computeArrowSpawnPosition\s*\(\s*system\s*\)\s*\)/.test(tsArrowKinematicsText)
      && /if\s*\(\s*emitterPosition\s*\)\s*p\.pos\.add\s*\(\s*emitterPosition\s*\)/.test(tsArrowKinematicsText)
      && /moveArrowParticle\s*\([\s\S]*?s\s*,\s*emitterPositionRef\?\.current\s*,\s*pathOffset\s*\)/.test(tsArrowSystemText),
    tsStripMovePinsToEmitterPlusBasePos:
      /withEmitterPosition\s*\(\s*computeStripSpawnPosition\s*\(\s*system\s*\)\s*,\s*emitterPosition\s*\)/.test(tsStripKinematicsText)
      && /moveStripParticle\s*\([\s\S]*?s\s*,\s*emitterPositionRef\?\.current\s*,\s*pathOffset\s*\)/.test(tsStripSystemText),
    tsDetachedStripDoesNotSynthesizePreview:
      /if\s*\(\s*!dummyLineSpan\s*\)\s*return/.test(tsStripRendererText)
      && !/buildStaticPreviewGeometry|buildViewDependentRibbon|static\s+trail|fallback\s+for\s+standalone/i.test(tsStripRendererText),
    tsShadeMovePinsToEmitterPlusBasePos:
      /withEmitterPosition\s*\(\s*computeShadeSpawnPosition\s*\(\s*system\s*\)\s*,\s*emitterPosition\s*\)/.test(tsShadeKinematicsText)
      && /moveShadeParticle\s*\([\s\S]*?s\s*,\s*emitterPositionRef\?\.current\s*,\s*pathOffset\s*\)/.test(tsShadeSystemText),
    tsRoundMovePinsToEmitterPlusPathOffset:
      /p\.pos\.copy\s*\(\s*computeRoundPosition\s*\(\s*system\s*,\s*index\s*,\s*system\.particleCount\s*,\s*p\.elapsed\s*\)\s*\)/.test(tsRoundKinematicsText)
      && /if\s*\(\s*emitterPosition\s*\)\s*p\.pos\.add\s*\(\s*emitterPosition\s*\)/.test(tsRoundKinematicsText)
      && /if\s*\(\s*pathOffset\s*\)\s*p\.pos\.add\s*\(\s*pathOffset\s*\)/.test(tsRoundKinematicsText)
      && /moveRoundParticle\s*\([\s\S]*?s\s*,\s*emitterPositionRef\?\.current\s*,\s*pathOffset\s*\)/.test(tsRoundSystemText),
  };

  if (!coverage.sourceMoveToAppliesEmitterMinusHalfRangePlusOffset) {
    failures.push("CMPPartSys::MoveTo must derive _vPos from emitter position minus half range plus _vOffset.");
  }
  if (!coverage.sourceFrameMoveModelPinsToRangeCenter) {
    failures.push("_FrameMoveModel must pin the single MODEL particle to _vPos + _fRange / 2 every frame.");
  }
  if (!coverage.sourceFrameMoveArrowPinsToRangeCenter) {
    failures.push("_FrameMoveArraw must pin the single ARRAW particle to _vPos + _fRange / 2 every frame.");
  }
  if (!coverage.sourceFrameMoveStripPinsToBasePos) {
    failures.push("_FrameMoveStrip must pin the single STRIP particle to current _vPos every frame.");
  }
  if (!coverage.sourceFrameMoveShadePinsToBasePos) {
    failures.push("_FrameMoveShade must pin the single SHADE particle to current _vPos every frame before moving the shade decal.");
  }
  if (!coverage.sourceFrameMoveRoundPinsToRangeCenter) {
    failures.push("_FrameMoveRound must rotate local oldPos, then pin ROUND particles to current _vPos + _fRange / 2 every frame.");
  }
  if (!coverage.sourceModelStripStopWhenNestedEffectStops) {
    failures.push("_FrameMoveModel and _FrameMoveStrip must clear _bPlay when nested _CPPart->IsPlay() becomes false.");
  }
  if (!coverage.sourceStandaloneStripRequiresAttachedDummySource) {
    failures.push("CMPStrip::Play must require an attached item or character dummy source before setting _bPlay.");
  }
  if (!coverage.tsModelSpawnUsesOffsetAsLocalCenter) {
    failures.push("computeModelSpawnPosition must use the .par offset as the local MODEL center.");
  }
  if (!coverage.tsModelMovePinsToEmitterPlusOffset) {
    failures.push("moveModelParticle must pin MODEL particles to the current emitter plus .par offset each frame.");
  }
  if (!coverage.tsModelSystemPassesRuntimeEmitterToMove) {
    failures.push("ModelSystem must pass the runtime emitter position into moveModelParticle.");
  }
  if (!coverage.tsPinnedSingleParticleSystemsApplyEffPathOffset) {
    failures.push("MODEL, ARRAW, STRIP, and SHADE pinned systems must add CEffPath offsets before rendering.");
  }
  if (!coverage.tsModelStripStopWhenNestedEffectCompletes) {
    failures.push("ModelSystem and StripSystem must stop rendering and complete when nested .eff playback completes.");
  }
  if (!coverage.tsArrowMovePinsToEmitterPlusOffset) {
    failures.push("ArrowSystem must re-pin ARRAW particles to the current runtime emitter plus offset every frame.");
  }
  if (!coverage.tsStripMovePinsToEmitterPlusBasePos) {
    failures.push("StripSystem must re-pin STRIP particles to current runtime emitter plus source base position every frame.");
  }
  if (!coverage.tsDetachedStripDoesNotSynthesizePreview) {
    failures.push("StripRenderer must not synthesize detached preview geometry when CMPStrip has no runtime dummy source.");
  }
  if (!coverage.tsShadeMovePinsToEmitterPlusBasePos) {
    failures.push("ShadeSystem must re-pin SHADE particles to current runtime emitter plus source base position every frame.");
  }
  if (!coverage.tsRoundMovePinsToEmitterPlusPathOffset) {
    failures.push("RoundSystem must re-pin ROUND particles to the current runtime emitter and CEffPath offset every frame.");
  }

  return coverage;
}

function validateStandaloneStripCoverage({
  sourceModelEffectImplText,
  sourceModelEffectHeaderText,
  tsStripRendererText,
  tsStripTrailKinematicsText,
  tsStripTrailTestText,
  rustParLoaderText,
}) {
  const coverage = {
    sourceStripTextureLoadStripsDdsTga:
      /CMPStrip::LoadFrom(?:File|Memory)\s*\([^)]*\)[\s\S]*?strstr\s*\(\s*pszName\s*,\s*"\.dds"\s*\)[\s\S]*?strstr\s*\(\s*pszName\s*,\s*"\.tga"\s*\)[\s\S]*?memcpy\s*\(\s*psname\s*,\s*pszName\s*,\s*len\s*-\s*4\s*\)[\s\S]*?_strTexName\s*=\s*psname/.test(sourceModelEffectImplText),
    sourceStripRenderDrawsOnlyAfterTwoTrackControls:
      /void\s+CMPStrip::Render\s*\(\s*\)[\s\S]*?if\s*\(\s*_vecCtrl\.size\s*\(\s*\)\s*>\s*1\s*\)[\s\S]*?DrawPrimitiveUP\s*\(\s*D3DPT_TRIANGLESTRIP\s*,\s*_vecPath\.size\s*\(\s*\)\s*-\s*2/.test(sourceModelEffectImplText),
    sourceStripTrackFadeBeforeAgeIncrement:
      /struct\s+track[\s\S]*?void\s+FrameMove\s*\([^)]*fDailTime[^)]*dwColor[^)]*fLife[^)]*\)[\s\S]*?if\s*\(\s*m_fCurTime\s*>=\s*fLife\s*\)[\s\S]*?dwColor\.a\s*=\s*0[\s\S]*?dwColor\.a\s*=\s*1\.0f\s*\+\s*\(\s*\(-1\.0f\)\s*\*\s*\(\s*m_fCurTime\s*\/\s*fLife\s*\)\s*\)[\s\S]*?m_fCurTime\s*\+=\s*fDailTime/.test(sourceModelEffectHeaderText),
    sourceStripGetTrackSamplesDummyTranslationsInOrder:
      /void\s+GetTrack\s*\([^)]*dummy1[^)]*dummy2[^)]*\)[\s\S]*?path\.m_SPos\.x\s*=\s*dummy1->_41[\s\S]*?path\.m_SUV\.y\s*=\s*1[\s\S]*?path\.m_SPos\.x\s*=\s*dummy2->_41[\s\S]*?path\.m_SUV\.y\s*=\s*0/.test(sourceModelEffectHeaderText),
    rustParLoaderNormalizesStripTextureName:
      /let\s+texture_name\s*=\s*normalize_cmpstrip_texture_name\s*\(\s*r\.fixed_string\s*\(\s*\)\?\s*\)/.test(rustParLoaderText)
      && /fn\s+normalize_cmpstrip_texture_name[\s\S]*?contains\s*\(\s*"\.dds"\s*\)[\s\S]*?contains\s*\(\s*"\.tga"\s*\)[\s\S]*?truncate\s*\(\s*name\.len\s*\(\s*\)\.saturating_sub\s*\(\s*4\s*\)\s*\)/.test(rustParLoaderText),
    tsStripRendererRequiresRuntimeDummySpan:
      /if\s*\(\s*!dummyLineSpan\s*\)\s*return/.test(tsStripRendererText)
      && !/buildStaticPreviewGeometry|buildViewDependentRibbon|static\s+trail|fallback\s+for\s+standalone/i.test(tsStripRendererText),
    tsStripTrailUsesTriangleStripPrimitiveCount:
      /const\s+triangleCount\s*=\s*Math\.max\s*\(\s*vertexCount\s*-\s*2\s*,\s*0\s*\)/.test(tsStripTrailKinematicsText)
      && /new\s+Uint16Array\s*\(\s*triangleCount\s*\*\s*3\s*\)/.test(tsStripTrailKinematicsText),
    tsStripTrackFadeTestMatchesSource:
      /matches C\+\+ track fade before age increment/.test(tsStripTrailTestText)
      && /computeStripPairAlpha\s*\(\s*0\.5\s*,\s*2\s*\)[\s\S]*?0\.75/.test(tsStripTrailTestText),
    tsStripDummyOrderTestMatchesSource:
      /matches C\+\+ CMPStrip::GetTrack dummy1\/dummy2 vertex order and UVs/.test(tsStripTrailTestText)
      && /\[\s*0\s*,\s*1\s*\][\s\S]*?\[\s*0\s*,\s*0\s*\]/.test(tsStripTrailTestText),
  };

  if (!coverage.sourceStripTextureLoadStripsDdsTga) {
    failures.push("CMPStrip texture loading must strip serialized .dds/.tga suffixes before storing _strTexName.");
  }
  if (!coverage.sourceStripRenderDrawsOnlyAfterTwoTrackControls) {
    failures.push("CMPStrip::Render must draw the triangle strip only when _vecCtrl.size() > 1.");
  }
  if (!coverage.sourceStripTrackFadeBeforeAgeIncrement) {
    failures.push("CMPStrip::track::FrameMove must compute alpha from current age before incrementing m_fCurTime.");
  }
  if (!coverage.sourceStripGetTrackSamplesDummyTranslationsInOrder) {
    failures.push("CMPStrip::GetTrack must sample dummy1 as UV.y=1 before dummy2 as UV.y=0.");
  }
  if (!coverage.rustParLoaderNormalizesStripTextureName) {
    failures.push("Rust .par loader must normalize standalone strip texture names like CMPStrip::LoadFromFile/LoadFromMemory.");
  }
  if (!coverage.tsStripRendererRequiresRuntimeDummySpan) {
    failures.push("StripRenderer must require runtime dummy endpoints instead of synthesizing standalone preview geometry.");
  }
  if (!coverage.tsStripTrailUsesTriangleStripPrimitiveCount) {
    failures.push("Standalone strip trail geometry must use the D3D triangle-strip primitive count (_vecPath.size() - 2) when expanding to Three indices.");
  }
  if (!coverage.tsStripTrackFadeTestMatchesSource) {
    failures.push("Strip trail tests must lock the CMPStrip track fade-before-age-increment behavior.");
  }
  if (!coverage.tsStripDummyOrderTestMatchesSource) {
    failures.push("Strip trail tests must lock CMPStrip dummy1/dummy2 vertex order and UV.y values.");
  }

  return coverage;
}

function validateMagicOrientationCoverage({
  sourceMagicCtrlImplText,
  sourceEffectObjText,
  tsFlightControllerText,
  tsTracePathText,
  tsDropPathText,
  tsFlyPathText,
  tsFshadePathText,
  tsArcPathText,
  tsDirlightPathText,
  tsDistPathText,
}) {
  const nonTracePathText = [
    tsDropPathText,
    tsFlyPathText,
    tsFshadePathText,
    tsArcPathText,
    tsDirlightPathText,
    tsDistPathText,
  ].join("\n");

  const coverage = {
    sourceEmissionFlattensDirlightTarget:
      /void\s+CMagicCtrl::Emission\s*\([^)]*\)[\s\S]*?if\s*\(\s*_iRnederIdx\s*==\s*5\s*\)[\s\S]*?_vTarget\.z\s*=\s*_vPos\.z/.test(sourceMagicCtrlImplText),
    sourceEmissionRotatesModelsWithRotatingXZ:
      /void\s+CMagicCtrl::Emission\s*\([^)]*\)[\s\S]*?_CpModel\[n\]->RotatingXZ\s*\(\s*_fDirXZ\[0\]\s*,\s*_fDirXZ\[1\]\s*\)/.test(sourceMagicCtrlImplText),
    sourceResetDirRotatesModelsWithRotatingXZ:
      /void\s+CMagicCtrl::ResetDir\s*\([^)]*\)[\s\S]*?_CpModel\[n\]->RotatingXZ\s*\(\s*_fDirXZ\[0\]\s*,\s*_fDirXZ\[1\]\s*\)/.test(sourceMagicCtrlImplText),
    sourceOnlyTraceCallsResetDir:
      /inline\s+void\s+Part_trace\s*\([^)]*\)[\s\S]*?ResetDir\s*\(\s*&vTarget\s*\)/.test(sourceEffectObjText)
      && !/inline\s+void\s+Part_(?:drop|fly|fshade|arc|dirlight|dist)\s*\([^)]*\)[\s\S]*?ResetDir\s*\(/.test(sourceEffectObjText),
    tsEmissionDirectionFlattensDirlightTarget:
      /if\s*\(\s*renderIdx\s*===\s*5\s*\)[\s\S]*?sourceTarget\.z\s*=\s*origin\.z/.test(tsFlightControllerText),
    tsInitialOrientationUsesEmissionDirection:
      /if\s*\(\s*!wasInitialized\s*\)\s*\{[\s\S]*?applyMagicRotatingXZ\s*\(\s*group\s*,\s*getMagicEmissionDirection\s*\(\s*ctx\.origin\s*,\s*ctx\.target\s*,\s*renderIdx\s*\)\s*\)/.test(tsFlightControllerText),
    tsReaimsOnlyWhenPathSuppliesOrientationDirection:
      /if\s*\(\s*ctx\.orientationDirection\s*\)\s*\{[\s\S]*?applyMagicRotatingXZ\s*\(\s*group\s*,\s*ctx\.orientationDirection\s*\)/.test(tsFlightControllerText),
    tsTraceSuppliesResetDirOrientation:
      /ctx\.orientationDirection\s*=\s*resetDir\.clone\s*\(\s*\)/.test(tsTracePathText),
    tsNonTracePathsDoNotSupplyResetDirOrientation:
      !/ctx\.orientationDirection\s*=/.test(nonTracePathText),
  };

  if (!coverage.sourceEmissionFlattensDirlightTarget) {
    failures.push("CMagicCtrl::Emission must flatten _vTarget.z to _vPos.z for render index 5.");
  }
  if (!coverage.sourceEmissionRotatesModelsWithRotatingXZ) {
    failures.push("CMagicCtrl::Emission must rotate model effects through RotatingXZ(_fDirXZ[0], _fDirXZ[1]).");
  }
  if (!coverage.sourceResetDirRotatesModelsWithRotatingXZ) {
    failures.push("CMagicCtrl::ResetDir must rotate model effects through RotatingXZ after target movement.");
  }
  if (!coverage.sourceOnlyTraceCallsResetDir) {
    failures.push("Only C++ Part_trace should call CMagicCtrl::ResetDir during flight.");
  }
  if (!coverage.tsEmissionDirectionFlattensDirlightTarget) {
    failures.push("getMagicEmissionDirection must flatten dirlight target Z like CMagicCtrl::Emission render index 5.");
  }
  if (!coverage.tsInitialOrientationUsesEmissionDirection) {
    failures.push("FlightPathController must apply source RotatingXZ from emission direction on first frame.");
  }
  if (!coverage.tsReaimsOnlyWhenPathSuppliesOrientationDirection) {
    failures.push("FlightPathController must only re-aim after emission when a path supplies orientationDirection.");
  }
  if (!coverage.tsTraceSuppliesResetDirOrientation) {
    failures.push("flightTrace must supply orientationDirection when it emulates CMagicCtrl::ResetDir.");
  }
  if (!coverage.tsNonTracePathsDoNotSupplyResetDirOrientation) {
    failures.push("Non-trace flight paths must not continuously re-aim magic model effects.");
  }

  return coverage;
}

function normalizeTechniqueValue(value) {
  if (typeof value === "string") return value.toLowerCase();
  return value;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
