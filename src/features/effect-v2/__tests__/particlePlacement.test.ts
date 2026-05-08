import { describe, expect, it } from "vitest";
import { ParSystem } from "@/types/effect-v2";
import {
  computeParticleSpawnPosition,
  computeRangeSpawnPosition,
  withEmitterPosition,
} from "../renderers/particles/particlePlacement";
import * as THREE from "three";

function createSystem(overrides: Partial<ParSystem> = {}): ParSystem {
  return {
    type: 1,
    name: "placement",
    particleCount: 1,
    textureName: "",
    modelName: "",
    range: [10, 20, 30],
    frameCount: 1,
    frameSizes: [1],
    frameAngles: [[0, 0, 0]],
    frameColors: [[1, 1, 1, 1]],
    billboard: true,
    srcBlend: 5,
    destBlend: 2,
    life: 1,
    velocity: 1,
    direction: [1, 1, 1],
    acceleration: [0, 0, 0],
    step: 0,
    offset: [100, 200, 300],
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

describe("computeRangeSpawnPosition", () => {
  it("matches CMPPartSys::MoveTo base placement: offset - range/2 + random range", () => {
    const pos = computeRangeSpawnPosition(createSystem(), () => 0.5);

    expect(pos.toArray()).toEqual([100, 200, 300]);
  });

  it("keeps raw C++ particle coordinates without a PKO-to-Three axis swap", () => {
    const randomValues = [0.5, 0.6, 0.7];
    let index = 0;
    const pos = computeRangeSpawnPosition(createSystem(), () => randomValues[index++] ?? 0);

    expect(pos.toArray()).toEqual([100, 202, 306]);
  });
});

describe("computeParticleSpawnPosition", () => {
  it("matches C++ model-range placement: base _vPos plus a discrete point range", () => {
    const pos = computeParticleSpawnPosition(
      createSystem({
        pointRanges: [
          [1, 2, 3],
          [4, 5, 6],
        ],
      }),
      () => 0.75,
    );

    expect(pos.toArray()).toEqual([99, 195, 291]);
  });

  it("falls back to random box placement when no point ranges are present", () => {
    const pos = computeParticleSpawnPosition(createSystem(), () => 0.5);

    expect(pos.toArray()).toEqual([100, 200, 300]);
  });
});

describe("withEmitterPosition", () => {
  it("matches CMPPartSys::MoveTo by offsetting spawn positions with the runtime emitter position", () => {
    const pos = withEmitterPosition(
      new THREE.Vector3(1, 2, 3),
      new THREE.Vector3(10, 20, 30),
    );

    expect(pos.toArray()).toEqual([11, 22, 33]);
  });

  it("leaves local placement unchanged when no runtime emitter is bound", () => {
    const pos = withEmitterPosition(new THREE.Vector3(1, 2, 3), null);

    expect(pos.toArray()).toEqual([1, 2, 3]);
  });
});
