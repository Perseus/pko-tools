#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const pixelManifest = args.pixelManifest ?? process.env.PKO_EFFECT_PIXEL_CORPUS_MANIFEST;

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

const requiredPaths = [
  {
    name: "PKO_EFFECT_TRACE_CORPUS_DIR",
    value: process.env.PKO_EFFECT_TRACE_CORPUS_DIR,
    description: "source effect corpus directory",
  },
  {
    name: "PKO_EFFECT_TRACE_SOURCE_DUMPER",
    value: process.env.PKO_EFFECT_TRACE_SOURCE_DUMPER,
    description: "source-side pko-effect-trace dumper",
  },
  {
    name: "PKO_EFFECT_TRACE_TOOLS_DUMPER",
    value: process.env.PKO_EFFECT_TRACE_TOOLS_DUMPER,
    description: "pko-tools pko-effect-trace dumper",
  },
  {
    name: "PKO_EFFECT_PIXEL_CORPUS_MANIFEST",
    value: pixelManifest,
    description: "rendered original-client vs pko-tools BMP manifest",
  },
];

const missing = requiredPaths.filter((entry) => !entry.value || !existsSync(entry.value));
if (missing.length > 0) {
  console.error("Full effect parity requires trace corpus and rendered pixel corpus evidence.");
  for (const entry of missing) {
    console.error(`Missing ${entry.name}: ${entry.description}`);
  }
  process.exit(2);
}

const coverageReport = validatePixelManifestCoverage(pixelManifest);
if (!coverageReport.pass) {
  console.error("Rendered pixel corpus manifest does not cover all required effect parity branches.");
  for (const failure of coverageReport.failures) {
    console.error(failure);
  }
  process.exit(2);
}

if (args.validateOnly) {
  console.log(JSON.stringify({
    schema: "pko-effect-parity-full-validation/v1",
    pass: true,
    pixelManifest,
    coverage: coverageReport.coverage,
  }, null, 2));
  process.exit(0);
}

const steps = [];

if (process.env.PKO_EFFECT_SOURCE_CAPTURE_ROOT) {
  const sourcePreflightArgs = [
    join(repoRoot, "scripts/effect-source-capture-preflight.mjs"),
    "--source-root",
    process.env.PKO_EFFECT_SOURCE_CAPTURE_ROOT,
  ];
  if (process.env.PKO_EFFECT_SOURCE_CAPTURE_CORPUS_ROOT) {
    sourcePreflightArgs.push(
      "--effect-corpus-root",
      process.env.PKO_EFFECT_SOURCE_CAPTURE_CORPUS_ROOT,
    );
  }
  steps.push({
    name: "original-client capture source preflight",
    command: process.execPath,
    args: sourcePreflightArgs,
    cwd: repoRoot,
  });
}

steps.push(
  {
    name: "local effect parity gate with source-derived trace corpus",
    command: process.execPath,
    args: [join(repoRoot, "scripts/effect-parity-local-gate.mjs")],
    cwd: repoRoot,
  },
  {
    name: "rendered effect pixel corpus",
    command: process.execPath,
    args: [
      join(repoRoot, "scripts/effect-pixel-corpus-gate.mjs"),
      "--manifest",
      pixelManifest,
    ],
    cwd: repoRoot,
  },
);

for (const step of steps) {
  console.log(`\n==> ${step.name}`);
  const result = spawnSync(step.command, step.args, {
    cwd: step.cwd,
    env: process.env,
    stdio: "inherit",
  });

  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("\nfull effect rendering parity gate passed");

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--") continue;
    if (arg === "--pixel-manifest") {
      parsed.pixelManifest = argv[++i];
    } else if (arg === "--validate-only") {
      parsed.validateOnly = true;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      printHelp();
      process.exit(2);
    }
  }
  return parsed;
}

function printHelp() {
  console.log(`Usage:
  node scripts/effect-parity-full-gate.mjs --pixel-manifest captures/effect-pixel-corpus.json

Required environment:
  PKO_EFFECT_TRACE_CORPUS_DIR
  PKO_EFFECT_TRACE_SOURCE_DUMPER
  PKO_EFFECT_TRACE_TOOLS_DUMPER
  PKO_EFFECT_PIXEL_CORPUS_MANIFEST, unless --pixel-manifest is provided

Options:
  --validate-only          Validate required paths and manifest coverage without running gates

Optional original-client capture preflight:
  PKO_EFFECT_SOURCE_CAPTURE_ROOT
  PKO_EFFECT_SOURCE_CAPTURE_CORPUS_ROOT`);
}

function validatePixelManifestCoverage(manifestPath) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const manifestDir = dirname(manifestPath);
  const coverage = aggregateCaseCoverage(manifest);
  const failures = [];

  for (const feature of REQUIRED_PIXEL_COVERAGE.effectFeatures) {
    if (!coverage.effectFeatures.has(feature)) {
      failures.push(`Missing case coverage.effectFeatures: ${feature}`);
    }
  }

  for (const type of REQUIRED_PIXEL_COVERAGE.particleTypes) {
    if (!coverage.particleTypes.has(type)) {
      failures.push(`Missing case coverage.particleTypes: ${type}`);
    }
  }

  for (const feature of REQUIRED_PIXEL_COVERAGE.particleFeatures) {
    if (!coverage.particleFeatures.has(feature)) {
      failures.push(`Missing case coverage.particleFeatures: ${feature}`);
    }
  }

  for (const renderIdx of REQUIRED_PIXEL_COVERAGE.magicSingleRenderIdx) {
    if (!coverage.magicSingleRenderIdx.has(renderIdx)) {
      failures.push(`Missing case coverage.magicSingleRenderIdx: ${renderIdx}`);
    }
  }

  for (const renderIdx of REQUIRED_PIXEL_COVERAGE.magicGroupRenderIdx) {
    if (!coverage.magicGroupRenderIdx.has(renderIdx)) {
      failures.push(`Missing case coverage.magicGroupRenderIdx: ${renderIdx}`);
    }
  }

  for (const [index, testCase] of (manifest.cases ?? []).entries()) {
    failures.push(
      ...validateKnownCaseCoverage(testCase.coverage, index, testCase.name),
    );

    if (hasCaseCoverage(testCase.coverage)) {
      const sourceCaptureFailure = validateSourceCapture(testCase.sourceCapture);
      if (sourceCaptureFailure) {
        failures.push(
          `Case ${index} (${testCase.name ?? "unnamed"}) declares rendered coverage but has invalid sourceCapture: ${sourceCaptureFailure}`,
        );
      }
      if (typeof testCase.source !== "string" || testCase.source.length === 0) {
        failures.push(
          `Case ${index} (${testCase.name ?? "unnamed"}) declares rendered coverage but is missing source BMP path`,
        );
      } else if (!existsSync(resolveManifestPath(manifestDir, testCase.source))) {
        failures.push(
          `Case ${index} (${testCase.name ?? "unnamed"}) declares rendered coverage but original-client source BMP is missing: ${testCase.source}`,
        );
      }
      if (!testCase.candidateCapture) {
        if (typeof testCase.candidate !== "string" || testCase.candidate.length === 0) {
          failures.push(
            `Case ${index} (${testCase.name ?? "unnamed"}) declares rendered coverage but is missing candidate BMP path`,
          );
        } else if (!existsSync(resolveManifestPath(manifestDir, testCase.candidate))) {
          failures.push(
            `Case ${index} (${testCase.name ?? "unnamed"}) declares rendered coverage but candidate BMP is missing and no candidateCapture can regenerate it: ${testCase.candidate}`,
          );
        }
      }
    }

    const effectFeatures = testCase.coverage?.effectFeatures;
    if (Array.isArray(effectFeatures) && effectFeatures.length > 0) {
      const nonMagicEffectFeatures = effectFeatures.filter((feature) =>
        !MAGIC_SCENARIO_EFFECT_FEATURES.has(feature)
      );
      if (nonMagicEffectFeatures.length > 0 && !testCase.candidateCapture?.effectJson) {
        failures.push(
          `Case ${index} (${testCase.name ?? "unnamed"}) covers effectFeatures but is missing candidateCapture.effectJson`,
        );
      }
      if (
        effectFeatures.some((feature) => MAGIC_SCENARIO_EFFECT_FEATURES.has(feature))
        && !testCase.candidateCapture?.magicScenario
      ) {
        failures.push(
          `Case ${index} (${testCase.name ?? "unnamed"}) covers magicTargetOrientation but is missing candidateCapture.magicScenario`,
        );
      }
      const textureFeature = effectFeatures.find((feature) =>
        TEXTURE_DEPENDENT_EFFECT_FEATURES.has(feature)
      );
      if (textureFeature && !testCase.candidateCapture?.textureBundle) {
        failures.push(
          `Case ${index} (${testCase.name ?? "unnamed"}) covers texture-dependent effect feature ${textureFeature} but is missing candidateCapture.textureBundle`,
        );
      }
    }
    if (Array.isArray(effectFeatures) && effectFeatures.includes("externalLgo")) {
      if (!testCase.candidateCapture?.modelBundle) {
        failures.push(
          `Case ${index} (${testCase.name ?? "unnamed"}) covers externalLgo but is missing candidateCapture.modelBundle`,
        );
      }
    }

    const particleTypes = testCase.coverage?.particleTypes;
    if (Array.isArray(particleTypes) && particleTypes.length > 0) {
      if (!testCase.candidateCapture?.parJson) {
        failures.push(
          `Case ${index} (${testCase.name ?? "unnamed"}) covers particleTypes but is missing candidateCapture.parJson`,
        );
      }
      const modelBackedType = particleTypes.find((type) =>
        MODEL_BACKED_PARTICLE_TYPES.has(Number(type))
      );
      if (modelBackedType !== undefined && !testCase.candidateCapture?.modelBundle) {
        failures.push(
          `Case ${index} (${testCase.name ?? "unnamed"}) covers model-backed particle type ${modelBackedType} but is missing candidateCapture.modelBundle`,
        );
      }
    }

    const particleFeatures = testCase.coverage?.particleFeatures;
    if (Array.isArray(particleFeatures) && particleFeatures.length > 0) {
      if (!testCase.candidateCapture?.parJson) {
        failures.push(
          `Case ${index} (${testCase.name ?? "unnamed"}) covers particleFeatures but is missing candidateCapture.parJson`,
        );
      }
      if (particleFeatures.includes("characterModel") && !testCase.candidateCapture?.modelBundle) {
        failures.push(
          `Case ${index} (${testCase.name ?? "unnamed"}) covers characterModel particleFeatures but is missing candidateCapture.modelBundle`,
        );
      }
    }

    const magicSingle = testCase.coverage?.magicSingleRenderIdx;
    const magicGroup = testCase.coverage?.magicGroupRenderIdx;
    if (
      (Array.isArray(magicSingle) && magicSingle.length > 0)
      || (Array.isArray(magicGroup) && magicGroup.length > 0)
    ) {
      if (!testCase.candidateCapture?.magicScenario) {
        failures.push(
          `Case ${index} (${testCase.name ?? "unnamed"}) covers magic render paths but is missing candidateCapture.magicScenario`,
        );
      }
    }

    if (hasCaseCoverage(testCase.coverage) && testCase.candidateCapture) {
      if (testCase.candidateCapture.failOnSkipped === false) {
        failures.push(
          `Case ${index} (${testCase.name ?? "unnamed"}) declares rendered coverage but candidateCapture.failOnSkipped is false`,
        );
      }
      if (
        candidateCapturePrimaryFields(testCase.candidateCapture).length === 1
        && typeof testCase.candidateCapture.parJson === "string"
        && testCase.candidateCapture.parJson.length > 0
        && !hasSourceParticleCaptureMetadata(testCase.sourceCapture)
      ) {
        failures.push(
          `Case ${index} (${testCase.name ?? "unnamed"}) candidateCapture.parJson requires sourceCapture.parName so the original-client particle BMP is tied to the same .par file`,
        );
      }
      failures.push(
        ...validateCandidateCaptureEvidence(manifestDir, testCase.candidateCapture, index, testCase.name),
      );
    }
  }

  return {
    pass: failures.length === 0,
    failures,
      coverage: {
        effectFeatures: Array.from(coverage.effectFeatures).sort(),
        particleTypes: Array.from(coverage.particleTypes).sort((a, b) => a - b),
        particleFeatures: Array.from(coverage.particleFeatures).sort(),
        magicSingleRenderIdx: Array.from(coverage.magicSingleRenderIdx).sort((a, b) => a - b),
        magicGroupRenderIdx: Array.from(coverage.magicGroupRenderIdx).sort((a, b) => a - b),
      },
  };
}

function validateKnownCaseCoverage(coverage, index, caseName) {
  if (!coverage || typeof coverage !== "object") return [];
  const failures = [];
  for (const feature of coverage.effectFeatures ?? []) {
    if (!ALLOWED_PIXEL_COVERAGE.effectFeatures.has(feature)) {
      failures.push(
        `Case ${index} (${caseName ?? "unnamed"}) Unknown coverage.effectFeatures: ${String(feature)}`,
      );
    }
  }
  for (const type of coverage.particleTypes ?? []) {
    if (!Number.isInteger(type) || !ALLOWED_PIXEL_COVERAGE.particleTypes.has(type)) {
      failures.push(
        `Case ${index} (${caseName ?? "unnamed"}) Unknown coverage.particleTypes: ${String(type)}`,
      );
    }
  }
  for (const feature of coverage.particleFeatures ?? []) {
    if (!ALLOWED_PIXEL_COVERAGE.particleFeatures.has(feature)) {
      failures.push(
        `Case ${index} (${caseName ?? "unnamed"}) Unknown coverage.particleFeatures: ${String(feature)}`,
      );
    }
  }
  for (const renderIdx of coverage.magicSingleRenderIdx ?? []) {
    if (
      !Number.isInteger(renderIdx)
      || !ALLOWED_PIXEL_COVERAGE.magicSingleRenderIdx.has(renderIdx)
    ) {
      failures.push(
        `Case ${index} (${caseName ?? "unnamed"}) Unknown coverage.magicSingleRenderIdx: ${String(renderIdx)}`,
      );
    }
  }
  for (const renderIdx of coverage.magicGroupRenderIdx ?? []) {
    if (
      !Number.isInteger(renderIdx)
      || !ALLOWED_PIXEL_COVERAGE.magicGroupRenderIdx.has(renderIdx)
    ) {
      failures.push(
        `Case ${index} (${caseName ?? "unnamed"}) Unknown coverage.magicGroupRenderIdx: ${String(renderIdx)}`,
      );
    }
  }
  return failures;
}

function validateCandidateCaptureEvidence(manifestDir, candidateCapture, index, caseName) {
  const failures = [];
  if (candidateCapturePrimaryFields(candidateCapture).length > 1) {
    failures.push(
      `Case ${index} (${caseName ?? "unnamed"}) candidateCapture must include exactly one of effectJson, parJson, or magicScenario`,
    );
  }
  for (const field of [
    "effectJson",
    "parJson",
    "magicScenario",
    "textureBundle",
    "modelBundle",
  ]) {
    const value = candidateCapture[field];
    if (value === undefined) continue;
    if (typeof value !== "string" || value.length === 0) {
      failures.push(
        `Case ${index} (${caseName ?? "unnamed"}) candidateCapture.${field} must be a non-empty path`,
      );
      continue;
    }
    if (!existsSync(resolveManifestPath(manifestDir, value))) {
      failures.push(
        `Case ${index} (${caseName ?? "unnamed"}) is missing candidateCapture.${field} input file: ${value}`,
      );
    }
  }
  return failures;
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

function hasSourceParticleCaptureMetadata(sourceCapture) {
  return Boolean(
    sourceCapture
    && typeof sourceCapture === "object"
    && typeof sourceCapture.parName === "string"
    && sourceCapture.parName.length > 0
  );
}

function resolveManifestPath(manifestDir, value) {
  return isAbsolute(value) ? value : join(manifestDir, value);
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

function aggregateCaseCoverage(manifest) {
  const coverage = {
    effectFeatures: new Set(),
    particleTypes: new Set(),
    particleFeatures: new Set(),
    magicSingleRenderIdx: new Set(),
    magicGroupRenderIdx: new Set(),
  };

  for (const testCase of manifest.cases ?? []) {
    addCoverage(coverage, testCase.coverage);
  }

  return coverage;
}

function addCoverage(target, coverage) {
  if (!coverage || typeof coverage !== "object") return;
  addStringArray(target.effectFeatures, coverage.effectFeatures);
  addNumberArray(target.particleTypes, coverage.particleTypes);
  addStringArray(target.particleFeatures, coverage.particleFeatures);
  addNumberArray(target.magicSingleRenderIdx, coverage.magicSingleRenderIdx);
  addNumberArray(target.magicGroupRenderIdx, coverage.magicGroupRenderIdx);
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
