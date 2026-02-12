import { BuildingEntry, BuildingImportResult } from "@/types/buildings";
import { invoke } from "@tauri-apps/api/core";

export const getBuildingList = async (
  projectId: string
): Promise<BuildingEntry[]> => {
  return invoke("get_building_list", { projectId });
};

export const loadBuildingModel = async (
  projectId: string,
  buildingId: number
): Promise<string> => {
  return invoke("load_building_model", { projectId, buildingId });
};

export const exportBuildingToGltf = async (
  projectId: string,
  buildingId: number,
  outputDir: string
): Promise<string> => {
  return invoke("export_building_to_gltf", { projectId, buildingId, outputDir });
};

export const exportBuildingForEditing = async (
  projectId: string,
  buildingId: number
): Promise<string> => {
  return invoke("export_building_for_editing", { projectId, buildingId });
};

export const importBuildingFromGltf = async (
  projectId: string,
  buildingId: string,
  filePath: string,
  scaleFactor: number
): Promise<BuildingImportResult> => {
  return invoke("import_building_from_gltf", {
    projectId,
    buildingId,
    filePath,
    scaleFactor,
  });
};
