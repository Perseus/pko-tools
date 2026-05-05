import { invokeTimed as invoke } from "@/commands/invokeTimed";
import {
  MapEntry,
  MapExportResult,
  MapMetadata,
  MapPlacementPage,
  MapPlacementSummary,
} from "@/types/map";

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

export const getMapPlacementSummary = async (
  projectId: string,
  mapName: string,
): Promise<MapPlacementSummary> => {
  return invoke("get_map_placement_summary", { projectId, mapName });
};

export const queryMapPlacements = async (
  projectId: string,
  mapName: string,
  query?: string,
  placementType?: "all" | "building" | "effect",
  nearX?: number,
  nearY?: number,
  nearRadius?: number,
  offset?: number,
  limit?: number,
): Promise<MapPlacementPage> => {
  return invoke("query_map_placements", {
    projectId,
    mapName,
    query,
    placementType,
    nearX,
    nearY,
    nearRadius,
    offset,
    limit,
  });
};
