import { BuildingEntry } from "@/types/buildings";
import { atom } from "jotai";

export const buildingListAtom = atom<BuildingEntry[]>([]);
export const selectedBuildingAtom = atom<BuildingEntry | null>(null);
export const buildingGltfJsonAtom = atom<string | null>(null);
export const buildingLoadingAtom = atom<boolean>(false);
