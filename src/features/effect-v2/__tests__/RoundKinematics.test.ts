import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { ParSystem } from "@/types/effect-v2";
import {
  computeRoundInitialOffset,
  computeRoundPosition,
  moveRoundParticle,
} from "../renderers/particles/roundKinematics";
import type { Particle } from "../renderers/particles/useParticleLifecycle";

function createSystem(overrides: Partial<ParSystem> = {}): ParSystem {
  return {
    type: 9,
    name: "round",
    particleCount: 4,
    textureName: "",
    modelName: "",
    range: [10, 20, 30],
    frameCount: 2,
    frameSizes: [1, 2],
    frameAngles: [[0, 0, 0], [1, 1, 1]],
    frameColors: [[1, 1, 1, 1], [0, 0, 0, 0]],
    billboard: false,
    srcBlend: 5,
    destBlend: 2,
    life: 1,
    velocity: Math.PI,
    direction: [1, 2, 3],
    acceleration: [4, 5, 6],
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

describe("computeRoundInitialOffset", () => {
  it("matches C++ _CreateRound even distribution in the horizontal X/Y plane", () => {
    const system = createSystem();

    expect(computeRoundInitialOffset(system, 0, 4).toArray()).toEqual([0, 20, 0]);
    expect(computeRoundInitialOffset(system, 1, 4).toArray()[0]).toBeCloseTo(-20);
    expect(computeRoundInitialOffset(system, 1, 4).toArray()[1]).toBeCloseTo(0);
    expect(computeRoundInitialOffset(system, 1, 4).toArray()[2]).toBeCloseTo(0);
  });
});

describe("computeRoundPosition", () => {
  it("rotates initial offset by system velocity*time around the PKO Z axis", () => {
    const pos = computeRoundPosition(createSystem(), 0, 4, 0.25);

    expect(pos.x).toBeCloseTo(100 - Math.SQRT1_2 * 20);
    expect(pos.y).toBeCloseTo(200 + Math.SQRT1_2 * 20);
    expect(pos.z).toBeCloseTo(300);
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

describe("moveRoundParticle", () => {
  it("matches C++ _FrameMoveRound by pinning to the path-shifted runtime origin every frame", () => {
    const p = particle({ elapsed: 0 });

    moveRoundParticle(
      p,
      0,
      0.1,
      createSystem({ offset: [1, 2, 3], range: [0, 4, 0], velocity: 0 }),
      new THREE.Vector3(10, 20, 30),
      new THREE.Vector3(100, 200, 300),
    );

    expect(p.pos.toArray()).toEqual([111, 226, 333]);
  });
});
