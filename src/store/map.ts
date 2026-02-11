import { MapEntry, MapMetadata, MapViewConfig } from "@/types/map";
import { atom } from "jotai";

export const selectedMapAtom = atom<MapEntry | null>(null);
export const mapGltfJsonAtom = atom<string | null>(null);
export const mapMetadataAtom = atom<MapMetadata | null>(null);
export const mapLoadingAtom = atom<boolean>(false);

export const mapViewConfigAtom = atom<MapViewConfig>({
  showObjectMarkers: true,
  showWireframe: false,
  showGrid: false,
});
