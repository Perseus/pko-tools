import { describe, expect, it } from "vitest";
import { EffectFile } from "@/types/effect";
import { ParFile, ParSystem } from "@/types/effect-v2";
import {
  estimateStandaloneParticlePreviewDuration,
  getNestedParticleEffectNames,
} from "../standaloneParticlePreview";

describe("standalone particle preview duration", () => {
  it("uses MODEL/STRIP authored life as a preview replay fallback when no playTime is serialized", () => {
    const par = createPar({
      systems: [
        createSystem({ type: 6, modelName: "RectPlane", life: 4.5, playTime: 0 }),
        createSystem({ type: 5, modelName: "jfg07.eff", life: 4.5, playTime: 0 }),
      ],
    });

    expect(estimateStandaloneParticlePreviewDuration(par)).toBe(4.5);
  });

  it("includes nested effect duration for jlrgy-style MODEL/STRIP .eff systems", () => {
    const par = createPar({
      systems: [
        createSystem({ type: 6, modelName: "jlr04.eff", life: 4.5, playTime: 0 }),
        createSystem({ type: 5, modelName: "jfg07.eff", life: 4.5, playTime: 0 }),
      ],
    });
    const nested = createEffect(5);

    expect(getNestedParticleEffectNames(par)).toEqual(["jlr04.eff", "jfg07.eff"]);
    expect(estimateStandaloneParticlePreviewDuration(par, [nested])).toBe(5);
  });
});

function createPar(overrides: Partial<ParFile> = {}): ParFile {
  return {
    version: 15,
    name: "test",
    length: 0,
    systems: [],
    strips: [],
    models: [],
    ...overrides,
  };
}

function createSystem(overrides: Partial<ParSystem> = {}): ParSystem {
  return {
    type: 1,
    name: "system",
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
    destBlend: 2,
    life: 1,
    velocity: 0,
    direction: [0, 0, 0],
    acceleration: [0, 0, 0],
    step: 0,
    offset: [0, 0, 0],
    delayTime: 0,
    playTime: 0,
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

function createEffect(duration: number): EffectFile {
  return {
    version: 1,
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
      effectName: "",
      effectType: 0,
      srcBlend: 5,
      destBlend: 2,
      length: duration,
      frameCount: 1,
      frameTimes: [duration],
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
