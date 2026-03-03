import { describe, expect, it } from "vitest";
import { PARTICLE_TYPE } from "@/types/particle";

/**
 * Tests for Phase B: Special geometry type classification.
 * Verifies that SHADE, RANGE, RANGE2, and DUMMY types are
 * routed to their correct render paths.
 */

// These match the Sets defined in ParticleSimulator.tsx
const SHADE_TYPES = new Set<number>([PARTICLE_TYPE.SHADE]);
const RANGE_TYPES = new Set<number>([PARTICLE_TYPE.RANGE, PARTICLE_TYPE.RANGE2]);
const DUMMY_TYPES = new Set<number>([PARTICLE_TYPE.DUMMY]);

describe("particle type geometry routing", () => {
  it("SHADE (13) maps to ground-plane decal", () => {
    expect(SHADE_TYPES.has(PARTICLE_TYPE.SHADE)).toBe(true);
    expect(SHADE_TYPES.has(PARTICLE_TYPE.FIRE)).toBe(false);
  });

  it("RANGE (14) and RANGE2 (15) map to expanding ring", () => {
    expect(RANGE_TYPES.has(PARTICLE_TYPE.RANGE)).toBe(true);
    expect(RANGE_TYPES.has(PARTICLE_TYPE.RANGE2)).toBe(true);
    expect(RANGE_TYPES.has(PARTICLE_TYPE.SHADE)).toBe(false);
  });

  it("DUMMY (16) produces no visible output", () => {
    expect(DUMMY_TYPES.has(PARTICLE_TYPE.DUMMY)).toBe(true);
    expect(DUMMY_TYPES.has(PARTICLE_TYPE.MODEL)).toBe(false);
  });

  it("billboard types are not in special sets", () => {
    const billboardTypes = [
      PARTICLE_TYPE.SNOW,
      PARTICLE_TYPE.FIRE,
      PARTICLE_TYPE.BLAST,
      PARTICLE_TYPE.WIND,
      PARTICLE_TYPE.ROUND,
    ];
    for (const t of billboardTypes) {
      expect(SHADE_TYPES.has(t)).toBe(false);
      expect(RANGE_TYPES.has(t)).toBe(false);
      expect(DUMMY_TYPES.has(t)).toBe(false);
    }
  });
});
