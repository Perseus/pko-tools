import { Item, ItemImportResult, ItemLitInfo, ItemMetadata, RefineEffectTable, ForgeEffectPreview, ItemCategoryAvailability, DecompileResult, WorkbenchState, WorkbenchSummary, WorkbenchDummy, ItemInfoPreview } from "@/types/item";
import { invoke } from "@tauri-apps/api/core";

export const getItemList = async (
  projectId: string
): Promise<Item[]> => {
  return invoke("get_item_list", { projectId });
};

export const loadItemModel = async (
  projectId: string,
  modelId: string
): Promise<string> => {
  return invoke("load_item_model", { projectId, modelId });
};

export const getItemLitInfo = async (
  projectId: string,
  itemId: number
): Promise<ItemLitInfo | null> => {
  return invoke("get_item_lit_info", { projectId, itemId });
};

export const loadLitTextureBytes = async (
  projectId: string,
  textureName: string
): Promise<string> => {
  return invoke("load_lit_texture_bytes", { projectId, textureName });
};

export const getRefineEffects = async (
  projectId: string
): Promise<RefineEffectTable> => {
  return invoke("get_refine_effects", { projectId });
};

export const getItemMetadata = async (
  projectId: string,
  itemId: number,
  modelId: string
): Promise<ItemMetadata> => {
  return invoke("get_item_metadata", { projectId, itemId, modelId });
};

export const getItemCategoryAvailability = async (
  projectId: string,
  itemId: number
): Promise<ItemCategoryAvailability> => {
  return invoke("get_item_category_availability", { projectId, itemId });
};

export const getForgeEffectPreview = async (
  projectId: string,
  itemId: number,
  refineLevel: number,
  charType: number,
  effectCategory: number
): Promise<ForgeEffectPreview> => {
  return invoke("get_forge_effect_preview", {
    projectId,
    itemId,
    refineLevel,
    charType,
    effectCategory,
  });
};

export const importItemFromGltf = async (
  modelId: string,
  filePath: string,
  scaleFactor?: number
): Promise<ItemImportResult> => {
  return invoke("import_item_from_gltf", { modelId, filePath, scaleFactor });
};

export const decompileItemRefineInfo = async (
  projectId: string
): Promise<DecompileResult> => {
  return invoke("decompile_item_refine_info", { projectId });
};

export const decompileItemRefineEffectInfo = async (
  projectId: string
): Promise<DecompileResult> => {
  return invoke("decompile_item_refine_effect_info", { projectId });
};

export const decompileSceneEffectInfo = async (
  projectId: string
): Promise<DecompileResult> => {
  return invoke("decompile_scene_effect_info", { projectId });
};

export const decompileStoneInfo = async (
  projectId: string
): Promise<DecompileResult> => {
  return invoke("decompile_stone_info", { projectId });
};

// ============================================================================
// Workbench Commands
// ============================================================================

export const addGlowOverlay = async (
  lgoPath: string
): Promise<string> => {
  return invoke("add_glow_overlay", { lgoPath });
};

export type ExportResult = {
  lgoPath: string;
  texturePaths: string[];
  targetModelId: string;
};

export const exportItem = async (
  projectId: string,
  lgoPath: string,
  targetModelId: string
): Promise<ExportResult> => {
  return invoke("export_item", { projectId, lgoPath, targetModelId });
};

export const rotateItem = async (
  lgoPath: string,
  xDeg: number,
  yDeg: number,
  zDeg: number
): Promise<string> => {
  return invoke("rotate_item", { lgoPath, xDeg, yDeg, zDeg });
};

export const rescaleItem = async (
  projectId: string,
  modelId: string,
  lgoPath: string,
  factor: number
): Promise<string> => {
  return invoke("rescale_item", { projectId, modelId, lgoPath, factor });
};

export const createWorkbench = async (
  projectId: string,
  modelId: string,
  itemName: string,
  itemType: number,
  sourceFile: string | null,
  scaleFactor: number,
  lgoPath: string
): Promise<void> => {
  return invoke("create_workbench", {
    projectId,
    modelId,
    itemName,
    itemType,
    sourceFile,
    scaleFactor,
    lgoPath,
  });
};

export const loadWorkbench = async (
  projectId: string,
  modelId: string
): Promise<WorkbenchState> => {
  return invoke("load_workbench", { projectId, modelId });
};

export const saveWorkbench = async (
  projectId: string,
  state: WorkbenchState
): Promise<void> => {
  return invoke("save_workbench", { projectId, state });
};

export const listWorkbenches = async (
  projectId: string
): Promise<WorkbenchSummary[]> => {
  return invoke("list_workbenches", { projectId });
};

export const deleteWorkbench = async (
  projectId: string,
  modelId: string
): Promise<void> => {
  return invoke("delete_workbench", { projectId, modelId });
};

export const updateDummies = async (
  projectId: string,
  modelId: string,
  lgoPath: string,
  dummies: WorkbenchDummy[]
): Promise<string> => {
  return invoke("update_dummies", { projectId, modelId, lgoPath, dummies });
};

export const generateItemInfoEntry = async (
  projectId: string,
  modelId: string,
  requestedId?: number | null
): Promise<ItemInfoPreview> => {
  return invoke("generate_item_info_entry", {
    projectId,
    modelId,
    requestedId: requestedId ?? null,
  });
};

export const registerItem = async (
  projectId: string,
  modelId: string,
  tsvLine: string,
  assignedId: number
): Promise<void> => {
  return invoke("register_item", { projectId, modelId, tsvLine, assignedId });
};
