import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  advanceBlast2ParticleFrame,
  computeBlast3SpawnState,
  computeBlast2SpawnState,
  computeBlastSpawnState,
  initBlast3Particle,
  moveBlast2Particle,
  moveBlast3Particle,
} from "../renderers/particles/blastKinematics";
import { ParSystem } from "@/types/effect-v2";
import { Particle } from "../renderers/particles/useParticleLifecycle";

function createSystem(overrides: Partial<ParSystem> = {}): ParSystem {
  return {
    type: 3,
    name: "blast",
    particleCount: 1,
    textureName: "spark.tga",
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
    acceleration: [4, 5, 6],
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

describe("computeBlastSpawnState", () => {
  it("matches C++ _CreateBlast axis signs without swapping particle axes", () => {
    const state = computeBlastSpawnState(
      createSystem(),
      randomSequence([
        0.2, // Randf(velocity): PKO X magnitude
        0.3, // Randf(velocity): PKO Y magnitude, negated by source
        0.4, // Randf(velocity): PKO Z magnitude
        0.25, // Rand(2): positive X direction
        0.25, // Rand(2): positive Y direction
        0.5, // range X
        0.6, // range Y
        0.7, // range Z
      ]),
    );

    // C++ produces PKO velocity [2, -6, 12].
    expect(state.dir.x).toBeCloseTo(2);
    expect(state.dir.y).toBeCloseTo(-6);
    expect(state.dir.z).toBeCloseTo(12);

    expect(state.accel.toArray()).toEqual([4, 5, 6]);
    expect(state.pos.toArray()).toEqual([0, 2, 6]);
  });
});

function createParticle(overrides: Partial<Particle> = {}): Particle {
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
    frameTime: 0.9,
    life: 0.9,
    elapsed: 0,
    custom: {},
    ...overrides,
  };
}

describe("Blast2 C++ parity", () => {
  it("matches _CreateBlast2 by using the forward font direction and non-random base position", () => {
    const state = computeBlast2SpawnState(
      createSystem({
        range: [10, 20, 30],
        offset: [1, 2, 3],
        velocity: 5,
        direction: [9, 9, 9],
        frameAngles: [[2.5, 0, 0]],
      }),
    );

    expect(state.dir.toArray()).toEqual([0, 1, 0]);
    expect(state.pos.toArray()).toEqual([-4, -8, -12]);
    expect(state.accel.toArray()).toEqual([0, 2.5, 0]);
  });

  it("matches _FrameMoveBlast2 initial phase by moving at triple velocity with system acceleration", () => {
    const particle = createParticle({
      pos: new THREE.Vector3(0, 0, 0),
      dir: new THREE.Vector3(0, 1, 0),
      accel: new THREE.Vector3(0, 2, 0),
    });

    moveBlast2Particle(
      particle,
      0,
      0.2,
      createSystem({ velocity: 5, acceleration: [1, 2, 3] }),
    );

    expect(particle.pos.toArray()).toEqual([0, 3, 0]);
    expect(particle.dir.x).toBeCloseTo(0.2);
    expect(particle.dir.y).toBeCloseTo(1.4);
    expect(particle.dir.z).toBeCloseTo(0.6);
    expect(particle.accel.toArray()).toEqual([0, 2, 0]);
  });

  it("matches _FrameMoveBlast2 frame-one lateral offset cycle", () => {
    const particle = createParticle({
      pos: new THREE.Vector3(10, 20, 30),
      accel: new THREE.Vector3(0, 2, 0),
      frameTime: 0.9,
    });

    let step = advanceBlast2ParticleFrame(particle, 0.3, 4, "kill");
    expect(particle.curFrame).toBe(1);
    expect(particle.accel.x).toBe(1);
    expect(particle.custom?.blast2Anchor?.toArray()).toEqual([10, 20, 30]);
    expect(step.skipFrameOutputs).toBe(true);
    expect(step.skipMove).toBe(true);
    expect(particle.pos.toArray()).toEqual([12, 20, 30]);

    step = advanceBlast2ParticleFrame(particle, 0.1, 4, "kill");
    expect(step.skipFrameOutputs).toBe(true);
    expect(step.skipMove).toBe(true);
    expect(particle.pos.toArray()).toEqual([8, 20, 30]);

    step = advanceBlast2ParticleFrame(particle, 0.1, 4, "kill");
    expect(step.skipFrameOutputs).toBe(true);
    expect(step.skipMove).toBe(true);
    expect(particle.pos.toArray()).toEqual([10, 20, 30]);
  });
});

describe("Blast3 C++ parity", () => {
  it("matches _CreateBlast3 deterministic ring directions plus system direction", () => {
    const system = createSystem({
      particleCount: 4,
      direction: [10, 20, 30],
      range: [10, 20, 30],
      offset: [1, 2, 3],
      acceleration: [4, 5, 6],
    });

    const first = computeBlast3SpawnState(system, 0);
    const second = computeBlast3SpawnState(system, 1);

    expect(first.dir.toArray()).toEqual([11, 21, 29]);
    expect(second.dir.x).toBeCloseTo(9);
    expect(second.dir.y).toBeCloseTo(21);
    expect(second.dir.z).toBeCloseTo(29);
    expect(first.pos.toArray()).toEqual([-4, -8, -12]);
    expect(first.accel.toArray()).toEqual([4, 5, 6]);
  });

  it("matches _CreateBlast3 by using fixed system life instead of randomized particle life", () => {
    const particle = createParticle({ life: 0.25, frameTime: 0.125 });

    initBlast3Particle(
      particle,
      0,
      createSystem({
        particleCount: 1,
        frameCount: 4,
        life: 2,
      }),
    );

    expect(particle.life).toBe(2);
    expect(particle.frameTime).toBe(0.5);
  });

  it("matches _FrameMoveBlast3 velocity-scaled direction and acceleration", () => {
    const particle = createParticle({
      pos: new THREE.Vector3(0, 0, 0),
      dir: new THREE.Vector3(1, 2, 3),
      accel: new THREE.Vector3(4, 5, 6),
    });

    moveBlast3Particle(particle, 0, 0.2, createSystem({ velocity: 5 }));

    expect(particle.pos.toArray()).toEqual([1, 2, 3]);
    expect(particle.dir.x).toBeCloseTo(1.8);
    expect(particle.dir.y).toBeCloseTo(3);
    expect(particle.dir.z).toBeCloseTo(4.2);
  });
});
