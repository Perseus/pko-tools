import { Character } from "@/types/character";
import { atom } from "jotai";

export const selectedCharacterAtom = atom<Character| null>(null);