#!/usr/bin/env node
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const inputMode = getInputMode(args);

if (args.help || !inputMode || !args.out) {
  printUsage();
  process.exit(args.help ? 0 : 1);
}

const inputPath = resolve(
  inputMode === "effect"
    ? args.effectJson
    : inputMode === "particle"
      ? args.parJson
      : args.magicScenario,
);
if (!existsSync(inputPath)) {
  console.error(`Missing ${inputMode} JSON: ${inputPath}`);
  process.exit(2);
}

const captureData = JSON.parse(readFileSync(inputPath, "utf8"));
const textureBundle = args.textureBundle
  ? JSON.parse(readFileSync(resolve(args.textureBundle), "utf8"))
  : { textures: {} };
const modelBundle = args.modelBundle
  ? JSON.parse(readFileSync(resolve(args.modelBundle), "utf8"))
  : { models: {} };
const width = parsePositiveInt(args.width ?? "256", "--width");
const height = parsePositiveInt(args.height ?? "256", "--height");
const sampleTime = Number(args.time ?? "0");
if (!Number.isFinite(sampleTime) || sampleTime < 0) {
  console.error(`Invalid --time: ${args.time}`);
  process.exit(2);
}

const browser = findBrowser();
if (!browser) {
  console.error("No supported browser found. Install Microsoft Edge or set EDGE_BIN.");
  process.exit(2);
}

const htmlRelativePath = `scripts/.effect-tools-capture.${process.pid}.${Date.now()}.tmp.html`;
const htmlPath = join(repoRoot, htmlRelativePath);
let vite = null;

class ReportedFailure extends Error {
  constructor(code) {
    super(`reported failure ${code}`);
    this.code = code;
  }
}

try {
  writeFileSync(
    htmlPath,
    buildHarnessHtml(inputMode, captureData, textureBundle, modelBundle, { width, height, sampleTime }),
    "utf8",
  );

  const port = await getFreePort();
  vite = spawn(process.execPath, [
    join(repoRoot, "node_modules/vite/bin/vite.js"),
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--strictPort",
  ], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const viteOutput = [];
  vite.stdout.on("data", (chunk) => viteOutput.push(chunk.toString()));
  vite.stderr.on("data", (chunk) => viteOutput.push(chunk.toString()));

  const url = `http://127.0.0.1:${port}/${htmlRelativePath}`;
  await waitForUrl(url, vite);

  const result = spawnSync(browser, [
    "--headless=new",
    "--disable-gpu",
    "--virtual-time-budget=5000",
    "--dump-dom",
    url,
  ], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 15000,
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.stderr.write(viteOutput.join(""));
    throw new ReportedFailure(result.status ?? 1);
  }

  const match = result.stdout.match(/<pre id="out">([^<]+)<\/pre>/);
  if (!match || match[1] === "pending") {
    console.error("Capture harness did not emit a completed JSON result.");
    process.stderr.write(result.stderr);
    process.stderr.write(viteOutput.join(""));
    throw new ReportedFailure(1);
  }

  const report = JSON.parse(decodeHtmlEntities(match[1]));
  if (!report.pass) {
    console.error(JSON.stringify(report, null, 2));
    throw new ReportedFailure(1);
  }
  const skipped = inputMode === "effect"
    ? report.skippedSubEffects ?? []
    : inputMode === "particle"
      ? [
          ...(report.skippedParticleSystems ?? []),
          ...(report.skippedCharacterModels ?? []),
        ]
      : [
          ...(report.skippedMagicEffects ?? []),
          ...(report.skippedMagicParticleEffects ?? []),
        ];
  if (args.failOnSkipped && skipped.length > 0) {
    console.error(JSON.stringify({
      pass: false,
      error: `Capture skipped required ${inputMode === "effect" ? "sub-effects" : inputMode === "particle" ? "particle systems" : "magic effects"}.`,
      ...(inputMode === "effect"
        ? { skippedSubEffects: skipped }
        : inputMode === "particle"
          ? {
              skippedParticleSystems: report.skippedParticleSystems ?? [],
              skippedCharacterModels: report.skippedCharacterModels ?? [],
            }
          : {
              skippedMagicEffects: report.skippedMagicEffects ?? [],
              skippedMagicParticleEffects: report.skippedMagicParticleEffects ?? [],
            }),
    }, null, 2));
    throw new ReportedFailure(1);
  }

  const rgba = Buffer.from(report.rgba, "base64");
  writeFileSync(resolve(args.out), writeBmp24(report.width, report.height, rgba));
  console.log(JSON.stringify({
    schema: "pko-effect-tools-capture/v1",
    ...(inputMode === "effect"
      ? { effectJson: inputPath }
      : inputMode === "particle"
        ? { parJson: inputPath }
        : { magicScenario: inputPath }),
    out: resolve(args.out),
    width: report.width,
    height: report.height,
    time: sampleTime,
    ...(inputMode === "effect"
      ? {
          renderedSubEffects: report.renderedSubEffects,
          skippedSubEffects: report.skippedSubEffects,
        }
      : inputMode === "particle"
        ? {
          renderedParticleSystems: report.renderedParticleSystems,
          skippedParticleSystems: report.skippedParticleSystems,
          renderedCharacterModels: report.renderedCharacterModels,
          skippedCharacterModels: report.skippedCharacterModels,
        }
        : {
          renderedMagicEffects: report.renderedMagicEffects,
          skippedMagicEffects: report.skippedMagicEffects,
          renderedMagicParticleEffects: report.renderedMagicParticleEffects,
          skippedMagicParticleEffects: report.skippedMagicParticleEffects,
        }),
  }, null, 2));
} catch (error) {
  if (error instanceof ReportedFailure) {
    process.exitCode = error.code;
  } else {
    throw error;
  }
} finally {
  if (vite) {
    vite.kill();
  }
  rmSync(htmlPath, { force: true });
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") continue;
    if (arg === "--help" || arg === "-h") parsed.help = true;
    else if (arg === "--effect-json") parsed.effectJson = argv[++i];
    else if (arg === "--par-json") parsed.parJson = argv[++i];
    else if (arg === "--magic-scenario") parsed.magicScenario = argv[++i];
    else if (arg === "--texture-bundle") parsed.textureBundle = argv[++i];
    else if (arg === "--model-bundle") parsed.modelBundle = argv[++i];
    else if (arg === "--out") parsed.out = argv[++i];
    else if (arg === "--time") parsed.time = argv[++i];
    else if (arg === "--width") parsed.width = argv[++i];
    else if (arg === "--height") parsed.height = argv[++i];
    else if (arg === "--fail-on-skipped") parsed.failOnSkipped = true;
    else {
      console.error(`Unknown argument: ${arg}`);
      parsed.help = true;
    }
  }
  return parsed;
}

function getInputMode(parsed) {
  const modes = [
    parsed.effectJson ? "effect" : "",
    parsed.parJson ? "particle" : "",
    parsed.magicScenario ? "magic" : "",
  ].filter(Boolean);
  return modes.length === 1 ? modes[0] : "";
}

function printUsage() {
  console.log(`Usage:
  node scripts/effect-tools-capture.mjs --effect-json effect.json --out candidate.bmp
  node scripts/effect-tools-capture.mjs --par-json particles.json --out candidate.bmp
  node scripts/effect-tools-capture.mjs --magic-scenario magic-scenario.json --out candidate.bmp

Options:
  --time 0       Sample time in seconds.
  --width 256    Capture width.
  --height 256   Capture height.
  --texture-bundle textures.json
  --model-bundle models.json
  --fail-on-skipped

Texture bundle schema:
  {
    "textures": {
      "textureName": { "width": 1, "height": 1, "rgba": "base64 RGBA bytes" }
    }
  }

Model bundle schema:
  {
    "models": {
      "modelName": { "gltf": "{ glTF JSON string }" }
    },
    "effects": {
      "effectName": { "effect": { "subEffects": [] } }
    }
  }

The input JSON should be the parsed pko-tools EffectFile shape, for example
from src-tauri/examples/pko_inspect on a .eff file, or a parsed ParFile
shape for supported particle-system capture slices. This runner is headless
and renders pko-tools candidate BMPs only; it does not launch the game client.`);
}

function buildHarnessHtml(captureKind, captureData, textureBundle, modelBundle, options) {
  return `<!doctype html>
<meta charset="utf-8">
<body>
<pre id="out">pending</pre>
<script type="module">
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  resolveGeometry,
  createRectGeometry,
  createRectPlaneGeometry,
  createRectZGeometry,
  createTriangleGeometry,
  createTrianglePlaneGeometry,
  createCylinderGeometry,
} from "/src/features/effect/rendering.ts";
import { interpolateFrame, getFrameDurations } from "/src/features/effect/animation.ts";
import { resolveFrameTextureName } from "/src/features/effect-v2/frameTexture.ts";
import { applySubEffectFrame } from "/src/features/effect/applySubEffectFrame.ts";
import { buildEffectMaterialProps } from "/src/features/effect/buildEffectMaterialProps.ts";
import { applyTextureSampling, composePkoRenderState } from "/src/features/effect/pkoStateEmulation.ts";
import { getThreeJSBlendFromD3D } from "/src/features/effect-v2/helpers.ts";
import { computeEffectGroupRotation } from "/src/features/effect-v2/renderers/effectGroupKinematics.ts";
import {
  applyMagicRotatingXZ,
  applySourceStyleMagicOrientation,
  getMagicEmissionDirection,
  getMagicFlightPathForTest,
} from "/src/features/effect-v2/renderers/flight/FlightPathController.tsx";
import {
  createRangeParticles,
  createRange2Particles,
  createRange2RuntimeState,
  stepRange2Particles,
} from "/src/features/effect-v2/renderers/particles/rangeKinematics.ts";
import {
  initModelParticle,
  moveModelParticle,
} from "/src/features/effect-v2/renderers/particles/modelKinematics.ts";
import {
  advanceBlast2ParticleFrame,
  computeBlastSpawnState,
  initBlast2Particle,
  initBlast3Particle,
  moveBlast2Particle,
  moveBlastParticle,
  moveBlast3Particle,
} from "/src/features/effect-v2/renderers/particles/blastKinematics.ts";
import {
  advanceParticleFrame,
  advanceSteppedSpawnAccumulator,
  getParticleFramePair,
} from "/src/features/effect-v2/renderers/particles/useParticleLifecycle.ts";
import {
  initRoundParticle,
  moveRoundParticle,
} from "/src/features/effect-v2/renderers/particles/roundKinematics.ts";
import {
  initArrowParticle,
  moveArrowParticle,
} from "/src/features/effect-v2/renderers/particles/arrowKinematics.ts";
import {
  computeShrinkSpawnState,
  moveShrinkParticle,
} from "/src/features/effect-v2/renderers/particles/shrinkKinematics.ts";
import {
  computeFireMovementDelta,
  computeFireSpawnState,
} from "/src/features/effect-v2/renderers/particles/fireKinematics.ts";
import {
  computeSnowMovementDelta,
  computeSnowSpawnState,
} from "/src/features/effect-v2/renderers/particles/snowKinematics.ts";
import {
  computeRippleSpawnPosition,
} from "/src/features/effect-v2/renderers/particles/rippleKinematics.ts";
import {
  computeWindSpawnState,
  moveWindParticle,
} from "/src/features/effect-v2/renderers/particles/windKinematics.ts";
import {
  computeStripSpawnPosition,
} from "/src/features/effect-v2/renderers/particles/stripKinematics.ts";
import {
  initShadeParticle,
  moveShadeParticle,
} from "/src/features/effect-v2/renderers/particles/shadeKinematics.ts";
import {
  computeDummySpawnPosition,
  computeLineRoundVelocity,
  computeLineSingleDelta,
  computeLineSingleVelocity,
} from "/src/features/effect-v2/renderers/particles/dummyLineKinematics.ts";

const captureKind = ${JSON.stringify(captureKind)};
const captureData = ${JSON.stringify(captureData)};
const textureBundle = ${JSON.stringify(textureBundle)};
const modelBundle = ${JSON.stringify(modelBundle)};
const width = ${options.width};
const height = ${options.height};
const sampleTime = ${options.sampleTime};
const textureCache = new Map();
const modelCache = new Map();
const gltfLoader = new GLTFLoader();

run();

async function run() {
try {
  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    alpha: false,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(width, height, false);
  renderer.setClearColor(0x000000, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, -100, 100);
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);

  const captureReport = captureKind === "effect"
    ? await renderEffectCapture(scene, camera, captureData)
    : captureKind === "particle"
      ? await renderParticleCapture(scene, camera, captureData)
      : await renderMagicCapture(scene, camera, captureData);

  renderer.render(scene, camera);
  const gl = renderer.getContext();
  const pixels = new Uint8Array(width * height * 4);
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  renderer.dispose();

  document.getElementById("out").textContent = JSON.stringify({
    pass: true,
    width,
    height,
    rgba: uint8ToBase64(pixels),
    ...captureReport,
  });
} catch (error) {
  document.getElementById("out").textContent = JSON.stringify({
    pass: false,
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : "",
  });
}
}

async function renderEffectCapture(scene, camera, effect) {
  const group = new THREE.Group();
  group.quaternion.copy(computeEffectGroupRotation(effect, sampleTime));
  scene.add(group);

  const result = await addEffectToGroup(group, camera, effect, sampleTime);
  return {
    renderedSubEffects: result.renderedSubEffects,
    skippedSubEffects: result.skippedSubEffects,
  };
}

async function renderMagicCapture(scene, camera, scenario) {
  const magicEntry = scenario.magicEntry ?? scenario.magicEntryInfo ?? scenario.entry;
  if (!magicEntry || typeof magicEntry !== "object") {
    throw new Error("Magic scenario missing magicEntry object.");
  }

  const group = new THREE.Group();
  const flightSample = applyMagicScenarioTransform(group, scenario, magicEntry);
  scene.add(group);

  const effects = resolveMagicScenarioEffects(scenario, magicEntry);
  const skippedMagicEffects = [];
  const skippedMagicParticleEffects = [];
  let renderedMagicEffects = 0;
  let renderedMagicParticleEffects = 0;

  if (scenario.renderPhase !== "hit") {
    for (const [effectIndex, entry] of effects.entries()) {
      if (!entry.effect) {
        skippedMagicEffects.push({
          effectIndex,
          effectName: entry.name,
          reason: "missing-magic-effect",
        });
        continue;
      }
      const result = await addEffectToGroup(group, camera, entry.effect, sampleTime);
      if (result.renderedSubEffects > 0) {
        renderedMagicEffects += 1;
      }
      for (const skipped of result.skippedSubEffects) {
        skippedMagicEffects.push({
          effectIndex,
          effectName: entry.name,
          ...skipped,
        });
      }
    }

    for (const particleName of getMagicScenarioParticleNames(magicEntry)) {
      const particleEntry = resolveMagicScenarioParticleEffect(scenario, particleName);
      if (!particleEntry?.par) {
        skippedMagicParticleEffects.push({
          particleEffectName: particleName,
          reason: "missing-magic-particle-effect",
        });
        continue;
      }

      const particleGroup = new THREE.Group();
      particleGroup.position.copy(group.position);
      scene.add(particleGroup);

      const particleResult = await addParticleFileToGroup(particleGroup, camera, particleEntry.par);
      if (particleResult.renderedParticleSystems > 0) {
        renderedMagicParticleEffects += 1;
      }
      for (const skipped of particleResult.skippedParticleSystems) {
        skippedMagicParticleEffects.push({
          particleEffectName: particleEntry.name,
          ...skipped,
        });
      }
    }
  }

  if (scenario.renderPhase === "hit") {
    const resultParticleName = String(magicEntry.result_effect ?? "").trim();
    const particleEntry = resolveMagicScenarioParticleEffect(scenario, resultParticleName);
    if (!particleEntry?.par) {
      skippedMagicParticleEffects.push({
        particleEffectName: resultParticleName,
        reason: "missing-magic-particle-effect",
      });
    } else {
      const hitGroup = new THREE.Group();
      hitGroup.position.copy(flightSample.arrivalPosition);
      scene.add(hitGroup);

      const particleResult = await addParticleFileToGroup(hitGroup, camera, particleEntry.par, {
        sourceDirection: flightSample.arrivalDirection,
      });
      if (particleResult.renderedParticleSystems > 0) {
        renderedMagicParticleEffects += 1;
      }
      for (const skipped of particleResult.skippedParticleSystems) {
        skippedMagicParticleEffects.push({
          particleEffectName: particleEntry.name,
          ...skipped,
        });
      }
    }
  }

  return {
    renderedMagicEffects,
    skippedMagicEffects,
    renderedMagicParticleEffects,
    skippedMagicParticleEffects,
  };
}

async function addEffectToGroup(group, camera, effect, playbackTime, options = {}) {
  const skippedSubEffects = [];
  let renderedSubEffects = 0;

  for (const [index, sub] of (effect.subEffects ?? []).entries()) {
    const geometry = await createGeometry(sub);
    if (!geometry) {
      skippedSubEffects.push({ index, modelName: sub.modelName, reason: "missing-external-model" });
      continue;
    }

    const techniqueState = composePkoRenderState(effect.idxTech ?? 0, {
      srcBlend: sub.srcBlend || undefined,
      destBlend: sub.destBlend || undefined,
    });
    const localTime = localPlaybackTime(sub, playbackTime);
    const texture = getTexture(resolveFrameTextureName(sub, localTime, true));
    if (texture) applyTextureSampling(texture, techniqueState);
    const material = new THREE.MeshBasicMaterial(
      buildEffectMaterialProps(sub, texture, techniqueState),
    );
    const mesh = new THREE.Mesh(geometry, material);
    const frame = interpolateFrame(sub, localTime, true);
    applySubEffectFrame(mesh, camera, {
      sub,
      position: frame.position,
      scale: frame.size,
      angle: frame.angle,
      color: frame.color,
      playbackTime,
      frameIndex: frame.frameIndex,
      nextFrameIndex: frame.nextFrameIndex,
      lerp: frame.lerp,
      forgeAlpha: options.alpha,
      isCylinder: resolveGeometry(sub, frame.frameIndex).type === "cylinder",
      cylinderCache: new Map(),
    });
    group.add(mesh);
    renderedSubEffects += 1;
  }

  return { renderedSubEffects, skippedSubEffects };
}

function resolveMagicScenarioEffects(scenario, magicEntry) {
  const rawEffects = Array.isArray(scenario.effects)
    ? scenario.effects
    : scenario.effect
      ? [scenario.effect]
      : [];
  const modelNames = Array.isArray(magicEntry.models) ? magicEntry.models : [];
  const records = rawEffects
    .map((entry, index) => {
      const effect = entry?.effect ?? entry?.effectFile ?? entry;
      if (!effect || typeof effect !== "object") return null;
      return {
        name: String(entry?.name ?? modelNames[index] ?? effect.name ?? \`effect-\${index}\`),
        effect,
      };
    })
    .filter(Boolean);
  const namedRecords = new Map(records.map((record) => [normalizeEffectName(record.name), record]));
  const requestedModels = modelNames
    .map((name) => String(name ?? "").trim())
    .filter((name) => name.length > 0 && name !== "0");

  if (requestedModels.length === 0) return records;

  return requestedModels.map((modelName, index) => {
    const record = namedRecords.get(normalizeEffectName(modelName)) ?? records[index];
    return {
      name: modelName,
      effect: record?.effect ?? null,
    };
  });
}

function resolveMagicScenarioParticleEffect(scenario, requestedName) {
  const rawEffects = Array.isArray(scenario.particleEffects)
    ? scenario.particleEffects
    : Array.isArray(scenario.parFiles)
      ? scenario.parFiles
      : scenario.particleEffect
        ? [scenario.particleEffect]
        : [];
  const requestedKey = normalizeParticleEffectName(requestedName);
  const records = rawEffects
    .map((entry, index) => {
      const par = entry?.par ?? entry?.parFile ?? entry?.particleFile ?? entry;
      if (!par || typeof par !== "object") return null;
      return {
        name: String(entry?.name ?? entry?.fileName ?? \`particle-\${index}\`),
        par,
      };
    })
    .filter(Boolean);
  if (!requestedKey) return records[0] ?? null;
  return records.find((record) => normalizeParticleEffectName(record.name) === requestedKey)
    ?? records[0]
    ?? null;
}

function getMagicScenarioParticleNames(magicEntry) {
  return (Array.isArray(magicEntry.particles) ? magicEntry.particles : [])
    .map((name) => String(name ?? "").trim())
    .filter((name) => name.length > 0 && name !== "0");
}

function applyMagicScenarioTransform(group, scenario, magicEntry) {
  const origin = vectorFromTuple(scenario.origin, new THREE.Vector3(0, 0, 0));
  const target = vectorFromTuple(scenario.target, new THREE.Vector3(0, 8, 1));
  const renderIdx = Number(magicEntry.render_idx ?? 0);
  const velocity = Number(magicEntry.velocity ?? 0);
  const flightPath = getMagicFlightPathForTest(renderIdx);
  group.position.copy(origin);
  applyMagicRotatingXZ(group, getMagicEmissionDirection(origin, target, renderIdx));
  let arrivalPosition = target.clone();
  let arrivalDirection = getMagicEmissionDirection(origin, target, renderIdx);
  if (arrivalDirection.lengthSq() > 0.000001) {
    arrivalDirection.normalize();
  }

  if (!flightPath || sampleTime <= 0) {
    return { arrivalPosition, arrivalDirection };
  }

  const state = {};
  let elapsed = 0;
  let done = false;
  let pendingPosition = null;
  let pendingQuaternion = null;
  const fixedStep = 1 / 60;

  while (!done && elapsed < sampleTime) {
    const delta = Math.min(fixedStep, sampleTime - elapsed);
    if (pendingPosition) group.position.copy(pendingPosition);
    if (pendingQuaternion) group.quaternion.copy(pendingQuaternion);

    const wasInitialized = Boolean(state.initialized);
    if (!wasInitialized) {
      applyMagicRotatingXZ(group, getMagicEmissionDirection(origin, target, renderIdx));
    }

    const renderPosition = group.position.clone();
    const renderQuaternion = group.quaternion.clone();
    const ctx = {
      origin,
      target,
      velocity,
      elapsed: elapsed + delta,
      delta,
      state,
      done: false,
    };

    flightPath(ctx, group);
    applySourceStyleMagicOrientation(group, ctx, renderIdx, wasInitialized);

    pendingPosition = group.position.clone();
    pendingQuaternion = group.quaternion.clone();
    arrivalPosition = pendingPosition.clone();
    arrivalDirection = (ctx.sourceDirection ?? arrivalDirection).clone();
    if (arrivalDirection.lengthSq() > 0.000001) {
      arrivalDirection.normalize();
    }
    group.position.copy(renderPosition);
    group.quaternion.copy(renderQuaternion);
    done = Boolean(ctx.done);
    elapsed += delta;
  }

  return { arrivalPosition, arrivalDirection };
}

function vectorFromTuple(value, fallback) {
  if (!Array.isArray(value)) return fallback.clone();
  return new THREE.Vector3(
    Number(value[0] ?? 0),
    Number(value[1] ?? 0),
    Number(value[2] ?? 0),
  );
}

async function renderParticleCapture(scene, camera, parFile) {
  const group = new THREE.Group();
  scene.add(group);
  return addParticleFileToGroup(group, camera, parFile);
}

async function addParticleFileToGroup(group, camera, parFile, options = {}) {
  const skippedParticleSystems = [];
  const skippedCharacterModels = [];
  let renderedParticleSystems = 0;
  let renderedCharacterModels = 0;

  for (const [index, system] of (parFile.systems ?? []).entries()) {
    const sample = sampleParticleSystem(system, parFile, options);
    if (!sample) {
      skippedParticleSystems.push({
        index,
        type: system.type,
        name: system.name,
        reason: "unsupported-particle-system-type",
      });
      continue;
    }

    if (sample.visual === "model") {
      if (isEffectModelName(system.modelName)) {
        const effect = loadNestedEffect(system.modelName);
        if (!effect) {
          skippedParticleSystems.push({
            index,
            type: system.type,
            name: system.name,
            modelName: system.modelName,
            reason: "missing-particle-effect",
          });
          continue;
        }
        for (const particle of sample.particles.filter((p) => p.alive)) {
          const particleGroup = new THREE.Group();
          particleGroup.position.copy(particle.pos);
          particleGroup.scale.setScalar(particle.size);
          applyParticleModelRotation(particleGroup, system, particle, options.sourceDirection);
          await addEffectToGroup(particleGroup, camera, effect, sampleTime, {
            alpha: particle.alpha,
          });
          group.add(particleGroup);
        }
        renderedParticleSystems += 1;
        continue;
      }

      const geometry = await loadModelGeometry(system.modelName);
      if (!geometry) {
        skippedParticleSystems.push({
          index,
          type: system.type,
          name: system.name,
          modelName: system.modelName,
          reason: "missing-particle-model",
        });
        continue;
      }
      for (const particle of sample.particles.filter((p) => p.alive)) {
        const mesh = createParticleModelMesh(system, particle, geometry, options.sourceDirection);
        mesh.position.copy(particle.pos);
        mesh.scale.setScalar(particle.size);
        group.add(mesh);
      }
      renderedParticleSystems += 1;
      continue;
    }

    if (sample.visual === "shade") {
      for (const particle of sample.particles.filter((p) => p.alive)) {
        const mesh = createParticleShadeMesh(system, particle);
        mesh.position.copy(particle.pos);
        group.add(mesh);
      }
      renderedParticleSystems += 1;
      continue;
    }

    for (const particle of sample.particles.filter((p) => p.alive)) {
      const mesh = createParticleRingMesh(system, particle);
      mesh.position.copy(particle.pos);
      group.add(mesh);
    }
    renderedParticleSystems += 1;
  }

  for (const [index, model] of (parFile.models ?? []).entries()) {
    const geometry = await loadModelGeometry(String(model.id));
    if (!geometry) {
      skippedCharacterModels.push({
        index,
        id: model.id,
        reason: "missing-character-model",
      });
      continue;
    }
    group.add(createCharacterModelMesh(model, geometry));
    renderedCharacterModels += 1;
  }

  return {
    renderedParticleSystems,
    skippedParticleSystems,
    renderedCharacterModels,
    skippedCharacterModels,
  };
}

function sampleParticleSystem(system, parFile, options = {}) {
  if (system.type === 14) {
    return { visual: "ring", particles: createRangeParticles(system, () => 0.5) };
  }
  if (system.type === 15) {
    const particles = createRange2Particles(system);
    const runtime = createRange2RuntimeState();
    let elapsed = 0;
    const dt = 1 / 60;
    while (elapsed < sampleTime && !runtime.completed) {
      const step = Math.min(dt, sampleTime - elapsed);
      stepRange2Particles(particles, runtime, system, step, () => 0.5);
      elapsed += step;
    }
    return { visual: "ring", particles };
  }
  if (system.type === 5) {
    return {
      visual: "model",
      particles: sampleModelParticles(system),
    };
  }
  if (system.type === 3) {
    return {
      visual: "model",
      particles: sampleBlastParticles(system),
    };
  }
  if (system.type === 11) {
    return {
      visual: "model",
      particles: sampleBlast3Particles(system),
    };
  }
  if (system.type === 9) {
    return {
      visual: "model",
      particles: sampleRoundParticles(system),
    };
  }
  if (system.type === 8) {
    return {
      visual: "model",
      particles: sampleArrowParticles(system),
    };
  }
  if (system.type === 12) {
    return {
      visual: "model",
      particles: sampleShrinkParticles(system),
    };
  }
  if (system.type === 10) {
    return {
      visual: "model",
      particles: sampleBlast2Particles(system),
    };
  }
  if (system.type === 2) {
    return {
      visual: "model",
      particles: sampleFireParticles(system, options.sourceDirection),
    };
  }
  if (system.type === 1) {
    return {
      visual: "model",
      particles: sampleSnowParticles(system),
    };
  }
  if (system.type === 4) {
    return {
      visual: "model",
      particles: sampleRippleParticles(system),
    };
  }
  if (system.type === 7) {
    return {
      visual: "model",
      particles: sampleWindParticles(system),
    };
  }
  if (system.type === 6) {
    return {
      visual: "model",
      particles: [createStaticStripParticle(system)],
    };
  }
  if (system.type === 13) {
    return {
      visual: "shade",
      particles: sampleShadeParticles(system),
    };
  }
  if (system.type === 16) {
    const dummyLineSpan = parseDummyLineSpan(system.dummyLineSpan ?? parFile.dummyLineSpan);
    if (!dummyLineSpan) return null;
    return {
      visual: "model",
      particles: sampleDummyParticles(system, dummyLineSpan),
    };
  }
  if (system.type === 17) {
    const dummyLineSpan = parseDummyLineSpan(system.dummyLineSpan ?? parFile.dummyLineSpan);
    if (!dummyLineSpan) return null;
    return {
      visual: "model",
      particles: sampleLineSingleParticles(system, dummyLineSpan),
    };
  }
  if (system.type === 18) {
    const dummyLineSpan = parseDummyLineSpan(system.dummyLineSpan ?? parFile.dummyLineSpan);
    if (!dummyLineSpan) return null;
    return {
      visual: "model",
      particles: sampleLineRoundParticles(system, dummyLineSpan),
    };
  }
  return null;
}

function sampleModelParticles(system) {
  const singleParticleSystem = { ...system, particleCount: 1 };
  const particle = createLifecycleParticle(singleParticleSystem, 0);
  initModelParticle(particle, 0, singleParticleSystem);

  stepLifecycleParticles(
    [particle],
    singleParticleSystem,
    sampleTime,
    (current, dt) => {
      moveModelParticle(current, current.index, dt, singleParticleSystem);
    },
    { frameEndBehavior: "reset" },
  );
  return [particle];
}

function createStaticStripParticle(system) {
  const color = system.frameColors[0] ?? [1, 1, 1, 1];
  return {
    alive: true,
    pos: computeStripSpawnPosition(system),
    dir: new THREE.Vector3(),
    accel: new THREE.Vector3(),
    size: system.frameSizes[0] ?? 1,
    color: new THREE.Color(color[0], color[1], color[2]),
    alpha: color[3],
    angle: new THREE.Vector3(
      system.frameAngles[0]?.[0] ?? 0,
      system.frameAngles[0]?.[1] ?? 0,
      system.frameAngles[0]?.[2] ?? 0,
    ),
    index: 0,
    curFrame: 0,
    curTime: 0,
    frameTime: 0,
    life: 0,
    elapsed: 0,
    custom: {},
  };
}

function sampleBlastParticles(system) {
  const particles = [];
  for (let index = 0; index < system.particleCount; index += 1) {
    const p = createLifecycleParticle(system, index);
    const state = computeBlastSpawnState(system, deterministicRandom);
    p.dir.copy(state.dir);
    p.accel.copy(state.accel);
    p.pos.copy(state.pos);
    particles.push(p);
  }

  stepLifecycleParticles(particles, system, sampleTime, (particle, dt) => {
    moveBlastParticle(particle, particle.index, dt, system);
  });
  return particles;
}

function sampleBlast3Particles(system) {
  const particles = [];
  for (let index = 0; index < system.particleCount; index += 1) {
    const p = createLifecycleParticle(system, index);
    initBlast3Particle(p, index, system);
    particles.push(p);
  }

  stepLifecycleParticles(particles, system, sampleTime, (particle, dt) => {
    moveBlast3Particle(particle, particle.index, dt, system);
  });
  return particles;
}

function sampleBlast2Particles(system) {
  const particles = [];
  for (let index = 0; index < system.particleCount; index += 1) {
    const p = createLifecycleParticle(system, index);
    initBlast2Particle(p, index, system);
    particles.push(p);
  }

  stepLifecycleParticles(
    particles,
    system,
    sampleTime,
    (particle, dt) => {
      moveBlast2Particle(particle, particle.index, dt, system);
    },
    { advanceFrame: advanceBlast2ParticleFrame },
  );
  return particles;
}

function sampleRoundParticles(system) {
  const particles = [];
  for (let index = 0; index < system.particleCount; index += 1) {
    const p = createLifecycleParticle(system, index);
    initRoundParticle(p, index, system);
    particles.push(p);
  }

  stepLifecycleParticles(
    particles,
    system,
    sampleTime,
    (particle, dt) => {
      moveRoundParticle(particle, particle.index, dt, system);
    },
    { frameEndBehavior: "reset", lastFrameNext: "wrap" },
  );
  return particles;
}

function sampleArrowParticles(system) {
  const singleParticleSystem = { ...system, particleCount: 1 };
  const particle = createLifecycleParticle(singleParticleSystem, 0);
  initArrowParticle(particle, 0, singleParticleSystem);

  stepLifecycleParticles(
    [particle],
    singleParticleSystem,
    sampleTime,
    (current, dt) => {
      moveArrowParticle(current, current.index, dt, singleParticleSystem);
    },
    { frameEndBehavior: "reset" },
  );
  return [particle];
}

function sampleShrinkParticles(system) {
  const particles = [];
  for (let index = 0; index < system.particleCount; index += 1) {
    const p = createLifecycleParticle(system, index);
    const state = computeShrinkSpawnState(system, shrinkSpawnRandom);
    p.dir.copy(state.target);
    p.accel.copy(state.accel);
    p.pos.copy(state.pos);
    particles.push(p);
  }

  stepLifecycleParticles(particles, system, sampleTime, (particle, dt) => {
    moveShrinkParticle(particle, particle.index, dt, system);
  });
  return particles;
}

function sampleFireParticles(system, sourceDirection = null) {
  return sampleDeadSlotEmitterParticles(
    system,
    (particle) => {
      const state = computeFireSpawnState(system, deterministicRandom);
      particle.dir.copy(state.dir);
      if (system.modelDir && sourceDirection?.lengthSq?.() > 0.000001) {
        particle.dir.copy(sourceDirection);
      }
      particle.accel.copy(state.accel);
      particle.pos.copy(state.pos);
    },
    (particle, dt) => {
      particle.pos.add(computeFireMovementDelta(
        particle.dir,
        particle.accel,
        system.velocity,
        dt,
        deterministicRandom,
      ));
    },
  );
}

function sampleSnowParticles(system) {
  return sampleDeadSlotEmitterParticles(
    system,
    (particle) => {
      const state = computeSnowSpawnState(system, deterministicRandom);
      if (!state) {
        particle.alive = false;
        return;
      }
      particle.dir.copy(state.dir);
      particle.accel.copy(state.accel);
      particle.pos.copy(state.pos);
    },
    (particle, dt) => {
      particle.pos.add(computeSnowMovementDelta(
        particle.dir,
        particle.accel,
        dt,
        deterministicRandom,
      ));
    },
  );
}

function sampleRippleParticles(system) {
  return sampleDeadSlotEmitterParticles(
    system,
    (particle) => {
      particle.pos.copy(computeRippleSpawnPosition(system, deterministicRandom));
    },
    () => {},
    { initialSpawnAccumulator: system.step },
  );
}

function sampleWindParticles(system) {
  const origins = new Map();
  return sampleDeadSlotEmitterParticles(
    system,
    (particle) => {
      const state = computeWindSpawnState(system, deterministicRandom);
      particle.life = system.life;
      particle.frameTime = system.frameCount > 0 ? system.life / system.frameCount : system.life;
      particle.pos.copy(state.pos);
      particle.accel.copy(state.accel);
      particle.dir.set(state.angle, state.angularVelocity, 0);
      origins.set(particle.index, state.origin);
    },
    (particle, dt) => {
      const origin = origins.get(particle.index);
      if (origin) moveWindParticle(particle, particle.index, dt, system, origin);
    },
  );
}

function sampleShadeParticles(system) {
  const singleParticleSystem = { ...system, particleCount: 1, randomMode: 1 };
  const particle = createLifecycleParticle(singleParticleSystem, 0);
  initShadeParticle(particle, 0, singleParticleSystem);

  stepLifecycleParticles([particle], singleParticleSystem, sampleTime, (current, dt) => {
    moveShadeParticle(current, current.index, dt, singleParticleSystem);
  });
  return [particle];
}

function sampleDummyParticles(system, dummyLineSpan) {
  const particles = [];
  for (let index = 0; index < system.particleCount; index += 1) {
    const p = createLifecycleParticle(system, index);
    p.pos.copy(computeDummySpawnPosition(dummyLineSpan, system.particleCount, deterministicRandom));
    particles.push(p);
  }

  stepLifecycleParticles(particles, system, sampleTime, () => {});
  return particles;
}

function sampleLineSingleParticles(system, dummyLineSpan) {
  const particles = [];
  for (let index = 0; index < system.particleCount; index += 1) {
    const p = createLifecycleParticle(system, index);
    p.pos.copy(dummyLineSpan.start);
    p.dir.copy(computeLineSingleVelocity(dummyLineSpan, p.life));
    p.accel.set(0, 0, 0);
    particles.push(p);
  }

  stepLifecycleParticles(particles, system, sampleTime, (particle, dt) => {
    particle.pos.add(computeLineSingleDelta(particle.dir, particle.accel, dt));
  });
  return particles;
}

function sampleLineRoundParticles(system, dummyLineSpan) {
  const particles = [];
  for (let index = 0; index < system.particleCount; index += 1) {
    const p = createLifecycleParticle(system, index);
    p.pos.copy(dummyLineSpan.start);
    p.dir.copy(computeLineRoundVelocity(dummyLineSpan, p.life));
    p.accel.set(0, 0, 0);
    particles.push(p);
  }

  stepLifecycleParticles(particles, system, sampleTime, (particle, dt) => {
    if (particle.elapsed > particle.life / 2 && particle.elapsed - dt <= particle.life / 2) {
      particle.dir.negate();
    }
    particle.pos.addScaledVector(particle.dir, dt);
  });
  return particles;
}

function sampleDeadSlotEmitterParticles(system, initParticle, moveParticle, options = {}) {
  const particles = [];
  for (let index = 0; index < system.particleCount; index += 1) {
    particles.push(createLifecycleParticle({ ...system, life: system.life }, index, false));
  }

  const stepSize = 1 / 60;
  let elapsed = 0;
  let spawnAccumulator = options.initialSpawnAccumulator ?? 0;
  const stepCount = Math.ceil(sampleTime / stepSize + 1e-9);
  for (let stepIndex = 0; stepIndex < stepCount && elapsed < sampleTime; stepIndex += 1) {
    const dt = Math.min(stepSize, sampleTime - elapsed);
    if (dt <= 0) break;
    for (const particle of particles) {
      if (!particle.alive) {
        const stepped = advanceSteppedSpawnAccumulator(spawnAccumulator, dt, system.step);
        spawnAccumulator = stepped.next;
        if (stepped.shouldSpawn) {
          resetParticleForSpawn(particle, system);
          initParticle(particle);
        }
        continue;
      }

      particle.elapsed += dt;
      advanceParticleFrame(particle, dt, system.frameCount, options.frameEndBehavior ?? "kill");
      if (!particle.alive) continue;
      applyParticleFrameOutputs(particle, system, options.lastFrameNext ?? "hold");
      moveParticle(particle, dt);
    }
    elapsed += dt;
  }
  return particles;
}

function createLifecycleParticle(system, index, alive = true) {
  const life = system.life;
  return {
    alive,
    pos: new THREE.Vector3(),
    dir: new THREE.Vector3(),
    accel: new THREE.Vector3(),
    size: system.frameSizes[0] ?? 1,
    color: new THREE.Color(1, 1, 1),
    alpha: 1,
    angle: new THREE.Vector3(),
    index,
    curFrame: 0,
    curTime: 0,
    frameTime: system.frameCount > 0 ? life / system.frameCount : life,
    life,
    elapsed: 0,
    custom: {},
  };
}

function resetParticleForSpawn(particle, system) {
  particle.alive = true;
  particle.pos.set(0, 0, 0);
  particle.dir.set(0, 0, 0);
  particle.accel.set(0, 0, 0);
  particle.size = system.frameSizes[0] ?? 1;
  particle.color.setRGB(1, 1, 1);
  particle.alpha = 1;
  particle.angle.set(0, 0, 0);
  particle.curFrame = 0;
  particle.curTime = 0;
  particle.frameTime = system.frameCount > 0 ? system.life / system.frameCount : system.life;
  particle.life = system.life;
  particle.elapsed = 0;
  particle.custom = {};
}

function stepLifecycleParticles(particles, system, targetTime, moveParticle, options = {}) {
  const frameEndBehavior = options.frameEndBehavior ?? "kill";
  const lastFrameNext = options.lastFrameNext ?? "hold";
  const advanceFrame = options.advanceFrame;
  let elapsed = 0;
  const stepSize = 1 / 60;
  const stepCount = Math.ceil(targetTime / stepSize + 1e-9);
  for (let stepIndex = 0; stepIndex < stepCount && elapsed < targetTime; stepIndex += 1) {
    const dt = Math.min(stepSize, targetTime - elapsed);
    if (dt <= 0) break;
    for (const particle of particles) {
      if (!particle.alive) continue;
      particle.elapsed += dt;
      const frameAdvance = advanceFrame
        ? advanceFrame(particle, dt, system.frameCount, frameEndBehavior)
        : {};
      if (!advanceFrame) {
        advanceParticleFrame(particle, dt, system.frameCount, frameEndBehavior);
      }
      if (!particle.alive) continue;
      if (!frameAdvance.skipFrameOutputs) {
        applyParticleFrameOutputs(particle, system, lastFrameNext);
      }
      if (!frameAdvance.skipMove) {
        moveParticle(particle, dt);
      }
    }
    elapsed += dt;
  }
}

function applyParticleFrameOutputs(particle, system, lastFrameNext = "hold") {
  const { cur, next } = getParticleFramePair(particle.curFrame, system.frameCount, lastFrameNext);
  const fLerp = particle.frameTime > 0 ? particle.curTime / particle.frameTime : 0;
  const s0 = system.frameSizes[cur] ?? particle.size;
  const s1 = system.frameSizes[next] ?? s0;
  particle.size = THREE.MathUtils.lerp(s0, s1, fLerp);

  const cc = system.frameColors[cur] ?? [1, 1, 1, 1];
  const nc = system.frameColors[next] ?? cc;
  particle.color.setRGB(
    THREE.MathUtils.lerp(cc[0], nc[0], fLerp),
    THREE.MathUtils.lerp(cc[1], nc[1], fLerp),
    THREE.MathUtils.lerp(cc[2], nc[2], fLerp),
  );
  particle.alpha = THREE.MathUtils.lerp(cc[3], nc[3], fLerp);

  const ca = system.frameAngles[cur] ?? [0, 0, 0];
  const na = system.frameAngles[next] ?? ca;
  particle.angle.set(
    THREE.MathUtils.lerp(ca[0], na[0], fLerp),
    THREE.MathUtils.lerp(ca[1], na[1], fLerp),
    THREE.MathUtils.lerp(ca[2], na[2], fLerp),
  );
}

function deterministicRandom() {
  return 0.5;
}

function shrinkSpawnRandom() {
  return 0.75;
}

function createParticleRingMesh(system, particle) {
  const size = Math.max(0.0001, particle.size);
  const geometry = new THREE.RingGeometry(size * 0.8, size, 32);
  const material = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: particle.alpha,
    color: particle.color,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendSrc: getThreeJSBlendFromD3D(system.srcBlend),
    blendDst: getThreeJSBlendFromD3D(system.destBlend),
    toneMapped: false,
    fog: false,
  });
  return new THREE.Mesh(geometry, material);
}

function createParticleShadeMesh(system, particle) {
  const texture = getTexture(system.textureName);
  if (texture) {
    applyTextureSampling(texture, composePkoRenderState(3, {
      minFilter: system.minFilter,
      magFilter: system.magFilter,
    }));
  }
  const geometry = new THREE.PlaneGeometry(particle.size, particle.size);
  const material = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: particle.alpha,
    color: particle.color,
    map: texture,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendSrc: getThreeJSBlendFromD3D(system.srcBlend),
    blendDst: getThreeJSBlendFromD3D(system.destBlend),
    toneMapped: false,
    fog: false,
  });
  return new THREE.Mesh(geometry, material);
}

function createParticleModelMesh(system, particle, geometry, sourceDirection = null) {
  const texture = getTexture(system.textureName);
  if (texture) {
    applyTextureSampling(texture, composePkoRenderState(3, {
      minFilter: system.minFilter,
      magFilter: system.magFilter,
    }));
  }
  const material = new THREE.MeshBasicMaterial({
    color: particle.color,
    opacity: particle.alpha,
    map: texture,
    transparent: true,
    blending: THREE.CustomBlending,
    blendSrc: getThreeJSBlendFromD3D(system.srcBlend),
    blendDst: getThreeJSBlendFromD3D(system.destBlend),
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  applyParticleModelRotation(mesh, system, particle, sourceDirection);
  return mesh;
}

function createCharacterModelMesh(model, geometry) {
  const material = new THREE.MeshBasicMaterial({
    color: new THREE.Color(model.color?.[0] ?? 1, model.color?.[1] ?? 1, model.color?.[2] ?? 1),
    opacity: model.color?.[3] ?? 1,
    transparent: true,
    blending: THREE.CustomBlending,
    blendSrc: getThreeJSBlendFromD3D(model.srcBlend),
    blendDst: getThreeJSBlendFromD3D(model.destBlend),
    depthWrite: true,
    side: THREE.BackSide,
    toneMapped: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = Math.PI / 2;
  return mesh;
}

function applyParticleModelRotation(mesh, system, particle, sourceDirection = null) {
  if (system.type === 8) {
    mesh.rotation.set(0, 0, 0);
    return;
  }

  const angle = particle.angle ?? new THREE.Vector3();
  if (system.type === 12) {
    const rotationX = new THREE.Matrix4().makeRotationX(angle.x);
    const rotationZ = new THREE.Matrix4().makeRotationZ(angle.y);
    mesh.setRotationFromMatrix(rotationZ.multiply(rotationX));
    return;
  }

  if (system.modelDir) {
    const frameMatrix = new THREE.Matrix4().makeRotationFromEuler(
      new THREE.Euler(angle.x, angle.y, angle.z, "YXZ"),
    );
    const direction = new THREE.Vector3();
    if (sourceDirection?.lengthSq?.() > 0.000001) {
      direction.copy(sourceDirection);
    } else if (system.type === 5 || system.type === 6) {
      direction.set(system.direction[0], system.direction[1], system.direction[2]);
    } else {
      direction.copy(particle.dir ?? new THREE.Vector3());
    }
    const modelDirMatrix = new THREE.Matrix4();
    if (makeParticleRotatingXZ(modelDirMatrix, direction)) {
      frameMatrix.premultiply(modelDirMatrix);
    }
    mesh.setRotationFromMatrix(frameMatrix);
    return;
  }

  mesh.rotation.set(angle.x, angle.y, angle.z, "YXZ");
}

function makeParticleRotatingXZ(target, direction) {
  const length = direction.length();
  if (length <= 0.000001) return false;

  const pitch = direction.z === 0 ? 0 : Math.asin(direction.z / length);
  let yaw = 0;
  if (direction.x !== 0 || direction.y !== 0) {
    const horizontal = Math.sqrt(direction.x * direction.x + direction.y * direction.y);
    yaw = Math.acos(direction.y / horizontal);
    if (direction.x >= 0) yaw = -yaw;
  }

  target.makeRotationZ(yaw);
  target.multiply(new THREE.Matrix4().makeRotationX(pitch));
  return true;
}

function parseDummyLineSpan(raw) {
  if (!raw || !Array.isArray(raw.start) || !Array.isArray(raw.direction)) return null;
  const distance = Number(raw.distance);
  if (!Number.isFinite(distance) || distance <= 0) return null;

  const start = new THREE.Vector3(
    Number(raw.start[0] ?? 0),
    Number(raw.start[1] ?? 0),
    Number(raw.start[2] ?? 0),
  );
  const direction = new THREE.Vector3(
    Number(raw.direction[0] ?? 0),
    Number(raw.direction[1] ?? 0),
    Number(raw.direction[2] ?? 0),
  );
  if (direction.length() <= 0.000001) return null;
  direction.normalize();
  return { start, direction, distance };
}

async function createGeometry(sub) {
  const config = resolveGeometry(sub, 0);
  switch (config.type) {
    case "rect":
      return createRectGeometry();
    case "rectPlane":
      return createRectPlaneGeometry();
    case "rectZ":
      return createRectZGeometry();
    case "triangle":
      return createTriangleGeometry();
    case "trianglePlane":
      return createTrianglePlaneGeometry();
    case "cylinder":
      return createCylinderGeometry(
        config.topRadius,
        config.botRadius,
        config.height,
        config.segments,
        config.bottomUvV,
      );
    case "model":
      return loadModelGeometry(config.modelName);
    default:
      return null;
  }
}

async function loadModelGeometry(modelName) {
  const direct = String(modelName ?? "");
  const key = normalizeModelName(direct);
  if (!key) return null;
  if (modelCache.has(key)) return modelCache.get(key);

  const builtin = createBuiltinModelGeometry(key);
  if (builtin) {
    modelCache.set(key, builtin);
    return builtin;
  }

  const entry = modelBundle.models?.[key]
    ?? modelBundle.models?.[direct]
    ?? modelBundle.models?.[direct.toLowerCase()];
  if (!entry?.gltf) {
    modelCache.set(key, null);
    return null;
  }

  const gltfJson = typeof entry.gltf === "string"
    ? entry.gltf
    : JSON.stringify(entry.gltf);
  const geometry = await parseModelGeometry(gltfJson);
  modelCache.set(key, geometry);
  return geometry;
}

function createBuiltinModelGeometry(key) {
  switch (key) {
    case "rect":
      return createRectGeometry();
    case "rectplane":
      return createRectPlaneGeometry();
    case "rectz":
      return createRectZGeometry();
    case "triangle":
      return createTriangleGeometry();
    case "triangleplane":
      return createTrianglePlaneGeometry();
    case "cylinder":
      return createCylinderGeometry(0.5, 0.5, 1, 16, 1);
    case "cone":
      return createCylinderGeometry(0, 0.5, 1, 16, 1.5);
    default:
      return null;
  }
}

function loadNestedEffect(effectName) {
  const direct = String(effectName ?? "");
  const key = normalizeEffectName(direct);
  if (!key) return null;

  const entry = modelBundle.effects?.[key]
    ?? modelBundle.effects?.[direct]
    ?? modelBundle.effects?.[direct.toLowerCase()];
  const effect = entry?.effect ?? entry?.effectFile ?? entry;
  if (!effect || typeof effect !== "object") return null;
  return effect;
}

function isEffectModelName(modelName) {
  return String(modelName ?? "").trim().toLowerCase().endsWith(".eff");
}

function parseModelGeometry(gltfJson) {
  return new Promise((resolve, reject) => {
    gltfLoader.parse(
      gltfJson,
      "",
      (gltf) => {
        let geometry = null;
        gltf.scene.traverse((child) => {
          if (!geometry && child.isMesh) {
            geometry = child.geometry;
          }
        });
        resolve(geometry);
      },
      (error) => reject(error),
    );
  });
}

function localPlaybackTime(sub, rawTime) {
  const duration = getFrameDurations(sub).reduce((total, value) => total + value, 0);
  return duration > 0 ? rawTime % duration : rawTime;
}

function getTexture(name) {
  const key = normalizeTextureName(name);
  if (!key) return null;
  if (textureCache.has(key)) return textureCache.get(key);
  const entry = textureBundle.textures?.[key] ?? textureBundle.textures?.[name];
  if (!entry) return null;
  const bytes = emulateD3dA8R8G8B8(base64ToUint8(entry.rgba));
  const texture = new THREE.DataTexture(
    bytes,
    entry.width,
    entry.height,
    THREE.RGBAFormat,
  );
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = false;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  textureCache.set(key, texture);
  return texture;
}

function emulateD3dA8R8G8B8(rgba) {
  return new Uint8Array(rgba);
}

function normalizeTextureName(name) {
  return String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/\\.(tga|dds|png|bmp)$/i, "");
}

function normalizeModelName(name) {
  return String(name ?? "")
    .trim()
    .replace(/\\\\/g, "/")
    .split("/")
    .pop()
    .toLowerCase()
    .replace(/\\.lgo$/i, "");
}

function normalizeEffectName(name) {
  return String(name ?? "")
    .trim()
    .replace(/\\\\/g, "/")
    .split("/")
    .pop()
    .toLowerCase()
    .replace(/\\.eff$/i, "");
}

function normalizeParticleEffectName(name) {
  return String(name ?? "")
    .trim()
    .replace(/\\\\/g, "/")
    .split("/")
    .pop()
    .toLowerCase()
    .replace(/\\.par$/i, "");
}

function base64ToUint8(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function uint8ToBase64(value) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < value.length; i += chunkSize) {
    binary += String.fromCharCode(...value.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}
</script>
</body>`;
}

function writeBmp24(width, height, rgbaBottomUp) {
  const rowStride = Math.floor((24 * width + 31) / 32) * 4;
  const pixelOffset = 54;
  const fileSize = pixelOffset + rowStride * height;
  const buffer = Buffer.alloc(fileSize);

  buffer.write("BM", 0, "ascii");
  buffer.writeUInt32LE(fileSize, 2);
  buffer.writeUInt32LE(pixelOffset, 10);
  buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(width, 18);
  buffer.writeInt32LE(height, 22);
  buffer.writeUInt16LE(1, 26);
  buffer.writeUInt16LE(24, 28);
  buffer.writeUInt32LE(0, 30);
  buffer.writeUInt32LE(rowStride * height, 34);
  buffer.writeInt32LE(2835, 38);
  buffer.writeInt32LE(2835, 42);

  for (let y = 0; y < height; y += 1) {
    const sourceRow = y * width * 4;
    const targetRow = pixelOffset + y * rowStride;
    for (let x = 0; x < width; x += 1) {
      const sourceOffset = sourceRow + x * 4;
      const targetOffset = targetRow + x * 3;
      buffer[targetOffset] = rgbaBottomUp[sourceOffset + 2];
      buffer[targetOffset + 1] = rgbaBottomUp[sourceOffset + 1];
      buffer[targetOffset + 2] = rgbaBottomUp[sourceOffset];
    }
  }

  return buffer;
}

function parsePositiveInt(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    console.error(`Invalid ${flag}: ${value}`);
    process.exit(2);
  }
  return parsed;
}

function findBrowser() {
  if (process.env.EDGE_BIN) return process.env.EDGE_BIN;

  const candidates = [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    join(process.env.LOCALAPPDATA ?? "", "Microsoft/Edge/Application/msedge.exe"),
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  ];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    return candidate;
  }

  return null;
}

async function waitForUrl(url, processHandle) {
  const started = Date.now();
  while (Date.now() - started < 15000) {
    if (processHandle.exitCode !== null) {
      throw new Error(`Vite exited early with code ${processHandle.exitCode}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Wait and retry.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function getFreePort() {
  return new Promise((resolvePromise, reject) => {
    const server = createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") {
          resolvePromise(address.port);
        } else {
          reject(new Error("Unable to allocate a local port"));
        }
      });
    });
  });
}

function decodeHtmlEntities(value) {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#34;", '"')
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}
