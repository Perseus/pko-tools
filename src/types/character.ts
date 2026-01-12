export type Character = {
  id: number;
  name: string;
  model_type: string;
  model: number;
  suit_id: number;
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
  model_parts: number[];
  bounding_spheres: number;
  bounding_boxes: number;
}