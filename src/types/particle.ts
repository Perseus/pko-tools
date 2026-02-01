import type { Vec3, Vec4 } from "@/types/effect";

/**
 * PKO particle type IDs (from MPParticleSys.h).
 * Maps 1:1 to PARTTICLE_* defines in the engine.
 */
export const PARTICLE_TYPE = {
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

export type ParticleTypeId = (typeof PARTICLE_TYPE)[keyof typeof PARTICLE_TYPE];

export const PARTICLE_TYPE_LABELS: Record<number, string> = {
  [PARTICLE_TYPE.SNOW]: "Snow",
  [PARTICLE_TYPE.FIRE]: "Fire",
  [PARTICLE_TYPE.BLAST]: "Blast",
  [PARTICLE_TYPE.RIPPLE]: "Ripple",
  [PARTICLE_TYPE.MODEL]: "Model",
  [PARTICLE_TYPE.STRIP]: "Strip",
  [PARTICLE_TYPE.WIND]: "Wind",
  [PARTICLE_TYPE.ARROW]: "Arrow",
  [PARTICLE_TYPE.ROUND]: "Round",
  [PARTICLE_TYPE.BLAST2]: "Blast 2",
  [PARTICLE_TYPE.BLAST3]: "Blast 3",
  [PARTICLE_TYPE.SHRINK]: "Shrink",
  [PARTICLE_TYPE.SHADE]: "Shade",
  [PARTICLE_TYPE.RANGE]: "Range",
  [PARTICLE_TYPE.RANGE2]: "Range 2",
  [PARTICLE_TYPE.DUMMY]: "Dummy",
  [PARTICLE_TYPE.LINE_SINGLE]: "Linear Movement",
  [PARTICLE_TYPE.LINE_ROUND]: "Linear Follow",
};

/**
 * A single particle system definition matching CMPPartSys binary layout.
 * Field order follows SaveToFile/LoadFromFile in MPParticleSys.cpp.
 */
export interface ParticleSystem {
  /** Particle type ID (1-18). */
  type: ParticleTypeId | number;
  /** System name (max 32 chars in binary). */
  name: string;
  /** Number of active particles (1-100). */
  particleCount: number;
  /** Texture filename (max 32 chars). */
  textureName: string;
  /** Model/mesh filename (max 32 chars). */
  modelName: string;

  /** Spawn range randomization [x, y, z]. */
  range: Vec3;

  /** Number of animation keyframes. */
  frameCount: number;
  /** Size per keyframe. */
  frameSizes: number[];
  /** Rotation per keyframe (pitch, yaw, roll). */
  frameAngles: Vec3[];
  /** Color per keyframe (r, g, b, a). */
  frameColors: Vec4[];

  /** Always face camera. */
  billboard: boolean;
  /** D3DBLEND source factor. */
  srcBlend: number;
  /** D3DBLEND dest factor. */
  destBlend: number;
  /** D3DTEXTUREFILTERTYPE min filter. */
  minFilter: number;
  /** D3DTEXTUREFILTERTYPE mag filter. */
  magFilter: number;

  /** Particle lifetime in seconds. */
  life: number;
  /** Velocity magnitude. */
  velocity: number;
  /** Velocity direction vector. */
  direction: Vec3;
  /** Acceleration per frame. */
  acceleration: Vec3;
  /** Emission step/rate. */
  step: number;

  /** Use model bounds for spawn area. */
  modelRange: boolean;
  /** Virtual model name for range bounds. */
  virtualModel: string;
  /** Position offset. */
  offset: Vec3;
  /** Delay before particles start. */
  delayTime: number;
  /** Total play duration (0 = infinite). */
  playTime: number;
  /** Has movement path. */
  usePath: boolean;
  /** Use shade model. */
  shade: boolean;
  /** Hit effect name. */
  hitEffect: string;
  /** Point range vertices (when modelRange). */
  pointRange: Vec3[];
  /** Random mode/seed. */
  random: number;
  /** Model direction flag. */
  modelDir: boolean;
  /** Media flag. */
  mediaY: boolean;
}

/**
 * Particle controller - top-level container matching CMPPartCtrl.
 * Holds multiple particle systems and strips.
 */
export interface ParticleController {
  /** Controller name. */
  name: string;
  /** Particle systems in this controller. */
  systems: ParticleSystem[];
  /** Total duration in seconds. */
  length: number;
}

/** Create a default particle system with sensible initial values. */
export function createDefaultParticleSystem(
  type: number = PARTICLE_TYPE.FIRE,
): ParticleSystem {
  return {
    type,
    name: "",
    particleCount: 10,
    textureName: "",
    modelName: "",
    range: [0.5, 0.5, 0.5],
    frameCount: 2,
    frameSizes: [1.0, 0.5],
    frameAngles: [
      [0, 0, 0],
      [0, 0, 0],
    ],
    frameColors: [
      [1, 1, 0.5, 1],
      [1, 0.2, 0, 0],
    ],
    billboard: true,
    srcBlend: 5,
    destBlend: 2,
    minFilter: 2,
    magFilter: 2,
    life: 1.0,
    velocity: 2.0,
    direction: [0, 1, 0],
    acceleration: [0, 0, 0],
    step: 0.05,
    modelRange: false,
    virtualModel: "",
    offset: [0, 0, 0],
    delayTime: 0,
    playTime: 0,
    usePath: false,
    shade: false,
    hitEffect: "",
    pointRange: [],
    random: 0,
    modelDir: false,
    mediaY: false,
  };
}

/** Create a default empty particle controller. */
export function createDefaultParticleController(): ParticleController {
  return {
    name: "",
    systems: [],
    length: 2.0,
  };
}
