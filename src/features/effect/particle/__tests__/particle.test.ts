import { describe, expect, it } from "vitest";
import {
  createDefaultParticleSystem,
  createDefaultParticleController,
  PARTICLE_TYPE,
  PARTICLE_TYPE_LABELS,
} from "@/types/particle";

describe("particle types", () => {
  it("has 18 particle type constants", () => {
    const keys = Object.keys(PARTICLE_TYPE);
    expect(keys).toHaveLength(18);
  });

  it("type IDs are sequential 1-18", () => {
    const values = Object.values(PARTICLE_TYPE).sort((a, b) => a - b);
    expect(values).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
  });

  it("all types have labels", () => {
    for (const id of Object.values(PARTICLE_TYPE)) {
      expect(PARTICLE_TYPE_LABELS[id]).toBeDefined();
      expect(typeof PARTICLE_TYPE_LABELS[id]).toBe("string");
    }
  });
});

describe("createDefaultParticleSystem", () => {
  it("creates a valid system with default FIRE type", () => {
    const sys = createDefaultParticleSystem();
    expect(sys.type).toBe(PARTICLE_TYPE.FIRE);
    expect(sys.particleCount).toBe(10);
    expect(sys.life).toBeGreaterThan(0);
    expect(sys.velocity).toBeGreaterThan(0);
    expect(sys.step).toBeGreaterThan(0);
  });

  it("accepts custom type", () => {
    const sys = createDefaultParticleSystem(PARTICLE_TYPE.SNOW);
    expect(sys.type).toBe(PARTICLE_TYPE.SNOW);
  });

  it("has matching frameCount and array lengths", () => {
    const sys = createDefaultParticleSystem();
    expect(sys.frameSizes).toHaveLength(sys.frameCount);
    expect(sys.frameAngles).toHaveLength(sys.frameCount);
    expect(sys.frameColors).toHaveLength(sys.frameCount);
  });

  it("has 3-component range", () => {
    const sys = createDefaultParticleSystem();
    expect(sys.range).toHaveLength(3);
  });

  it("has 3-component direction, acceleration, offset", () => {
    const sys = createDefaultParticleSystem();
    expect(sys.direction).toHaveLength(3);
    expect(sys.acceleration).toHaveLength(3);
    expect(sys.offset).toHaveLength(3);
  });

  it("has 4-component frame colors", () => {
    const sys = createDefaultParticleSystem();
    for (const color of sys.frameColors) {
      expect(color).toHaveLength(4);
    }
  });

  it("respects particle count limit", () => {
    const sys = createDefaultParticleSystem();
    expect(sys.particleCount).toBeLessThanOrEqual(100);
    expect(sys.particleCount).toBeGreaterThanOrEqual(1);
  });
});

describe("createDefaultParticleController", () => {
  it("creates an empty controller", () => {
    const ctrl = createDefaultParticleController();
    expect(ctrl.systems).toHaveLength(0);
    expect(ctrl.length).toBeGreaterThan(0);
    expect(ctrl.name).toBe("");
  });
});
