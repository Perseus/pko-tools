export type Character = {
  id: number;
  name: string;
  model_type: string;
  model: number;
  suit_id: number;
}

export type CharacterAction = {
  action_id: number;
  name: string;
  start_frame: number;
  end_frame: number;
  key_frames: number[];
  weapon_mode: string | null;
}

export type CharacterMetadata = {
  character_id: number;
  character_name: string;
  model_id: number;
  animation_id: number;
  bone_count: number;
  frame_count: number;
  dummy_count: number;
  vertex_count: number;
  triangle_count: number;
  material_count: number;
  /** LGO file IDs for each model part (e.g., ["0725000000", "0725000001"]) */
  model_parts: string[];
  bounding_spheres: number;
  bounding_boxes: number;
}