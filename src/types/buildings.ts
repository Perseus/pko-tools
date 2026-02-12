export type BuildingEntry = {
  id: number;
  filename: string;
  display_name: string;
};

export type BuildingImportResult = {
  lmo_path: string;
  texture_paths: string[];
  import_dir: string;
  building_id: string;
};

export type BuildingWorkbenchState = {
  building_id: string;
  source_file: string;
  scale_factor: number;
  lmo_path: string;
  created_at: string;
};
