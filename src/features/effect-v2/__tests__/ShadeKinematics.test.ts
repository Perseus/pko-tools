import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { ParSystem } from "@/types/effect-v2";
import {
  computeShadeSpawnPosition,
  initShadeParticle,
  moveShadeParticle,
} from "../renderers/particles/shadeKinematics";
import type { Particle } from "../renderers/particles/useParticleLifecycle";

function createSystem(overrides: Partial<ParSystem> = {}): ParSystem {
  return {
    type: 13,
    name: "shade",
    particleCount: 8,
    textureName: "shade.tga",
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
    shade: true,
    hitEffect: "",
    pointRanges: [],
    randomMode: 1,
    modelDir: false,
    mediaY: false,
    ...overrides,
  };
}

describe("computeShadeSpawnPosition", () => {
  it("matches C++ _FrameMoveShade pPart->_vPos placement", () => {
    expect(computeShadeSpawnPosition(createSystem()).toArray()).toEqual([95, 190, 285]);
  });
});

describe("moveShadeParticle", () => {
  it("matches _FrameMoveShade by pinning to the current system base position", () => {
    const particle = {
      pos: new THREE.Vector3(1, 2, 3),
      size: 1,
    };

    moveShadeParticle(particle, 0, 0.5, createSystem({ offset: [100, 200, 300] }));

    expect(particle.pos.toArray()).toEqual([95, 190, 285]);
  });

  it("matches runtime MoveTo by adding the current emitter position every frame", () => {
    const particle = {
      pos: new THREE.Vector3(1, 2, 3),
      size: 1,
    };

    moveShadeParticle(
      particle,
      0,
      0.5,
      createSystem({ offset: [100, 200, 300] }),
      new THREE.Vector3(7, 8, 9),
    );

    expect(particle.pos.toArray()).toEqual([102, 198, 294]);
  });

  it("adds CEffPath current position because CMPPartSys::FrameMove shifts _vPos before _FrameMoveShade", () => {
    const particle = {
      pos: new THREE.Vector3(1, 2, 3),
      size: 1,
    };

    moveShadeParticle(
      particle,
      0,
      0.5,
      createSystem({ offset: [100, 200, 300] }),
      new THREE.Vector3(7, 8, 9),
      new THREE.Vector3(1, 2, 3),
    );

    expect(particle.pos.toArray()).toEqual([103, 200, 297]);
  });

  it("keeps source shade size fixed at frame 0 after shared lifecycle interpolation", () => {
    const p = particle({ size: 10 });

    moveShadeParticle(p, 0, 0.5, createSystem({ frameSizes: [4, 10] }));

    expect(p.size).toBe(4);
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

describe("initShadeParticle", () => {
  it("matches _CreateShade frame timing and fixed shade size", () => {
    const p = particle();

    initShadeParticle(
      p,
      0,
      createSystem({
        life: 2,
        frameCount: 4,
        frameSizes: [4, 10],
      }),
    );

    expect(p.life).toBe(8);
    expect(p.frameTime).toBe(2);
    expect(p.size).toBe(4);
  });
});
