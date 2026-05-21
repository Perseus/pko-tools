import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { ParSystem } from "@/types/effect-v2";
import {
  computeShrinkMovementDelta,
  computeShrinkSpawnState,
  computeShrinkTargetPosition,
  shouldKillShrinkParticle,
} from "../renderers/particles/shrinkKinematics";

function createSystem(overrides: Partial<ParSystem> = {}): ParSystem {
  return {
    type: 12,
    name: "shrink",
    particleCount: 1,
    textureName: "shrink.tga",
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
    direction: [0, 0, 0],
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

function randomSequence(values: number[]): () => number {
  let index = 0;
  return () => values[index++] ?? 0;
}

describe("computeShrinkSpawnState", () => {
  it("matches C++ _CreateShrink random position and normalized direction to center", () => {
    const state = computeShrinkSpawnState(
      createSystem(),
      randomSequence([0.5, 0.6, 0.7]),
    );

    expect(state.pos.toArray()).toEqual([100, 202, 306]);
    expect(state.target.toArray()).toEqual([100, 200, 300]);
    expect(state.accel.x).toBeCloseTo(0);
    expect(state.accel.y).toBeCloseTo(-2 / Math.sqrt(40));
    expect(state.accel.z).toBeCloseTo(-6 / Math.sqrt(40));
  });
});

describe("computeShrinkMovementDelta", () => {
  it("moves toward the target by velocity * dt", () => {
    const delta = computeShrinkMovementDelta(
      new THREE.Vector3(0, -2 / Math.sqrt(40), -6 / Math.sqrt(40)),
      createSystem(),
      0.5,
    );

    expect(delta.x).toBeCloseTo(0);
    expect(delta.y).toBeCloseTo((-2 / Math.sqrt(40)) * 5);
    expect(delta.z).toBeCloseTo((-6 / Math.sqrt(40)) * 5);
  });
});

describe("shouldKillShrinkParticle", () => {
  it("matches PointPointRange target threshold", () => {
    const target = computeShrinkTargetPosition(createSystem());

    expect(shouldKillShrinkParticle(target.clone().add(new THREE.Vector3(0.4, 0, 0)), target)).toBe(true);
    expect(shouldKillShrinkParticle(target.clone().add(new THREE.Vector3(0.6, 0, 0)), target)).toBe(false);
  });
});
