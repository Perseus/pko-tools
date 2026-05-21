export type MapEntry = {
  name: string;
  display_name: string;
  map_file: string;
  has_obj: boolean;
  has_rbo: boolean;
  width: number;
  height: number;
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

export type MapSelectedTile = {
  x: number;
  y: number;
};

export type SceneEffectEntry = {
  id: number;
  filename: string;
  display_name: string;
  effect_type: number;
  object_type: number;
  play_time: number;
  base_size: number;
};

export type TerrainTextureEntry = {
  id: number;
  path: string;
  file_name: string;
  preview_data_uri?: string | null;
};

export type MapWorkbenchLayer =
  | "terrain_color"
  | "texture_base"
  | "texture_raw"
  | "texture_layers"
  | "height"
  | "collision"
  | "object_height"
  | "region"
  | "island"
  | "placements";

export type MapSourceFileInfo = {
  map_modified_ms: number;
  map_file_len: number;
  content_sha256: string;
};

export type MapTerrainTextureStatus = {
  available: boolean;
  message: string | null;
  referenced_count: number;
  loaded_count: number;
  missing_count: number;
  alpha_atlas_available: boolean;
};

export type MapRboBounds = {
  min_x: number;
  min_y: number;
  min_z: number;
  max_x: number;
  max_y: number;
  max_z: number;
};

export type MapRboRecordSample = {
  type_id: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  terrain_height: number;
};

export type MapRboRecord = {
  index: number;
  line_number: number;
  type_id: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  qx: number;
  qy: number;
  qz: number;
  terrain_height: number;
};

export type MapRboRecordPage = {
  total: number;
  offset: number;
  limit: number;
  warning_count: number;
  first_warning: string | null;
  items: MapRboRecord[];
};

export type MapRboSummary = {
  present: boolean;
  byte_len: number;
  record_count: number;
  distinct_type_ids: number[];
  sample_records?: MapRboRecordSample[];
  bounds: MapRboBounds | null;
  warning_count: number;
  first_warning: string | null;
};

export type MapWorkbenchManifest = {
  name: string;
  width: number;
  height: number;
  section_width: number;
  section_height: number;
  section_count_x: number;
  section_count_y: number;
  total_sections: number;
  non_empty_sections: number;
  chunk_size: number;
  chunk_count_x: number;
  chunk_count_y: number;
  available_layers: MapWorkbenchLayer[];
  terrain_texture_status: MapTerrainTextureStatus;
  placement_count: number;
  coordinate_system: string;
  source: MapSourceFileInfo;
  placement_source: MapSourceFileInfo;
  rbo_source: MapSourceFileInfo;
  rbo_summary: MapRboSummary;
  recommended_overview_max_size: number;
};

export type MapChunkRequest = {
  chunk_x: number;
  chunk_y: number;
  chunk_size?: number;
  layer: MapWorkbenchLayer;
  zoom_bucket: number;
  include_numeric_payload: boolean;
  source_guard?: MapSourceFileInfo | null;
};

export type MapChunkPayload = {
  chunk_x: number;
  chunk_y: number;
  layer: MapWorkbenchLayer;
  tile_x: number;
  tile_y: number;
  tile_width: number;
  tile_height: number;
  sample_width: number;
  sample_height: number;
  image_data_uri: string;
  numeric_format: string | null;
  numeric_payload: string | null;
};

export type MapOverviewLayer = {
  layer: MapWorkbenchLayer;
  map_width: number;
  map_height: number;
  sample_width: number;
  sample_height: number;
  image_data_uri: string;
};

export type MapTileTexturePreview = {
  tile_x: number;
  tile_y: number;
  sample_width: number;
  sample_height: number;
  raw_image_data_uri: string;
  client_image_data_uri: string;
};

export type MapNativeTileFields = {
  dw_tile_info: number;
  bt_tile_info: number;
  s_color: number;
  c_height: number;
  s_region: number;
  bt_island: number;
  bt_block: number[];
};

export type MapTilePatch = {
  tile_x: number;
  tile_y: number;
  dw_tile_info?: number | null;
  bt_tile_info?: number | null;
  s_color?: number | null;
  c_height?: number | null;
  s_region?: number | null;
  bt_island?: number | null;
  bt_block?: [number, number, number, number] | null;
};

export type MapTileEditExportResult = {
  map_name: string;
  map_path: string;
  atr_path: string;
  blk_path: string;
  patch_count: number;
  bytes_written: number;
  atr_bytes_written: number;
  blk_bytes_written: number;
  atr_sha256: string;
  blk_sha256: string;
};

export type MapPlacementPatch = {
  index: number;
  obj_type?: number | null;
  obj_id?: number | null;
  world_x?: number | null;
  world_y?: number | null;
  world_z?: number | null;
  yaw_angle?: number | null;
  scale?: number | null;
};

export type MapPlacementUpdateEdit = MapPlacementPatch & {
  op: "update";
};

export type MapPlacementAddEdit = {
  op: "add";
  obj_type: number;
  obj_id: number;
  world_x: number;
  world_y: number;
  world_z: number;
  yaw_angle: number;
  scale: number;
};

export type MapPlacementDeleteEdit = {
  op: "delete";
  index: number;
};

export type MapPlacementEdit =
  | MapPlacementUpdateEdit
  | MapPlacementAddEdit
  | MapPlacementDeleteEdit;

export type MapPlacementEditExportResult = {
  map_name: string;
  obj_path: string;
  patch_count: number;
  bytes_written: number;
};

export type MapEditExportResult = {
  map_name: string;
  map_path: string;
  obj_path: string;
  rbo_path: string | null;
  atr_path: string;
  blk_path: string;
  tile_patch_count: number;
  placement_edit_count: number;
  map_bytes_written: number;
  obj_bytes_written: number;
  rbo_bytes_written: number;
  rbo_preserved_from_source?: boolean;
  rbo_may_be_stale?: boolean;
  atr_bytes_written: number;
  blk_bytes_written: number;
  map_sha256: string;
  obj_sha256: string;
  rbo_sha256: string | null;
  atr_sha256: string;
  blk_sha256: string;
};

export type MapEditClientPackage = {
  map_path: string;
  obj_path: string;
  rbo_path: string | null;
  map_bytes: number;
  obj_bytes: number;
  rbo_bytes: number;
  map_sha256: string;
  obj_sha256: string;
  rbo_sha256: string | null;
};

export type MapEditClientFileBackup = {
  label: string;
  source_path: string;
  backup_path: string;
  bytes: number;
};

export type MapEditClientApplyResult = {
  map_name: string;
  backup_dir: string;
  map_path: string;
  obj_path: string;
  rbo_path: string | null;
  map_bytes_written: number;
  obj_bytes_written: number;
  rbo_bytes_written: number;
  backups: MapEditClientFileBackup[];
};

export type MapEditClientRestoreResult = {
  map_name: string;
  backup_dir: string;
  restore_backup_dir: string;
  map_path: string;
  obj_path: string | null;
  rbo_path: string | null;
  map_bytes_restored: number;
  obj_bytes_restored: number;
  rbo_bytes_restored: number;
  current_backups: MapEditClientFileBackup[];
  removed_paths: string[];
};

export type MapEditSourceGuard = {
  map_source: MapSourceFileInfo;
  obj_source: MapSourceFileInfo;
  rbo_source: MapSourceFileInfo;
};

export type MapTextureLayerInfo = {
  slot: number;
  texture_id: number;
  alpha: number;
};

export type MapSubtileInspection = {
  index: number;
  blocked: boolean;
  raw: number;
  object_height: number;
};

export type MapTileAreaInfo = {
  area_id: number;
  name: string;
  color: [number, number, number, number];
  music: number;
  env_color: [number, number, number];
  light_color: [number, number, number];
  light_dir: [number, number, number];
  zone_type: number;
  zone_label: string;
};

export type MapTileInspection = {
  tile_x: number;
  tile_y: number;
  is_empty_section?: boolean;
  section_x: number;
  section_y: number;
  local_x: number;
  local_y: number;
  native: MapNativeTileFields;
  texture_layers: MapTextureLayerInfo[];
  color_rgb: [number, number, number];
  terrain_height: number;
  region_flags: string[];
  island: number;
  area?: MapTileAreaInfo | null;
  subtiles: MapSubtileInspection[];
  nearby_placements: MapPlacementRecord[];
};
