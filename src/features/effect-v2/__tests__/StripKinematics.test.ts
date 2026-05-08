import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { ParSystem } from "@/types/effect-v2";
import {
  computeStripSpawnPosition,
  initStripParticle,
  moveStripParticle,
} from "../renderers/particles/stripKinematics";
import type { Particle } from "../renderers/particles/useParticleLifecycle";

function createSystem(overrides: Partial<ParSystem> = {}): ParSystem {
  return {
    type: 6,
    name: "strip",
    particleCount: 5,
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

describe("computeStripSpawnPosition", () => {
  it("matches C++ _FrameMoveStrip base _vPos placement", () => {
    expect(computeStripSpawnPosition(createSystem()).toArray()).toEqual([95, 190, 285]);
  });
});

describe("moveStripParticle", () => {
  it("matches _FrameMoveStrip by pinning to the current system base position", () => {
    const particle = {
      pos: new THREE.Vector3(1, 2, 3),
    };

    moveStripParticle(particle, 0, 0.5, createSystem({ offset: [100, 200, 300] }));

    expect(particle.pos.toArray()).toEqual([95, 190, 285]);
  });

  it("matches runtime MoveTo by adding the current emitter position every frame", () => {
    const particle = {
      pos: new THREE.Vector3(1, 2, 3),
    };

    moveStripParticle(
      particle,
      0,
      0.5,
      createSystem({ offset: [100, 200, 300] }),
      new THREE.Vector3(7, 8, 9),
    );

    expect(particle.pos.toArray()).toEqual([102, 198, 294]);
  });

  it("adds CEffPath current position because CMPPartSys::FrameMove shifts _vPos before _FrameMoveStrip", () => {
    const particle = {
      pos: new THREE.Vector3(1, 2, 3),
    };

    moveStripParticle(
      particle,
      0,
      0.5,
      createSystem({ offset: [100, 200, 300] }),
      new THREE.Vector3(7, 8, 9),
      new THREE.Vector3(1, 2, 3),
    );

    expect(particle.pos.toArray()).toEqual([103, 200, 297]);
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
    frameTime: 0.5,
    life: 1,
    elapsed: 0,
    custom: {},
    ...overrides,
  };
}

describe("initStripParticle", () => {
  it("matches _FrameMoveStrip fixed frame-0 size and color", () => {
    const p = particle();

    initStripParticle(
      p,
      0,
      createSystem({
        frameSizes: [4, 10],
        frameColors: [[0.25, 0.5, 0.75, 0.8], [1, 0, 0, 0.25]],
      }),
    );

    expect(p.size).toBe(4);
    expect(p.color.toArray()).toEqual([0.25, 0.5, 0.75]);
    expect(p.alpha).toBe(0.8);
    expect(p.frameTime).toBe(0);
  });
});
