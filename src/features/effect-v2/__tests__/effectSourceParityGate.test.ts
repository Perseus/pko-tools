import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "../../../..");
const sourceParityScript = join(repoRoot, "scripts/effect-source-parity-gate.mjs");

describe("effect source parity gate", () => {
  it("is exposed as a package script", () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));

    expect(pkg.scripts["test:effect-source-parity"]).toBe(
      "node scripts/effect-source-parity-gate.mjs",
    );
  });

  it("passes when TS renderer dispatch matches C++ effect source tables", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-source-parity-"));
    try {
      const sourceRoot = join(dir, "source");
      const fakeRepo = join(dir, "repo");
      writeFakeSource(sourceRoot);
      writeFakeRepo(fakeRepo, { groupDefaultReturnsNull: true });

      const output = execFileSync(process.execPath, [
        sourceParityScript,
        "--source-root",
        sourceRoot,
        "--repo-root",
        fakeRepo,
      ], { encoding: "utf8" });

      const report = JSON.parse(output);
      expect(report.pass).toBe(true);
      expect(report.particleTypes).toHaveLength(18);
      expect(report.particleImplementations).toHaveLength(18);
      expect(report.particleImplementations.find((entry: { sourceName: string }) =>
        entry.sourceName === "ARRAW"
      )).toMatchObject({
        sourceName: "ARRAW",
        cppSuffix: "Arraw",
        tsName: "ARROW",
        systemFile: "ArrowSystem.tsx",
        kinematicsFile: "arrowKinematics.ts",
        testFile: "ArrowKinematics.test.ts",
      });
      expect(report.magicFlightPaths).toEqual([
        "drop",
        "fly",
        "trace",
        "fshade",
        "arc",
        "dirlight",
        "dist",
      ]);
      expect(report.magicGroupModes).toEqual(["fan", "sequence"]);
      expect(report.effectTypes).toEqual([
        { sourceName: "EFFECT_NONE", value: 0, tsCoverage: "base" },
        { sourceName: "EFFECT_FRAMETEX", value: 1, tsCoverage: "frameTexture" },
        { sourceName: "EFFECT_MODELUV", value: 2, tsCoverage: "uvCoords" },
        { sourceName: "EFFECT_MODELTEXTURE", value: 3, tsCoverage: "uvTextureFrames" },
        { sourceName: "EFFECT_MODEL", value: 4, tsCoverage: "externalModel" },
      ]);
      expect(report.effectMeshes).toEqual({
        procedural: ["Triangle", "TrianglePlane", "Rect", "RectZ", "RectPlane", "Cylinder", "Cone"],
        nonProceduralTob: ["Sphere"],
      });
      expect(report.effectShaderPath).toBe("shader\\dx8\\eff.fx");
      expect(report.renderTechniques.find((entry: { index: number }) =>
        entry.index === 0
      )).toMatchObject({
        index: 0,
        addressU: "CLAMP",
        addressV: "CLAMP",
        alphaBlendEnable: true,
        zEnable: true,
        zWriteEnable: false,
      });
      expect(report.renderTechniques.find((entry: { index: number }) =>
        entry.index === 5
      )).toMatchObject({
        index: 5,
        cullMode: "CCW",
        minFilter: "Point",
        magFilter: "Point",
        zEnable: false,
        srcBlend: "SrcAlpha",
        destBlend: "InvSrcAlpha",
      });
      expect(report.alphaMaterialPaths).toMatchObject({
        defaultAlphaTrue: true,
        savedAlpha: true,
        versionedAlphaLoad: true,
        alphaFalseDisablesBlend: true,
        textureFactorColorModulate: true,
        textureFactorAlphaModulate: true,
        particleNestedEffectSetAlpha: true,
        rustAlphaVersionGate: true,
        tsTextureFactorColorSrgb: true,
        tsAlphaFalseDisablesBlend: true,
        tsTextureAlphaMultipliedByMaterial: true,
        tsParticleNestedEffectOpacity: true,
      });
      expect(report.textureUploadPath).toMatchObject({
        effectRequestsA4R4G4B4: true,
        lwLoadTexUsesDefaultTexInfo: true,
        defaultNoColorKey: true,
        uploadForcesA8R8G8B8: true,
        d3dxReceivesSourceColorKey: true,
        tsPreservesDecodedAlpha: true,
        tsDoesNotColorKeyBlack: true,
      });
      expect(report.billboardTransformPaths).toMatchObject({
        sourceBillboardIsInverseViewNoTranslation: true,
        sourceEffectBillboardMultipliesAfterAuthoredTransform: true,
        sourceRotaBoardCanDiscardAuthoredRotation: true,
        sourceParticleBillboardBindsInverseViewAtParticlePosition: true,
        sourceParticleFrameMovePremultipliesBillboard: true,
        tsSubEffectBillboardUsesParentLocalCameraQuaternion: true,
        tsParticleBillboardUsesParentLocalCameraQuaternion: true,
      });
      expect(report.particleBuiltinMeshes).toEqual([
        "Triangle",
        "Rect",
        "RectPlane",
        "TrianglePlane",
        "RectZ",
        "Cone",
        "Cylinder",
      ]);
      expect(report.particleResourceBindingPath).toMatchObject({
        sourceBindingResFound: true,
        sourceMeshLookupBeforeEffectLookup: true,
        sourceMeshIdBindsModel: true,
        sourceEffectIdBindsNestedEffect: true,
        tsNestedEffectUsesEffExtension: true,
        tsBuiltinGeometryBeforeExternalModel: true,
        tsExternalModelOnlyWhenNoBuiltin: true,
        tsParticleDirectModelDoubleSided: true,
      });
      expect(report.particlePlaybackPath).toMatchObject({
        sourceSetLoopFound: true,
        sourceUpdateDelayFound: true,
        sourceSetLoopReplaysNestedEffectsWithInverseLoop: true,
        sourceLoopClearsPlayTime: true,
        sourcePlayMapsZeroToLoop: true,
        sourceUpdateDelayStopsAtFinitePlayTime: true,
        sourceUpdateDelayDefersFinitePlayTimeUntilDelay: true,
        sourceStopDrainsSnowFireShrink: true,
        sourceFireDrainClearsPlayAfterLiveParticlesDie: true,
        sourceShrinkDrainClearsPlayAfterTargetsReached: true,
        sourceModelStripArrowNestedEffectsUseInverseLoop: true,
        sourceBlastLoopRestarts: true,
        sourceBlast2Blast3IgnoreLoopAtEnd: true,
        sourceFireSendsHitEffect: true,
        sourceRange2SendsHitEffect: true,
        sourceSetItemDummyGatesLineRound: true,
        sourceDummyRequiresDummySpanAndMoves: true,
        tsStandaloneWorkbenchReplaysPreviewWithoutPropagatingLoop: true,
        tsStandaloneParticleReceivesLoopProp: true,
        tsDummySpanRoutingMatchesSetItemDummy: true,
        tsDummyRequiresDummySpanAndMoves: true,
        tsNestedEffectLoopMatchesSourceSpecialCases: true,
        tsParticleRendererRoutesHitEffects: true,
        tsFireSendsHitEffect: true,
        tsRange2SendsHitEffect: true,
        tsFinitePlayTimeExpiresLikeUpdateDelay: true,
        tsLoopModeIgnoresFinitePlayTime: true,
        tsLoopRestartCanMatchSourceExceptions: true,
        tsFiniteStopDrainBehaviorExists: true,
        tsSnowFireShrinkOptIntoDrainStop: true,
        tsScrubRewindResetsTimeline: true,
        sourceRangePinsOldPosToRuntimePos: true,
        sourceFrameMoveAppliesEffPathToRuntimePos: true,
        tsLifecycleAppliesEffPathToSpawnPosition: true,
        sourceRange2CreatesThroughStepAccumulator: true,
        sourceRangeRange2UseBoundResourceRenderPath: true,
        sourceRangePathRotatesNestedEffect: true,
        sourceRangePathEndStopsOrResetsNestedEffect: true,
        sourceRange2CreateRotatesNestedEffect: true,
        tsRangeRenderUsesUpdateDelayVisibility: true,
        tsRangePinsParticlesToRuntimeEmitter: true,
        tsRangeAppliesEffPathRuntimePosition: true,
        tsRangePathRotatesNestedEffect: true,
        tsRangePathEndStopsOrResetsNestedEffect: true,
        tsRangeRange2RenderThroughParticleVisual: true,
        tsRangeRange2UseSharedNestedEffectClock: true,
        tsRange2NestedEffectRotatesWithoutModelDir: true,
        tsRange2UsesScrubTimeline: true,
        tsRange2UsesUpdateDelayVisibility: true,
      });
      expect(report.particleModelDirPath).toMatchObject({
        sourceDirRotationHelperExists: true,
        sourceModelDirTempDirDefaultsZero: true,
        sourceSetDirPopulatesFireSystemDirAndTempDir: true,
        sourceCreateFireModelDirOverwritesOldPosXYWithTempAngles: true,
        sourceSetDirPopulatesTempDirForModelStrip: true,
        sourceFrameMoveUsesTempDirForModelStrip: true,
        tsModelDirUsesRuntimeSourceDirection: true,
        tsModelStripIgnoresSerializedDirectionWithoutRuntimeSetDir: true,
        tsFireModelDirUsesSourceAnglesForMovement: true,
      });
      expect(report.particleModelPlacementPath).toMatchObject({
        sourceMoveToAppliesEmitterMinusHalfRangePlusOffset: true,
        sourceFrameMoveModelPinsToRangeCenter: true,
        sourceFrameMoveArrowPinsToRangeCenter: true,
        sourceFrameMoveStripPinsToBasePos: true,
        sourceFrameMoveShadePinsToBasePos: true,
        sourceFrameMoveRoundPinsToRangeCenter: true,
        sourceModelStripStopWhenNestedEffectStops: true,
        sourceStandaloneStripRequiresAttachedDummySource: true,
        tsModelSpawnUsesOffsetAsLocalCenter: true,
        tsModelMovePinsToEmitterPlusOffset: true,
        tsModelSystemPassesRuntimeEmitterToMove: true,
        tsPinnedSingleParticleSystemsApplyEffPathOffset: true,
        tsModelStripStopWhenNestedEffectCompletes: true,
        tsArrowMovePinsToEmitterPlusOffset: true,
        tsStripMovePinsToEmitterPlusBasePos: true,
        tsDetachedStripDoesNotSynthesizePreview: true,
        tsShadeMovePinsToEmitterPlusBasePos: true,
        tsRoundMovePinsToEmitterPlusPathOffset: true,
      });
      expect(report.standaloneStripPath).toMatchObject({
        sourceStripTextureLoadStripsDdsTga: true,
        sourceStripRenderDrawsOnlyAfterTwoTrackControls: true,
        sourceStripTrackFadeBeforeAgeIncrement: true,
        sourceStripGetTrackSamplesDummyTranslationsInOrder: true,
        rustParLoaderNormalizesStripTextureName: true,
        tsStripRendererRequiresRuntimeDummySpan: true,
        tsStripTrailUsesTriangleStripPrimitiveCount: true,
        tsStripTrackFadeTestMatchesSource: true,
        tsStripDummyOrderTestMatchesSource: true,
      });
      expect(report.magicOrientationPath).toMatchObject({
        sourceEmissionFlattensDirlightTarget: true,
        sourceEmissionRotatesModelsWithRotatingXZ: true,
        sourceResetDirRotatesModelsWithRotatingXZ: true,
        sourceOnlyTraceCallsResetDir: true,
        tsEmissionDirectionFlattensDirlightTarget: true,
        tsInitialOrientationUsesEmissionDirection: true,
        tsReaimsOnlyWhenPathSuppliesOrientationDirection: true,
        tsTraceSuppliesResetDirOrientation: true,
        tsNonTracePathsDoNotSupplyResetDirOrientation: true,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails when an unknown magic group render index falls through to a fallback renderer", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-source-parity-"));
    try {
      const sourceRoot = join(dir, "source");
      const fakeRepo = join(dir, "repo");
      writeFakeSource(sourceRoot);
      writeFakeRepo(fakeRepo, { groupDefaultReturnsNull: false });

      const result = spawnSync(process.execPath, [
        sourceParityScript,
        "--source-root",
        sourceRoot,
        "--repo-root",
        fakeRepo,
      ], { encoding: "utf8" });

      expect(result.status).toBe(1);
      const report = JSON.parse(result.stdout);
      expect(report.pass).toBe(false);
      expect(report.failures).toContain(
        "MagicGroupRenderer must return null for render_idx values outside C++ GroupList[].",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails when a C++ EFFECT_TYPE has no matching TS render branch", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-source-parity-"));
    try {
      const sourceRoot = join(dir, "source");
      const fakeRepo = join(dir, "repo");
      writeFakeSource(sourceRoot);
      writeFakeRepo(fakeRepo, {
        groupDefaultReturnsNull: true,
        includeModelUvBranch: false,
      });

      const result = spawnSync(process.execPath, [
        sourceParityScript,
        "--source-root",
        sourceRoot,
        "--repo-root",
        fakeRepo,
      ], { encoding: "utf8" });

      expect(result.status).toBe(1);
      const report = JSON.parse(result.stdout);
      expect(report.pass).toBe(false);
      expect(report.failures).toContain(
        "applySubEffectFrame must handle C++ EFFECT_MODELUV (2) with coordList UV interpolation.",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails when a C++ particle frame path has no TS kinematics test", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-source-parity-"));
    try {
      const sourceRoot = join(dir, "source");
      const fakeRepo = join(dir, "repo");
      writeFakeSource(sourceRoot);
      writeFakeRepo(fakeRepo, {
        groupDefaultReturnsNull: true,
        omitParticleKinematicsTest: "ArrowKinematics.test.ts",
      });

      const result = spawnSync(process.execPath, [
        sourceParityScript,
        "--source-root",
        sourceRoot,
        "--repo-root",
        fakeRepo,
      ], { encoding: "utf8" });

      expect(result.status).toBe(1);
      const report = JSON.parse(result.stdout);
      expect(report.pass).toBe(false);
      expect(report.failures).toContain(
        "C++ PARTTICLE_ARRAW must have TS kinematics coverage in src/features/effect-v2/__tests__/ArrowKinematics.test.ts.",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails when TS render technique state diverges from shader/dx8/eff.fx", () => {
    const dir = mkdtempSync(join(tmpdir(), "effect-source-parity-"));
    try {
      const sourceRoot = join(dir, "source");
      const fakeRepo = join(dir, "repo");
      writeFakeSource(sourceRoot);
      writeFakeRepo(fakeRepo, {
        groupDefaultReturnsNull: true,
        techniqueZeroAddress: "WRAP",
      });

      const result = spawnSync(process.execPath, [
        sourceParityScript,
        "--source-root",
        sourceRoot,
        "--repo-root",
        fakeRepo,
      ], { encoding: "utf8" });

      expect(result.status).toBe(1);
      const report = JSON.parse(result.stdout);
      expect(report.pass).toBe(false);
      expect(report.failures).toContain(
        "pkoStateEmulation technique 0 addressU must match shader/dx8/eff.fx CLAMP.",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function writeFakeSource(sourceRoot: string): void {
  mkdirSync(join(sourceRoot, "Engine/sdk/include"), { recursive: true });
  mkdirSync(join(sourceRoot, "Client/src"), { recursive: true });
  mkdirSync(join(sourceRoot, "Client/client/shader/dx8"), { recursive: true });

  const particleDefines = [
    ["SNOW", 1],
    ["FIRE", 2],
    ["BLAST", 3],
    ["RIPPLE", 4],
    ["MODEL", 5],
    ["STRIP", 6],
    ["WIND", 7],
    ["ARRAW", 8],
    ["ROUND", 9],
    ["BLAST2", 10],
    ["BLAST3", 11],
    ["SHRINK", 12],
    ["SHADE", 13],
    ["RANGE", 14],
    ["RANGE2", 15],
    ["DUMMY", 16],
    ["LINE_SINGLE", 17],
    ["LINE_ROUND", 18],
  ];

  writeFileSync(
    join(sourceRoot, "Engine/sdk/include/MPParticleSys.h"),
    [
      ...particleDefines.map(([name, value]) => `#define PARTTICLE_${name} ${value}`),
      "",
      "inline void GetDirRotation(D3DXVECTOR2* pOut, D3DXVECTOR3* pDir) {}",
      "void SetItemDummy(MPSceneItem* pItem, int idummy1, int idummy2) {",
      "  if(_iType != PARTTICLE_DUMMY && _iType != PARTTICLE_LINE_SINGLE)",
      "    return;",
      "  _pItem = pItem;",
      "  _iDummy1 = idummy1;",
      "  _iDummy2 = idummy2;",
      "}",
      ...particleDefines.flatMap(([name]) => {
        const suffix = cppParticleSuffix(String(name));
        return [
          `bool _Create${suffix}(CMPPartSys* pPart,CMPParticle* pCtrl);`,
          `void _FrameMove${suffix}(CMPPartSys* pPart,DWORD dwDailTime);`,
        ];
      }),
    ].join("\n"),
  );

  mkdirSync(join(sourceRoot, "Engine/sdk/src"), { recursive: true });
  writeFileSync(
    join(sourceRoot, "Engine/sdk/src/MPParticleSys.cpp"),
    [
      ...particleDefines.flatMap(([name]) => {
      const suffix = cppParticleSuffix(String(name));
      return [
        `bool _Create${suffix}(CMPPartSys* pPart,CMPParticle* pCtrl) { return true; }`,
        `void _FrameMove${suffix}(CMPPartSys* pPart,DWORD dwDailTime) {}`,
      ];
      }),
      `
void CMPPartSys::RenderSoft()
{
  if(_bBillBoard)
  {
    D3DXMATRIX tm = *_SpmatBBoard;
    tm._41 = pParticle->m_vPos.x;
    tm._42 = pParticle->m_vPos.y;
    tm._43 = pParticle->m_vPos.z;
    pPart->BindingBone(tm,true);
  }
  if(pParticle->m_SCurColor.a < 1.0f)
    pPart->SetAlpha(pParticle->m_SCurColor.a);
  pPart->Render();
}
void _FrameMoveBillboardSample(CMPPartSys* pPart)
{
  D3DXMatrixMultiply(&pParticle->m_SCurMat,pPart->_SpmatBBoard, &pParticle->m_SCurMat);
}
void CMPPartSys::CMPPartSys()
{
  _vTemDir = D3DXVECTOR2(0,0);
}
void CMPPartSys::BindingRes(CMPResManger* pCResMagr)
{
  int id = pCResMagr->GetMeshID(_strModelName);
  if(id < 0)
  {
    id = pCResMagr->GetEffectID(_strModelName);
    if(id >= 0)
    {
      _CPPart = new CMPModelEff[1];
      _CPPart->BindingEffect(pCResMagr->GetEffectByID(id));
    }
  }
  else
  {
    _pCModel = pCResMagr->GetMeshByID(id);
  }
}
void CMPPartSys::SetLoop(bool bLoop)
{
  _bLoop = bLoop;
  if(_CPPart)
    _CPPart->Play(!_bLoop);
  if(_bLoop)
    SetPlayTime(0);
}
bool CMPPartSys::UpdateDelay()
{
  if(_fPlayTime <= 0)
    return true;
  if(_fDelayTime <= 0)
  {
    if(_fCurPlayTime >= _fPlayTime)
    {
      Stop();
      return _bPlay;
    }
    return true;
  }
  if(_fCurPlayTime >= _fDelayTime)
  {
    if(_fCurPlayTime >= _fPlayTime)
    {
      Stop();
      return _bPlay;
    }
    return true;
  }
  return false;
}
void CMPPartSys::Play(int iTime)
{
  switch(_iType)
  {
  case PARTTICLE_MODEL:
    _bLoop = iTime == 0 ? true : false;
    if(_CPPart)
      _CPPart->Play(!_bLoop);
    return;
  case PARTTICLE_STRIP:
    _bLoop = iTime == 0 ? true : false;
    if(_CPPart)
      _CPPart->Play(!_bLoop);
    return;
  case PARTTICLE_ARRAW:
    _bLoop = iTime == 0 ? true : false;
    if(_CPPart)
      _CPPart->Play(!_bLoop);
    return;
  }
}
void CMPPartSys::setDir(float fx, float fy, float fz)
{
  switch(_iType)
  {
  case PARTTICLE_FIRE:
    SetSysDirX(fx);
    SetSysDirY(fy);
    SetSysDirZ(fz);
    GetDirRotation(&_vTemDir, &vDir);
    break;
  case PARTTICLE_MODEL:
  case PARTTICLE_STRIP:
    D3DXVECTOR3 vDir(fx,fy,fz);
    GetDirRotation(&_vTemDir, &vDir);
    break;
  }
}
void CMPPartSys::FrameMoveModelDir()
{
  if(_iType == PARTTICLE_MODEL || _iType == PARTTICLE_STRIP)
  {
    RotatingXZ(&mat,_vTemDir.x, _vTemDir.y);
  }
}
void CMPPartSys::MoveTo(D3DXVECTOR3* vPos,MPMap* pmap)
{
  _vPos = D3DXVECTOR3(vPos->x - _fRange[0] / 2, vPos->y - _fRange[1] / 2, vPos->z - _fRange[2] / 2);
  _vPos += _vOffset;
}
void _FrameMoveModel(CMPPartSys* pPart,DWORD dwDailTime)
{
  pParticle->m_vPos = pPart->_vPos + D3DXVECTOR3(pPart->_fRange[0] / 2, pPart->_fRange[1] / 2, pPart->_fRange[2] / 2);
  if(pPart->_CPPart)
  {
    pPart->_CPPart->FrameMove(dwDailTime);
    if(!pPart->_CPPart->IsPlay())
      pPart->_bPlay = false;
  }
}
void _FrameMoveArraw(CMPPartSys* pPart,DWORD dwDailTime)
{
  pParticle->m_vPos = pPart->_vPos + D3DXVECTOR3(pPart->_fRange[0] / 2, pPart->_fRange[1] / 2, pPart->_fRange[2] / 2);
}
void _FrameMoveStrip(CMPPartSys* pPart,DWORD dwDailTime)
{
  pParticle->m_vPos = pPart->_vPos;
  if(pPart->_CPPart)
  {
    pPart->_CPPart->FrameMove(dwDailTime);
    if(!pPart->_CPPart->IsPlay())
      pPart->_bPlay = false;
  }
}
void _FrameMoveShade(CMPPartSys* pPart,DWORD dwDailTime)
{
  pParticle->m_vPos = pPart->_vPos;
  pPart->m_cShade.MoveTo(pParticle->m_vPos,pPart->m_pMap);
}
bool _CreateDummy(CMPPartSys* pPart,CMPParticle* pCtrl)
{
  D3DXVec3Normalize(&pCtrl->m_vOldPos,&pPart->_vDir);
  float dist = Randf(pPart->_fDummyDist, pPart->_iParNum);
  pCtrl->m_vPos = pPart->_vDummyPos + pPart->_vDummyDir * dist;
  return true;
}
void _FrameMoveDummy(CMPPartSys* pPart,DWORD dwDailTime)
{
  if(!pPart->GetDummyPosList())
    pPart->_bPlay = false;
  pParticle->m_vVel = pParticle->m_vOldPos * (pPart->_fVecl * *pPart->_pfDailTime);
  pParticle->m_vPos += pParticle->m_vVel;
}
void _FrameMoveRound(CMPPartSys* pPart,DWORD dwDailTime)
{
  D3DXVec3Transform(&pos,&pParticle->m_vOldPos,&mat);
  D3DXVECTOR3 vt = pPart->_vPos + D3DXVECTOR3(pPart->_fRange[0] / 2,pPart->_fRange[1] / 2,pPart->_fRange[2] / 2);
  pParticle->m_vPos += vt;
}
bool _CreateFire(CMPPartSys* pPart,CMPParticle* pCtrl)
{
  D3DXVec3Normalize(&pCtrl->m_vOldPos,&pPart->_vDir);
  if(pPart->_bModelDir&& pPart->_CPPart)
  {
    pCtrl->m_vOldPos.x = pPart->_vTemDir.x;
    pCtrl->m_vOldPos.y = pPart->_vTemDir.y;
  }
  return true;
}
void CMPPartSys::Stop()
{
  switch(_iType)
  {
  case PARTTICLE_SNOW:
  case PARTTICLE_FIRE:
    _bStop = true;
    break;
  case PARTTICLE_SHRINK:
    _wDeath = 0;
    _bStop = true;
    break;
  }
}
void _FrameMoveFire(CMPPartSys* pPart,DWORD dwDailTime)
{
  if(pPart->m_strHitEff != "" )
  {
    if(pPart->_pcPath->IsEnd())
      pPart->m_pCResMagr->SendResMessage(pPart->m_strHitEff,VPos,pPart->m_pMap);
    if(pPart->_vPos.z<= 0.1f||pPart->_vPos.z > 50.0f)
      pPart->m_pCResMagr->SendResMessage(pPart->m_strHitEff,*pPart->_pcPath->GetEnd(),NULL);
  }
  if(pPart->_bStop)
  {
    pPart->_wDeath++;
    pPart->_bPlay = false;
  }
}
void _FrameMoveRange2(CMPPartSys* pPart,DWORD dwDailTime)
{
  if(pParticle->m_vPos.z < fei ||pParticle->m_vPos.z > 50.0f)
    pPart->m_pCResMagr->SendResMessage(pPart->m_strHitEff,pParticle->m_vPos,pPart->m_pMap);
  if(pParticle->m_vPos.z< 0||pParticle->m_vPos.z > 50.0f)
    pPart->m_pCResMagr->SendResMessage(pPart->m_strHitEff,pParticle->m_vPos,pPart->m_pMap);
}
void _FrameMoveShrink(CMPPartSys* pPart,DWORD dwDailTime)
{
  if(PointPointRange(&pParticle->m_vPos, &pParticle->m_vOldPos, 0.5f))
  {
    pParticle->m_bLive = false;
    if(pPart->_bStop)
    {
      pPart->_bPlay = false;
    }
  }
}
void _FrameMoveBlast(CMPPartSys* pPart,DWORD dwDailTime)
{
  if(wCurFrame == pPart->_wFrameCount)
  {
    if(pPart->_bLoop)
      _CreateBlast(pPart,NULL);
  }
}
void _FrameMoveBlast2(CMPPartSys* pPart,DWORD dwDailTime)
{
  if(wCurFrame == pPart->_wFrameCount)
  {
    pPart->_bPlay = false;
    return;
  }
}
void _FrameMoveBlast3(CMPPartSys* pPart,DWORD dwDailTime)
{
  if(wCurFrame == pPart->_wFrameCount)
  {
    pPart->_bPlay = false;
    return;
  }
}
bool _CreateRange2(CMPPartSys* pPart,CMPParticle* pCtrl)
{
  pPart->_fCurTime += *pPart->_pfDailTime;
  if(pPart->_CPPart)
  {
    pPart->_CPPart->RotatingXZ(dirxz[0], dirxz[1]);
  }
  if(pPart->_fCurTime >= pPart->_fStep)
    return true;
  return false;
}
void _FrameMoveRange(CMPPartSys* pPart,DWORD dwDailTime)
{
  if(pPart->_CPPart)
  {
    if(pPart->_pcPath)
    {
      if(pPart->_fLife > 1)
      {
        if(pPart->_pcPath->IsEnd())
        {
          pPart->_wDeath++;
          if(pPart->_wDeath >= (int)pPart->_fLife)
          {
            pPart->_bPlay = false;
            return;
          }
          _CreateRange(pPart,NULL);
          pPart->_pcPath->Reset();
          return;
        }
      }
      D3DXVECTOR3* pstart = pPart->_pcPath->GetNextPos();
      D3DXVECTOR3* pend = pPart->_pcPath->GetCurPos();
      D3DXVECTOR3 vdir = *pend - *pstart;
      pPart->_CPPart->RotatingXZ(dirxz[0], dirxz[1]);
    }
    pPart->_CPPart->FrameMove(dwDailTime);
  }
  pParticle->m_vPos = pParticle->m_vOldPos + pPart->_vPos;
}
void CMPPartSys::FrameMove(DWORD dwDailTime)
{
  if(_pcPath)
  {
    _pcPath->FrameMove(*_pfDailTime);
    _vPos = _vSavePos + *_pcPath->GetCurPos();
  }
  FrameUpdate(this,dwDailTime);
}
void _FrameMoveRange2(CMPPartSys* pPart,DWORD dwDailTime)
{
  if(pPart->_CPPart)
    pPart->_CPPart->FrameMove(dwDailTime);
}
`,
    ].join("\n"),
  );

  writeFileSync(
    join(sourceRoot, "Engine/sdk/src/MPEffectCtrl.cpp"),
    `
void CMagicCtrl::Emission(D3DXVECTOR3* vStart,D3DXVECTOR3* vTarget)
{
  _vTarget = *vTarget;
  if(_iRnederIdx == 5)
  {
    _vTarget.z = _vPos.z;
  }
  for (int n = 0; n < _iModelNum; n++)
  {
    _CpModel[n]->RotatingXZ(_fDirXZ[0], _fDirXZ[1]);
  }
}
void CMagicCtrl::ResetDir(D3DXVECTOR3* vTarget)
{
  for (int n = 0; n < _iModelNum; n++)
  {
    _CpModel[n]->RotatingXZ(_fDirXZ[0], _fDirXZ[1]);
  }
}
`,
  );

  writeFileSync(
    join(sourceRoot, "Engine/sdk/src/I_Effect.cpp"),
    `
I_Effect::I_Effect(void)
{
  _bAlpha = true;
}
bool I_Effect::SaveToFile(FILE* pFile)
{
  fwrite(&_bAlpha, sizeof(bool), 1, pFile);
  return true;
}
bool I_Effect::LoadFromFile(FILE* pFile, DWORD dwVersion)
{
  if (dwVersion > 5)
    fread(&_bAlpha, sizeof(bool), 1, pFile);
  return true;
}
`,
  );

  writeFileSync(
    join(sourceRoot, "Engine/sdk/src/MPModelEff.cpp"),
    `
void CMPModelEff::RenderSoft()
{
  m_pCEffectFile->m_pDev->SetTextureStageState(0, D3DTSS_COLORARG1, D3DTA_TEXTURE);
  m_pCEffectFile->m_pDev->SetTextureStageState(0, D3DTSS_COLORARG2, D3DTA_TFACTOR);
  m_pCEffectFile->m_pDev->SetTextureStageState(0, D3DTSS_COLOROP, D3DTOP_MODULATE);
  m_pCEffectFile->m_pDev->SetTextureStageState(0, D3DTSS_ALPHAARG1, D3DTA_TEXTURE);
  m_pCEffectFile->m_pDev->SetTextureStageState(0, D3DTSS_ALPHAARG2, D3DTA_TFACTOR);
  m_pCEffectFile->m_pDev->SetTextureStageState(0, D3DTSS_ALPHAOP, D3DTOP_MODULATE);
  if(!m_pCEffect->IsAlpah())
  {
    m_pCEffect->m_pDev->SetRenderStateForced(D3DRS_ALPHABLENDENABLE, FALSE);
    m_pCEffect->m_pDev->SetRenderStateForced(D3DRS_ZWRITEENABLE, TRUE);
  }
  if(m_pCEffect->IsBillBoard())
  {
    if(!m_pCEffect->IsRotaBoard())
      D3DXMatrixIdentity(&m_SMatResult);
    D3DXMatrixMultiply(&m_SMatResult,&m_SMatResult,m_pCEffect->getBillBoardMatrix());
  }
}
void CMPStrip::Play()
{
  lwMatrix44 mat1,mat2;
  if (_pItem)
  {
    _pItem->GetObjDummyRunTimeMatrix(&mat1,_iDummy[0]);
    _pItem->GetObjDummyRunTimeMatrix(&mat2,_iDummy[1]);
  }else if(_pCha)
  {
    _pCha->GetObjDummyRunTimeMatrix(&mat1,_iDummy[0]);
    _pCha->GetObjDummyRunTimeMatrix(&mat2,_iDummy[1]);
  }else
    return;
  GetTrack(&mat1,&mat2);
  _bPlay = true;
}
void CMPStrip::Render()
{
  if(_vecCtrl.size()>1)
    m_pDev->DrawPrimitiveUP(D3DPT_TRIANGLESTRIP, _vecPath.size()-2, _vecPath.front(), sizeof(Strip_Vertex));
}
bool CMPStrip::LoadFromFile(FILE* t_pFile, DWORD dwVersion)
{
  char pszName[32];
  char psname[64];
  if((strstr(pszName,".dds")==NULL)&&strstr(pszName,".tga")==NULL)
  {
    _strTexName = pszName;
  }else
  {
    int len = lstrlen(pszName);
    memcpy(psname, pszName,len - 4);
    _strTexName = psname;
  }
  return true;
}
`,
  );

  writeFileSync(
    join(sourceRoot, "Engine/sdk/include/MPModelEff.h"),
    `
class CMPStrip
{
  struct track
  {
    void FrameMove(float fDailTime,D3DXCOLOR& dwColor,float fLife)
    {
      if(m_fCurTime >= fLife)
      {
        dwColor.a = 0;
        return;
      }
      dwColor.a = 1.0f + ((-1.0f)* (m_fCurTime/fLife));
      m_fCurTime += fDailTime;
    }
    float m_fCurTime;
  };
  void GetTrack(lwMatrix44* dummy1,lwMatrix44* dummy2)
  {
    path.m_SPos.x = dummy1->_41;
    path.m_SPos.y = dummy1->_42;
    path.m_SPos.z = dummy1->_43;
    path.m_SUV.y = 1;
    path.m_SPos.x = dummy2->_41;
    path.m_SPos.y = dummy2->_42;
    path.m_SPos.z = dummy2->_43;
    path.m_SUV.y = 0;
  }
};
`,
  );

  writeFileSync(
    join(sourceRoot, "Engine/sdk/include/I_Effect.h"),
    `
#define MESH_TRI "Triangle"
#define MESH_PLANETRI "TrianglePlane"
#define MESH_RECT "Rect"
#define MESH_RECTZ "RectZ"
#define MESH_PLANERECT "RectPlane"
#define MESH_CYLINDER "Cylinder"
#define MESH_CONE "Cone"
#define MESH_SPHERE "Sphere"

inline bool IsTobMesh(const s_string& strName)
{
  return ((strName==MESH_CYLINDER)||(strName==MESH_CONE)||(strName==MESH_SPHERE));
}

inline bool IsDefaultMesh(const s_string& strName)
{
  static s_string str[] =
  {
    MESH_TRI,
    MESH_PLANETRI,
    MESH_RECT,
    MESH_RECTZ,
    MESH_PLANERECT,
    MESH_CYLINDER,
    MESH_CONE,
    MESH_SPHERE,
  };
  return false;
}

bool CreateTob(const s_string& str, int nSeg,float fHei,float fTopRadius,float fBottomRadius)
{
  if(str==MESH_CYLINDER)
    return CreateCylinder(nSeg,fHei,fTopRadius,fBottomRadius);
  if(str==MESH_CONE)
    return CreateCone(nSeg,fHei,fBottomRadius);
  return false;
}

enum EFFECT_TYPE
{
  EFFECT_NONE = 0,
  EFFECT_FRAMETEX = 1,
  EFFECT_MODELUV = 2,
  EFFECT_MODELTEXTURE = 3,
  EFFECT_MODEL = 4,
};
`,
  );

  writeFileSync(
    join(sourceRoot, "Client/src/EffectObj.cpp"),
    `
void (*MagicList[])(CMagicCtrl* pEffCtrl, void* pParam) =
{
  Part_drop,
  Part_fly,
  Part_trace,
  Part_fshade,
  Part_arc,
  Part_dirlight,
  Part_dist,
};

void (*GroupList[])(CMagicEff* pEffCtrl,D3DXVECTOR3* pStart,D3DXVECTOR3* pEnd) =
{
  Part_fan,
  Part_sequence,
};
inline void Part_trace(CMagicCtrl* pEffCtrl, void* pParam)
{
  pEffCtrl->ResetDir(&vTarget);
}
inline void Part_drop(CMagicCtrl* pEffCtrl, void* pParam) {}
inline void Part_fly(CMagicCtrl* pEffCtrl, void* pParam) {}
inline void Part_fshade(CMagicCtrl* pEffCtrl, void* pParam) {}
inline void Part_arc(CMagicCtrl* pEffCtrl, void* pParam) {}
inline void Part_dirlight(CMagicCtrl* pEffCtrl, void* pParam) {}
inline void Part_dist(CMagicCtrl* pEffCtrl, void* pParam) {}
`,
  );

  writeFileSync(
    join(sourceRoot, "Engine/sdk/src/MPResManger.cpp"),
    `
if(!_CEffectFile.LoadEffectFromFile("shader\\\\dx8\\\\eff.fx")) {}
lwLoadTex(&tex, res_mgr, file, tex_path, D3DFMT_A4R4G4B4);
D3DXMatrixInverse( &_MatBBoard, NULL, _pMatView );
_MatBBoard._41 = 0.0f;
_MatBBoard._42 = 0.0f;
_MatBBoard._43 = 0.0f;
bool CMPResManger::LoadTotalMesh()
{
  _mapMesh[MESH_TRI] = (int)_vecMeshName.size();
  _mapMesh[MESH_RECT] = (int)_vecMeshName.size();
  _mapMesh[MESH_PLANERECT] = (int)_vecMeshName.size();
  _mapMesh[MESH_PLANETRI] = (int)_vecMeshName.size();
  _mapMesh[MESH_RECTZ] = (int)_vecMeshName.size();
  _mapMesh[MESH_CONE] = (int)_vecMeshName.size();
  _mapMesh[MESH_CYLINDER] = (int)_vecMeshName.size();
  _CShadeModel = NULL;
  return true;
}
`,
  );

  writeFileSync(
    join(sourceRoot, "Engine/sdk/src/lwIUtil.cpp"),
    `
LW_RESULT lwLoadTex(lwITex** out, lwIResourceMgr* res_mgr, const char* file, const char* tex_path, D3DFORMAT fmt)
{
  lwTexInfo tex_info;
  lwTexInfo_Construct(&tex_info);
  tex_info.format = fmt;
  tex->LoadVideoMemory();
}
`,
  );

  writeFileSync(
    join(sourceRoot, "Engine/sdk/src/lwResourceMgr.cpp"),
    `
LW_RESULT lwTex::LoadVideoMemory()
{
  _format = D3DFMT_A8R8G8B8;
  D3DXCreateTextureFromFileEx(dev, file, w, h, l, u, _format, pool, f1, f2, _colorkey.color, info, pal, &tex);
}
`,
  );

  writeFileSync(
    join(sourceRoot, "Engine/sdk/include/lwITypes2.h"),
    `
inline void lwTexInfo_Construct(lwTexInfo* obj)
{
  obj->colorkey_type = COLORKEY_TYPE_NONE;
  obj->colorkey.color = 0;
}
`,
  );

  writeFileSync(
    join(sourceRoot, "Client/client/shader/dx8/eff.fx"),
    `
technique t0 { pass p0 {
  ZEnable = TRUE;
  ZWriteEnable = FALSE;
  CullMode = None;
  Minfilter = Linear;
  Magfilter = Linear;
  AddressU[0]=CLAMP;
  AddressV[0]=CLAMP;
  AlphaTestEnable = FALSE;
  AlphaBlendEnable = TRUE;
}}
technique t1 { pass p0 {
  ZEnable = TRUE;
  ZWriteEnable = TRUE;
  CullMode = None;
  AddressU[0]=WRAP;
  AddressV[0]=WRAP;
  AlphaTestEnable = FALSE;
  AlphaBlendEnable = FALSE;
}}
technique t2 { pass p0 {
  ZEnable = TRUE;
  ZWriteEnable = FALSE;
  CullMode = None;
  Minfilter = Linear;
  Magfilter = Linear;
  AddressU[0]=CLAMP;
  AddressV[0]=CLAMP;
  AlphaTestEnable = FALSE;
  AlphaBlendEnable = TRUE;
}}
technique t3 { pass p0 {
  ZEnable = TRUE;
  ZWriteEnable = FALSE;
  CullMode = None;
  AddressU[0]=CLAMP;
  AddressV[0]=CLAMP;
  AlphaTestEnable = FALSE;
  AlphaBlendEnable = TRUE;
}}
technique t4 { pass p0 {
  ZEnable = TRUE;
  ZWriteEnable = FALSE;
  CullMode = None;
  Minfilter = Linear;
  Magfilter = Linear;
  AddressU[0]=WRAP;
  AddressV[0]=WRAP;
  AlphaTestEnable = TRUE;
  AlphaRef = 0xff000000;
  AlphaFunc = NOTEQUAL;
  AlphaBlendEnable = TRUE;
}}
technique t5 { pass p0 {
  ZEnable = FALSE;
  ZWriteEnable = FALSE;
  CullMode = CCW;
  Minfilter = Point;
  Magfilter = Point;
  AddressU[0]=CLAMP;
  AddressV[0]=CLAMP;
  AlphaTestEnable = FALSE;
  AlphaBlendEnable = TRUE;
  SrcBlend = SrcAlpha;
  DestBlend = InvSrcAlpha;
}}
technique t6 { pass p0 {
  ZEnable = FALSE;
  ZWriteEnable = FALSE;
  CullMode = CCW;
  Minfilter = Linear;
  Magfilter = Linear;
  AddressU[0]=WRAP;
  AddressV[0]=WRAP;
  AlphaTestEnable = FALSE;
  AlphaBlendEnable = TRUE;
  SrcBlend = SrcAlpha;
  DestBlend = InvSrcAlpha;
}}
`,
  );
}

function cppParticleSuffix(sourceName: string): string {
  if (sourceName === "ARRAW") return "Arraw";
  return sourceName
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function writeFakeRepo(
  fakeRepo: string,
  options: {
    groupDefaultReturnsNull: boolean;
    includeModelUvBranch?: boolean;
    omitParticleKinematicsTest?: string;
    techniqueZeroAddress?: "CLAMP" | "WRAP";
  },
): void {
  const effectDir = join(fakeRepo, "src/features/effect");
  const particleDir = join(fakeRepo, "src/features/effect-v2/renderers/particles");
  const rendererDir = join(fakeRepo, "src/features/effect-v2/renderers");
  const flightDir = join(rendererDir, "flight");
  const flightPathDir = join(flightDir, "paths");
  const effectV2Dir = join(fakeRepo, "src/features/effect-v2");
  const testDir = join(effectV2Dir, "__tests__");
  const rustEffectDir = join(fakeRepo, "src-tauri/src/effect");
  mkdirSync(effectDir, { recursive: true });
  mkdirSync(particleDir, { recursive: true });
  mkdirSync(flightDir, { recursive: true });
  mkdirSync(flightPathDir, { recursive: true });
  mkdirSync(effectV2Dir, { recursive: true });
  mkdirSync(testDir, { recursive: true });
  mkdirSync(rustEffectDir, { recursive: true });

  writeFileSync(join(particleDir, "types.ts"), `
export const ParticleType = {
  SNOW: 1, FIRE: 2, BLAST: 3, RIPPLE: 4, MODEL: 5, STRIP: 6,
  WIND: 7, ARROW: 8, ROUND: 9, BLAST2: 10, BLAST3: 11,
  SHRINK: 12, SHADE: 13, RANGE: 14, RANGE2: 15, DUMMY: 16,
  LINE_SINGLE: 17, LINE_ROUND: 18,
} as const;
`);

  writeFileSync(join(rendererDir, "StripRenderer.tsx"), `
export function StripRenderer({ dummyLineSpan }) {
  useFrame(() => {
    if (!dummyLineSpan) return;
    buildSourceTrackGeometry();
  });
  return <mesh />;
}
`);

  writeFileSync(join(rendererDir, "stripTrailKinematics.ts"), `
export function computeStripPairAlpha(age, life) {
  if (age >= life) return 0;
  return Math.max(1 - age / life, 0);
}
export function buildStripGeometryFromTrack(vertices) {
  const vertexCount = vertices.length;
  const triangleCount = Math.max(vertexCount - 2, 0);
  return { indices: new Uint16Array(triangleCount * 3) };
}
`);

  writeFileSync(join(testDir, "StripTrailKinematics.test.ts"), `
it("matches C++ CMPStrip::GetTrack dummy1/dummy2 vertex order and UVs", () => {
  expect([[0, 1], [0, 0]]).toEqual([[0, 1], [0, 0]]);
});
it("matches C++ track fade before age increment", () => {
  expect(computeStripPairAlpha(0.5, 2)).toBe(0.75);
});
`);

  const particleFiles = [
    ["SNOW", "Snow", "snowKinematics.ts", "SnowKinematics.test.ts"],
    ["FIRE", "Fire", "fireKinematics.ts", "FireKinematics.test.ts"],
    ["BLAST", "Blast", "blastKinematics.ts", "BlastKinematics.test.ts"],
    ["RIPPLE", "Ripple", "rippleKinematics.ts", "RippleKinematics.test.ts"],
    ["MODEL", "Model", "modelKinematics.ts", "ModelKinematics.test.ts"],
    ["STRIP", "Strip", "stripKinematics.ts", "StripKinematics.test.ts"],
    ["WIND", "Wind", "windKinematics.ts", "WindKinematics.test.ts"],
    ["ARROW", "Arrow", "arrowKinematics.ts", "ArrowKinematics.test.ts"],
    ["ROUND", "Round", "roundKinematics.ts", "RoundKinematics.test.ts"],
    ["BLAST2", "Blast2", "blastKinematics.ts", "BlastKinematics.test.ts"],
    ["BLAST3", "Blast3", "blastKinematics.ts", "BlastKinematics.test.ts"],
    ["SHRINK", "Shrink", "shrinkKinematics.ts", "ShrinkKinematics.test.ts"],
    ["SHADE", "Shade", "shadeKinematics.ts", "ShadeKinematics.test.ts"],
    ["RANGE", "Range", "rangeKinematics.ts", "RangeKinematics.test.ts"],
    ["RANGE2", "Range2", "rangeKinematics.ts", "RangeKinematics.test.ts"],
    ["DUMMY", "Dummy", "dummyLineKinematics.ts", "DummyLineKinematics.test.ts"],
    ["LINE_SINGLE", "LineSingle", "dummyLineKinematics.ts", "DummyLineKinematics.test.ts"],
    ["LINE_ROUND", "LineRound", "dummyLineKinematics.ts", "DummyLineKinematics.test.ts"],
  ];

  for (const [, systemBase, kinematicsFile, testFile] of particleFiles) {
    writeFileSync(join(particleDir, `${systemBase}System.tsx`), `export function ${systemBase}System() { return null; }\n`);
    writeFileSync(join(particleDir, kinematicsFile), "export const covered = true;\n");
    if (options.omitParticleKinematicsTest !== testFile) {
      writeFileSync(join(testDir, testFile), "export const covered = true;\n");
    }
  }

  for (const systemBase of ["Snow", "Fire", "Shrink"]) {
    writeFileSync(join(particleDir, `${systemBase}System.tsx`), `
export function ${systemBase}System() {
  useParticleLifecycle({
    ${systemBase === "Fire" ? "initParticle: () => computeFireModelDirMovementDirection(sourceDirectionRef.current)," : ""}
    finitePlayTimeStopBehavior: "drain",
  });
}
`);
  }
  writeFileSync(join(particleDir, "fireKinematics.ts"), `
export function computeFireModelDirMovementDirection(direction) {
  const normalized = direction.clone().normalize();
  const pitch = Math.asin(direction.z / direction.length());
  const yaw = Math.acos(direction.y / Math.sqrt(direction.x * direction.x + direction.y * direction.y));
  return new THREE.Vector3(pitch, yaw, normalized.z);
}
`);
  writeFileSync(join(particleDir, "FireSystem.tsx"), `
export function FireSystem({ system, sourceDirectionRef, onHitEffect }) {
  useParticleLifecycle({
    initParticle: () => computeFireModelDirMovementDirection(sourceDirectionRef.current),
    finitePlayTimeStopBehavior: "drain",
  });
  const hitEffectName = system.hitEffect.trim();
  for (const dt of timeline.steps) {
    advanceEffPathRuntimeState(hitPathStateRef.current, system.path, dt);
    const curPos = hitPathStateRef.current.curPos;
    if (hitPathStateRef.current.ended || curPos.z <= 0.1 || curPos.z > 50) {
      onHitEffect?.(hitEffectName, curPos);
    }
  }
}
`);
  for (const systemBase of ["Blast2", "Blast3"]) {
    writeFileSync(join(particleDir, `${systemBase}System.tsx`), `
export function ${systemBase}System() {
  useParticleLifecycle({
    restartOnLoop: false,
  });
}
`);
  }

  writeFileSync(join(particleDir, "ModelSystem.tsx"), `
export function ModelSystem({ system, emitterPositionRef }) {
  const handleNestedEffectComplete = () => {
    setNestedEffectComplete(true);
  };
  useParticleLifecycle({
    moveParticle: (p, i, dt, sys, pathOffset) =>
      moveModelParticle(p, i, dt, sys, emitterPositionRef?.current, pathOffset),
  });
  return <ParticleVisual onNestedEffectComplete={handleNestedEffectComplete} />;
}
`);
  writeFileSync(join(particleDir, "modelKinematics.ts"), `
export function computeModelSpawnPosition(system) {
  return new THREE.Vector3(system.offset[0], system.offset[1], system.offset[2]);
}
export function moveModelParticle(p, i, dt, system, emitterPosition, pathOffset) {
  p.pos.copy(withEmitterPosition(computeModelSpawnPosition(system), emitterPosition));
  if (pathOffset) p.pos.add(pathOffset);
}
`);
  writeFileSync(join(particleDir, "ArrowSystem.tsx"), `
export function ArrowSystem({ system, emitterPositionRef }) {
  useParticleLifecycle({
    moveParticle: (p, i, dt, s, pathOffset) =>
      moveArrowParticle(p, i, dt, s, emitterPositionRef?.current, pathOffset),
  });
}
`);
  writeFileSync(join(particleDir, "arrowKinematics.ts"), `
export function computeArrowSpawnPosition(system) {
  return new THREE.Vector3(system.offset[0], system.offset[1], system.offset[2]);
}
export function moveArrowParticle(p, i, dt, system, emitterPosition, pathOffset) {
  p.pos.copy(computeArrowSpawnPosition(system));
  if (emitterPosition) p.pos.add(emitterPosition);
  if (pathOffset) p.pos.add(pathOffset);
}
`);
  writeFileSync(join(particleDir, "StripSystem.tsx"), `
export function StripSystem({ system, emitterPositionRef }) {
  const handleNestedEffectComplete = () => {
    setNestedEffectComplete(true);
  };
  useParticleLifecycle({
    moveParticle: (p, i, dt, s, pathOffset) =>
      moveStripParticle(p, i, dt, s, emitterPositionRef?.current, pathOffset),
  });
  return <ParticleVisual onNestedEffectComplete={handleNestedEffectComplete} />;
}
`);
  writeFileSync(join(particleDir, "stripKinematics.ts"), `
export function computeStripSpawnPosition(system) {
  return computeRangeBasePosition(system);
}
export function moveStripParticle(p, i, dt, system, emitterPosition, pathOffset) {
  p.pos.copy(withEmitterPosition(computeStripSpawnPosition(system), emitterPosition));
  if (pathOffset) p.pos.add(pathOffset);
}
`);
  writeFileSync(join(particleDir, "ShadeSystem.tsx"), `
export function ShadeSystem({ system, emitterPositionRef }) {
  useParticleLifecycle({
    moveParticle: (p, i, dt, s, pathOffset) =>
      moveShadeParticle(p, i, dt, s, emitterPositionRef?.current, pathOffset),
  });
}
`);
  writeFileSync(join(particleDir, "shadeKinematics.ts"), `
export function computeShadeSpawnPosition(system) {
  return computeRangeBasePosition(system);
}
export function moveShadeParticle(p, i, dt, system, emitterPosition, pathOffset) {
  p.pos.copy(withEmitterPosition(computeShadeSpawnPosition(system), emitterPosition));
  if (pathOffset) p.pos.add(pathOffset);
}
`);
  writeFileSync(join(particleDir, "DummySystem.tsx"), `
export function DummySystem({ dummyLineSpan, onComplete, system }) {
  useEffect(() => {
    if (!dummyLineSpan) onComplete?.();
  }, [dummyLineSpan, onComplete]);
  if (!dummyLineSpan) return null;
  function initDummyParticle(p) {
    p.dir.set(system.direction[0], system.direction[1], system.direction[2]);
    p.dir.normalize();
    p.accel.set(system.acceleration[0], system.acceleration[1], system.acceleration[2]);
    p.pos.copy(computeDummySpawnPosition(dummyLineSpan, system.particleCount));
  }
  function moveDummyParticle(p, i, dt) {
    p.pos.add(computeDummyMovementDelta(p.dir, p.accel, system.velocity, dt));
  }
  useParticleLifecycle({ initParticle: initDummyParticle, moveParticle: moveDummyParticle });
}
`);
  writeFileSync(join(particleDir, "dummyLineKinematics.ts"), `
export function computeDummySpawnPosition(span, particleCount, random = Math.random) {
  const bucket = Math.floor(random() * particleCount);
  return span.start.clone().addScaledVector(span.direction, bucket);
}
export function computeDummyMovementDelta(direction, acceleration, velocity, dt, random = Math.random) {
  const signedAccel = random() < 0.5 ? 1 : -1;
  return direction.clone()
    .multiplyScalar(velocity * dt)
    .addScaledVector(acceleration, signedAccel * dt);
}
`);
  writeFileSync(join(particleDir, "RoundSystem.tsx"), `
export function RoundSystem({ system, emitterPositionRef }) {
  useParticleLifecycle({
    moveParticle: (p, i, dt, s, pathOffset) =>
      moveRoundParticle(p, i, dt, s, emitterPositionRef?.current, pathOffset),
  });
}
`);
  writeFileSync(join(particleDir, "roundKinematics.ts"), `
export function computeRoundPosition(system, index) {
  return new THREE.Vector3(system.offset[0], system.offset[1], system.offset[2]);
}
export function moveRoundParticle(p, index, dt, system, emitterPosition, pathOffset) {
  p.pos.copy(computeRoundPosition(system, index, system.particleCount, p.elapsed));
  if (emitterPosition) p.pos.add(emitterPosition);
  if (pathOffset) p.pos.add(pathOffset);
}
`);
  writeFileSync(join(particleDir, "RangeSystem.tsx"), `
export function RangeSystem({ system, loop, emitterPositionRef }) {
  const sharedEffectElapsedRef = useRef(0);
  const pathDeathRef = useRef(0);
  const pathStoppedRef = useRef(false);
  const particlesRef = useRef([]);
  const visible = isParticleRenderVisibleAtTime(
    timeSource.getTime(),
    system.playTime,
    system.delayTime,
    loop,
  );
  sharedEffectElapsedRef.current = visible
    ? Math.max(0, elapsed - Math.max(0, system.delayTime))
    : 0;
  const pathStateRef = useRef(createEffPathRuntimeState(system.path));
  for (const dt of timeline.steps) {
    advanceEffPathRuntimeState(pathStateRef.current, system.usePath ? system.path : null, dt);
  }
  if (pathStateRef.current.ended) {
    pathDeathRef.current++;
    if (pathDeathRef.current >= Math.trunc(system.life)) {
      pathStoppedRef.current = true;
    }
    particlesRef.current = createRangeParticles(system);
    pathStateRef.current = createEffPathRuntimeState(system.path);
  }
  updateRangeParticlePositions(
    alive,
    emitterPositionRef?.current,
    pathStateRef.current.curPos,
    computeEffPathRangeDirection(pathStateRef.current, system.path),
  );
  return visible ? <ParticleVisual system={system} particle={p} loop={loop} sharedEffectElapsedRef={sharedEffectElapsedRef} /> : null;
}
`);
  writeFileSync(join(particleDir, "Range2System.tsx"), `
export function Range2System({ system, loop, onHitEffect }) {
  const sharedEffectElapsedRef = useRef(0);
  const timeline = getParticleTimelineAdvanceSteps(lastTimelineTimeRef.current, timeSource.getTime());
  if (timeline.reset) {
    resetRange2State();
  }
  if (isParticlePlayTimeExpired(nextElapsed, system.playTime, system.delayTime, loop)) {
    runtimeRef.current.completed = true;
  }
  sharedEffectElapsedRef.current += activeDt;
  stepRange2Particles(
    particlesRef.current,
    runtimeRef.current,
    system,
    activeDt,
    Math.random,
    emitterPositionRef?.current,
    onHitEffect,
  );
  const visible = isParticleRenderVisibleAtTime(
    systemElapsedRef.current,
    system.playTime,
    system.delayTime,
    loop,
  );
  return visible ? <ParticleVisual system={system} particle={p} loop={loop} sharedEffectElapsedRef={sharedEffectElapsedRef} /> : null;
}
`);
  writeFileSync(join(particleDir, "rangeKinematics.ts"), `
export function updateRangeParticlePositions(particles, emitterPosition, pathOffset, pathDirection) {
  const rangeLocalPos = p.custom?.rangeLocalPos;
  p.pos.add(pathOffset);
  p.dir.copy(pathDirection);
}
export function createEffPathRuntimeState(path) {
  return { curPos: path.points[0] };
}
export function advanceEffPathRuntimeState(state, path, dt) {
  state.curDist += path.velocity * dt;
}
export function computeEffPathRangeDirection(state, path) {
  return path.points[state.curFrame - 1];
}
export function createRangeParticles() {}
export function createRange2Particles() {}
export function stepRange2Particles(particles, runtime, system, dt, random, emitterPosition, onHitEffect) {
  if (system.hitEffect.trim()) {
    onHitEffect?.(system.hitEffect, p.pos, p.dir);
  }
}
`);

  writeFileSync(join(rendererDir, "ParticleEffectRenderer.tsx"), `
function getParticleEffectBaseName(particleEffectName: string): string {
  return particleEffectName.trim().replace(/\\.par$/i, "");
}
function handleHitEffect(particleEffectName, position, sourceDirection) {
  const baseName = getParticleEffectBaseName(particleEffectName);
  setTriggeredHitEffects([{ particleEffectName: baseName, position, sourceDirection }]);
}
triggeredHitEffects.map((hit) => (
  <TriggeredClock>
    <ParticleEffectRenderer particleEffectName={hit.particleEffectName} />
  </TriggeredClock>
));
function getSystemDummyLineSpan(type: number, span: DummyLineSpan | null): DummyLineSpan | null {
  if (type === ParticleType.DUMMY || type === ParticleType.LINE_SINGLE) {
    return span;
  }
  return null;
}
function getSystemComponent(type: number) {
  return <System system={system} index={i} loop={loop} onHitEffect={handleHitEffect} />;
  switch (type) {
    case ParticleType.SNOW: return SnowSystem;
    case ParticleType.FIRE: return FireSystem;
    case ParticleType.BLAST: return BlastSystem;
    case ParticleType.RIPPLE: return RippleSystem;
    case ParticleType.MODEL: return ModelSystem;
    case ParticleType.STRIP: return StripSystem;
    case ParticleType.WIND: return WindSystem;
    case ParticleType.ARROW: return ArrowSystem;
    case ParticleType.ROUND: return RoundSystem;
    case ParticleType.BLAST2: return Blast2System;
    case ParticleType.BLAST3: return Blast3System;
    case ParticleType.SHRINK: return ShrinkSystem;
    case ParticleType.SHADE: return ShadeSystem;
    case ParticleType.RANGE: return RangeSystem;
    case ParticleType.RANGE2: return Range2System;
    case ParticleType.DUMMY: return DummySystem;
    case ParticleType.LINE_SINGLE: return LineSingleSystem;
    case ParticleType.LINE_ROUND: return LineRoundSystem;
    default: return null;
  }
}
`);

  writeFileSync(join(effectV2Dir, "EffectV2Workbench.tsx"), `
function StandaloneParticleView({ fileName }: { fileName: string }) {
  const playback = useAtomValue(effectV2PlaybackAtom);
  const setPlayback = useSetAtom(effectV2PlaybackAtom);
  const [previewPar, setPreviewPar] = useState(null);
  const [previewReplayKey, setPreviewReplayKey] = useState(0);
  const baseName = fileName.replace(/\\.par$/i, "");
  const nestedEffectNames = useMemo(() => getNestedParticleEffectNames(previewPar), [previewPar]);
  const nestedEffects = useLoadEffect(nestedEffectNames);
  const previewDuration = useMemo(
    () => estimateStandaloneParticlePreviewDuration(previewPar, nestedEffects),
    [previewPar, nestedEffects],
  );
  const replayPreview = useCallback(() => {
    if (!playback.loop || !playback.playing || playback.time <= 0) return;
    setPlayback((current) => ({ ...current, time: 0 }));
    setPreviewReplayKey((current) => current + 1);
  }, [playback.loop, playback.playing, playback.time, setPlayback]);
  const handlePreviewComplete = useCallback(() => {
    replayPreview();
  }, [replayPreview]);
  useEffect(() => {
    if (previewDuration > 0 && playback.time >= previewDuration) {
      replayPreview();
    }
  }, [playback.time, previewDuration, replayPreview]);
  return (
    <ParticleEffectRenderer
      key={\`\${baseName}:\${previewReplayKey}\`}
      particleEffectName={baseName}
      onComplete={handlePreviewComplete}
    />
  );
}
`);

  writeFileSync(join(particleDir, "ParticleVisual.tsx"), `
function ParticleVisual({ system, onNestedEffectComplete }) {
  const modelName = system.modelName.trim();
  const isNestedEffect = modelName.toLowerCase().endsWith(".eff");
  const opacityScale = useContext(ParticleOpacityContext);
  const builtinGeometry = useMemo(
    () => isNestedEffect ? null : createBuiltinParticleGeometry(modelName),
    [isNestedEffect, modelName],
  );
  const effFiles = useLoadEffect(isNestedEffect ? [modelName] : []);
  const renderer = (
    <ParticleOpacityContext.Provider value={(particle?.alpha ?? 1) * opacityScale}>
      <EffectRenderer effect={effFiles[0]} onComplete={onNestedEffectComplete} />
    </ParticleOpacityContext.Provider>
  );
  const materialColor = particle
    ? createPkoTextureFactorColor(particle.color.r, particle.color.g, particle.color.b)
    : "white";
  const directRenderer = <mesh><meshBasicMaterial color={materialColor} side={THREE.DoubleSide} /></mesh>;
  const modelGeometry = useEffectModel(
    !isNestedEffect && modelName && !builtinGeometry ? modelName : undefined,
    currentProject?.id,
  );
  switch (system.modelName) {
    case "Triangle": return createTriangleGeometry();
    case "Rect": return createRectGeometry();
    case "RectPlane": return createRectPlaneGeometry();
    case "TrianglePlane": return createTrianglePlaneGeometry();
    case "RectZ": return createRectZGeometry();
    case "Cone": return createCylinderGeometry();
    case "Cylinder": return createCylinderGeometry();
  }
  useFrame(({ camera }) => {
    if (system.billboard) {
      const parent = groupRef.current.parent;
      parent.getWorldQuaternion(parentWorldQuatRef.current);
      parentInverseQuatRef.current.copy(parentWorldQuatRef.current).invert();
      groupRef.current.quaternion.copy(parentInverseQuatRef.current).multiply(camera.quaternion);
    }
    if (system.modelDir) {
      if (sourceDirectionRef?.current) {
        directionRef.current.copy(sourceDirectionRef.current);
      } else if (system.type === 5 || system.type === 6) {
        directionRef.current.set(0, 0, 0);
      }
    }
    if ((system.type === 15 || (system.type === 14 && system.usePath)) && system.modelName.trim().toLowerCase().endsWith(".eff")) {
      makeRotatingXZFromDirection(modelDirMatrixRef.current, particleRef.current.dir);
    }
  });
}
function getNestedEffectLoop(systemType, parentLoop, systemPlayTime = 0) {
  if (systemType === 5 || systemType === 6 || systemType === 8) {
    if (!parentLoop && systemPlayTime <= 0) return true;
    return parentLoop;
  }
  return true;
}
`);

  writeFileSync(join(particleDir, "useParticleLifecycle.ts"), `
export function getParticleTimelineAdvanceSteps(previousTime, currentTime) {
  const safePrevious = Number.isFinite(previousTime) ? Math.max(0, previousTime) : 0;
  const safeCurrent = Number.isFinite(currentTime) ? Math.max(0, currentTime) : safePrevious;
  const reset = safeCurrent < safePrevious;
  return { reset, steps: [], nextLastTime: safeCurrent };
}
export function isParticlePlayTimeExpired(elapsed, playTime, delayTime, loop) {
  if (loop || playTime <= 0) return false;
  if (delayTime > 0 && elapsed < delayTime) return false;
  return elapsed >= playTime;
}
export function useParticleLifecycle() {
  const finitePlayTimeStopBehavior = "clear";
  const restartOnLoop = true;
  const getPathOffset = useParticleSystemPathOffset(system);
  const pathOffset = getPathOffset(dt);
  if (finitePlayTimeStopBehavior === "drain") {
    finiteStopReachedRef.current = true;
  }
  if (respawnDeadParticles && !finiteStopReachedRef.current) {
    spawnParticle(p, system, initParticle, emitterPositionRef, pathOffset);
  }
  if (timeline.reset) {
    resetLifecycleState();
  }
  if (loop && restartOnLoop && !finiteStopReachedRef.current) {
    createParticles(count, system, initParticle, emitterPositionRef, true, pathOffset);
  }
  if (pathOffset) p.pos.add(pathOffset);
}
export function isParticleRenderVisibleAtTime(elapsed, playTime, delayTime, loop) {
  if (elapsed < delayTime) return false;
  return !isParticlePlayTimeExpired(elapsed, playTime, delayTime, loop);
}
`);

  writeFileSync(join(flightDir, "FlightPathController.tsx"), `
const FLIGHT_PATHS = [
  flightDrop,
  flightFly,
  flightTrace,
  flightFshade,
  flightArc,
  flightDirlight,
  flightDist,
];
export function getMagicEmissionDirection(origin, target, renderIdx) {
  const sourceTarget = target.clone();
  if (renderIdx === 5) {
    sourceTarget.z = origin.z;
  }
  return sourceTarget.sub(origin);
}
export function applySourceStyleMagicOrientation(group, ctx, renderIdx, wasInitialized) {
  if (!wasInitialized) {
    applyMagicRotatingXZ(group, getMagicEmissionDirection(ctx.origin, ctx.target, renderIdx));
    return;
  }
  if (ctx.orientationDirection) {
    applyMagicRotatingXZ(group, ctx.orientationDirection);
  }
}
`);
  writeFileSync(join(flightPathDir, "trace.ts"), `
export function flightTrace(ctx) {
  const resetDir = nextTarget.clone().sub(group.position);
  ctx.orientationDirection = resetDir.clone();
}
`);
  for (const pathName of ["drop", "fly", "fshade", "arc", "dirlight", "dist"]) {
    writeFileSync(join(flightPathDir, `${pathName}.ts`), `export function ${pathName}Path(ctx) { ctx.sourceDirection = ctx.state.dir; }\n`);
  }

  writeFileSync(join(rendererDir, "MagicGroupRenderer.tsx"), `
const GROUP_MODE_FAN = 0;
const GROUP_MODE_SEQUENCE = 1;
function MagicGroupRenderer({ renderMode }) {
  switch (renderMode) {
    case GROUP_MODE_FAN: return <FanGroupRenderer />;
    case GROUP_MODE_SEQUENCE: return <SequenceGroupRenderer />;
    default: ${options.groupDefaultReturnsNull ? "return null;" : "return <SequenceGroupRenderer />;"}
  }
}
`);

  writeFileSync(join(effectV2Dir, "frameTexture.ts"), `
export const EFFECT_FRAMETEX = 1;
export function resolveFrameTextureName(subEffect) {
  if (subEffect.effectType !== EFFECT_FRAMETEX) return subEffect.texName;
  return subEffect.frameTexNames[0] || subEffect.texName;
}
`);

  writeFileSync(join(effectDir, "color.ts"), `
export function setPkoTextureFactorColor(target, red, green, blue) {
  target.setRGB(red, green, blue, THREE.SRGBColorSpace);
}
export function createPkoTextureFactorColor(red, green, blue) {
  const color = new THREE.Color();
  setPkoTextureFactorColor(color, red, green, blue);
  return color;
}
`);

  writeFileSync(join(effectDir, "applySubEffectFrame.ts"), `
export function applySubEffectFrame(mesh, camera, opts) {
  const sub = opts.sub;
  const isBillboard = sub.billboard;
  if (isBillboard) {
    const parent = mesh.parent;
    parent.getWorldQuaternion(_parentWorldQuat);
    _parentInverseQuat.copy(_parentWorldQuat).invert();
    mesh.quaternion.copy(_parentInverseQuat).multiply(_desiredWorldQuat);
  }
  ${options.includeModelUvBranch === false ? "" : `if (sub.effectType === 2 && sub.coordList.length > 0) {
    interpolateUVCoords(sub, opts.playbackTime, true);
  }`}
  setPkoTextureFactorColor(mat.color, color[0], color[1], color[2]);
  if (sub.effectType === 3 && sub.texList.length > 0) {
    getTexListFrameIndex(sub, opts.playbackTime, true);
  }
}
`);

  writeFileSync(join(effectDir, "rendering.ts"), `
const BUILTIN_NAMES = new Set([
  "",
  "Cylinder",
  "Cone",
  "Rect",
  "RectZ",
  "RectPlane",
  "Triangle",
  "TrianglePlane",
]);
export function resolveGeometry(subEffect) {
  const modelName = subEffect.modelName.trim();
  if (modelName === "Cylinder" || modelName === "Cone") return { type: "cylinder" };
  if (modelName && !BUILTIN_NAMES.has(modelName)) return { type: "model", modelName };
  if (modelName === "Rect") return { type: "rect" };
  if (modelName === "RectPlane") return { type: "rectPlane" };
  if (modelName === "RectZ") return { type: "rectZ" };
  if (modelName === "Triangle") return { type: "triangle" };
  if (modelName === "TrianglePlane") return { type: "trianglePlane" };
  return { type: "rect" };
}
`);

  writeFileSync(join(effectDir, "pkoStateEmulation.ts"), `
export const D3DBLEND_SRCALPHA = 5;
export const D3DBLEND_INVSRCALPHA = 6;
export const D3DTEXF_POINT = 1;
export const D3DTEXF_LINEAR = 2;
export const D3DTADDRESS_WRAP = 1;
export const D3DTADDRESS_CLAMP = 3;
export const D3DCULL_NONE = 1;
export const D3DCULL_CCW = 3;
export const D3DCMP_GREATER = 5;
export const D3DCMP_NOTEQUAL = 6;
export const DEFAULT_PKO_TECHNIQUE = {
  zEnable: true,
  zWriteEnable: false,
  alphaBlendEnable: true,
  alphaTestEnable: false,
  alphaRef: 0,
  alphaFunc: D3DCMP_GREATER,
  cullMode: D3DCULL_NONE,
  minFilter: D3DTEXF_LINEAR,
  magFilter: D3DTEXF_LINEAR,
  addressU: D3DTADDRESS_${options.techniqueZeroAddress ?? "CLAMP"},
  addressV: D3DTADDRESS_CLAMP,
};
export const PKO_EFFECT_TECHNIQUE_OVERRIDES = {
  0: {},
  1: { zWriteEnable: true, alphaBlendEnable: false, addressU: D3DTADDRESS_WRAP, addressV: D3DTADDRESS_WRAP },
  2: { addressU: D3DTADDRESS_CLAMP, addressV: D3DTADDRESS_CLAMP },
  3: { addressU: D3DTADDRESS_CLAMP, addressV: D3DTADDRESS_CLAMP },
  4: { alphaTestEnable: true, alphaFunc: D3DCMP_NOTEQUAL, alphaRef: 0xff000000, addressU: D3DTADDRESS_WRAP, addressV: D3DTADDRESS_WRAP },
  5: { zEnable: false, zWriteEnable: false, cullMode: D3DCULL_CCW, minFilter: D3DTEXF_POINT, magFilter: D3DTEXF_POINT, addressU: D3DTADDRESS_CLAMP, addressV: D3DTADDRESS_CLAMP, srcBlend: D3DBLEND_SRCALPHA, destBlend: D3DBLEND_INVSRCALPHA },
  6: { zEnable: false, zWriteEnable: false, cullMode: D3DCULL_CCW, addressU: D3DTADDRESS_WRAP, addressV: D3DTADDRESS_WRAP, srcBlend: D3DBLEND_SRCALPHA, destBlend: D3DBLEND_INVSRCALPHA },
};
`);

  writeFileSync(join(effectDir, "buildEffectMaterialProps.ts"), `
export function buildEffectMaterialProps(sub, texture, techniqueState) {
  const useAlpha = sub.alpha !== false;
  const techDepthWrite = techniqueState ? (techniqueState.zWriteEnable || !useAlpha) : !useAlpha;
  const techAlphaBlend = techniqueState ? techniqueState.alphaBlendEnable !== false : useAlpha;
  return {
    transparent: techAlphaBlend ? (useAlpha || false) : false,
    opacity: useAlpha ? 1 : 1,
    blending: techAlphaBlend ? (useAlpha ? THREE.CustomBlending : THREE.NormalBlending) : THREE.NoBlending,
    depthWrite: techDepthWrite,
    map: texture,
  };
}
`);

  writeFileSync(join(effectV2Dir, "useEffectTexture.ts"), `
export function emulateD3dA8R8G8B8(rgba) {
  return new Uint8Array(rgba);
}
export function useEffectTexture() {
  return new THREE.DataTexture(bytes, width, height, THREE.RGBAFormat);
}
`);

  writeFileSync(join(rustEffectDir, "model.rs"), `
impl SubEffect {
  fn write_to<W: Write>(&self, writer: &mut W, version: u32) -> Result<()> {
    if version > 5 {
      write_bool(writer, self.alpha)?;
    }
    Ok(())
  }
}
`);

  writeFileSync(join(rustEffectDir, "par_loader.rs"), `
fn read_strip(r: &mut Reader) -> Result<ParStrip> {
  let texture_name = normalize_cmpstrip_texture_name(r.fixed_string()?);
  Ok(ParStrip { texture_name })
}
fn normalize_cmpstrip_texture_name(mut name: String) -> String {
  if name.contains(".dds") || name.contains(".tga") {
    name.truncate(name.len().saturating_sub(4));
  }
  name
}
`);
}
