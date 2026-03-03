import { describe, expect, it } from "vitest";
import {
  createPool,
  tickPool,
  countAlive,
} from "@/features/effect/particle/particlePool";
import { createDefaultParticleSystem } from "@/types/particle";
import type { ParticleSystem } from "@/types/particle";

function makeSys(overrides: Partial<ParticleSystem> = {}): ParticleSystem {
  return { ...createDefaultParticleSystem(), ...overrides };
}

describe("playTime emission cutoff", () => {
  it("stops emitting after playTime seconds", () => {
    const pool = createPool();
    const sys = makeSys({
      step: 0.01,
      particleCount: 50,
      life: 5.0,
      playTime: 0.5,
      delayTime: 0,
    });

    // Tick for 0.5s — particles should be spawning
    for (let i = 0; i < 50; i++) {
      tickPool(pool, sys, 0.01);
    }
    const countAtPlayTime = countAlive(pool);
    expect(countAtPlayTime).toBeGreaterThan(0);

    // Record how many are alive before continuing
    const countBefore = countAlive(pool);

    // Tick for another 0.5s — no NEW particles should spawn
    for (let i = 0; i < 50; i++) {
      tickPool(pool, sys, 0.01);
    }
    const countAfter = countAlive(pool);
    // Count should only stay the same or decrease (particles aging out)
    expect(countAfter).toBeLessThanOrEqual(countBefore);
  });

  it("does not cut off when playTime is 0 (infinite)", () => {
    const pool = createPool();
    const sys = makeSys({
      step: 0.01,
      particleCount: 50,
      life: 10.0,
      playTime: 0, // infinite
      delayTime: 0,
    });

    // Tick for a long time — particles should keep spawning
    for (let i = 0; i < 200; i++) {
      tickPool(pool, sys, 0.01);
    }
    expect(countAlive(pool)).toBeGreaterThan(0);
  });

  it("existing particles age out after playTime cutoff", () => {
    const pool = createPool();
    const sys = makeSys({
      step: 0.01,
      particleCount: 50,
      life: 0.1, // short lifetime
      playTime: 0.3,
      delayTime: 0,
    });

    // Tick to emit particles within playTime
    for (let i = 0; i < 30; i++) {
      tickPool(pool, sys, 0.01);
    }
    expect(countAlive(pool)).toBeGreaterThan(0);

    // Tick well past playTime + particle lifetime — all should die
    for (let i = 0; i < 100; i++) {
      tickPool(pool, sys, 0.01);
    }
    expect(countAlive(pool)).toBe(0);
  });
});
