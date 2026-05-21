import { atom } from "jotai";
import { MagicSingleEntry, MagicSingleTable, EffectV2Selection } from "@/types/effect-v2";

/** Whether the v2 backend is reachable (set after ping). */
export const effectV2ReadyAtom = atom(false);

/** The loaded MagicSingleinfo table. */
export const magicSingleTableAtom = atom<MagicSingleTable | null>(null);

/** The currently selected magic effect entry (legacy — prefer effectV2SelectionAtom). */
export const selectedMagicEffectAtom = atom<MagicSingleEntry | null>(null);

/** Unified selection: what is currently selected in the effect viewer. */
export const effectV2SelectionAtom = atom<EffectV2Selection | null>(null);

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

/** Set of sub-effect indices currently hidden in the effect viewer. */
export const effectV2HiddenSubEffectsAtom = atom<Set<number>>(new Set<number>());

/** Set of particle system indices currently hidden in the particle viewer. */
export const effectV2HiddenParticleSystemsAtom = atom<Set<number>>(new Set<number>());

/**
 * Per-system sub-effect visibility for particle systems that embed .eff files.
 * Key = particle system index, value = set of hidden sub-effect indices within that system's .eff.
 */
export const effectV2HiddenParticleSubEffectsAtom = atom<Map<number, Set<number>>>(new Map());
