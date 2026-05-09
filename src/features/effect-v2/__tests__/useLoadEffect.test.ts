import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EffectFile } from "@/types/effect";
import {
  clearEffectLoadCacheForTest,
  loadCachedEffect,
} from "../useLoadEffect";

const { loadEffectMock } = vi.hoisted(() => ({
  loadEffectMock: vi.fn(),
}));

vi.mock("@/commands/effect", () => ({
  loadEffect: (...args: unknown[]) => loadEffectMock(...args),
}));

describe("loadCachedEffect", () => {
  beforeEach(() => {
    clearEffectLoadCacheForTest();
    loadEffectMock.mockReset();
  });

  it("dedupes concurrent loads for the same project effect", async () => {
    const effect = createEffect("spark");
    loadEffectMock.mockResolvedValue(effect);

    const [first, second] = await Promise.all([
      loadCachedEffect("project-1", "spark.eff"),
      loadCachedEffect("project-1", "SPARK.EFF"),
    ]);

    expect(first).toBe(effect);
    expect(second).toBe(effect);
    expect(loadEffectMock).toHaveBeenCalledTimes(1);
    expect(loadEffectMock).toHaveBeenCalledWith("project-1", "spark.eff");
  });

  it("returns cached effects without reloading after the first request resolves", async () => {
    const effect = createEffect("spark");
    loadEffectMock.mockResolvedValue(effect);

    await loadCachedEffect("project-1", "spark.eff");
    const second = await loadCachedEffect("project-1", "spark.eff");

    expect(second).toBe(effect);
    expect(loadEffectMock).toHaveBeenCalledTimes(1);
  });
});

function createEffect(name: string): EffectFile {
  return {
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
    subEffects: [{
      effectName: name,
      effectType: 0,
      srcBlend: 5,
      destBlend: 2,
      length: 1,
      frameCount: 1,
      frameTimes: [1],
      frameSizes: [[1, 1, 1]],
      frameAngles: [[0, 0, 0]],
      framePositions: [[0, 0, 0]],
      frameColors: [[1, 1, 1, 1]],
      verCount: 0,
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
      alpha: true,
      rotaBoard: false,
    }],
  };
}
