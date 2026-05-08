import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { ParSystem } from "@/types/effect-v2";
import {
  computeFireModelDirMovementDirection,
  computeFireMovementDelta,
  computeFireSpawnState,
} from "../renderers/particles/fireKinematics";

function createSystem(overrides: Partial<ParSystem> = {}): ParSystem {
  return {
    type: 2,
    name: "fire",
    particleCount: 1,
    textureName: "fire.tga",
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
    direction: [3, 4, 12],
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

describe("computeFireSpawnState", () => {
  it("normalizes C++ _vDir and keeps raw particle axes", () => {
    const state = computeFireSpawnState(
      createSystem(),
      randomSequence([0.5, 0.6, 0.7]),
    );

    expect(state.dir.x).toBeCloseTo(3 / 13);
    expect(state.dir.y).toBeCloseTo(4 / 13);
    expect(state.dir.z).toBeCloseTo(12 / 13);
    expect(state.accel.toArray()).toEqual([1, 2, 3]);
    expect(state.pos.toArray()).toEqual([0, 2, 6]);
  });
});

describe("computeFireMovementDelta", () => {
  it("applies velocity-scaled normalized direction plus signed acceleration impulse", () => {
    const delta = computeFireMovementDelta(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(2, 4, 6),
      10,
      0.5,
      () => 0.25,
    );

    expect(delta.toArray()).toEqual([1, 7, 3]);
  });
});

describe("computeFireModelDirMovementDirection", () => {
  it("matches C++ _CreateFire modelDir by using GetDirRotation for X/Y and normalized Z", () => {
    const movementDir = computeFireModelDirMovementDirection(new THREE.Vector3(3, 8, 5));

    expect(movementDir.x).toBeCloseTo(Math.asin(5 / Math.sqrt(98)));
    expect(movementDir.y).toBeCloseTo(-Math.acos(8 / Math.sqrt(73)));
    expect(movementDir.z).toBeCloseTo(5 / Math.sqrt(98));
  });

  it("does not use raw runtime setDir as velocity for Fire modelDir", () => {
    const movementDelta = computeFireMovementDelta(
      computeFireModelDirMovementDirection(new THREE.Vector3(3, 8, 5)),
      new THREE.Vector3(0, 0, 0),
      10,
      0.1,
      () => 0.25,
    );

    expect(movementDelta.x).toBeCloseTo(Math.asin(5 / Math.sqrt(98)));
    expect(movementDelta.y).toBeCloseTo(-Math.acos(8 / Math.sqrt(73)));
    expect(movementDelta.z).toBeCloseTo(5 / Math.sqrt(98));
  });
});
