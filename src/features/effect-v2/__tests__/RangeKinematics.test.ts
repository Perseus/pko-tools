import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { ParSystem } from "@/types/effect-v2";
import {
  advanceEffPathRuntimeState,
  computeEffPathRangeDirection,
  createEffPathRuntimeState,
  createRangeParticles,
  createRange2Particles,
  computeRange2MovementDelta,
  computeRange2SpawnState,
  computeRangeSpawnPosition,
  createRange2RuntimeState,
  stepRange2Particles,
  updateRangeParticlePositions,
} from "../renderers/particles/rangeKinematics";

function createSystem(overrides: Partial<ParSystem> = {}): ParSystem {
  return {
    type: 14,
    name: "range",
    particleCount: 2,
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
    direction: [3, 4, 12],
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

describe("computeRangeSpawnPosition", () => {
  it("matches C++ _FrameMoveRange oldPos + base placement", () => {
    const pos = computeRangeSpawnPosition(
      createSystem(),
      randomSequence([0.5, 0.6, 0.7]),
    );

    expect(pos.toArray()).toEqual([100, 202, 306]);
  });
});

describe("Range lifecycle parity", () => {
  it("matches _CreateRange/_FrameMoveRange static particles without keyframe lifetime", () => {
    const particles = createRangeParticles(
      createSystem({
        particleCount: 2,
        frameSizes: [4, 10],
        frameColors: [[0, 0, 0, 0], [1, 0, 0, 0.25]],
      }),
      randomSequence([0.5, 0.6, 0.7, 0.1, 0.2, 0.3]),
    );

    expect(particles).toHaveLength(2);
    expect(particles[0].alive).toBe(true);
    expect(particles[0].pos.toArray()).toEqual([100, 202, 306]);
    expect(particles[0].size).toBe(4);
    expect(particles[0].color.toArray()).toEqual([1, 1, 1]);
    expect(particles[0].alpha).toBe(1);
    expect(particles[0].frameTime).toBe(0);
    expect(particles[1].pos.toArray()).toEqual([96, 194, 294]);
  });

  it("matches _FrameMoveRange by re-pinning old range offsets to the current emitter", () => {
    const particles = createRangeParticles(
      createSystem({ particleCount: 1 }),
      randomSequence([0.5, 0.6, 0.7]),
      new THREE.Vector3(1, 2, 3),
    );

    expect(particles[0].pos.toArray()).toEqual([101, 204, 309]);

    updateRangeParticlePositions(particles, new THREE.Vector3(10, 20, 30));

    expect(particles[0].pos.toArray()).toEqual([111, 224, 339]);
  });

  it("matches CEffPath::FrameMove current-position interpolation", () => {
    const path = {
      velocity: 10,
      points: [[0, 0, 0], [10, 0, 0], [10, 20, 0]] as [number, number, number][],
      directions: [[1, 0, 0], [0, 1, 0]] as [number, number, number][],
      distances: [10, 20],
    };
    const state = createEffPathRuntimeState(path);

    advanceEffPathRuntimeState(state, path, 0.25);
    expect(state.curPos.toArray()).toEqual([2.5, 0, 0]);
    expect(state.ended).toBe(false);

    advanceEffPathRuntimeState(state, path, 1);
    expect(state.curPos.toArray()).toEqual([10, 2.5, 0]);
    expect(state.ended).toBe(false);
  });

  it("adds path offset to RANGE particles like _vSavePos + _pcPath->GetCurPos", () => {
    const particles = createRangeParticles(
      createSystem({ particleCount: 1, offset: [0, 0, 0], range: [10, 10, 10] }),
      () => 0.5,
    );

    updateRangeParticlePositions(
      particles,
      new THREE.Vector3(100, 200, 300),
      new THREE.Vector3(1, 2, 3),
    );

    expect(particles[0].pos.toArray()).toEqual([101, 202, 303]);
  });

  it("matches _FrameMoveRange nested _CPPart path direction from GetCurPos minus GetNextPos", () => {
    const path = {
      velocity: 10,
      points: [[0, 0, 0], [10, 0, 0], [10, 20, 0]] as [number, number, number][],
      directions: [[1, 0, 0], [0, 1, 0]] as [number, number, number][],
      distances: [10, 20],
    };
    const state = createEffPathRuntimeState(path);

    advanceEffPathRuntimeState(state, path, 1.25);
    const direction = computeEffPathRangeDirection(state, path);

    expect(state.curFrame).toBe(1);
    expect(state.curPos.toArray()).toEqual([10, 2.5, 0]);
    expect(direction?.x).toBeCloseTo(10);
    expect(direction?.y).toBeCloseTo(2.5);
    expect(direction?.z).toBeCloseTo(0);
  });
});

describe("computeRange2SpawnState", () => {
  it("matches C++ _CreateRange2 normalized direction and fixed rangeZ spawn", () => {
    const state = computeRange2SpawnState(
      createSystem({ type: 15 }),
      randomSequence([0.5, 0.6]),
    );

    expect(state.dir.x).toBeCloseTo(3 / 13);
    expect(state.dir.y).toBeCloseTo(4 / 13);
    expect(state.dir.z).toBeCloseTo(12 / 13);
    expect(state.pos.toArray()).toEqual([100, 202, 315]);
  });
});

describe("computeRange2MovementDelta", () => {
  it("moves along normalized oldPos by velocity * dt", () => {
    const delta = computeRange2MovementDelta(
      createSystem(),
      computeRange2SpawnState(createSystem(), randomSequence([0, 0])).dir,
      0.5,
    );

    expect(delta.x).toBeCloseTo((3 / 13) * 5);
    expect(delta.y).toBeCloseTo((4 / 13) * 5);
    expect(delta.z).toBeCloseTo((12 / 13) * 5);
  });
});

describe("Range2 lifecycle parity", () => {
  it("starts with dormant particles and emits dead slots through the C++ step accumulator", () => {
    const system = createSystem({
      type: 15,
      particleCount: 3,
      step: 0.2,
    });
    const particles = createRange2Particles(system);
    const runtime = createRange2RuntimeState();

    stepRange2Particles(
      particles,
      runtime,
      system,
      0.1,
      randomSequence([0.5, 0.6]),
    );

    expect(particles.map((p) => p.alive)).toEqual([false, true, false]);
    expect(particles[1].pos.toArray()).toEqual([100, 202, 315]);
    expect(runtime.curTime).toBeCloseTo(0.1);
  });

  it("does not interpolate frames; Range2 uses frame size 0 and white color while live", () => {
    const system = createSystem({
      type: 15,
      frameSizes: [4, 10],
      frameColors: [[0, 0, 0, 0], [1, 0, 0, 0.25]],
    });
    const particles = createRange2Particles(system);
    const runtime = createRange2RuntimeState();

    particles[0].alive = true;
    particles[0].dir.set(0, 0, 1);
    stepRange2Particles(particles, runtime, system, 0.1);

    expect(particles[0].size).toBe(4);
    expect(particles[0].color.toArray()).toEqual([1, 1, 1]);
    expect(particles[0].alpha).toBe(1);
    expect(particles[0].curFrame).toBe(0);
  });

  it("stops spawning after system life and completes only after live particles have drained", () => {
    const system = createSystem({ type: 15, life: 1, step: 0 });
    const particles = createRange2Particles(system);
    const runtime = createRange2RuntimeState();

    particles[0].life = 1.1;
    particles[1].alive = true;
    particles[1].pos.set(0, 0, 49);
    particles[1].dir.set(0, 0, 1);

    stepRange2Particles(particles, runtime, system, 0.2);

    expect(runtime.stopped).toBe(true);
    expect(runtime.completed).toBe(false);
    expect(particles[1].alive).toBe(false);

    stepRange2Particles(particles, runtime, system, 0.2);

    expect(runtime.completed).toBe(true);
  });

  it("matches _FrameMoveRange2 by emitting hitEffect when a live projectile leaves the source height range", () => {
    const system = createSystem({ type: 15, hitEffect: "impact.par" });
    const particles = createRange2Particles(system);
    const runtime = createRange2RuntimeState();
    const onHitEffect = vi.fn();

    particles[0].alive = true;
    particles[0].pos.set(1, 2, 49);
    particles[0].dir.set(0, 0, 2);

    stepRange2Particles(
      particles,
      runtime,
      system,
      1,
      Math.random,
      null,
      onHitEffect,
    );

    expect(particles[0].alive).toBe(false);
    expect(onHitEffect).toHaveBeenCalledWith(
      "impact.par",
      expect.objectContaining({ x: 1, y: 2, z: 69 }),
      particles[0].dir,
    );
  });
});
