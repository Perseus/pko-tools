export interface MagicSingleEntry {
  id: number;
  data_name: string;
  name: string;
  models: string[];
  velocity: number;
  particles: string[];
  dummies: number[];
  render_idx: number;
  lightId: number;
  result_effect: string;
}

export interface MagicSingleTable {
  recordSize: number;
  entries: MagicSingleEntry[];
}

export interface ParFile {
  version: number;
  name: string;
  length: number;
  systems: ParSystem[];
  strips: ParStrip[];
  models: ParChaModel[];
}

export interface ParSystem {
  type: number;
  name: string;
  particleCount: number;
  textureName: string;
  modelName: string;
  range: [number, number, number];
  frameCount: number;
  frameSizes: number[];
  frameAngles: [number, number, number][];
  frameColors: [number, number, number, number][];
  billboard: boolean;
  srcBlend: number;
  destBlend: number;
  life: number;
  velocity: number;
  direction: [number, number, number];
  acceleration: [number, number, number];
  step: number;
  offset: [number, number, number];
  delayTime: number;
  playTime: number;
  usePath: boolean;
  path: ParEffPath | null;
  shade: boolean;
  hitEffect: string;
  pointRanges: [number, number, number][];
  randomMode: number;
  modelDir: boolean;
  mediaY: boolean;
}

export interface ParEffPath {
  velocity: number;
  points: [number, number, number][];
  directions: [number, number, number][];
  distances: number[];
}

export interface ParStrip {
  maxLen: number;
  dummy: [number, number];
  color: [number, number, number, number];
  life: number;
  step: number;
  textureName: string;
  srcBlend: number;
  destBlend: number;
}

export interface ParChaModel {
  id: number;
  velocity: number;
  playType: number;
  curPose: number;
  srcBlend: number;
  destBlend: number;
  color: [number, number, number, number];
}
