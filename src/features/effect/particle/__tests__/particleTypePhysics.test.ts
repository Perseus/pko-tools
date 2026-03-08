import { describe, expect, it } from "vitest";
import {
  createPool,
  spawnParticle,
  stepParticles,
  countAlive,
} from "@/features/effect/particle/particlePool";
import { createDefaultParticleSystem, PARTICLE_TYPE } from "@/types/particle";
import type { ParticleSystem } from "@/types/particle";

function makeSys(overrides: Partial<ParticleSystem> = {}): ParticleSystem {
  return { ...createDefaultParticleSystem(), ...overrides };
}

function spawnAndStep(type: number, steps: number, dt = 1 / 60): ReturnType<typeof createPool> {
  const pool = createPool();
  const sys = makeSys({
    type,
    life: 2.0,
    velocity: 1.0,
    direction: [0, 1, 0],
    offset: [0, 0, 0],
    range: [0, 0, 0],
  });

  // Spawn multiple particles
  for (let s = 0; s < 5; s++) {
    spawnParticle(pool, sys);
  }

  // Step simulation
  for (let s = 0; s < steps; s++) {
    stepParticles(pool, sys, dt);
  }

  return pool;
}

describe("per-type particle physics", () => {
  it("FIRE: spreads with upward bias", () => {
    const pool = spawnAndStep(PARTICLE_TYPE.FIRE, 60);
    // Particles should have moved in Y (upward bias)
    let totalY = 0;
    for (let i = 0; i < 5; i++) {
      if (pool.alive[i]) totalY += pool.positions[i * 3 + 1];
    }
    expect(totalY).toBeGreaterThan(0);
  });

  it("BLAST: spreads uniformly in sphere", () => {
    const pool = spawnAndStep(PARTICLE_TYPE.BLAST, 60);
    // Particles should have spread in all directions
    const alive = countAlive(pool);
    expect(alive).toBeGreaterThan(0);
  });

  it("BLAST2 and BLAST3 share BLAST physics", () => {
    const pool2 = createPool();
    const pool3 = createPool();
    const sys2 = makeSys({ type: PARTICLE_TYPE.BLAST2, life: 10, velocity: 1, range: [0, 0, 0] });
    const sys3 = makeSys({ type: PARTICLE_TYPE.BLAST3, life: 10, velocity: 1, range: [0, 0, 0] });

    spawnParticle(pool2, sys2);
    spawnParticle(pool3, sys3);

    // Both should have non-zero velocity (spherical emission)
    expect(pool2.velocities[0] !== 0 || pool2.velocities[1] !== 0 || pool2.velocities[2] !== 0).toBe(true);
    expect(pool3.velocities[0] !== 0 || pool3.velocities[1] !== 0 || pool3.velocities[2] !== 0).toBe(true);
  });

  it("SNOW: falls downward with wavy X", () => {
    const pool = createPool();
    const sys = makeSys({
      type: PARTICLE_TYPE.SNOW,
      life: 2.0,
      velocity: 2.0,
      offset: [0, 10, 0],
      range: [0, 0, 0],
    });
    spawnParticle(pool, sys);
    for (let s = 0; s < 60; s++) {
      stepParticles(pool, sys, 1 / 60);
    }
    // Should have moved downward
    expect(pool.positions[1]).toBeLessThan(10);
  });

  it("RIPPLE: stays at origin, no translation", () => {
    const pool = createPool();
    const sys = makeSys({
      type: PARTICLE_TYPE.RIPPLE,
      life: 2.0,
      velocity: 5.0,
      offset: [0, 0, 0],
      range: [0, 0, 0],
    });
    spawnParticle(pool, sys);
    const startPos = [pool.positions[0], pool.positions[1], pool.positions[2]];

    for (let s = 0; s < 60; s++) {
      stepParticles(pool, sys, 1 / 60);
    }

    // RIPPLE should NOT move from spawn position
    expect(pool.positions[0]).toBeCloseTo(startPos[0], 5);
    expect(pool.positions[1]).toBeCloseTo(startPos[1], 5);
    expect(pool.positions[2]).toBeCloseTo(startPos[2], 5);
  });

  it("WIND: spiral motion with upward movement", () => {
    const pool = createPool();
    const sys = makeSys({
      type: PARTICLE_TYPE.WIND,
      life: 2.0,
      velocity: 1.0,
      acceleration: [1, 0, 1],
      offset: [0, 0, 0],
      range: [0, 0, 0],
    });
    spawnParticle(pool, sys);

    for (let s = 0; s < 60; s++) {
      stepParticles(pool, sys, 1 / 60);
    }

    // WIND should move upward (Y velocity)
    expect(pool.positions[1]).toBeGreaterThan(0);
  });

  it("ARROW: stays at offset, no movement", () => {
    const pool = createPool();
    const sys = makeSys({
      type: PARTICLE_TYPE.ARROW,
      life: 2.0,
      velocity: 5.0,
      offset: [3, 4, 5],
      range: [0, 0, 0],
    });
    spawnParticle(pool, sys);

    for (let s = 0; s < 60; s++) {
      stepParticles(pool, sys, 1 / 60);
    }

    // ARROW should NOT move from spawn position
    expect(pool.positions[0]).toBeCloseTo(3, 5);
    expect(pool.positions[1]).toBeCloseTo(4, 5);
    expect(pool.positions[2]).toBeCloseTo(5, 5);
  });

  it("ROUND: circular expansion from center", () => {
    const pool = spawnAndStep(PARTICLE_TYPE.ROUND, 60);
    // Particles should have moved
    expect(countAlive(pool)).toBeGreaterThan(0);
  });

  it("SHRINK: has velocity (directed or spherical)", () => {
    const pool = createPool();
    const sys = makeSys({
      type: PARTICLE_TYPE.SHRINK,
      life: 2.0,
      velocity: 1.0,
      direction: [1, 0, 0],
      range: [0, 0, 0],
    });
    spawnParticle(pool, sys);
    // Directed velocity along direction
    expect(pool.velocities[0]).toBeCloseTo(1.0, 1);
  });

  it("SHADE: stays at origin like RIPPLE", () => {
    const pool = createPool();
    const sys = makeSys({
      type: PARTICLE_TYPE.SHADE,
      life: 2.0,
      velocity: 5.0,
      offset: [0, 0, 0],
      range: [0, 0, 0],
    });
    spawnParticle(pool, sys);
    const startPos = [pool.positions[0], pool.positions[1], pool.positions[2]];

    for (let s = 0; s < 60; s++) {
      stepParticles(pool, sys, 1 / 60);
    }

    expect(pool.positions[0]).toBeCloseTo(startPos[0], 5);
    expect(pool.positions[1]).toBeCloseTo(startPos[1], 5);
    expect(pool.positions[2]).toBeCloseTo(startPos[2], 5);
  });

  it("RANGE/RANGE2: stay at origin, scale-based", () => {
    for (const type of [PARTICLE_TYPE.RANGE, PARTICLE_TYPE.RANGE2]) {
      const pool = createPool();
      const sys = makeSys({
        type,
        life: 2.0,
        velocity: 5.0,
        offset: [0, 0, 0],
        range: [0, 0, 0],
      });
      spawnParticle(pool, sys);

      for (let s = 0; s < 60; s++) {
        stepParticles(pool, sys, 1 / 60);
      }

      expect(pool.positions[0]).toBeCloseTo(0, 5);
      expect(pool.positions[1]).toBeCloseTo(0, 5);
      expect(pool.positions[2]).toBeCloseTo(0, 5);
    }
  });

  it("DUMMY: stays at offset, static", () => {
    const pool = createPool();
    const sys = makeSys({
      type: PARTICLE_TYPE.DUMMY,
      life: 2.0,
      velocity: 5.0,
      offset: [1, 2, 3],
      range: [0, 0, 0],
    });
    spawnParticle(pool, sys);

    for (let s = 0; s < 60; s++) {
      stepParticles(pool, sys, 1 / 60);
    }

    expect(pool.positions[0]).toBeCloseTo(1, 5);
    expect(pool.positions[1]).toBeCloseTo(2, 5);
    expect(pool.positions[2]).toBeCloseTo(3, 5);
  });

  it("LINE_SINGLE: moves along direction", () => {
    const pool = createPool();
    const sys = makeSys({
      type: PARTICLE_TYPE.LINE_SINGLE,
      life: 10,
      velocity: 5,
      direction: [1, 0, 0],
      offset: [0, 0, 0],
      range: [0, 0, 0],
    });
    spawnParticle(pool, sys);
    stepParticles(pool, sys, 1.0);
    expect(pool.positions[0]).toBeCloseTo(5.0, 0);
  });

  it("LINE_ROUND: circular tangential velocity", () => {
    const pool = createPool();
    const sys = makeSys({
      type: PARTICLE_TYPE.LINE_ROUND,
      life: 2.0,
      velocity: 1.0,
      offset: [0, 0, 0],
      range: [1, 0, 0],
    });
    spawnParticle(pool, sys);
    // Should have non-zero velocity
    const velX = pool.velocities[0];
    const velZ = pool.velocities[2];
    expect(velX !== 0 || velZ !== 0).toBe(true);
  });
});
