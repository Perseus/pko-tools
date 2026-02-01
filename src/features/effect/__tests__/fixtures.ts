import type { EffectFile, SubEffect } from "@/types/effect";
import type { ParticleController } from "@/types/particle";
import { createDefaultParticleSystem } from "@/types/particle";

export function createSubEffectFixture(
  overrides?: Partial<SubEffect>,
): SubEffect {
  return {
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
      [0.3, 0.1, 0],
    ],
    framePositions: [
      [0, 0, 0],
      [1, 2, 3],
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
    texName: "",
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
    ...overrides,
  };
}

export function createEffectFixture(
  overrides?: Partial<EffectFile>,
): EffectFile {
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
    subEffects: [createSubEffectFixture()],
    ...overrides,
  };
}

export function createEffectWithFrames(frameCount: number): EffectFile {
  const frameTimes: number[] = [];
  const frameSizes: [number, number, number][] = [];
  const frameAngles: [number, number, number][] = [];
  const framePositions: [number, number, number][] = [];
  const frameColors: [number, number, number, number][] = [];

  for (let i = 0; i < frameCount; i++) {
    const t = i / Math.max(frameCount - 1, 1);
    frameTimes.push(0.1);
    frameSizes.push([1 + t, 1 + t * 0.5, 1 + t * 0.3]);
    frameAngles.push([t * 0.5, t * 0.3, t * 0.1]);
    framePositions.push([t * 3, t * 2, t]);
    frameColors.push([1 - t * 0.5, 0.5 + t * 0.3, t, 1 - t * 0.2]);
  }

  return createEffectFixture({
    subEffects: [
      createSubEffectFixture({
        frameCount,
        frameTimes,
        frameSizes,
        frameAngles,
        framePositions,
        frameColors,
      }),
    ],
  });
}

export function createParticleFixture(
  overrides?: Partial<ParticleController>,
): ParticleController {
  return {
    name: "test-particles",
    systems: [createDefaultParticleSystem()],
    length: 2.0,
    ...overrides,
  };
}

/**
 * Create a mock for Tauri's invoke function.
 * Pass a map of command names to handler functions.
 */
export function mockTauriInvoke(
  handlers: Record<string, (...args: unknown[]) => unknown>,
) {
  return (command: string, args?: unknown) => {
    const handler = handlers[command];
    if (handler) {
      return Promise.resolve(handler(args));
    }
    return Promise.reject(new Error(`Unhandled command: ${command}`));
  };
}
