import { describe, expect, it } from "vitest";
import {
  createRectGeometry,
  createRectZGeometry,
  createTriangleGeometry,
  createTriangleZGeometry,
  resolveBlendFactors,
  resolveFrameData,
  resolveFrameDurations,
  resolveGeometry,
  resolveTextureCandidates,
  resolveTextureName,
} from "@/features/effect/rendering";
import { EffectFile, SubEffect } from "@/types/effect";
import * as THREE from "three";

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

  it("resolves geometry from modelName", () => {
    expect(resolveGeometry({ ...baseSubEffect, modelName: "" }).type).toBe("rect");
    expect(resolveGeometry({ ...baseSubEffect, modelName: "Rect" }).type).toBe("rect");
    expect(resolveGeometry({ ...baseSubEffect, modelName: "RectPlane" }).type).toBe("rectZ");
    expect(resolveGeometry({ ...baseSubEffect, modelName: "Sphere" }).type).toBe("sphere");
  });

  it("resolves model geometry for non-built-in names", () => {
    const geo = resolveGeometry({ ...baseSubEffect, modelName: "wind01" });
    expect(geo.type).toBe("model");
    expect(geo.modelName).toBe("wind01");
  });

  it("resolves model geometry for names with .lgo extension", () => {
    const geo = resolveGeometry({ ...baseSubEffect, modelName: "boom.lgo" });
    expect(geo.type).toBe("model");
    expect(geo.modelName).toBe("boom.lgo");
  });

  it("returns correct type for all built-in geometry names", () => {
    expect(resolveGeometry({ ...baseSubEffect, modelName: "Rect" }).type).toBe("rect");
    expect(resolveGeometry({ ...baseSubEffect, modelName: "RectZ" }).type).toBe("rectZ");
    expect(resolveGeometry({ ...baseSubEffect, modelName: "RectPlane" }).type).toBe("rectZ");
    expect(resolveGeometry({ ...baseSubEffect, modelName: "Triangle" }).type).toBe("triangle");
    expect(resolveGeometry({ ...baseSubEffect, modelName: "TrianglePlane" }).type).toBe("triangleZ");
  });

  it("creates Rect geometry with correct XY-plane vertices", () => {
    const geo = createRectGeometry();
    const pos = geo.getAttribute("position");
    expect(pos.count).toBe(4);
    // All Z values should be 0 (XY plane)
    for (let i = 0; i < pos.count; i++) {
      expect(pos.getZ(i)).toBe(0);
    }
    const uv = geo.getAttribute("uv");
    expect(uv.count).toBe(4);
  });

  it("creates RectZ geometry with correct XZ-plane vertices", () => {
    const geo = createRectZGeometry();
    const pos = geo.getAttribute("position");
    expect(pos.count).toBe(4);
    // All Y values should be 0 (XZ plane)
    for (let i = 0; i < pos.count; i++) {
      expect(pos.getY(i)).toBe(0);
    }
  });

  it("creates Triangle geometry with 3 XY-plane vertices", () => {
    const geo = createTriangleGeometry();
    const pos = geo.getAttribute("position");
    expect(pos.count).toBe(3);
    for (let i = 0; i < pos.count; i++) {
      expect(pos.getZ(i)).toBe(0);
    }
  });

  it("creates TriangleZ geometry with 3 XZ-plane vertices", () => {
    const geo = createTriangleZGeometry();
    const pos = geo.getAttribute("position");
    expect(pos.count).toBe(3);
    for (let i = 0; i < pos.count; i++) {
      expect(pos.getY(i)).toBe(0);
    }
  });

  it("resolves cylinder geometry with sub-effect params", () => {
    const geo = resolveGeometry({
      ...baseSubEffect,
      modelName: "Cylinder",
      topRadius: 0.8,
      botRadius: 0.4,
      height: 2.0,
      segments: 12,
    });
    expect(geo.type).toBe("cylinder");
    expect(geo.topRadius).toBe(0.8);
    expect(geo.botRadius).toBe(0.4);
    expect(geo.height).toBe(2.0);
    expect(geo.segments).toBe(12);
  });

  it("resolves Cone as cylinder geometry", () => {
    const geo = resolveGeometry({ ...baseSubEffect, modelName: "Cone", topRadius: 0, botRadius: 1 });
    expect(geo.type).toBe("cylinder");
    expect(geo.botRadius).toBe(1);
  });

  it("uses per-frame cylinder params when useParam > 0", () => {
    const geo = resolveGeometry({
      ...baseSubEffect,
      modelName: "Cylinder",
      topRadius: 0.5,
      botRadius: 0.5,
      height: 1.0,
      segments: 16,
      useParam: 1,
      perFrameCylinder: [
        { segments: 8, height: 3.0, topRadius: 1.0, botRadius: 0.2 },
        { segments: 8, height: 4.0, topRadius: 1.5, botRadius: 0.3 },
      ],
    }, 1);
    expect(geo.type).toBe("cylinder");
    expect(geo.height).toBe(4.0);
    expect(geo.topRadius).toBe(1.5);
    expect(geo.botRadius).toBe(0.3);
  });

  it("resolves blend factors from D3D values", () => {
    // srcBlend=5 (SRCALPHA) + destBlend=6 (INVSRCALPHA) -> standard alpha blend
    const alpha = resolveBlendFactors(5, 6);
    expect(alpha.blendSrc).toBe(THREE.SrcAlphaFactor);
    expect(alpha.blendDst).toBe(THREE.OneMinusSrcAlphaFactor);

    // srcBlend=5 (SRCALPHA) + destBlend=2 (ONE) -> additive glow
    const additive = resolveBlendFactors(5, 2);
    expect(additive.blendSrc).toBe(THREE.SrcAlphaFactor);
    expect(additive.blendDst).toBe(THREE.OneFactor);

    // srcBlend=2 (ONE) + destBlend=2 (ONE) -> full additive
    const fullAdd = resolveBlendFactors(2, 2);
    expect(fullAdd.blendSrc).toBe(THREE.OneFactor);
    expect(fullAdd.blendDst).toBe(THREE.OneFactor);

    // srcBlend=1 (ZERO) + destBlend=3 (SRCCOLOR) -> modulate
    const modulate = resolveBlendFactors(1, 3);
    expect(modulate.blendSrc).toBe(THREE.ZeroFactor);
    expect(modulate.blendDst).toBe(THREE.SrcColorFactor);
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
    expect(candidates).toContain("/project/texture/lit/spark.tga");
  });

  it("uses frame times when available", () => {
    const durations = resolveFrameDurations(baseSubEffect);
    expect(durations).toEqual([0.2, 0.3]);
  });
});
