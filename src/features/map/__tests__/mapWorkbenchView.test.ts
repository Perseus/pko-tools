import { describe, expect, it } from "vitest";

import {
  canvasDevicePixelRatio,
  createTileBrushPatches,
  createTileEditDraft,
  decodeBtBlockObjectHeight,
  createPlacementAddDraft,
  createPlacementAddEditFromDraft,
  createPlacementEditDraft,
  createPlacementPatchFromDraft,
  createTemporaryPlacementFromAddEdit,
  createTilePatchFromDraft,
  centerTransformOnTile,
  applyPlacementPatch,
  fitMapTransform,
  fitTileBoundsTransform,
  fitMapToNavigator,
  formatPendingEditSummary,
  getPlacementMarkerVisual,
  getPrioritizedVisibleChunkKeys,
  getVisibleChunkKeys,
  hitTestPlacementMarker,
  includeStagedPlacementSources,
  mapTileKey,
  navigatorPointToTile,
  navigatorViewportRect,
  pruneChunkRecord,
  screenToTile,
  selectPlacementMarkersForViewport,
  setBtBlockObjectHeight,
  setBtBlockBlocked,
  isBtBlockBlocked,
  shouldLoadDetailChunks,
  shouldLoadDetailChunkWindow,
  tilePatchLayerPreviewRects,
  tileBoundsForViewport,
  tileToScreen,
  zoomAt,
} from "../mapWorkbenchView";
import type { MapPlacementRecord, MapTileInspection, MapTilePatch } from "@/types/map";

const manifest = {
  width: 512,
  height: 384,
  chunk_size: 128,
  chunk_count_x: 4,
  chunk_count_y: 3,
};

function placement(index: number, worldX: number, worldY: number): MapPlacementRecord {
  return {
    index,
    obj_type: 0,
    obj_id: 100 + index,
    kind: "building",
    world_x: worldX,
    world_y: worldY,
    world_z: 0,
    yaw_angle: 0,
    scale: 100,
    display_name: null,
    asset_name: null,
    attach_effect_id: null,
    distance: null,
  };
}

function packTextureLayers({
  layer1Texture,
  layer1Alpha,
  layer2Texture,
  layer2Alpha,
  layer3Texture,
  layer3Alpha,
}: {
  layer1Texture: number;
  layer1Alpha: number;
  layer2Texture: number;
  layer2Alpha: number;
  layer3Texture: number;
  layer3Alpha: number;
}) {
  return layer1Texture * 2 ** 26
    + layer1Alpha * 2 ** 22
    + layer2Texture * 2 ** 16
    + layer2Alpha * 2 ** 12
    + layer3Texture * 2 ** 6
    + layer3Alpha * 2 ** 2;
}

function inspection(): MapTileInspection {
  return {
    tile_x: 4,
    tile_y: 7,
    section_x: 0,
    section_y: 0,
    local_x: 4,
    local_y: 7,
    native: {
      dw_tile_info: 1,
      bt_tile_info: 2,
      s_color: -1,
      c_height: 10,
      s_region: 1,
      bt_island: 3,
      bt_block: [0, 128, 2, 3],
    },
    texture_layers: [],
    color_rgb: [255, 255, 255],
    terrain_height: 1,
    region_flags: ["land"],
    island: 3,
    subtiles: [],
    nearby_placements: [],
  };
}

describe("mapWorkbenchView", () => {
  it("caps canvas device pixel ratio to protect map editor FPS", () => {
    expect(canvasDevicePixelRatio(undefined)).toBe(1);
    expect(canvasDevicePixelRatio(0.8)).toBe(1);
    expect(canvasDevicePixelRatio(1.1)).toBe(1.1);
    expect(canvasDevicePixelRatio(2)).toBe(1.25);
  });

  it("converts between screen and tile coordinates", () => {
    const transform = { scale: 4, offsetX: 20, offsetY: 12 };

    expect(screenToTile(28, 20, transform)).toEqual({ x: 2, y: 2 });
    expect(tileToScreen(2, 2, transform)).toEqual({ x: 28, y: 20 });
  });

  it("clamps visible chunk keys to the manifest bounds", () => {
    const keys = getVisibleChunkKeys(
      manifest,
      { width: 260, height: 180 },
      { scale: 1, offsetX: -120, offsetY: -40 },
      0,
    );

    expect(keys).toEqual(["0:0", "1:0", "2:0", "0:1", "1:1", "2:1"]);
  });

  it("can compute visible chunk keys against a smaller adaptive chunk grid", () => {
    const keys = getVisibleChunkKeys(
      manifest,
      { width: 260, height: 180 },
      { scale: 1, offsetX: -120, offsetY: -40 },
      0,
      64,
    );

    expect(keys).toEqual([
      "1:0", "2:0", "3:0", "4:0", "5:0",
      "1:1", "2:1", "3:1", "4:1", "5:1",
      "1:2", "2:2", "3:2", "4:2", "5:2",
      "1:3", "2:3", "3:3", "4:3", "5:3",
    ]);
  });

  it("prioritizes visible detail chunks closest to the viewport center before padded neighbors", () => {
    const keys = getPrioritizedVisibleChunkKeys(
      manifest,
      { width: 128, height: 128 },
      { scale: 1, offsetX: -192, offsetY: -192 },
      1,
    );

    expect(keys.slice(0, 4)).toEqual(["1:1", "2:1", "1:2", "2:2"]);
    expect(keys).toContain("0:0");
    expect(keys.indexOf("0:0")).toBeGreaterThan(keys.indexOf("2:2"));
  });

  it("returns finite viewport bounds for placement queries", () => {
    const bounds = tileBoundsForViewport(
      manifest,
      { width: 100, height: 60 },
      { scale: 2, offsetX: -10, offsetY: -20 },
    );

    expect(bounds).toEqual({ minX: 5, minY: 10, maxX: 55, maxY: 40 });
  });

  it("keeps the cursor anchored while zooming", () => {
    const next = zoomAt(
      { scale: 2, offsetX: 10, offsetY: 20 },
      { x: 50, y: 60 },
      1,
      0.25,
      64,
    );

    expect(screenToTile(50, 60, next)).toEqual({ x: 20, y: 20 });
    expect(next.scale).toBeGreaterThan(2);
  });

  it("fits very large maps inside the visible canvas", () => {
    const transform = fitMapTransform(
      { width: 4096, height: 4096 },
      { width: 820, height: 300 },
      { minScale: 0.02, maxScale: 64, paddingRatio: 0.92 },
    );

    expect(transform.scale).toBeCloseTo(0.06738, 4);
    expect(transform.offsetY).toBeGreaterThan(0);
    expect(transform.offsetX).toBeGreaterThan(0);
    expect(transform.offsetY + 4096 * transform.scale).toBeLessThanOrEqual(300);
  });

  it("frames a tile bounds rectangle inside the visible canvas", () => {
    const transform = fitTileBoundsTransform(
      { minX: 100, minY: 200, maxX: 228, maxY: 264 },
      { width: 820, height: 300 },
      { minScale: 0.02, maxScale: 64, paddingRatio: 0.9 },
    );

    expect(transform.scale).toBeCloseTo(4.21875, 5);
    expect(screenToTile(410, 150, transform)).toEqual({ x: 164, y: 232 });

    const minScreen = tileToScreen(100, 200, transform);
    const maxScreen = tileToScreen(228, 264, transform);
    expect(minScreen.x).toBeGreaterThanOrEqual(0);
    expect(minScreen.y).toBeGreaterThanOrEqual(0);
    expect(maxScreen.x).toBeLessThanOrEqual(820);
    expect(maxScreen.y).toBeLessThanOrEqual(300);
  });

  it("does not let oversized fit padding crop framed bounds", () => {
    const transform = fitTileBoundsTransform(
      { minX: 100, minY: 200, maxX: 228, maxY: 264 },
      { width: 820, height: 300 },
      { minScale: 0.02, maxScale: 64, paddingRatio: 2 },
    );

    const minScreen = tileToScreen(100, 200, transform);
    const maxScreen = tileToScreen(228, 264, transform);
    expect(minScreen.x).toBeGreaterThanOrEqual(0);
    expect(minScreen.y).toBeGreaterThanOrEqual(0);
    expect(maxScreen.x).toBeLessThanOrEqual(820);
    expect(maxScreen.y).toBeLessThanOrEqual(300);
  });

  it("maps viewport bounds into an aspect-correct overview navigator", () => {
    const frame = fitMapToNavigator(
      { width: 4096, height: 2048 },
      { width: 200, height: 120 },
    );
    const viewportRect = navigatorViewportRect(
      { minX: 1024, minY: 512, maxX: 2048, maxY: 1024 },
      frame,
    );

    expect(frame).toEqual({
      x: 0,
      y: 10,
      width: 200,
      height: 100,
      scale: 200 / 4096,
    });
    expect(viewportRect).toEqual({
      x: 50,
      y: 35,
      width: 50,
      height: 25,
    });
  });

  it("uses overview navigator clicks to preserve zoom while recentering the map", () => {
    const frame = fitMapToNavigator(manifest, { width: 160, height: 160 });
    const tile = navigatorPointToTile({ x: frame.x + frame.width, y: frame.y }, frame, manifest);
    const transform = centerTransformOnTile(
      tile,
      { width: 800, height: 400 },
      2,
    );

    expect(tile).toEqual({ x: 512, y: 0 });
    expect(transform).toEqual({
      scale: 2,
      offsetX: -624,
      offsetY: 200,
    });
    expect(screenToTile(400, 200, transform)).toEqual(tile);
  });

  it("hit-tests the closest placement marker within the requested radius", () => {
    const transform = { scale: 10, offsetX: 0, offsetY: 0 };
    const hit = hitTestPlacementMarker(
      [placement(1, 5, 5), placement(2, 5.4, 5.2)],
      { x: 54, y: 52 },
      transform,
      10,
    );

    expect(hit?.index).toBe(2);
  });

  it("hides normal placement markers until enabled and zoomed in", () => {
    expect(getPlacementMarkerVisual({ selected: false, scale: 0.1, overlayEnabled: false })).toBeNull();
    expect(getPlacementMarkerVisual({ selected: false, scale: 0.1, overlayEnabled: true })).toBeNull();
    expect(getPlacementMarkerVisual({ selected: false, scale: 0.5, overlayEnabled: true })).toEqual({
      radiusPx: 1.75,
      fillAlpha: 0.16,
      strokeAlpha: 0.42,
    });
    expect(getPlacementMarkerVisual({ selected: true, scale: 0.1, overlayEnabled: false })).toEqual({
      radiusPx: 7,
      fillAlpha: 0.14,
      strokeAlpha: 1,
    });
  });

  it("declutters placement markers by screen-space spacing", () => {
    const markers = selectPlacementMarkersForViewport({
      placements: [
        placement(1, 10, 10),
        placement(2, 10.4, 10.3),
        placement(3, 50, 50),
      ],
      transform: { scale: 10, offsetX: 0, offsetY: 0 },
      viewport: { width: 800, height: 600 },
      minSpacingPx: 16,
      maxMarkers: 100,
    });

    expect(markers.map((entry) => entry.index)).toEqual([1, 3]);
  });

  it("uses a calmer default placement marker density", () => {
    const markers = selectPlacementMarkersForViewport({
      placements: [
        placement(1, 0, 0),
        placement(2, 1.9, 0),
        placement(3, 6, 0),
      ],
      transform: { scale: 10, offsetX: 0, offsetY: 20 },
      viewport: { width: 800, height: 600 },
      maxMarkers: 100,
    });

    expect(markers.map((entry) => entry.index)).toEqual([1, 3]);
  });

  it("keeps pinned placement markers visible when decluttering", () => {
    const markers = selectPlacementMarkersForViewport({
      placements: [
        placement(1, 10, 10),
        placement(2, 10.4, 10.3),
        placement(3, 10.8, 10.6),
      ],
      pinnedKeys: new Set(["2"]),
      transform: { scale: 10, offsetX: 0, offsetY: 0 },
      viewport: { width: 800, height: 600 },
      minSpacingPx: 16,
      maxMarkers: 1,
    });

    expect(markers.map((entry) => entry.index)).toEqual([2]);
  });

  it("loads detailed chunks only after the map is zoomed in", () => {
    expect(shouldLoadDetailChunks(0.08, 0.25)).toBe(false);
    expect(shouldLoadDetailChunks(0.25, 0.25)).toBe(true);
    expect(shouldLoadDetailChunks(1, 0.25)).toBe(true);
  });

  it("keeps detailed chunk requests bounded by the visible chunk window", () => {
    expect(shouldLoadDetailChunkWindow(0.24, 0.25, 1, 96)).toBe(false);
    expect(shouldLoadDetailChunkWindow(0.3, 0.25, 96, 96)).toBe(true);
    expect(shouldLoadDetailChunkWindow(0.3, 0.25, 97, 96)).toBe(false);
    expect(shouldLoadDetailChunkWindow(0.3, 0.25, 1024, 96)).toBe(false);
  });

  it("prunes detail chunks to visible keys plus the most recent cache entries", () => {
    const chunks = {
      "0:0": "old",
      "1:0": "visible",
      "2:0": "recent",
      "3:0": "newest",
    };

    expect(pruneChunkRecord(chunks, ["1:0"], 3)).toEqual({
      "1:0": "visible",
      "2:0": "recent",
      "3:0": "newest",
    });

    expect(pruneChunkRecord(chunks, ["0:0", "1:0", "2:0", "3:0"], 2))
      .toEqual({
        "0:0": "old",
        "1:0": "visible",
      });

    expect(pruneChunkRecord(chunks, [], 0)).toEqual({});
  });

  it("formats pending edit summary by edit type", () => {
    expect(formatPendingEditSummary({
      tileCount: 2,
      placementUpdateCount: 1,
      placementAddCount: 3,
      placementDeleteCount: 1,
    })).toBe("2 tiles, 1 placement update, 3 placement adds, 1 placement delete");

    expect(formatPendingEditSummary({
      tileCount: 0,
      placementUpdateCount: 0,
      placementAddCount: 0,
      placementDeleteCount: 0,
    })).toBe("");
  });

  it("builds null tile patches when edit drafts match native fields", () => {
    const tile = inspection();
    const draft = createTileEditDraft(tile);

    expect(createTilePatchFromDraft(tile, draft)).toBeNull();
  });

  it("decodes staged terrain texture layers into tile drafts", () => {
    const tile = inspection();
    const draft = createTileEditDraft(tile, {
      tile_x: 4,
      tile_y: 7,
      bt_tile_info: 9,
      dw_tile_info: packTextureLayers({
        layer1Texture: 21,
        layer1Alpha: 5,
        layer2Texture: 33,
        layer2Alpha: 7,
        layer3Texture: 12,
        layer3Alpha: 9,
      }),
      s_color: 1234,
    });

    expect(draft.sColor).toBe(1234);
    expect(draft.textureLayers).toEqual([
      { textureId: 9, alpha: 15 },
      { textureId: 21, alpha: 5 },
      { textureId: 33, alpha: 7 },
      { textureId: 12, alpha: 9 },
    ]);
  });

  it("builds clamped tile patches for changed editable native fields", () => {
    const tile = inspection();
    const draft = createTileEditDraft(tile, {
      tile_x: 4,
      tile_y: 7,
      c_height: 999,
      s_region: 4,
      bt_block: [0, -5, 255, 300],
    });

    expect(createTilePatchFromDraft(tile, draft)).toEqual({
      tile_x: 4,
      tile_y: 7,
      c_height: 127,
      s_region: 4,
      bt_block: [0, 0, 255, 255],
    });
    expect(mapTileKey(4, 7)).toBe("4:7");
  });

  it("toggles btBlock collision while preserving object-height bits", () => {
    expect(isBtBlockBlocked(0x49)).toBe(false);
    expect(isBtBlockBlocked(0xc9)).toBe(true);
    expect(setBtBlockBlocked(0x49, true)).toBe(0xc9);
    expect(setBtBlockBlocked(0xc9, false)).toBe(0x49);
  });

  it("edits btBlock object height while preserving collision", () => {
    expect(decodeBtBlockObjectHeight(0x81)).toBeCloseTo(0.05);
    expect(decodeBtBlockObjectHeight(0xc1)).toBeCloseTo(-0.05);
    expect(setBtBlockObjectHeight(0x80, 0.05)).toBe(0x81);
    expect(setBtBlockObjectHeight(0x80, -0.05)).toBe(0xc1);
    expect(setBtBlockObjectHeight(0xc1, 0)).toBe(0x80);
    expect(setBtBlockObjectHeight(0x00, 9)).toBe(0x3f);
    expect(setBtBlockObjectHeight(0x80, -9)).toBe(0xff);
  });

  it("builds semantic tile patch previews for visual edit feedback", () => {
    const patch: MapTilePatch = {
      tile_x: 4,
      tile_y: 7,
      s_color: -2048,
      c_height: 10,
      bt_tile_info: 7,
      bt_block: [0x80, 0x00, 0xc1, 0x02],
    };

    expect(tilePatchLayerPreviewRects(patch, "terrain_color")).toEqual([
      { x: 4, y: 7, width: 1, height: 1, fillStyle: "rgb(255, 0, 0)" },
    ]);
    expect(tilePatchLayerPreviewRects(patch, "height")).toEqual([
      { x: 4, y: 7, width: 1, height: 1, fillStyle: "rgb(138, 138, 138)" },
    ]);
    expect(tilePatchLayerPreviewRects(patch, "collision")).toEqual([
      { x: 4, y: 7, width: 0.5, height: 0.5, fillStyle: "rgba(239,68,68,0.72)" },
      { x: 4.5, y: 7, width: 0.5, height: 0.5, fillStyle: "rgba(34,197,94,0.28)" },
      { x: 4, y: 7.5, width: 0.5, height: 0.5, fillStyle: "rgba(239,68,68,0.72)" },
      { x: 4.5, y: 7.5, width: 0.5, height: 0.5, fillStyle: "rgba(34,197,94,0.28)" },
    ]);
    expect(tilePatchLayerPreviewRects(patch, "object_height")).toEqual([
      { x: 4, y: 7, width: 0.5, height: 0.5, fillStyle: "rgba(148,163,184,0.32)" },
      { x: 4.5, y: 7, width: 0.5, height: 0.5, fillStyle: "rgba(148,163,184,0.32)" },
      { x: 4, y: 7.5, width: 0.5, height: 0.5, fillStyle: "rgba(59,130,246,0.33)" },
      { x: 4.5, y: 7.5, width: 0.5, height: 0.5, fillStyle: "rgba(239,68,68,0.34)" },
    ]);
    const texturePreview = [
      { x: 4, y: 7, width: 1, height: 1, fillStyle: "hsla(329, 70%, 45%, 0.46)" },
    ];
    expect(tilePatchLayerPreviewRects(patch, "texture_base")).toEqual(texturePreview);
    expect(tilePatchLayerPreviewRects(patch, "texture_raw")).toEqual(texturePreview);
  });

  it("creates clipped rectangular brush patches from a staged tile patch", () => {
    const source: MapTilePatch = {
      tile_x: 0,
      tile_y: 0,
      c_height: 12,
      s_region: 4,
      bt_block: [1, 2, 3, 4],
    };

    const patches = createTileBrushPatches(source, 1, { width: 2, height: 2 });

    expect(patches).toEqual([
      { tile_x: 0, tile_y: 0, c_height: 12, s_region: 4, bt_block: [1, 2, 3, 4] },
      { tile_x: 1, tile_y: 0, c_height: 12, s_region: 4, bt_block: [1, 2, 3, 4] },
      { tile_x: 0, tile_y: 1, c_height: 12, s_region: 4, bt_block: [1, 2, 3, 4] },
      { tile_x: 1, tile_y: 1, c_height: 12, s_region: 4, bt_block: [1, 2, 3, 4] },
    ]);
    expect(patches[0].bt_block).not.toBe(source.bt_block);
  });

  it("builds texture layer tile patches from changed terrain layer drafts", () => {
    const tile = inspection();
    tile.native.bt_tile_info = 7;
    tile.native.dw_tile_info = packTextureLayers({
      layer1Texture: 21,
      layer1Alpha: 5,
      layer2Texture: 33,
      layer2Alpha: 7,
      layer3Texture: 12,
      layer3Alpha: 9,
    });
    tile.native.s_color = -1;
    const draft = createTileEditDraft(tile);
    draft.textureLayers[0].textureId = 300;
    draft.textureLayers[1].textureId = 70;
    draft.textureLayers[1].alpha = 20;
    draft.textureLayers[2].textureId = -4;
    draft.textureLayers[2].alpha = -1;
    draft.textureLayers[3].textureId = 10;
    draft.textureLayers[3].alpha = 2;
    draft.sColor = 40000;

    expect(createTilePatchFromDraft(tile, draft)).toEqual({
      tile_x: 4,
      tile_y: 7,
      bt_tile_info: 255,
      dw_tile_info: packTextureLayers({
        layer1Texture: 63,
        layer1Alpha: 15,
        layer2Texture: 0,
        layer2Alpha: 0,
        layer3Texture: 10,
        layer3Alpha: 2,
      }),
      s_color: 32767,
    });
  });

  it("preserves native low dw tile bits when layer fields change", () => {
    const tile = inspection();
    tile.native.dw_tile_info = packTextureLayers({
      layer1Texture: 21,
      layer1Alpha: 5,
      layer2Texture: 33,
      layer2Alpha: 7,
      layer3Texture: 12,
      layer3Alpha: 9,
    }) + 3;
    const draft = createTileEditDraft(tile);
    draft.textureLayers[2].alpha = 8;

    expect(createTilePatchFromDraft(tile, draft)).toEqual({
      tile_x: 4,
      tile_y: 7,
      dw_tile_info: packTextureLayers({
        layer1Texture: 21,
        layer1Alpha: 5,
        layer2Texture: 33,
        layer2Alpha: 8,
        layer3Texture: 12,
        layer3Alpha: 9,
      }) + 3,
    });
  });

  it("builds placement patches from selected placement drafts", () => {
    const selected = placement(12, 20, 30);
    const draft = createPlacementEditDraft(selected);
    draft.worldX = 21.25;
    draft.worldZ = 3.5;
    draft.yawAngle = 400;
    draft.scale = 9999;

    const patch = createPlacementPatchFromDraft(selected, draft);

    expect(patch).toEqual({
      index: 12,
      world_x: 21.25,
      world_z: 3.5,
      yaw_angle: 400,
      scale: 9999,
    });
    expect(applyPlacementPatch(selected, patch ?? undefined)).toMatchObject({
      world_x: 21.25,
      world_y: 30,
      world_z: 3.5,
      yaw_angle: 400,
      scale: 9999,
    });
  });

  it("builds selected placement replacement patches without moving the source", () => {
    const selected = {
      ...placement(12, 20, 30),
      display_name: "Old building",
      asset_name: "old.lmo",
      attach_effect_id: 77,
    };
    const draft = {
      ...createPlacementEditDraft(selected),
      objType: 1,
      objId: 401,
    };

    const patch = createPlacementPatchFromDraft(selected, draft);

    expect(patch).toEqual({
      index: 12,
      obj_type: 1,
      obj_id: 401,
    });
    expect(applyPlacementPatch(selected, patch ?? undefined)).toMatchObject({
      obj_type: 1,
      obj_id: 401,
      kind: "effect",
      world_x: 20,
      world_y: 30,
      world_z: 0,
      display_name: null,
      asset_name: null,
      attach_effect_id: null,
    });
  });

  it("returns null placement patches when drafts match the source placement", () => {
    const selected = placement(12, 20, 30);

    expect(createPlacementPatchFromDraft(selected, createPlacementEditDraft(selected))).toBeNull();
  });

  it("keeps staged placement sources renderable even when they are not visible by source bounds", () => {
    const first = placement(1, 10, 10);
    const staged = placement(2, 200, 200);

    expect(includeStagedPlacementSources([first], { "2": staged })).toEqual([first, staged]);
    expect(includeStagedPlacementSources([first, staged], { "2": staged })).toEqual([
      first,
      staged,
    ]);
  });

  it("builds clamped add placement edits and temporary render records", () => {
    const draft = createPlacementAddDraft({ x: 12.2, y: 20.7 });
    draft.objType = 7;
    draft.objId = 0;
    draft.worldZ = Number.NaN;
    draft.yawAngle = 40000;
    draft.scale = -40000;

    const edit = createPlacementAddEditFromDraft(draft);
    const temporary = createTemporaryPlacementFromAddEdit(edit, -1);

    expect(edit).toEqual({
      op: "add",
      obj_type: 1,
      obj_id: 1,
      world_x: 12.5,
      world_y: 20.5,
      world_z: 0,
      yaw_angle: 32767,
      scale: -32768,
    });
    expect(temporary).toMatchObject({
      index: -1,
      obj_type: 1,
      obj_id: 1,
      kind: "effect",
      world_x: 12.5,
      world_y: 20.5,
    });
  });
});
