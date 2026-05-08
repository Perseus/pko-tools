#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pixelDiffScript = join(repoRoot, "scripts/effect-pixel-diff.mjs");
const toolsCaptureScript = join(repoRoot, "scripts/effect-tools-capture.mjs");
const args = parseArgs(process.argv.slice(2));

const ALLOWED_PIXEL_COVERAGE = {
  effectFeatures: new Set([
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
    "magicTargetOrientation",
  ]),
  particleTypes: new Set(Array.from({ length: 18 }, (_, index) => index + 1)),
  particleFeatures: new Set(["characterModel"]),
  magicSingleRenderIdx: new Set([0, 2, 3, 4, 5, 6]),
  magicGroupRenderIdx: new Set([0, 1]),
};

if (args.help || !args.manifest) {
  printUsage();
  process.exit(args.help ? 0 : 1);
}

const manifestPath = resolve(args.manifest);
const manifestDir = dirname(manifestPath);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
validateManifest(manifest);

const cases = [];
const failures = [];

for (const testCase of manifest.cases) {
  if (args.candidateOnly && !testCase.candidateCapture) {
    cases.push({
      name: testCase.name,
      pass: false,
      reason: "missing-candidate-capture",
    });
    failures.push(testCase.name);
    continue;
  }

  if (testCase.candidateCapture) {
    const captureResult = runCandidateCapture({
      name: testCase.name,
      candidate: resolveFromManifest(manifestDir, testCase.candidate),
      capture: testCase.candidateCapture,
      manifestDir,
    });
    if (!captureResult.pass) {
      cases.push(captureResult.report);
      failures.push(testCase.name);
      continue;
    }
    testCase.__candidateCaptureReport = captureResult.report;
  }

  if (args.candidateOnly) {
    cases.push({
      name: testCase.name,
      pass: true,
      candidateCapture: testCase.__candidateCaptureReport,
    });
    continue;
  }

  const result = runPixelDiff({
    name: testCase.name,
    source: resolveFromManifest(manifestDir, testCase.source),
    candidate: resolveFromManifest(manifestDir, testCase.candidate),
    diff: testCase.diff ? resolveFromManifest(manifestDir, testCase.diff) : "",
    channelTolerance: testCase.channelTolerance ?? manifest.channelTolerance ?? 0,
    maxDifferentPixels: testCase.maxDifferentPixels ?? manifest.maxDifferentPixels ?? 0,
    sourceCapture: testCase.sourceCapture,
    candidateCapture: testCase.__candidateCaptureReport,
  });
  cases.push(result.report);
  if (!result.pass) {
    failures.push(testCase.name);
  }
}

const report = {
  schema: "pko-effect-pixel-corpus-report/v1",
  manifest: manifestPath,
  candidateOnly: args.candidateOnly,
  pass: failures.length === 0,
  caseCount: cases.length,
  failures,
  cases,
};

console.log(JSON.stringify(report, null, 2));
process.exit(report.pass ? 0 : 1);

function parseArgs(argv) {
  const parsed = {
    manifest: "",
    candidateOnly: false,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "--manifest":
        parsed.manifest = requireValue(argv, ++i, arg);
        break;
      case "--candidate-only":
        parsed.candidateOnly = true;
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
  node scripts/effect-pixel-corpus-gate.mjs --manifest captures/manifest.json
  node scripts/effect-pixel-corpus-gate.mjs --manifest captures/manifest.json --candidate-only

Manifest schema:
  {
    "schema": "pko-effect-pixel-corpus/v1",
    "channelTolerance": 0,
    "maxDifferentPixels": 0,
    "cases": [
      {
        "name": "effect at 0.5s",
        "source": "original-client/effect-0.5.bmp",
        "candidate": "pko-tools/effect-0.5.bmp",
        "diff": "diffs/effect-0.5.bmp",
        "candidateCapture": {
          "effectJson": "parsed/effect.json",
          "textureBundle": "parsed/textures.json",
          "modelBundle": "parsed/models.json",
          "time": 0.5,
          "width": 512,
          "height": 512
        }
      }
    ]
  }
`);
}

function validateManifest(value) {
  if (!value || typeof value !== "object") {
    throw new Error("Manifest must be a JSON object.");
  }
  if (value.schema !== "pko-effect-pixel-corpus/v1") {
    throw new Error(`Unsupported pixel corpus schema: ${String(value.schema)}`);
  }
  if (!Array.isArray(value.cases)) {
    throw new Error("Manifest cases must be an array.");
  }
  value.cases.forEach((testCase, index) => {
    if (!testCase || typeof testCase !== "object") {
      throw new Error(`Case ${index} must be an object.`);
    }
    for (const field of ["name", "source", "candidate"]) {
      if (typeof testCase[field] !== "string" || testCase[field].length === 0) {
        throw new Error(`Case ${index} missing required string field: ${field}`);
      }
    }
    if (testCase.candidateCapture) {
      validateCandidateCapture(
        testCase.candidateCapture,
        index,
        testCase.coverage,
        testCase.sourceCapture,
      );
    }
    validateCoverage(testCase.coverage, index);
    if (hasCaseCoverage(testCase.coverage) && testCase.candidateCapture?.failOnSkipped === false) {
      throw new Error(
        `Case ${index} candidateCapture.failOnSkipped cannot be false for rendered coverage.`,
      );
    }
    if (testCase.sourceCapture) {
      validateSourceCapture(testCase.sourceCapture, index);
    }
  });
}

function validateCoverage(coverage, index) {
  if (coverage === undefined) return;
  if (!coverage || typeof coverage !== "object") {
    throw new Error(`Case ${index} coverage must be an object.`);
  }
  const failures = [];
  for (const feature of coverage.effectFeatures ?? []) {
    if (!ALLOWED_PIXEL_COVERAGE.effectFeatures.has(feature)) {
      failures.push(`Case ${index} Unknown coverage.effectFeatures: ${String(feature)}`);
    }
  }
  for (const type of coverage.particleTypes ?? []) {
    if (!Number.isInteger(type) || !ALLOWED_PIXEL_COVERAGE.particleTypes.has(type)) {
      failures.push(`Case ${index} Unknown coverage.particleTypes: ${String(type)}`);
    }
  }
  for (const feature of coverage.particleFeatures ?? []) {
    if (!ALLOWED_PIXEL_COVERAGE.particleFeatures.has(feature)) {
      failures.push(`Case ${index} Unknown coverage.particleFeatures: ${String(feature)}`);
    }
  }
  for (const renderIdx of coverage.magicSingleRenderIdx ?? []) {
    if (
      !Number.isInteger(renderIdx)
      || !ALLOWED_PIXEL_COVERAGE.magicSingleRenderIdx.has(renderIdx)
    ) {
      failures.push(`Case ${index} Unknown coverage.magicSingleRenderIdx: ${String(renderIdx)}`);
    }
  }
  for (const renderIdx of coverage.magicGroupRenderIdx ?? []) {
    if (
      !Number.isInteger(renderIdx)
      || !ALLOWED_PIXEL_COVERAGE.magicGroupRenderIdx.has(renderIdx)
    ) {
      failures.push(`Case ${index} Unknown coverage.magicGroupRenderIdx: ${String(renderIdx)}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(failures.join("\n"));
  }
}

function hasCaseCoverage(coverage) {
  if (!coverage || typeof coverage !== "object") return false;
  return [
    coverage.effectFeatures,
    coverage.particleTypes,
    coverage.particleFeatures,
    coverage.magicSingleRenderIdx,
    coverage.magicGroupRenderIdx,
  ].some((values) => Array.isArray(values) && values.length > 0);
}

function validateSourceCapture(value, index) {
  if (!value || typeof value !== "object") {
    throw new Error(`Case ${index} sourceCapture must be an object.`);
  }
  const effectId = Number(value.effectId);
  if (!Number.isInteger(effectId) || effectId <= 0) {
    throw new Error(`Case ${index} sourceCapture.effectId must be a positive integer.`);
  }
  if (value.time !== undefined && !Number.isFinite(Number(value.time))) {
    throw new Error(`Case ${index} sourceCapture.time must be numeric.`);
  }
  for (const vectorField of ["start", "target", "dummy1", "dummy2"]) {
    if (
      value[vectorField] !== undefined
      && (
        !Array.isArray(value[vectorField])
        || value[vectorField].length !== 3
        || value[vectorField].some((entry) => !Number.isFinite(Number(entry)))
      )
    ) {
      throw new Error(`Case ${index} sourceCapture.${vectorField} must be a 3-number array.`);
    }
  }
}

function validateCandidateCapture(value, index, coverage, sourceCapture) {
  if (!value || typeof value !== "object") {
    throw new Error(`Case ${index} candidateCapture must be an object.`);
  }
  const captureKind = getCandidateCaptureKind(value);
  if (!captureKind) {
    throw new Error(
      `Case ${index} candidateCapture must include one of effectJson, parJson, or magicScenario`,
    );
  }
  if (getCandidateCaptureKinds(value).length !== 1) {
    throw new Error(
      `Case ${index} candidateCapture must include exactly one of effectJson, parJson, or magicScenario`,
    );
  }
  if (
    hasCaseCoverage(coverage)
    && captureKind === "particle"
    && !hasSourceParticleCaptureMetadata(sourceCapture)
  ) {
    throw new Error(
      `Case ${index} candidateCapture.parJson requires sourceCapture.parName so the original-client particle BMP is tied to the same .par file`,
    );
  }
  for (const optionalPath of [
    "effectJson",
    "parJson",
    "magicScenario",
    "textureBundle",
    "modelBundle",
  ]) {
    if (
      value[optionalPath] !== undefined
      && (typeof value[optionalPath] !== "string" || value[optionalPath].length === 0)
    ) {
      throw new Error(`Case ${index} candidateCapture ${optionalPath} must be a string.`);
    }
  }
  for (const numericField of ["time", "width", "height"]) {
    if (value[numericField] !== undefined && !Number.isFinite(Number(value[numericField]))) {
      throw new Error(`Case ${index} candidateCapture ${numericField} must be numeric.`);
    }
  }
}

function hasSourceParticleCaptureMetadata(sourceCapture) {
  return Boolean(
    sourceCapture
    && typeof sourceCapture === "object"
    && typeof sourceCapture.parName === "string"
    && sourceCapture.parName.length > 0
  );
}

function resolveFromManifest(manifestDir, value) {
  return isAbsolute(value) ? value : join(manifestDir, value);
}

function runPixelDiff(testCase) {
  const diffArgs = [
    pixelDiffScript,
    "--source",
    testCase.source,
    "--candidate",
    testCase.candidate,
    "--channel-tolerance",
    String(testCase.channelTolerance),
    "--max-different-pixels",
    String(testCase.maxDifferentPixels),
  ];
  if (testCase.diff) {
    diffArgs.push("--out", testCase.diff);
  }

  const result = spawnSync(process.execPath, diffArgs, {
    cwd: repoRoot,
    encoding: "utf8",
  });

  if (result.error) {
    return {
      pass: false,
      report: {
        name: testCase.name,
        pass: false,
        reason: "spawn-error",
        error: result.error.message,
      },
    };
  }

  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    report = {
      pass: false,
      reason: "invalid-pixel-diff-output",
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  return {
    pass: result.status === 0 && report.pass === true,
    report: {
      name: testCase.name,
      ...report,
      ...(testCase.sourceCapture ? { sourceCapture: testCase.sourceCapture } : {}),
      ...(testCase.candidateCapture ? { candidateCapture: testCase.candidateCapture } : {}),
      pass: result.status === 0 && report.pass === true,
    },
  };
}

function runCandidateCapture(testCase) {
  const capture = testCase.capture;
  const captureKind = getCandidateCaptureKind(capture);

  const captureArgs = [
    toolsCaptureScript,
    captureKind === "effect"
      ? "--effect-json"
      : captureKind === "particle"
        ? "--par-json"
        : "--magic-scenario",
    resolveFromManifest(
      testCase.manifestDir,
      captureKind === "effect"
        ? capture.effectJson
        : captureKind === "particle"
          ? capture.parJson
          : capture.magicScenario,
    ),
    "--out",
    testCase.candidate,
    "--time",
    String(capture.time ?? 0),
    "--width",
    String(capture.width ?? 256),
    "--height",
    String(capture.height ?? 256),
  ];

  if (capture.textureBundle) {
    captureArgs.push("--texture-bundle", resolveFromManifest(testCase.manifestDir, capture.textureBundle));
  }
  if (capture.modelBundle) {
    captureArgs.push("--model-bundle", resolveFromManifest(testCase.manifestDir, capture.modelBundle));
  }
  if (capture.failOnSkipped !== false) {
    captureArgs.push("--fail-on-skipped");
  }

  const result = spawnSync(process.execPath, captureArgs, {
    cwd: repoRoot,
    encoding: "utf8",
  });

  if (result.error) {
    return {
      pass: false,
      report: {
        name: testCase.name,
        pass: false,
        reason: "candidate-capture-spawn-error",
        error: result.error.message,
      },
    };
  }

  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    report = {
      stdout: result.stdout,
    };
  }

  if (result.status !== 0) {
    return {
      pass: false,
      report: {
        name: testCase.name,
        pass: false,
        reason: "candidate-capture-failed",
        status: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
      },
    };
  }

  return {
    pass: true,
    report: {
      ...report,
      pass: true,
    },
  };
}

function getCandidateCaptureKind(capture) {
  const kinds = getCandidateCaptureKinds(capture);
  return kinds[0] ?? "";
}

function getCandidateCaptureKinds(capture) {
  const kinds = [];
  if (typeof capture?.effectJson === "string" && capture.effectJson.length > 0) {
    kinds.push("effect");
  }
  if (typeof capture?.parJson === "string" && capture.parJson.length > 0) {
    kinds.push("particle");
  }
  if (typeof capture?.magicScenario === "string" && capture.magicScenario.length > 0) {
    kinds.push("magic");
  }
  return kinds;
}
