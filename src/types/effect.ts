export type Vec2 = [number, number];
export type Vec3 = [number, number, number];
export type Vec4 = [number, number, number, number];

export interface EffectFile {
  version: number;
  idxTech: number;
  usePath: boolean;
  pathName: string;
  useSound: boolean;
  soundName: string;
  rotating: boolean;
  rotaVec: Vec3;
  rotaVel: number;
  effNum: number;
  subEffects: SubEffect[];
}

export interface SubEffect {
  effectName: string;
  effectType: number;
  srcBlend: number;
  destBlend: number;
  length: number;
  frameCount: number;
  frameTimes: number[];
  frameSizes: Vec3[];
  frameAngles: Vec3[];
  framePositions: Vec3[];
  frameColors: Vec4[];
  verCount: number;
  coordCount: number;
  coordFrameTime: number;
  coordList: Vec2[][];
  texCount: number;
  texFrameTime: number;
  texName: string;
  texList: Vec2[][];
  modelName: string;
  billboard: boolean;
  vsIndex: number;
  segments: number;
  height: number;
  topRadius: number;
  botRadius: number;
  frameTexCount: number;
  frameTexTime: number;
  frameTexNames: string[];
  frameTexTime2: number;
  useParam: number;
  perFrameCylinder: CylinderParams[];
  rotaLoop: boolean;
  rotaLoopVec: Vec4;
  alpha: boolean;
  rotaBoard: boolean;
}

export interface CylinderParams {
  segments: number;
  height: number;
  topRadius: number;
  botRadius: number;
}

/**
 * Strip effect (CMPStrip) - ribbon trail between two dummy points.
 * Binary format: 76 bytes per strip (see MPModelEff.cpp SaveToFile).
 */
export interface StripEffect {
  /** Maximum strip length (number of segments). */
  maxLen: number;
  /** Two dummy point indices on the bound character. */
  dummy: [number, number];
  /** Strip color (RGBA). */
  color: Vec4;
  /** Fade lifetime in seconds. */
  life: number;
  /** Update step time in seconds. */
  step: number;
  /** Texture name (max 32 chars). */
  texName: string;
  /** D3DBLEND source factor. */
  srcBlend: number;
  /** D3DBLEND dest factor. */
  destBlend: number;
}

/**
 * Path data from .csf files.
 * Binary format: header "csf" + version(i32) + count(i32) + Vec3[count].
 */
export interface EffectPath {
  /** Path name / filename. */
  name: string;
  /** Path control points. */
  points: Vec3[];
}

/** Create a default strip effect. */
export function createDefaultStrip(): StripEffect {
  return {
    maxLen: 10,
    dummy: [0, 1],
    color: [1, 1, 1, 1],
    life: 1.0,
    step: 0.05,
    texName: "",
    srcBlend: 5,
    destBlend: 2,
  };
}
