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