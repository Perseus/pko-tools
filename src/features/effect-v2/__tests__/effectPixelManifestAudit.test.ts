import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "../../../..");
const auditScript = join(repoRoot, "scripts/effect-pixel-manifest-audit.mjs");

describe("effect pixel manifest audit", () => {
  it("reports missing evidence and safe fill-in commands for draft capture cases", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-pixel-manifest-audit-"));
    try {
      const manifest = join(dir, "effect-pixel-corpus.json");
      writeFile(join(dir, "original-client/existing.bmp"), "bmp");
      writeFile(join(dir, "parsed/effect.json"), "{}");
      writeFile(join(dir, "parsed/textures.json"), "{}");
      writeFile(join(dir, "parsed/models.json"), "{}");
      writeFileSync(manifest, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "existing scene capture",
            source: "original-client/existing.bmp",
            candidate: "pko-tools/existing.bmp",
            sourceCapture: { effectId: 2, time: 0.5 },
            candidateCapture: {
              effectJson: "parsed/effect.json",
              textureBundle: "parsed/textures.json",
              modelBundle: "parsed/models.json",
              time: 0.5,
            },
            coverage: { effectFeatures: ["alpha"] },
          },
          {
            name: "missing magic capture",
            source: "original-client/missing-magic.bmp",
            candidate: "pko-tools/missing-magic.bmp",
            sourceCapture: {
              effectId: 1001,
              time: 0.25,
              start: [0, 0, 0],
              target: [0, 8, 1],
            },
            candidateCapture: {
              magicScenario: "parsed/missing-magic.json",
              time: 0.25,
            },
            coverage: { magicSingleRenderIdx: [0] },
          },
        ],
      }));

      const result = spawnSync(process.execPath, [
        auditScript,
        "--manifest",
        manifest,
        "--source-root",
        "E:/gamedev/mp-client-source-effect-capture",
        "--effect-corpus-root",
        "E:/gamedev/mp-client-source/Client/client/effect",
      ], { encoding: "utf8" });

      expect(result.status).toBe(1);
      const report = JSON.parse(result.stdout);
      expect(report.pass).toBe(false);
      expect(report.caseCount).toBe(2);
      expect(report.missing.sourceBmp).toBe(1);
      expect(report.missing.candidateInputs).toBe(1);
      expect(report.coverage.effectFeatures).toEqual(["alpha"]);
      expect(report.coverage.magicSingleRenderIdx).toEqual([0]);
      expect(report.missingCoverage.effectFeatures).toContain("transparentBlackAlpha");
      expect(report.missingCoverage.particleTypes).toContain(1);
      expect(report.missingCoverage.particleFeatures).toEqual(["characterModel"]);
      expect(report.missingCoverage.magicGroupRenderIdx).toEqual([0, 1]);
      expect(report.cases[0]).toMatchObject({
        name: "existing scene capture",
        captureMode: "scene-effect",
        sourceBmpExists: true,
        candidateInputExists: true,
      });
      expect(report.cases[1]).toMatchObject({
        name: "missing magic capture",
        captureMode: "magic",
        sourceBmpExists: false,
        candidateInputExists: false,
      });
      expect(report.cases[1].sourceDryRunCommand).toContain("pnpm capture:effect-source");
      expect(report.cases[1].sourceDryRunCommand).toContain("--missing-only");
      expect(report.cases[1].sourceLaunchCommand).toContain("pnpm capture:effect-source");
      expect(report.cases[1].sourceLaunchCommand).toContain("--case \"missing magic capture\"");
      expect(report.cases[1].sourceLaunchCommand).toContain("--missing-only --allow-launch");
      expect(report.cases[1].sourceLaunchCommand).not.toContain("--allow-bulk-launch");
      expect(report.cases[1].candidateCommand).toContain("pnpm capture:effect-tools");
      expect(report.cases[1].missingEvidence).toContain("sourceBmp");
      expect(report.cases[1].missingEvidence).toContain("candidateCapture.magicScenario");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ties magicTargetOrientation coverage to a magic scenario input", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-pixel-manifest-audit-"));
    try {
      const manifest = join(dir, "effect-pixel-corpus.json");
      writeFile(join(dir, "original-client/magic.bmp"), "bmp");
      writeFile(join(dir, "parsed/magic-scenario.json"), "{}");
      writeFileSync(manifest, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "magic target orientation",
            source: "original-client/magic.bmp",
            candidate: "pko-tools/magic.bmp",
            sourceCapture: {
              effectId: 1001,
              time: 0.5,
              start: [0, 0, 0],
              target: [0, 8, 1],
            },
            candidateCapture: {
              magicScenario: "parsed/magic-scenario.json",
              time: 0.5,
            },
            coverage: {
              effectFeatures: ["magicTargetOrientation"],
            },
          },
        ],
      }));

      const result = spawnSync(process.execPath, [
        auditScript,
        "--manifest",
        manifest,
      ], { encoding: "utf8" });

      const report = JSON.parse(result.stdout);
      expect(report.invalidMetadata).toEqual([]);
      expect(report.cases[0].missingEvidence).not.toContain("candidateCapture.effectJson");
      expect(report.cases[0].candidateInputExists).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails a file-complete manifest when required rendered coverage is still missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-pixel-manifest-audit-"));
    try {
      const manifest = join(dir, "effect-pixel-corpus.json");
      writeFile(join(dir, "original-client/effect.bmp"), "bmp");
      writeFile(join(dir, "parsed/effect.json"), "{}");
      writeFile(join(dir, "parsed/textures.json"), "{}");
      writeFile(join(dir, "parsed/models.json"), "{}");
      writeFileSync(manifest, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "only alpha coverage",
            source: "original-client/effect.bmp",
            candidate: "pko-tools/effect.bmp",
            sourceCapture: { effectId: 2, time: 0.5 },
            candidateCapture: {
              effectJson: "parsed/effect.json",
              textureBundle: "parsed/textures.json",
              modelBundle: "parsed/models.json",
              time: 0.5,
            },
            coverage: { effectFeatures: ["alpha"] },
          },
        ],
      }));

      const result = spawnSync(process.execPath, [
        auditScript,
        "--manifest",
        manifest,
      ], { encoding: "utf8" });

      expect(result.status).toBe(1);
      const report = JSON.parse(result.stdout);
      expect(report.pass).toBe(false);
      expect(report.filesComplete).toBe(true);
      expect(report.coverageComplete).toBe(false);
      expect(report.missingCoverage.particleTypes).toContain(1);
      expect(report.missingCoverage.particleFeatures).toContain("characterModel");
      expect(report.missingCoverage.magicSingleRenderIdx).toContain(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("labels direct particle source captures from sourceCapture.parName", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-pixel-manifest-audit-"));
    try {
      const manifest = join(dir, "effect-pixel-corpus.json");
      writeFile(join(dir, "original-client/particle.bmp"), "bmp");
      writeFile(join(dir, "pko-tools/particle.bmp"), "bmp");
      writeFileSync(manifest, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "direct particle",
            source: "original-client/particle.bmp",
            candidate: "pko-tools/particle.bmp",
            sourceCapture: { effectId: 3, parName: "00000001", time: 0.5 },
          },
        ],
      }));

      const output = spawnSync(process.execPath, [
        auditScript,
        "--manifest",
        manifest,
      ], { encoding: "utf8" });

      expect(output.status).toBe(1);
      const report = JSON.parse(output.stdout);
      expect(report.cases[0].captureMode).toBe("particle");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });


  it("fails manifests with unknown coverage labels or invalid source capture metadata", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-pixel-manifest-audit-"));
    try {
      const manifest = join(dir, "effect-pixel-corpus.json");
      writeFile(join(dir, "original-client/effect.bmp"), "bmp");
      writeFile(join(dir, "parsed/effect.json"), "{}");
      writeFile(join(dir, "parsed/textures.json"), "{}");
      writeFile(join(dir, "parsed/models.json"), "{}");
      writeFileSync(manifest, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "invalid metadata",
            source: "original-client/effect.bmp",
            candidate: "pko-tools/effect.bmp",
            sourceCapture: { effectId: 2, time: 0.5, start: [0, 0] },
            candidateCapture: {
              effectJson: "parsed/effect.json",
              textureBundle: "parsed/textures.json",
              modelBundle: "parsed/models.json",
              time: 0.5,
            },
            coverage: {
              effectFeatures: ["alphaTypo"],
              particleTypes: [19],
              particleFeatures: ["characterTypo"],
              magicSingleRenderIdx: [7],
            },
          },
        ],
      }));

      const result = spawnSync(process.execPath, [
        auditScript,
        "--manifest",
        manifest,
      ], { encoding: "utf8" });

      expect(result.status).toBe(1);
      const report = JSON.parse(result.stdout);
      expect(report.pass).toBe(false);
      expect(report.metadataValid).toBe(false);
      expect(report.invalidMetadata).toEqual([
        "Case 0 (invalid metadata) sourceCapture.start must be a 3-number array",
      ]);
      expect(report.unknownCoverage.effectFeatures).toEqual(["alphaTypo"]);
      expect(report.unknownCoverage.particleTypes).toEqual([19]);
      expect(report.unknownCoverage.particleFeatures).toEqual(["characterTypo"]);
      expect(report.unknownCoverage.magicSingleRenderIdx).toEqual([7]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails manifests with malformed candidate capture metadata without crashing", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-pixel-manifest-audit-"));
    try {
      const manifest = join(dir, "effect-pixel-corpus.json");
      writeFile(join(dir, "original-client/effect.bmp"), "bmp");
      writeFileSync(manifest, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "bad candidate capture",
            source: "original-client/effect.bmp",
            candidate: "pko-tools/effect.bmp",
            sourceCapture: { effectId: 2, time: 0.5 },
            candidateCapture: {
              effectJson: 123,
              time: "soon",
              width: "wide",
            },
            coverage: { effectFeatures: ["alpha"] },
          },
        ],
      }));

      const result = spawnSync(process.execPath, [
        auditScript,
        "--manifest",
        manifest,
      ], { encoding: "utf8" });

      expect(result.status).toBe(1);
      const report = JSON.parse(result.stdout);
      expect(report.pass).toBe(false);
      expect(report.metadataValid).toBe(false);
      expect(report.invalidMetadata).toEqual([
        "Case 0 (bad candidate capture) candidateCapture.effectJson must be a string",
        "Case 0 (bad candidate capture) candidateCapture.time must be numeric",
        "Case 0 (bad candidate capture) candidateCapture.width must be numeric",
      ]);
      expect(report.cases[0].missingEvidence).toContain("candidateCapture.effectJson");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails rendered coverage when candidate capture disables fail-on-skipped", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-pixel-manifest-audit-"));
    try {
      const manifest = join(dir, "effect-pixel-corpus.json");
      writeFile(join(dir, "original-client/particle.bmp"), "bmp");
      writeFile(join(dir, "parsed/particles.json"), "{}");
      writeFile(join(dir, "parsed/models.json"), "{}");
      writeFileSync(manifest, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "unsafe particle capture",
            source: "original-client/particle.bmp",
            candidate: "pko-tools/particle.bmp",
            sourceCapture: { effectId: 3, parName: "particles", time: 0.5 },
            candidateCapture: {
              parJson: "parsed/particles.json",
              modelBundle: "parsed/models.json",
              failOnSkipped: false,
            },
            coverage: { particleTypes: [5] },
          },
        ],
      }));

      const result = spawnSync(process.execPath, [
        auditScript,
        "--manifest",
        manifest,
      ], { encoding: "utf8" });

      expect(result.status).toBe(1);
      const report = JSON.parse(result.stdout);
      expect(report.pass).toBe(false);
      expect(report.metadataValid).toBe(false);
      expect(report.invalidMetadata).toEqual([
        "Case 0 (unsafe particle capture) candidateCapture.failOnSkipped cannot be false for rendered coverage",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails manifests with ambiguous candidate capture modes", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-pixel-manifest-audit-"));
    try {
      const manifest = join(dir, "effect-pixel-corpus.json");
      writeFile(join(dir, "original-client/effect.bmp"), "bmp");
      writeFile(join(dir, "parsed/effect.json"), "{}");
      writeFile(join(dir, "parsed/particles.json"), "{}");
      writeFileSync(manifest, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "ambiguous candidate capture",
            source: "original-client/effect.bmp",
            candidate: "pko-tools/effect.bmp",
            sourceCapture: { effectId: 2, time: 0.5 },
            candidateCapture: {
              effectJson: "parsed/effect.json",
              parJson: "parsed/particles.json",
            },
            coverage: { effectFeatures: ["alpha"] },
          },
        ],
      }));

      const result = spawnSync(process.execPath, [
        auditScript,
        "--manifest",
        manifest,
      ], { encoding: "utf8" });

      expect(result.status).toBe(1);
      const report = JSON.parse(result.stdout);
      expect(report.pass).toBe(false);
      expect(report.metadataValid).toBe(false);
      expect(report.invalidMetadata).toEqual([
        "Case 0 (ambiguous candidate capture) candidateCapture must include exactly one of effectJson, parJson, or magicScenario",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails when coverage requires candidate inputs that are absent from the manifest", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-pixel-manifest-audit-"));
    try {
      const manifest = join(dir, "effect-pixel-corpus.json");
      writeFile(join(dir, "original-client/effect.bmp"), "bmp");
      writeFile(join(dir, "original-client/particle.bmp"), "bmp");
      writeFile(join(dir, "original-client/magic.bmp"), "bmp");
      writeFileSync(manifest, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "texture external effect missing bundles",
            source: "original-client/effect.bmp",
            candidate: "pko-tools/effect.bmp",
            sourceCapture: { effectId: 2, time: 0.5 },
            candidateCapture: {},
            coverage: { effectFeatures: ["alpha", "externalLgo"] },
          },
          {
            name: "model backed particle missing par model",
            source: "original-client/particle.bmp",
            candidate: "pko-tools/particle.bmp",
            sourceCapture: { effectId: 3, time: 0.5 },
            candidateCapture: {},
            coverage: { particleTypes: [5] },
          },
          {
            name: "magic missing scenario",
            source: "original-client/magic.bmp",
            candidate: "pko-tools/magic.bmp",
            sourceCapture: { effectId: 1001, time: 0.5 },
            candidateCapture: {},
            coverage: { magicSingleRenderIdx: [0] },
          },
          {
            name: "character model particles missing par model",
            source: "original-client/character-model.bmp",
            candidate: "pko-tools/character-model.bmp",
            sourceCapture: { effectId: 4, time: 0.5 },
            candidateCapture: {},
            coverage: { particleFeatures: ["characterModel"] },
          },
        ],
      }));

      const result = spawnSync(process.execPath, [
        auditScript,
        "--manifest",
        manifest,
      ], { encoding: "utf8" });

      expect(result.status).toBe(1);
      const report = JSON.parse(result.stdout);
      expect(report.pass).toBe(false);
      expect(report.filesComplete).toBe(false);
      expect(report.cases[0].missingEvidence).toEqual([
        "candidateCapture.effectJson",
        "candidateCapture.textureBundle",
        "candidateCapture.modelBundle",
      ]);
      expect(report.cases[1].missingEvidence).toEqual([
        "candidateCapture.parJson",
        "candidateCapture.modelBundle",
      ]);
      expect(report.cases[2].missingEvidence).toEqual([
        "candidateCapture.magicScenario",
      ]);
      expect(report.cases[3].missingEvidence).toEqual([
        "sourceBmp",
        "candidateCapture.parJson",
        "candidateCapture.modelBundle",
      ]);
      expect(report.missing.candidateInputs).toBe(4);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects direct parJson candidates without explicit source particle capture metadata", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-pixel-manifest-audit-"));
    try {
      const manifest = join(dir, "effect-pixel-corpus.json");
      writeFile(join(dir, "original-client/range2.bmp"), "bmp");
      writeFile(join(dir, "parsed/range2.par.json"), "{}");
      writeFileSync(manifest, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "range2 direct particle",
            source: "original-client/range2.bmp",
            candidate: "pko-tools/range2.bmp",
            sourceCapture: {
              effectId: 6,
              time: 0.5,
            },
            candidateCapture: {
              parJson: "parsed/range2.par.json",
              time: 0.5,
            },
            coverage: { particleTypes: [15] },
          },
        ],
      }));

      const result = spawnSync(process.execPath, [
        auditScript,
        "--manifest",
        manifest,
      ], { encoding: "utf8" });

      expect(result.status).toBe(1);
      const report = JSON.parse(result.stdout);
      expect(report.pass).toBe(false);
      expect(report.metadataValid).toBe(false);
      expect(report.invalidMetadata).toEqual([
        "Case 0 (range2 direct particle) candidateCapture.parJson requires sourceCapture.parName so the original-client particle BMP is tied to the same .par file",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function writeFile(path: string, contents: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}
