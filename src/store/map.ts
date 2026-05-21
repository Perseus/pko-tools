import { MapEntry } from "@/types/map";
import { atom } from "jotai";

export const selectedMapAtom = atom<MapEntry | null>(null);

export type MapStagedEditState = {
  mapName: string;
  count: number;
  summary: string;
};

export const mapStagedEditStateAtom = atom<MapStagedEditState | null>(null);
