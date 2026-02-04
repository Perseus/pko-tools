import { atom } from "jotai";
import { EffectFile } from "@/types/effect";

export type EffectPlaybackState = {
  isPlaying: boolean;
  isLooping: boolean;
  speed: number;
  currentTime: number;
};

export type EffectTextureStatus = {
  status: "idle" | "loading" | "loaded" | "error";
  textureName: string | null;
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
export const effectTextureStatusAtom = atom<EffectTextureStatus>({
  status: "idle",
  textureName: null,
});
export const effectTextureReloadAtom = atom(0);
export const effectDirtyAtom = atom(false);
export const effectOriginalAtom = atom<EffectFile | null>(null);

/** Character skeleton binding state for effect preview. */
export type EffectBindingMode = "all" | "bones" | "dummies";

export type EffectBindingState = {
  /** Character ID loaded for binding. */
  characterId: number | null;
  /** glTF JSON data URI for rendering the character model. */
  gltfDataUri: string | null;
  /** Name of the bone/dummy the effect is bound to (null = unbound). */
  boundBoneName: string | null;
  /** Filter mode for the bone tree display. */
  mode: EffectBindingMode;
  /** Loading status. */
  status: "idle" | "loading" | "loaded" | "error";
};

export const effectBindingAtom = atom<EffectBindingState>({
  characterId: null,
  gltfDataUri: null,
  boundBoneName: null,
  mode: "all",
  status: "idle",
});

/**
 * The bound bone's world matrix (written by CharacterPreview, read by EffectMeshRenderer).
 * null when no bone is bound or character not loaded.
 * Stored as a flat 16-element Float32Array (column-major, matching THREE.Matrix4.elements).
 */
export const boundBoneMatrixAtom = atom<Float32Array | null>(null);

/** When true, render all sub-effects even when playback is stopped (composite preview). */
export const compositePreviewAtom = atom(false);
