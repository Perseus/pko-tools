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
