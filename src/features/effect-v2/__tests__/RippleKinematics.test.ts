import { describe, expect, it } from "vitest";
import { ParSystem } from "@/types/effect-v2";
import { computeRippleSpawnPosition } from "../renderers/particles/rippleKinematics";

function createSystem(overrides: Partial<ParSystem> = {}): ParSystem {
  return {
    type: 4,
    name: "ripple",
    particleCount: 1,
    textureName: "ripple.tga",
    modelName: "",
    range: [10, 20, 30],
    frameCount: 2,
    frameSizes: [1, 2],
    frameAngles: [[0, 0, 0], [1, 1, 1]],
    frameColors: [[1, 1, 1, 1], [0, 0, 0, 0]],
    billboard: true,
    srcBlend: 5,
    destBlend: 2,
    life: 1,
    velocity: 0,
    direction: [0, 0, 0],
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

function randomSequence(values: number[]): () => number {
  let index = 0;
  return () => values[index++] ?? 0;
}

describe("computeRippleSpawnPosition", () => {
  it("matches C++ _CreateRipple range placement without swapping particle axes", () => {
    const pos = computeRippleSpawnPosition(
      createSystem(),
      randomSequence([0.5, 0.6, 0.7]),
    );

    // C++ local position is [-range/2 + random*range] => [0, 2, 6].
    expect(pos.toArray()).toEqual([0, 2, 6]);
  });
});
