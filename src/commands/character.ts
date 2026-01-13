import { Character, CharacterMetadata } from "@/types/character";
import { invoke } from "@tauri-apps/api/core";

export const getCharacterList = async (
  projectId: string
): Promise<Character[]> => {
  return invoke("get_character_list", { projectId });
};

export const getCharacterMetadata = async (
  projectId: string,
  characterId: number
): Promise<CharacterMetadata> => {
  return invoke("get_character_metadata_cmd", { projectId, characterId });
};