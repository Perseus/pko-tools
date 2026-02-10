import { invoke } from "@tauri-apps/api/core";
import type {
  MeshAnalysisReport,
  ValidationReport,
  ScaleAnalysis,
  AnalyzedModelReport,
  BoneMapping,
  ManualMappingOverride,
  MappingValidation,
} from "@/types/import";

export const analyzeMesh = async (
  filePath: string
): Promise<MeshAnalysisReport> => {
  return invoke("analyze_mesh", { filePath });
};

export const analyzeMeshScale = async (
  filePath: string
): Promise<ScaleAnalysis> => {
  return invoke("analyze_mesh_scale", { filePath });
};

export const validateModelForImport = async (
  filePath: string,
  importType: "character" | "item"
): Promise<ValidationReport> => {
  return invoke("validate_model_for_import", { filePath, importType });
};

export const checkModelIdAvailable = async (
  projectId: string,
  modelId: number
): Promise<boolean> => {
  return invoke("check_model_id_available", { projectId, modelId });
};

export const getNextAvailableModelId = async (
  projectId: string
): Promise<number> => {
  return invoke("get_next_available_model_id", { projectId });
};

export const registerImportedCharacter = async (
  projectId: string,
  modelId: number,
  name: string
): Promise<{ character_id: number }> => {
  return invoke("register_imported_character", { projectId, modelId, name });
};

// Retarget commands

export const analyzeExternalModel = async (
  filePath: string
): Promise<AnalyzedModelReport> => {
  return invoke("analyze_external_model", { filePath });
};

export const autoMapBones = async (
  filePath: string
): Promise<BoneMapping> => {
  return invoke("auto_map_bones_cmd", { filePath });
};

export const applyBoneMapping = async (
  filePath: string,
  overrides: ManualMappingOverride[]
): Promise<BoneMapping> => {
  return invoke("apply_bone_mapping", { filePath, overrides });
};

export const validateBoneMapping = async (
  filePath: string,
  overrides: ManualMappingOverride[]
): Promise<MappingValidation> => {
  return invoke("validate_bone_mapping", { filePath, overrides });
};

export const loadModelPreview = async (
  lgoPath: string,
  hasOverlay?: boolean
): Promise<string> => {
  return invoke("load_model_preview", { lgoPath, hasOverlay: hasOverlay ?? false });
};

export const previewTextureConversion = async (
  filePath: string
): Promise<{
  original_width: number;
  original_height: number;
  final_width: number;
  final_height: number;
  alpha_stripped: boolean;
  was_resized: boolean;
}> => {
  return invoke("preview_texture_conversion", { filePath });
};
