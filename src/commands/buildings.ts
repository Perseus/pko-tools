import {
  BuildingEntry,
  BuildingImportResult,
  BuildingWorkbenchState,
} from "@/types/buildings";
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

export const rescaleBuilding = async (
  projectId: string,
  lmoPath: string,
  factor: number
): Promise<string> => {
  return invoke("rescale_building", { projectId, lmoPath: lmoPath, factor });
};

export const rotateBuilding = async (
  projectId: string,
  lmoPath: string,
  xDeg: number,
  yDeg: number,
  zDeg: number
): Promise<string> => {
  return invoke("rotate_building", { projectId, lmoPath: lmoPath, xDeg, yDeg, zDeg });
};

export const exportBuildingToGame = async (
  lmoPath: string,
  importDir: string,
  exportDir: string,
  buildingId: string
): Promise<string> => {
  return invoke("export_building_to_game", { lmoPath, importDir, exportDir, buildingId });
};

export const saveBuildingWorkbench = async (
  projectId: string,
  state: BuildingWorkbenchState
): Promise<void> => {
  return invoke("save_building_workbench", { projectId, state });
};

export const loadBuildingWorkbench = async (
  projectId: string,
  buildingId: string
): Promise<BuildingWorkbenchState | null> => {
  return invoke("load_building_workbench", { projectId, buildingId });
};
