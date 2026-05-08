import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "../../../..");
const corpusGateScript = join(repoRoot, "scripts/effect-pixel-corpus-gate.mjs");
const captureScript = join(repoRoot, "scripts/effect-tools-capture.mjs");

describe("effect pixel corpus gate", () => {
  it("passes a manifest of matching original-client and pko-tools captures", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-pixel-corpus-"));
    try {
      const sourcePath = join(dir, "original.bmp");
      const candidatePath = join(dir, "pko-tools.bmp");
      const manifestPath = join(dir, "manifest.json");
      const image = writeBmp24(1, 1, [[12, 34, 56, 255]]);
      writeFileSync(sourcePath, image);
      writeFileSync(candidatePath, image);
      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "matching smoke",
            source: "original.bmp",
            candidate: "pko-tools.bmp",
          },
        ],
      }));

      const output = execFileSync(process.execPath, [
        corpusGateScript,
        "--manifest",
        manifestPath,
      ], { encoding: "utf8" });

      const report = JSON.parse(output);
      expect(report.pass).toBe(true);
      expect(report.caseCount).toBe(1);
      expect(report.failures).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports source capture metadata for reproducible original-client BMPs", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-pixel-corpus-"));
    try {
      const sourcePath = join(dir, "original.bmp");
      const candidatePath = join(dir, "pko-tools.bmp");
      const manifestPath = join(dir, "manifest.json");
      const image = writeBmp24(1, 1, [[12, 34, 56, 255]]);
      writeFileSync(sourcePath, image);
      writeFileSync(candidatePath, image);
      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "source capture metadata",
            source: "original.bmp",
            candidate: "pko-tools.bmp",
            sourceCapture: {
              effectId: 1001,
              time: 0.5,
              start: [-1, 0, 0],
              target: [0, 0, 0],
            },
          },
        ],
      }));

      const output = execFileSync(process.execPath, [
        corpusGateScript,
        "--manifest",
        manifestPath,
      ], { encoding: "utf8" });

      const report = JSON.parse(output);
      expect(report.pass).toBe(true);
      expect(report.cases[0].sourceCapture).toEqual({
        effectId: 1001,
        time: 0.5,
        start: [-1, 0, 0],
        target: [0, 0, 0],
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects invalid source capture metadata", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-pixel-corpus-"));
    try {
      const manifestPath = join(dir, "manifest.json");
      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "invalid source capture",
            source: "original.bmp",
            candidate: "pko-tools.bmp",
            sourceCapture: {
              effectId: 0,
              time: "later",
              start: [0, 0],
            },
          },
        ],
      }));

      const result = spawnSync(process.execPath, [
        corpusGateScript,
        "--manifest",
        manifestPath,
      ], { encoding: "utf8" });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("sourceCapture.effectId");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects unknown rendered coverage labels", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-pixel-corpus-"));
    try {
      const manifestPath = join(dir, "manifest.json");
      writeFileSync(join(dir, "original.bmp"), writeBmp24(1, 1, [[0, 0, 0, 255]]));
      writeFileSync(join(dir, "pko-tools.bmp"), writeBmp24(1, 1, [[0, 0, 0, 255]]));
      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "coverage typo",
            source: "original.bmp",
            candidate: "pko-tools.bmp",
            coverage: {
              effectFeatures: ["alphaTypo"],
              particleTypes: [19],
              particleFeatures: ["characterTypo"],
              magicSingleRenderIdx: [7],
              magicGroupRenderIdx: [3],
            },
          },
        ],
      }));

      const result = spawnSync(process.execPath, [
        corpusGateScript,
        "--manifest",
        manifestPath,
      ], { encoding: "utf8" });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Unknown coverage.effectFeatures: alphaTypo");
      expect(result.stderr).toContain("Unknown coverage.particleTypes: 19");
      expect(result.stderr).toContain("Unknown coverage.particleFeatures: characterTypo");
      expect(result.stderr).toContain("Unknown coverage.magicSingleRenderIdx: 7");
      expect(result.stderr).toContain("Unknown coverage.magicGroupRenderIdx: 3");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails when any manifest case exceeds its pixel tolerance and writes requested diff images", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-pixel-corpus-"));
    try {
      mkdirSync(join(dir, "diffs"));
      writeFileSync(join(dir, "original.bmp"), writeBmp24(1, 1, [[12, 34, 56, 255]]));
      writeFileSync(join(dir, "pko-tools.bmp"), writeBmp24(1, 1, [[12, 34, 57, 255]]));
      const manifestPath = join(dir, "manifest.json");
      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "one blue channel mismatch",
            source: "original.bmp",
            candidate: "pko-tools.bmp",
            diff: "diffs/mismatch.bmp",
          },
        ],
      }));

      const result = spawnSync(process.execPath, [
        corpusGateScript,
        "--manifest",
        manifestPath,
      ], { encoding: "utf8" });

      expect(result.status).toBe(1);
      const report = JSON.parse(result.stdout);
      expect(report.pass).toBe(false);
      expect(report.failures).toEqual(["one blue channel mismatch"]);
      expect(report.cases[0].differentPixels).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("can regenerate a pko-tools candidate capture before diffing a case", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-pixel-corpus-"));
    try {
      const effectPath = join(dir, "effect.json");
      const sourcePath = join(dir, "original.bmp");
      const manifestPath = join(dir, "manifest.json");
      writeFileSync(effectPath, JSON.stringify(effectFixture()));

      execFileSync(process.execPath, [
        captureScript,
        "--effect-json",
        effectPath,
        "--out",
        sourcePath,
        "--time",
        "0",
        "--width",
        "32",
        "--height",
        "32",
      ], { cwd: repoRoot, encoding: "utf8" });

      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "generated candidate",
            source: "original.bmp",
            candidate: "pko-tools.bmp",
            candidateCapture: {
              effectJson: "effect.json",
              time: 0,
              width: 32,
              height: 32,
            },
          },
        ],
      }));

      const output = execFileSync(process.execPath, [
        corpusGateScript,
        "--manifest",
        manifestPath,
      ], { encoding: "utf8" });

      const report = JSON.parse(output);
      expect(report.pass).toBe(true);
      expect(report.cases[0].candidateCapture.renderedSubEffects).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("can validate pko-tools candidate captures without original-client BMPs", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-pixel-corpus-"));
    try {
      const effectPath = join(dir, "effect.json");
      const manifestPath = join(dir, "manifest.json");
      writeFileSync(effectPath, JSON.stringify(effectFixture()));
      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "candidate-only generated effect",
            source: "missing-original.bmp",
            candidate: "pko-tools.bmp",
            candidateCapture: {
              effectJson: "effect.json",
              time: 0,
              width: 32,
              height: 32,
            },
          },
        ],
      }));

      const output = execFileSync(process.execPath, [
        corpusGateScript,
        "--manifest",
        manifestPath,
        "--candidate-only",
      ], { encoding: "utf8" });

      const report = JSON.parse(output);
      expect(report.pass).toBe(true);
      expect(report.candidateOnly).toBe(true);
      expect(report.cases[0].candidateCapture.renderedSubEffects).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("candidate-only mode requires reproducible candidate capture metadata", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-pixel-corpus-"));
    try {
      const manifestPath = join(dir, "manifest.json");
      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "no candidate command",
            source: "missing-original.bmp",
            candidate: "pko-tools.bmp",
          },
        ],
      }));

      const result = spawnSync(process.execPath, [
        corpusGateScript,
        "--manifest",
        manifestPath,
        "--candidate-only",
      ], { encoding: "utf8" });

      expect(result.status).toBe(1);
      const report = JSON.parse(result.stdout);
      expect(report.pass).toBe(false);
      expect(report.candidateOnly).toBe(true);
      expect(report.cases[0].reason).toBe("missing-candidate-capture");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails candidate generation when a required external model is skipped", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-pixel-corpus-"));
    try {
      const effectPath = join(dir, "effect.json");
      const manifestPath = join(dir, "manifest.json");
      const effect = effectFixture();
      effect.subEffects[0].modelName = "missing.lgo";
      writeFileSync(effectPath, JSON.stringify(effect));
      writeFileSync(join(dir, "original.bmp"), writeBmp24(1, 1, [[0, 0, 0, 255]]));
      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "missing external model",
            source: "original.bmp",
            candidate: "pko-tools.bmp",
            candidateCapture: {
              effectJson: "effect.json",
              time: 0,
              width: 32,
              height: 32,
            },
          },
        ],
      }));

      const result = spawnSync(process.execPath, [
        corpusGateScript,
        "--manifest",
        manifestPath,
      ], { encoding: "utf8" });

      expect(result.status).toBe(1);
      const report = JSON.parse(result.stdout);
      expect(report.pass).toBe(false);
      expect(report.failures).toEqual(["missing external model"]);
      expect(report.cases[0].reason).toBe("candidate-capture-failed");
      expect(report.cases[0].stderr).toContain("Capture skipped required sub-effects");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails particle candidate generation when required particle system types are skipped", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-pixel-corpus-"));
    try {
      const manifestPath = join(dir, "manifest.json");
      writeFileSync(join(dir, "particles.json"), JSON.stringify(parFixture({
        type: 99,
        name: "unsupported-particle",
      })));
      writeFileSync(join(dir, "original.bmp"), writeBmp24(1, 1, [[0, 0, 0, 255]]));
      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "particle capture pending",
            source: "original.bmp",
            candidate: "pko-tools.bmp",
            candidateCapture: {
              parJson: "particles.json",
              time: 0,
              width: 32,
              height: 32,
            },
          },
        ],
      }));

      const result = spawnSync(process.execPath, [
        corpusGateScript,
        "--manifest",
        manifestPath,
      ], { encoding: "utf8" });

      expect(result.status).toBe(1);
      const report = JSON.parse(result.stdout);
      expect(report.cases[0].reason).toBe("candidate-capture-failed");
      expect(report.cases[0].stderr).toContain("Capture skipped required particle systems");
      expect(report.cases[0].stderr).toContain("unsupported-particle-system-type");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects covered candidate generation when fail-on-skipped is disabled", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-pixel-corpus-"));
    try {
      const manifestPath = join(dir, "manifest.json");
      writeFileSync(join(dir, "particles.json"), JSON.stringify(parFixture({
        type: 99,
        name: "unsupported-particle",
      })));
      writeFileSync(join(dir, "original.bmp"), writeBmp24(1, 1, [[0, 0, 0, 255]]));
      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "unsafe covered particle capture",
            source: "original.bmp",
            candidate: "pko-tools.bmp",
            sourceCapture: {
              effectId: 2,
              parName: "particles",
              time: 0,
            },
            candidateCapture: {
              parJson: "particles.json",
              time: 0,
              width: 32,
              height: 32,
              failOnSkipped: false,
            },
            coverage: { particleTypes: [5] },
          },
        ],
      }));

      const result = spawnSync(process.execPath, [
        corpusGateScript,
        "--manifest",
        manifestPath,
      ], { encoding: "utf8" });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("failOnSkipped");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects direct particle evidence without source particle capture metadata", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-pixel-corpus-"));
    try {
      const manifestPath = join(dir, "manifest.json");
      writeFileSync(join(dir, "particles.json"), JSON.stringify(parFixture()));
      writeFileSync(join(dir, "original.bmp"), writeBmp24(1, 1, [[0, 0, 0, 255]]));
      writeFileSync(join(dir, "pko-tools.bmp"), writeBmp24(1, 1, [[0, 0, 0, 255]]));
      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "unproven direct particle evidence",
            source: "original.bmp",
            candidate: "pko-tools.bmp",
            sourceCapture: {
              effectId: 2,
              time: 0.5,
            },
            candidateCapture: {
              parJson: "particles.json",
              time: 0.5,
              width: 32,
              height: 32,
            },
            coverage: { particleTypes: [1] },
          },
        ],
      }));

      const result = spawnSync(process.execPath, [
        corpusGateScript,
        "--manifest",
        manifestPath,
      ], { encoding: "utf8" });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("candidateCapture.parJson requires sourceCapture.parName");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects candidate captures with ambiguous primary inputs", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-pixel-corpus-"));
    try {
      const manifestPath = join(dir, "manifest.json");
      writeFileSync(join(dir, "effect.json"), JSON.stringify(effectFixture()));
      writeFileSync(join(dir, "particles.json"), JSON.stringify(parFixture()));
      writeFileSync(join(dir, "original.bmp"), writeBmp24(1, 1, [[0, 0, 0, 255]]));
      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "ambiguous candidate capture",
            source: "original.bmp",
            candidate: "pko-tools.bmp",
            candidateCapture: {
              effectJson: "effect.json",
              parJson: "particles.json",
              time: 0,
              width: 32,
              height: 32,
            },
          },
        ],
      }));

      const result = spawnSync(process.execPath, [
        corpusGateScript,
        "--manifest",
        manifestPath,
      ], { encoding: "utf8" });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("exactly one");
      expect(result.stderr).toContain("effectJson, parJson, or magicScenario");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("can regenerate a pko-tools Range particle candidate capture before diffing a case", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-pixel-corpus-"));
    try {
      const parPath = join(dir, "particles.json");
      const sourcePath = join(dir, "original.bmp");
      const manifestPath = join(dir, "manifest.json");
      writeFileSync(parPath, JSON.stringify(parFixture()));

      execFileSync(process.execPath, [
        captureScript,
        "--par-json",
        parPath,
        "--out",
        sourcePath,
        "--time",
        "0",
        "--width",
        "32",
        "--height",
        "32",
      ], { cwd: repoRoot, encoding: "utf8" });

      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "generated Range particle candidate",
            source: "original.bmp",
            candidate: "pko-tools.bmp",
            candidateCapture: {
              parJson: "particles.json",
              time: 0,
              width: 32,
              height: 32,
            },
          },
        ],
      }));

      const output = execFileSync(process.execPath, [
        corpusGateScript,
        "--manifest",
        manifestPath,
      ], { encoding: "utf8" });

      const report = JSON.parse(output);
      expect(report.pass).toBe(true);
      expect(report.cases[0].candidateCapture.renderedParticleSystems).toBe(1);
      expect(report.cases[0].candidateCapture.skippedParticleSystems).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("can regenerate a pko-tools MODEL particle candidate capture with a model bundle", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-pixel-corpus-"));
    try {
      const parPath = join(dir, "particles.json");
      const modelBundlePath = join(dir, "models.json");
      const sourcePath = join(dir, "original.bmp");
      const manifestPath = join(dir, "manifest.json");
      writeFileSync(parPath, JSON.stringify(parFixture({
        type: 5,
        name: "model-particle",
        particleCount: 5,
        modelName: "weapon.lgo",
        frameSizes: [1],
        offset: [0, 0, 0],
      })));
      writeFileSync(modelBundlePath, JSON.stringify(modelBundleFixture("weapon.lgo")));

      execFileSync(process.execPath, [
        captureScript,
        "--par-json",
        parPath,
        "--model-bundle",
        modelBundlePath,
        "--out",
        sourcePath,
        "--time",
        "0",
        "--width",
        "32",
        "--height",
        "32",
        "--fail-on-skipped",
      ], { cwd: repoRoot, encoding: "utf8" });

      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "generated MODEL particle candidate",
            source: "original.bmp",
            candidate: "pko-tools.bmp",
            candidateCapture: {
              parJson: "particles.json",
              modelBundle: "models.json",
              time: 0,
              width: 32,
              height: 32,
            },
          },
        ],
      }));

      const output = execFileSync(process.execPath, [
        corpusGateScript,
        "--manifest",
        manifestPath,
      ], { encoding: "utf8" });

      const report = JSON.parse(output);
      expect(report.pass).toBe(true);
      expect(report.cases[0].candidateCapture.renderedParticleSystems).toBe(1);
      expect(report.cases[0].candidateCapture.skippedParticleSystems).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("can regenerate a pko-tools CChaModel particle candidate capture with a model bundle", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-pixel-corpus-"));
    try {
      const parPath = join(dir, "particles.json");
      const modelBundlePath = join(dir, "models.json");
      const sourcePath = join(dir, "original.bmp");
      const manifestPath = join(dir, "manifest.json");
      writeFileSync(parPath, JSON.stringify(characterModelParFixture({
        id: 52,
        color: [0, 1, 0, 1],
      })));
      writeFileSync(modelBundlePath, JSON.stringify(characterModelBundleFixture(52)));

      execFileSync(process.execPath, [
        captureScript,
        "--par-json",
        parPath,
        "--model-bundle",
        modelBundlePath,
        "--out",
        sourcePath,
        "--time",
        "0",
        "--width",
        "32",
        "--height",
        "32",
        "--fail-on-skipped",
      ], { cwd: repoRoot, encoding: "utf8" });

      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "generated CChaModel particle candidate",
            source: "original.bmp",
            candidate: "pko-tools.bmp",
            sourceCapture: {
              effectId: 3,
              parName: "particles",
              time: 0,
            },
            candidateCapture: {
              parJson: "particles.json",
              modelBundle: "models.json",
              time: 0,
              width: 32,
              height: 32,
            },
            coverage: {
              particleFeatures: ["characterModel"],
            },
          },
        ],
      }));

      const output = execFileSync(process.execPath, [
        corpusGateScript,
        "--manifest",
        manifestPath,
      ], { encoding: "utf8" });

      const report = JSON.parse(output);
      expect(report.pass).toBe(true);
      expect(report.cases[0].candidateCapture.renderedCharacterModels).toBe(1);
      expect(report.cases[0].candidateCapture.skippedCharacterModels).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("can regenerate a pko-tools MODEL modelDir particle candidate capture", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-pixel-corpus-"));
    try {
      const parPath = join(dir, "particles.json");
      const modelBundlePath = join(dir, "models.json");
      const sourcePath = join(dir, "original.bmp");
      const manifestPath = join(dir, "manifest.json");
      writeFileSync(parPath, JSON.stringify(parFixture({
        type: 5,
        name: "model-dir-particle",
        particleCount: 1,
        modelName: "arrow.lgo",
        modelDir: true,
        direction: [1, 0, 0],
        frameSizes: [1],
        offset: [0, 0, 0],
      })));
      writeFileSync(modelBundlePath, JSON.stringify(modelBundleFixture("arrow.lgo", [
        0.35, -0.15, 0,
        0.35, 0.15, 0,
        1.3, 0.15, 0,
        1.3, -0.15, 0,
      ])));

      execFileSync(process.execPath, [
        captureScript,
        "--par-json",
        parPath,
        "--model-bundle",
        modelBundlePath,
        "--out",
        sourcePath,
        "--time",
        "0",
        "--width",
        "32",
        "--height",
        "32",
        "--fail-on-skipped",
      ], { cwd: repoRoot, encoding: "utf8" });

      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "generated MODEL modelDir particle candidate",
            source: "original.bmp",
            candidate: "pko-tools.bmp",
            candidateCapture: {
              parJson: "particles.json",
              modelBundle: "models.json",
              time: 0,
              width: 32,
              height: 32,
            },
          },
        ],
      }));

      const output = execFileSync(process.execPath, [
        corpusGateScript,
        "--manifest",
        manifestPath,
      ], { encoding: "utf8" });

      const report = JSON.parse(output);
      expect(report.pass).toBe(true);
      expect(report.cases[0].candidateCapture.renderedParticleSystems).toBe(1);
      expect(report.cases[0].candidateCapture.skippedParticleSystems).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("can regenerate a pko-tools MODEL animated frame candidate capture", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-pixel-corpus-"));
    try {
      const parPath = join(dir, "particles.json");
      const modelBundlePath = join(dir, "models.json");
      const sourcePath = join(dir, "original.bmp");
      const manifestPath = join(dir, "manifest.json");
      writeFileSync(parPath, JSON.stringify(parFixture({
        type: 5,
        name: "model-animated-frame",
        particleCount: 1,
        modelName: "weapon.lgo",
        frameCount: 2,
        frameSizes: [1, 1],
        frameColors: [[1, 0, 0, 1], [0, 1, 0, 1]],
        life: 1,
        offset: [0, 0, 0],
        srcBlend: 5,
        destBlend: 6,
      })));
      writeFileSync(modelBundlePath, JSON.stringify(modelBundleFixture("weapon.lgo")));

      execFileSync(process.execPath, [
        captureScript,
        "--par-json",
        parPath,
        "--model-bundle",
        modelBundlePath,
        "--out",
        sourcePath,
        "--time",
        "0.5",
        "--width",
        "32",
        "--height",
        "32",
        "--fail-on-skipped",
      ], { cwd: repoRoot, encoding: "utf8" });

      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "generated MODEL animated frame candidate",
            source: "original.bmp",
            candidate: "pko-tools.bmp",
            candidateCapture: {
              parJson: "particles.json",
              modelBundle: "models.json",
              time: 0.5,
              width: 32,
              height: 32,
            },
          },
        ],
      }));

      const output = execFileSync(process.execPath, [
        corpusGateScript,
        "--manifest",
        manifestPath,
      ], { encoding: "utf8" });

      const report = JSON.parse(output);
      expect(report.pass).toBe(true);
      expect(report.cases[0].candidateCapture.renderedParticleSystems).toBe(1);
      expect(report.cases[0].candidateCapture.skippedParticleSystems).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("can gate low-alpha MODEL particle texture captures without black square artifacts", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-pixel-corpus-"));
    try {
      const parPath = join(dir, "particles.json");
      const texturePath = join(dir, "textures.json");
      const modelBundlePath = join(dir, "models.json");
      const manifestPath = join(dir, "manifest.json");
      writeFileSync(parPath, JSON.stringify(parFixture({
        type: 5,
        name: "model-low-alpha-texture",
        particleCount: 1,
        modelName: "weapon.lgo",
        textureName: "low-alpha",
        frameSizes: [1],
        frameColors: [[1, 1, 1, 1]],
        offset: [0, 0, 0],
        srcBlend: 5,
        destBlend: 2,
      })));
      writeFileSync(texturePath, JSON.stringify({
        textures: {
          "low-alpha": {
            width: 1,
            height: 1,
            rgba: Buffer.from([255, 0, 0, 15]).toString("base64"),
          },
        },
      }));
      writeFileSync(modelBundlePath, JSON.stringify(modelBundleFixture("weapon.lgo")));
      writeFileSync(join(dir, "original.bmp"), writeBmp24(
        32,
        32,
        Array.from({ length: 32 * 32 }, (_, index) => {
          const x = index % 32;
          const y = Math.floor(index / 32);
          return x >= 10 && x <= 21 && y >= 10 && y <= 21
            ? [15, 0, 0, 255]
            : [0, 0, 0, 255];
        }),
      ));
      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "generated MODEL low-alpha particle texture candidate",
            source: "original.bmp",
            candidate: "pko-tools.bmp",
            candidateCapture: {
              parJson: "particles.json",
              textureBundle: "textures.json",
              modelBundle: "models.json",
              time: 0,
              width: 32,
              height: 32,
            },
          },
        ],
      }));

      const output = execFileSync(process.execPath, [
        corpusGateScript,
        "--manifest",
        manifestPath,
      ], { encoding: "utf8" });

      const report = JSON.parse(output);
      expect(report.pass).toBe(true);
      expect(report.cases[0].candidateCapture.renderedParticleSystems).toBe(1);
      expect(report.cases[0].candidateCapture.skippedParticleSystems).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("can regenerate a pko-tools BLAST particle candidate after lifecycle stepping", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-pixel-corpus-"));
    try {
      const parPath = join(dir, "particles.json");
      const modelBundlePath = join(dir, "models.json");
      const sourcePath = join(dir, "original.bmp");
      const manifestPath = join(dir, "manifest.json");
      writeFileSync(parPath, JSON.stringify(parFixture({
        type: 3,
        name: "blast-particle",
        particleCount: 1,
        modelName: "weapon.lgo",
        range: [0, 0, 0],
        frameCount: 2,
        frameSizes: [1, 1],
        frameColors: [[1, 1, 1, 1], [1, 1, 1, 1]],
        life: 1,
        velocity: 0,
        acceleration: [0, 0, 0],
        offset: [0, 0, 0],
      })));
      writeFileSync(modelBundlePath, JSON.stringify(modelBundleFixture("weapon.lgo")));

      execFileSync(process.execPath, [
        captureScript,
        "--par-json",
        parPath,
        "--model-bundle",
        modelBundlePath,
        "--out",
        sourcePath,
        "--time",
        "0.25",
        "--width",
        "32",
        "--height",
        "32",
        "--fail-on-skipped",
      ], { cwd: repoRoot, encoding: "utf8" });

      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "generated BLAST particle candidate",
            source: "original.bmp",
            candidate: "pko-tools.bmp",
            candidateCapture: {
              parJson: "particles.json",
              modelBundle: "models.json",
              time: 0.25,
              width: 32,
              height: 32,
            },
          },
        ],
      }));

      const output = execFileSync(process.execPath, [
        corpusGateScript,
        "--manifest",
        manifestPath,
      ], { encoding: "utf8" });

      const report = JSON.parse(output);
      expect(report.pass).toBe(true);
      expect(report.cases[0].candidateCapture.renderedParticleSystems).toBe(1);
      expect(report.cases[0].candidateCapture.skippedParticleSystems).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("can regenerate a pko-tools BLAST3 particle candidate after lifecycle stepping", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-pixel-corpus-"));
    try {
      const parPath = join(dir, "particles.json");
      const modelBundlePath = join(dir, "models.json");
      const sourcePath = join(dir, "original.bmp");
      const manifestPath = join(dir, "manifest.json");
      writeFileSync(parPath, JSON.stringify(parFixture({
        type: 11,
        name: "blast3-particle",
        particleCount: 1,
        modelName: "weapon.lgo",
        range: [0, 0, 0],
        frameCount: 2,
        frameSizes: [1, 1],
        frameColors: [[1, 1, 1, 1], [1, 1, 1, 1]],
        life: 1,
        velocity: 0,
        direction: [0, 0, 0],
        acceleration: [0, 0, 0],
        offset: [0, 0, 0],
      })));
      writeFileSync(modelBundlePath, JSON.stringify(modelBundleFixture("weapon.lgo")));

      execFileSync(process.execPath, [
        captureScript,
        "--par-json",
        parPath,
        "--model-bundle",
        modelBundlePath,
        "--out",
        sourcePath,
        "--time",
        "0.25",
        "--width",
        "32",
        "--height",
        "32",
        "--fail-on-skipped",
      ], { cwd: repoRoot, encoding: "utf8" });

      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "generated BLAST3 particle candidate",
            source: "original.bmp",
            candidate: "pko-tools.bmp",
            candidateCapture: {
              parJson: "particles.json",
              modelBundle: "models.json",
              time: 0.25,
              width: 32,
              height: 32,
            },
          },
        ],
      }));

      const output = execFileSync(process.execPath, [
        corpusGateScript,
        "--manifest",
        manifestPath,
      ], { encoding: "utf8" });

      const report = JSON.parse(output);
      expect(report.pass).toBe(true);
      expect(report.cases[0].candidateCapture.renderedParticleSystems).toBe(1);
      expect(report.cases[0].candidateCapture.skippedParticleSystems).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("can regenerate a pko-tools ROUND particle candidate with wrapping lifecycle frames", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-pixel-corpus-"));
    try {
      const parPath = join(dir, "particles.json");
      const modelBundlePath = join(dir, "models.json");
      const sourcePath = join(dir, "original.bmp");
      const manifestPath = join(dir, "manifest.json");
      writeFileSync(parPath, JSON.stringify(parFixture({
        type: 9,
        name: "round-particle",
        particleCount: 1,
        modelName: "weapon.lgo",
        range: [0, 0, 0],
        frameCount: 2,
        frameSizes: [1, 1],
        frameColors: [[1, 1, 1, 1], [1, 1, 1, 1]],
        life: 1,
        velocity: 0,
        offset: [0, 0, 0],
      })));
      writeFileSync(modelBundlePath, JSON.stringify(modelBundleFixture("weapon.lgo")));

      execFileSync(process.execPath, [
        captureScript,
        "--par-json",
        parPath,
        "--model-bundle",
        modelBundlePath,
        "--out",
        sourcePath,
        "--time",
        "1.25",
        "--width",
        "32",
        "--height",
        "32",
        "--fail-on-skipped",
      ], { cwd: repoRoot, encoding: "utf8" });

      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "generated ROUND particle candidate",
            source: "original.bmp",
            candidate: "pko-tools.bmp",
            candidateCapture: {
              parJson: "particles.json",
              modelBundle: "models.json",
              time: 1.25,
              width: 32,
              height: 32,
            },
          },
        ],
      }));

      const output = execFileSync(process.execPath, [
        corpusGateScript,
        "--manifest",
        manifestPath,
      ], { encoding: "utf8" });

      const report = JSON.parse(output);
      expect(report.pass).toBe(true);
      expect(report.cases[0].candidateCapture.renderedParticleSystems).toBe(1);
      expect(report.cases[0].candidateCapture.skippedParticleSystems).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("can regenerate a pko-tools ARROW particle candidate with reset lifecycle frames", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-pixel-corpus-"));
    try {
      const parPath = join(dir, "particles.json");
      const modelBundlePath = join(dir, "models.json");
      const sourcePath = join(dir, "original.bmp");
      const manifestPath = join(dir, "manifest.json");
      writeFileSync(parPath, JSON.stringify(parFixture({
        type: 8,
        name: "arrow-particle",
        particleCount: 4,
        modelName: "weapon.lgo",
        frameCount: 2,
        frameSizes: [1, 1],
        frameColors: [[1, 1, 1, 1], [1, 1, 1, 1]],
        life: 1,
        offset: [0, 0, 0],
      })));
      writeFileSync(modelBundlePath, JSON.stringify(modelBundleFixture("weapon.lgo")));

      execFileSync(process.execPath, [
        captureScript,
        "--par-json",
        parPath,
        "--model-bundle",
        modelBundlePath,
        "--out",
        sourcePath,
        "--time",
        "1.25",
        "--width",
        "32",
        "--height",
        "32",
        "--fail-on-skipped",
      ], { cwd: repoRoot, encoding: "utf8" });

      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "generated ARROW particle candidate",
            source: "original.bmp",
            candidate: "pko-tools.bmp",
            candidateCapture: {
              parJson: "particles.json",
              modelBundle: "models.json",
              time: 1.25,
              width: 32,
              height: 32,
            },
          },
        ],
      }));

      const output = execFileSync(process.execPath, [
        corpusGateScript,
        "--manifest",
        manifestPath,
      ], { encoding: "utf8" });

      const report = JSON.parse(output);
      expect(report.pass).toBe(true);
      expect(report.cases[0].candidateCapture.renderedParticleSystems).toBe(1);
      expect(report.cases[0].candidateCapture.skippedParticleSystems).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("can regenerate a pko-tools SHRINK particle candidate while moving toward its target", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-pixel-corpus-"));
    try {
      const parPath = join(dir, "particles.json");
      const modelBundlePath = join(dir, "models.json");
      const sourcePath = join(dir, "original.bmp");
      const manifestPath = join(dir, "manifest.json");
      writeFileSync(parPath, JSON.stringify(parFixture({
        type: 12,
        name: "shrink-particle",
        particleCount: 1,
        modelName: "weapon.lgo",
        range: [0, 0, 4],
        frameCount: 2,
        frameSizes: [1, 1],
        frameColors: [[1, 1, 1, 1], [1, 1, 1, 1]],
        life: 1,
        velocity: 1,
        offset: [0, 0, 0],
      })));
      writeFileSync(modelBundlePath, JSON.stringify(modelBundleFixture("weapon.lgo")));

      execFileSync(process.execPath, [
        captureScript,
        "--par-json",
        parPath,
        "--model-bundle",
        modelBundlePath,
        "--out",
        sourcePath,
        "--time",
        "0.25",
        "--width",
        "32",
        "--height",
        "32",
        "--fail-on-skipped",
      ], { cwd: repoRoot, encoding: "utf8" });

      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "generated SHRINK particle candidate",
            source: "original.bmp",
            candidate: "pko-tools.bmp",
            candidateCapture: {
              parJson: "particles.json",
              modelBundle: "models.json",
              time: 0.25,
              width: 32,
              height: 32,
            },
          },
        ],
      }));

      const output = execFileSync(process.execPath, [
        corpusGateScript,
        "--manifest",
        manifestPath,
      ], { encoding: "utf8" });

      const report = JSON.parse(output);
      expect(report.pass).toBe(true);
      expect(report.cases[0].candidateCapture.renderedParticleSystems).toBe(1);
      expect(report.cases[0].candidateCapture.skippedParticleSystems).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("can regenerate a pko-tools BLAST2 particle candidate with its custom frame advance branch", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-pixel-corpus-"));
    try {
      const parPath = join(dir, "particles.json");
      const modelBundlePath = join(dir, "models.json");
      const sourcePath = join(dir, "original.bmp");
      const manifestPath = join(dir, "manifest.json");
      writeFileSync(parPath, JSON.stringify(parFixture({
        type: 10,
        name: "blast2-particle",
        particleCount: 1,
        modelName: "weapon.lgo",
        range: [0, 0, 0],
        frameCount: 2,
        frameSizes: [1, 1],
        frameAngles: [[0, 0, 0], [0, 0, 0]],
        frameColors: [[1, 1, 1, 1], [1, 1, 1, 1]],
        life: 1,
        velocity: 0,
        acceleration: [0, 0, 0],
        offset: [0, 0, 0],
      })));
      writeFileSync(modelBundlePath, JSON.stringify(modelBundleFixture("weapon.lgo")));

      execFileSync(process.execPath, [
        captureScript,
        "--par-json",
        parPath,
        "--model-bundle",
        modelBundlePath,
        "--out",
        sourcePath,
        "--time",
        "0.25",
        "--width",
        "32",
        "--height",
        "32",
        "--fail-on-skipped",
      ], { cwd: repoRoot, encoding: "utf8" });

      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "generated BLAST2 particle candidate",
            source: "original.bmp",
            candidate: "pko-tools.bmp",
            candidateCapture: {
              parJson: "particles.json",
              modelBundle: "models.json",
              time: 0.25,
              width: 32,
              height: 32,
            },
          },
        ],
      }));

      const output = execFileSync(process.execPath, [
        corpusGateScript,
        "--manifest",
        manifestPath,
      ], { encoding: "utf8" });

      const report = JSON.parse(output);
      expect(report.pass).toBe(true);
      expect(report.cases[0].candidateCapture.renderedParticleSystems).toBe(1);
      expect(report.cases[0].candidateCapture.skippedParticleSystems).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("can regenerate a pko-tools FIRE particle candidate after dead-slot step emission", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-pixel-corpus-"));
    try {
      const parPath = join(dir, "particles.json");
      const modelBundlePath = join(dir, "models.json");
      const sourcePath = join(dir, "original.bmp");
      const manifestPath = join(dir, "manifest.json");
      writeFileSync(parPath, JSON.stringify(parFixture({
        type: 2,
        name: "fire-particle",
        particleCount: 1,
        modelName: "weapon.lgo",
        range: [0, 0, 0],
        frameCount: 2,
        frameSizes: [1, 1],
        frameColors: [[1, 1, 1, 1], [1, 1, 1, 1]],
        life: 1,
        velocity: 0,
        direction: [0, 0, 1],
        acceleration: [0, 0, 0],
        step: 0,
        offset: [0, 0, 0],
      })));
      writeFileSync(modelBundlePath, JSON.stringify(modelBundleFixture("weapon.lgo")));

      execFileSync(process.execPath, [
        captureScript,
        "--par-json",
        parPath,
        "--model-bundle",
        modelBundlePath,
        "--out",
        sourcePath,
        "--time",
        "0.25",
        "--width",
        "32",
        "--height",
        "32",
        "--fail-on-skipped",
      ], { cwd: repoRoot, encoding: "utf8" });

      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "generated FIRE particle candidate",
            source: "original.bmp",
            candidate: "pko-tools.bmp",
            candidateCapture: {
              parJson: "particles.json",
              modelBundle: "models.json",
              time: 0.25,
              width: 32,
              height: 32,
            },
          },
        ],
      }));

      const output = execFileSync(process.execPath, [
        corpusGateScript,
        "--manifest",
        manifestPath,
      ], { encoding: "utf8" });

      const report = JSON.parse(output);
      expect(report.pass).toBe(true);
      expect(report.cases[0].candidateCapture.renderedParticleSystems).toBe(1);
      expect(report.cases[0].candidateCapture.skippedParticleSystems).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("can regenerate a pko-tools SNOW particle candidate after dead-slot step emission", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-pixel-corpus-"));
    try {
      const parPath = join(dir, "particles.json");
      const modelBundlePath = join(dir, "models.json");
      const sourcePath = join(dir, "original.bmp");
      const manifestPath = join(dir, "manifest.json");
      writeFileSync(parPath, JSON.stringify(parFixture({
        type: 1,
        name: "snow-particle",
        particleCount: 1,
        modelName: "weapon.lgo",
        range: [0, 0, 0],
        frameCount: 2,
        frameSizes: [1, 1],
        frameColors: [[1, 1, 1, 1], [1, 1, 1, 1]],
        life: 1,
        velocity: 1,
        direction: [0, 0, 1],
        acceleration: [0, 0, 0],
        step: 0,
        offset: [0, 0, 0],
      })));
      writeFileSync(modelBundlePath, JSON.stringify(modelBundleFixture("weapon.lgo")));

      execFileSync(process.execPath, [
        captureScript,
        "--par-json",
        parPath,
        "--model-bundle",
        modelBundlePath,
        "--out",
        sourcePath,
        "--time",
        "0.25",
        "--width",
        "32",
        "--height",
        "32",
        "--fail-on-skipped",
      ], { cwd: repoRoot, encoding: "utf8" });

      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "generated SNOW particle candidate",
            source: "original.bmp",
            candidate: "pko-tools.bmp",
            candidateCapture: {
              parJson: "particles.json",
              modelBundle: "models.json",
              time: 0.25,
              width: 32,
              height: 32,
            },
          },
        ],
      }));

      const output = execFileSync(process.execPath, [
        corpusGateScript,
        "--manifest",
        manifestPath,
      ], { encoding: "utf8" });

      const report = JSON.parse(output);
      expect(report.pass).toBe(true);
      expect(report.cases[0].candidateCapture.renderedParticleSystems).toBe(1);
      expect(report.cases[0].candidateCapture.skippedParticleSystems).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("can regenerate a pko-tools RIPPLE particle candidate after source-primed step emission", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-pixel-corpus-"));
    try {
      const parPath = join(dir, "particles.json");
      const modelBundlePath = join(dir, "models.json");
      const sourcePath = join(dir, "original.bmp");
      const manifestPath = join(dir, "manifest.json");
      writeFileSync(parPath, JSON.stringify(parFixture({
        type: 4,
        name: "ripple-particle",
        particleCount: 1,
        modelName: "weapon.lgo",
        range: [0, 0, 0],
        frameCount: 2,
        frameSizes: [1, 1],
        frameColors: [[1, 1, 1, 1], [1, 1, 1, 1]],
        life: 1,
        step: 0.25,
        offset: [0, 0, 0],
      })));
      writeFileSync(modelBundlePath, JSON.stringify(modelBundleFixture("weapon.lgo")));

      execFileSync(process.execPath, [
        captureScript,
        "--par-json",
        parPath,
        "--model-bundle",
        modelBundlePath,
        "--out",
        sourcePath,
        "--time",
        "0.01",
        "--width",
        "32",
        "--height",
        "32",
        "--fail-on-skipped",
      ], { cwd: repoRoot, encoding: "utf8" });

      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "generated RIPPLE particle candidate",
            source: "original.bmp",
            candidate: "pko-tools.bmp",
            candidateCapture: {
              parJson: "particles.json",
              modelBundle: "models.json",
              time: 0.01,
              width: 32,
              height: 32,
            },
          },
        ],
      }));

      const output = execFileSync(process.execPath, [
        corpusGateScript,
        "--manifest",
        manifestPath,
      ], { encoding: "utf8" });

      const report = JSON.parse(output);
      expect(report.pass).toBe(true);
      expect(report.cases[0].candidateCapture.renderedParticleSystems).toBe(1);
      expect(report.cases[0].candidateCapture.skippedParticleSystems).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("can regenerate a pko-tools WIND particle candidate after dead-slot step emission", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-pixel-corpus-"));
    try {
      const parPath = join(dir, "particles.json");
      const modelBundlePath = join(dir, "models.json");
      const sourcePath = join(dir, "original.bmp");
      const manifestPath = join(dir, "manifest.json");
      writeFileSync(parPath, JSON.stringify(parFixture({
        type: 7,
        name: "wind-particle",
        particleCount: 1,
        modelName: "weapon.lgo",
        range: [0, 0, 0],
        frameCount: 2,
        frameSizes: [1, 1],
        frameColors: [[1, 1, 1, 1], [1, 1, 1, 1]],
        life: 1,
        velocity: 1,
        direction: [0, 0, 0],
        step: 0,
        offset: [0, 0, 0],
      })));
      writeFileSync(modelBundlePath, JSON.stringify(modelBundleFixture("weapon.lgo")));

      execFileSync(process.execPath, [
        captureScript,
        "--par-json",
        parPath,
        "--model-bundle",
        modelBundlePath,
        "--out",
        sourcePath,
        "--time",
        "0.25",
        "--width",
        "32",
        "--height",
        "32",
        "--fail-on-skipped",
      ], { cwd: repoRoot, encoding: "utf8" });

      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "generated WIND particle candidate",
            source: "original.bmp",
            candidate: "pko-tools.bmp",
            candidateCapture: {
              parJson: "particles.json",
              modelBundle: "models.json",
              time: 0.25,
              width: 32,
              height: 32,
            },
          },
        ],
      }));

      const output = execFileSync(process.execPath, [
        corpusGateScript,
        "--manifest",
        manifestPath,
      ], { encoding: "utf8" });

      const report = JSON.parse(output);
      expect(report.pass).toBe(true);
      expect(report.cases[0].candidateCapture.renderedParticleSystems).toBe(1);
      expect(report.cases[0].candidateCapture.skippedParticleSystems).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("can regenerate a pko-tools STRIP particle candidate as a fixed frame-0 model particle", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-pixel-corpus-"));
    try {
      const parPath = join(dir, "particles.json");
      const modelBundlePath = join(dir, "models.json");
      const sourcePath = join(dir, "original.bmp");
      const manifestPath = join(dir, "manifest.json");
      writeFileSync(parPath, JSON.stringify(parFixture({
        type: 6,
        name: "strip-particle",
        particleCount: 5,
        modelName: "weapon.lgo",
        range: [0, 0, 0],
        frameCount: 2,
        frameSizes: [1, 3],
        frameColors: [[1, 1, 1, 1], [1, 0, 0, 1]],
        life: 1,
        offset: [0, 0, 0],
      })));
      writeFileSync(modelBundlePath, JSON.stringify(modelBundleFixture("weapon.lgo")));

      execFileSync(process.execPath, [
        captureScript,
        "--par-json",
        parPath,
        "--model-bundle",
        modelBundlePath,
        "--out",
        sourcePath,
        "--time",
        "0.5",
        "--width",
        "32",
        "--height",
        "32",
        "--fail-on-skipped",
      ], { cwd: repoRoot, encoding: "utf8" });

      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "generated STRIP particle candidate",
            source: "original.bmp",
            candidate: "pko-tools.bmp",
            candidateCapture: {
              parJson: "particles.json",
              modelBundle: "models.json",
              time: 0.5,
              width: 32,
              height: 32,
            },
          },
        ],
      }));

      const output = execFileSync(process.execPath, [
        corpusGateScript,
        "--manifest",
        manifestPath,
      ], { encoding: "utf8" });

      const report = JSON.parse(output);
      expect(report.pass).toBe(true);
      expect(report.cases[0].candidateCapture.renderedParticleSystems).toBe(1);
      expect(report.cases[0].candidateCapture.skippedParticleSystems).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("can regenerate a pko-tools SHADE particle candidate as a fixed-size ground decal", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-pixel-corpus-"));
    try {
      const parPath = join(dir, "particles.json");
      const sourcePath = join(dir, "original.bmp");
      const manifestPath = join(dir, "manifest.json");
      writeFileSync(parPath, JSON.stringify(parFixture({
        type: 13,
        name: "shade-particle",
        particleCount: 8,
        modelName: "",
        textureName: "",
        range: [0, 0, 0],
        frameCount: 2,
        frameSizes: [1, 3],
        frameColors: [[1, 1, 1, 1], [1, 0, 0, 1]],
        life: 1,
        offset: [0, 0, 0],
      })));

      execFileSync(process.execPath, [
        captureScript,
        "--par-json",
        parPath,
        "--out",
        sourcePath,
        "--time",
        "0.5",
        "--width",
        "32",
        "--height",
        "32",
        "--fail-on-skipped",
      ], { cwd: repoRoot, encoding: "utf8" });

      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "generated SHADE particle candidate",
            source: "original.bmp",
            candidate: "pko-tools.bmp",
            candidateCapture: {
              parJson: "particles.json",
              time: 0.5,
              width: 32,
              height: 32,
            },
          },
        ],
      }));

      const output = execFileSync(process.execPath, [
        corpusGateScript,
        "--manifest",
        manifestPath,
      ], { encoding: "utf8" });

      const report = JSON.parse(output);
      expect(report.pass).toBe(true);
      expect(report.cases[0].candidateCapture.renderedParticleSystems).toBe(1);
      expect(report.cases[0].candidateCapture.skippedParticleSystems).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("can regenerate a pko-tools DUMMY particle candidate when dummy span metadata is available", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-pixel-corpus-"));
    try {
      const parPath = join(dir, "particles.json");
      const modelBundlePath = join(dir, "models.json");
      const sourcePath = join(dir, "original.bmp");
      const manifestPath = join(dir, "manifest.json");
      writeFileSync(parPath, JSON.stringify(parFixture({
        dummyLineSpan: {
          start: [0, 0, 0],
          direction: [0, 0, 1],
          distance: 1,
        },
        type: 16,
        name: "dummy-particle",
        particleCount: 1,
        modelName: "weapon.lgo",
        range: [0, 0, 0],
        frameCount: 2,
        frameSizes: [1, 1],
        frameColors: [[1, 1, 1, 1], [1, 1, 1, 1]],
        life: 1,
        step: 0,
        offset: [0, 0, 0],
      })));
      writeFileSync(modelBundlePath, JSON.stringify(modelBundleFixture("weapon.lgo")));

      execFileSync(process.execPath, [
        captureScript,
        "--par-json",
        parPath,
        "--model-bundle",
        modelBundlePath,
        "--out",
        sourcePath,
        "--time",
        "0.25",
        "--width",
        "32",
        "--height",
        "32",
        "--fail-on-skipped",
      ], { cwd: repoRoot, encoding: "utf8" });

      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "generated DUMMY particle candidate",
            source: "original.bmp",
            candidate: "pko-tools.bmp",
            candidateCapture: {
              parJson: "particles.json",
              modelBundle: "models.json",
              time: 0.25,
              width: 32,
              height: 32,
            },
          },
        ],
      }));

      const output = execFileSync(process.execPath, [
        corpusGateScript,
        "--manifest",
        manifestPath,
      ], { encoding: "utf8" });

      const report = JSON.parse(output);
      expect(report.pass).toBe(true);
      expect(report.cases[0].candidateCapture.renderedParticleSystems).toBe(1);
      expect(report.cases[0].candidateCapture.skippedParticleSystems).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("can regenerate a pko-tools LINE_SINGLE particle candidate moving along a dummy span", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-pixel-corpus-"));
    try {
      const parPath = join(dir, "particles.json");
      const modelBundlePath = join(dir, "models.json");
      const sourcePath = join(dir, "original.bmp");
      const manifestPath = join(dir, "manifest.json");
      writeFileSync(parPath, JSON.stringify(parFixture({
        dummyLineSpan: {
          start: [0, 0, 0],
          direction: [0, 0, 1],
          distance: 1,
        },
        type: 17,
        name: "line-single-particle",
        particleCount: 1,
        modelName: "weapon.lgo",
        range: [0, 0, 0],
        frameCount: 2,
        frameSizes: [1, 1],
        frameColors: [[1, 1, 1, 1], [1, 1, 1, 1]],
        life: 1,
        step: 0,
        offset: [0, 0, 0],
      })));
      writeFileSync(modelBundlePath, JSON.stringify(modelBundleFixture("weapon.lgo")));

      execFileSync(process.execPath, [
        captureScript,
        "--par-json",
        parPath,
        "--model-bundle",
        modelBundlePath,
        "--out",
        sourcePath,
        "--time",
        "0.25",
        "--width",
        "32",
        "--height",
        "32",
        "--fail-on-skipped",
      ], { cwd: repoRoot, encoding: "utf8" });

      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "generated LINE_SINGLE particle candidate",
            source: "original.bmp",
            candidate: "pko-tools.bmp",
            candidateCapture: {
              parJson: "particles.json",
              modelBundle: "models.json",
              time: 0.25,
              width: 32,
              height: 32,
            },
          },
        ],
      }));

      const output = execFileSync(process.execPath, [
        corpusGateScript,
        "--manifest",
        manifestPath,
      ], { encoding: "utf8" });

      const report = JSON.parse(output);
      expect(report.pass).toBe(true);
      expect(report.cases[0].candidateCapture.renderedParticleSystems).toBe(1);
      expect(report.cases[0].candidateCapture.skippedParticleSystems).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("can regenerate a pko-tools LINE_ROUND particle candidate with dummy-span reversal motion", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-pixel-corpus-"));
    try {
      const parPath = join(dir, "particles.json");
      const modelBundlePath = join(dir, "models.json");
      const sourcePath = join(dir, "original.bmp");
      const manifestPath = join(dir, "manifest.json");
      writeFileSync(parPath, JSON.stringify(parFixture({
        dummyLineSpan: {
          start: [0, 0, 0],
          direction: [0, 0, 1],
          distance: 1,
        },
        type: 18,
        name: "line-round-particle",
        particleCount: 1,
        modelName: "weapon.lgo",
        range: [0, 0, 0],
        frameCount: 2,
        frameSizes: [1, 1],
        frameColors: [[1, 1, 1, 1], [1, 1, 1, 1]],
        life: 1,
        step: 0,
        offset: [0, 0, 0],
      })));
      writeFileSync(modelBundlePath, JSON.stringify(modelBundleFixture("weapon.lgo")));

      execFileSync(process.execPath, [
        captureScript,
        "--par-json",
        parPath,
        "--model-bundle",
        modelBundlePath,
        "--out",
        sourcePath,
        "--time",
        "0.75",
        "--width",
        "32",
        "--height",
        "32",
        "--fail-on-skipped",
      ], { cwd: repoRoot, encoding: "utf8" });

      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "generated LINE_ROUND particle candidate",
            source: "original.bmp",
            candidate: "pko-tools.bmp",
            candidateCapture: {
              parJson: "particles.json",
              modelBundle: "models.json",
              time: 0.75,
              width: 32,
              height: 32,
            },
          },
        ],
      }));

      const output = execFileSync(process.execPath, [
        corpusGateScript,
        "--manifest",
        manifestPath,
      ], { encoding: "utf8" });

      const report = JSON.parse(output);
      expect(report.pass).toBe(true);
      expect(report.cases[0].candidateCapture.renderedParticleSystems).toBe(1);
      expect(report.cases[0].candidateCapture.skippedParticleSystems).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("can regenerate a pko-tools magic candidate capture before diffing a case", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-pixel-corpus-"));
    try {
      const manifestPath = join(dir, "manifest.json");
      const scenarioPath = join(dir, "magic-scenario.json");
      const sourcePath = join(dir, "original.bmp");
      writeFileSync(scenarioPath, JSON.stringify(magicScenarioFixture()));
      execFileSync(process.execPath, [
        captureScript,
        "--magic-scenario",
        scenarioPath,
        "--out",
        sourcePath,
        "--time",
        "0",
        "--width",
        "32",
        "--height",
        "32",
      ], { cwd: repoRoot, encoding: "utf8" });

      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "generated magic candidate",
            source: "original.bmp",
            candidate: "pko-tools.bmp",
            candidateCapture: {
              magicScenario: "magic-scenario.json",
              time: 0,
              width: 32,
              height: 32,
            },
          },
        ],
      }));

      const result = spawnSync(process.execPath, [
        corpusGateScript,
        "--manifest",
        manifestPath,
      ], { encoding: "utf8" });

      expect(result.status).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report.pass).toBe(true);
      expect(report.cases[0].candidateCapture.renderedMagicEffects).toBe(1);
      expect(report.cases[0].candidateCapture.skippedMagicEffects).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("can regenerate a pko-tools magic hit particle candidate before diffing a case", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-pixel-corpus-"));
    try {
      const manifestPath = join(dir, "manifest.json");
      const scenarioPath = join(dir, "magic-scenario.json");
      const sourcePath = join(dir, "original.bmp");
      writeFileSync(scenarioPath, JSON.stringify(magicHitScenarioFixture()));
      execFileSync(process.execPath, [
        captureScript,
        "--magic-scenario",
        scenarioPath,
        "--out",
        sourcePath,
        "--time",
        "1",
        "--width",
        "32",
        "--height",
        "32",
      ], { cwd: repoRoot, encoding: "utf8" });

      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "generated magic hit candidate",
            source: "original.bmp",
            candidate: "pko-tools.bmp",
            candidateCapture: {
              magicScenario: "magic-scenario.json",
              time: 1,
              width: 32,
              height: 32,
            },
          },
        ],
      }));

      const result = spawnSync(process.execPath, [
        corpusGateScript,
        "--manifest",
        manifestPath,
      ], { encoding: "utf8" });

      expect(result.status).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report.pass).toBe(true);
      expect(report.cases[0].candidateCapture.renderedMagicParticleEffects).toBe(1);
      expect(report.cases[0].candidateCapture.skippedMagicParticleEffects).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("can regenerate a pko-tools magic hit modelDir particle candidate before diffing a case", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-pixel-corpus-"));
    try {
      const manifestPath = join(dir, "manifest.json");
      const scenarioPath = join(dir, "magic-scenario.json");
      const modelBundlePath = join(dir, "models.json");
      const sourcePath = join(dir, "original.bmp");
      writeFileSync(scenarioPath, JSON.stringify(magicHitModelDirScenarioFixture()));
      writeFileSync(modelBundlePath, JSON.stringify(modelBundleFixture("arrow.lgo", [
        0.35, -0.15, 0,
        0.35, 0.15, 0,
        1.3, 0.15, 0,
        1.3, -0.15, 0,
      ])));
      execFileSync(process.execPath, [
        captureScript,
        "--magic-scenario",
        scenarioPath,
        "--model-bundle",
        modelBundlePath,
        "--out",
        sourcePath,
        "--time",
        "1",
        "--width",
        "32",
        "--height",
        "32",
      ], { cwd: repoRoot, encoding: "utf8" });

      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "generated magic hit modelDir candidate",
            source: "original.bmp",
            candidate: "pko-tools.bmp",
            candidateCapture: {
              magicScenario: "magic-scenario.json",
              modelBundle: "models.json",
              time: 1,
              width: 32,
              height: 32,
            },
          },
        ],
      }));

      const result = spawnSync(process.execPath, [
        corpusGateScript,
        "--manifest",
        manifestPath,
      ], { encoding: "utf8" });

      expect(result.status).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report.pass).toBe(true);
      expect(report.cases[0].candidateCapture.renderedMagicParticleEffects).toBe(1);
      expect(report.cases[0].candidateCapture.skippedMagicParticleEffects).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("can regenerate a pko-tools in-flight magic particle candidate before diffing a case", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-pixel-corpus-"));
    try {
      const manifestPath = join(dir, "manifest.json");
      const scenarioPath = join(dir, "magic-scenario.json");
      const sourcePath = join(dir, "original.bmp");
      writeFileSync(scenarioPath, JSON.stringify(magicInFlightParticleScenarioFixture()));
      execFileSync(process.execPath, [
        captureScript,
        "--magic-scenario",
        scenarioPath,
        "--out",
        sourcePath,
        "--time",
        "0.01",
        "--width",
        "32",
        "--height",
        "32",
      ], { cwd: repoRoot, encoding: "utf8" });

      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "generated in-flight magic particle candidate",
            source: "original.bmp",
            candidate: "pko-tools.bmp",
            candidateCapture: {
              magicScenario: "magic-scenario.json",
              time: 0.01,
              width: 32,
              height: 32,
            },
          },
        ],
      }));

      const result = spawnSync(process.execPath, [
        corpusGateScript,
        "--manifest",
        manifestPath,
      ], { encoding: "utf8" });

      expect(result.status).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report.pass).toBe(true);
      expect(report.cases[0].candidateCapture.renderedMagicParticleEffects).toBe(1);
      expect(report.cases[0].candidateCapture.skippedMagicParticleEffects).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function writeBmp24(width: number, height: number, pixels: Array<[number, number, number, number]>): Buffer {
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
    const targetY = height - 1 - y;
    const targetRow = pixelOffset + targetY * rowStride;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixels[y * width + x];
      const targetOffset = targetRow + x * 3;
      buffer[targetOffset] = b;
      buffer[targetOffset + 1] = g;
      buffer[targetOffset + 2] = r;
    }
  }

  return buffer;
}

function effectFixture() {
  return {
    version: 7,
    idxTech: 0,
    usePath: false,
    pathName: "",
    useSound: false,
    soundName: "",
    rotating: false,
    rotaVec: [0, 0, 1],
    rotaVel: 0,
    effNum: 1,
    subEffects: [
      {
        effectName: "pixel-corpus-smoke",
        effectType: 1,
        srcBlend: 5,
        destBlend: 6,
        length: 1,
        frameCount: 1,
        frameTimes: [1],
        frameSizes: [[1.5, 1.5, 1.5]],
        frameAngles: [[0, 0, 0]],
        framePositions: [[0, 0, 0]],
        frameColors: [[1, 0, 0, 1]],
        verCount: 4,
        coordCount: 0,
        coordFrameTime: 0,
        coordList: [],
        texCount: 0,
        texFrameTime: 0,
        texName: "",
        texList: [],
        modelName: "RectPlane",
        billboard: false,
        vsIndex: 0,
        segments: 16,
        height: 1,
        topRadius: 0.5,
        botRadius: 0.5,
        frameTexCount: 0,
        frameTexTime: 0,
        frameTexNames: [],
        frameTexTime2: 0,
        useParam: 0,
        perFrameCylinder: [],
        rotaLoop: false,
        rotaLoopVec: [0, 0, 1, 0],
        alpha: true,
        rotaBoard: false,
      },
    ],
  };
}

function modelBundleFixture(
  modelName: string,
  positionValues: number[] = [
    -0.75, -0.75, 0,
    -0.75, 0.75, 0,
    0.75, 0.75, 0,
    0.75, -0.75, 0,
  ],
) {
  const positions = floats(positionValues);
  const normals = floats([
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
  ]);
  const uvs = floats([
    0, 1,
    0, 0,
    1, 0,
    1, 1,
  ]);
  const indices = uint16s([0, 2, 1, 0, 3, 2]);
  const buffer = Buffer.concat([positions, normals, uvs, indices]);
  const xs = positionValues.filter((_, index) => index % 3 === 0);
  const ys = positionValues.filter((_, index) => index % 3 === 1);
  const zs = positionValues.filter((_, index) => index % 3 === 2);
  const normalizedModelName = modelName.toLowerCase().replace(/\.lgo$/i, "");

  const gltf = {
    asset: { version: "2.0", generator: "pko-tools-test" },
    buffers: [
      {
        byteLength: buffer.byteLength,
        uri: `data:application/octet-stream;base64,${buffer.toString("base64")}`,
      },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength, target: 34962 },
      { buffer: 0, byteOffset: positions.byteLength, byteLength: normals.byteLength, target: 34962 },
      { buffer: 0, byteOffset: positions.byteLength + normals.byteLength, byteLength: uvs.byteLength, target: 34962 },
      { buffer: 0, byteOffset: positions.byteLength + normals.byteLength + uvs.byteLength, byteLength: indices.byteLength, target: 34963 },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 4,
        type: "VEC3",
        min: [Math.min(...xs), Math.min(...ys), Math.min(...zs)],
        max: [Math.max(...xs), Math.max(...ys), Math.max(...zs)],
      },
      { bufferView: 1, componentType: 5126, count: 4, type: "VEC3" },
      { bufferView: 2, componentType: 5126, count: 4, type: "VEC2" },
      { bufferView: 3, componentType: 5123, count: 6, type: "SCALAR" },
    ],
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
            indices: 3,
            mode: 4,
          },
        ],
      },
    ],
    nodes: [{ mesh: 0, name: modelName }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };

  return {
    schema: "pko-effect-model-bundle/v1",
    models: {
      [normalizedModelName]: {
        gltf: JSON.stringify(gltf),
        source: `test/${normalizedModelName}.lgo`,
      },
    },
  };
}

function floats(values: number[]) {
  const buffer = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => buffer.writeFloatLE(value, index * 4));
  return buffer;
}

function uint16s(values: number[]) {
  const buffer = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => buffer.writeUInt16LE(value, index * 2));
  return buffer;
}

function magicScenarioFixture() {
  return {
    schema: "pko-effect-magic-scenario/v1",
    magicEntry: {
      id: 10,
      data_name: "Test Magic",
      name: "Test Magic",
      models: ["test.eff"],
      velocity: 10,
      particles: [],
      dummies: [-1, -1, -1, -1, -1, -1, -1, -1],
      render_idx: 1,
      lightId: 0,
      result_effect: "0",
    },
    effects: [
      {
        name: "test.eff",
        effect: effectFixture(),
      },
    ],
    origin: [0, 0, 0],
    target: [0, 8, 0],
    showTarget: false,
    animateTarget: false,
  };
}

function magicHitScenarioFixture() {
  const scenario = magicScenarioFixture();
  return {
    ...scenario,
    renderPhase: "hit",
    origin: [0, -1, 0],
    target: [0, 0, 0],
    magicEntry: {
      ...scenario.magicEntry,
      result_effect: "hit.par",
    },
    particleEffects: [
      {
        name: "hit.par",
        par: parFixture({
          type: 13,
          name: "hit-shade",
          particleCount: 1,
          frameCount: 2,
          frameSizes: [1, 1],
          frameColors: [[0, 1, 0, 1], [0, 1, 0, 1]],
          life: 1,
          srcBlend: 5,
          destBlend: 6,
        }),
      },
    ],
  };
}

function magicHitModelDirScenarioFixture() {
  return {
    ...magicHitScenarioFixture(),
    magicEntry: {
      ...magicHitScenarioFixture().magicEntry,
      render_idx: 1,
      velocity: 10,
    },
    origin: [-1, 0, 0],
    target: [0, 0, 0],
    particleEffects: [
      {
        name: "hit.par",
        par: parFixture({
          type: 5,
          name: "hit-model",
          modelName: "arrow.lgo",
          modelDir: true,
          direction: [0, 1, 0],
          particleCount: 1,
          frameCount: 2,
          frameSizes: [1, 1],
          frameColors: [[1, 1, 1, 1], [1, 1, 1, 1]],
          life: 1,
          srcBlend: 5,
          destBlend: 6,
        }),
      },
    ],
  };
}

function magicInFlightParticleScenarioFixture() {
  const scenario = magicScenarioFixture();
  return {
    ...scenario,
    effects: [],
    origin: [0, 0, 0],
    target: [0, 1, 0],
    magicEntry: {
      ...scenario.magicEntry,
      models: [],
      particles: ["trail.par"],
      render_idx: 1,
    },
    particleEffects: [
      {
        name: "trail.par",
        par: parFixture({
          type: 13,
          name: "flight-shade",
          particleCount: 1,
          frameCount: 2,
          frameSizes: [1, 1],
          frameColors: [[0, 1, 0, 1], [0, 1, 0, 1]],
          life: 1,
          srcBlend: 5,
          destBlend: 6,
        }),
      },
    ],
  };
}

function parFixture(systemOverrides = {}) {
  return {
    version: 8,
    name: "range-fixture",
    length: 1,
    systems: [
      {
        type: 14,
        name: "range-ring",
        particleCount: 1,
        textureName: "",
        modelName: "",
        range: [0, 0, 0],
        frameCount: 1,
        frameSizes: [1],
        frameAngles: [[0, 0, 0]],
        frameColors: [[1, 1, 1, 1]],
        billboard: false,
        srcBlend: 5,
        destBlend: 6,
        life: 1,
        velocity: 0,
        direction: [0, 0, 1],
        acceleration: [0, 0, 0],
        step: 0,
        offset: [0, 0, 0],
        delayTime: 0,
        playTime: 1,
        usePath: false,
        path: null,
        shade: false,
        hitEffect: "",
        pointRanges: [],
        randomMode: 1,
        modelDir: false,
        mediaY: false,
        ...systemOverrides,
      },
    ],
    strips: [],
    models: [],
  };
}

function characterModelParFixture(modelOverrides = {}) {
  return {
    version: 8,
    name: "character-model-fixture",
    length: 1,
    systems: [],
    strips: [],
    models: [
      {
        id: 52,
        velocity: 1,
        playType: 2,
        curPose: 1,
        srcBlend: 5,
        destBlend: 6,
        color: [1, 1, 1, 1],
        ...modelOverrides,
      },
    ],
  };
}

function characterModelBundleFixture(characterId: number) {
  const positions = floats([
    -0.75, 0, -0.75,
    -0.75, 0, 0.75,
    0.75, 0, 0.75,
    0.75, 0, -0.75,
  ]);
  const normals = floats([
    0, -1, 0,
    0, -1, 0,
    0, -1, 0,
    0, -1, 0,
  ]);
  const uvs = floats([
    0, 1,
    0, 0,
    1, 0,
    1, 1,
  ]);
  const indices = uint16s([0, 2, 1, 0, 3, 2]);
  const buffer = Buffer.concat([positions, normals, uvs, indices]);

  const gltf = {
    asset: { version: "2.0", generator: "pko-tools-test" },
    buffers: [
      {
        byteLength: buffer.byteLength,
        uri: `data:application/octet-stream;base64,${buffer.toString("base64")}`,
      },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength, target: 34962 },
      { buffer: 0, byteOffset: positions.byteLength, byteLength: normals.byteLength, target: 34962 },
      { buffer: 0, byteOffset: positions.byteLength + normals.byteLength, byteLength: uvs.byteLength, target: 34962 },
      { buffer: 0, byteOffset: positions.byteLength + normals.byteLength + uvs.byteLength, byteLength: indices.byteLength, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 4, type: "VEC3", min: [-0.75, 0, -0.75], max: [0.75, 0, 0.75] },
      { bufferView: 1, componentType: 5126, count: 4, type: "VEC3" },
      { bufferView: 2, componentType: 5126, count: 4, type: "VEC2" },
      { bufferView: 3, componentType: 5123, count: 6, type: "SCALAR" },
    ],
    meshes: [
      {
        primitives: [
          {
            attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
            indices: 3,
            mode: 4,
          },
        ],
      },
    ],
    nodes: [{ mesh: 0, name: String(characterId) }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  };

  return {
    schema: "pko-effect-model-bundle/v1",
    models: {
      [String(characterId)]: {
        gltf: JSON.stringify(gltf),
        source: `test/character/${characterId}.gltf`,
      },
    },
  };
}
