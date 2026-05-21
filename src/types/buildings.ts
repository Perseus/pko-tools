export type BuildingEntry = {
  id: number;
  filename: string;
  display_name: string;
};

export type MaterialInfo = {
  index: number;
  diffuse: [number, number, number, number];
  ambient: [number, number, number, number];
  emissive: [number, number, number, number];
  opacity: number;
  transp_type: number;
  transp_type_name: string;
  alpha_test_enabled: boolean;
  alpha_ref: number;
  src_blend: number | null;
  dest_blend: number | null;
  cull_mode: number | null;
  tex_filename: string | null;
};

export type GeomObjectInfo = {
  index: number;
  id: number;
  parent_id: number;
  vertex_count: number;
  triangle_count: number;
  subset_count: number;
  has_vertex_colors: boolean;
  has_animation: boolean;
  animation_frame_count: number | null;
  has_texuv_anim: boolean;
  has_teximg_anim: boolean;
  has_opacity_anim: boolean;
  materials: MaterialInfo[];
};

export type BuildingMetadata = {
  building_id: number;
  filename: string;
  version: number;
  geom_objects: GeomObjectInfo[];
};

export type BuildingSceneInfo = {
  building_id: number;
  filename: string;
  display_name: string;
  scene_obj_type: number;
  shade_flag: boolean;
  enable_point_light: boolean;
  enable_env_light: boolean;
  attach_effect_id: number;
  style: number;
  flag: number;
  size_flag: number;
  anim_ctrl_id: number;
  is_really_big: boolean;
  point_color: [number, number, number];
  env_color: [number, number, number];
  point_range: number;
  point_attenuation: number;
  fade_obj_num: number;
  fade_obj_seq: number[];
  fade_coefficient: number;
};
