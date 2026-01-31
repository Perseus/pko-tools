import { atom } from "jotai";
import { EffectFile } from "@/types/effect";

export type EffectPlaybackState = {
  isPlaying: boolean;
  isLooping: boolean;
  speed: number;
  currentTime: number;
};

export const selectedEffectAtom = atom<string | null>(null);
export const effectDataAtom = atom<EffectFile | null>(null);
export const selectedSubEffectIndexAtom = atom<number | null>(null);
export const selectedFrameIndexAtom = atom<number>(0);
export const effectPlaybackAtom = atom<EffectPlaybackState>({
  isPlaying: false,
  isLooping: true,
  speed: 1,
  currentTime: 0,
});
