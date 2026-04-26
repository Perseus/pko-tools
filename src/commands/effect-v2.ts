import { invokeTimed as invoke } from "@/commands/invokeTimed";
import { MagicGroupTable, MagicSingleTable } from "@/types/effect-v2";

export const effectV2Ping = async (): Promise<string> => {
  return invoke("effect_v2_ping");
};

export const loadMagicSingleTable = async (
  projectId: string
): Promise<MagicSingleTable> => {
  return invoke("load_magic_single_table", { projectId });
};

export const loadMagicGroupTable = async (
  projectId: string
): Promise<MagicGroupTable> => {
  return invoke("load_magic_group_table", { projectId });
};
