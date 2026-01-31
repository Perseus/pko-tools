import { invoke } from "@tauri-apps/api/core";
import { EffectFile } from "@/types/effect";

export const listEffects = async (projectId: string): Promise<string[]> => {
  return invoke("list_effects", { projectId });
};

export const loadEffect = async (
  projectId: string,
  effectName: string
): Promise<EffectFile> => {
  return invoke("load_effect", { projectId, effectName });
};

export const saveEffect = async (
  projectId: string,
  effectName: string,
  effect: EffectFile
): Promise<void> => {
  return invoke("save_effect", { projectId, effectName, effect });
};
