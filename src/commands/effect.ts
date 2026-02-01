import { invoke } from "@tauri-apps/api/core";
import { EffectFile, Vec3 } from "@/types/effect";

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

export const saveParticles = async (
  projectId: string,
  effectName: string,
  particles: unknown
): Promise<void> => {
  return invoke("save_particles", { projectId, effectName, particles });
};

export const loadParticles = async (
  projectId: string,
  effectName: string
): Promise<unknown | null> => {
  return invoke("load_particles", { projectId, effectName });
};

export const listTextureFiles = async (
  projectId: string
): Promise<string[]> => {
  return invoke("list_texture_files", { projectId });
};

export const loadPathFile = async (
  projectId: string,
  pathName: string
): Promise<Vec3[]> => {
  return invoke("load_path_file", { projectId, pathName });
};

export const loadEffectModel = async (
  projectId: string,
  modelName: string
): Promise<string> => {
  return invoke("load_effect_model", { projectId, modelName });
};
