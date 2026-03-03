import { describe, expect, it } from "vitest";
import {
  createPool,
  resetPool,
  spawnParticle,
  stepParticles,
} from "@/features/effect/particle/particlePool";
import { createDefaultParticleSystem, PARTICLE_TYPE } from "@/types/particle";
import type { ParticleSystem } from "@/types/particle";

function makeSys(overrides: Partial<ParticleSystem> = {}): ParticleSystem {
  return { ...createDefaultParticleSystem(), ...overrides };
}

describe("per-particle rotation keyframes", () => {
  it("interpolates rotation from frameAngles over lifetime", () => {
    const pool = createPool();
    const sys = makeSys({
      type: PARTICLE_TYPE.FIRE,
      life: 1.0,
      frameAngles: [
        [0, 0, 0],
        [0, 0, Math.PI],
      ],
      range: [0, 0, 0],
    });

    spawnParticle(pool, sys);

    // Step to 50% lifetime
    stepParticles(pool, sys, 0.5);

    // Rotation should be interpolated to ~[0, 0, PI/2]
    expect(pool.rotations[0]).toBeCloseTo(0, 2);
    expect(pool.rotations[1]).toBeCloseTo(0, 2);
    expect(pool.rotations[2]).toBeCloseTo(Math.PI / 2, 2);
  });

  it("rotation starts at first keyframe", () => {
    const pool = createPool();
    const sys = makeSys({
      type: PARTICLE_TYPE.FIRE,
      life: 1.0,
      frameAngles: [
        [0.5, 0.3, 0.1],
        [1.0, 0.6, 0.2],
      ],
      range: [0, 0, 0],
    });

    spawnParticle(pool, sys);
    // Initial step with tiny delta to trigger interpolation at t≈0
    stepParticles(pool, sys, 0.001);

    expect(pool.rotations[0]).toBeCloseTo(0.5, 1);
    expect(pool.rotations[1]).toBeCloseTo(0.3, 1);
    expect(pool.rotations[2]).toBeCloseTo(0.1, 1);
  });

  it("rotation reaches final keyframe at end of life", () => {
    const pool = createPool();
    const sys = makeSys({
      type: PARTICLE_TYPE.FIRE,
      life: 1.0,
      frameAngles: [
        [0, 0, 0],
        [1, 2, 3],
      ],
      range: [0, 0, 0],
    });

    spawnParticle(pool, sys);
    // Step to just before end of life
    stepParticles(pool, sys, 0.99);

    expect(pool.rotations[0]).toBeCloseTo(1, 1);
    expect(pool.rotations[1]).toBeCloseTo(2, 1);
    expect(pool.rotations[2]).toBeCloseTo(3, 1);
  });

  it("no rotation when frameAngles is empty", () => {
    const pool = createPool();
    const sys = makeSys({
      type: PARTICLE_TYPE.FIRE,
      life: 1.0,
      frameAngles: [],
      range: [0, 0, 0],
    });

    spawnParticle(pool, sys);
    stepParticles(pool, sys, 0.5);

    // Rotations should remain at 0
    expect(pool.rotations[0]).toBe(0);
    expect(pool.rotations[1]).toBe(0);
    expect(pool.rotations[2]).toBe(0);
  });

  it("pool tracks rotations array with correct size", () => {
    const pool = createPool();
    expect(pool.rotations.length).toBe(100 * 3); // MAX_PARTICLES * 3
  });

  it("resetPool clears rotations", () => {
    const pool = createPool();
    const sys = makeSys({
      frameAngles: [[0, 0, Math.PI]],
    });
    spawnParticle(pool, sys);
    stepParticles(pool, sys, 0.1);

    // Set some rotation
    pool.rotations[2] = 1.5;

    // Reset
    resetPool(pool);

    expect(pool.rotations[2]).toBe(0);
  });
});
