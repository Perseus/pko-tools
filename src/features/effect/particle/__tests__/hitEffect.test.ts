import { describe, expect, it, vi } from "vitest";
import {
  createPool,
  spawnParticle,
  stepParticles,
  tickPool,
} from "@/features/effect/particle/particlePool";
import { createDefaultParticleSystem, PARTICLE_TYPE } from "@/types/particle";
import type { ParticleSystem } from "@/types/particle";
import type { Vec3 } from "@/types/effect";

function makeSys(overrides: Partial<ParticleSystem> = {}): ParticleSystem {
  return { ...createDefaultParticleSystem(), ...overrides };
}

describe("hit effect chaining", () => {
  it("calls onParticleDeath when particle expires with hitEffect", () => {
    const pool = createPool();
    const sys = makeSys({
      type: PARTICLE_TYPE.FIRE,
      life: 0.1,
      hitEffect: "spark.eff",
      offset: [1, 2, 3],
      range: [0, 0, 0],
    });

    spawnParticle(pool, sys);

    const deaths: { position: Vec3; hitEffect: string }[] = [];
    const callback = (position: Vec3, hitEffect: string) => {
      deaths.push({ position, hitEffect });
    };

    // Step past lifetime
    stepParticles(pool, sys, 0.2, callback);

    expect(deaths.length).toBe(1);
    expect(deaths[0].hitEffect).toBe("spark.eff");
    // Position should be near the offset (may have moved slightly due to velocity)
    expect(deaths[0].position).toBeDefined();
    expect(deaths[0].position.length).toBe(3);
  });

  it("does not call onParticleDeath when hitEffect is empty", () => {
    const pool = createPool();
    const sys = makeSys({
      type: PARTICLE_TYPE.FIRE,
      life: 0.1,
      hitEffect: "",
      range: [0, 0, 0],
    });

    spawnParticle(pool, sys);

    const callback = vi.fn();
    stepParticles(pool, sys, 0.2, callback);

    expect(callback).not.toHaveBeenCalled();
  });

  it("does not call onParticleDeath when no callback provided", () => {
    const pool = createPool();
    const sys = makeSys({
      type: PARTICLE_TYPE.FIRE,
      life: 0.1,
      hitEffect: "spark.eff",
      range: [0, 0, 0],
    });

    spawnParticle(pool, sys);
    // Should not throw
    expect(() => stepParticles(pool, sys, 0.2)).not.toThrow();
  });

  it("fires for each dying particle", () => {
    const pool = createPool();
    const sys = makeSys({
      type: PARTICLE_TYPE.BLAST,
      life: 0.05,
      hitEffect: "boom.eff",
      particleCount: 5,
      step: 0.001,
      range: [0, 0, 0],
    });

    // Spawn 5 particles
    for (let i = 0; i < 5; i++) {
      spawnParticle(pool, sys);
    }

    const deaths: { position: Vec3; hitEffect: string }[] = [];
    const callback = (position: Vec3, hitEffect: string) => {
      deaths.push({ position, hitEffect });
    };

    // Step past lifetime
    stepParticles(pool, sys, 0.1, callback);

    // All 5 should have died and triggered callback
    expect(deaths.length).toBe(5);
    for (const death of deaths) {
      expect(death.hitEffect).toBe("boom.eff");
    }
  });

  it("works through tickPool", () => {
    const pool = createPool();
    const sys = makeSys({
      type: PARTICLE_TYPE.FIRE,
      life: 0.05,
      hitEffect: "chain.eff",
      step: 0.001,
      particleCount: 3,
      range: [0, 0, 0],
    });

    const deaths: string[] = [];
    const callback = (_position: Vec3, hitEffect: string) => {
      deaths.push(hitEffect);
    };

    // Tick enough to spawn and kill particles
    for (let i = 0; i < 20; i++) {
      tickPool(pool, sys, 0.01, callback);
    }

    expect(deaths.length).toBeGreaterThan(0);
    expect(deaths[0]).toBe("chain.eff");
  });
});
