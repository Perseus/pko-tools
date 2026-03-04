import { describe, expect, it } from "vitest";
import {
  createPool,
  stepParticles,
  spawnParticle,
} from "@/features/effect/particle/particlePool";
import { createDefaultParticleSystem } from "@/types/particle";

/**
 * Tests for Phase G: Path-following particle motion.
 * When usePath=true and path.points is available, particles
 * should follow the path instead of velocity-based motion.
 */

describe("path-following particle motion", () => {
  it("particle positions follow path points over lifetime", () => {
    const pool = createPool();
    const sys = {
      ...createDefaultParticleSystem(),
      usePath: true,
      life: 1.0,
      velocity: 0,
      direction: [0, 0, 0] as [number, number, number],
      acceleration: [0, 0, 0] as [number, number, number],
      range: [0, 0, 0] as [number, number, number],
      offset: [0, 0, 0] as [number, number, number],
      path: {
        velocity: 1.0,
        points: [
          [0, 0, 0] as [number, number, number],
          [10, 0, 0] as [number, number, number],
        ],
        directions: [],
        distances: [],
      },
    };

    spawnParticle(pool, sys);
    expect(pool.alive[0]).toBe(1);

    // Step to t=0.5 (half life) — should be ~50% along path
    stepParticles(pool, sys, 0.5);
    expect(pool.positions[0]).toBeCloseTo(5.0, 0);
  });

  it("path with no points falls back to velocity motion", () => {
    const pool = createPool();
    const sys = {
      ...createDefaultParticleSystem(),
      usePath: true,
      life: 1.0,
      velocity: 5.0,
      direction: [0, 1, 0] as [number, number, number],
      path: {
        velocity: 1.0,
        points: [] as [number, number, number][],
        directions: [],
        distances: [],
      },
    };

    spawnParticle(pool, sys);
    // Should use normal velocity-based motion when path is empty
    stepParticles(pool, sys, 0.1);
    // Y should have increased due to upward velocity
    expect(pool.positions[1]).toBeGreaterThan(0);
  });

  it("particles without usePath ignore path data", () => {
    const pool = createPool();
    const sys = {
      ...createDefaultParticleSystem(),
      usePath: false,
      life: 1.0,
      velocity: 0,
      direction: [0, 0, 0] as [number, number, number],
      acceleration: [0, 0, 0] as [number, number, number],
      range: [0, 0, 0] as [number, number, number],
      offset: [0, 0, 0] as [number, number, number],
      path: {
        velocity: 1.0,
        points: [
          [0, 0, 0] as [number, number, number],
          [100, 0, 0] as [number, number, number],
        ],
        directions: [],
        distances: [],
      },
    };

    spawnParticle(pool, sys);
    stepParticles(pool, sys, 0.5);
    // Position should stay near origin (no velocity, no path following)
    expect(Math.abs(pool.positions[0])).toBeLessThan(1);
  });
});
