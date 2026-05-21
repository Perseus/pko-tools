import { invokeTimed as invoke } from "@/commands/invokeTimed";
import {
  MapEntry,
  MapEditClientApplyResult,
  MapEditClientPackage,
  MapEditClientRestoreResult,
  MapEditExportResult,
  MapEditSourceGuard,
  MapChunkPayload,
  MapChunkRequest,
  MapOverviewLayer,
  MapPlacementEdit,
  MapPlacementEditExportResult,
  MapPlacementPage,
  MapPlacementPatch,
  MapPlacementSummary,
  MapRboRecordPage,
  MapSourceFileInfo,
  MapTileEditExportResult,
  MapTileInspection,
  MapTilePatch,
  MapTileTexturePreview,
  MapWorkbenchLayer,
  MapWorkbenchManifest,
  SceneEffectEntry,
  TerrainTextureEntry,
} from "@/types/map";

export const getMapList = async (
  projectId: string
): Promise<MapEntry[]> => {
  return invoke("get_map_list", { projectId });
};

export const getSceneEffectList = async (
  projectId: string
): Promise<SceneEffectEntry[]> => {
  return invoke("get_scene_effect_list", { projectId });
};

export const getTerrainTextureCatalog = async (
  projectId: string
): Promise<TerrainTextureEntry[]> => {
  return invoke("get_terrain_texture_catalog", { projectId });
};

export const getTerrainTexturePreview = async (
  projectId: string,
  textureId: number,
): Promise<string | null> => {
  return invoke("get_terrain_texture_preview", { projectId, textureId });
};

export const getMapPlacementSummary = async (
  projectId: string,
  mapName: string,
): Promise<MapPlacementSummary> => {
  return invoke("get_map_placement_summary", { projectId, mapName });
};

export const queryMapPlacements = async (
  projectId: string,
  mapName: string,
  query?: string,
  placementType?: "all" | "building" | "effect",
  nearX?: number,
  nearY?: number,
  nearRadius?: number,
  offset?: number,
  limit?: number,
  viewportMinX?: number,
  viewportMinY?: number,
  viewportMaxX?: number,
  viewportMaxY?: number,
): Promise<MapPlacementPage> => {
  return invoke("query_map_placements", {
    projectId,
    mapName,
    query,
    placementType,
    nearX,
    nearY,
    nearRadius,
    offset,
    limit,
    viewportMinX,
    viewportMinY,
    viewportMaxX,
    viewportMaxY,
  });
};

export const getMapWorkbenchManifest = async (
  projectId: string,
  mapName: string,
): Promise<MapWorkbenchManifest> => {
  return invoke("get_map_workbench_manifest", { projectId, mapName });
};

export const getMapOverview = async (
  projectId: string,
  mapName: string,
  layer: MapWorkbenchLayer,
  maxSize?: number,
): Promise<MapOverviewLayer> => {
  return invoke("get_map_overview", { projectId, mapName, layer, maxSize });
};

export const getMapChunk = async (
  projectId: string,
  mapName: string,
  request: MapChunkRequest,
): Promise<MapChunkPayload> => {
  return invoke("get_map_chunk", { projectId, mapName, request });
};

export const inspectMapTile = async (
  projectId: string,
  mapName: string,
  tileX: number,
  tileY: number,
  sourceGuard?: MapSourceFileInfo | null,
): Promise<MapTileInspection> => {
  return invoke("inspect_map_tile", {
    projectId,
    mapName,
    tileX,
    tileY,
    includePlacements: false,
    sourceGuard,
  });
};

export const getMapTileTexturePreview = async (
  projectId: string,
  mapName: string,
  tileX: number,
  tileY: number,
  sourceGuard?: MapSourceFileInfo | null,
): Promise<MapTileTexturePreview | null> => {
  return invoke("get_map_tile_texture_preview", {
    projectId,
    mapName,
    tileX,
    tileY,
    sourceGuard,
  });
};

export const queryMapPlacementsInBounds = async (
  projectId: string,
  mapName: string,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  limit?: number,
): Promise<MapPlacementPage> => {
  return invoke("query_map_placements_in_bounds", {
    projectId,
    mapName,
    minX,
    minY,
    maxX,
    maxY,
    limit,
  });
};

export const queryMapRboRecordsInBounds = async (
  projectId: string,
  mapName: string,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  limit?: number,
): Promise<MapRboRecordPage> => {
  return invoke("query_map_rbo_records_in_bounds", {
    projectId,
    mapName,
    minX,
    minY,
    maxX,
    maxY,
    limit,
  });
};

export const exportMapTileEdits = async (
  projectId: string,
  mapName: string,
  patches: MapTilePatch[],
  sourceGuard: MapEditSourceGuard["map_source"],
): Promise<MapTileEditExportResult> => {
  return invoke("export_map_tile_edits", { projectId, mapName, patches, sourceGuard });
};

export const exportMapPlacementEdits = async (
  projectId: string,
  mapName: string,
  patches: MapPlacementEdit[],
  sourceGuard: MapEditSourceGuard["obj_source"],
): Promise<MapPlacementEditExportResult> => {
  return invoke("export_map_placement_edits", {
    projectId,
    mapName,
    patches: patches.map(normalizePlacementEdit),
    sourceGuard,
  });
};

export const exportMapEdits = async (
  projectId: string,
  mapName: string,
  tilePatches: MapTilePatch[],
  placementEdits: MapPlacementEdit[],
  sourceGuard: MapEditSourceGuard,
): Promise<MapEditExportResult> => {
  return invoke("export_map_edits", {
    projectId,
    mapName,
    tilePatches,
    placementEdits: placementEdits.map(normalizePlacementEdit),
    sourceGuard,
  });
};

export const applyMapEditClientPackage = async (
  projectId: string,
  mapName: string,
  clientPackage: MapEditClientPackage,
  sourceGuard: MapEditSourceGuard,
): Promise<MapEditClientApplyResult> => {
  return invoke("apply_map_edit_client_package", {
    projectId,
    mapName,
    package: clientPackage,
    sourceGuard,
  });
};

export const restoreMapEditClientBackup = async (
  projectId: string,
  mapName: string,
  backupDir: string,
): Promise<MapEditClientRestoreResult> => {
  return invoke("restore_map_edit_client_backup", {
    projectId,
    mapName,
    backupDir,
  });
};

function normalizePlacementEdit(patch: MapPlacementEdit): MapPlacementEdit {
  switch (patch.op) {
    case "update":
      return normalizePlacementUpdate(patch);
    case "add":
      return {
        op: "add",
        obj_type: normalizeU8("obj_type", patch.obj_type, 1),
        obj_id: normalizeU16("obj_id", patch.obj_id, 0x3fff, 1),
        world_x: normalizeFinite("world_x", patch.world_x),
        world_y: normalizeFinite("world_y", patch.world_y),
        world_z: normalizeFinite("world_z", patch.world_z),
        yaw_angle: normalizeI16("yaw_angle", patch.yaw_angle),
        scale: normalizeI16("scale", patch.scale),
      };
    case "delete":
      return {
        op: "delete",
        index: normalizeU32("index", patch.index),
      };
  }
}

function normalizePlacementUpdate(patch: MapPlacementPatch & { op: "update" }): MapPlacementEdit {
  const normalized: MapPlacementEdit = {
    op: "update",
    index: normalizeU32("index", patch.index),
  };

  if (patch.world_x != null) {
    normalized.world_x = normalizeFinite("world_x", patch.world_x);
  }
  if (patch.obj_type != null) {
    normalized.obj_type = normalizeU8("obj_type", patch.obj_type, 1);
  }
  if (patch.obj_id != null) {
    normalized.obj_id = normalizeU16("obj_id", patch.obj_id, 0x3fff, 1);
  }
  if (patch.world_y != null) {
    normalized.world_y = normalizeFinite("world_y", patch.world_y);
  }
  if (patch.world_z != null) {
    normalized.world_z = normalizeFinite("world_z", patch.world_z);
  }
  if (patch.yaw_angle != null) {
    normalized.yaw_angle = normalizeI16("yaw_angle", patch.yaw_angle);
  }
  if (patch.scale != null) {
    normalized.scale = normalizeI16("scale", patch.scale);
  }

  return normalized;
}

function normalizeFinite(name: string, value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`Placement ${name} must be finite`);
  }
  return value;
}

function normalizeU32(name: string, value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`Placement ${name} must be an unsigned 32-bit integer`);
  }
  return value;
}

function normalizeI16(name: string, value: number): number {
  if (!Number.isInteger(value) || value < -32768 || value > 32767) {
    throw new Error(`Placement ${name} must be a signed 16-bit integer`);
  }
  return value;
}

function normalizeU8(name: string, value: number, max = 0xff): number {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new Error(`Placement ${name} must be an unsigned 8-bit integer`);
  }
  return value;
}

function normalizeU16(name: string, value: number, max = 0xffff, min = 0): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`Placement ${name} must be an unsigned 16-bit integer`);
  }
  return value;
}
