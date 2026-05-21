import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "../../../..");
const runnerScript = join(repoRoot, "scripts/effect-source-capture-runner.mjs");

describe("effect source capture runner", () => {
  it("dry-runs original-client capture commands from pixel corpus sourceCapture metadata", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-source-capture-runner-"));
    try {
      const sourceRoot = createSourceRoot(dir);
      const manifestPath = join(dir, "manifest.json");
      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "magic projectile at hit",
            source: "original-client/magic-hit.bmp",
            candidate: "pko-tools/magic-hit.bmp",
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
        runnerScript,
        "--manifest",
        manifestPath,
        "--source-root",
        sourceRoot,
        "--effect-corpus-root",
        join(sourceRoot, "Client/client/effect"),
        "--dry-run",
      ], { encoding: "utf8" });

      const report = JSON.parse(output);
      expect(report.pass).toBe(true);
      expect(report.dryRun).toBe(true);
      expect(report.cases[0].command).toContain(join(sourceRoot, "Client/bin/system/Game.exe"));
      expect(report.cases[0].args).toEqual([
        "effect_capture_id=1001",
        "effect_capture_time=0.5",
        `effect_capture_out=${join(dir, "original-client/magic-hit.bmp")}`,
        "effect_capture_start=-1,0,0",
        "effect_capture_target=0,0,0",
      ]);
      expect(report.cases[0].captureMode).toBe("magic");
      expect(report.cases[0].cwd).toBe(join(sourceRoot, "Client/bin/system"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("can dry-run one selected case by name", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-source-capture-runner-"));
    try {
      const sourceRoot = createSourceRoot(dir);
      const manifestPath = join(dir, "manifest.json");
      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "skip this case",
            source: "original-client/skip.bmp",
            candidate: "pko-tools/skip.bmp",
            sourceCapture: { effectId: 1, time: 0 },
          },
          {
            name: "capture this case",
            source: "original-client/capture.bmp",
            candidate: "pko-tools/capture.bmp",
            sourceCapture: { effectId: 2, time: 0.25 },
          },
        ],
      }));

      const output = execFileSync(process.execPath, [
        runnerScript,
        "--manifest",
        manifestPath,
        "--source-root",
        sourceRoot,
        "--effect-corpus-root",
        join(sourceRoot, "Client/client/effect"),
        "--case",
        "capture this case",
        "--dry-run",
      ], { encoding: "utf8" });

      const report = JSON.parse(output);
      expect(report.pass).toBe(true);
      expect(report.caseFilter).toBe("capture this case");
      expect(report.cases).toHaveLength(1);
      expect(report.cases[0].name).toBe("capture this case");
      expect(report.cases[0].args).toContain("effect_capture_id=2");
      expect(report.cases[0].captureMode).toBe("scene-effect");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("dry-runs direct particle captures when sourceCapture names a .par file", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-source-capture-runner-"));
    try {
      const sourceRoot = createSourceRoot(dir);
      const manifestPath = join(dir, "manifest.json");
      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "00000001.par at 0.5s",
            source: "original-client/00000001-par-0.5.bmp",
            candidate: "pko-tools/00000001-par-0.5.bmp",
            sourceCapture: {
              effectId: 1,
              parName: "00000001",
              time: 0.5,
            },
          },
        ],
      }));

      const output = execFileSync(process.execPath, [
        runnerScript,
        "--manifest",
        manifestPath,
        "--source-root",
        sourceRoot,
        "--effect-corpus-root",
        join(sourceRoot, "Client/client/effect"),
        "--dry-run",
      ], { encoding: "utf8" });

      const report = JSON.parse(output);
      expect(report.pass).toBe(true);
      expect(report.cases[0].captureMode).toBe("particle");
      expect(report.cases[0].args).toEqual([
        "effect_capture_id=1",
        "effect_capture_par=00000001",
        "effect_capture_time=0.5",
        `effect_capture_out=${join(dir, "original-client/00000001-par-0.5.bmp")}`,
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("dry-runs direct particle captures with source dummy span metadata", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-source-capture-runner-"));
    try {
      const sourceRoot = createSourceRoot(dir);
      const manifestPath = join(dir, "manifest.json");
      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "dummy particle",
            source: "original-client/dummy.bmp",
            candidate: "pko-tools/dummy.bmp",
            sourceCapture: {
              effectId: 1,
              parName: "01040009",
              time: 0.5,
              dummy1: [0, 3, 0],
              dummy2: [0, 0, 0],
            },
          },
        ],
      }));

      const output = execFileSync(process.execPath, [
        runnerScript,
        "--manifest",
        manifestPath,
        "--source-root",
        sourceRoot,
        "--effect-corpus-root",
        join(sourceRoot, "Client/client/effect"),
        "--dry-run",
      ], { encoding: "utf8" });

      const report = JSON.parse(output);
      expect(report.pass).toBe(true);
      expect(report.cases[0].args).toContain("effect_capture_dummy1=0,3,0");
      expect(report.cases[0].args).toContain("effect_capture_dummy2=0,0,0");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("dry-runs direct particle captures from a standalone par file path", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-source-capture-runner-"));
    try {
      const sourceRoot = createSourceRoot(dir);
      const manifestPath = join(dir, "manifest.json");
      mkdirSync(join(dir, "synthetic"), { recursive: true });
      writeFileSync(join(dir, "synthetic/synthetic-range14.par"), "fake par bytes");
      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "synthetic particle",
            source: "original-client/synthetic-range14.bmp",
            candidate: "pko-tools/synthetic-range14.bmp",
            sourceCapture: {
              effectId: 990014,
              parName: "synthetic-range14",
              parPath: "synthetic/synthetic-range14.par",
              time: 0.5,
            },
          },
        ],
      }));

      const output = execFileSync(process.execPath, [
        runnerScript,
        "--manifest",
        manifestPath,
        "--source-root",
        sourceRoot,
        "--effect-corpus-root",
        join(sourceRoot, "Client/client/effect"),
        "--dry-run",
      ], { encoding: "utf8" });

      const report = JSON.parse(output);
      expect(report.pass).toBe(true);
      expect(report.cases[0].captureMode).toBe("particle");
      expect(report.cases[0].args).toContain(`effect_capture_par_path=${join(dir, "synthetic/synthetic-range14.par")}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("can dry-run only source captures whose BMP output is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-source-capture-runner-"));
    try {
      const sourceRoot = createSourceRoot(dir);
      const manifestPath = join(dir, "manifest.json");
      mkdirSync(join(dir, "original-client"), { recursive: true });
      writeFileSync(join(dir, "original-client/already.bmp"), "existing bmp");
      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "already captured",
            source: "original-client/already.bmp",
            candidate: "pko-tools/already.bmp",
            sourceCapture: { effectId: 1, time: 0 },
          },
          {
            name: "needs capture",
            source: "original-client/missing.bmp",
            candidate: "pko-tools/missing.bmp",
            sourceCapture: { effectId: 2, time: 0.25 },
          },
        ],
      }));

      const output = execFileSync(process.execPath, [
        runnerScript,
        "--manifest",
        manifestPath,
        "--source-root",
        sourceRoot,
        "--effect-corpus-root",
        join(sourceRoot, "Client/client/effect"),
        "--missing-only",
        "--dry-run",
      ], { encoding: "utf8" });

      const report = JSON.parse(output);
      expect(report.pass).toBe(true);
      expect(report.missingOnly).toBe(true);
      expect(report.cases).toHaveLength(2);
      expect(report.cases[0]).toMatchObject({
        name: "already captured",
        skipped: true,
        reason: "source-capture-already-exists",
      });
      expect(report.cases[1].skipped).toBeUndefined();
      expect(report.cases[1].args).toContain("effect_capture_id=2");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses to launch the source client unless explicitly allowed", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-source-capture-runner-"));
    try {
      const sourceRoot = createSourceRoot(dir);
      const manifestPath = join(dir, "manifest.json");
      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "would launch without guard",
            source: "original-client/effect.bmp",
            candidate: "pko-tools/effect.bmp",
            sourceCapture: { effectId: 1, time: 0 },
          },
        ],
      }));

      const result = spawnSync(process.execPath, [
        runnerScript,
        "--manifest",
        manifestPath,
        "--source-root",
        sourceRoot,
        "--effect-corpus-root",
        join(sourceRoot, "Client/client/effect"),
      ], { encoding: "utf8" });

      expect(result.status).toBe(1);
      const report = JSON.parse(result.stdout);
      expect(report.pass).toBe(false);
      expect(report.reason).toBe("launch-not-allowed");
      expect(report.dryRun).toBe(false);
      expect(report.allowLaunch).toBe(false);
      expect(report.cases[0].args).toContain("effect_capture_id=1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses allowed source-client launches unless a single case is selected", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-source-capture-runner-"));
    try {
      const sourceRoot = createSourceRoot(dir);
      const manifestPath = join(dir, "manifest.json");
      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "case one",
            source: "original-client/one.bmp",
            candidate: "pko-tools/one.bmp",
            sourceCapture: { effectId: 1, time: 0 },
          },
          {
            name: "case two",
            source: "original-client/two.bmp",
            candidate: "pko-tools/two.bmp",
            sourceCapture: { effectId: 2, time: 0.25 },
          },
        ],
      }));

      const result = spawnSync(process.execPath, [
        runnerScript,
        "--manifest",
        manifestPath,
        "--source-root",
        sourceRoot,
        "--effect-corpus-root",
        join(sourceRoot, "Client/client/effect"),
        "--game-exe",
        process.execPath,
        "--allow-launch",
      ], { encoding: "utf8" });

      expect(result.status).toBe(1);
      const report = JSON.parse(result.stdout);
      expect(report.pass).toBe(false);
      expect(report.reason).toBe("bulk-launch-not-allowed");
      expect(report.allowLaunch).toBe(true);
      expect(report.allowBulkLaunch).toBe(false);
      expect(report.cases).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports allowed launch failures with the source case name", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-source-capture-runner-"));
    try {
      const sourceRoot = createSourceRoot(dir);
      const manifestPath = join(dir, "manifest.json");
      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "failing capture case",
            source: "original-client/failing.bmp",
            candidate: "pko-tools/failing.bmp",
            sourceCapture: { effectId: 1, time: 0 },
          },
        ],
      }));

      const result = spawnSync(process.execPath, [
        runnerScript,
        "--manifest",
        manifestPath,
        "--source-root",
        sourceRoot,
        "--effect-corpus-root",
        join(sourceRoot, "Client/client/effect"),
        "--game-exe",
        process.execPath,
        "--case",
        "failing capture case",
        "--allow-launch",
      ], { encoding: "utf8" });

      expect(result.status).toBe(1);
      const report = JSON.parse(result.stdout);
      expect(report.pass).toBe(false);
      expect(report.failures).toEqual(["failing capture case"]);
      expect(report.cases[0]).toMatchObject({
        name: "failing capture case",
        pass: false,
        reason: "source-capture-failed",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("times out a source-client launch that does not exit", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-source-capture-runner-"));
    try {
      const sourceRoot = createSourceRoot(dir);
      const hangModule = join(dir, "hang-effect-capture.cjs");
      writeFileSync(
        hangModule,
        `
if (process.argv.some((arg) => String(arg).startsWith("effect_capture_"))) {
  process.on("uncaughtException", () => {});
  setInterval(() => {}, 1000);
}
`,
      );
      const manifestPath = join(dir, "manifest.json");
      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "hung capture case",
            source: "original-client/hung.bmp",
            candidate: "pko-tools/hung.bmp",
            sourceCapture: { effectId: 1, time: 0 },
          },
        ],
      }));

      const result = spawnSync(process.execPath, [
        runnerScript,
        "--manifest",
        manifestPath,
        "--source-root",
        sourceRoot,
        "--effect-corpus-root",
        join(sourceRoot, "Client/client/effect"),
        "--game-exe",
        process.execPath,
        "--case",
        "hung capture case",
        "--allow-launch",
        "--capture-timeout-ms",
        "50",
      ], {
        encoding: "utf8",
        env: {
          ...process.env,
          NODE_OPTIONS: `--require ${hangModule}`,
        },
      });

      expect(result.status).toBe(1);
      const report = JSON.parse(result.stdout);
      expect(report.captureTimeoutMs).toBe(50);
      expect(report.failures).toEqual(["hung capture case"]);
      expect(report.cases[0]).toMatchObject({
        name: "hung capture case",
        pass: false,
        reason: "source-capture-timeout",
        timedOut: true,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("quotes source output command values that contain spaces", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-source-capture-runner-"));
    try {
      const sourceRoot = createSourceRoot(dir);
      const manifestPath = join(dir, "manifest.json");
      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "path with spaces",
            source: "original client/magic hit.bmp",
            candidate: "pko-tools/magic-hit.bmp",
            sourceCapture: { effectId: 1001, time: 0.5 },
          },
        ],
      }));

      const output = execFileSync(process.execPath, [
        runnerScript,
        "--manifest",
        manifestPath,
        "--source-root",
        sourceRoot,
        "--effect-corpus-root",
        join(sourceRoot, "Client/client/effect"),
        "--dry-run",
      ], { encoding: "utf8" });

      const report = JSON.parse(output);
      const expectedOutput = join(dir, "original client/magic hit.bmp");
      expect(report.cases[0].output).toBe(expectedOutput);
      expect(report.cases[0].args).toContain(`effect_capture_out="${expectedOutput}"`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails when a requested case filter matches no cases", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-source-capture-runner-"));
    try {
      const sourceRoot = createSourceRoot(dir);
      const manifestPath = join(dir, "manifest.json");
      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "available case",
            source: "original-client/available.bmp",
            candidate: "pko-tools/available.bmp",
            sourceCapture: { effectId: 1, time: 0 },
          },
        ],
      }));

      const result = spawnSync(process.execPath, [
        runnerScript,
        "--manifest",
        manifestPath,
        "--source-root",
        sourceRoot,
        "--case",
        "missing case",
        "--dry-run",
      ], { encoding: "utf8" });

      expect(result.status).toBe(1);
      const report = JSON.parse(result.stdout);
      expect(report.pass).toBe(false);
      expect(report.reason).toBe("case-filter-matched-none");
      expect(report.caseFilter).toBe("missing case");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails before capture when the source preflight does not pass", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-source-capture-runner-"));
    try {
      const sourceRoot = createSourceRoot(dir, {
        modelEffCpp: "void CMPModelEff::Render() { g_Render.RenderLine(wx, wy, wz, wx, wy, wz + poleHeight, col); }",
      });
      const manifestPath = join(dir, "manifest.json");
      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "contaminated source",
            source: "original-client/effect.bmp",
            candidate: "pko-tools/effect.bmp",
            sourceCapture: { effectId: 1, time: 0 },
          },
        ],
      }));

      const result = spawnSync(process.execPath, [
        runnerScript,
        "--manifest",
        manifestPath,
        "--source-root",
        sourceRoot,
        "--effect-corpus-root",
        join(sourceRoot, "Client/client/effect"),
        "--dry-run",
      ], { encoding: "utf8" });

      expect(result.status).toBe(1);
      const report = JSON.parse(result.stdout);
      expect(report.pass).toBe(false);
      expect(report.reason).toBe("source-preflight-failed");
      expect(report.preflight.failures).toContain("debug-render-overlay");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("requires explicit sourceCapture metadata for every case", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-source-capture-runner-"));
    try {
      const sourceRoot = createSourceRoot(dir);
      const manifestPath = join(dir, "manifest.json");
      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "missing source capture",
            source: "original-client/effect.bmp",
            candidate: "pko-tools/effect.bmp",
          },
        ],
      }));

      const result = spawnSync(process.execPath, [
        runnerScript,
        "--manifest",
        manifestPath,
        "--source-root",
        sourceRoot,
        "--dry-run",
      ], { encoding: "utf8" });

      expect(result.status).toBe(1);
      const report = JSON.parse(result.stdout);
      expect(report.pass).toBe(false);
      expect(report.failures).toEqual(["missing source capture"]);
      expect(report.cases[0].reason).toBe("missing-source-capture");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports invalid source paths as structured case failures", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-source-capture-runner-"));
    try {
      const sourceRoot = createSourceRoot(dir);
      const manifestPath = join(dir, "manifest.json");
      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "missing source path",
            candidate: "pko-tools/effect.bmp",
            sourceCapture: { effectId: 1, time: 0 },
          },
        ],
      }));

      const result = spawnSync(process.execPath, [
        runnerScript,
        "--manifest",
        manifestPath,
        "--source-root",
        sourceRoot,
        "--dry-run",
      ], { encoding: "utf8" });

      expect(result.status).toBe(1);
      const report = JSON.parse(result.stdout);
      expect(report.pass).toBe(false);
      expect(report.failures).toEqual(["missing source path"]);
      expect(report.cases[0].reason).toBe("invalid-source-path");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports invalid direct particle source names as structured case failures", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-source-capture-runner-"));
    try {
      const sourceRoot = createSourceRoot(dir);
      const manifestPath = join(dir, "manifest.json");
      writeFileSync(manifestPath, JSON.stringify({
        schema: "pko-effect-pixel-corpus/v1",
        cases: [
          {
            name: "bad particle name",
            source: "original-client/effect.bmp",
            candidate: "pko-tools/effect.bmp",
            sourceCapture: { effectId: 1, parName: "bad/name", time: 0 },
          },
        ],
      }));

      const result = spawnSync(process.execPath, [
        runnerScript,
        "--manifest",
        manifestPath,
        "--source-root",
        sourceRoot,
        "--dry-run",
      ], { encoding: "utf8" });

      expect(result.status).toBe(1);
      const report = JSON.parse(result.stdout);
      expect(report.pass).toBe(false);
      expect(report.failures).toEqual(["bad particle name"]);
      expect(report.cases[0].reason).toBe("invalid-source-capture-par-name");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function createSourceRoot(
  baseDir: string,
  overrides: { modelEffCpp?: string } = {},
): string {
  const sourceRoot = join(baseDir, "source");
  mkdirSync(join(sourceRoot, "Engine/sdk/src"), { recursive: true });
  mkdirSync(join(sourceRoot, "Client/src"), { recursive: true });
  mkdirSync(join(sourceRoot, "Client/client/effect"), { recursive: true });
  mkdirSync(join(sourceRoot, "Client/bin/system"), { recursive: true });
  writeFileSync(join(sourceRoot, "Client/bin/system/Game.exe"), "fake game exe");
  writeFileSync(
    join(sourceRoot, "Engine/sdk/src/MPModelEff.cpp"),
    overrides.modelEffCpp ?? "void CMPModelEff::Render() { /* production render */ }",
  );
  writeFileSync(
    join(sourceRoot, "Engine/sdk/src/MPRender.cpp"),
    "void MPRender::CaptureScreen(char* strFilename) { SurfaceToBMP(0, strFilename, 0); }",
  );
  writeFileSync(
    join(sourceRoot, "Client/src/Main.cpp"),
    `
static bool RunEffectCaptureCommand(const std::string& commandLine) {
  if(commandLine.find("effect_capture_id=") == std::string::npos) return false;
  if(commandLine.find("effect_capture_par=") != std::string::npos) { CMPPartCtrl part; }
  if(commandLine.find("effect_capture_par_path=") != std::string::npos) { part.LoadFromFile(path); }
  if(commandLine.find("effect_capture_dummy1=") != std::string::npos && commandLine.find("effect_capture_dummy2=") != std::string::npos) { part.SetCaptureDummySpan(dummy1, dummy2); }
  g_Render.SetCurFrameTick(tick);
  effect->FrameMove(tick);
  g_Render.CaptureScreen((char*)outputPath.c_str());
  return true;
}
`,
  );
  writeFileSync(
    join(sourceRoot, "Client/src/GameAppInit.cpp"),
    `
BOOL CGameApp::_Init() {
  if(IsEffectCaptureCommand()) {
    _pCurScene = new CGameScene(param);
    _pCurScene->_CreateEffectArray(param.nMaxEff);
    _pCurScene->_CreateShadeArray(32);
    return TRUE;
  }
  return TRUE;
}
`,
  );
  return sourceRoot;
}
