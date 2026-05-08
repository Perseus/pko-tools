#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));

if (args.help || !args.sourceRoot) {
  printUsage();
  process.exit(args.help ? 0 : 1);
}

const sourceRoot = resolve(args.sourceRoot);
const effectCorpusRoot = args.effectCorpusRoot
  ? resolve(args.effectCorpusRoot)
  : joinPath(sourceRoot, "Client/client/effect");
const checks = [];

checks.push(checkPath(
  "effect-corpus",
  effectCorpusRoot,
  "Original client effect corpus exists.",
  "Original client effect corpus is missing.",
));

const mpRenderCpp = joinPath(sourceRoot, "Engine/sdk/src/MPRender.cpp");
checks.push(checkFileContains(
  "backbuffer-capture-hook",
  mpRenderCpp,
  /MPRender::CaptureScreen\s*\(\s*char\s*\*\s*\w+\s*\)/,
  "Found MPRender::CaptureScreen(char*) backbuffer capture hook.",
  "MPRender::CaptureScreen(char*) was not found.",
));
checks.push(checkFileContains(
  "surface-to-bmp-path",
  mpRenderCpp,
  /SurfaceToBMP\s*\(/,
  "MPRender capture path writes through SurfaceToBMP.",
  "MPRender capture path does not reference SurfaceToBMP.",
));

const mainCpp = joinPath(sourceRoot, "Client/src/Main.cpp");
checks.push(checkFileContains(
  "capture-command-entrypoint",
  mainCpp,
  /RunEffectCaptureCommand[\s\S]*effect_capture_id\s*=/,
  "Found deterministic effect_capture_id command entrypoint.",
  "Deterministic effect_capture_id command entrypoint was not found.",
));
checks.push(checkFileContains(
  "capture-particle-command-entrypoint",
  mainCpp,
  /RunEffectCaptureCommand[\s\S]*effect_capture_par[\s\S]*CMPPartCtrl/,
  "Found deterministic effect_capture_par direct particle command entrypoint.",
  "Deterministic effect_capture_par direct particle command entrypoint was not found.",
));
checks.push(checkFileContains(
  "capture-particle-par-path",
  mainCpp,
  /RunEffectCaptureCommand[\s\S]*effect_capture_par_path[\s\S]*LoadFromFile/,
  "Found direct particle path fallback for synthetic .par evidence.",
  "Direct particle capture does not support effect_capture_par_path LoadFromFile fallback.",
));
checks.push(checkFileContains(
  "capture-particle-dummy-span",
  mainCpp,
  /RunEffectCaptureCommand[\s\S]*effect_capture_dummy1[\s\S]*effect_capture_dummy2[\s\S]*SetCaptureDummySpan/,
  "Found capture-only dummy span wiring for DUMMY particle evidence.",
  "Direct particle capture does not wire effect_capture_dummy1/effect_capture_dummy2 into SetCaptureDummySpan.",
));
checks.push(checkFileContains(
  "capture-fixed-frame-step",
  mainCpp,
  /SetCurFrameTick\s*\(\s*tick\s*\)[\s\S]*FrameMove\s*\(\s*tick\s*\)/,
  "Effect capture command advances deterministic frame ticks before capture.",
  "Effect capture command does not appear to advance deterministic frame ticks before capture.",
));
checks.push(checkFileContains(
  "capture-output-bmp",
  mainCpp,
  /g_Render\.CaptureScreen\s*\(\s*\(char\*\)\s*outputPath\.c_str\s*\(\s*\)\s*\)/,
  "Effect capture command writes the requested BMP output through MPRender::CaptureScreen.",
  "Effect capture command does not write the requested BMP output through MPRender::CaptureScreen.",
));

const gameAppInitCpp = joinPath(sourceRoot, "Client/src/GameAppInit.cpp");
checks.push(checkFileContains(
  "capture-minimal-scene-init",
  gameAppInitCpp,
  /IsEffectCaptureCommand\s*\(\s*\)[\s\S]*new\s+CGameScene[\s\S]*_CreateEffectArray[\s\S]*_CreateShadeArray/,
  "Effect capture mode initializes a minimal renderable effect scene.",
  "Effect capture mode does not initialize a minimal renderable effect scene.",
));

const modelEffCpp = joinPath(sourceRoot, "Engine/sdk/src/MPModelEff.cpp");
checks.push(checkNoFilePattern(
  "debug-render-overlay",
  modelEffCpp,
  [
    /effect_viz_map/i,
    /RenderLine\s*\(\s*wx\s*,\s*wy\s*,\s*wz/i,
    /vertical pole/i,
  ],
  "No CMPModelEff::Render debug overlay patterns matched.",
  "CMPModelEff::Render appears to draw debug overlay geometry.",
));
checks.push(checkNoFilePattern(
  "debug-hardcoded-dump",
  modelEffCpp,
  [
    /E:\\\\gamedev\\\\effect_dumps/i,
    /effect_dumps/i,
  ],
  "No CMPModelEff::Render hardcoded debug dump patterns matched.",
  "CMPModelEff::Render appears to emit hardcoded debug dumps.",
));

const failures = checks.filter((check) => !check.pass).map((check) => check.id);
const report = {
  schema: "pko-effect-source-capture-preflight/v1",
  sourceRoot,
  pass: failures.length === 0,
  failures,
  checks,
};

console.log(JSON.stringify(report, null, 2));
process.exit(report.pass ? 0 : 1);

function parseArgs(argv) {
  const parsed = {
    sourceRoot: "",
    effectCorpusRoot: "",
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") {
      continue;
    }
    switch (arg) {
      case "--source-root":
        parsed.sourceRoot = requireValue(argv, ++i, arg);
        break;
      case "--effect-corpus-root":
        parsed.effectCorpusRoot = requireValue(argv, ++i, arg);
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

function printUsage() {
  console.log(`Usage:
  node scripts/effect-source-capture-preflight.mjs --source-root E:\\gamedev\\mp-client-source
  node scripts/effect-source-capture-preflight.mjs --source-root E:\\gamedev\\mp-client-source-effect-capture --effect-corpus-root E:\\gamedev\\mp-client-source\\Client\\client\\effect
`);
}

function joinPath(root, path) {
  return resolve(root, path);
}

function checkPath(id, path, successMessage, failureMessage) {
  const pass = existsSync(path);
  return {
    id,
    path,
    pass,
    message: pass ? successMessage : failureMessage,
  };
}

function checkFileContains(id, path, pattern, successMessage, failureMessage) {
  if (!existsSync(path)) {
    return {
      id,
      path,
      pass: false,
      message: `Required file is missing: ${path}`,
    };
  }
  const content = readFileSync(path, "utf8");
  return {
    id,
    path,
    pass: pattern.test(content),
    message: pattern.test(content) ? successMessage : failureMessage,
  };
}

function checkNoFilePattern(id, path, patterns, successMessage, failureMessage) {
  if (!existsSync(path)) {
    return {
      id,
      path,
      pass: false,
      message: `Required file is missing: ${path}`,
    };
  }
  const content = readFileSync(path, "utf8");
  const matchedPattern = patterns.find((pattern) => pattern.test(content));
  return {
    id,
    path,
    pass: !matchedPattern,
    message: matchedPattern ? failureMessage : successMessage,
    matchedPattern: matchedPattern ? String(matchedPattern) : null,
  };
}
