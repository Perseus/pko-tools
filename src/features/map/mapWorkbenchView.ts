import type {
  MapPlacementAddEdit,
  MapPlacementPatch,
  MapPlacementRecord,
  MapTileInspection,
  MapTilePatch,
  MapWorkbenchLayer,
} from "@/types/map";

export type MapWorkbenchViewport = {
  width: number;
  height: number;
};

export type MapWorkbenchTransform = {
  scale: number;
  offsetX: number;
  offsetY: number;
};

export type MapFitBounds = {
  width: number;
  height: number;
};

export type MapWorkbenchManifestBounds = {
  width: number;
  height: number;
  chunk_size: number;
  chunk_count_x: number;
  chunk_count_y: number;
};

export type MapPoint = {
  x: number;
  y: number;
};

export type MapTileBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type MapPlacementOverlayFilter = {
  query: string;
  placementType: "all" | "building" | "effect";
  nearEnabled: boolean;
  nearX?: number;
  nearY?: number;
  nearRadius?: number;
  useVisibleBounds: boolean;
  valid: boolean;
};

export type MapNavigatorFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
};

export type MapNavigatorRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type MapTileEditDraft = {
  textureLayers: [MapTileLayerDraft, MapTileLayerDraft, MapTileLayerDraft, MapTileLayerDraft];
  sColor: number;
  cHeight: number;
  sRegion: number;
  btIsland: number;
  btBlock: [number, number, number, number];
};

export type MapTileLayerDraft = {
  textureId: number;
  alpha: number;
};

export type MapPlacementEditDraft = {
  objType: number;
  objId: number;
  worldX: number;
  worldY: number;
  worldZ: number;
  yawAngle: number;
  scale: number;
};

export type MapPlacementAddDraft = {
  objType: number;
  objId: number;
  worldX: number;
  worldY: number;
  worldZ: number;
  yawAngle: number;
  scale: number;
};

export type MapTilePatchLayerPreviewRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  fillStyle: string;
};

export type MapPlacementMarkerVisual = {
  radiusPx: number;
  fillAlpha: number;
  strokeAlpha: number;
};

export function canvasDevicePixelRatio(devicePixelRatio: number | null | undefined): number {
  const ratio = Number.isFinite(devicePixelRatio) && devicePixelRatio
    ? devicePixelRatio
    : 1;
  return clamp(ratio, 1, 1.25);
}

export function fitMapTransform(
  bounds: MapFitBounds,
  viewport: MapWorkbenchViewport,
  options: {
    minScale: number;
    maxScale: number;
    paddingRatio?: number;
  },
): MapWorkbenchTransform {
  const paddingRatio = normalizeFitPaddingRatio(options.paddingRatio);
  const scale = Math.min(
    viewport.width / Math.max(1, bounds.width),
    viewport.height / Math.max(1, bounds.height),
  ) * paddingRatio;
  const nextScale = clamp(scale, options.minScale, options.maxScale);

  return {
    scale: nextScale,
    offsetX: (viewport.width - bounds.width * nextScale) / 2,
    offsetY: (viewport.height - bounds.height * nextScale) / 2,
  };
}

export function fitTileBoundsTransform(
  bounds: MapTileBounds,
  viewport: MapWorkbenchViewport,
  options: {
    minScale: number;
    maxScale: number;
    paddingRatio?: number;
  },
): MapWorkbenchTransform {
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const height = Math.max(1, bounds.maxY - bounds.minY);
  const fitted = fitMapTransform({ width, height }, viewport, options);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;

  return centerTransformOnTile({ x: centerX, y: centerY }, viewport, fitted.scale);
}

export function fitMapToNavigator(
  bounds: MapFitBounds,
  viewport: MapWorkbenchViewport,
): MapNavigatorFrame {
  const scale = Math.min(
    viewport.width / Math.max(1, bounds.width),
    viewport.height / Math.max(1, bounds.height),
  );
  const width = bounds.width * scale;
  const height = bounds.height * scale;

  return {
    x: (viewport.width - width) / 2,
    y: (viewport.height - height) / 2,
    width,
    height,
    scale,
  };
}

export function screenToTile(
  screenX: number,
  screenY: number,
  transform: MapWorkbenchTransform,
): MapPoint {
  return {
    x: (screenX - transform.offsetX) / transform.scale,
    y: (screenY - transform.offsetY) / transform.scale,
  };
}

export function navigatorPointToTile(
  point: MapPoint,
  frame: MapNavigatorFrame,
  bounds: MapFitBounds,
): MapPoint {
  const x = clamp(point.x, frame.x, frame.x + frame.width);
  const y = clamp(point.y, frame.y, frame.y + frame.height);

  return {
    x: clamp((x - frame.x) / frame.scale, 0, bounds.width),
    y: clamp((y - frame.y) / frame.scale, 0, bounds.height),
  };
}

export function navigatorViewportRect(
  bounds: MapTileBounds,
  frame: MapNavigatorFrame,
): MapNavigatorRect {
  return {
    x: frame.x + bounds.minX * frame.scale,
    y: frame.y + bounds.minY * frame.scale,
    width: Math.max(2, (bounds.maxX - bounds.minX) * frame.scale),
    height: Math.max(2, (bounds.maxY - bounds.minY) * frame.scale),
  };
}

export function centerTransformOnTile(
  tile: MapPoint,
  viewport: MapWorkbenchViewport,
  scale: number,
): MapWorkbenchTransform {
  return {
    scale,
    offsetX: viewport.width / 2 - tile.x * scale,
    offsetY: viewport.height / 2 - tile.y * scale,
  };
}

export function tileToScreen(
  tileX: number,
  tileY: number,
  transform: MapWorkbenchTransform,
): MapPoint {
  return {
    x: transform.offsetX + tileX * transform.scale,
    y: transform.offsetY + tileY * transform.scale,
  };
}

export function tileBoundsForViewport(
  manifest: MapWorkbenchManifestBounds,
  viewport: MapWorkbenchViewport,
  transform: MapWorkbenchTransform,
): MapTileBounds {
  const scale = Number.isFinite(transform.scale) && transform.scale > 0
    ? transform.scale
    : 1;
  const min = screenToTile(0, 0, { ...transform, scale });
  const max = screenToTile(viewport.width, viewport.height, { ...transform, scale });

  return {
    minX: clamp(Math.min(min.x, max.x), 0, manifest.width),
    minY: clamp(Math.min(min.y, max.y), 0, manifest.height),
    maxX: clamp(Math.max(min.x, max.x), 0, manifest.width),
    maxY: clamp(Math.max(min.y, max.y), 0, manifest.height),
  };
}

export function getVisibleChunkKeys(
  manifest: MapWorkbenchManifestBounds,
  viewport: MapWorkbenchViewport,
  transform: MapWorkbenchTransform,
  paddingChunks = 1,
  chunkSizeOverride?: number,
): string[] {
  const bounds = tileBoundsForViewport(manifest, viewport, transform);
  if (bounds.minX >= bounds.maxX || bounds.minY >= bounds.maxY) {
    return [];
  }

  const chunkSize = Math.max(1, Math.floor(chunkSizeOverride ?? manifest.chunk_size));
  const chunkCountX = chunkSizeOverride == null
    ? manifest.chunk_count_x
    : Math.ceil(manifest.width / chunkSize);
  const chunkCountY = chunkSizeOverride == null
    ? manifest.chunk_count_y
    : Math.ceil(manifest.height / chunkSize);
  const minChunkX = clampInt(
    Math.floor(bounds.minX / chunkSize) - paddingChunks,
    0,
    Math.max(0, chunkCountX - 1),
  );
  const minChunkY = clampInt(
    Math.floor(bounds.minY / chunkSize) - paddingChunks,
    0,
    Math.max(0, chunkCountY - 1),
  );
  const maxChunkX = clampInt(
    Math.floor((bounds.maxX - 0.000001) / chunkSize) + paddingChunks,
    0,
    Math.max(0, chunkCountX - 1),
  );
  const maxChunkY = clampInt(
    Math.floor((bounds.maxY - 0.000001) / chunkSize) + paddingChunks,
    0,
    Math.max(0, chunkCountY - 1),
  );

  const keys: string[] = [];
  for (let y = minChunkY; y <= maxChunkY; y += 1) {
    for (let x = minChunkX; x <= maxChunkX; x += 1) {
      keys.push(`${x}:${y}`);
    }
  }
  return keys;
}

export function getPrioritizedVisibleChunkKeys(
  manifest: MapWorkbenchManifestBounds,
  viewport: MapWorkbenchViewport,
  transform: MapWorkbenchTransform,
  paddingChunks = 1,
  chunkSizeOverride?: number,
): string[] {
  const keys = getVisibleChunkKeys(
    manifest,
    viewport,
    transform,
    paddingChunks,
    chunkSizeOverride,
  );
  if (keys.length <= 1) {
    return keys;
  }

  const bounds = tileBoundsForViewport(manifest, viewport, transform);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const chunkSize = Math.max(1, Math.floor(chunkSizeOverride ?? manifest.chunk_size));

  return [...keys].sort((a, b) => {
    const aScore = detailChunkPriorityScore(a, chunkSize, bounds, centerX, centerY);
    const bScore = detailChunkPriorityScore(b, chunkSize, bounds, centerX, centerY);

    return aScore.visibility - bScore.visibility
      || aScore.distance - bScore.distance
      || aScore.y - bScore.y
      || aScore.x - bScore.x;
  });
}

function detailChunkPriorityScore(
  key: string,
  chunkSize: number,
  bounds: MapTileBounds,
  centerX: number,
  centerY: number,
): { visibility: number; distance: number; x: number; y: number } {
  const [rawX, rawY] = key.split(":");
  const x = Number(rawX);
  const y = Number(rawY);
  const chunkMinX = x * chunkSize;
  const chunkMinY = y * chunkSize;
  const chunkMaxX = chunkMinX + chunkSize;
  const chunkMaxY = chunkMinY + chunkSize;
  const intersectsViewport =
    chunkMinX < bounds.maxX
    && chunkMaxX > bounds.minX
    && chunkMinY < bounds.maxY
    && chunkMaxY > bounds.minY;
  const chunkCenterX = chunkMinX + chunkSize / 2;
  const chunkCenterY = chunkMinY + chunkSize / 2;

  return {
    visibility: intersectsViewport ? 0 : 1,
    distance: (chunkCenterX - centerX) ** 2 + (chunkCenterY - centerY) ** 2,
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
  };
}

export function zoomAt(
  transform: MapWorkbenchTransform,
  anchor: MapPoint,
  direction: number,
  minScale: number,
  maxScale: number,
): MapWorkbenchTransform {
  const tile = screenToTile(anchor.x, anchor.y, transform);
  const factor = Math.pow(1.2, direction);
  const nextScale = clamp(transform.scale * factor, minScale, maxScale);

  return {
    scale: nextScale,
    offsetX: anchor.x - tile.x * nextScale,
    offsetY: anchor.y - tile.y * nextScale,
  };
}

export function hitTestPlacementMarker(
  placements: MapPlacementRecord[],
  screen: MapPoint,
  transform: MapWorkbenchTransform,
  radiusPx: number,
): MapPlacementRecord | null {
  let best: MapPlacementRecord | null = null;
  let bestDistance = radiusPx;

  for (const placement of placements) {
    const point = tileToScreen(placement.world_x, placement.world_y, transform);
    const distance = Math.hypot(point.x - screen.x, point.y - screen.y);
    if (distance <= bestDistance) {
      best = placement;
      bestDistance = distance;
    }
  }

  return best;
}

export function selectPlacementMarkersForViewport({
  placements,
  transform,
  viewport,
  pinnedKeys = new Set<string>(),
  minSpacingPx = 24,
  maxMarkers = 500,
  viewportPaddingPx = 12,
}: {
  placements: MapPlacementRecord[];
  transform: MapWorkbenchTransform;
  viewport: MapWorkbenchViewport;
  pinnedKeys?: ReadonlySet<string>;
  minSpacingPx?: number;
  maxMarkers?: number;
  viewportPaddingPx?: number;
}): MapPlacementRecord[] {
  const spacing = Math.max(1, minSpacingPx);
  const maxOrdinaryMarkers = Math.max(0, maxMarkers);
  const pinned: MapPlacementRecord[] = [];
  const ordinary: Array<{ placement: MapPlacementRecord; cell: string }> = [];
  const occupiedCells = new Set<string>();

  for (const placement of placements) {
    const point = tileToScreen(placement.world_x, placement.world_y, transform);
    if (
      point.x < -viewportPaddingPx
      || point.y < -viewportPaddingPx
      || point.x > viewport.width + viewportPaddingPx
      || point.y > viewport.height + viewportPaddingPx
    ) {
      continue;
    }

    const cell = `${Math.floor(point.x / spacing)}:${Math.floor(point.y / spacing)}`;
    if (pinnedKeys.has(mapPlacementKey(placement.index))) {
      pinned.push(placement);
      occupiedCells.add(cell);
      continue;
    }
    ordinary.push({ placement, cell });
  }

  const acceptedOrdinary: MapPlacementRecord[] = [];
  for (const { placement, cell } of ordinary) {
    if (acceptedOrdinary.length >= maxOrdinaryMarkers || occupiedCells.has(cell)) {
      continue;
    }
    acceptedOrdinary.push(placement);
    occupiedCells.add(cell);
  }

  return [...acceptedOrdinary, ...pinned];
}

export function getPlacementMarkerVisual({
  selected,
  scale,
  overlayEnabled,
  minVisibleScale = 0.25,
}: {
  selected: boolean;
  scale: number;
  overlayEnabled: boolean;
  minVisibleScale?: number;
}): MapPlacementMarkerVisual | null {
  if (selected) {
    return {
      radiusPx: 7,
      fillAlpha: 0.14,
      strokeAlpha: 1,
    };
  }

  if (!overlayEnabled || scale < minVisibleScale) {
    return null;
  }

  return {
    radiusPx: 1.75,
    fillAlpha: 0.16,
    strokeAlpha: 0.42,
  };
}

export function shouldLoadDetailChunks(scale: number, minScale: number): boolean {
  return Number.isFinite(scale) && scale >= minScale;
}

export function shouldLoadDetailChunkWindow(
  scale: number,
  minScale: number,
  visibleChunkCount: number,
  maxVisibleChunks: number,
): boolean {
  const chunkCount = Math.max(0, Math.floor(visibleChunkCount));
  const chunkLimit = Math.max(0, Math.floor(maxVisibleChunks));
  return shouldLoadDetailChunks(scale, minScale)
    && chunkCount > 0
    && chunkCount <= chunkLimit;
}

export function pruneChunkRecord<T>(
  chunks: Record<string, T>,
  visibleKeys: readonly string[],
  maxChunks: number,
): Record<string, T> {
  const keys = Object.keys(chunks);
  const budget = Math.max(0, Math.floor(maxChunks));
  if (keys.length <= budget) {
    return chunks;
  }

  const keep = new Set<string>();
  for (const key of visibleKeys) {
    if (keep.size >= budget) {
      break;
    }
    if (Object.prototype.hasOwnProperty.call(chunks, key)) {
      keep.add(key);
    }
  }

  for (let index = keys.length - 1; index >= 0 && keep.size < budget; index -= 1) {
    keep.add(keys[index]);
  }

  if (keep.size === keys.length) {
    return chunks;
  }

  const next: Record<string, T> = {};
  for (const key of keys) {
    if (keep.has(key)) {
      next[key] = chunks[key];
    }
  }
  return next;
}

export function formatPendingEditSummary({
  tileCount,
  placementUpdateCount,
  placementAddCount,
  placementDeleteCount,
}: {
  tileCount: number;
  placementUpdateCount: number;
  placementAddCount: number;
  placementDeleteCount: number;
}): string {
  return [
    tileCount > 0 ? `${tileCount} tile${tileCount === 1 ? "" : "s"}` : null,
    placementUpdateCount > 0
      ? `${placementUpdateCount} placement update${placementUpdateCount === 1 ? "" : "s"}`
      : null,
    placementAddCount > 0
      ? `${placementAddCount} placement add${placementAddCount === 1 ? "" : "s"}`
      : null,
    placementDeleteCount > 0
      ? `${placementDeleteCount} placement delete${placementDeleteCount === 1 ? "" : "s"}`
      : null,
  ].filter(Boolean).join(", ");
}

export function createTileEditDraft(
  inspection: MapTileInspection,
  staged?: MapTilePatch | null,
): MapTileEditDraft {
  const btTileInfo = staged?.bt_tile_info ?? inspection.native.bt_tile_info;
  const dwTileInfo = staged?.dw_tile_info ?? inspection.native.dw_tile_info;

  return {
    textureLayers: unpackTileLayerDrafts(btTileInfo, dwTileInfo),
    sColor: staged?.s_color ?? inspection.native.s_color,
    cHeight: staged?.c_height ?? inspection.native.c_height,
    sRegion: staged?.s_region ?? inspection.native.s_region,
    btIsland: staged?.bt_island ?? inspection.native.bt_island,
    btBlock: staged?.bt_block ?? [
      inspection.native.bt_block[0] ?? 0,
      inspection.native.bt_block[1] ?? 0,
      inspection.native.bt_block[2] ?? 0,
      inspection.native.bt_block[3] ?? 0,
    ],
  };
}

export function unpackTileLayerDrafts(
  btTileInfo: number,
  dwTileInfo: number,
): [MapTileLayerDraft, MapTileLayerDraft, MapTileLayerDraft, MapTileLayerDraft] {
  return [
    {
      textureId: finiteOr(btTileInfo, 0),
      alpha: 15,
    },
    {
      textureId: Math.floor(finiteOr(dwTileInfo, 0) / 2 ** 26) % 2 ** 6,
      alpha: Math.floor(finiteOr(dwTileInfo, 0) / 2 ** 22) % 2 ** 4,
    },
    {
      textureId: Math.floor(finiteOr(dwTileInfo, 0) / 2 ** 16) % 2 ** 6,
      alpha: Math.floor(finiteOr(dwTileInfo, 0) / 2 ** 12) % 2 ** 4,
    },
    {
      textureId: Math.floor(finiteOr(dwTileInfo, 0) / 2 ** 6) % 2 ** 6,
      alpha: Math.floor(finiteOr(dwTileInfo, 0) / 2 ** 2) % 2 ** 4,
    },
  ];
}

export function packTileLayerDrafts(
  layers: [MapTileLayerDraft, MapTileLayerDraft, MapTileLayerDraft, MapTileLayerDraft],
): { btTileInfo: number; dwTileInfo: number } {
  const baseTexture = clampInt(layers[0].textureId, 0, 255);
  const layer1Texture = clampInt(layers[1].textureId, 0, 63);
  const layer1Alpha = clampInt(layers[1].alpha, 0, 15);
  const layer2Texture = clampInt(layers[2].textureId, 0, 63);
  const layer2Alpha = clampInt(layers[2].alpha, 0, 15);
  const layer3Texture = clampInt(layers[3].textureId, 0, 63);
  const layer3Alpha = clampInt(layers[3].alpha, 0, 15);

  return {
    btTileInfo: baseTexture,
    dwTileInfo: layer1Texture * 2 ** 26
      + layer1Alpha * 2 ** 22
      + layer2Texture * 2 ** 16
      + layer2Alpha * 2 ** 12
      + layer3Texture * 2 ** 6
      + layer3Alpha * 2 ** 2,
  };
}

export function createTilePatchFromDraft(
  inspection: MapTileInspection,
  draft: MapTileEditDraft,
): MapTilePatch | null {
  const { btTileInfo, dwTileInfo: packedDwTileInfo } = packTileLayerDrafts(draft.textureLayers);
  const dwTileInfo = packedDwTileInfo + positiveModulo(inspection.native.dw_tile_info, 4);
  const sColor = clampInt(draft.sColor, -32768, 32767);
  const cHeight = clampInt(draft.cHeight, -128, 127);
  const sRegion = clampInt(draft.sRegion, -32768, 32767);
  const btIsland = clampInt(draft.btIsland, 0, 255);
  const btBlock = draft.btBlock.map((value) => clampInt(value, 0, 255)) as [
    number,
    number,
    number,
    number,
  ];

  const patch: MapTilePatch = {
    tile_x: inspection.tile_x,
    tile_y: inspection.tile_y,
  };
  let dirty = false;

  if (btTileInfo !== inspection.native.bt_tile_info) {
    patch.bt_tile_info = btTileInfo;
    dirty = true;
  }
  if (dwTileInfo !== inspection.native.dw_tile_info) {
    patch.dw_tile_info = dwTileInfo;
    dirty = true;
  }
  if (sColor !== inspection.native.s_color) {
    patch.s_color = sColor;
    dirty = true;
  }
  if (cHeight !== inspection.native.c_height) {
    patch.c_height = cHeight;
    dirty = true;
  }
  if (sRegion !== inspection.native.s_region) {
    patch.s_region = sRegion;
    dirty = true;
  }
  if (btIsland !== inspection.native.bt_island) {
    patch.bt_island = btIsland;
    dirty = true;
  }
  if (!arraysEqual4(btBlock, inspection.native.bt_block)) {
    patch.bt_block = btBlock;
    dirty = true;
  }

  return dirty ? patch : null;
}

export function createTileBrushPatches(
  sourcePatch: MapTilePatch | null,
  radius: number,
  bounds: MapFitBounds,
): MapTilePatch[] {
  if (!sourcePatch) {
    return [];
  }

  const brushRadius = clampInt(radius, 0, 64);
  const minX = clampInt(sourcePatch.tile_x - brushRadius, 0, Math.max(0, bounds.width - 1));
  const maxX = clampInt(sourcePatch.tile_x + brushRadius, 0, Math.max(0, bounds.width - 1));
  const minY = clampInt(sourcePatch.tile_y - brushRadius, 0, Math.max(0, bounds.height - 1));
  const maxY = clampInt(sourcePatch.tile_y + brushRadius, 0, Math.max(0, bounds.height - 1));
  const patches: MapTilePatch[] = [];

  for (let tileY = minY; tileY <= maxY; tileY += 1) {
    for (let tileX = minX; tileX <= maxX; tileX += 1) {
      const patch: MapTilePatch = {
        ...sourcePatch,
        tile_x: tileX,
        tile_y: tileY,
      };
      if (sourcePatch.bt_block) {
        patch.bt_block = [...sourcePatch.bt_block];
      } else if (sourcePatch.bt_block === null) {
        patch.bt_block = null;
      }
      patches.push(patch);
    }
  }

  return patches;
}

export function isBtBlockBlocked(value: number): boolean {
  return (clampInt(value, 0, 255) & 0x80) !== 0;
}

export function setBtBlockBlocked(value: number, blocked: boolean): number {
  const byte = clampInt(value, 0, 255);
  return blocked ? byte | 0x80 : byte & 0x7f;
}

export function decodeBtBlockObjectHeight(value: number): number {
  const byte = clampInt(value, 0, 255);
  const magnitude = byte & 0x3f;
  const height = magnitude * 0.05;
  return (byte & 0x40) !== 0 ? -height : height;
}

export function setBtBlockObjectHeight(value: number, height: number): number {
  const byte = clampInt(value, 0, 255);
  const collisionBit = byte & 0x80;
  const clampedHeight = clamp(Number.isFinite(height) ? height : 0, -3.15, 3.15);
  const magnitude = clampInt(Math.round(Math.abs(clampedHeight) / 0.05), 0, 63);
  const signBit = clampedHeight < 0 && magnitude > 0 ? 0x40 : 0;
  return collisionBit | signBit | magnitude;
}

export function tilePatchLayerPreviewRects(
  patch: MapTilePatch,
  layer: MapWorkbenchLayer,
): MapTilePatchLayerPreviewRect[] {
  switch (layer) {
    case "terrain_color":
      return patch.s_color == null
        ? []
        : [wholeTilePreview(patch, tileColorCss(patch.s_color))];
    case "height":
      return patch.c_height == null
        ? []
        : [wholeTilePreview(patch, heightPreviewCss(patch.c_height))];
    case "collision":
      return patch.bt_block == null
        ? []
        : subtilePreviewRects(patch, patch.bt_block, collisionPreviewCss);
    case "object_height":
      return patch.bt_block == null
        ? []
        : subtilePreviewRects(patch, patch.bt_block, objectHeightPreviewCss);
    case "region":
      return patch.s_region == null
        ? []
        : [wholeTilePreview(patch, palettePreviewCss(patch.s_region, 0.5))];
    case "island":
      return patch.bt_island == null
        ? []
        : [wholeTilePreview(patch, palettePreviewCss(patch.bt_island, 0.5))];
    case "texture_base":
    case "texture_raw":
      return patch.bt_tile_info == null
        ? []
        : [wholeTilePreview(patch, palettePreviewCss(patch.bt_tile_info, 0.46))];
    case "texture_layers":
      if (patch.bt_tile_info == null && patch.dw_tile_info == null) {
        return [];
      }
      return unpackTileLayerDrafts(patch.bt_tile_info ?? 0, patch.dw_tile_info ?? 0)
        .map((textureLayer, index) => ({
          x: patch.tile_x + index * 0.25,
          y: patch.tile_y,
          width: 0.25,
          height: 1,
          fillStyle: palettePreviewCss(
            textureLayer.textureId,
            0.18 + Math.min(0.5, textureLayer.alpha / 30),
          ),
        }));
    default:
      return [];
  }
}

export function mapTileKey(tileX: number, tileY: number): string {
  return `${tileX}:${tileY}`;
}

export function createPlacementEditDraft(
  placement: MapPlacementRecord,
  staged?: MapPlacementPatch | null,
): MapPlacementEditDraft {
  return {
    objType: staged?.obj_type ?? placement.obj_type,
    objId: staged?.obj_id ?? placement.obj_id,
    worldX: staged?.world_x ?? placement.world_x,
    worldY: staged?.world_y ?? placement.world_y,
    worldZ: staged?.world_z ?? placement.world_z,
    yawAngle: staged?.yaw_angle ?? placement.yaw_angle,
    scale: staged?.scale ?? placement.scale,
  };
}

export function createPlacementPatchFromDraft(
  placement: MapPlacementRecord,
  draft: MapPlacementEditDraft,
): MapPlacementPatch | null {
  const objType = clampInt(draft.objType, 0, 1);
  const objId = clampInt(draft.objId, 1, 0x3fff);
  const worldX = finiteOr(draft.worldX, placement.world_x);
  const worldY = finiteOr(draft.worldY, placement.world_y);
  const worldZ = finiteOr(draft.worldZ, placement.world_z);
  const yawAngle = clampInt(draft.yawAngle, -32768, 32767);
  const scale = clampInt(draft.scale, -32768, 32767);

  const patch: MapPlacementPatch = {
    index: placement.index,
  };
  let dirty = false;

  if (objType !== placement.obj_type) {
    patch.obj_type = objType;
    dirty = true;
  }
  if (objId !== placement.obj_id) {
    patch.obj_id = objId;
    dirty = true;
  }
  if (worldX !== placement.world_x) {
    patch.world_x = worldX;
    dirty = true;
  }
  if (worldY !== placement.world_y) {
    patch.world_y = worldY;
    dirty = true;
  }
  if (worldZ !== placement.world_z) {
    patch.world_z = worldZ;
    dirty = true;
  }
  if (yawAngle !== placement.yaw_angle) {
    patch.yaw_angle = yawAngle;
    dirty = true;
  }
  if (scale !== placement.scale) {
    patch.scale = scale;
    dirty = true;
  }

  return dirty ? patch : null;
}

export function applyPlacementPatch(
  placement: MapPlacementRecord,
  patch?: MapPlacementPatch | null,
): MapPlacementRecord {
  if (!patch) {
    return placement;
  }

  const objType = patch.obj_type ?? placement.obj_type;
  const objId = patch.obj_id ?? placement.obj_id;
  const identityChanged = objType !== placement.obj_type || objId !== placement.obj_id;

  return {
    ...placement,
    obj_type: objType,
    obj_id: objId,
    kind: placementKindFromType(objType),
    world_x: patch.world_x ?? placement.world_x,
    world_y: patch.world_y ?? placement.world_y,
    world_z: patch.world_z ?? placement.world_z,
    yaw_angle: patch.yaw_angle ?? placement.yaw_angle,
    scale: patch.scale ?? placement.scale,
    display_name: identityChanged ? null : placement.display_name,
    asset_name: identityChanged ? null : placement.asset_name,
    attach_effect_id: identityChanged ? null : placement.attach_effect_id,
  };
}

export function createPlacementAddDraft(point: MapPoint): MapPlacementAddDraft {
  return {
    objType: 0,
    objId: 1,
    worldX: Math.floor(finiteOr(point.x, 0)) + 0.5,
    worldY: Math.floor(finiteOr(point.y, 0)) + 0.5,
    worldZ: 0,
    yawAngle: 0,
    scale: 100,
  };
}

export function createPlacementAddEditFromDraft(
  draft: MapPlacementAddDraft,
): MapPlacementAddEdit {
  return {
    op: "add",
    obj_type: clampInt(draft.objType, 0, 1),
    obj_id: clampInt(draft.objId, 1, 0x3fff),
    world_x: finiteOr(draft.worldX, 0),
    world_y: finiteOr(draft.worldY, 0),
    world_z: finiteOr(draft.worldZ, 0),
    yaw_angle: clampInt(draft.yawAngle, -32768, 32767),
    scale: clampInt(draft.scale, -32768, 32767),
  };
}

export function createTemporaryPlacementFromAddEdit(
  edit: MapPlacementAddEdit,
  index: number,
): MapPlacementRecord {
  return {
    index,
    obj_type: edit.obj_type,
    obj_id: edit.obj_id,
    kind: placementKindFromType(edit.obj_type),
    world_x: edit.world_x,
    world_y: edit.world_y,
    world_z: edit.world_z,
    yaw_angle: edit.yaw_angle,
    scale: edit.scale,
    display_name: null,
    asset_name: null,
    attach_effect_id: null,
    distance: null,
  };
}

export function includeStagedPlacementSources(
  placements: MapPlacementRecord[],
  stagedSources: Record<string, MapPlacementRecord>,
): MapPlacementRecord[] {
  const seen = new Set(placements.map((placement) => placement.index));
  const next = [...placements];

  for (const placement of Object.values(stagedSources)) {
    if (seen.has(placement.index)) {
      continue;
    }
    seen.add(placement.index);
    next.push(placement);
  }

  return next;
}

export function mapPlacementKey(index: number): string {
  return String(index);
}

function wholeTilePreview(
  patch: MapTilePatch,
  fillStyle: string,
): MapTilePatchLayerPreviewRect {
  return {
    x: patch.tile_x,
    y: patch.tile_y,
    width: 1,
    height: 1,
    fillStyle,
  };
}

function subtilePreviewRects(
  patch: MapTilePatch,
  values: readonly number[],
  fillStyleForValue: (value: number) => string,
): MapTilePatchLayerPreviewRect[] {
  return [0, 1, 2, 3].map((index) => ({
    x: patch.tile_x + (index % 2 === 0 ? 0 : 0.5),
    y: patch.tile_y + (index < 2 ? 0 : 0.5),
    width: 0.5,
    height: 0.5,
    fillStyle: fillStyleForValue(values[index] ?? 0),
  }));
}

function collisionPreviewCss(value: number): string {
  return isBtBlockBlocked(value)
    ? "rgba(239,68,68,0.72)"
    : "rgba(34,197,94,0.28)";
}

function objectHeightPreviewCss(value: number): string {
  const height = decodeBtBlockObjectHeight(value);
  if (height === 0) {
    return "rgba(148,163,184,0.32)";
  }

  const alpha = (0.32 + Math.min(0.56, Math.abs(height) / 3.15 * 0.56)).toFixed(2);
  return height < 0
    ? `rgba(59,130,246,${alpha})`
    : `rgba(239,68,68,${alpha})`;
}

function heightPreviewCss(value: number): string {
  const normalized = clampInt(value, -128, 127) + 128;
  return `rgb(${normalized}, ${normalized}, ${normalized})`;
}

function tileColorCss(value: number): string {
  const raw = positiveModulo(value, 65536);
  const r5 = (raw >> 11) & 0x1f;
  const g6 = (raw >> 5) & 0x3f;
  const b5 = raw & 0x1f;
  const r = Math.round((r5 * 255) / 31);
  const g = Math.round((g6 * 255) / 63);
  const b = Math.round((b5 * 255) / 31);
  return `rgb(${r}, ${g}, ${b})`;
}

function palettePreviewCss(value: number, alpha: number): string {
  const hue = positiveModulo(value * 47, 360);
  const opacity = clamp(alpha, 0.1, 0.8).toFixed(2);
  return `hsla(${hue}, 70%, 45%, ${opacity})`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeFitPaddingRatio(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value)
    ? clamp(value, 0.01, 1)
    : 0.92;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.trunc(clamp(value, min, max));
}

function placementKindFromType(objType: number): string {
  return objType === 1 ? "effect" : "building";
}

function positiveModulo(value: number, divisor: number): number {
  return ((Math.trunc(finiteOr(value, 0)) % divisor) + divisor) % divisor;
}

function arraysEqual4(left: readonly number[], right: readonly number[]): boolean {
  return left.length === 4
    && right.length >= 4
    && left[0] === right[0]
    && left[1] === right[1]
    && left[2] === right[2]
    && left[3] === right[3];
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}
