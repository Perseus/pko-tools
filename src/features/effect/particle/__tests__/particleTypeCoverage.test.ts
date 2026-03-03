import { describe, expect, it } from "vitest";
import { PARTICLE_TYPE } from "@/types/particle";
import { SPAWN_FN, STEP_FN } from "@/features/effect/particle/particlePool";

/**
 * Verify that every PARTICLE_TYPE value has both a SPAWN_FN and STEP_FN entry.
 * No missing types should fall to the default handler.
 */
describe("particle type dispatch coverage", () => {
  const allTypes = Object.entries(PARTICLE_TYPE);

  it("every PARTICLE_TYPE has a SPAWN_FN entry", () => {
    for (const [name, id] of allTypes) {
      expect(SPAWN_FN[id], `Missing SPAWN_FN for ${name} (${id})`).toBeDefined();
    }
  });

  it("every PARTICLE_TYPE has a STEP_FN entry", () => {
    for (const [name, id] of allTypes) {
      expect(STEP_FN[id], `Missing STEP_FN for ${name} (${id})`).toBeDefined();
    }
  });

  it("all 18 types are covered", () => {
    expect(allTypes.length).toBe(18);
    expect(Object.keys(SPAWN_FN).length).toBe(18);
    expect(Object.keys(STEP_FN).length).toBe(18);
  });

  it("SPAWN_FN and STEP_FN entries are functions", () => {
    for (const [name, id] of allTypes) {
      expect(typeof SPAWN_FN[id], `SPAWN_FN[${name}] should be function`).toBe("function");
      expect(typeof STEP_FN[id], `STEP_FN[${name}] should be function`).toBe("function");
    }
  });
});
