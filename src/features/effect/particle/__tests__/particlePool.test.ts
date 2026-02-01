import { describe, expect, it } from "vitest";
import {
  createPool,
  resetPool,
  countAlive,
  getVelocity,
  spawnParticle,
  stepParticles,
  tickPool,
  MAX_PARTICLES,
} from "@/features/effect/particle/particlePool";
import { createDefaultParticleSystem, PARTICLE_TYPE } from "@/types/particle";
import type { ParticleSystem } from "@/types/particle";

function makeSys(overrides: Partial<ParticleSystem> = {}): ParticleSystem {
  return { ...createDefaultParticleSystem(), ...overrides };
}

describe("createPool / resetPool", () => {
  it("creates a pool with zero alive particles", () => {
    const pool = createPool();
    expect(countAlive(pool)).toBe(0);
    expect(pool.count).toBe(0);
  });

  it("resetPool clears all state", () => {
    const pool = createPool();
    const sys = makeSys();
    spawnParticle(pool, sys);
    expect(countAlive(pool)).toBe(1);
    resetPool(pool);
    expect(countAlive(pool)).toBe(0);
    expect(pool.count).toBe(0);
    expect(pool.emitAccum).toBe(0);
    expect(pool.elapsed).toBe(0);
  });
});

describe("spawnParticle", () => {
  it("spawns one particle and increments count", () => {
    const pool = createPool();
    const sys = makeSys();
    spawnParticle(pool, sys);
    expect(countAlive(pool)).toBe(1);
    expect(pool.count).toBe(1);
    expect(pool.alive[0]).toBe(1);
    expect(pool.lifetimes[0]).toBe(sys.life);
  });

  it("does not spawn beyond MAX_PARTICLES", () => {
    const pool = createPool();
    const sys = makeSys({ life: 999 });
    for (let i = 0; i < MAX_PARTICLES + 10; i++) {
      spawnParticle(pool, sys);
    }
    expect(countAlive(pool)).toBe(MAX_PARTICLES);
    expect(pool.count).toBe(MAX_PARTICLES);
  });
});

describe("stepParticles", () => {
  it("ages particles", () => {
    const pool = createPool();
    const sys = makeSys({ life: 2.0 });
    spawnParticle(pool, sys);
    stepParticles(pool, sys, 0.5);
    expect(pool.ages[0]).toBeCloseTo(0.5);
  });

  it("kills particles after lifetime expires", () => {
    const pool = createPool();
    const sys = makeSys({ life: 0.5 });
    spawnParticle(pool, sys);
    expect(countAlive(pool)).toBe(1);
    stepParticles(pool, sys, 0.6);
    expect(countAlive(pool)).toBe(0);
    expect(pool.count).toBe(0);
  });

  it("applies acceleration to velocity", () => {
    const pool = createPool();
    const sys = makeSys({
      type: PARTICLE_TYPE.LINE_SINGLE,
      life: 10,
      velocity: 0,
      direction: [0, 0, 0],
      acceleration: [0, -10, 0],
    });
    spawnParticle(pool, sys);
    stepParticles(pool, sys, 1.0);
    const vel = getVelocity(pool, 0);
    expect(vel[1]).toBeCloseTo(-10.0, 0);
  });

  it("integrates position from velocity", () => {
    const pool = createPool();
    const sys = makeSys({
      type: PARTICLE_TYPE.LINE_SINGLE,
      life: 10,
      velocity: 5,
      direction: [1, 0, 0],
      acceleration: [0, 0, 0],
      offset: [0, 0, 0],
      range: [0, 0, 0],
    });
    spawnParticle(pool, sys);
    stepParticles(pool, sys, 1.0);
    // position should be ~5 in x (vel=5 * dir=[1,0,0] * dt=1)
    expect(pool.positions[0]).toBeCloseTo(5.0, 0);
  });

  it("interpolates frame colors over lifetime", () => {
    const pool = createPool();
    const sys = makeSys({
      life: 1.0,
      frameColors: [
        [1, 0, 0, 1],
        [0, 0, 1, 0],
      ],
    });
    spawnParticle(pool, sys);
    // At t=0, color should be [1,0,0]
    expect(pool.colors[0]).toBeCloseTo(1.0);
    expect(pool.colors[2]).toBeCloseTo(0.0);
    // Step to midpoint
    stepParticles(pool, sys, 0.5);
    // At t=0.5 (50% of life), color should be ~[0.5, 0, 0.5]
    expect(pool.colors[0]).toBeCloseTo(0.5, 1);
    expect(pool.colors[2]).toBeCloseTo(0.5, 1);
  });
});

describe("tickPool", () => {
  it("spawns particles at step interval", () => {
    const pool = createPool();
    const sys = makeSys({ step: 0.1, particleCount: 10, life: 10 });
    // Tick for 0.25s => should spawn at t=0.1 and t=0.2
    tickPool(pool, sys, 0.25);
    expect(countAlive(pool)).toBe(2);
  });

  it("respects particleCount cap", () => {
    const pool = createPool();
    const sys = makeSys({ step: 0.001, particleCount: 5, life: 10 });
    // Many ticks but cap at 5
    for (let i = 0; i < 100; i++) {
      tickPool(pool, sys, 0.01);
    }
    expect(countAlive(pool)).toBeLessThanOrEqual(5);
  });

  it("respects delay time", () => {
    const pool = createPool();
    const sys = makeSys({ step: 0.01, delayTime: 1.0, particleCount: 10, life: 10 });
    tickPool(pool, sys, 0.5);
    expect(countAlive(pool)).toBe(0);
    // After delay passes
    tickPool(pool, sys, 0.6);
    expect(countAlive(pool)).toBeGreaterThan(0);
  });

  it("dead particles free slots for new ones", () => {
    const pool = createPool();
    const sys = makeSys({ step: 0.01, particleCount: 3, life: 0.1 });
    // Spawn 3
    tickPool(pool, sys, 0.05);
    const initial = countAlive(pool);
    expect(initial).toBeGreaterThan(0);
    // Wait for them to die
    tickPool(pool, sys, 0.2);
    // New particles can spawn into freed slots
    tickPool(pool, sys, 0.05);
    // Some should be alive again
    expect(countAlive(pool)).toBeGreaterThan(0);
  });

  it("never exceeds MAX_PARTICLES", () => {
    const pool = createPool();
    const sys = makeSys({ step: 0.001, particleCount: 100, life: 999 });
    for (let i = 0; i < 200; i++) {
      tickPool(pool, sys, 0.001);
    }
    expect(countAlive(pool)).toBeLessThanOrEqual(MAX_PARTICLES);
  });
});
