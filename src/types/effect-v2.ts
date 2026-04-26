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

export interface MagicGroupEntry {
  id: number;
  data_name: string;
  name: string;
  typeIds: number[];   // up to 8 MagicSingleInfo IDs (-1 = unused)
  counts: number[];    // play count for each type
  totalCount: number;
  renderIdx: number;
}

export interface MagicGroupTable {
  recordSize: number;
  entries: MagicGroupEntry[];
}

/** Which content type is shown in the navigator. */
export type EffectV2ViewMode = 'magic_group' | 'magic_one' | 'effect' | 'particle';

/** Discriminated union for what is currently selected in the viewer. */
export type EffectV2Selection =
  | { type: 'magic_group'; entry: MagicGroupEntry }
  | { type: 'magic_one';   entry: MagicSingleEntry }
  | { type: 'effect';      fileName: string }
  | { type: 'particle';    fileName: string }

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
