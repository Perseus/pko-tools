import { Character, CharacterMetadata } from "@/types/character";
import { atom } from "jotai";

type CharacterLoadingStatus = {
  action: string,
  subAction: string,
  subActionCurrentStep: number,
  subActionTotalSteps: number,
}

export const selectedCharacterAtom = atom<Character| null>(null);
export const characterGltfJsonAtom = atom<string| null>(null);
export const characterLoadingStatusAtom = atom<CharacterLoadingStatus| null>(null);
export const characterMetadataAtom = atom<CharacterMetadata| null>(null);

/** Whether dummy editing mode is active in the character workbench. */
export const dummyEditModeAtom = atom(false);

/** Tracked dummy transform edits for dirty detection and export. */
export type DummyTransformEdit = {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
};
export const dummyEditsAtom = atom<Map<string, DummyTransformEdit>>(new Map());