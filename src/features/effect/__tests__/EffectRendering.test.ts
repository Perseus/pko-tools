import { describe, expect, it } from "vitest";
import {
  resolveBlendMode,
  resolveFrameData,
  resolveFrameDurations,
  resolveGeometryType,
  resolveTextureCandidates,
  resolveTextureName,
} from "@/features/effect/rendering";
import { EffectFile, SubEffect } from "@/types/effect";

const baseSubEffect: SubEffect = {
  effectName: "Spark",
  effectType: 0,
  srcBlend: 2,
  destBlend: 5,
  length: 1,
  frameCount: 2,
  frameTimes: [0.2, 0.3],
  frameSizes: [
    [1, 1, 1],
    [2, 2, 2],
  ],
  frameAngles: [
    [0, 0, 0],
    [0.1, 0.2, 0.3],
  ],
  framePositions: [
    [0, 0, 0],
    [3, 2, 1],
  ],
  frameColors: [
    [1, 0.5, 0.3, 1],
    [0.2, 0.3, 0.4, 0.8],
  ],
  verCount: 0,
  coordCount: 0,
  coordFrameTime: 0,
  coordList: [],
  texCount: 0,
  texFrameTime: 0,
  texName: "spark",
  texList: [],
  modelName: "",
  billboard: false,
  vsIndex: 0,
  segments: 0,
  height: 0,
  topRadius: 0,
  botRadius: 0,
  frameTexCount: 0,
  frameTexTime: 0,
  frameTexNames: [],
  frameTexTime2: 0,
  useParam: 0,
  perFrameCylinder: [],
  rotaLoop: false,
  rotaLoopVec: [0, 0, 0, 0],
  alpha: false,
  rotaBoard: false,
};

const effectFixture: EffectFile = {
  version: 7,
  idxTech: 0,
  usePath: false,
  pathName: "",
  useSound: false,
  soundName: "",
  rotating: false,
  rotaVec: [0, 0, 0],
  rotaVel: 0,
  effNum: 1,
  subEffects: [baseSubEffect],
};

describe("effect rendering helpers", () => {
  it("resolves frame data with bounds", () => {
    const result = resolveFrameData(effectFixture, 0, 5);
    expect(result?.frameIndex).toBe(1);
    expect(result?.position).toEqual([3, 2, 1]);
  });

  it("resolves geometry types", () => {
    expect(resolveGeometryType(1)).toBe("plane");
    expect(resolveGeometryType(4)).toBe("model");
    expect(resolveGeometryType(99)).toBe("spark");
  });

  it("resolves blend modes", () => {
    expect(resolveBlendMode(5, 6)).toBe("normal");
    expect(resolveBlendMode(2, 5)).toBe("additive");
  });

  it("resolves texture names", () => {
    const subEffect = { ...baseSubEffect, frameTexNames: ["a.png", "b.png"] };
    expect(resolveTextureName(subEffect, 1)).toBe("b.png");
    expect(resolveTextureName(baseSubEffect, 0)).toBe("spark");
  });

  it("builds texture candidates with extensions", () => {
    const candidates = resolveTextureCandidates("spark", "/project");
    expect(candidates).toContain("/project/texture/spark.png");
    expect(candidates).toContain("/project/texture/skill/spark.dds");
  });

  it("uses frame times when available", () => {
    const durations = resolveFrameDurations(baseSubEffect);
    expect(durations).toEqual([0.2, 0.3]);
  });
});
