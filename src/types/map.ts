export type MapEntry = {
  name: string;
  display_name: string;
  map_file: string;
  has_obj: boolean;
  has_rbo: boolean;
  width: number;
  height: number;
};

export type MapMetadata = {
  name: string;
  width: number;
  height: number;
  section_width: number;
  section_height: number;
  total_sections: number;
  non_empty_sections: number;
  total_tiles: number;
  object_count: number;
};

export type MapExportResult = {
  gltf_path: string;
  bin_path: string;
  map_name: string;
};

export type MapPlacementRecord = {
  index: number;
  obj_type: number;
  obj_id: number;
  kind: string;
  world_x: number;
  world_y: number;
  world_z: number;
  yaw_angle: number;
  scale: number;
  display_name: string | null;
  asset_name: string | null;
  attach_effect_id: number | null;
  distance: number | null;
};

export type MapPlacementSummary = {
  total: number;
  building_count: number;
  effect_count: number;
};

export type MapPlacementPage = {
  total: number;
  offset: number;
  limit: number;
  items: MapPlacementRecord[];
};

export type BuildingExportEntry = {
  obj_id: number;
  filename: string;
  gltf_path: string;
};

export type MapViewConfig = {
  showObjectMarkers: boolean;
  showWireframe: boolean;
  showGrid: boolean;
};
