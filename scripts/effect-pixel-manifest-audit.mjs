#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

const args = parseArgs(process.argv.slice(2));

if (args.help || !args.manifest) {
  printUsage();
  process.exit(args.help ? 0 : 1);
}

const manifestPath = resolve(args.manifest);
const manifestDir = dirname(manifestPath);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

const REQUIRED_PIXEL_COVERAGE = {
  effectFeatures: [
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
  ],
  particleTypes: Array.from({ length: 18 }, (_, index) => index + 1),
  particleFeatures: ["characterModel"],
  magicSingleRenderIdx: [0, 2, 3, 4, 5, 6],
  magicGroupRenderIdx: [0, 1],
};

const ALLOWED_PIXEL_COVERAGE = {
  effectFeatures: new Set(REQUIRED_PIXEL_COVERAGE.effectFeatures),
  particleTypes: new Set(REQUIRED_PIXEL_COVERAGE.particleTypes),
  particleFeatures: new Set(REQUIRED_PIXEL_COVERAGE.particleFeatures),
  magicSingleRenderIdx: new Set(REQUIRED_PIXEL_COVERAGE.magicSingleRenderIdx),
  magicGroupRenderIdx: new Set(REQUIRED_PIXEL_COVERAGE.magicGroupRenderIdx),
};

const TEXTURE_DEPENDENT_EFFECT_FEATURES = new Set([
  "alpha",
  "transparentBlackAlpha",
  "frameTexture",
  "uvAnimation",
]);
const MAGIC_SCENARIO_EFFECT_FEATURES = new Set([
  "magicTargetOrientation",
]);

const MODEL_BACKED_PARTICLE_TYPES = new Set([3, 5, 6, 8, 10, 11, 12, 16, 17, 18]);

if (manifest.schema !== "pko-effect-pixel-corpus/v1" || !Array.isArray(manifest.cases)) {
  throw new Error("Expected a pko-effect-pixel-corpus/v1 manifest with cases.");
}

const cases = manifest.cases.map((testCase) => auditCase(testCase));
const coverage = aggregateCoverage(manifest.cases);
const missingCoverage = diffRequiredCoverage(coverage);
const unknownCoverage = collectUnknownCoverage(manifest.cases);
const invalidMetadata = collectInvalidMetadata(manifest.cases);
const missing = {
  sourceBmp: cases.filter((entry) => entry.missingEvidence.includes("sourceBmp")).length,
  candidateBmp: cases.filter((entry) => entry.missingEvidence.includes("candidateBmp")).length,
  candidateInputs: cases.filter((entry) =>
    entry.missingEvidence.some((item) => item.startsWith("candidateCapture."))
  ).length,
};
const filesComplete = missing.sourceBmp === 0
  && missing.candidateBmp === 0
  && missing.candidateInputs === 0;
const coverageComplete = Object.values(missingCoverage).every((values) => values.length === 0);
const metadataValid = invalidMetadata.length === 0
  && Object.values(unknownCoverage).every((values) => values.length === 0);

const report = {
  schema: "pko-effect-pixel-manifest-audit/v1",
  pass: filesComplete && coverageComplete && metadataValid,
  manifest: manifestPath,
  caseCount: cases.length,
  filesComplete,
  coverageComplete,
  metadataValid,
  missing,
  coverage: serializeCoverage(coverage),
  missingCoverage,
  unknownCoverage,
  invalidMetadata,
  cases,
};

console.log(JSON.stringify(report, null, 2));
process.exit(report.pass ? 0 : 1);

function parseArgs(argv) {
  const parsed = {
    manifest: "",
    sourceRoot: "",
    effectCorpusRoot: "",
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
  node scripts/effect-pixel-manifest-audit.mjs --manifest captures/effect-pixel-corpus.json
  node scripts/effect-pixel-manifest-audit.mjs --manifest captures/effect-pixel-corpus.json --source-root E:\\gamedev\\mp-client-source-effect-capture --effect-corpus-root E:\\gamedev\\mp-client-source\\Client\\client\\effect`);
}

function auditCase(testCase) {
  const name = testCase.name ?? "unnamed";
  const source = typeof testCase.source === "string" ? testCase.source : "";
  const candidate = typeof testCase.candidate === "string" ? testCase.candidate : "";
  const sourcePath = source ? resolveFromManifest(source) : "";
  const candidatePath = candidate ? resolveFromManifest(candidate) : "";
  const sourceBmpExists = sourcePath ? existsSync(sourcePath) : false;
  const candidateBmpExists = candidatePath ? existsSync(candidatePath) : false;
  const captureMode = classifyCaptureMode(testCase.sourceCapture);
  const candidateInputFields = candidateCaptureInputFields(testCase.candidateCapture);
  const missingEvidence = [];
  const requiredCandidateInputFields = requiredCandidateCaptureFields(testCase.coverage);

  if (!sourceBmpExists) {
    missingEvidence.push("sourceBmp");
  }

  if (requiredCandidateInputFields.length > 0 || candidateInputFields.length > 0) {
    for (const field of requiredCandidateInputFields) {
      const value = testCase.candidateCapture?.[field];
      if (typeof value !== "string" || value.length === 0 || !existsSync(resolveFromManifest(value))) {
        missingEvidence.push(`candidateCapture.${field}`);
      }
    }
    for (const field of candidateInputFields) {
      if (requiredCandidateInputFields.includes(field)) continue;
      const value = testCase.candidateCapture[field];
      if (typeof value !== "string" || value.length === 0 || !existsSync(resolveFromManifest(value))) {
        missingEvidence.push(`candidateCapture.${field}`);
      }
    }
  } else if (!candidateBmpExists) {
    missingEvidence.push("candidateBmp");
  }

  return {
    name,
    source,
    candidate,
    captureMode,
    sourceBmpExists,
    candidateBmpExists,
    candidateInputExists: candidateInputFields.length > 0
      && candidateInputFields.every((field) => {
        const value = testCase.candidateCapture[field];
        return typeof value === "string" && value.length > 0 && existsSync(resolveFromManifest(value));
      }),
    missingEvidence,
    ...(testCase.sourceCapture ? { sourceCapture: testCase.sourceCapture } : {}),
    ...(testCase.candidateCapture ? { candidateCapture: testCase.candidateCapture } : {}),
    ...(sourceDryRunCommand(name) ? { sourceDryRunCommand: sourceDryRunCommand(name) } : {}),
    ...(sourceLaunchCommand(name) ? { sourceLaunchCommand: sourceLaunchCommand(name) } : {}),
    ...(candidateCommand(testCase) ? { candidateCommand: candidateCommand(testCase) } : {}),
  };
}

function requiredCandidateCaptureFields(coverage) {
  if (!coverage || typeof coverage !== "object") return [];
  const fields = [];
  const effectFeatures = Array.isArray(coverage.effectFeatures) ? coverage.effectFeatures : [];
  if (effectFeatures.some((feature) => !MAGIC_SCENARIO_EFFECT_FEATURES.has(feature))) {
    fields.push("effectJson");
  }
  if (effectFeatures.some((feature) => MAGIC_SCENARIO_EFFECT_FEATURES.has(feature))) {
    fields.push("magicScenario");
  }
  if (effectFeatures.some((feature) => TEXTURE_DEPENDENT_EFFECT_FEATURES.has(feature))) {
    fields.push("textureBundle");
  }
  if (effectFeatures.includes("externalLgo")) {
    fields.push("modelBundle");
  }

  const particleTypes = Array.isArray(coverage.particleTypes) ? coverage.particleTypes : [];
  if (particleTypes.length > 0) {
    fields.push("parJson");
  }
  if (particleTypes.some((type) => MODEL_BACKED_PARTICLE_TYPES.has(Number(type)))) {
    fields.push("modelBundle");
  }

  const particleFeatures = Array.isArray(coverage.particleFeatures)
    ? coverage.particleFeatures
    : [];
  if (particleFeatures.length > 0) {
    fields.push("parJson");
  }
  if (particleFeatures.includes("characterModel")) {
    fields.push("modelBundle");
  }

  const magicSingle = Array.isArray(coverage.magicSingleRenderIdx)
    ? coverage.magicSingleRenderIdx
    : [];
  const magicGroup = Array.isArray(coverage.magicGroupRenderIdx)
    ? coverage.magicGroupRenderIdx
    : [];
  if (magicSingle.length > 0 || magicGroup.length > 0) {
    fields.push("magicScenario");
  }

  return Array.from(new Set(fields));
}

function aggregateCoverage(cases) {
  const coverage = {
    effectFeatures: new Set(),
    particleTypes: new Set(),
    particleFeatures: new Set(),
    magicSingleRenderIdx: new Set(),
    magicGroupRenderIdx: new Set(),
  };

  for (const testCase of cases) {
    addStringArray(coverage.effectFeatures, testCase.coverage?.effectFeatures);
    addNumberArray(coverage.particleTypes, testCase.coverage?.particleTypes);
    addStringArray(coverage.particleFeatures, testCase.coverage?.particleFeatures);
    addNumberArray(coverage.magicSingleRenderIdx, testCase.coverage?.magicSingleRenderIdx);
    addNumberArray(coverage.magicGroupRenderIdx, testCase.coverage?.magicGroupRenderIdx);
  }

  return coverage;
}

function diffRequiredCoverage(coverage) {
  return {
    effectFeatures: REQUIRED_PIXEL_COVERAGE.effectFeatures.filter((value) =>
      !coverage.effectFeatures.has(value)
    ),
    particleTypes: REQUIRED_PIXEL_COVERAGE.particleTypes.filter((value) =>
      !coverage.particleTypes.has(value)
    ),
    particleFeatures: REQUIRED_PIXEL_COVERAGE.particleFeatures.filter((value) =>
      !coverage.particleFeatures.has(value)
    ),
    magicSingleRenderIdx: REQUIRED_PIXEL_COVERAGE.magicSingleRenderIdx.filter((value) =>
      !coverage.magicSingleRenderIdx.has(value)
    ),
    magicGroupRenderIdx: REQUIRED_PIXEL_COVERAGE.magicGroupRenderIdx.filter((value) =>
      !coverage.magicGroupRenderIdx.has(value)
    ),
  };
}

function serializeCoverage(coverage) {
  return {
    effectFeatures: Array.from(coverage.effectFeatures).sort(),
    particleTypes: Array.from(coverage.particleTypes).sort((a, b) => a - b),
    particleFeatures: Array.from(coverage.particleFeatures).sort(),
    magicSingleRenderIdx: Array.from(coverage.magicSingleRenderIdx).sort((a, b) => a - b),
    magicGroupRenderIdx: Array.from(coverage.magicGroupRenderIdx).sort((a, b) => a - b),
  };
}

function collectUnknownCoverage(cases) {
  const unknown = {
    effectFeatures: new Set(),
    particleTypes: new Set(),
    particleFeatures: new Set(),
    magicSingleRenderIdx: new Set(),
    magicGroupRenderIdx: new Set(),
  };

  for (const testCase of cases) {
    for (const value of testCase.coverage?.effectFeatures ?? []) {
      if (!ALLOWED_PIXEL_COVERAGE.effectFeatures.has(value)) {
        unknown.effectFeatures.add(value);
      }
    }
    for (const value of testCase.coverage?.particleTypes ?? []) {
      if (!Number.isInteger(value) || !ALLOWED_PIXEL_COVERAGE.particleTypes.has(value)) {
        unknown.particleTypes.add(value);
      }
    }
    for (const value of testCase.coverage?.particleFeatures ?? []) {
      if (!ALLOWED_PIXEL_COVERAGE.particleFeatures.has(value)) {
        unknown.particleFeatures.add(value);
      }
    }
    for (const value of testCase.coverage?.magicSingleRenderIdx ?? []) {
      if (!Number.isInteger(value) || !ALLOWED_PIXEL_COVERAGE.magicSingleRenderIdx.has(value)) {
        unknown.magicSingleRenderIdx.add(value);
      }
    }
    for (const value of testCase.coverage?.magicGroupRenderIdx ?? []) {
      if (!Number.isInteger(value) || !ALLOWED_PIXEL_COVERAGE.magicGroupRenderIdx.has(value)) {
        unknown.magicGroupRenderIdx.add(value);
      }
    }
  }

  return {
    effectFeatures: Array.from(unknown.effectFeatures).sort(),
    particleTypes: Array.from(unknown.particleTypes).sort((a, b) => Number(a) - Number(b)),
    particleFeatures: Array.from(unknown.particleFeatures).sort(),
    magicSingleRenderIdx: Array.from(unknown.magicSingleRenderIdx).sort((a, b) => Number(a) - Number(b)),
    magicGroupRenderIdx: Array.from(unknown.magicGroupRenderIdx).sort((a, b) => Number(a) - Number(b)),
  };
}

function collectInvalidMetadata(cases) {
  const failures = [];
  for (const [index, testCase] of cases.entries()) {
    const name = testCase.name ?? "unnamed";
    const sourceCaptureFailure = validateSourceCapture(testCase.sourceCapture);
    if (sourceCaptureFailure) {
      failures.push(`Case ${index} (${name}) ${sourceCaptureFailure}`);
    }
    for (const candidateCaptureFailure of validateCandidateCapture(
      testCase.candidateCapture,
      testCase.coverage,
      testCase.sourceCapture,
    )) {
      failures.push(`Case ${index} (${name}) ${candidateCaptureFailure}`);
    }
  }
  return failures;
}

function validateSourceCapture(value) {
  if (!value || typeof value !== "object") {
    return "sourceCapture must be an object";
  }
  const effectId = Number(value.effectId);
  if (!Number.isInteger(effectId) || effectId <= 0) {
    return "sourceCapture.effectId must be a positive integer";
  }
  if (value.time !== undefined && !Number.isFinite(Number(value.time))) {
    return "sourceCapture.time must be numeric";
  }
  for (const field of ["start", "target", "dummy1", "dummy2"]) {
    if (
      value[field] !== undefined
      && (
        !Array.isArray(value[field])
        || value[field].length !== 3
        || value[field].some((entry) => !Number.isFinite(Number(entry)))
      )
    ) {
      return `sourceCapture.${field} must be a 3-number array`;
    }
  }
  return "";
}

function validateCandidateCapture(value, coverage, sourceCapture) {
  if (value === undefined) return [];
  if (!value || typeof value !== "object") {
    return ["candidateCapture must be an object"];
  }

  const failures = [];
  if (hasCoverage(coverage) && value.failOnSkipped === false) {
    failures.push("candidateCapture.failOnSkipped cannot be false for rendered coverage");
  }
  if (candidateCapturePrimaryFields(value).length > 1) {
    failures.push("candidateCapture must include exactly one of effectJson, parJson, or magicScenario");
  }
  if (
    candidateCapturePrimaryFields(value).length === 1
    &&
    typeof value.parJson === "string"
    && value.parJson.length > 0
    && !hasSourceParticleCaptureMetadata(sourceCapture)
  ) {
    failures.push(
      "candidateCapture.parJson requires sourceCapture.parName so the original-client particle BMP is tied to the same .par file",
    );
  }
  for (const field of [
    "effectJson",
    "parJson",
    "magicScenario",
    "textureBundle",
    "modelBundle",
  ]) {
    if (value[field] !== undefined && (typeof value[field] !== "string" || value[field].length === 0)) {
      failures.push(`candidateCapture.${field} must be a string`);
    }
  }
  for (const field of ["time", "width", "height"]) {
    if (value[field] !== undefined && !Number.isFinite(Number(value[field]))) {
      failures.push(`candidateCapture.${field} must be numeric`);
    }
  }
  return failures;
}

function hasSourceParticleCaptureMetadata(sourceCapture) {
  return Boolean(
    sourceCapture
    && typeof sourceCapture === "object"
    && typeof sourceCapture.parName === "string"
    && sourceCapture.parName.length > 0
  );
}

function hasCoverage(coverage) {
  if (!coverage || typeof coverage !== "object") return false;
  return [
    coverage.effectFeatures,
    coverage.particleTypes,
    coverage.particleFeatures,
    coverage.magicSingleRenderIdx,
    coverage.magicGroupRenderIdx,
  ].some((values) => Array.isArray(values) && values.length > 0);
}

function addStringArray(target, values) {
  if (!Array.isArray(values)) return;
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) {
      target.add(value);
    }
  }
}

function addNumberArray(target, values) {
  if (!Array.isArray(values)) return;
  for (const value of values) {
    if (Number.isInteger(value)) {
      target.add(value);
    }
  }
}

function classifyCaptureMode(sourceCapture) {
  if (hasSourceParticleCaptureMetadata(sourceCapture)) return "particle";
  const effectId = Number(sourceCapture?.effectId);
  if (!Number.isInteger(effectId) || effectId <= 0) return "invalid";
  return effectId >= 1000 && effectId < 3000 ? "magic" : "scene-effect";
}

function candidateCaptureInputFields(candidateCapture) {
  if (!candidateCapture || typeof candidateCapture !== "object") return [];
  return [
    "effectJson",
    "parJson",
    "magicScenario",
    "textureBundle",
    "modelBundle",
  ].filter((field) => candidateCapture[field] !== undefined);
}

function candidateCapturePrimaryFields(candidateCapture) {
  if (!candidateCapture || typeof candidateCapture !== "object") return [];
  return [
    "effectJson",
    "parJson",
    "magicScenario",
  ].filter((field) =>
    typeof candidateCapture[field] === "string" && candidateCapture[field].length > 0
  );
}

function sourceDryRunCommand(caseName) {
  if (!args.sourceRoot) return "";
  const parts = [
    "pnpm capture:effect-source --",
    "--manifest",
    quote(manifestPath),
    "--source-root",
    quote(args.sourceRoot),
  ];
  if (args.effectCorpusRoot) {
    parts.push("--effect-corpus-root", quote(args.effectCorpusRoot));
  }
  parts.push("--case", quote(caseName), "--missing-only", "--dry-run");
  return parts.join(" ");
}

function sourceLaunchCommand(caseName) {
  if (!args.sourceRoot) return "";
  const parts = [
    "pnpm capture:effect-source --",
    "--manifest",
    quote(manifestPath),
    "--source-root",
    quote(args.sourceRoot),
  ];
  if (args.effectCorpusRoot) {
    parts.push("--effect-corpus-root", quote(args.effectCorpusRoot));
  }
  parts.push("--case", quote(caseName), "--missing-only", "--allow-launch");
  return parts.join(" ");
}

function candidateCommand(testCase) {
  if (!testCase.candidateCapture || typeof testCase.candidateCapture !== "object") return "";
  const capture = testCase.candidateCapture;
  const mode = typeof capture.effectJson === "string" && capture.effectJson.length > 0
    ? "--effect-json"
    : typeof capture.parJson === "string" && capture.parJson.length > 0
      ? "--par-json"
      : typeof capture.magicScenario === "string" && capture.magicScenario.length > 0
        ? "--magic-scenario"
        : "";
  if (!mode) return "";
  const input = capture.effectJson ?? capture.parJson ?? capture.magicScenario;
  const parts = [
    "pnpm capture:effect-tools --",
    mode,
    quote(resolveFromManifest(input)),
    "--out",
    quote(resolveFromManifest(testCase.candidate)),
    "--time",
    String(capture.time ?? 0),
  ];
  if (capture.width !== undefined) parts.push("--width", String(capture.width));
  if (capture.height !== undefined) parts.push("--height", String(capture.height));
  if (capture.textureBundle) {
    parts.push("--texture-bundle", quote(resolveFromManifest(capture.textureBundle)));
  }
  if (capture.modelBundle) {
    parts.push("--model-bundle", quote(resolveFromManifest(capture.modelBundle)));
  }
  if (capture.failOnSkipped !== false) {
    parts.push("--fail-on-skipped");
  }
  return parts.join(" ");
}

function resolveFromManifest(value) {
  return isAbsolute(value) ? value : join(manifestDir, value);
}

function quote(value) {
  const text = String(value);
  return /[\s()]/.test(text) ? `"${text.replaceAll('"', '\\"')}"` : text;
}
