import { invokeTimed as invoke } from "@/commands/invokeTimed";
import { Character, CharacterAction, CharacterMetadata } from "@/types/character";

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

export const getCharacterActions = async (
  projectId: string,
  charTypeId: number
): Promise<CharacterAction[]> => {
  return invoke("get_character_actions", { projectId, charTypeId });
};
