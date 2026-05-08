import { describe, expect, it } from "vitest";
import { getParticleSystemComponentForTest } from "../renderers/ParticleEffectRenderer";
import { ParticleType } from "../renderers/particles/types";

describe("ParticleEffectRenderer particle type dispatch", () => {
  it("has a renderer for every CMPPartSys particle type id", () => {
    const sourceParticleTypes = [
      ParticleType.SNOW,
      ParticleType.FIRE,
      ParticleType.BLAST,
      ParticleType.RIPPLE,
      ParticleType.MODEL,
      ParticleType.STRIP,
      ParticleType.WIND,
      ParticleType.ARROW,
      ParticleType.ROUND,
      ParticleType.BLAST2,
      ParticleType.BLAST3,
      ParticleType.SHRINK,
      ParticleType.SHADE,
      ParticleType.RANGE,
      ParticleType.RANGE2,
      ParticleType.DUMMY,
      ParticleType.LINE_SINGLE,
      ParticleType.LINE_ROUND,
    ];

    expect(sourceParticleTypes).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
    for (const type of sourceParticleTypes) {
      expect(getParticleSystemComponentForTest(type)).not.toBeNull();
    }
  });

  it("does not route unknown particle type ids to a fallback renderer", () => {
    expect(getParticleSystemComponentForTest(0)).toBeNull();
    expect(getParticleSystemComponentForTest(19)).toBeNull();
  });
});
