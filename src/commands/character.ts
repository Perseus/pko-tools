import { Character } from "@/types/character";
import { invoke } from "@tauri-apps/api/core";

export const getCharacterList = async (
  projectId: string
): Promise<Character[]> => {
  return invoke("get_character_list", { projectId });
};