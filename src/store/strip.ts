import { atom } from "jotai";
import type { Vec4 } from "@/types/effect";

export interface StripEffectData {
  maxLen: number;
  dummy: [number, number];
  color: Vec4;
  life: number;
  step: number;
  texName: string;
  srcBlend: number;
  destBlend: number;
}

/** Strip data from the UI editor (manually created). */
export const stripEffectDataAtom = atom<StripEffectData | null>(null);

/** Strip data loaded from a native .par file (read-only, set by EffectWorkbench). */
export const parStripDataAtom = atom<StripEffectData[] | null>(null);

/** Model emitter data loaded from a native .par file. */
export interface ParModelData {
  id: number;
  velocity: number;
  playType: number;
  curPose: number;
  srcBlend: number;
  destBlend: number;
  color: Vec4;
}

export const parModelDataAtom = atom<ParModelData[] | null>(null);
