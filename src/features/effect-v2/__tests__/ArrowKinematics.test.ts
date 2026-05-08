import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { ParSystem } from "@/types/effect-v2";
import {
  computeArrowSpawnPosition,
  initArrowParticle,
  moveArrowParticle,
} from "../renderers/particles/arrowKinematics";
import type { Particle } from "../renderers/particles/useParticleLifecycle";

function createSystem(overrides: Partial<ParSystem> = {}): ParSystem {
  return {
    type: 8,
    name: "arrow",
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
    velocity: 10,
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

describe("computeArrowSpawnPosition", () => {
  it("matches C++ _FrameMoveArraw center placement", () => {
    expect(computeArrowSpawnPosition(createSystem()).toArray()).toEqual([100, 200, 300]);
  });
});

describe("moveArrowParticle", () => {
  it("matches _FrameMoveArraw by pinning to the current system center", () => {
    const particle = {
      pos: new THREE.Vector3(1, 2, 3),
    };

    moveArrowParticle(particle, 0, 0.5, createSystem({ offset: [100, 200, 300] }));

    expect(particle.pos.toArray()).toEqual([100, 200, 300]);
  });

  it("matches runtime MoveTo by adding the current emitter position every frame", () => {
    const particle = {
      pos: new THREE.Vector3(1, 2, 3),
    };

    moveArrowParticle(
      particle,
      0,
      0.5,
      createSystem({ offset: [100, 200, 300] }),
      new THREE.Vector3(7, 8, 9),
    );

    expect(particle.pos.toArray()).toEqual([107, 208, 309]);
  });

  it("adds CEffPath current position because CMPPartSys::FrameMove shifts _vPos before _FrameMoveArraw", () => {
    const particle = {
      pos: new THREE.Vector3(1, 2, 3),
    };

    moveArrowParticle(
      particle,
      0,
      0.5,
      createSystem({ offset: [100, 200, 300] }),
      new THREE.Vector3(7, 8, 9),
      new THREE.Vector3(1, 2, 3),
    );

    expect(particle.pos.toArray()).toEqual([108, 210, 312]);
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

describe("initArrowParticle", () => {
  it("matches _CreateArraw by using fixed system life", () => {
    const p = particle();

    initArrowParticle(p, 0, createSystem({ life: 2, frameCount: 4 }));

    expect(p.life).toBe(2);
    expect(p.frameTime).toBe(0.5);
  });
});
