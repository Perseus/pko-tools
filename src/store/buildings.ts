import { BuildingEntry, BuildingMetadata } from "@/types/buildings";
import { atom } from "jotai";

export const buildingListAtom = atom<BuildingEntry[]>([]);
export const selectedBuildingAtom = atom<BuildingEntry | null>(null);
export const buildingGltfJsonAtom = atom<string | null>(null);
export const buildingLoadingAtom = atom<boolean>(false);
export const buildingMetadataAtom = atom<BuildingMetadata | null>(null);

export type BuildingViewConfig = {
  showMeshOutlines: boolean;
  showMetadata: boolean;
  playAnimation: boolean;
};

export const buildingViewConfigAtom = atom<BuildingViewConfig>({
  showMeshOutlines: false,
  showMetadata: true,
  playAnimation: true,
});
