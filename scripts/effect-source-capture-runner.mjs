#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const preflightScript = join(repoRoot, "scripts/effect-source-capture-preflight.mjs");
const args = parseArgs(process.argv.slice(2));

if (args.help || !args.manifest || !args.sourceRoot) {
  printUsage();
  process.exit(args.help ? 0 : 1);
}

const manifestPath = resolve(args.manifest);
const manifestDir = dirname(manifestPath);
const sourceRoot = resolve(args.sourceRoot);
const gameExe = args.gameExe
  ? resolve(args.gameExe)
  : join(sourceRoot, "Client/bin/system/Game.exe");
const gameCwd = args.cwd ? resolve(args.cwd) : dirname(gameExe);
const captureTimeoutMs = args.captureTimeoutMs;
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const preflight = runPreflight();
if (!preflight.pass) {
  console.log(JSON.stringify({
    schema: "pko-effect-source-capture-runner-report/v1",
    pass: false,
    dryRun: args.dryRun,
    allowLaunch: args.allowLaunch,
    allowBulkLaunch: args.allowBulkLaunch,
    missingOnly: args.missingOnly,
    captureTimeoutMs,
    reason: "source-preflight-failed",
    manifest: manifestPath,
    sourceRoot,
    preflight,
  }, null, 2));
  process.exit(1);
}

const cases = [];
const failures = [];

if (manifest.schema !== "pko-effect-pixel-corpus/v1" || !Array.isArray(manifest.cases)) {
  throw new Error("Expected a pko-effect-pixel-corpus/v1 manifest with cases.");
}

const selectedCases = args.caseName
  ? manifest.cases.filter((testCase) => testCase.name === args.caseName)
  : manifest.cases;

if (args.caseName && selectedCases.length === 0) {
  console.log(JSON.stringify({
    schema: "pko-effect-source-capture-runner-report/v1",
    pass: false,
    dryRun: args.dryRun,
    allowLaunch: args.allowLaunch,
    allowBulkLaunch: args.allowBulkLaunch,
    missingOnly: args.missingOnly,
    captureTimeoutMs,
    reason: "case-filter-matched-none",
    manifest: manifestPath,
    sourceRoot,
    gameExe,
    caseFilter: args.caseName,
    preflight,
    failures: [],
    cases: [],
  }, null, 2));
  process.exit(1);
}

for (const testCase of selectedCases) {
  const report = buildCaseCapture(testCase);
  if (report.pass && args.missingOnly && existsSync(report.output)) {
    report.skipped = true;
    report.reason = "source-capture-already-exists";
  }
  cases.push(report);
  if (!report.pass) failures.push(testCase.name ?? "unnamed");
}

if (failures.length === 0 && !args.dryRun && !args.allowLaunch) {
  console.log(JSON.stringify({
    schema: "pko-effect-source-capture-runner-report/v1",
    pass: false,
    dryRun: args.dryRun,
    allowLaunch: args.allowLaunch,
    allowBulkLaunch: args.allowBulkLaunch,
    missingOnly: args.missingOnly,
    captureTimeoutMs,
    reason: "launch-not-allowed",
    manifest: manifestPath,
    sourceRoot,
    gameExe,
    ...(args.caseName ? { caseFilter: args.caseName } : {}),
    preflight,
    failures: [],
    cases,
  }, null, 2));
  process.exit(1);
}

if (failures.length === 0 && !args.dryRun && args.allowLaunch && !args.caseName && !args.allowBulkLaunch) {
  console.log(JSON.stringify({
    schema: "pko-effect-source-capture-runner-report/v1",
    pass: false,
    dryRun: args.dryRun,
    allowLaunch: args.allowLaunch,
    allowBulkLaunch: args.allowBulkLaunch,
    missingOnly: args.missingOnly,
    captureTimeoutMs,
    reason: "bulk-launch-not-allowed",
    manifest: manifestPath,
    sourceRoot,
    gameExe,
    preflight,
    failures: [],
    cases,
  }, null, 2));
  process.exit(1);
}

for (const report of cases) {
  if (!report.pass || report.skipped || args.dryRun) continue;

  mkdirSync(dirname(report.output), { recursive: true });
  const result = spawnSync(report.command, report.args, {
    cwd: report.cwd,
    encoding: "utf8",
    timeout: captureTimeoutMs,
    windowsHide: true,
  });
  report.status = result.status;
  report.stdout = result.stdout;
  report.stderr = result.stderr;
  if (result.error) {
    report.error = String(result.error.message ?? result.error);
  }
  if (result.error?.code === "ETIMEDOUT") {
    report.timedOut = true;
  }
  report.pass = !result.error && result.status === 0 && existsSync(report.output);
  if (!report.pass) {
    report.reason = result.error?.code === "ETIMEDOUT"
      ? "source-capture-timeout"
      : result.error
      ? "source-capture-spawn-failed"
      : result.status === 0
        ? "source-capture-output-missing"
        : "source-capture-failed";
    failures.push(report.name);
  }
}

const pass = failures.length === 0;
console.log(JSON.stringify({
  schema: "pko-effect-source-capture-runner-report/v1",
  pass,
  dryRun: args.dryRun,
  allowLaunch: args.allowLaunch,
  allowBulkLaunch: args.allowBulkLaunch,
  missingOnly: args.missingOnly,
  captureTimeoutMs,
  manifest: manifestPath,
  sourceRoot,
  gameExe,
  ...(args.caseName ? { caseFilter: args.caseName } : {}),
  preflight,
  failures,
  cases,
}, null, 2));
process.exit(pass ? 0 : 1);

function parseArgs(argv) {
  const parsed = {
    manifest: "",
    sourceRoot: "",
    effectCorpusRoot: "",
    gameExe: "",
    cwd: "",
    caseName: "",
    dryRun: false,
    allowLaunch: false,
    allowBulkLaunch: false,
    missingOnly: false,
    captureTimeoutMs: 60000,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") continue;
    switch (arg) {
      case "--manifest":
        parsed.manifest = requireValue(argv, ++i, arg);
        break;
      case "--source-root":
        parsed.sourceRoot = requireValue(argv, ++i, arg);
        break;
      case "--effect-corpus-root":
        parsed.effectCorpusRoot = requireValue(argv, ++i, arg);
        break;
      case "--game-exe":
        parsed.gameExe = requireValue(argv, ++i, arg);
        break;
      case "--cwd":
        parsed.cwd = requireValue(argv, ++i, arg);
        break;
      case "--case":
        parsed.caseName = requireValue(argv, ++i, arg);
        break;
      case "--dry-run":
        parsed.dryRun = true;
        break;
      case "--allow-launch":
        parsed.allowLaunch = true;
        break;
      case "--allow-bulk-launch":
        parsed.allowBulkLaunch = true;
        break;
      case "--missing-only":
        parsed.missingOnly = true;
        break;
      case "--capture-timeout-ms":
        parsed.captureTimeoutMs = parsePositiveInteger(requireValue(argv, ++i, arg), arg);
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

function parsePositiveInteger(value, arg) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${arg} must be a positive integer.`);
  }
  return number;
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
  node scripts/effect-source-capture-runner.mjs --manifest captures/effect-pixel-corpus.json --source-root E:\\gamedev\\mp-client-source-effect-capture --dry-run
  node scripts/effect-source-capture-runner.mjs --manifest captures/effect-pixel-corpus.json --source-root E:\\gamedev\\mp-client-source-effect-capture --missing-only --dry-run
  node scripts/effect-source-capture-runner.mjs --manifest captures/effect-pixel-corpus.json --source-root E:\\gamedev\\mp-client-source-effect-capture --case "00000001.eff at 0.5s" --dry-run
  node scripts/effect-source-capture-runner.mjs --manifest captures/effect-pixel-corpus.json --source-root E:\\gamedev\\mp-client-source-effect-capture --case "00000001.eff at 0.5s" --missing-only --allow-launch
  node scripts/effect-source-capture-runner.mjs --manifest captures/effect-pixel-corpus.json --source-root E:\\gamedev\\mp-client-source-effect-capture --missing-only --allow-launch --allow-bulk-launch
  node scripts/effect-source-capture-runner.mjs --manifest captures/effect-pixel-corpus.json --source-root E:\\gamedev\\mp-client-source-effect-capture --case "00000001.eff at 0.5s" --allow-launch --capture-timeout-ms 60000

Case sourceCapture schema:
  {
    "source": "original-client/effect-0.5.bmp",
    "sourceCapture": {
      "effectId": 1,
      "parName": "00000001",
      "parPath": "synthetic/generated.par",
      "time": 0.5,
      "start": [0, 0, 0],
      "target": [0, 8, 1],
      "dummy1": [0, 3, 0],
      "dummy2": [0, 0, 0],
      "traceOnly": false
    }
  }
`);
}

function runPreflight() {
  const preflightArgs = [
    preflightScript,
    "--source-root",
    sourceRoot,
  ];
  if (args.effectCorpusRoot) {
    preflightArgs.push("--effect-corpus-root", resolve(args.effectCorpusRoot));
  }

  const result = spawnSync(process.execPath, preflightArgs, {
    cwd: repoRoot,
    encoding: "utf8",
  });

  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    report = {
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  return {
    ...report,
    pass: result.status === 0 && report.pass === true,
  };
}

function buildCaseCapture(testCase) {
  const name = testCase.name ?? "unnamed";
  if (!testCase.sourceCapture || typeof testCase.sourceCapture !== "object") {
    return {
      name,
      pass: false,
      reason: "missing-source-capture",
    };
  }

  const capture = testCase.sourceCapture;
  const effectId = Number(capture.effectId);
  if (!Number.isInteger(effectId) || effectId <= 0) {
    return {
      name,
      pass: false,
      reason: "invalid-source-capture-effect-id",
    };
  }
  const parName = normalizeParName(capture.parName);
  if (capture.parName !== undefined && !parName) {
    return {
      name,
      pass: false,
      reason: "invalid-source-capture-par-name",
    };
  }
  if (typeof testCase.source !== "string" || testCase.source.length === 0) {
    return {
      name,
      pass: false,
      reason: "invalid-source-path",
    };
  }

  const output = resolveFromManifest(testCase.source);
  const captureArgs = [
    `effect_capture_id=${effectId}`,
  ];
  if (parName) {
    captureArgs.push(`effect_capture_par=${formatCommandValue(parName)}`);
  }
  if (capture.parPath) {
    captureArgs.push(`effect_capture_par_path=${formatCommandValue(resolveFromManifest(capture.parPath))}`);
  }
  captureArgs.push(
    `effect_capture_time=${formatNumber(capture.time ?? 0)}`,
    `effect_capture_out=${formatCommandValue(output)}`,
  );

  if (capture.start) {
    captureArgs.push(`effect_capture_start=${formatVector(capture.start, "start")}`);
  }
  if (capture.target) {
    captureArgs.push(`effect_capture_target=${formatVector(capture.target, "target")}`);
  }
  if (capture.dummy1 || capture.dummy2) {
    captureArgs.push(
      `effect_capture_dummy1=${formatVector(capture.dummy1, "dummy1")}`,
      `effect_capture_dummy2=${formatVector(capture.dummy2, "dummy2")}`,
    );
  }
  if (capture.traceOnly) {
    captureArgs.push("effect_capture_trace_only=1");
  }

  return {
    name,
    pass: true,
    captureMode: parName ? "particle" : effectId >= 1000 && effectId < 3000 ? "magic" : "scene-effect",
    command: gameExe,
    args: captureArgs,
    cwd: gameCwd,
    output,
    sourceCapture: capture,
  };
}

function normalizeParName(value) {
  if (value === undefined) {
    return "";
  }
  if (typeof value !== "string") {
    return "";
  }
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9_-]+(?:\.par)?$/i.test(trimmed)) {
    return "";
  }
  return trimmed.replace(/\.par$/i, "");
}

function resolveFromManifest(value) {
  return isAbsolute(value) ? value : join(manifestDir, value);
}

function formatVector(value, field) {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error(`sourceCapture ${field} must be a 3-number array.`);
  }
  return value.map((entry) => formatNumber(entry)).join(",");
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Expected numeric value, got ${String(value)}.`);
  }
  return Number.isInteger(number) ? String(number) : String(number);
}

function formatCommandValue(value) {
  if (String(value).includes('"')) {
    throw new Error(`Command values cannot contain quotes: ${String(value)}`);
  }
  return /\s/.test(String(value)) ? `"${value}"` : String(value);
}
