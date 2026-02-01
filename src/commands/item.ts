import { Item, ItemLitInfo, ItemMetadata, RefineEffectTable, ForgeEffectPreview } from "@/types/item";
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

export const getForgeEffectPreview = async (
  projectId: string,
  itemType: number,
  refineLevel: number,
  charType: number,
  effectCategory: number
): Promise<ForgeEffectPreview> => {
  return invoke("get_forge_effect_preview", {
    projectId,
    itemType,
    refineLevel,
    charType,
    effectCategory,
  });
};
