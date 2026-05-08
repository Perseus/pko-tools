import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "../../../..");
const fullGateScript = join(repoRoot, "scripts/effect-parity-full-gate.mjs");

describe("effect parity full gate", () => {
  it("is exposed as a package script", () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));

    expect(pkg.scripts["test:effect-parity-full"]).toBe(
      "node scripts/effect-parity-full-gate.mjs",
    );
  });

  it("fails before running work when required trace and pixel evidence is missing", () => {
    const result = spawnSync(process.execPath, [fullGateScript], {
      cwd: repoRoot,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "",
        SystemRoot: process.env.SystemRoot ?? "",
      },
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("PKO_EFFECT_TRACE_CORPUS_DIR");
    expect(result.stderr).toContain("PKO_EFFECT_TRACE_SOURCE_DUMPER");
    expect(result.stderr).toContain("PKO_EFFECT_TRACE_TOOLS_DUMPER");
    expect(result.stderr).toContain("PKO_EFFECT_PIXEL_CORPUS_MANIFEST");
  });

  it("rejects a pixel manifest that does not declare full rendered coverage", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-full-gate-"));
    try {
      const effectDir = join(dir, "effect");
      const sourceDumper = join(dir, "source-dumper.exe");
      const toolsDumper = join(dir, "tools-dumper.exe");
      const manifest = join(dir, "manifest.json");
      mkdirSync(effectDir);
      writeFileSync(sourceDumper, "");
      writeFileSync(toolsDumper, "");
      writeFileSync(manifest, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "single smoke case is not enough",
            source: "source.bmp",
            candidate: "candidate.bmp",
          },
        ],
      }));

      const result = spawnSync(process.execPath, [fullGateScript, "--validate-only"], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          PATH: process.env.PATH ?? "",
          SystemRoot: process.env.SystemRoot ?? "",
          PKO_EFFECT_TRACE_CORPUS_DIR: effectDir,
          PKO_EFFECT_TRACE_SOURCE_DUMPER: sourceDumper,
          PKO_EFFECT_TRACE_TOOLS_DUMPER: toolsDumper,
          PKO_EFFECT_PIXEL_CORPUS_MANIFEST: manifest,
        },
      });

      expect(result.status).toBe(2);
      expect(result.stderr).toContain("coverage.effectFeatures");
      expect(result.stderr).toContain("coverage.particleTypes");
      expect(result.stderr).toContain("coverage.particleFeatures");
      expect(result.stderr).toContain("coverage.magicSingleRenderIdx");
      expect(result.stderr).toContain("coverage.magicGroupRenderIdx");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a manifest that declares full coverage only globally instead of on capture cases", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-full-gate-"));
    try {
      const effectDir = join(dir, "effect");
      const sourceDumper = join(dir, "source-dumper.exe");
      const toolsDumper = join(dir, "tools-dumper.exe");
      const manifest = join(dir, "manifest.json");
      mkdirSync(effectDir);
      writeFileSync(sourceDumper, "");
      writeFileSync(toolsDumper, "");
      writeFileSync(manifest, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        coverage: {
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
        },
        cases: [
          {
            name: "global coverage declaration is not rendered evidence",
            source: "source.bmp",
            candidate: "candidate.bmp",
          },
        ],
      }));

      const result = spawnSync(process.execPath, [fullGateScript, "--validate-only"], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          PATH: process.env.PATH ?? "",
          SystemRoot: process.env.SystemRoot ?? "",
          PKO_EFFECT_TRACE_CORPUS_DIR: effectDir,
          PKO_EFFECT_TRACE_SOURCE_DUMPER: sourceDumper,
          PKO_EFFECT_TRACE_TOOLS_DUMPER: toolsDumper,
          PKO_EFFECT_PIXEL_CORPUS_MANIFEST: manifest,
        },
      });

      expect(result.status).toBe(2);
      expect(result.stderr).toContain("case coverage");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects externalLgo case coverage without a model-bundle candidate capture", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-full-gate-"));
    try {
      const effectDir = join(dir, "effect");
      const sourceDumper = join(dir, "source-dumper.exe");
      const toolsDumper = join(dir, "tools-dumper.exe");
      const manifest = join(dir, "manifest.json");
      mkdirSync(effectDir);
      writeFileSync(sourceDumper, "");
      writeFileSync(toolsDumper, "");
      writeFileSync(manifest, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          ...fullCoverageCases({ includeExternalLgo: false }),
          {
            name: "external model without model bundle",
            source: "source-external.bmp",
            candidate: "candidate-external.bmp",
            candidateCapture: {
              effectJson: "parsed/external.json",
              time: 0,
              width: 512,
              height: 512,
            },
            coverage: {
              effectFeatures: ["externalLgo"],
            },
          },
        ],
      }));

      const result = spawnSync(process.execPath, [fullGateScript, "--validate-only"], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          PATH: process.env.PATH ?? "",
          SystemRoot: process.env.SystemRoot ?? "",
          PKO_EFFECT_TRACE_CORPUS_DIR: effectDir,
          PKO_EFFECT_TRACE_SOURCE_DUMPER: sourceDumper,
          PKO_EFFECT_TRACE_TOOLS_DUMPER: toolsDumper,
          PKO_EFFECT_PIXEL_CORPUS_MANIFEST: manifest,
        },
      });

      expect(result.status).toBe(2);
      expect(result.stderr).toContain("externalLgo");
      expect(result.stderr).toContain("candidateCapture.modelBundle");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects effect feature coverage without an effect candidate capture input", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-full-gate-"));
    try {
      const effectDir = join(dir, "effect");
      const sourceDumper = join(dir, "source-dumper.exe");
      const toolsDumper = join(dir, "tools-dumper.exe");
      const manifest = join(dir, "manifest.json");
      mkdirSync(effectDir);
      writeFileSync(sourceDumper, "");
      writeFileSync(toolsDumper, "");
      const cases = fullCoverageCases();
      delete (cases[0].candidateCapture as Record<string, unknown>).effectJson;
      writeFileSync(manifest, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases,
      }));

      const result = spawnSync(process.execPath, [fullGateScript, "--validate-only"], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          PATH: process.env.PATH ?? "",
          SystemRoot: process.env.SystemRoot ?? "",
          PKO_EFFECT_TRACE_CORPUS_DIR: effectDir,
          PKO_EFFECT_TRACE_SOURCE_DUMPER: sourceDumper,
          PKO_EFFECT_TRACE_TOOLS_DUMPER: toolsDumper,
          PKO_EFFECT_PIXEL_CORPUS_MANIFEST: manifest,
        },
      });

      expect(result.status).toBe(2);
      expect(result.stderr).toContain("effectFeatures");
      expect(result.stderr).toContain("candidateCapture.effectJson");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects texture-dependent effect feature coverage without a texture bundle", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-full-gate-"));
    try {
      const effectDir = join(dir, "effect");
      const sourceDumper = join(dir, "source-dumper.exe");
      const toolsDumper = join(dir, "tools-dumper.exe");
      const manifest = join(dir, "manifest.json");
      mkdirSync(effectDir);
      writeFileSync(sourceDumper, "");
      writeFileSync(toolsDumper, "");
      const cases = fullCoverageCases();
      delete (cases[0].candidateCapture as Record<string, unknown>).textureBundle;
      writeFileSync(manifest, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases,
      }));

      const result = spawnSync(process.execPath, [fullGateScript, "--validate-only"], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          PATH: process.env.PATH ?? "",
          SystemRoot: process.env.SystemRoot ?? "",
          PKO_EFFECT_TRACE_CORPUS_DIR: effectDir,
          PKO_EFFECT_TRACE_SOURCE_DUMPER: sourceDumper,
          PKO_EFFECT_TRACE_TOOLS_DUMPER: toolsDumper,
          PKO_EFFECT_PIXEL_CORPUS_MANIFEST: manifest,
        },
      });

      expect(result.status).toBe(2);
      expect(result.stderr).toContain("alpha");
      expect(result.stderr).toContain("candidateCapture.textureBundle");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects particle coverage without a particle candidate capture input", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-full-gate-"));
    try {
      const effectDir = join(dir, "effect");
      const sourceDumper = join(dir, "source-dumper.exe");
      const toolsDumper = join(dir, "tools-dumper.exe");
      const manifest = join(dir, "manifest.json");
      mkdirSync(effectDir);
      writeFileSync(sourceDumper, "");
      writeFileSync(toolsDumper, "");
      writeFileSync(manifest, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          ...fullCoverageCases({ includeParticles: false }),
          {
            name: "particle coverage without par input",
            source: "source-particle.bmp",
            candidate: "candidate-particle.bmp",
            coverage: {
              particleTypes: Array.from({ length: 18 }, (_, index) => index + 1),
            },
          },
        ],
      }));

      const result = spawnSync(process.execPath, [fullGateScript, "--validate-only"], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          PATH: process.env.PATH ?? "",
          SystemRoot: process.env.SystemRoot ?? "",
          PKO_EFFECT_TRACE_CORPUS_DIR: effectDir,
          PKO_EFFECT_TRACE_SOURCE_DUMPER: sourceDumper,
          PKO_EFFECT_TRACE_TOOLS_DUMPER: toolsDumper,
          PKO_EFFECT_PIXEL_CORPUS_MANIFEST: manifest,
        },
      });

      expect(result.status).toBe(2);
      expect(result.stderr).toContain("particleTypes");
      expect(result.stderr).toContain("candidateCapture.parJson");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects model-backed particle coverage without a model bundle", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-full-gate-"));
    try {
      const effectDir = join(dir, "effect");
      const sourceDumper = join(dir, "source-dumper.exe");
      const toolsDumper = join(dir, "tools-dumper.exe");
      const manifest = join(dir, "manifest.json");
      mkdirSync(effectDir);
      writeFileSync(sourceDumper, "");
      writeFileSync(toolsDumper, "");
      const cases = fullCoverageCases();
      delete (cases[1].candidateCapture as Record<string, unknown>).modelBundle;
      writeFileSync(manifest, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases,
      }));

      const result = spawnSync(process.execPath, [fullGateScript, "--validate-only"], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          PATH: process.env.PATH ?? "",
          SystemRoot: process.env.SystemRoot ?? "",
          PKO_EFFECT_TRACE_CORPUS_DIR: effectDir,
          PKO_EFFECT_TRACE_SOURCE_DUMPER: sourceDumper,
          PKO_EFFECT_TRACE_TOOLS_DUMPER: toolsDumper,
          PKO_EFFECT_PIXEL_CORPUS_MANIFEST: manifest,
        },
      });

      expect(result.status).toBe(2);
      expect(result.stderr).toContain("particle type 3");
      expect(result.stderr).toContain("candidateCapture.modelBundle");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects a manifest that omits version-8 character model particle coverage", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-full-gate-"));
    try {
      const effectDir = join(dir, "effect");
      const sourceDumper = join(dir, "source-dumper.exe");
      const toolsDumper = join(dir, "tools-dumper.exe");
      const manifest = join(dir, "manifest.json");
      mkdirSync(effectDir);
      writeFileSync(sourceDumper, "");
      writeFileSync(toolsDumper, "");
      const cases = fullCoverageCases({ includeCharacterModelParticles: false });
      writeFullCoverageEvidence(dir, cases);
      writeFileSync(manifest, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases,
      }));

      const result = spawnSync(process.execPath, [fullGateScript, "--validate-only"], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          PATH: process.env.PATH ?? "",
          SystemRoot: process.env.SystemRoot ?? "",
          PKO_EFFECT_TRACE_CORPUS_DIR: effectDir,
          PKO_EFFECT_TRACE_SOURCE_DUMPER: sourceDumper,
          PKO_EFFECT_TRACE_TOOLS_DUMPER: toolsDumper,
          PKO_EFFECT_PIXEL_CORPUS_MANIFEST: manifest,
        },
      });

      expect(result.status).toBe(2);
      expect(result.stderr).toContain("coverage.particleFeatures");
      expect(result.stderr).toContain("characterModel");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects character model particle coverage without par and model bundle inputs", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-full-gate-"));
    try {
      const effectDir = join(dir, "effect");
      const sourceDumper = join(dir, "source-dumper.exe");
      const toolsDumper = join(dir, "tools-dumper.exe");
      const manifest = join(dir, "manifest.json");
      mkdirSync(effectDir);
      writeFileSync(sourceDumper, "");
      writeFileSync(toolsDumper, "");
      writeFileSync(manifest, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          ...fullCoverageCases({ includeCharacterModelParticles: false }),
          {
            name: "character model particle without inputs",
            source: "source-character-model.bmp",
            candidate: "candidate-character-model.bmp",
            sourceCapture: {
              effectId: 3,
              time: 0.5,
            },
            candidateCapture: {},
            coverage: {
              particleFeatures: ["characterModel"],
            },
          },
        ],
      }));

      const result = spawnSync(process.execPath, [fullGateScript, "--validate-only"], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          PATH: process.env.PATH ?? "",
          SystemRoot: process.env.SystemRoot ?? "",
          PKO_EFFECT_TRACE_CORPUS_DIR: effectDir,
          PKO_EFFECT_TRACE_SOURCE_DUMPER: sourceDumper,
          PKO_EFFECT_TRACE_TOOLS_DUMPER: toolsDumper,
          PKO_EFFECT_PIXEL_CORPUS_MANIFEST: manifest,
        },
      });

      expect(result.status).toBe(2);
      expect(result.stderr).toContain("particleFeatures");
      expect(result.stderr).toContain("candidateCapture.parJson");
      expect(result.stderr).toContain("candidateCapture.modelBundle");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects magic coverage without a magic candidate capture scenario", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-full-gate-"));
    try {
      const effectDir = join(dir, "effect");
      const sourceDumper = join(dir, "source-dumper.exe");
      const toolsDumper = join(dir, "tools-dumper.exe");
      const manifest = join(dir, "manifest.json");
      mkdirSync(effectDir);
      writeFileSync(sourceDumper, "");
      writeFileSync(toolsDumper, "");
      writeFileSync(manifest, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          ...fullCoverageCases({ includeMagic: false }),
          {
            name: "magic coverage without scenario",
            source: "source-magic.bmp",
            candidate: "candidate-magic.bmp",
            coverage: {
              magicSingleRenderIdx: [0, 2, 3, 4, 5, 6],
              magicGroupRenderIdx: [0, 1],
            },
          },
        ],
      }));

      const result = spawnSync(process.execPath, [fullGateScript, "--validate-only"], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          PATH: process.env.PATH ?? "",
          SystemRoot: process.env.SystemRoot ?? "",
          PKO_EFFECT_TRACE_CORPUS_DIR: effectDir,
          PKO_EFFECT_TRACE_SOURCE_DUMPER: sourceDumper,
          PKO_EFFECT_TRACE_TOOLS_DUMPER: toolsDumper,
          PKO_EFFECT_PIXEL_CORPUS_MANIFEST: manifest,
        },
      });

      expect(result.status).toBe(2);
      expect(result.stderr).toContain("magic");
      expect(result.stderr).toContain("candidateCapture.magicScenario");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects rendered coverage without source capture reproduction metadata", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-full-gate-"));
    try {
      const effectDir = join(dir, "effect");
      const sourceDumper = join(dir, "source-dumper.exe");
      const toolsDumper = join(dir, "tools-dumper.exe");
      const manifest = join(dir, "manifest.json");
      mkdirSync(effectDir);
      writeFileSync(sourceDumper, "");
      writeFileSync(toolsDumper, "");
      const cases = fullCoverageCases();
      delete cases[0].sourceCapture;
      writeFileSync(manifest, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases,
      }));

      const result = spawnSync(process.execPath, [fullGateScript, "--validate-only"], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          PATH: process.env.PATH ?? "",
          SystemRoot: process.env.SystemRoot ?? "",
          PKO_EFFECT_TRACE_CORPUS_DIR: effectDir,
          PKO_EFFECT_TRACE_SOURCE_DUMPER: sourceDumper,
          PKO_EFFECT_TRACE_TOOLS_DUMPER: toolsDumper,
          PKO_EFFECT_PIXEL_CORPUS_MANIFEST: manifest,
        },
      });

      expect(result.status).toBe(2);
      expect(result.stderr).toContain("sourceCapture");
      expect(result.stderr).toContain("effect feature coverage");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects rendered coverage when the original-client source BMP is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-full-gate-"));
    try {
      const effectDir = join(dir, "effect");
      const sourceDumper = join(dir, "source-dumper.exe");
      const toolsDumper = join(dir, "tools-dumper.exe");
      const manifest = join(dir, "manifest.json");
      mkdirSync(effectDir);
      writeFileSync(sourceDumper, "");
      writeFileSync(toolsDumper, "");
      const cases = fullCoverageCases();
      writeFullCoverageEvidence(dir, cases, { skipSources: ["source-effect.bmp"] });
      writeFileSync(manifest, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases,
      }));

      const result = spawnSync(process.execPath, [fullGateScript, "--validate-only"], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          PATH: process.env.PATH ?? "",
          SystemRoot: process.env.SystemRoot ?? "",
          PKO_EFFECT_TRACE_CORPUS_DIR: effectDir,
          PKO_EFFECT_TRACE_SOURCE_DUMPER: sourceDumper,
          PKO_EFFECT_TRACE_TOOLS_DUMPER: toolsDumper,
          PKO_EFFECT_PIXEL_CORPUS_MANIFEST: manifest,
        },
      });

      expect(result.status).toBe(2);
      expect(result.stderr).toContain("original-client source BMP");
      expect(result.stderr).toContain("source-effect.bmp");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects rendered coverage when candidate capture input files are missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-full-gate-"));
    try {
      const effectDir = join(dir, "effect");
      const sourceDumper = join(dir, "source-dumper.exe");
      const toolsDumper = join(dir, "tools-dumper.exe");
      const manifest = join(dir, "manifest.json");
      mkdirSync(effectDir);
      writeFileSync(sourceDumper, "");
      writeFileSync(toolsDumper, "");
      const cases = fullCoverageCases();
      writeFullCoverageEvidence(dir, cases, { skipCandidateInputs: ["parsed/effect.json"] });
      writeFileSync(manifest, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases,
      }));

      const result = spawnSync(process.execPath, [fullGateScript, "--validate-only"], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          PATH: process.env.PATH ?? "",
          SystemRoot: process.env.SystemRoot ?? "",
          PKO_EFFECT_TRACE_CORPUS_DIR: effectDir,
          PKO_EFFECT_TRACE_SOURCE_DUMPER: sourceDumper,
          PKO_EFFECT_TRACE_TOOLS_DUMPER: toolsDumper,
          PKO_EFFECT_PIXEL_CORPUS_MANIFEST: manifest,
        },
      });

      expect(result.status).toBe(2);
      expect(result.stderr).toContain("candidateCapture.effectJson");
      expect(result.stderr).toContain("parsed/effect.json");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects rendered coverage when candidate capture disables fail-on-skipped", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-full-gate-"));
    try {
      const effectDir = join(dir, "effect");
      const sourceDumper = join(dir, "source-dumper.exe");
      const toolsDumper = join(dir, "tools-dumper.exe");
      const manifest = join(dir, "manifest.json");
      mkdirSync(effectDir);
      writeFileSync(sourceDumper, "");
      writeFileSync(toolsDumper, "");
      const cases = fullCoverageCases();
      (cases[1].candidateCapture as Record<string, unknown>).failOnSkipped = false;
      writeFullCoverageEvidence(dir, cases);
      writeFileSync(manifest, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases,
      }));

      const result = spawnSync(process.execPath, [fullGateScript, "--validate-only"], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          PATH: process.env.PATH ?? "",
          SystemRoot: process.env.SystemRoot ?? "",
          PKO_EFFECT_TRACE_CORPUS_DIR: effectDir,
          PKO_EFFECT_TRACE_SOURCE_DUMPER: sourceDumper,
          PKO_EFFECT_TRACE_TOOLS_DUMPER: toolsDumper,
          PKO_EFFECT_PIXEL_CORPUS_MANIFEST: manifest,
        },
      });

      expect(result.status).toBe(2);
      expect(result.stderr).toContain("failOnSkipped");
      expect(result.stderr).toContain("particle type coverage");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects rendered coverage with ambiguous candidate capture modes", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-full-gate-"));
    try {
      const effectDir = join(dir, "effect");
      const sourceDumper = join(dir, "source-dumper.exe");
      const toolsDumper = join(dir, "tools-dumper.exe");
      const manifest = join(dir, "manifest.json");
      mkdirSync(effectDir);
      writeFileSync(sourceDumper, "");
      writeFileSync(toolsDumper, "");
      const cases = fullCoverageCases();
      (cases[0].candidateCapture as Record<string, unknown>).parJson = "parsed/also-particles.json";
      writeFullCoverageEvidence(dir, cases);
      writeFileSync(manifest, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases,
      }));

      const result = spawnSync(process.execPath, [fullGateScript, "--validate-only"], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          PATH: process.env.PATH ?? "",
          SystemRoot: process.env.SystemRoot ?? "",
          PKO_EFFECT_TRACE_CORPUS_DIR: effectDir,
          PKO_EFFECT_TRACE_SOURCE_DUMPER: sourceDumper,
          PKO_EFFECT_TRACE_TOOLS_DUMPER: toolsDumper,
          PKO_EFFECT_PIXEL_CORPUS_MANIFEST: manifest,
        },
      });

      expect(result.status).toBe(2);
      expect(result.stderr).toContain("exactly one");
      expect(result.stderr).toContain("effectJson, parJson, or magicScenario");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects direct particle coverage without source particle capture metadata", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-full-gate-"));
    try {
      const effectDir = join(dir, "effect");
      const sourceDumper = join(dir, "source-dumper.exe");
      const toolsDumper = join(dir, "tools-dumper.exe");
      const manifest = join(dir, "manifest.json");
      mkdirSync(effectDir);
      writeFileSync(sourceDumper, "");
      writeFileSync(toolsDumper, "");
      const cases = fullCoverageCases();
      delete (cases[1].sourceCapture as Record<string, unknown>).parName;
      writeFullCoverageEvidence(dir, cases);
      writeFileSync(manifest, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases,
      }));

      const result = spawnSync(process.execPath, [fullGateScript, "--validate-only"], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          PATH: process.env.PATH ?? "",
          SystemRoot: process.env.SystemRoot ?? "",
          PKO_EFFECT_TRACE_CORPUS_DIR: effectDir,
          PKO_EFFECT_TRACE_SOURCE_DUMPER: sourceDumper,
          PKO_EFFECT_TRACE_TOOLS_DUMPER: toolsDumper,
          PKO_EFFECT_PIXEL_CORPUS_MANIFEST: manifest,
        },
      });

      expect(result.status).toBe(2);
      expect(result.stderr).toContain("candidateCapture.parJson requires sourceCapture.parName");
      expect(result.stderr).toContain("particle type coverage");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects unknown or unsupported rendered coverage labels", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-full-gate-"));
    try {
      const effectDir = join(dir, "effect");
      const sourceDumper = join(dir, "source-dumper.exe");
      const toolsDumper = join(dir, "tools-dumper.exe");
      const manifest = join(dir, "manifest.json");
      mkdirSync(effectDir);
      writeFileSync(sourceDumper, "");
      writeFileSync(toolsDumper, "");
      const cases = fullCoverageCases();
      (cases[0].coverage as { effectFeatures: string[] }).effectFeatures.push("alphaTypo");
      (cases[1].coverage as { particleTypes: number[] }).particleTypes.push(19);
      (cases[3].coverage as { particleFeatures: string[] }).particleFeatures.push("characterTypo");
      (cases[2].coverage as { magicSingleRenderIdx: number[] }).magicSingleRenderIdx.push(7);
      writeFullCoverageEvidence(dir, cases);
      writeFileSync(manifest, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases,
      }));

      const result = spawnSync(process.execPath, [fullGateScript, "--validate-only"], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          PATH: process.env.PATH ?? "",
          SystemRoot: process.env.SystemRoot ?? "",
          PKO_EFFECT_TRACE_CORPUS_DIR: effectDir,
          PKO_EFFECT_TRACE_SOURCE_DUMPER: sourceDumper,
          PKO_EFFECT_TRACE_TOOLS_DUMPER: toolsDumper,
          PKO_EFFECT_PIXEL_CORPUS_MANIFEST: manifest,
        },
      });

      expect(result.status).toBe(2);
      expect(result.stderr).toContain("Unknown coverage.effectFeatures: alphaTypo");
      expect(result.stderr).toContain("Unknown coverage.particleTypes: 19");
      expect(result.stderr).toContain("Unknown coverage.particleFeatures: characterTypo");
      expect(result.stderr).toContain("Unknown coverage.magicSingleRenderIdx: 7");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("accepts a case-coverage-complete manifest in validate-only mode", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-full-gate-"));
    try {
      const effectDir = join(dir, "effect");
      const sourceDumper = join(dir, "source-dumper.exe");
      const toolsDumper = join(dir, "tools-dumper.exe");
      const manifest = join(dir, "manifest.json");
      mkdirSync(effectDir);
      writeFileSync(sourceDumper, "");
      writeFileSync(toolsDumper, "");
      const cases = fullCoverageCases();
      writeFullCoverageEvidence(dir, cases);
      writeFileSync(manifest, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases,
      }));

      const result = spawnSync(process.execPath, [fullGateScript, "--validate-only"], {
        cwd: repoRoot,
        encoding: "utf8",
        env: {
          PATH: process.env.PATH ?? "",
          SystemRoot: process.env.SystemRoot ?? "",
          PKO_EFFECT_TRACE_CORPUS_DIR: effectDir,
          PKO_EFFECT_TRACE_SOURCE_DUMPER: sourceDumper,
          PKO_EFFECT_TRACE_TOOLS_DUMPER: toolsDumper,
          PKO_EFFECT_PIXEL_CORPUS_MANIFEST: manifest,
        },
      });

      expect(result.status).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(report.pass).toBe(true);
      expect(report.coverage.particleTypes).toHaveLength(18);
      expect(report.coverage.particleFeatures).toEqual(["characterModel"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function fullCoverageCases({
  includeExternalLgo = true,
  includeParticles = true,
  includeCharacterModelParticles = true,
  includeMagic = true,
} = {}) {
  const effectFeatures = [
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
    "useParam",
    "groupRotation",
  ];
  if (includeExternalLgo) {
    effectFeatures.push("externalLgo");
  }

  const cases: Array<Record<string, unknown>> = [
    {
      name: "effect feature coverage",
      source: "source-effect.bmp",
      candidate: "candidate-effect.bmp",
      sourceCapture: {
        effectId: 1,
        time: 0.5,
      },
      candidateCapture: {
        effectJson: "parsed/effect.json",
        textureBundle: "parsed/effect-textures.json",
        modelBundle: "parsed/effect-models.json",
        time: 0.5,
        width: 512,
        height: 512,
      },
      coverage: {
        effectFeatures,
      },
    },
  ];

  if (includeParticles) {
    cases.push({
      name: "particle type coverage",
      source: "source-particle.bmp",
      candidate: "candidate-particle.bmp",
      sourceCapture: {
        effectId: 2,
        parName: "particles",
        time: 0.5,
      },
      candidateCapture: {
        parJson: "parsed/particles.json",
        textureBundle: "parsed/particle-textures.json",
        modelBundle: "parsed/particle-models.json",
        time: 0.5,
        width: 512,
        height: 512,
      },
      coverage: {
        particleTypes: Array.from({ length: 18 }, (_, index) => index + 1),
      },
    });
  }

  if (includeMagic) {
    cases.push({
      name: "magic render coverage",
      source: "source-magic.bmp",
      candidate: "candidate-magic.bmp",
      sourceCapture: {
        effectId: 1001,
        time: 0.5,
        start: [0, 0, 0],
        target: [0, 8, 1],
      },
      candidateCapture: {
        magicScenario: "parsed/magic-scenario.json",
        textureBundle: "parsed/magic-textures.json",
        modelBundle: "parsed/magic-models.json",
        time: 0.5,
        width: 512,
        height: 512,
      },
      coverage: {
        effectFeatures: ["magicTargetOrientation"],
        magicSingleRenderIdx: [0, 2, 3, 4, 5, 6],
        magicGroupRenderIdx: [0, 1],
      },
    });
  }

  if (includeCharacterModelParticles) {
    cases.push({
      name: "character model particle coverage",
      source: "source-character-model.bmp",
      candidate: "candidate-character-model.bmp",
      sourceCapture: {
        effectId: 3,
        parName: "character-model-particles",
        time: 0.5,
      },
      candidateCapture: {
        parJson: "parsed/character-model-particles.json",
        modelBundle: "parsed/character-models.json",
        time: 0.5,
        width: 512,
        height: 512,
      },
      coverage: {
        particleFeatures: ["characterModel"],
      },
    });
  }

  return cases;
}

function writeFullCoverageEvidence(
  root: string,
  cases: Array<Record<string, unknown>>,
  options: {
    skipSources?: string[];
    skipCandidateInputs?: string[];
  } = {},
) {
  const skipSources = new Set(options.skipSources ?? []);
  const skipCandidateInputs = new Set(options.skipCandidateInputs ?? []);
  for (const testCase of cases) {
    const source = testCase.source;
    if (typeof source === "string" && !skipSources.has(source)) {
      writeEvidenceFile(join(root, source));
    }

    const candidateCapture = testCase.candidateCapture as Record<string, unknown> | undefined;
    for (const field of [
      "effectJson",
      "parJson",
      "magicScenario",
      "textureBundle",
      "modelBundle",
    ]) {
      const value = candidateCapture?.[field];
      if (typeof value === "string" && !skipCandidateInputs.has(value)) {
        writeEvidenceFile(join(root, value));
      }
    }
  }
}

function writeEvidenceFile(path: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, "");
}
