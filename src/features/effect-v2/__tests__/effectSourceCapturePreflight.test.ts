import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "../../../..");
const preflightScript = join(repoRoot, "scripts/effect-source-capture-preflight.mjs");

describe("effect source capture preflight", () => {
  it("passes when source capture prerequisites are clean", () => {
    const sourceRoot = createSourceRoot({
      modelEffCpp: "void CMPModelEff::Render() { /* production render */ }",
      mpRenderCpp: "void MPRender::CaptureScreen(char* strFilename) { SurfaceToBMP(0, strFilename, 0); }",
    });
    try {
      const output = execFileSync(process.execPath, [
        preflightScript,
        "--source-root",
        sourceRoot,
      ], { encoding: "utf8" });

      const report = JSON.parse(output);
      expect(report.pass).toBe(true);
      expect(report.failures).toEqual([]);
      expect(report.checks.every((check: { pass: boolean; message: string }) =>
        check.pass && !/missing|not found|does not|appears to/i.test(check.message),
      )).toBe(true);
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
    }
  });

  it("fails when the deterministic effect capture command entrypoint is missing", () => {
    const sourceRoot = createSourceRoot({
      modelEffCpp: "void CMPModelEff::Render() { /* production render */ }",
      mpRenderCpp: "void MPRender::CaptureScreen(char* strFilename) { SurfaceToBMP(0, strFilename, 0); }",
      mainCpp: "int APIENTRY _tWinMain() { return 0; }",
    });
    try {
      const result = spawnSync(process.execPath, [
        preflightScript,
        "--source-root",
        sourceRoot,
      ], { encoding: "utf8" });

      expect(result.status).toBe(1);
      const report = JSON.parse(result.stdout);
      expect(report.pass).toBe(false);
      expect(report.failures).toContain("capture-command-entrypoint");
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
    }
  });

  it("fails when the direct particle capture command entrypoint is missing", () => {
    const sourceRoot = createSourceRoot({
      modelEffCpp: "void CMPModelEff::Render() { /* production render */ }",
      mpRenderCpp: "void MPRender::CaptureScreen(char* strFilename) { SurfaceToBMP(0, strFilename, 0); }",
      mainCpp: `
static bool RunEffectCaptureCommand(const std::string& commandLine) {
  if(commandLine.find("effect_capture_id=") == std::string::npos) return false;
  g_Render.SetCurFrameTick(tick);
  effect->FrameMove(tick);
  g_Render.CaptureScreen((char*)outputPath.c_str());
  return true;
}
`,
    });
    try {
      const result = spawnSync(process.execPath, [
        preflightScript,
        "--source-root",
        sourceRoot,
      ], { encoding: "utf8" });

      expect(result.status).toBe(1);
      const report = JSON.parse(result.stdout);
      expect(report.pass).toBe(false);
      expect(report.failures).toContain("capture-particle-command-entrypoint");
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
    }
  });


  it("fails when capture mode does not initialize a minimal renderable scene", () => {
    const sourceRoot = createSourceRoot({
      modelEffCpp: "void CMPModelEff::Render() { /* production render */ }",
      mpRenderCpp: "void MPRender::CaptureScreen(char* strFilename) { SurfaceToBMP(0, strFilename, 0); }",
      gameAppInitCpp: "BOOL CGameApp::_Init() { return TRUE; }",
    });
    try {
      const result = spawnSync(process.execPath, [
        preflightScript,
        "--source-root",
        sourceRoot,
      ], { encoding: "utf8" });

      expect(result.status).toBe(1);
      const report = JSON.parse(result.stdout);
      expect(report.pass).toBe(false);
      expect(report.failures).toContain("capture-minimal-scene-init");
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
    }
  });

  it("fails when debug render overlays would contaminate golden captures", () => {
    const sourceRoot = createSourceRoot({
      modelEffCpp: "void CMPModelEff::Render() { g_Render.RenderLine(wx, wy, wz, wx, wy, wz + poleHeight, col); }",
      mpRenderCpp: "void MPRender::CaptureScreen(char* strFilename) { SurfaceToBMP(0, strFilename, 0); }",
    });
    try {
      const result = spawnSync(process.execPath, [
        preflightScript,
        "--source-root",
        sourceRoot,
      ], { encoding: "utf8" });

      expect(result.status).toBe(1);
      const report = JSON.parse(result.stdout);
      expect(report.pass).toBe(false);
      expect(report.failures).toContain("debug-render-overlay");
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
    }
  });

  it("allows the effect corpus to live outside the clean source checkout", () => {
    const sourceRoot = createSourceRoot({
      modelEffCpp: "void CMPModelEff::Render() { /* production render */ }",
      mpRenderCpp: "void MPRender::CaptureScreen(char* strFilename) { SurfaceToBMP(0, strFilename, 0); }",
    });
    const externalCorpus = mkdtempSync(join(tmpdir(), "effect-source-corpus-"));
    try {
      rmSync(join(sourceRoot, "Client/client/effect"), { recursive: true, force: true });

      const output = execFileSync(process.execPath, [
        preflightScript,
        "--source-root",
        sourceRoot,
        "--effect-corpus-root",
        externalCorpus,
      ], { encoding: "utf8" });

      const report = JSON.parse(output);
      expect(report.pass).toBe(true);
      expect(report.checks.find((check: { id: string }) => check.id === "effect-corpus")?.path)
        .toBe(externalCorpus);
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
      rmSync(externalCorpus, { recursive: true, force: true });
    }
  });

  it("accepts the pnpm argument separator used by documented commands", () => {
    const sourceRoot = createSourceRoot({
      modelEffCpp: "void CMPModelEff::Render() { /* production render */ }",
      mpRenderCpp: "void MPRender::CaptureScreen(char* strFilename) { SurfaceToBMP(0, strFilename, 0); }",
    });
    try {
      const output = execFileSync(process.execPath, [
        preflightScript,
        "--",
        "--source-root",
        sourceRoot,
      ], { encoding: "utf8" });

      const report = JSON.parse(output);
      expect(report.pass).toBe(true);
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
    }
  });
});

function createSourceRoot(files: {
  modelEffCpp: string;
  mpRenderCpp: string;
  mainCpp?: string;
  gameAppInitCpp?: string;
}): string {
  const sourceRoot = mkdtempSync(join(tmpdir(), "effect-source-preflight-"));
  mkdirSync(join(sourceRoot, "Engine/sdk/src"), { recursive: true });
  mkdirSync(join(sourceRoot, "Client/src"), { recursive: true });
  mkdirSync(join(sourceRoot, "Client/client/effect"), { recursive: true });
  writeFileSync(join(sourceRoot, "Engine/sdk/src/MPModelEff.cpp"), files.modelEffCpp);
  writeFileSync(join(sourceRoot, "Engine/sdk/src/MPRender.cpp"), files.mpRenderCpp);
  writeFileSync(
    join(sourceRoot, "Client/src/Main.cpp"),
    files.mainCpp ?? `
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
    files.gameAppInitCpp ?? `
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
