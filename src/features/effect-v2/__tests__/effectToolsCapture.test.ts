import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { EffectFile } from "@/types/effect";
import type { ParChaModel, ParFile, ParSystem } from "@/types/effect-v2";

const repoRoot = resolve(__dirname, "../../../..");
const captureScript = join(repoRoot, "scripts/effect-tools-capture.mjs");

describe("pko-tools effect capture CLI", () => {
  it("renders a parsed effect JSON to a BMP candidate image", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-tools-capture-"));
    try {
      const effectPath = join(dir, "effect.json");
      const outPath = join(dir, "candidate.bmp");
      writeFileSync(effectPath, JSON.stringify(effectFixture()));

      execFileSync(process.execPath, [
        captureScript,
        "--effect-json",
        effectPath,
        "--out",
        outPath,
        "--time",
        "0.01",
        "--width",
        "32",
        "--height",
        "32",
      ], { cwd: repoRoot, encoding: "utf8" });

      const bmp = readFileSync(outPath);
      expect(bmp.subarray(0, 2).toString("ascii")).toBe("BM");
      expect(bmp.readInt32LE(18)).toBe(32);
      expect(bmp.readInt32LE(22)).toBe(32);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders a magic scenario to a BMP candidate image", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-tools-capture-"));
    try {
      const scenarioPath = join(dir, "magic-scenario.json");
      const outPath = join(dir, "candidate.bmp");
      writeFileSync(scenarioPath, JSON.stringify(magicScenarioFixture()));

      const stdout = execFileSync(process.execPath, [
        captureScript,
        "--magic-scenario",
        scenarioPath,
        "--out",
        outPath,
        "--time",
        "0",
        "--width",
        "32",
        "--height",
        "32",
      ], { cwd: repoRoot, encoding: "utf8" });

      const report = JSON.parse(stdout);
      expect(report.renderedMagicEffects).toBe(1);
      expect(report.skippedMagicEffects).toEqual([]);

      const bmp = readFileSync(outPath);
      expect(bmp.subarray(0, 2).toString("ascii")).toBe("BM");
      expect(bmp.readInt32LE(18)).toBe(32);
      expect(bmp.readInt32LE(22)).toBe(32);
      expect(readBmp24Pixel(bmp, 32, 16, 16)).toEqual([255, 0, 0]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders a magic scenario hit particle effect at the arrival transform", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-tools-capture-"));
    try {
      const scenarioPath = join(dir, "magic-scenario.json");
      const outPath = join(dir, "candidate.bmp");
      writeFileSync(scenarioPath, JSON.stringify({
        ...magicScenarioFixture(),
        renderPhase: "hit",
        magicEntry: {
          ...magicScenarioFixture().magicEntry,
          result_effect: "hit.par",
        },
        origin: [0, -1, 0],
        target: [0, 0, 0],
        particleEffects: [
          {
            name: "hit.par",
            par: parFixture({
              systems: [
                particleSystemFixture({
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
              ],
            }),
          },
        ],
      }));

      const stdout = execFileSync(process.execPath, [
        captureScript,
        "--magic-scenario",
        scenarioPath,
        "--out",
        outPath,
        "--time",
        "1",
        "--width",
        "32",
        "--height",
        "32",
      ], { cwd: repoRoot, encoding: "utf8" });

      const report = JSON.parse(stdout);
      expect(report.renderedMagicEffects).toBe(0);
      expect(report.renderedMagicParticleEffects).toBe(1);
      expect(report.skippedMagicParticleEffects).toEqual([]);

      const bmp = readFileSync(outPath);
      expect(readBmp24Pixel(bmp, 32, 16, 16)).toEqual([0, 255, 0]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("orients magic hit modelDir particle captures from the arrival direction", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-tools-capture-"));
    try {
      const scenarioPath = join(dir, "magic-scenario.json");
      const modelBundlePath = join(dir, "models.json");
      const outPath = join(dir, "candidate.bmp");
      writeFileSync(modelBundlePath, JSON.stringify(asymmetricModelBundleFixture("arrow")));
      writeFileSync(scenarioPath, JSON.stringify({
        ...magicScenarioFixture(),
        renderPhase: "hit",
        magicEntry: {
          ...magicScenarioFixture().magicEntry,
          result_effect: "hit.par",
          render_idx: 1,
          velocity: 10,
        },
        origin: [-1, 0, 0],
        target: [0, 0, 0],
        particleEffects: [
          {
            name: "hit.par",
            par: parFixture({
              systems: [
                particleSystemFixture({
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
              ],
            }),
          },
        ],
      }));

      execFileSync(process.execPath, [
        captureScript,
        "--magic-scenario",
        scenarioPath,
        "--model-bundle",
        modelBundlePath,
        "--out",
        outPath,
        "--time",
        "1",
        "--width",
        "32",
        "--height",
        "32",
      ], { cwd: repoRoot, encoding: "utf8" });

      const bmp = readFileSync(outPath);
      expect(readBmp24Pixel(bmp, 32, 23, 16)).toEqual([0, 0, 0]);
      expect(readBmp24Pixel(bmp, 32, 16, 8)).toEqual([255, 255, 255]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders magic scenario in-flight particle effects under the flight transform", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-tools-capture-"));
    try {
      const scenarioPath = join(dir, "magic-scenario.json");
      const outPath = join(dir, "candidate.bmp");
      const base = magicScenarioFixture();
      writeFileSync(scenarioPath, JSON.stringify({
        ...base,
        effects: [],
        magicEntry: {
          ...base.magicEntry,
          models: [],
          particles: ["trail.par"],
          render_idx: 1,
        },
        origin: [0, 0, 0],
        target: [0, 1, 0],
        particleEffects: [
          {
            name: "trail.par",
            par: parFixture({
              systems: [
                particleSystemFixture({
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
              ],
            }),
          },
        ],
      }));

      const stdout = execFileSync(process.execPath, [
        captureScript,
        "--magic-scenario",
        scenarioPath,
        "--out",
        outPath,
        "--time",
        "0.01",
        "--width",
        "32",
        "--height",
        "32",
      ], { cwd: repoRoot, encoding: "utf8" });

      const report = JSON.parse(stdout);
      expect(report.renderedMagicEffects).toBe(0);
      expect(report.skippedMagicEffects).toEqual([]);
      expect(report.renderedMagicParticleEffects).toBe(1);
      expect(report.skippedMagicParticleEffects).toEqual([]);

      const bmp = readFileSync(outPath);
      expect(readBmp24Pixel(bmp, 32, 16, 16)).toEqual([0, 255, 0]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails on skipped magic in-flight particle effects when requested", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-tools-capture-"));
    try {
      const scenarioPath = join(dir, "magic-scenario.json");
      const outPath = join(dir, "candidate.bmp");
      const base = magicScenarioFixture();
      writeFileSync(scenarioPath, JSON.stringify({
        ...base,
        effects: [],
        magicEntry: {
          ...base.magicEntry,
          models: [],
          particles: ["missing-trail.par"],
          render_idx: 1,
        },
        origin: [0, 0, 0],
        target: [0, 1, 0],
        particleEffects: [],
      }));

      const result = spawnSync(process.execPath, [
        captureScript,
        "--magic-scenario",
        scenarioPath,
        "--out",
        outPath,
        "--time",
        "0.01",
        "--width",
        "32",
        "--height",
        "32",
        "--fail-on-skipped",
      ], { cwd: repoRoot, encoding: "utf8" });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("skippedMagicParticleEffects");
      expect(result.stderr).toContain("missing-magic-particle-effect");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("applies texture bundle pixels while rendering a candidate image", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-tools-capture-"));
    try {
      const effectPath = join(dir, "effect.json");
      const texturePath = join(dir, "textures.json");
      const outPath = join(dir, "candidate.bmp");
      const effect = effectFixture();
      effect.subEffects[0].texName = "green";
      effect.subEffects[0].frameColors = [[1, 1, 1, 1]];
      writeFileSync(effectPath, JSON.stringify(effect));
      writeFileSync(texturePath, JSON.stringify({
        textures: {
          green: {
            width: 1,
            height: 1,
            rgba: Buffer.from([0, 255, 0, 255]).toString("base64"),
          },
        },
      }));

      execFileSync(process.execPath, [
        captureScript,
        "--effect-json",
        effectPath,
        "--texture-bundle",
        texturePath,
        "--out",
        outPath,
        "--time",
        "0",
        "--width",
        "32",
        "--height",
        "32",
      ], { cwd: repoRoot, encoding: "utf8" });

      const bmp = readFileSync(outPath);
      const center = readBmp24Pixel(bmp, 32, 16, 16);
      expect(center).toEqual([0, 255, 0]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("preserves low effect texture alpha in candidate captures", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-tools-capture-"));
    try {
      const effectPath = join(dir, "effect.json");
      const texturePath = join(dir, "textures.json");
      const outPath = join(dir, "candidate.bmp");
      const effect = effectFixture();
      effect.subEffects[0].texName = "low-alpha-red";
      effect.subEffects[0].srcBlend = 5;
      effect.subEffects[0].destBlend = 6;
      effect.subEffects[0].frameColors = [[1, 1, 1, 1]];
      writeFileSync(effectPath, JSON.stringify(effect));
      writeFileSync(texturePath, JSON.stringify({
        textures: {
          "low-alpha-red": {
            width: 1,
            height: 1,
            rgba: Buffer.from([255, 0, 0, 15]).toString("base64"),
          },
        },
      }));

      execFileSync(process.execPath, [
        captureScript,
        "--effect-json",
        effectPath,
        "--texture-bundle",
        texturePath,
        "--out",
        outPath,
        "--time",
        "0",
        "--width",
        "32",
        "--height",
        "32",
      ], { cwd: repoRoot, encoding: "utf8" });

      const bmp = readFileSync(outPath);
      const center = readBmp24Pixel(bmp, 32, 16, 16);
      expect(center[0]).toBeGreaterThan(0);
      expect(center[0]).toBeLessThan(32);
      expect(center[1]).toBe(0);
      expect(center[2]).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("preserves low particle texture alpha in candidate captures", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-tools-capture-"));
    try {
      const parPath = join(dir, "particles.json");
      const texturePath = join(dir, "textures.json");
      const modelBundlePath = join(dir, "models.json");
      const outPath = join(dir, "candidate.bmp");
      writeFileSync(parPath, JSON.stringify(parFixture({
        systems: [
          particleSystemFixture({
            type: 5,
            name: "low-alpha-particle",
            particleCount: 1,
            modelName: "weapon.lgo",
            textureName: "low-alpha",
            frameSizes: [1],
            frameColors: [[1, 1, 1, 1]],
            offset: [0, 0, 0],
            srcBlend: 5,
            destBlend: 2,
          }),
        ],
      })));
      writeFileSync(modelBundlePath, JSON.stringify(modelBundleFixture("weapon.lgo")));
      writeFileSync(texturePath, JSON.stringify({
        textures: {
          "low-alpha": {
            width: 1,
            height: 1,
            rgba: Buffer.from([255, 0, 0, 15]).toString("base64"),
          },
        },
      }));

      execFileSync(process.execPath, [
        captureScript,
        "--par-json",
        parPath,
        "--texture-bundle",
        texturePath,
        "--model-bundle",
        modelBundlePath,
        "--out",
        outPath,
        "--time",
        "0",
        "--width",
        "32",
        "--height",
        "32",
        "--fail-on-skipped",
      ], { cwd: repoRoot, encoding: "utf8" });

      const bmp = readFileSync(outPath);
      const center = readBmp24Pixel(bmp, 32, 16, 16);
      expect(center[0]).toBeGreaterThan(0);
      expect(center[0]).toBeLessThan(32);
      expect(center[1]).toBe(0);
      expect(center[2]).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders bundled external .lgo model geometry instead of skipping it", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-tools-capture-"));
    try {
      const effectPath = join(dir, "effect.json");
      const modelBundlePath = join(dir, "models.json");
      const outPath = join(dir, "candidate.bmp");
      const effect = effectFixture();
      effect.subEffects[0].modelName = "weapon.lgo";
      effect.subEffects[0].frameColors = [[0, 0, 1, 1]];
      writeFileSync(effectPath, JSON.stringify(effect));
      writeFileSync(modelBundlePath, JSON.stringify(modelBundleFixture("weapon.lgo")));

      const stdout = execFileSync(process.execPath, [
        captureScript,
        "--effect-json",
        effectPath,
        "--model-bundle",
        modelBundlePath,
        "--out",
        outPath,
        "--time",
        "0",
        "--width",
        "32",
        "--height",
        "32",
      ], { cwd: repoRoot, encoding: "utf8" });

      const report = JSON.parse(stdout);
      expect(report.renderedSubEffects).toBe(1);
      expect(report.skippedSubEffects).toEqual([]);

      const bmp = readFileSync(outPath);
      expect(bmp.subarray(0, 2).toString("ascii")).toBe("BM");
      expect(readBmp24Pixel(bmp, 32, 16, 16)).toEqual([0, 0, 255]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("can fail a capture when required external model geometry is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-tools-capture-"));
    try {
      const effectPath = join(dir, "effect.json");
      const outPath = join(dir, "candidate.bmp");
      const effect = effectFixture();
      effect.subEffects[0].modelName = "missing.lgo";
      writeFileSync(effectPath, JSON.stringify(effect));

      expect(() => execFileSync(process.execPath, [
        captureScript,
        "--effect-json",
        effectPath,
        "--out",
        outPath,
        "--time",
        "0",
        "--width",
        "32",
        "--height",
        "32",
        "--fail-on-skipped",
      ], { cwd: repoRoot, encoding: "utf8" })).toThrow();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders a parsed Range particle JSON to a BMP candidate image", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-tools-capture-"));
    try {
      const parPath = join(dir, "particles.json");
      const outPath = join(dir, "candidate.bmp");
      writeFileSync(parPath, JSON.stringify(parFixture({
        systems: [
          particleSystemFixture({
            type: 14,
            name: "range-ring",
            particleCount: 1,
            range: [0, 0, 0],
            offset: [0, 0, 0],
            frameSizes: [1],
            srcBlend: 5,
            destBlend: 6,
          }),
        ],
      })));

      const stdout = execFileSync(process.execPath, [
        captureScript,
        "--par-json",
        parPath,
        "--out",
        outPath,
        "--time",
        "0",
        "--width",
        "32",
        "--height",
        "32",
      ], { cwd: repoRoot, encoding: "utf8" });

      const report = JSON.parse(stdout);
      expect(report.renderedParticleSystems).toBe(1);
      expect(report.skippedParticleSystems).toEqual([]);

      const bmp = readFileSync(outPath);
      expect(bmp.subarray(0, 2).toString("ascii")).toBe("BM");
      expect(bmp.readInt32LE(18)).toBe(32);
      expect(bmp.readInt32LE(22)).toBe(32);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders a parsed MODEL particle JSON with bundled .lgo geometry", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-tools-capture-"));
    try {
      const parPath = join(dir, "particles.json");
      const modelBundlePath = join(dir, "models.json");
      const outPath = join(dir, "candidate.bmp");
      writeFileSync(parPath, JSON.stringify(parFixture({
        systems: [
          particleSystemFixture({
            type: 5,
            name: "model-particle",
            particleCount: 5,
            modelName: "weapon.lgo",
            frameSizes: [1],
            offset: [0, 0, 0],
          }),
        ],
      })));
      writeFileSync(modelBundlePath, JSON.stringify(modelBundleFixture("weapon.lgo")));

      const stdout = execFileSync(process.execPath, [
        captureScript,
        "--par-json",
        parPath,
        "--model-bundle",
        modelBundlePath,
        "--out",
        outPath,
        "--time",
        "0",
        "--width",
        "32",
        "--height",
        "32",
        "--fail-on-skipped",
      ], { cwd: repoRoot, encoding: "utf8" });

      const report = JSON.parse(stdout);
      expect(report.renderedParticleSystems).toBe(1);
      expect(report.skippedParticleSystems).toEqual([]);

      const bmp = readFileSync(outPath);
      expect(readBmp24Pixel(bmp, 32, 16, 16)).toEqual([255, 255, 255]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders a parsed particle JSON whose modelName points at a bundled .eff", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-tools-capture-"));
    try {
      const parPath = join(dir, "particles.json");
      const modelBundlePath = join(dir, "models.json");
      const outPath = join(dir, "candidate.bmp");
      writeFileSync(parPath, JSON.stringify(parFixture({
        systems: [
          particleSystemFixture({
            type: 1,
            name: "snow-with-effect-visual",
            particleCount: 1,
            modelName: "30light.eff",
            frameSizes: [1],
            velocity: 0.1,
            step: 0.001,
            offset: [0, 0, 0],
          }),
        ],
      })));
      writeFileSync(modelBundlePath, JSON.stringify({
        schema: "pko-effect-model-bundle/v1",
        models: {},
        effects: {
          "30light": {
            effect: effectFixture(),
            source: "test/effect/30light.eff",
          },
        },
      }));

      const stdout = execFileSync(process.execPath, [
        captureScript,
        "--par-json",
        parPath,
        "--model-bundle",
        modelBundlePath,
        "--out",
        outPath,
        "--time",
        "0.02",
        "--width",
        "32",
        "--height",
        "32",
        "--fail-on-skipped",
      ], { cwd: repoRoot, encoding: "utf8" });

      const report = JSON.parse(stdout);
      expect(report.renderedParticleSystems).toBe(1);
      expect(report.skippedParticleSystems).toEqual([]);

      const bmp = readFileSync(outPath);
      expect(readBmp24Pixel(bmp, 32, 16, 16)).toEqual([255, 0, 0]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders parsed CChaModel particle records from version-8 ParChaModel data", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-tools-capture-"));
    try {
      const parPath = join(dir, "particles.json");
      const modelBundlePath = join(dir, "models.json");
      const outPath = join(dir, "candidate.bmp");
      writeFileSync(parPath, JSON.stringify(parFixture({
        systems: [],
        strips: [],
        models: [
          characterModelFixture({
            id: 52,
            srcBlend: 5,
            destBlend: 6,
            color: [0, 1, 0, 1],
          }),
        ],
      })));
      writeFileSync(modelBundlePath, JSON.stringify(characterModelBundleFixture(52)));

      const stdout = execFileSync(process.execPath, [
        captureScript,
        "--par-json",
        parPath,
        "--model-bundle",
        modelBundlePath,
        "--out",
        outPath,
        "--time",
        "0",
        "--width",
        "32",
        "--height",
        "32",
        "--fail-on-skipped",
      ], { cwd: repoRoot, encoding: "utf8" });

      const report = JSON.parse(stdout);
      expect(report.renderedCharacterModels).toBe(1);
      expect(report.skippedCharacterModels).toEqual([]);

      const bmp = readFileSync(outPath);
      expect(readBmp24Pixel(bmp, 32, 16, 16)).toEqual([0, 255, 0]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("samples parsed MODEL particle frame color animation in candidate captures", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-tools-capture-"));
    try {
      const parPath = join(dir, "particles.json");
      const modelBundlePath = join(dir, "models.json");
      const outPath = join(dir, "candidate.bmp");
      writeFileSync(parPath, JSON.stringify(parFixture({
        systems: [
          particleSystemFixture({
            type: 5,
            name: "model-animated-color",
            particleCount: 1,
            modelName: "weapon.lgo",
            frameCount: 2,
            frameSizes: [1, 1],
            frameColors: [[1, 0, 0, 1], [0, 1, 0, 1]],
            life: 1,
            offset: [0, 0, 0],
            srcBlend: 5,
            destBlend: 6,
          }),
        ],
      })));
      writeFileSync(modelBundlePath, JSON.stringify(modelBundleFixture("weapon.lgo")));

      execFileSync(process.execPath, [
        captureScript,
        "--par-json",
        parPath,
        "--model-bundle",
        modelBundlePath,
        "--out",
        outPath,
        "--time",
        "0.5",
        "--width",
        "32",
        "--height",
        "32",
        "--fail-on-skipped",
      ], { cwd: repoRoot, encoding: "utf8" });

      const bmp = readFileSync(outPath);
      expect(readBmp24Pixel(bmp, 32, 16, 16)).toEqual([0, 255, 0]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("orients parsed MODEL particle captures with source modelDir rotation", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-tools-capture-"));
    try {
      const parPath = join(dir, "particles.json");
      const modelBundlePath = join(dir, "models.json");
      const outPath = join(dir, "candidate.bmp");
      writeFileSync(parPath, JSON.stringify(parFixture({
        systems: [
          particleSystemFixture({
            type: 5,
            name: "model-dir-particle",
            particleCount: 1,
            modelName: "arrow.lgo",
            modelDir: true,
            direction: [1, 0, 0],
            frameSizes: [1],
            offset: [0, 0, 0],
          }),
        ],
      })));
      writeFileSync(modelBundlePath, JSON.stringify(asymmetricModelBundleFixture("arrow")));

      execFileSync(process.execPath, [
        captureScript,
        "--par-json",
        parPath,
        "--model-bundle",
        modelBundlePath,
        "--out",
        outPath,
        "--time",
        "0",
        "--width",
        "32",
        "--height",
        "32",
        "--fail-on-skipped",
      ], { cwd: repoRoot, encoding: "utf8" });

      const bmp = readFileSync(outPath);
      expect(readBmp24Pixel(bmp, 32, 23, 16)).toEqual([0, 0, 0]);
      expect(readBmp24Pixel(bmp, 32, 16, 8)).toEqual([255, 255, 255]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders a parsed BLAST particle JSON after lifecycle stepping", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-tools-capture-"));
    try {
      const parPath = join(dir, "particles.json");
      const modelBundlePath = join(dir, "models.json");
      const outPath = join(dir, "candidate.bmp");
      writeFileSync(parPath, JSON.stringify(parFixture({
        systems: [
          particleSystemFixture({
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
          }),
        ],
      })));
      writeFileSync(modelBundlePath, JSON.stringify(modelBundleFixture("weapon.lgo")));

      const stdout = execFileSync(process.execPath, [
        captureScript,
        "--par-json",
        parPath,
        "--model-bundle",
        modelBundlePath,
        "--out",
        outPath,
        "--time",
        "0.25",
        "--width",
        "32",
        "--height",
        "32",
        "--fail-on-skipped",
      ], { cwd: repoRoot, encoding: "utf8" });

      const report = JSON.parse(stdout);
      expect(report.renderedParticleSystems).toBe(1);
      expect(report.skippedParticleSystems).toEqual([]);

      const bmp = readFileSync(outPath);
      expect(readBmp24Pixel(bmp, 32, 16, 16)).toEqual([255, 255, 255]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders a parsed BLAST3 particle JSON after velocity-scaled lifecycle stepping", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-tools-capture-"));
    try {
      const parPath = join(dir, "particles.json");
      const modelBundlePath = join(dir, "models.json");
      const outPath = join(dir, "candidate.bmp");
      writeFileSync(parPath, JSON.stringify(parFixture({
        systems: [
          particleSystemFixture({
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
          }),
        ],
      })));
      writeFileSync(modelBundlePath, JSON.stringify(modelBundleFixture("weapon.lgo")));

      const stdout = execFileSync(process.execPath, [
        captureScript,
        "--par-json",
        parPath,
        "--model-bundle",
        modelBundlePath,
        "--out",
        outPath,
        "--time",
        "0.25",
        "--width",
        "32",
        "--height",
        "32",
        "--fail-on-skipped",
      ], { cwd: repoRoot, encoding: "utf8" });

      const report = JSON.parse(stdout);
      expect(report.renderedParticleSystems).toBe(1);
      expect(report.skippedParticleSystems).toEqual([]);

      const bmp = readFileSync(outPath);
      expect(readBmp24Pixel(bmp, 32, 16, 16)).toEqual([255, 255, 255]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders a parsed ROUND particle JSON with wrapping lifecycle frames", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-tools-capture-"));
    try {
      const parPath = join(dir, "particles.json");
      const modelBundlePath = join(dir, "models.json");
      const outPath = join(dir, "candidate.bmp");
      writeFileSync(parPath, JSON.stringify(parFixture({
        systems: [
          particleSystemFixture({
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
          }),
        ],
      })));
      writeFileSync(modelBundlePath, JSON.stringify(modelBundleFixture("weapon.lgo")));

      const stdout = execFileSync(process.execPath, [
        captureScript,
        "--par-json",
        parPath,
        "--model-bundle",
        modelBundlePath,
        "--out",
        outPath,
        "--time",
        "1.25",
        "--width",
        "32",
        "--height",
        "32",
        "--fail-on-skipped",
      ], { cwd: repoRoot, encoding: "utf8" });

      const report = JSON.parse(stdout);
      expect(report.renderedParticleSystems).toBe(1);
      expect(report.skippedParticleSystems).toEqual([]);

      const bmp = readFileSync(outPath);
      expect(readBmp24Pixel(bmp, 32, 16, 16)).toEqual([255, 255, 255]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders a parsed ARROW particle JSON with reset lifecycle frames", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-tools-capture-"));
    try {
      const parPath = join(dir, "particles.json");
      const modelBundlePath = join(dir, "models.json");
      const outPath = join(dir, "candidate.bmp");
      writeFileSync(parPath, JSON.stringify(parFixture({
        systems: [
          particleSystemFixture({
            type: 8,
            name: "arrow-particle",
            particleCount: 4,
            modelName: "weapon.lgo",
            frameCount: 2,
            frameSizes: [1, 1],
            frameColors: [[1, 1, 1, 1], [1, 1, 1, 1]],
            life: 1,
            offset: [0, 0, 0],
          }),
        ],
      })));
      writeFileSync(modelBundlePath, JSON.stringify(modelBundleFixture("weapon.lgo")));

      const stdout = execFileSync(process.execPath, [
        captureScript,
        "--par-json",
        parPath,
        "--model-bundle",
        modelBundlePath,
        "--out",
        outPath,
        "--time",
        "1.25",
        "--width",
        "32",
        "--height",
        "32",
        "--fail-on-skipped",
      ], { cwd: repoRoot, encoding: "utf8" });

      const report = JSON.parse(stdout);
      expect(report.renderedParticleSystems).toBe(1);
      expect(report.skippedParticleSystems).toEqual([]);

      const bmp = readFileSync(outPath);
      expect(readBmp24Pixel(bmp, 32, 16, 16)).toEqual([255, 255, 255]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps parsed ARROW particle captures unrotated despite frame angles", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-tools-capture-"));
    try {
      const parPath = join(dir, "particles.json");
      const modelBundlePath = join(dir, "models.json");
      const outPath = join(dir, "candidate.bmp");
      writeFileSync(parPath, JSON.stringify(parFixture({
        systems: [
          particleSystemFixture({
            type: 8,
            name: "arrow-no-rotation",
            particleCount: 1,
            modelName: "arrow.lgo",
            frameCount: 2,
            frameSizes: [1, 1],
            frameAngles: [[0, -Math.PI / 2, 0], [0, -Math.PI / 2, 0]],
            frameColors: [[1, 1, 1, 1], [1, 1, 1, 1]],
            life: 1,
            offset: [0, 0, 0],
          }),
        ],
      })));
      writeFileSync(modelBundlePath, JSON.stringify(asymmetricModelBundleFixture("arrow")));

      execFileSync(process.execPath, [
        captureScript,
        "--par-json",
        parPath,
        "--model-bundle",
        modelBundlePath,
        "--out",
        outPath,
        "--time",
        "0.25",
        "--width",
        "32",
        "--height",
        "32",
        "--fail-on-skipped",
      ], { cwd: repoRoot, encoding: "utf8" });

      const bmp = readFileSync(outPath);
      expect(readBmp24Pixel(bmp, 32, 23, 16)).toEqual([255, 255, 255]);
      expect(readBmp24Pixel(bmp, 32, 16, 8)).toEqual([0, 0, 0]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders a parsed SHRINK particle JSON while moving toward its target", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-tools-capture-"));
    try {
      const parPath = join(dir, "particles.json");
      const modelBundlePath = join(dir, "models.json");
      const outPath = join(dir, "candidate.bmp");
      writeFileSync(parPath, JSON.stringify(parFixture({
        systems: [
          particleSystemFixture({
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
          }),
        ],
      })));
      writeFileSync(modelBundlePath, JSON.stringify(modelBundleFixture("weapon.lgo")));

      const stdout = execFileSync(process.execPath, [
        captureScript,
        "--par-json",
        parPath,
        "--model-bundle",
        modelBundlePath,
        "--out",
        outPath,
        "--time",
        "0.25",
        "--width",
        "32",
        "--height",
        "32",
        "--fail-on-skipped",
      ], { cwd: repoRoot, encoding: "utf8" });

      const report = JSON.parse(stdout);
      expect(report.renderedParticleSystems).toBe(1);
      expect(report.skippedParticleSystems).toEqual([]);

      const bmp = readFileSync(outPath);
      expect(readBmp24Pixel(bmp, 32, 16, 16)).toEqual([255, 255, 255]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("orients parsed SHRINK particle captures with source RotatingXZ angles", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-tools-capture-"));
    try {
      const parPath = join(dir, "particles.json");
      const modelBundlePath = join(dir, "models.json");
      const outPath = join(dir, "candidate.bmp");
      writeFileSync(parPath, JSON.stringify(parFixture({
        systems: [
          particleSystemFixture({
            type: 12,
            name: "shrink-rotatingxz",
            particleCount: 1,
            modelName: "arrow.lgo",
            range: [0, 0, 4],
            frameCount: 2,
            frameSizes: [1, 1],
            frameAngles: [[0, -Math.PI / 2, 0], [0, -Math.PI / 2, 0]],
            frameColors: [[1, 1, 1, 1], [1, 1, 1, 1]],
            life: 1,
            velocity: 1,
            offset: [0, 0, 0],
          }),
        ],
      })));
      writeFileSync(modelBundlePath, JSON.stringify(asymmetricModelBundleFixture("arrow")));

      execFileSync(process.execPath, [
        captureScript,
        "--par-json",
        parPath,
        "--model-bundle",
        modelBundlePath,
        "--out",
        outPath,
        "--time",
        "0.25",
        "--width",
        "32",
        "--height",
        "32",
        "--fail-on-skipped",
      ], { cwd: repoRoot, encoding: "utf8" });

      const bmp = readFileSync(outPath);
      expect(readBmp24Pixel(bmp, 32, 23, 16)).toEqual([0, 0, 0]);
      expect(readBmp24Pixel(bmp, 32, 16, 8)).toEqual([255, 255, 255]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders a parsed BLAST2 particle JSON with its custom frame advance branch", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-tools-capture-"));
    try {
      const parPath = join(dir, "particles.json");
      const modelBundlePath = join(dir, "models.json");
      const outPath = join(dir, "candidate.bmp");
      writeFileSync(parPath, JSON.stringify(parFixture({
        systems: [
          particleSystemFixture({
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
          }),
        ],
      })));
      writeFileSync(modelBundlePath, JSON.stringify(modelBundleFixture("weapon.lgo")));

      const stdout = execFileSync(process.execPath, [
        captureScript,
        "--par-json",
        parPath,
        "--model-bundle",
        modelBundlePath,
        "--out",
        outPath,
        "--time",
        "0.25",
        "--width",
        "32",
        "--height",
        "32",
        "--fail-on-skipped",
      ], { cwd: repoRoot, encoding: "utf8" });

      const report = JSON.parse(stdout);
      expect(report.renderedParticleSystems).toBe(1);
      expect(report.skippedParticleSystems).toEqual([]);

      const bmp = readFileSync(outPath);
      expect(readBmp24Pixel(bmp, 32, 16, 16)).toEqual([255, 255, 255]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders a parsed FIRE particle JSON after dead-slot step emission", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-tools-capture-"));
    try {
      const parPath = join(dir, "particles.json");
      const modelBundlePath = join(dir, "models.json");
      const outPath = join(dir, "candidate.bmp");
      writeFileSync(parPath, JSON.stringify(parFixture({
        systems: [
          particleSystemFixture({
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
          }),
        ],
      })));
      writeFileSync(modelBundlePath, JSON.stringify(modelBundleFixture("weapon.lgo")));

      const stdout = execFileSync(process.execPath, [
        captureScript,
        "--par-json",
        parPath,
        "--model-bundle",
        modelBundlePath,
        "--out",
        outPath,
        "--time",
        "0.25",
        "--width",
        "32",
        "--height",
        "32",
        "--fail-on-skipped",
      ], { cwd: repoRoot, encoding: "utf8" });

      const report = JSON.parse(stdout);
      expect(report.renderedParticleSystems).toBe(1);
      expect(report.skippedParticleSystems).toEqual([]);

      const bmp = readFileSync(outPath);
      expect(readBmp24Pixel(bmp, 32, 16, 16)).toEqual([255, 255, 255]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders FIRE particle built-in RectPlane geometry without an external model bundle", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-tools-capture-"));
    try {
      const parPath = join(dir, "particles.json");
      const outPath = join(dir, "candidate.bmp");
      writeFileSync(parPath, JSON.stringify(parFixture({
        systems: [
          particleSystemFixture({
            type: 2,
            name: "fire-rect-plane",
            particleCount: 1,
            modelName: "RectPlane",
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
          }),
        ],
      })));

      const stdout = execFileSync(process.execPath, [
        captureScript,
        "--par-json",
        parPath,
        "--out",
        outPath,
        "--time",
        "0.25",
        "--width",
        "32",
        "--height",
        "32",
        "--fail-on-skipped",
      ], { cwd: repoRoot, encoding: "utf8" });

      const report = JSON.parse(stdout);
      expect(report.renderedParticleSystems).toBe(1);
      expect(report.skippedParticleSystems).toEqual([]);

      const bmp = readFileSync(outPath);
      expect(readBmp24Pixel(bmp, 32, 16, 16)).toEqual([255, 255, 255]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders a parsed SNOW particle JSON after dead-slot step emission", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-tools-capture-"));
    try {
      const parPath = join(dir, "particles.json");
      const modelBundlePath = join(dir, "models.json");
      const outPath = join(dir, "candidate.bmp");
      writeFileSync(parPath, JSON.stringify(parFixture({
        systems: [
          particleSystemFixture({
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
          }),
        ],
      })));
      writeFileSync(modelBundlePath, JSON.stringify(modelBundleFixture("weapon.lgo")));

      const stdout = execFileSync(process.execPath, [
        captureScript,
        "--par-json",
        parPath,
        "--model-bundle",
        modelBundlePath,
        "--out",
        outPath,
        "--time",
        "0.25",
        "--width",
        "32",
        "--height",
        "32",
        "--fail-on-skipped",
      ], { cwd: repoRoot, encoding: "utf8" });

      const report = JSON.parse(stdout);
      expect(report.renderedParticleSystems).toBe(1);
      expect(report.skippedParticleSystems).toEqual([]);

      const bmp = readFileSync(outPath);
      expect(readBmp24Pixel(bmp, 32, 16, 16)).toEqual([255, 255, 255]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders a parsed RIPPLE particle JSON after source-primed step emission", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-tools-capture-"));
    try {
      const parPath = join(dir, "particles.json");
      const modelBundlePath = join(dir, "models.json");
      const outPath = join(dir, "candidate.bmp");
      writeFileSync(parPath, JSON.stringify(parFixture({
        systems: [
          particleSystemFixture({
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
          }),
        ],
      })));
      writeFileSync(modelBundlePath, JSON.stringify(modelBundleFixture("weapon.lgo")));

      const stdout = execFileSync(process.execPath, [
        captureScript,
        "--par-json",
        parPath,
        "--model-bundle",
        modelBundlePath,
        "--out",
        outPath,
        "--time",
        "0.01",
        "--width",
        "32",
        "--height",
        "32",
        "--fail-on-skipped",
      ], { cwd: repoRoot, encoding: "utf8" });

      const report = JSON.parse(stdout);
      expect(report.renderedParticleSystems).toBe(1);
      expect(report.skippedParticleSystems).toEqual([]);

      const bmp = readFileSync(outPath);
      expect(readBmp24Pixel(bmp, 32, 16, 16)).toEqual([255, 255, 255]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders a parsed WIND particle JSON after dead-slot step emission", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-tools-capture-"));
    try {
      const parPath = join(dir, "particles.json");
      const modelBundlePath = join(dir, "models.json");
      const outPath = join(dir, "candidate.bmp");
      writeFileSync(parPath, JSON.stringify(parFixture({
        systems: [
          particleSystemFixture({
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
          }),
        ],
      })));
      writeFileSync(modelBundlePath, JSON.stringify(modelBundleFixture("weapon.lgo")));

      const stdout = execFileSync(process.execPath, [
        captureScript,
        "--par-json",
        parPath,
        "--model-bundle",
        modelBundlePath,
        "--out",
        outPath,
        "--time",
        "0.25",
        "--width",
        "32",
        "--height",
        "32",
        "--fail-on-skipped",
      ], { cwd: repoRoot, encoding: "utf8" });

      const report = JSON.parse(stdout);
      expect(report.renderedParticleSystems).toBe(1);
      expect(report.skippedParticleSystems).toEqual([]);

      const bmp = readFileSync(outPath);
      expect(readBmp24Pixel(bmp, 32, 16, 16)).toEqual([255, 255, 255]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders a parsed STRIP particle JSON as a fixed frame-0 model particle", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-tools-capture-"));
    try {
      const parPath = join(dir, "particles.json");
      const modelBundlePath = join(dir, "models.json");
      const outPath = join(dir, "candidate.bmp");
      writeFileSync(parPath, JSON.stringify(parFixture({
        systems: [
          particleSystemFixture({
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
          }),
        ],
      })));
      writeFileSync(modelBundlePath, JSON.stringify(modelBundleFixture("weapon.lgo")));

      const stdout = execFileSync(process.execPath, [
        captureScript,
        "--par-json",
        parPath,
        "--model-bundle",
        modelBundlePath,
        "--out",
        outPath,
        "--time",
        "0.5",
        "--width",
        "32",
        "--height",
        "32",
        "--fail-on-skipped",
      ], { cwd: repoRoot, encoding: "utf8" });

      const report = JSON.parse(stdout);
      expect(report.renderedParticleSystems).toBe(1);
      expect(report.skippedParticleSystems).toEqual([]);

      const bmp = readFileSync(outPath);
      expect(readBmp24Pixel(bmp, 32, 16, 16)).toEqual([255, 255, 255]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders a parsed SHADE particle JSON as a fixed-size ground decal", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-tools-capture-"));
    try {
      const parPath = join(dir, "particles.json");
      const outPath = join(dir, "candidate.bmp");
      writeFileSync(parPath, JSON.stringify(parFixture({
        systems: [
          particleSystemFixture({
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
          }),
        ],
      })));

      const stdout = execFileSync(process.execPath, [
        captureScript,
        "--par-json",
        parPath,
        "--out",
        outPath,
        "--time",
        "0.5",
        "--width",
        "32",
        "--height",
        "32",
        "--fail-on-skipped",
      ], { cwd: repoRoot, encoding: "utf8" });

      const report = JSON.parse(stdout);
      expect(report.renderedParticleSystems).toBe(1);
      expect(report.skippedParticleSystems).toEqual([]);

      const bmp = readFileSync(outPath);
      expect(readBmp24Pixel(bmp, 32, 16, 16)).toEqual([255, 188, 188]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders a parsed DUMMY particle JSON when dummy span metadata is available", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-tools-capture-"));
    try {
      const parPath = join(dir, "particles.json");
      const modelBundlePath = join(dir, "models.json");
      const outPath = join(dir, "candidate.bmp");
      writeFileSync(parPath, JSON.stringify(parFixture({
        dummyLineSpan: {
          start: [0, 0, 0],
          direction: [0, 0, 1],
          distance: 1,
        },
        systems: [
          particleSystemFixture({
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
          }),
        ],
      } as Partial<ParFile> & { dummyLineSpan: { start: number[]; direction: number[]; distance: number } })));
      writeFileSync(modelBundlePath, JSON.stringify(modelBundleFixture("weapon.lgo")));

      const stdout = execFileSync(process.execPath, [
        captureScript,
        "--par-json",
        parPath,
        "--model-bundle",
        modelBundlePath,
        "--out",
        outPath,
        "--time",
        "0.25",
        "--width",
        "32",
        "--height",
        "32",
        "--fail-on-skipped",
      ], { cwd: repoRoot, encoding: "utf8" });

      const report = JSON.parse(stdout);
      expect(report.renderedParticleSystems).toBe(1);
      expect(report.skippedParticleSystems).toEqual([]);

      const bmp = readFileSync(outPath);
      expect(readBmp24Pixel(bmp, 32, 16, 16)).toEqual([255, 255, 255]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders a parsed LINE_SINGLE particle JSON moving along a dummy span", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-tools-capture-"));
    try {
      const parPath = join(dir, "particles.json");
      const modelBundlePath = join(dir, "models.json");
      const outPath = join(dir, "candidate.bmp");
      writeFileSync(parPath, JSON.stringify(parFixture({
        dummyLineSpan: {
          start: [0, 0, 0],
          direction: [0, 0, 1],
          distance: 1,
        },
        systems: [
          particleSystemFixture({
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
          }),
        ],
      } as Partial<ParFile> & { dummyLineSpan: { start: number[]; direction: number[]; distance: number } })));
      writeFileSync(modelBundlePath, JSON.stringify(modelBundleFixture("weapon.lgo")));

      const stdout = execFileSync(process.execPath, [
        captureScript,
        "--par-json",
        parPath,
        "--model-bundle",
        modelBundlePath,
        "--out",
        outPath,
        "--time",
        "0.25",
        "--width",
        "32",
        "--height",
        "32",
        "--fail-on-skipped",
      ], { cwd: repoRoot, encoding: "utf8" });

      const report = JSON.parse(stdout);
      expect(report.renderedParticleSystems).toBe(1);
      expect(report.skippedParticleSystems).toEqual([]);

      const bmp = readFileSync(outPath);
      expect(readBmp24Pixel(bmp, 32, 16, 16)).toEqual([255, 255, 255]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders a parsed LINE_ROUND particle JSON with dummy-span reversal motion", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-tools-capture-"));
    try {
      const parPath = join(dir, "particles.json");
      const modelBundlePath = join(dir, "models.json");
      const outPath = join(dir, "candidate.bmp");
      writeFileSync(parPath, JSON.stringify(parFixture({
        dummyLineSpan: {
          start: [0, 0, 0],
          direction: [0, 0, 1],
          distance: 1,
        },
        systems: [
          particleSystemFixture({
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
          }),
        ],
      } as Partial<ParFile> & { dummyLineSpan: { start: number[]; direction: number[]; distance: number } })));
      writeFileSync(modelBundlePath, JSON.stringify(modelBundleFixture("weapon.lgo")));

      const stdout = execFileSync(process.execPath, [
        captureScript,
        "--par-json",
        parPath,
        "--model-bundle",
        modelBundlePath,
        "--out",
        outPath,
        "--time",
        "0.75",
        "--width",
        "32",
        "--height",
        "32",
        "--fail-on-skipped",
      ], { cwd: repoRoot, encoding: "utf8" });

      const report = JSON.parse(stdout);
      expect(report.renderedParticleSystems).toBe(1);
      expect(report.skippedParticleSystems).toEqual([]);

      const bmp = readFileSync(outPath);
      expect(readBmp24Pixel(bmp, 32, 16, 16)).toEqual([255, 255, 255]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function readBmp24Pixel(bmp: Buffer, width: number, x: number, y: number): [number, number, number] {
  const rowStride = Math.floor((24 * width + 31) / 32) * 4;
  const offset = 54 + y * rowStride + x * 3;
  return [bmp[offset + 2], bmp[offset + 1], bmp[offset]];
}

function effectFixture(): EffectFile {
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
        effectName: "capture-smoke",
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

function parFixture(overrides: Partial<ParFile> = {}): ParFile {
  return {
    version: 8,
    name: "range-fixture",
    length: 1,
    systems: [],
    strips: [],
    models: [],
    ...overrides,
  };
}

function particleSystemFixture(overrides: Partial<ParSystem> = {}): ParSystem {
  return {
    type: 14,
    name: "particle",
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
    ...overrides,
  };
}

function characterModelFixture(overrides: Partial<ParChaModel> = {}): ParChaModel {
  return {
    id: 52,
    velocity: 1,
    playType: 2,
    curPose: 1,
    srcBlend: 5,
    destBlend: 6,
    color: [1, 1, 1, 1],
    ...overrides,
  };
}

function modelBundleFixture(modelName: string) {
  const positions = floats([
    -0.75, -0.75, 0,
    -0.75, 0.75, 0,
    0.75, 0.75, 0,
    0.75, -0.75, 0,
  ]);
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
      { bufferView: 0, componentType: 5126, count: 4, type: "VEC3", min: [-0.75, -0.75, 0], max: [0.75, 0.75, 0] },
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
      weapon: {
        gltf: JSON.stringify(gltf),
        source: "test/weapon.lgo",
      },
    },
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

function asymmetricModelBundleFixture(modelName: string) {
  return modelBundleFromPositions(modelName, [
    0.35, -0.15, 0,
    0.35, 0.15, 0,
    1.3, 0.15, 0,
    1.3, -0.15, 0,
  ]);
}

function modelBundleFromPositions(modelName: string, positionValues: number[]) {
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
      [modelName.toLowerCase()]: {
        gltf: JSON.stringify(gltf),
        source: `test/${modelName}.lgo`,
      },
    },
  };
}

function floats(values: number[]): Buffer {
  const buffer = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => buffer.writeFloatLE(value, index * 4));
  return buffer;
}

function uint16s(values: number[]): Buffer {
  const buffer = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => buffer.writeUInt16LE(value, index * 2));
  return buffer;
}
