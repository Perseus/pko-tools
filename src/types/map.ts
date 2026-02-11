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

export type BuildingExportEntry = {
  obj_id: number;
  filename: string;
  gltf_path: string;
};

export type MapForUnityExportResult = {
  output_dir: string;
  terrain_gltf_path: string;
  building_gltf_paths: BuildingExportEntry[];
  manifest_path: string;
  total_buildings_exported: number;
  total_placements: number;
};

export type MapViewConfig = {
  showObjectMarkers: boolean;
  showWireframe: boolean;
  showGrid: boolean;
};
