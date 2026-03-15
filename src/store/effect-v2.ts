import { atom } from "jotai";
import { MagicSingleEntry, MagicSingleTable } from "@/types/effect-v2";

/** Whether the v2 backend is reachable (set after ping). */
export const effectV2ReadyAtom = atom(false);

/** The loaded MagicSingleinfo table. */
export const magicSingleTableAtom = atom<MagicSingleTable | null>(null);

/** The currently selected magic effect entry. */
export const selectedMagicEffectAtom = atom<MagicSingleEntry | null>(null);

/** Shared playback state for the effects scene. */
export interface EffectV2Playback {
  playing: boolean;
  loop: boolean;
  time: number;
  /** Target framerate. 0 = uncapped (use real delta). */
  fps: number;
}

export const effectV2PlaybackAtom = atom<EffectV2Playback>({
  playing: false,
  loop: true,
  time: 0,
  fps: 0,
});
