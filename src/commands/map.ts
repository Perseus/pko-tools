import { MapEntry, MapExportResult, MapForUnityExportResult, MapMetadata } from "@/types/map";
import { invoke } from "@tauri-apps/api/core";

export const getMapList = async (
  projectId: string
): Promise<MapEntry[]> => {
  return invoke("get_map_list", { projectId });
};

export const loadMapTerrain = async (
  projectId: string,
  mapName: string
): Promise<string> => {
  return invoke("load_map_terrain", { projectId, mapName });
};

export const getMapMetadata = async (
  projectId: string,
  mapName: string
): Promise<MapMetadata> => {
  return invoke("get_map_metadata", { projectId, mapName });
};

export const exportMapToGltf = async (
  projectId: string,
  mapName: string
): Promise<MapExportResult> => {
  return invoke("export_map_to_gltf", { projectId, mapName });
};

export const exportMapForUnity = async (
  projectId: string,
  mapName: string,
  format?: string
): Promise<MapForUnityExportResult> => {
  return invoke("export_map_for_unity", { projectId, mapName, format });
};
