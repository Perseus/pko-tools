import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { ParSystem } from "@/types/effect-v2";
import {
  computeWindMovementState,
  computeWindSpawnState,
  initWindParticle,
} from "../renderers/particles/windKinematics";
import type { Particle } from "../renderers/particles/useParticleLifecycle";

function createSystem(overrides: Partial<ParSystem> = {}): ParSystem {
  return {
    type: 7,
    name: "wind",
    particleCount: 1,
    textureName: "wind.tga",
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
    direction: [1, 2, 3],
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

describe("computeWindSpawnState", () => {
  it("matches C++ _CreateWind range spawn with angular velocity", () => {
    const state = computeWindSpawnState(
      createSystem(),
      randomSequence([0.5, 0.6, 0.7]),
    );

    expect(state.pos.toArray()).toEqual([100, 202, 306]);
    expect(state.origin.toArray()).toEqual([100, 202, 306]);
    expect(state.accel.toArray()).toEqual([0, 0, 0]);
    expect(state.angle).toBe(0);
    expect(state.angularVelocity).toBe(10);
  });
});

describe("computeWindMovementState", () => {
  it("matches C++ _FrameMoveWind accumulated dir offset rotated around PKO Z", () => {
    const spawn = computeWindSpawnState(createSystem(), randomSequence([0.5, 0.6, 0.7]));
    const next = computeWindMovementState(createSystem(), spawn, 0.5);

    expect(next.angle).toBeCloseTo(5);
    expect(next.accel.toArray()).toEqual([0, 1, 1.5]);
    expect(next.pos.x).toBeCloseTo(100 - Math.sin(5));
    expect(next.pos.y).toBeCloseTo(202 + Math.cos(5));
    expect(next.pos.z).toBeCloseTo(307.5);
  });
});

function particle(overrides: Partial<Particle> = {}): Particle {
  return {
    alive: true,
    pos: new THREE.Vector3(),
    dir: new THREE.Vector3(),
    accel: new THREE.Vector3(),
    size: 1,
    color: new THREE.Color(1, 1, 1),
    alpha: 1,
    angle: new THREE.Vector3(),
    index: 0,
    curFrame: 0,
    curTime: 0,
    frameTime: 0.25,
    life: 0.5,
    elapsed: 0,
    custom: {},
    ...overrides,
  };
}

describe("initWindParticle", () => {
  it("matches _CreateWind by using fixed system life instead of randomized particle life", () => {
    const p = particle({ life: 0.5, frameTime: 0.25 });

    initWindParticle(p, 0, createSystem({ life: 2, frameCount: 4 }));

    expect(p.life).toBe(2);
    expect(p.frameTime).toBe(0.5);
  });
});
