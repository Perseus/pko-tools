import { invokeTimed as invoke } from "@/commands/invokeTimed";
import {
  ForgeGlowDraft,
  ForgeGlowDraftSummary,
  ForgeGlowExportResult,
  ForgeGlowGemOption,
  ForgeRecipeInputs,
  ResolvedForgeRecipe,
} from "@/types/forge-glow";

export const resolveForgeGlowRecipe = async (
  projectId: string,
  inputs: ForgeRecipeInputs,
): Promise<ResolvedForgeRecipe> => {
  return invoke("resolve_forge_glow_recipe", { projectId, inputs });
};

export const listForgeGlowGems = async (
  projectId: string,
): Promise<ForgeGlowGemOption[]> => {
  return invoke("list_forge_glow_gems", { projectId });
};

export const createForgeGlowDraft = async (
  projectId: string,
  name: string,
  inputs: ForgeRecipeInputs,
): Promise<ForgeGlowDraft> => {
  return invoke("create_forge_glow_draft", { projectId, name, inputs });
};

export const listForgeGlowDrafts = async (
  projectId: string,
): Promise<ForgeGlowDraftSummary[]> => {
  return invoke("list_forge_glow_drafts", { projectId });
};

export const loadForgeGlowDraft = async (
  projectId: string,
  draftId: string,
): Promise<ForgeGlowDraft> => {
  return invoke("load_forge_glow_draft", { projectId, draftId });
};

export const saveForgeGlowDraft = async (
  projectId: string,
  draft: ForgeGlowDraft,
): Promise<ForgeGlowDraft> => {
  return invoke("save_forge_glow_draft", { projectId, draft });
};

export const deleteForgeGlowDraft = async (
  projectId: string,
  draftId: string,
): Promise<void> => {
  return invoke("delete_forge_glow_draft", { projectId, draftId });
};

export const exportForgeGlowPackage = async (
  projectId: string,
  draftId: string,
  variantIds: string[],
): Promise<ForgeGlowExportResult> => {
  return invoke("export_forge_glow_package", { projectId, draftId, variantIds });
};
