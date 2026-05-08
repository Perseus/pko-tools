import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { ParSystem } from "@/types/effect-v2";
import {
  computeSnowMovementDelta,
  computeSnowSpawnState,
} from "../renderers/particles/snowKinematics";

function createSystem(overrides: Partial<ParSystem> = {}): ParSystem {
  return {
    type: 1,
    name: "snow",
    particleCount: 1,
    textureName: "snow.tga",
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
    velocity: 10,
    direction: [2, 3, 4],
    acceleration: [1, 2, 3],
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

describe("computeSnowSpawnState", () => {
  it("matches C++ _CreateSnow velocity signs, acceleration, and range placement", () => {
    const state = computeSnowSpawnState(
      createSystem(),
      randomSequence([
        0.25, // X sign: positive direction
        0.75, // Y sign: negative direction
        0.5, // range X
        0.6, // range Y
        0.7, // range Z
      ]),
    );

    expect(state).not.toBeNull();
    expect(state?.dir.toArray()).toEqual([20, -30, 40]);
    expect(state?.accel.toArray()).toEqual([1, 2, 3]);
    expect(state?.pos.toArray()).toEqual([0, 2, 6]);
  });

  it("returns null when C++ _CreateSnow would reject zero Z velocity", () => {
    expect(computeSnowSpawnState(createSystem({ direction: [2, 3, 0] }))).toBeNull();
  });
});

describe("computeSnowMovementDelta", () => {
  it("moves by old velocity plus signed acceleration impulse", () => {
    const delta = computeSnowMovementDelta(
      new THREE.Vector3(0, 10, 0),
      new THREE.Vector3(2, 4, 6),
      0.5,
      () => 0.25,
    );

    expect(delta.toArray()).toEqual([1, 7, 3]);
  });
});
