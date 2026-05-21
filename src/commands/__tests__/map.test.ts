import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyMapEditClientPackage,
  exportMapEdits,
  exportMapPlacementEdits,
  exportMapTileEdits,
  getMapTileTexturePreview,
  getTerrainTexturePreview,
  inspectMapTile,
  restoreMapEditClientBackup,
} from "../map";

const { invokeTimedMock } = vi.hoisted(() => ({
  invokeTimedMock: vi.fn(),
}));

vi.mock("@/commands/invokeTimed", () => ({
  invokeTimed: (...args: unknown[]) => invokeTimedMock(...args),
}));

describe("map commands", () => {
  const sourceGuard = {
    map_source: {
      map_file_len: 1024,
      map_modified_ms: 1000,
      content_sha256: "map-hash",
    },
    obj_source: {
      map_file_len: 512,
      map_modified_ms: 2000,
      content_sha256: "obj-hash",
    },
    rbo_source: {
      map_file_len: 256,
      map_modified_ms: 3000,
      content_sha256: "rbo-hash",
    },
  };

  beforeEach(() => {
    invokeTimedMock.mockReset();
  });

  it("passes map source guards when inspecting tiles", async () => {
    invokeTimedMock.mockResolvedValueOnce({ tile_x: 32, tile_y: 48 });

    await inspectMapTile("project-1", "garner", 32, 48, sourceGuard.map_source);

    expect(invokeTimedMock).toHaveBeenCalledWith("inspect_map_tile", {
      projectId: "project-1",
      mapName: "garner",
      tileX: 32,
      tileY: 48,
      includePlacements: false,
      sourceGuard: sourceGuard.map_source,
    });
  });

  it("passes map source guards when requesting tile texture previews", async () => {
    invokeTimedMock.mockResolvedValueOnce(null);

    await getMapTileTexturePreview("project-1", "garner", 32, 48, sourceGuard.map_source);

    expect(invokeTimedMock).toHaveBeenCalledWith("get_map_tile_texture_preview", {
      projectId: "project-1",
      mapName: "garner",
      tileX: 32,
      tileY: 48,
      sourceGuard: sourceGuard.map_source,
    });
  });

  it("sends export source guards with the Tauri invoke payload", async () => {
    invokeTimedMock.mockResolvedValueOnce({
      map_name: "garner",
      map_path: "garner.map",
      obj_path: "garner.obj",
      rbo_path: "garner.rbo",
      atr_path: "garner.atr",
      blk_path: "garner.blk",
      tile_patch_count: 1,
      placement_edit_count: 1,
      map_bytes_written: 1,
      obj_bytes_written: 1,
      rbo_bytes_written: 1,
      atr_bytes_written: 1,
      blk_bytes_written: 1,
      map_sha256: "export-map-hash",
      obj_sha256: "export-obj-hash",
      rbo_sha256: "export-rbo-hash",
    });

    await exportMapEdits(
      "project-1",
      "garner",
      [{ tile_x: 32, tile_y: 48, c_height: 11 }],
      [{
        op: "update",
        index: 12,
        obj_type: 1,
        obj_id: 401,
        world_x: 120,
      }],
      sourceGuard,
    );

    expect(invokeTimedMock).toHaveBeenCalledWith("export_map_edits", {
      projectId: "project-1",
      mapName: "garner",
      tilePatches: [{ tile_x: 32, tile_y: 48, c_height: 11 }],
      placementEdits: [{
        op: "update",
        index: 12,
        obj_type: 1,
        obj_id: 401,
        world_x: 120,
      }],
      sourceGuard,
    });
  });

  it("sends source guards with legacy tile and placement export payloads", async () => {
    invokeTimedMock
      .mockResolvedValueOnce({
        map_name: "garner",
        map_path: "garner.map",
        atr_path: "garner.atr",
        blk_path: "garner.blk",
        patch_count: 1,
        bytes_written: 1,
        atr_bytes_written: 1,
        blk_bytes_written: 1,
      })
      .mockResolvedValueOnce({
        map_name: "garner",
        obj_path: "garner.obj",
        patch_count: 1,
        bytes_written: 1,
      });

    await exportMapTileEdits(
      "project-1",
      "garner",
      [{ tile_x: 32, tile_y: 48, c_height: 11 }],
      sourceGuard.map_source,
    );
    await exportMapPlacementEdits(
      "project-1",
      "garner",
      [{
        op: "update",
        index: 12,
        obj_id: 401,
      }],
      sourceGuard.obj_source,
    );

    expect(invokeTimedMock).toHaveBeenNthCalledWith(1, "export_map_tile_edits", {
      projectId: "project-1",
      mapName: "garner",
      patches: [{ tile_x: 32, tile_y: 48, c_height: 11 }],
      sourceGuard: sourceGuard.map_source,
    });
    expect(invokeTimedMock).toHaveBeenNthCalledWith(2, "export_map_placement_edits", {
      projectId: "project-1",
      mapName: "garner",
      patches: [{
        op: "update",
        index: 12,
        obj_id: 401,
      }],
      sourceGuard: sourceGuard.obj_source,
    });
  });

  it("sends exported client package paths and source guards when applying to the client", async () => {
    invokeTimedMock.mockResolvedValueOnce({
      map_name: "garner",
      backup_dir: "C:/project/pko-tools/backups/map-edits/garner-1000",
      map_path: "C:/project/map/garner.map",
      obj_path: "C:/project/map/garner.obj",
      rbo_path: "C:/project/map/garner.rbo",
      map_bytes_written: 100,
      obj_bytes_written: 80,
      rbo_bytes_written: 30,
      backups: [],
    });

    await applyMapEditClientPackage(
      "project-1",
      "garner",
      {
        map_path: "C:/project/pko-tools/exports/map-edits/garner.map",
        obj_path: "C:/project/pko-tools/exports/map-edits/garner.obj",
        rbo_path: "C:/project/pko-tools/exports/map-edits/garner.rbo",
        map_bytes: 100,
        obj_bytes: 80,
        rbo_bytes: 30,
        map_sha256: "export-map-hash",
        obj_sha256: "export-obj-hash",
        rbo_sha256: "export-rbo-hash",
      },
      sourceGuard,
    );

    expect(invokeTimedMock).toHaveBeenCalledWith("apply_map_edit_client_package", {
      projectId: "project-1",
      mapName: "garner",
      package: {
        map_path: "C:/project/pko-tools/exports/map-edits/garner.map",
        obj_path: "C:/project/pko-tools/exports/map-edits/garner.obj",
        rbo_path: "C:/project/pko-tools/exports/map-edits/garner.rbo",
        map_bytes: 100,
        obj_bytes: 80,
        rbo_bytes: 30,
        map_sha256: "export-map-hash",
        obj_sha256: "export-obj-hash",
        rbo_sha256: "export-rbo-hash",
      },
      sourceGuard,
    });
  });

  it("sends the backup directory when restoring installed client files", async () => {
    invokeTimedMock.mockResolvedValueOnce({
      map_name: "garner",
      backup_dir: "C:/project/pko-tools/backups/map-edits/garner-1000",
      restore_backup_dir: "C:/project/pko-tools/backups/map-edits/garner-pre-restore-1001",
      map_path: "C:/project/map/garner.map",
      obj_path: null,
      rbo_path: null,
      map_bytes_restored: 100,
      obj_bytes_restored: 0,
      rbo_bytes_restored: 0,
      current_backups: [],
      removed_paths: ["C:/project/map/garner.obj"],
    });

    await restoreMapEditClientBackup(
      "project-1",
      "garner",
      "C:/project/pko-tools/backups/map-edits/garner-1000",
    );

    expect(invokeTimedMock).toHaveBeenCalledWith("restore_map_edit_client_backup", {
      projectId: "project-1",
      mapName: "garner",
      backupDir: "C:/project/pko-tools/backups/map-edits/garner-1000",
    });
  });

  it("requests terrain texture previews lazily by texture id", async () => {
    invokeTimedMock.mockResolvedValueOnce("data:image/png;base64,preview");

    await expect(getTerrainTexturePreview("project-1", 7)).resolves.toBe(
      "data:image/png;base64,preview",
    );

    expect(invokeTimedMock).toHaveBeenCalledWith("get_terrain_texture_preview", {
      projectId: "project-1",
      textureId: 7,
    });
  });
});
