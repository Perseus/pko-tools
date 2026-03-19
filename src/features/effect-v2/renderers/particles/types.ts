import { ParSystem } from "@/types/effect-v2";

/**
 * Common props for all particle system renderers.
 * Each system is a behavior controller that owns its visual rendering.
 */
export interface ParticleSystemProps {
  /** The particle system data from the .par file. */
  system: ParSystem;
  /** Index of this system within the ParFile.systems array. */
  index: number;
  /** Whether the particle system should loop. */
  loop?: boolean;
  /** Called once when this system's animation is complete (non-looping only). */
  onComplete?: () => void;
}

/**
 * Particle system type IDs from MPParticleSys.h.
 * Maps to the `type` field in ParSystem.
 */
export const ParticleType = {
  SNOW: 1,
  FIRE: 2,
  BLAST: 3,
  RIPPLE: 4,
  MODEL: 5,
  STRIP: 6,
  WIND: 7,
  ARROW: 8,
  ROUND: 9,
  BLAST2: 10,
  BLAST3: 11,
  SHRINK: 12,
  SHADE: 13,
  RANGE: 14,
  RANGE2: 15,
  DUMMY: 16,
  LINE_SINGLE: 17,
  LINE_ROUND: 18,
} as const;
