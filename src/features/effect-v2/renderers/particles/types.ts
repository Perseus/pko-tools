import { ParSystem } from "@/types/effect-v2";
import type { DummyLineSpan } from "./dummyLineKinematics";
import type { MutableRefObject } from "react";
import type * as THREE from "three";

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
  /** Runtime dummy1/dummy2 span used by C++ dummy-line particle systems. */
  dummyLineSpan?: DummyLineSpan | null;
  /** Runtime CMPPartCtrl::MoveTo emitter position, in Three coordinates. */
  emitterPositionRef?: MutableRefObject<THREE.Vector3 | null>;
  /** Runtime CMPPartCtrl::setDir direction, used by source modelDir particle systems. */
  sourceDirectionRef?: MutableRefObject<THREE.Vector3 | null>;
  /** Called once when this system's animation is complete (non-looping only). */
  onComplete?: () => void;
  /** Source CMPResManger::SendResMessage-style follow-on particle trigger. */
  onHitEffect?: (
    particleEffectName: string,
    position: THREE.Vector3,
    sourceDirection?: THREE.Vector3,
  ) => void;
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
