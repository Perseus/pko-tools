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

export const stripEffectDataAtom = atom<StripEffectData | null>(null);
