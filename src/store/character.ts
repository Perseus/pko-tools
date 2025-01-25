import { Character } from "@/types/character";
import { atom } from "jotai";

export const selectedCharacterAtom = atom<Character| null>(null);
export const characterGltfJsonAtom = atom<string| null>(null);