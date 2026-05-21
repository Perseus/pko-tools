import {
  applyMapEditClientPackage as applyMapEditClientPackageCommand,
  exportMapEdits as exportMapEditsCommand,
  getMapChunk,
  getMapOverview,
  getMapTileTexturePreview,
  getMapWorkbenchManifest,
  getSceneEffectList,
  getTerrainTextureCatalog,
  getTerrainTexturePreview,
  inspectMapTile,
  queryMapPlacements,
  queryMapPlacementsInBounds,
  queryMapRboRecordsInBounds,
  restoreMapEditClientBackup as restoreMapEditClientBackupCommand,
} from "@/commands/map";
import { getBuildingList } from "@/commands/buildings";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { toast } from "@/hooks/use-toast";
import { LatestOnly } from "@/lib/latestOnly";
import { recordFrame } from "@/features/perf/metrics";
import { currentProjectAtom } from "@/store/project";
import { mapStagedEditStateAtom, selectedMapAtom } from "@/store/map";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import type { BuildingEntry } from "@/types/buildings";
import type {
  MapChunkPayload,
  MapEditClientApplyResult,
  MapEditClientRestoreResult,
  MapEditExportResult,
  MapEditSourceGuard,
  MapPlacementAddEdit,
  MapPlacementDeleteEdit,
  MapPlacementEdit,
  MapOverviewLayer,
  MapPlacementPatch,
  MapPlacementRecord,
  MapRboRecord,
  MapRboSummary,
  MapSelectedTile,
  MapSourceFileInfo,
  MapTileInspection,
  MapTilePatch,
  MapTileTexturePreview,
  MapTerrainTextureStatus,
  MapWorkbenchLayer,
  MapWorkbenchManifest,
  SceneEffectEntry,
  TerrainTextureEntry,
} from "@/types/map";
import { useAtomValue, useSetAtom } from "jotai";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Crosshair,
  Check,
  ClipboardPaste,
  Copy,
  Download,
  FolderOpen,
  Grid3X3,
  Hand,
  Layers,
  LocateFixed,
  Lock,
  Map as MapIcon,
  MapPin,
  MousePointer2,
  Paintbrush,
  Plus,
  Redo2,
  RefreshCw,
  ScanSearch,
  Trash2,
  Undo2,
  Unlock,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  applyPlacementPatch,
  canvasDevicePixelRatio,
  centerTransformOnTile,
  createPlacementAddDraft,
  createPlacementAddEditFromDraft,
  createPlacementEditDraft,
  createPlacementPatchFromDraft,
  createTileBrushPatches,
  createTemporaryPlacementFromAddEdit,
  createTileEditDraft,
  createTilePatchFromDraft,
  decodeBtBlockObjectHeight,
  fitMapTransform,
  fitTileBoundsTransform,
  fitMapToNavigator,
  formatPendingEditSummary,
  getPlacementMarkerVisual,
  getPrioritizedVisibleChunkKeys,
  getVisibleChunkKeys,
  hitTestPlacementMarker,
  includeStagedPlacementSources,
  isBtBlockBlocked,
  mapPlacementKey,
  mapTileKey,
  navigatorPointToTile,
  navigatorViewportRect,
  pruneChunkRecord,
  screenToTile,
  selectPlacementMarkersForViewport,
  setBtBlockObjectHeight,
  setBtBlockBlocked,
  shouldLoadDetailChunks,
  tilePatchLayerPreviewRects,
  tileBoundsForViewport,
  tileToScreen,
  zoomAt,
  type MapPlacementAddDraft,
  type MapPlacementEditDraft,
  type MapTileEditDraft,
  type MapPoint,
  type MapPlacementOverlayFilter,
  type MapTileBounds,
  type MapWorkbenchTransform,
  type MapWorkbenchViewport,
} from "./mapWorkbenchView";
import MapPlacementBuildingPreview from "./MapPlacementBuildingPreview";

const MIN_SCALE = 0.02;
const MAX_SCALE = 64;
const NATIVE_TEXTURE_DETAIL_SCALE = 64;
const DETAIL_CHUNK_MIN_SCALE = 0.25;
const DETAIL_CHUNK_LOAD_DELAY_MS = 80;
const DRAG_DETAIL_CHUNK_QUEUE_INTERVAL_MS = 120;
const DETAIL_CHUNK_LOAD_CONCURRENCY = 4;
const MAX_STALE_DETAIL_CHUNK_LOADS = DETAIL_CHUNK_LOAD_CONCURRENCY;
const MAX_DETAIL_CHUNK_CACHE_ENTRIES = 96;
const MAX_TEXTURE_DETAIL_CACHE_BASE_SAMPLES_PER_TILE = 8;
const RASTER_OVERVIEW_IMAGE_CACHE_HEADROOM = 8;
const MAX_CANVAS_FRAME_INTERVAL_MS = 1000;
const PLACEMENT_QUERY_LIMIT = 1500;
const RBO_RECORD_QUERY_LIMIT = 1000;
const PLACEMENT_MARKER_MIN_SPACING_PX = 24;
const PLACEMENT_MARKER_LIMIT = 500;
const KEYBOARD_PAN_STEP_PX = 64;
const TILE_BRUSH_MAX_RADIUS = 16;
const STAGED_EDIT_HISTORY_LIMIT = 50;
const TILE_INSPECTION_CACHE_LIMIT = 128;
const HOVER_TILE_PREFETCH_MIN_SCALE = 5;
const HOVER_TILE_PREFETCH_DELAY_MS = 80;
const CENTER_TILE_PREFETCH_DELAY_MS = 80;
const NAVIGATOR_WIDTH = 176;
const NAVIGATOR_HEIGHT = 128;
const OVERLAY_OPACITY_MIN = 25;
const OVERLAY_OPACITY_MAX = 100;
const OVERLAY_OPACITY_STEP = 5;
const SUBTILE_LABELS = ["Northwest", "Northeast", "Southwest", "Southeast"] as const;
const REGION_TERRAIN_MASK = 0x0001 | 0x0008;
const REGION_TERRAIN_OPTIONS = [
  { label: "Sea", value: 0 },
  { label: "Land", value: 0x0001 },
  { label: "Bridge", value: 0x0008 },
] as const;
const REGION_FLAG_OPTIONS = [
  { label: "Safe zone", bit: 0x0002 },
  { label: "PK zone", bit: 0x0004 },
  { label: "No monsters", bit: 0x0010 },
  { label: "Mining", bit: 0x0020 },
  { label: "PvP invite", bit: 0x0040 },
] as const;

type PointerCaptureElement = Element & {
  setPointerCapture?: (pointerId: number) => void;
  releasePointerCapture?: (pointerId: number) => void;
};

function safeSetPointerCapture(target: PointerCaptureElement, pointerId: number) {
  try {
    target.setPointerCapture?.(pointerId);
  } catch {
    // Some automation/webview contexts can synthesize pointer events without capture support.
  }
}

function safeReleasePointerCapture(target: PointerCaptureElement, pointerId: number) {
  try {
    target.releasePointerCapture?.(pointerId);
  } catch {
    // Release may fail if the platform never captured this synthetic pointer.
  }
}

function formatVisibleRboSummary(shown: number, totalInView: number): string {
  const safeTotalInView = Math.max(shown, totalInView);
  if (safeTotalInView > shown) {
    return `RBO ${shown}/${safeTotalInView} in view`;
  }
  return `RBO ${shown} in view`;
}

type PlacementMarkerDensity = "quiet" | "balanced" | "dense";

const PLACEMENT_MARKER_DENSITIES: Record<
  PlacementMarkerDensity,
  { label: string; minSpacingPx: number; maxMarkers: number }
> = {
  quiet: { label: "Fewer", minSpacingPx: 40, maxMarkers: 120 },
  balanced: {
    label: "Normal",
    minSpacingPx: PLACEMENT_MARKER_MIN_SPACING_PX,
    maxMarkers: PLACEMENT_MARKER_LIMIT,
  },
  dense: { label: "More", minSpacingPx: 10, maxMarkers: PLACEMENT_QUERY_LIMIT },
};
const PLACEMENT_MARKER_DENSITY_OPTIONS = Object.entries(
  PLACEMENT_MARKER_DENSITIES,
) as Array<[PlacementMarkerDensity, { label: string; minSpacingPx: number; maxMarkers: number }]>;

const LAYERS: Array<{ value: MapWorkbenchLayer; label: string }> = [
  { value: "texture_base", label: "Client texture" },
  { value: "texture_raw", label: "Raw texture" },
  { value: "terrain_color", label: "Vertex tint" },
  { value: "texture_layers", label: "Texture layers" },
  { value: "height", label: "Height" },
  { value: "collision", label: "Collision" },
  { value: "object_height", label: "Object height" },
  { value: "region", label: "Region" },
  { value: "island", label: "Island" },
];

const LAYER_LEGENDS: Record<MapWorkbenchLayer, { label: string; hint: string }> = {
  terrain_color: { label: "Vertex tint", hint: "Not texture: RGB565 lighting" },
  texture_base: { label: "Client texture", hint: "Real terrain + vertex/sea tint" },
  texture_raw: { label: "Raw texture", hint: "Real terrain, no tint" },
  texture_layers: { label: "Texture layers", hint: "Texture IDs and alpha masks" },
  height: { label: "Height", hint: "Dark low, light high" },
  collision: { label: "Collision", hint: "Red = blocked" },
  object_height: { label: "Object height", hint: "Blue low, red high" },
  region: { label: "Region", hint: "Region id bands" },
  island: { label: "Island", hint: "Island id bands" },
  placements: { label: "Placements", hint: "Object overlay" },
};

const terrainTextureStatusLabel = (status: MapTerrainTextureStatus): string => {
  if (!status.available) {
    return "Textures unavailable";
  }
  if (status.missing_count > 0 || status.loaded_count < status.referenced_count) {
    return "Texture set incomplete";
  }
  if (!status.alpha_atlas_available) {
    return "Blend masks unavailable";
  }
  return "Texture warning";
};

function isTextureDetailLayer(layer: MapWorkbenchLayer): boolean {
  return layer === "texture_base" || layer === "texture_raw";
}

const COMPOSITE_OVERLAY_LAYERS: Array<{
  value: MapWorkbenchLayer;
  label: string;
  opacity: number;
}> = [
  { value: "collision", label: "Collision", opacity: 0.5 },
  { value: "height", label: "Height", opacity: 0.42 },
  { value: "object_height", label: "Object height", opacity: 0.42 },
  { value: "region", label: "Region", opacity: 0.38 },
  { value: "island", label: "Island", opacity: 0.38 },
];

function preferredDefaultLayer(availableLayers: MapWorkbenchLayer[]): MapWorkbenchLayer {
  if (availableLayers.includes("texture_base")) {
    return "texture_base";
  }
  if (availableLayers.includes("terrain_color")) {
    return "terrain_color";
  }
  return availableLayers[0] ?? "terrain_color";
}

type ToolbarIconButtonProps = Omit<ButtonProps, "children"> & {
  label: string;
  tooltip?: string;
  children: ReactNode;
};

function ToolbarIconButton({
  label,
  tooltip = label,
  children,
  className,
  size = "sm",
  variant = "ghost",
  title,
  ...buttonProps
}: ToolbarIconButtonProps) {
  const ariaLabel = buttonProps["aria-label"] ?? label;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          {...buttonProps}
          size={size}
          variant={variant}
          title={title ?? tooltip}
          aria-label={ariaLabel}
          className={["h-7 w-7 shrink-0 gap-0 px-0", className].filter(Boolean).join(" ")}
        >
          {children}
          <span className="sr-only">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

function PlacementNudgeControls({
  labelPrefix,
  onNudge,
}: {
  labelPrefix: string;
  onNudge: (dx: number, dy: number) => void;
}) {
  const buttonClass = "h-7 w-7 p-0";

  return (
    <div className="mt-2 rounded border bg-muted/20 p-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="text-[11px] uppercase text-muted-foreground">Nudge</div>
        <div className="font-mono text-[10px] text-muted-foreground">1 tile</div>
      </div>
      <div className="mx-auto grid w-[5.75rem] grid-cols-3 gap-1">
        <div />
        <Button
          type="button"
          size="icon"
          variant="outline"
          className={buttonClass}
          title={`Move ${labelPrefix} north`}
          aria-label={`Move ${labelPrefix} north`}
          onClick={() => onNudge(0, -1)}
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </Button>
        <div />
        <Button
          type="button"
          size="icon"
          variant="outline"
          className={buttonClass}
          title={`Move ${labelPrefix} west`}
          aria-label={`Move ${labelPrefix} west`}
          onClick={() => onNudge(-1, 0)}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <div className="flex items-center justify-center font-mono text-[10px] text-muted-foreground">
          xy
        </div>
        <Button
          type="button"
          size="icon"
          variant="outline"
          className={buttonClass}
          title={`Move ${labelPrefix} east`}
          aria-label={`Move ${labelPrefix} east`}
          onClick={() => onNudge(1, 0)}
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
        <div />
        <Button
          type="button"
          size="icon"
          variant="outline"
          className={buttonClass}
          title={`Move ${labelPrefix} south`}
          aria-label={`Move ${labelPrefix} south`}
          onClick={() => onNudge(0, 1)}
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </Button>
        <div />
      </div>
    </div>
  );
}

function TileNeighborControls({
  tileX,
  tileY,
  mapWidth,
  mapHeight,
  onInspect,
}: {
  tileX: number;
  tileY: number;
  mapWidth: number;
  mapHeight: number;
  onInspect: (dx: number, dy: number) => void;
}) {
  const buttonClass = "h-7 w-7 p-0";
  const canInspectNorth = tileY > 0;
  const canInspectWest = tileX > 0;
  const canInspectEast = tileX < mapWidth - 1;
  const canInspectSouth = tileY < mapHeight - 1;

  return (
    <div className="mt-2 rounded border bg-muted/20 p-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="text-[11px] uppercase text-muted-foreground">Adjacent</div>
        <div className="font-mono text-[10px] text-muted-foreground">
          x {tileX} y {tileY}
        </div>
      </div>
      <div className="mx-auto grid w-[5.75rem] grid-cols-3 gap-1">
        <div />
        <Button
          type="button"
          size="icon"
          variant="outline"
          className={buttonClass}
          disabled={!canInspectNorth}
          title={`Inspect tile ${tileX}, ${tileY - 1}`}
          aria-label="Inspect north tile"
          onClick={() => onInspect(0, -1)}
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </Button>
        <div />
        <Button
          type="button"
          size="icon"
          variant="outline"
          className={buttonClass}
          disabled={!canInspectWest}
          title={`Inspect tile ${tileX - 1}, ${tileY}`}
          aria-label="Inspect west tile"
          onClick={() => onInspect(-1, 0)}
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </Button>
        <div className="flex items-center justify-center font-mono text-[10px] text-muted-foreground">
          xy
        </div>
        <Button
          type="button"
          size="icon"
          variant="outline"
          className={buttonClass}
          disabled={!canInspectEast}
          title={`Inspect tile ${tileX + 1}, ${tileY}`}
          aria-label="Inspect east tile"
          onClick={() => onInspect(1, 0)}
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
        <div />
        <Button
          type="button"
          size="icon"
          variant="outline"
          className={buttonClass}
          disabled={!canInspectSouth}
          title={`Inspect tile ${tileX}, ${tileY + 1}`}
          aria-label="Inspect south tile"
          onClick={() => onInspect(0, 1)}
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </Button>
        <div />
      </div>
    </div>
  );
}

function cloneTileEditDraft(draft: MapTileEditDraft): MapTileEditDraft {
  return {
    ...draft,
    textureLayers: draft.textureLayers.map((layer) => ({ ...layer })) as MapTileEditDraft["textureLayers"],
    btBlock: [...draft.btBlock] as MapTileEditDraft["btBlock"],
  };
}

type CachedImage = {
  image: HTMLImageElement;
  ready: boolean;
};

type QueuedChunkLoad = {
  key: string;
  recordKey: string;
  chunkSourceKey: string;
  generation: number;
  projectId: string;
  mapName: string;
  layer: MapWorkbenchLayer;
  zoomBucket: number;
  chunkSize: number;
  cacheLimit: number;
  sourceGuard: MapSourceFileInfo;
};

type ActiveChunkLoad = {
  request: QueuedChunkLoad;
  token: number;
};

type TileInspectionPrefetchRequest = {
  cacheKey: string;
  sourceKey: string;
  projectId: string;
  mapName: string;
  tileX: number;
  tileY: number;
  sourceGuard: MapSourceFileInfo;
};

type DetailChunkQueueContext = {
  chunkSourceKey: string;
  projectId: string;
  mapName: string;
  layers: MapWorkbenchLayer[];
  zoomBucket: number;
  chunkSize: number;
  sourceGuard: MapSourceFileInfo;
};

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  startOffsetX: number;
  startOffsetY: number;
  moved: boolean;
  painting?: boolean;
  panOnly?: boolean;
  lastPaintTile?: MapPoint | null;
  placementDrag?: {
    index: number;
    startWorldX: number;
    startWorldY: number;
    startTileX: number;
    startTileY: number;
    stagedAddHistoryRecorded?: boolean;
  };
};

type CanvasInteractionMode = "select" | "pan" | "paint";

type StagedEditSnapshot = {
  pendingPatches: Record<string, MapTilePatch>;
  pendingPlacementPatches: Record<string, MapPlacementPatch>;
  pendingPlacementSources: Record<string, MapPlacementRecord>;
  pendingPlacementAdds: Record<string, MapPlacementAddEdit>;
  pendingPlacementDeletes: Record<string, MapPlacementDeleteEdit>;
};

type StagedEditReviewItem = {
  key: string;
  label: string;
  ariaLabel: string;
  onActivate: () => void;
  removeAriaLabel: string;
  onRemove: () => void;
};

type MapWorkbenchAutomationState = {
  projectId: string | null;
  mapName: string | null;
  manifest: {
    name: string;
    width: number;
    height: number;
    chunkSize: number;
  } | null;
  layer: MapWorkbenchLayer;
  overlayLayers: MapWorkbenchLayer[];
  activeRasterLayers: MapWorkbenchLayer[];
  overlayOpacity: number;
  showGrid: boolean;
  showPlacements: boolean;
  placementMarkerDensity: PlacementMarkerDensity;
  interactionMode: CanvasInteractionMode;
  tilePaintMode: boolean;
  tileBrushRadius: number;
  viewport: MapWorkbenchViewport;
  viewportBounds: MapTileBounds | null;
  transform: MapWorkbenchTransform;
  selectedTile: MapPoint | null;
  selectedPlacement: MapPlacementRecord | null;
  visiblePlacementCount: number;
  visibleRboRecordCount: number;
  visibleRboRecordTotal: number;
  pendingEdits: {
    tiles: number;
    placementUpdates: number;
    placementAdds: number;
    placementDeletes: number;
    total: number;
  };
  loading: {
    manifest: boolean;
    inspection: boolean;
    chunks: number;
    exporting: boolean;
  };
  detailChunks: {
    enabled: boolean;
    scaleEnabled: boolean;
    windowSuppressed: boolean;
    visibleCandidates: number;
    maxVisible: number;
  };
  cache: {
    detailChunks: number;
    renderImages: number;
    maxDetailChunks: number;
    maxRenderImages: number;
  };
};

type MapCanvasMetrics = {
  rect: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
  bitmap: {
    width: number;
    height: number;
  };
  pixelRatio: {
    x: number;
    y: number;
  };
};

type MapCanvasPixel = {
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
  a: number;
};

type MapScreenRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

type MapCanvasDiagnosticSample = {
  name: string;
  screenX: number;
  screenY: number;
  pixel: MapCanvasPixel | null;
};

type MapCanvasDiagnostics = {
  canvas: MapCanvasMetrics;
  unobscuredRect: MapScreenRect;
  mapRect: (MapScreenRect & {
    visibleWidth: number;
    visibleHeight: number;
    intersectsViewport: boolean;
  }) | null;
  viewportBounds: MapTileBounds | null;
  transform: MapWorkbenchTransform;
  centerTile: MapPoint;
  centerPixel: MapCanvasPixel | null;
  samples: MapCanvasDiagnosticSample[];
  sampledOpaquePixels: number;
  sampledDistinctColors: number;
  hasOpaqueCanvasSamples: boolean;
};

type MapTileScreenRect = {
  tileX: number;
  tileY: number;
  left: number;
  top: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
};

type MapPlacementScreenPoint = {
  index: number;
  worldX: number;
  worldY: number;
  x: number;
  y: number;
};

type MapPlacementFocusRequest = {
  placement: MapPlacementRecord;
  nonce: number;
};

type MapWorkbenchAutomationApi = {
  inspectTile: (tileX: number, tileY: number) => Promise<boolean>;
  selectTile: (
    tileX: number,
    tileY: number,
    options?: { scale?: number },
  ) => Promise<boolean>;
  centerOnTile: (tileX: number, tileY: number, options?: { scale?: number }) => boolean;
  frameTileBounds: (
    bounds: unknown,
    options?: { paddingRatio?: number } | null,
  ) => boolean;
  centerOnPlacement: (index: number, options?: { scale?: number }) => boolean;
  selectPlacement: (index: number, options?: { scale?: number }) => boolean;
  fitMap: () => boolean;
  zoomAtCenter: (direction: number) => boolean;
  getViewportBounds: () => MapTileBounds | null;
  getViewport: () => MapWorkbenchViewport;
  getCanvasRect: () => {
    left: number;
    top: number;
    width: number;
    height: number;
  } | null;
  getCanvasMetrics: () => MapCanvasMetrics | null;
  getCanvasDiagnostics: () => MapCanvasDiagnostics | null;
  sampleCanvasPixel: (screenX: number, screenY: number) => MapCanvasPixel | null;
  sampleTilePixel: (tileX: number, tileY: number) => MapCanvasPixel | null;
  getTransform: () => MapWorkbenchTransform;
  getSelectedTile: () => MapPoint | null;
  getSelectedPlacement: () => MapPlacementRecord | null;
  getVisiblePlacements: () => MapPlacementRecord[];
  getVisibleRboRecords: () => MapRboRecord[];
  getState: () => MapWorkbenchAutomationState;
  setLayer: (layer: string) => boolean;
  setLayerOverlay: (layer: string, enabled: boolean) => boolean;
  setOverlayOpacity: (opacity: number) => boolean;
  setShowGrid: (enabled: boolean) => boolean;
  setShowPlacements: (enabled: boolean) => boolean;
  setTilePaintMode: (enabled: boolean) => boolean;
  stageTileBrushAt: (tileX: number, tileY: number) => boolean;
  hoverTile: (tileX: number, tileY: number) => boolean;
  clickTile: (tileX: number, tileY: number) => boolean;
  wheelAtTile: (tileX: number, tileY: number, deltaY: number) => boolean;
  waitForIdle: (timeoutMs?: number) => Promise<boolean>;
  screenToTile: (screenX: number, screenY: number) => MapPoint;
  tileToScreen: (tileX: number, tileY: number) => MapPoint;
  getTileScreenRect: (tileX: number, tileY: number) => MapTileScreenRect | null;
  getPlacementScreenPoint: (index: number) => MapPlacementScreenPoint | null;
};

declare global {
  interface Window {
    __PKO_TOOLS_MAP_WORKBENCH__?: MapWorkbenchAutomationApi;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function finiteNumberFromRecord(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function roundPlacementCoordinate(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatPlacementDisplayName(placement: MapPlacementRecord): string {
  return placement.display_name
    ?? placement.asset_name
    ?? `${placement.kind} ${placement.obj_id}`;
}

function parseAutomationTileBounds(value: unknown): MapTileBounds | null {
  if (!isRecord(value)) {
    return null;
  }

  const minX = finiteNumberFromRecord(value, "minX");
  const minY = finiteNumberFromRecord(value, "minY");
  const maxX = finiteNumberFromRecord(value, "maxX");
  const maxY = finiteNumberFromRecord(value, "maxY");
  if (minX == null || minY == null || maxX == null || maxY == null) {
    return null;
  }

  return { minX, minY, maxX, maxY };
}

function parseFramePaddingRatio(options: { paddingRatio?: number } | null | undefined): number | undefined {
  const paddingRatio = options?.paddingRatio;
  return typeof paddingRatio === "number" && Number.isFinite(paddingRatio) && paddingRatio > 0
    ? paddingRatio
    : undefined;
}

function formatTilePatchReviewLabel(patch: MapTilePatch, prefix: string): string {
  const changes = summarizeTilePatchChanges(patch);
  const suffix = changes.length > 0 ? `: ${changes.join(", ")}` : "";
  return `${prefix} ${patch.tile_x}, ${patch.tile_y}${suffix}`;
}

function summarizeTilePatchChanges(patch: MapTilePatch): string[] {
  const changes: string[] = [];
  if (patch.bt_tile_info != null) {
    changes.push("base");
  }
  if (patch.dw_tile_info != null) {
    changes.push("layers");
  }
  if (patch.s_color != null) {
    changes.push("color");
  }
  if (patch.c_height != null) {
    changes.push("height");
  }
  if (patch.s_region != null) {
    changes.push("region");
  }
  if (patch.bt_island != null) {
    changes.push("island");
  }
  if (patch.bt_block != null) {
    changes.push("blocks");
  }
  return changes;
}

function formatTileColorPreview(value: number): string {
  const raw = tileColorToUnsigned(value);
  const [r, g, b] = tileColorToRgb(value);
  return `RGB565 0x${raw.toString(16).padStart(4, "0")} / rgb(${r}, ${g}, ${b})`;
}

function tileColorToCss(value: number): string {
  const [r, g, b] = tileColorToRgb(value);
  return `rgb(${r}, ${g}, ${b})`;
}

function tileColorToRgb(value: number): [number, number, number] {
  const raw = tileColorToUnsigned(value);
  const r5 = (raw >> 11) & 0x1f;
  const g6 = (raw >> 5) & 0x3f;
  const b5 = raw & 0x1f;
  return [
    Math.round((r5 * 255) / 31),
    Math.round((g6 * 255) / 63),
    Math.round((b5 * 255) / 31),
  ];
}

function tileColorToUnsigned(value: number): number {
  const integer = Number.isFinite(value) ? Math.trunc(value) : 0;
  return ((integer % 65536) + 65536) % 65536;
}

function formatTerrainTextureHint(
  textureId: number,
  texture: TerrainTextureEntry | undefined,
  emptyHint?: string,
): string {
  if (texture) {
    return texture.file_name;
  }
  if (textureId === 0 && emptyHint) {
    return emptyHint;
  }
  return `Unknown texture ${textureId}`;
}

function terrainTextureSwatchColor(textureId: number): string {
  const normalized = Math.max(0, Math.trunc(Number.isFinite(textureId) ? textureId : 0));
  const hue = (normalized * 47) % 360;
  const saturation = 48 + (normalized % 4) * 8;
  const lightness = 34 + (normalized % 5) * 6;
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}

function terrainTexturePreviewStyle(
  textureId: number,
  texture: TerrainTextureEntry | undefined,
  previewDataUri: string | null | undefined,
): CSSProperties {
  const fallbackColor = terrainTextureSwatchColor(textureId);
  const imageDataUri = previewDataUri ?? texture?.preview_data_uri;
  if (!imageDataUri) {
    return { backgroundColor: fallbackColor };
  }

  return {
    backgroundColor: fallbackColor,
    backgroundImage: `url("${imageDataUri}")`,
    backgroundPosition: "center",
    backgroundSize: "cover",
  };
}

function formatBtBlockByte(value: number): string {
  const byte = Math.min(255, Math.max(0, Math.trunc(Number.isFinite(value) ? value : 0)));
  return `0x${byte.toString(16).padStart(2, "0").toUpperCase()}`;
}

function regionTerrainValue(region: number): number {
  return region & REGION_TERRAIN_MASK;
}

function setRegionTerrain(region: number, value: number): number {
  return (region & ~REGION_TERRAIN_MASK) | value;
}

function toggleRegionFlag(region: number, bit: number): number {
  return (region & bit) === bit ? region & ~bit : region | bit;
}

function formatSubtileToggleLabel(index: number, blocked: boolean): string {
  const label = SUBTILE_LABELS[index] ?? `Subtile ${index}`;
  return `${label} subtile, currently ${blocked ? "blocked" : "open"}; mark ${
    blocked ? "walkable" : "blocked"
  }`;
}

function drawTilePatchLayerPreview(
  ctx: CanvasRenderingContext2D,
  patch: MapTilePatch,
  layer: MapWorkbenchLayer,
): boolean {
  const rects = tilePatchLayerPreviewRects(patch, layer);
  for (const rect of rects) {
    ctx.fillStyle = rect.fillStyle;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  }

  return rects.length > 0;
}

function drawTilePatchLayerPreviewForLayers(
  ctx: CanvasRenderingContext2D,
  patch: MapTilePatch,
  layers: MapWorkbenchLayer[],
): boolean {
  for (const layer of layers) {
    if (drawTilePatchLayerPreview(ctx, patch, layer)) {
      return true;
    }
  }

  return false;
}

function tilePatchIntersectsBounds(
  patch: MapTilePatch,
  bounds: MapTileBounds,
): boolean {
  return patch.tile_x + 1 >= bounds.minX
    && patch.tile_x <= bounds.maxX
    && patch.tile_y + 1 >= bounds.minY
    && patch.tile_y <= bounds.maxY;
}

function formatExportFileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

function formatByteCount(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "0 B";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ["KiB", "MiB", "GiB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function getServerOutputPreflight(manifest: MapWorkbenchManifest): {
  atr: string;
  blk: string;
  blkAligned: boolean;
} {
  const atrBytes = 8 + manifest.width * manifest.height * 3;
  const collisionWidth = manifest.width * 2;
  const collisionHeight = manifest.height * 2;
  const blkAligned = collisionWidth % 8 === 0;
  const blkBytes = blkAligned
    ? 8 + (collisionWidth / 8) * collisionHeight
    : 0;

  return {
    atr: `${manifest.width} x ${manifest.height} / ${formatByteCount(atrBytes)}`,
    blk: blkAligned
      ? `${collisionWidth} x ${collisionHeight} / ${formatByteCount(blkBytes)}`
      : `${collisionWidth} x ${collisionHeight} / row width not byte-aligned`,
    blkAligned,
  };
}

function formatCountLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatSourceGuardFingerprint(source: MapSourceFileInfo): string {
  const hash = source.content_sha256 || "no hash";
  const shortHash = hash.length > 16 ? hash.slice(0, 12) : hash;
  return `${formatByteCount(source.map_file_len)} / ${shortHash}`;
}

function formatSha256Short(hash: string | null | undefined): string {
  if (!hash) {
    return "no hash";
  }
  return hash.length > 16 ? hash.slice(0, 12) : hash;
}

function formatExportEditSummary(result: MapEditExportResult): string {
  const parts = [
    result.tile_patch_count > 0
      ? `${result.tile_patch_count} tile${result.tile_patch_count === 1 ? "" : "s"}`
      : null,
    result.placement_edit_count > 0
      ? `${result.placement_edit_count} placement${result.placement_edit_count === 1 ? "" : "s"}`
      : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(", ") : "No edits";
}

type MapExportReceiptRow = {
  target: string;
  label: string;
  path: string;
  bytes: number;
  sha256?: string | null;
};

function formatExportReport(result: MapEditExportResult, rows: MapExportReceiptRow[]): string {
  return [
    `${result.map_name} native map export`,
    `edits\t${formatExportEditSummary(result)}`,
    "server deployment\tATR/BLK are export-only; Install only applies client MAP/OBJ/RBO files",
    ...(result.rbo_may_be_stale
      ? ["rbo sidecar\tpreserved from source; placement edits are not reflected in RBO"]
      : []),
    "",
    "file\tbytes\tsha256\tpath",
    ...rows.map((row) =>
      `${row.target} ${row.label}\t${formatByteCount(row.bytes)}\tsha256 ${row.sha256 || "no hash"}\t${row.path}`
    ),
  ].join("\n");
}

function formatRboSummary(summary: MapRboSummary): { label: string; detail: string; title: string } | null {
  if (!summary.present) {
    return null;
  }

  const objectLabel = summary.record_count === 1 ? "object" : "objects";
  const label = summary.record_count > 0
    ? `RBO ${summary.record_count} ${objectLabel}`
    : "RBO empty";
  const detail = summary.warning_count > 0
    ? `${summary.warning_count} warning${summary.warning_count === 1 ? "" : "s"}`
    : "read-only";
  const typeIds = summary.distinct_type_ids.length > 0
    ? `types ${summary.distinct_type_ids.slice(0, 6).join(", ")}${summary.distinct_type_ids.length > 6 ? ", ..." : ""}`
    : "no parsed types";
  const bounds = summary.bounds
    ? `bounds x ${summary.bounds.min_x.toFixed(2)}-${summary.bounds.max_x.toFixed(2)}, y ${summary.bounds.min_y.toFixed(2)}-${summary.bounds.max_y.toFixed(2)}`
    : "no bounds";
  const sampleRecords = summary.sample_records ?? [];
  const sampleLabel = sampleRecords.length === 1 ? "sample" : "samples";
  const samples = sampleRecords.length > 0
    ? `${sampleLabel} ${sampleRecords.slice(0, 3).map((record) =>
      `type ${record.type_id} at x ${record.x.toFixed(2)}, y ${record.y.toFixed(2)}`
    ).join("; ")}`
    : "no sampled objects";
  const warning = summary.first_warning ? ` First warning: ${summary.first_warning}.` : "";

  return {
    label,
    detail,
    title: `RBO sidecar is read-only and preserved on export; ${typeIds}; ${bounds}; ${samples}; ${formatByteCount(summary.byte_len)}.${warning}`,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function exportMapEditsErrorToast(error: unknown): Parameters<typeof toast>[0] {
  const message = errorMessage(error);
  if (/source changed since this map was loaded/i.test(message)) {
    return {
      title: "Map source changed",
      description: `Reload this map before exporting so staged edits apply to the latest client files. ${message}`,
      variant: "destructive" as const,
    };
  }

  return {
    title: "Failed to export map edits",
    description: message,
    variant: "destructive" as const,
  };
}

function parseChunkKey(key: string): { chunkX: number; chunkY: number } {
  const [x, y] = key.split(":").map(Number);
  return { chunkX: x, chunkY: y };
}

function textureDetailZoomBucket(scale: number): number {
  if (scale >= 32) {
    return 6;
  }
  if (scale >= 16) {
    return 5;
  }
  if (scale >= 8) {
    return 4;
  }
  if (scale >= 4) {
    return 3;
  }
  if (scale >= 2.5) {
    return 2;
  }
  if (scale >= 1) {
    return 1;
  }
  return 0;
}

function textureDetailSamplesPerTile(zoomBucket: number): number {
  if (zoomBucket >= 6) {
    return 64;
  }
  if (zoomBucket >= 5) {
    return 32;
  }
  if (zoomBucket >= 4) {
    return 16;
  }
  if (zoomBucket >= 3) {
    return 8;
  }
  if (zoomBucket >= 2) {
    return 4;
  }
  if (zoomBucket >= 1) {
    return 2;
  }
  return 1;
}

function textureDetailChunkSizeFor(zoomBucket: number, manifestChunkSize: number): number {
  const baseChunkSize = Math.max(1, Math.floor(manifestChunkSize));
  const samplesPerTile = textureDetailSamplesPerTile(zoomBucket);
  const divisor = Math.max(1, samplesPerTile / MAX_TEXTURE_DETAIL_CACHE_BASE_SAMPLES_PER_TILE);
  return Math.max(16, Math.floor(baseChunkSize / divisor));
}

function detailChunkCacheLimitFor(
  activeRasterLayers: MapWorkbenchLayer[],
  textureZoomBucket: number,
  textureChunkSize: number,
  baseChunkSize: number,
): number {
  if (!activeRasterLayers.some(isTextureDetailLayer)) {
    return MAX_DETAIL_CHUNK_CACHE_ENTRIES;
  }

  const detailPixelSide = textureDetailSamplesPerTile(textureZoomBucket)
    * Math.max(1, Math.floor(textureChunkSize));
  const basePixelSide = MAX_TEXTURE_DETAIL_CACHE_BASE_SAMPLES_PER_TILE
    * Math.max(1, Math.floor(baseChunkSize));
  if (detailPixelSide <= basePixelSide) {
    return MAX_DETAIL_CHUNK_CACHE_ENTRIES;
  }

  const scale = basePixelSide / detailPixelSide;
  return Math.max(
    DETAIL_CHUNK_LOAD_CONCURRENCY,
    Math.floor(MAX_DETAIL_CHUNK_CACHE_ENTRIES * scale * scale),
  );
}

function renderImageCacheLimitFor(detailChunkCacheLimit: number): number {
  return detailChunkCacheLimit + RASTER_OVERVIEW_IMAGE_CACHE_HEADROOM;
}

function chunkLayerZoomBucket(layer: MapWorkbenchLayer, zoomBucket: number): number {
  return isTextureDetailLayer(layer) ? zoomBucket : 0;
}

function chunkRecordKey(
  layer: MapWorkbenchLayer,
  chunkKey: string,
  zoomBucket = 0,
  chunkSize = 128,
): string {
  return `${layer}|z${chunkLayerZoomBucket(layer, zoomBucket)}|s${chunkSize}|${chunkKey}`;
}

function layerOverlayOpacity(layer: MapWorkbenchLayer, overlayOpacity: number): number {
  const baseOpacity = COMPOSITE_OVERLAY_LAYERS.find((entry) => entry.value === layer)?.opacity ?? 0.42;
  return baseOpacity * overlayOpacity;
}

function detailChunkKeysWithinBudget(
  keys: string[],
  layerCount: number,
  maxDetailRecords: number,
): string[] {
  const layers = Math.max(1, Math.floor(layerCount));
  const budget = Math.max(0, Math.floor(maxDetailRecords / layers));
  return budget === 0 ? [] : keys.slice(0, budget);
}

function activeOverlayLayersFor(
  overlayLayers: MapWorkbenchLayer[],
  baseLayer: MapWorkbenchLayer,
  manifest: MapWorkbenchManifest | null,
): MapWorkbenchLayer[] {
  if (!manifest) {
    return [];
  }

  return overlayLayers.filter((entry) =>
    entry !== baseLayer && manifest.available_layers.includes(entry)
  );
}

function getCanvasPoint(
  event: ReactPointerEvent<HTMLCanvasElement> | ReactWheelEvent<HTMLCanvasElement>,
): MapPoint {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function getCachedImage(
  cache: Map<string, CachedImage>,
  src: string,
  maxEntries: number,
  onReady: () => void,
): CachedImage {
  const cached = cache.get(src);
  if (cached) {
    cache.delete(src);
    cache.set(src, cached);
    return cached;
  }

  const image = new Image();
  const entry = { image, ready: false };
  image.onload = () => {
    entry.ready = true;
    onReady();
  };
  image.src = src;
  cache.set(src, entry);
  const budget = Math.max(1, Math.floor(maxEntries));
  while (cache.size > budget) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey == null) {
      break;
    }
    cache.delete(oldestKey);
  }
  return entry;
}

function dedupePlacements(
  visible: MapPlacementRecord[],
  selected: MapPlacementRecord | null,
): MapPlacementRecord[] {
  if (!selected) {
    return visible;
  }

  if (visible.some((placement) => placement.index === selected.index)) {
    return visible;
  }

  return [...visible, selected];
}

function placementsInsideTile(
  placements: readonly MapPlacementRecord[],
  tileX: number,
  tileY: number,
  limit: number,
): MapPlacementRecord[] {
  const maxX = tileX + 1;
  const maxY = tileY + 1;
  const matches: MapPlacementRecord[] = [];
  for (const placement of placements) {
    if (
      placement.world_x >= tileX
      && placement.world_y >= tileY
      && placement.world_x < maxX
      && placement.world_y < maxY
    ) {
      matches.push(placement);
      if (matches.length >= limit) {
        break;
      }
    }
  }
  return matches;
}

function mergeTilePlacements(
  primary: readonly MapPlacementRecord[],
  secondary: readonly MapPlacementRecord[],
  limit: number,
): MapPlacementRecord[] {
  const merged: MapPlacementRecord[] = [];
  const seen = new Set<string>();
  const pushPlacement = (placement: MapPlacementRecord) => {
    if (merged.length >= limit) {
      return;
    }
    const key = mapPlacementKey(placement.index);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    merged.push(placement);
  };

  primary.forEach(pushPlacement);
  secondary.forEach(pushPlacement);
  return merged;
}

function hydrateTileInspectionForView(
  inspection: MapTileInspection,
  placements: readonly MapPlacementRecord[],
): MapTileInspection {
  const visiblePlacements = placementsInsideTile(
    placements,
    inspection.tile_x,
    inspection.tile_y,
    32,
  );

  return {
    ...inspection,
    nearby_placements: mergeTilePlacements(
      visiblePlacements,
      inspection.nearby_placements,
      32,
    ),
  };
}

function cacheTileInspection(
  cache: Map<string, MapTileInspection>,
  key: string,
  inspection: MapTileInspection,
  exactKeys?: Set<string>,
) {
  cache.delete(key);
  cache.set(key, {
    ...inspection,
    nearby_placements: [...inspection.nearby_placements],
  });
  while (cache.size > TILE_INSPECTION_CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey == null) {
      break;
    }
    cache.delete(oldestKey);
    exactKeys?.delete(oldestKey);
  }
}

function isSameTile(left: MapPoint | null, right: MapPoint): boolean {
  return Boolean(
    left
    && Math.floor(left.x) === Math.floor(right.x)
    && Math.floor(left.y) === Math.floor(right.y),
  );
}

function mapTilePatchesEqual(
  left: MapTilePatch | null | undefined,
  right: MapTilePatch | null | undefined,
): boolean {
  if (!left || !right) {
    return !left && !right;
  }

  const leftBlock = left.bt_block ?? null;
  const rightBlock = right.bt_block ?? null;

  return left.tile_x === right.tile_x
    && left.tile_y === right.tile_y
    && (left.dw_tile_info ?? null) === (right.dw_tile_info ?? null)
    && (left.bt_tile_info ?? null) === (right.bt_tile_info ?? null)
    && (left.s_color ?? null) === (right.s_color ?? null)
    && (left.c_height ?? null) === (right.c_height ?? null)
    && (left.s_region ?? null) === (right.s_region ?? null)
    && (left.bt_island ?? null) === (right.bt_island ?? null)
    && (
      leftBlock === rightBlock
      || Boolean(leftBlock && rightBlock
        && leftBlock[0] === rightBlock[0]
        && leftBlock[1] === rightBlock[1]
        && leftBlock[2] === rightBlock[2]
        && leftBlock[3] === rightBlock[3])
  );
}

function mergeMapTilePatch(
  current: MapTilePatch | undefined,
  patch: MapTilePatch,
): MapTilePatch {
  const mergedPatch: MapTilePatch = {
    ...current,
    ...patch,
    tile_x: patch.tile_x,
    tile_y: patch.tile_y,
  };
  if (patch.bt_block) {
    mergedPatch.bt_block = [...patch.bt_block];
  } else if (patch.bt_block === null) {
    mergedPatch.bt_block = null;
  }
  return mergedPatch;
}

function cloneTilePatch(patch: MapTilePatch): MapTilePatch {
  return {
    ...patch,
    bt_block: patch.bt_block ? [...patch.bt_block] as [number, number, number, number] : patch.bt_block,
  };
}

function cloneRecord<T>(
  record: Record<string, T>,
  cloneItem: (item: T) => T = (item) => item,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, cloneItem(value)]),
  );
}

function cloneStagedEditSnapshot(snapshot: StagedEditSnapshot): StagedEditSnapshot {
  return {
    pendingPatches: cloneRecord(snapshot.pendingPatches, cloneTilePatch),
    pendingPlacementPatches: cloneRecord(snapshot.pendingPlacementPatches),
    pendingPlacementSources: cloneRecord(snapshot.pendingPlacementSources),
    pendingPlacementAdds: cloneRecord(snapshot.pendingPlacementAdds),
    pendingPlacementDeletes: cloneRecord(snapshot.pendingPlacementDeletes),
  };
}

function mapPlacementPatchesEqual(
  left: MapPlacementPatch | null | undefined,
  right: MapPlacementPatch | null | undefined,
): boolean {
  if (!left || !right) {
    return !left && !right;
  }

  return left.index === right.index
    && (left.obj_type ?? null) === (right.obj_type ?? null)
    && (left.obj_id ?? null) === (right.obj_id ?? null)
    && (left.world_x ?? null) === (right.world_x ?? null)
    && (left.world_y ?? null) === (right.world_y ?? null)
    && (left.world_z ?? null) === (right.world_z ?? null)
    && (left.yaw_angle ?? null) === (right.yaw_angle ?? null)
    && (left.scale ?? null) === (right.scale ?? null);
}

function mapPlacementAddEditsEqual(
  left: MapPlacementAddEdit,
  right: MapPlacementAddEdit,
): boolean {
  return left.obj_type === right.obj_type
    && left.obj_id === right.obj_id
    && left.world_x === right.world_x
    && left.world_y === right.world_y
    && left.world_z === right.world_z
    && left.yaw_angle === right.yaw_angle
    && left.scale === right.scale;
}

function createPlacementAddEditFromPlacementDraft(
  draft: MapPlacementEditDraft,
): MapPlacementAddEdit {
  return createPlacementAddEditFromDraft({
    objType: draft.objType,
    objId: draft.objId,
    worldX: draft.worldX,
    worldY: draft.worldY,
    worldZ: draft.worldZ,
    yawAngle: draft.yawAngle,
    scale: draft.scale,
  });
}

function transformsNearlyEqual(
  left: MapWorkbenchTransform,
  right: MapWorkbenchTransform,
): boolean {
  const epsilon = 0.001;
  return Math.abs(left.scale - right.scale) <= epsilon
    && Math.abs(left.offsetX - right.offsetX) <= epsilon
    && Math.abs(left.offsetY - right.offsetY) <= epsilon;
}

function mapAutoFitSourceKey(manifest: MapWorkbenchManifest): string {
  return [
    manifest.name,
    manifest.source.map_file_len,
    manifest.source.map_modified_ms,
    manifest.source.content_sha256,
  ].join(":");
}

function mapInspectionSourceKey(
  projectId: string | null | undefined,
  mapName: string | null | undefined,
  manifest: MapWorkbenchManifest | null | undefined,
): string {
  if (!projectId || !mapName || !manifest) {
    return "";
  }
  return [
    projectId,
    mapName,
    manifest.name,
    manifest.source.map_modified_ms,
    manifest.source.map_file_len,
    manifest.source.content_sha256,
    manifest.placement_source.map_modified_ms,
    manifest.placement_source.map_file_len,
    manifest.placement_source.content_sha256,
  ].join(":");
}

export default function MapChunkedWorkbench({
  selectedPlacement,
  onSelectPlacement,
  onSelectedTileChange,
  onSelectedPlacementViewChange,
  onViewportBoundsChange,
  placementFocusRequest = null,
  placementFilter = null,
  rightOverlayInset = 0,
  rightDockInset = rightOverlayInset,
  showSelectedPlacementPreview = true,
  preferCollapsedInspector = false,
}: {
  selectedPlacement: MapPlacementRecord | null;
  onSelectPlacement: (placement: MapPlacementRecord | null) => void;
  onSelectedTileChange?: (tile: MapSelectedTile | null) => void;
  onSelectedPlacementViewChange?: (placement: MapPlacementRecord | null) => void;
  onViewportBoundsChange?: (
    bounds: MapTileBounds | null,
    sourceMapName?: string | null,
  ) => void;
  placementFocusRequest?: MapPlacementFocusRequest | null;
  placementFilter?: MapPlacementOverlayFilter | null;
  rightOverlayInset?: number;
  rightDockInset?: number;
  showSelectedPlacementPreview?: boolean;
  preferCollapsedInspector?: boolean;
}) {
  const currentProject = useAtomValue(currentProjectAtom);
  const selectedMap = useAtomValue(selectedMapAtom);
  const setMapStagedEditState = useSetAtom(mapStagedEditStateAtom);
  const projectId = currentProject?.id;
  const mapName = selectedMap?.name;
  const [manifest, setManifest] = useState<MapWorkbenchManifest | null>(null);
  const [layer, setLayer] = useState<MapWorkbenchLayer>("texture_base");
  const [overlayLayers, setOverlayLayers] = useState<MapWorkbenchLayer[]>([]);
  const [overlayOpacity, setOverlayOpacity] = useState(1);
  const [overviews, setOverviews] = useState<Partial<Record<MapWorkbenchLayer, MapOverviewLayer>>>({});
  const [overviewNavigatorCollapsed, setOverviewNavigatorCollapsed] = useState(false);
  const [chunks, setChunks] = useState<Record<string, MapChunkPayload>>({});
  const [visiblePlacements, setVisiblePlacements] = useState<MapPlacementRecord[]>([]);
  const [visibleRboRecords, setVisibleRboRecords] = useState<MapRboRecord[]>([]);
  const [visibleRboRecordTotal, setVisibleRboRecordTotal] = useState(0);
  const [inspection, setInspection] = useState<MapTileInspection | null>(null);
  const [tileTexturePreview, setTileTexturePreview] =
    useState<MapTileTexturePreview | null>(null);
  const [tileTexturePreviewLoading, setTileTexturePreviewLoading] = useState(false);
  const [selectedTile, setSelectedTile] = useState<MapSelectedTile | null>(null);
  const [tileDraft, setTileDraft] = useState<MapTileEditDraft | null>(null);
  const [copiedTileDraft, setCopiedTileDraft] = useState<MapTileEditDraft | null>(null);
  const [placementDraft, setPlacementDraft] = useState<MapPlacementEditDraft | null>(null);
  const [placementAddDraft, setPlacementAddDraft] = useState<MapPlacementAddDraft | null>(null);
  const [placementAddEditorOpen, setPlacementAddEditorOpen] = useState(false);
  const [pendingPatches, setPendingPatches] = useState<Record<string, MapTilePatch>>({});
  const [pendingPlacementPatches, setPendingPlacementPatches] = useState<Record<string, MapPlacementPatch>>({});
  const [pendingPlacementSources, setPendingPlacementSources] = useState<Record<string, MapPlacementRecord>>({});
  const [pendingPlacementAdds, setPendingPlacementAdds] = useState<Record<string, MapPlacementAddEdit>>({});
  const [pendingPlacementDeletes, setPendingPlacementDeletes] = useState<Record<string, MapPlacementDeleteEdit>>({});
  const [placementSelectionGroup, setPlacementSelectionGroup] = useState<Record<string, MapPlacementRecord>>({});
  const [lastExportResult, setLastExportResult] = useState<MapEditExportResult | null>(null);
  const [lastExportSourceGuard, setLastExportSourceGuard] = useState<MapEditSourceGuard | null>(null);
  const [lastApplyResult, setLastApplyResult] = useState<MapEditClientApplyResult | null>(null);
  const [applyingClientPackage, setApplyingClientPackage] = useState(false);
  const [lastRestoreResult, setLastRestoreResult] = useState<MapEditClientRestoreResult | null>(null);
  const [restoringClientBackup, setRestoringClientBackup] = useState(false);
  const [stagedEditUndoStack, setStagedEditUndoStack] = useState<StagedEditSnapshot[]>([]);
  const [stagedEditRedoStack, setStagedEditRedoStack] = useState<StagedEditSnapshot[]>([]);
  const [buildingCatalog, setBuildingCatalog] = useState<BuildingEntry[]>([]);
  const [buildingCatalogQuery, setBuildingCatalogQuery] = useState("");
  const [effectCatalog, setEffectCatalog] = useState<SceneEffectEntry[]>([]);
  const [effectCatalogQuery, setEffectCatalogQuery] = useState("");
  const [terrainTextureCatalog, setTerrainTextureCatalog] = useState<TerrainTextureEntry[]>([]);
  const [terrainTexturePreviewsById, setTerrainTexturePreviewsById] =
    useState<Record<number, string | null>>({});
  const [hoverTile, setHoverTile] = useState<MapPoint | null>(null);
  const [viewport, setViewport] = useState<MapWorkbenchViewport>({ width: 1, height: 1 });
  const [transform, setTransform] = useState<MapWorkbenchTransform>({
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  });
  const [showGrid, setShowGrid] = useState(false);
  const [showPlacements, setShowPlacements] = useState(false);
  const [placementMarkerDensity, setPlacementMarkerDensity] =
    useState<PlacementMarkerDensity>("quiet");
  const [detailLoadActivity, setDetailLoadActivity] = useState({
    loading: 0,
    queued: 0,
    pending: false,
  });
  const [jumpDraft, setJumpDraft] = useState({ x: "", y: "" });
  const [tileBrushRadius, setTileBrushRadius] = useState(0);
  const [interactionMode, setInteractionMode] = useState<CanvasInteractionMode>("select");
  const tilePaintMode = interactionMode === "paint";
  const [initialFitApplied, setInitialFitApplied] = useState(false);
  const [manifestLoading, setManifestLoading] = useState(false);
  const [inspectionLoading, setInspectionLoading] = useState(false);
  const [exportingEdits, setExportingEdits] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const compactInspectorAutoCollapsedRef = useRef(false);
  const [drawVersion, setDrawVersion] = useState(0);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const projectIdRef = useRef<string | null>(projectId ?? null);
  const mapNameRef = useRef<string | null>(mapName ?? null);
  const lastLoadedMapSelectionKeyRef = useRef<string | null>(null);
  const manifestRef = useRef(manifest);
  const layerRef = useRef(layer);
  const overlayLayersRef = useRef<MapWorkbenchLayer[]>([]);
  const activeRasterLayersRef = useRef<MapWorkbenchLayer[]>([layer]);
  const overlayOpacityRef = useRef(overlayOpacity);
  const viewportRef = useRef(viewport);
  const rightOverlayInsetRef = useRef(rightOverlayInset);
  const transformRef = useRef(transform);
  const inspectionRef = useRef(inspection);
  const inspectionCacheKeyRef = useRef<string | null>(null);
  const lastHydratedInspectionRef = useRef<MapTileInspection | null>(null);
  const selectedTileRef = useRef(selectedTile);
  const selectedPlacementRef = useRef(selectedPlacement);
  const viewportBoundsRef = useRef<MapTileBounds | null>(null);
  const showGridRef = useRef(showGrid);
  const showPlacementsRef = useRef(showPlacements);
  const placementMarkerDensityRef = useRef(placementMarkerDensity);
  const interactionModeRef = useRef(interactionMode);
  const tilePaintModeRef = useRef(tilePaintMode);
  const tileBrushRadiusRef = useRef(tileBrushRadius);
  const initialFitAppliedRef = useRef(initialFitApplied);
  const lastAutoFitTransformRef = useRef<MapWorkbenchTransform | null>(null);
  const lastAutoFitSourceRef = useRef("");
  const draftPatchRef = useRef<MapTilePatch | null>(null);
  const manifestLoadingRef = useRef(manifestLoading);
  const inspectionLoadingRef = useRef(inspectionLoading);
  const exportingEditsRef = useRef(exportingEdits);
  const pendingPatchesRef = useRef(pendingPatches);
  const pendingPlacementPatchesRef = useRef(pendingPlacementPatches);
  const pendingPlacementSourcesRef = useRef(pendingPlacementSources);
  const pendingPlacementAddsRef = useRef(pendingPlacementAdds);
  const pendingPlacementDeletesRef = useRef(pendingPlacementDeletes);
  const placementSelectionGroupRef = useRef(placementSelectionGroup);
  const placementDraftRef = useRef(placementDraft);
  const renderedPlacementsRef = useRef<MapPlacementRecord[]>([]);
  const markerPlacementsRef = useRef<MapPlacementRecord[]>([]);
  const visibleRboRecordsRef = useRef<MapRboRecord[]>([]);
  const visibleRboRecordTotalRef = useRef(0);
  const dragRef = useRef<DragState | null>(null);
  const pendingDragTransformRef = useRef<MapWorkbenchTransform | null>(null);
  const dragAnimationFrameRef = useRef<number | null>(null);
  const drawWithTransformRef = useRef<
    ((nextTransform: MapWorkbenchTransform) => void) | null
  >(null);
  const lastCanvasDrawAtRef = useRef<number | null>(null);
  const navigatorPointerRef = useRef<number | null>(null);
  const imageCacheRef = useRef(new Map<string, CachedImage>());
  const overviewsRef = useRef<Partial<Record<MapWorkbenchLayer, MapOverviewLayer>>>({});
  const chunksRef = useRef<Record<string, MapChunkPayload>>({});
  const tileInspectionCacheRef = useRef(new Map<string, MapTileInspection>());
  const tileInspectionRequestsRef = useRef(new Map<string, Promise<MapTileInspection>>());
  const tileInspectionPrefetchQueueRef = useRef<TileInspectionPrefetchRequest[]>([]);
  const tileInspectionPrefetchKeysRef = useRef(new Set<string>());
  const tileInspectionPrefetchActiveRef = useRef(false);
  const tileInspectionPrefetchTokenRef = useRef(0);
  const hoverTilePrefetchTimeoutRef = useRef<number | null>(null);
  const hoverTilePrefetchKeyRef = useRef("");
  const centerTilePrefetchTimeoutRef = useRef<number | null>(null);
  const centerTilePrefetchKeyRef = useRef("");
  const tilePlacementRequestsRef = useRef(new Map<string, Promise<{ items: MapPlacementRecord[] }>>());
  const tileExactPlacementKeysRef = useRef(new Set<string>());
  const visibleChunkKeysRef = useRef<string[]>([]);
  const lastDragDetailChunkQueueAtRef = useRef(0);
  const lastDragDetailChunkWindowRef = useRef("");
  const loadingChunksRef = useRef(new Set<string>());
  const activeChunkLoadsRef = useRef(new Map<string, ActiveChunkLoad>());
  const cancelledChunkLoadTokensRef = useRef(new Set<number>());
  const queuedChunkLoadsRef = useRef<QueuedChunkLoad[]>([]);
  const activeChunkLoadCountRef = useRef(0);
  const chunkLoadSequenceRef = useRef(0);
  const detailLoadGenerationRef = useRef(0);
  const pendingChunkLoadRef = useRef(false);
  const chunkSourceRef = useRef("");
  const inspectionSourceRef = useRef("");
  const preservedTileDraftRef = useRef<{ key: string; draft: MapTileEditDraft } | null>(null);
  const preservedPlacementDraftRef = useRef<{ key: string; draft: MapPlacementEditDraft } | null>(null);
  const postReloadTileRef = useRef<MapPoint | null>(null);
  const exportReloadPendingRef = useRef(false);
  const placementAddSequenceRef = useRef(0);
  const manifestGuard = useRef(new LatestOnly());
  const overviewGuard = useRef(new LatestOnly());
  const placementGuard = useRef(new LatestOnly());
  const rboRecordGuard = useRef(new LatestOnly());
  const inspectionGuard = useRef(new LatestOnly());
  const tileTexturePreviewGuard = useRef(new LatestOnly());
  const buildingCatalogGuard = useRef(new LatestOnly());
  const effectCatalogGuard = useRef(new LatestOnly());
  const terrainTextureCatalogGuard = useRef(new LatestOnly());
  const terrainTexturePreviewRequestsRef = useRef<Set<number>>(new Set());
  const terrainTexturePreviewProjectRef = useRef<string | null>(null);

  const setTilePaintMode = useCallback((next: boolean | ((current: boolean) => boolean)) => {
    setInteractionMode((currentMode) => {
      const currentEnabled = currentMode === "paint";
      const nextEnabled = typeof next === "function" ? next(currentEnabled) : next;
      return nextEnabled ? "paint" : "select";
    });
  }, []);

  const setLayerOverlayState = useCallback((
    overlayLayer: MapWorkbenchLayer,
    enabled: boolean,
  ) => {
    const current = overlayLayersRef.current;
    const active = current.includes(overlayLayer);
    if (active === enabled) {
      return;
    }

    const next = enabled
      ? [...current, overlayLayer]
      : current.filter((entry) => entry !== overlayLayer);
    overlayLayersRef.current = next;
    activeRasterLayersRef.current = [
      layerRef.current,
      ...activeOverlayLayersFor(next, layerRef.current, manifestRef.current),
    ];
    setOverlayLayers(next);
  }, []);

  const updateOverlayOpacity = useCallback((nextPercent: number) => {
    const clampedPercent = Math.min(
      Math.max(
        OVERLAY_OPACITY_MIN,
        Number.isFinite(nextPercent) ? nextPercent : OVERLAY_OPACITY_MAX,
      ),
      OVERLAY_OPACITY_MAX,
    );
    const nextOpacity = clampedPercent / 100;
    overlayOpacityRef.current = nextOpacity;
    setOverlayOpacity(nextOpacity);
  }, []);

  const toggleOverlayLayer = useCallback((overlayLayer: MapWorkbenchLayer) => {
    const current = overlayLayersRef.current;
    const next = current.includes(overlayLayer)
      ? current.filter((entry) => entry !== overlayLayer)
      : [...current, overlayLayer];
    overlayLayersRef.current = next;
    activeRasterLayersRef.current = [
      layerRef.current,
      ...activeOverlayLayersFor(next, layerRef.current, manifestRef.current),
    ];
    setOverlayLayers(next);
  }, []);

  const overlayLayerKey = overlayLayers.join("|");
  const activeOverlayLayers = useMemo(() => {
    return activeOverlayLayersFor(overlayLayers, layer, manifest);
  }, [layer, manifest, overlayLayerKey]);
  const activeRasterLayers = useMemo(
    () => [layer, ...activeOverlayLayers],
    [activeOverlayLayers, layer],
  );
  const activeRasterLayerKey = activeRasterLayers.join("|");
  const overview = overviews[layer] ?? null;

  const applyTransform = useCallback((
    update: MapWorkbenchTransform | ((current: MapWorkbenchTransform) => MapWorkbenchTransform),
  ): MapWorkbenchTransform => {
    const current = transformRef.current;
    const next = typeof update === "function" ? update(current) : update;
    transformRef.current = next;
    setTransform((stateCurrent) => (
      stateCurrent.scale === next.scale
        && stateCurrent.offsetX === next.offsetX
        && stateCurrent.offsetY === next.offsetY
        ? stateCurrent
        : next
    ));
    return next;
  }, []);

  const syncDetailLoadActivity = useCallback(() => {
    const next = {
      loading: loadingChunksRef.current.size,
      queued: queuedChunkLoadsRef.current.length,
      pending: pendingChunkLoadRef.current,
    };
    setDetailLoadActivity((current) =>
      current.loading === next.loading
        && current.queued === next.queued
        && current.pending === next.pending
        ? current
        : next
    );
  }, []);

  const pumpChunkLoadQueue = useCallback(function pumpChunkLoadQueue() {
    while (
      activeChunkLoadCountRef.current < DETAIL_CHUNK_LOAD_CONCURRENCY
      && queuedChunkLoadsRef.current.length > 0
    ) {
      const request = queuedChunkLoadsRef.current.shift();
      if (!request) {
        continue;
      }
      if (chunkSourceRef.current !== request.chunkSourceKey) {
        continue;
      }
      if (detailLoadGenerationRef.current !== request.generation) {
        continue;
      }

      const loadKey = `${request.generation}|${request.chunkSourceKey}|${request.recordKey}`;
      if (chunksRef.current[request.recordKey] || loadingChunksRef.current.has(loadKey)) {
        continue;
      }

      const { chunkX, chunkY } = parseChunkKey(request.key);
      const requestToken = chunkLoadSequenceRef.current + 1;
      chunkLoadSequenceRef.current = requestToken;
      loadingChunksRef.current.add(loadKey);
      activeChunkLoadsRef.current.set(loadKey, { request, token: requestToken });
      activeChunkLoadCountRef.current += 1;
      syncDetailLoadActivity();
      Promise.resolve(getMapChunk(request.projectId, request.mapName, {
        chunk_x: chunkX,
        chunk_y: chunkY,
        chunk_size: request.chunkSize,
        layer: request.layer,
        zoom_bucket: request.zoomBucket,
        include_numeric_payload: false,
        source_guard: request.sourceGuard,
      }))
        .then((payload) => {
          if (!payload) {
            return;
          }
          if (
            cancelledChunkLoadTokensRef.current.has(requestToken)
            || chunkSourceRef.current !== request.chunkSourceKey
            || detailLoadGenerationRef.current !== request.generation
          ) {
            return;
          }
          setChunks((current) => {
            if (
              cancelledChunkLoadTokensRef.current.has(requestToken)
              || chunkSourceRef.current !== request.chunkSourceKey
              || detailLoadGenerationRef.current !== request.generation
            ) {
              return current;
            }
            if (current[request.recordKey]) {
              return current;
            }
            const next = pruneChunkRecord(
              { ...current, [request.recordKey]: payload },
              visibleChunkKeysRef.current,
              request.cacheLimit,
            );
            chunksRef.current = next;
            return next;
          });
        })
        .catch(() => undefined)
        .finally(() => {
          const activeLoad = activeChunkLoadsRef.current.get(loadKey);
          const loadWasActive = activeLoad?.token === requestToken;
          if (loadWasActive) {
            activeChunkLoadsRef.current.delete(loadKey);
            loadingChunksRef.current.delete(loadKey);
          }
          cancelledChunkLoadTokensRef.current.delete(requestToken);
          if (loadWasActive) {
            activeChunkLoadCountRef.current = Math.max(0, activeChunkLoadCountRef.current - 1);
          }
          pendingChunkLoadRef.current = queuedChunkLoadsRef.current.length > 0;
          syncDetailLoadActivity();
          pumpChunkLoadQueue();
        });
    }

    pendingChunkLoadRef.current = queuedChunkLoadsRef.current.length > 0;
    syncDetailLoadActivity();
  }, [syncDetailLoadActivity]);

  const releaseStaleDetailChunkSlots = useCallback((
    nextVisibleRecordKeys: string[],
    context: DetailChunkQueueContext,
  ) => {
    const staleBudget = Math.max(
      0,
      MAX_STALE_DETAIL_CHUNK_LOADS - cancelledChunkLoadTokensRef.current.size,
    );
    if (staleBudget <= 0 || activeChunkLoadsRef.current.size === 0) {
      return;
    }

    const nextVisibleRecordKeySet = new Set(nextVisibleRecordKeys);
    const generation = detailLoadGenerationRef.current;
    let released = 0;
    for (const [loadKey, activeLoad] of Array.from(activeChunkLoadsRef.current.entries())) {
      if (released >= staleBudget) {
        break;
      }
      const { request, token } = activeLoad;
      if (
        request.chunkSourceKey !== context.chunkSourceKey
        || request.generation !== generation
        || nextVisibleRecordKeySet.has(request.recordKey)
      ) {
        continue;
      }

      activeChunkLoadsRef.current.delete(loadKey);
      loadingChunksRef.current.delete(loadKey);
      cancelledChunkLoadTokensRef.current.add(token);
      activeChunkLoadCountRef.current = Math.max(0, activeChunkLoadCountRef.current - 1);
      released += 1;
    }

    if (released > 0) {
      syncDetailLoadActivity();
    }
  }, [syncDetailLoadActivity]);

  const queueVisibleDetailChunks = useCallback((
    nextVisibleChunkKeys: string[],
    context: DetailChunkQueueContext,
  ) => {
    const cacheLimit = detailChunkCacheLimitFor(
      context.layers,
      context.zoomBucket,
      context.chunkSize,
      manifestRef.current?.chunk_size ?? context.chunkSize,
    );
    const nextVisibleRecordKeys = context.layers.flatMap((requestedLayer) =>
      nextVisibleChunkKeys.map((key) =>
        chunkRecordKey(requestedLayer, key, context.zoomBucket, context.chunkSize)
      )
    );
    visibleChunkKeysRef.current = nextVisibleRecordKeys;
    releaseStaleDetailChunkSlots(nextVisibleRecordKeys, context);
    if (nextVisibleChunkKeys.length === 0) {
      queuedChunkLoadsRef.current = queuedChunkLoadsRef.current.filter(
        (request) => request.chunkSourceKey !== context.chunkSourceKey,
      );
      pendingChunkLoadRef.current = queuedChunkLoadsRef.current.length > 0;
      syncDetailLoadActivity();
      return;
    }

    const generation = detailLoadGenerationRef.current;
    const retainedOtherRequests = queuedChunkLoadsRef.current.filter(
      (request) => request.chunkSourceKey !== context.chunkSourceKey,
    );
    const existingCurrentRequests = new Map(
      queuedChunkLoadsRef.current
        .filter((request) =>
          request.chunkSourceKey === context.chunkSourceKey
          && request.generation === generation
        )
        .map((request) => [
          `${request.generation}|${request.chunkSourceKey}|${request.recordKey}`,
          request,
        ]),
    );
    const nextCurrentRequests: QueuedChunkLoad[] = [];
    const queuedLoadKeys = new Set<string>();
    for (const requestedLayer of context.layers) {
      for (const key of nextVisibleChunkKeys) {
        const recordKey = chunkRecordKey(
          requestedLayer,
          key,
          context.zoomBucket,
          context.chunkSize,
        );
        const loadKey = `${generation}|${context.chunkSourceKey}|${recordKey}`;
        if (
          chunksRef.current[recordKey]
          || loadingChunksRef.current.has(loadKey)
          || queuedLoadKeys.has(loadKey)
        ) {
          continue;
        }

        nextCurrentRequests.push(existingCurrentRequests.get(loadKey) ?? {
          key,
          recordKey,
          chunkSourceKey: context.chunkSourceKey,
          generation,
          projectId: context.projectId,
          mapName: context.mapName,
          layer: requestedLayer,
          zoomBucket: chunkLayerZoomBucket(requestedLayer, context.zoomBucket),
          chunkSize: context.chunkSize,
          cacheLimit,
          sourceGuard: context.sourceGuard,
        });
        queuedLoadKeys.add(loadKey);
      }
    }
    queuedChunkLoadsRef.current = [...nextCurrentRequests, ...retainedOtherRequests];

    pendingChunkLoadRef.current = queuedChunkLoadsRef.current.length > 0;
    syncDetailLoadActivity();
    pumpChunkLoadQueue();
  }, [pumpChunkLoadQueue, releaseStaleDetailChunkSlots, syncDetailLoadActivity]);

  useEffect(() => {
    projectIdRef.current = projectId ?? null;
  }, [projectId]);

  useEffect(() => {
    mapNameRef.current = mapName ?? null;
  }, [mapName]);

  useEffect(() => {
    manifestRef.current = manifest;
  }, [manifest]);

  useEffect(() => {
    layerRef.current = layer;
  }, [layer]);

  useEffect(() => {
    overlayLayersRef.current = overlayLayers;
  }, [overlayLayerKey, overlayLayers]);

  useEffect(() => {
    activeRasterLayersRef.current = activeRasterLayers;
  }, [activeRasterLayerKey, activeRasterLayers]);

  useEffect(() => {
    overlayOpacityRef.current = overlayOpacity;
  }, [overlayOpacity]);

  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  useEffect(() => {
    const previousInset = rightOverlayInsetRef.current;
    rightOverlayInsetRef.current = rightOverlayInset;
    if (
      previousInset === rightOverlayInset
      || !manifest
      || !initialFitAppliedRef.current
      || viewport.width <= 1
      || viewport.height <= 1
    ) {
      return;
    }

    const previousFitViewport = {
      width: Math.max(1, viewport.width - previousInset),
      height: viewport.height,
    };
    const previousFit = fitMapTransform(manifest, previousFitViewport, {
      minScale: MIN_SCALE,
      maxScale: MAX_SCALE,
    });
    const nextFitViewport = {
      width: Math.max(1, viewport.width - rightOverlayInset),
      height: viewport.height,
    };
    const nextFit = fitMapTransform(manifest, nextFitViewport, {
      minScale: MIN_SCALE,
      maxScale: MAX_SCALE,
    });
    const previousAutoFit = lastAutoFitTransformRef.current;
    const nextAutoFitSource = mapAutoFitSourceKey(manifest);

    applyTransform((current) => {
      const isAutoFitView = transformsNearlyEqual(current, previousFit)
        || Boolean(previousAutoFit && transformsNearlyEqual(current, previousAutoFit));
      if (!isAutoFitView) {
        return current;
      }
      lastAutoFitTransformRef.current = nextFit;
      lastAutoFitSourceRef.current = nextAutoFitSource;
      return nextFit;
    });
  }, [applyTransform, manifest, rightOverlayInset, viewport.height, viewport.width]);

  useEffect(() => {
    transformRef.current = pendingDragTransformRef.current ?? transform;
  }, [transform]);

  useEffect(() => {
    inspectionRef.current = inspection;
  }, [inspection]);

  useEffect(() => {
    selectedTileRef.current = selectedTile;
  }, [selectedTile]);

  useEffect(() => {
    selectedPlacementRef.current = selectedPlacement;
  }, [selectedPlacement]);

  useEffect(() => {
    showGridRef.current = showGrid;
  }, [showGrid]);

  useEffect(() => {
    showPlacementsRef.current = showPlacements;
  }, [showPlacements]);

  useEffect(() => {
    placementMarkerDensityRef.current = placementMarkerDensity;
  }, [placementMarkerDensity]);

  useEffect(() => {
    interactionModeRef.current = interactionMode;
  }, [interactionMode]);

  useEffect(() => {
    tilePaintModeRef.current = tilePaintMode;
  }, [tilePaintMode]);

  useEffect(() => {
    tileBrushRadiusRef.current = tileBrushRadius;
  }, [tileBrushRadius]);

  useEffect(() => {
    initialFitAppliedRef.current = initialFitApplied;
  }, [initialFitApplied]);

  useEffect(() => {
    manifestLoadingRef.current = manifestLoading;
  }, [manifestLoading]);

  useEffect(() => {
    inspectionLoadingRef.current = inspectionLoading;
  }, [inspectionLoading]);

  useEffect(() => {
    exportingEditsRef.current = exportingEdits;
  }, [exportingEdits]);

  useEffect(() => {
    pendingPatchesRef.current = pendingPatches;
  }, [pendingPatches]);

  useEffect(() => {
    pendingPlacementPatchesRef.current = pendingPlacementPatches;
  }, [pendingPlacementPatches]);

  useEffect(() => {
    pendingPlacementSourcesRef.current = pendingPlacementSources;
  }, [pendingPlacementSources]);

  useEffect(() => {
    pendingPlacementAddsRef.current = pendingPlacementAdds;
  }, [pendingPlacementAdds]);

  useEffect(() => {
    pendingPlacementDeletesRef.current = pendingPlacementDeletes;
  }, [pendingPlacementDeletes]);

  useEffect(() => {
    placementSelectionGroupRef.current = placementSelectionGroup;
  }, [placementSelectionGroup]);

  useEffect(() => {
    placementDraftRef.current = placementDraft;
  }, [placementDraft]);

  useEffect(() => {
    chunksRef.current = chunks;
  }, [chunks]);

  const paintPendingDragTransform = useCallback(() => {
    dragAnimationFrameRef.current = null;
    const next = pendingDragTransformRef.current;
    if (!next) {
      return;
    }

    transformRef.current = next;
    drawWithTransformRef.current?.(next);
  }, []);

  const commitPendingDragTransform = useCallback(() => {
    const next = pendingDragTransformRef.current;
    pendingDragTransformRef.current = null;
    if (!next) {
      return;
    }

    transformRef.current = next;
    setTransform((current) => (
      current.scale === next.scale
        && current.offsetX === next.offsetX
        && current.offsetY === next.offsetY
        ? current
        : next
    ));
  }, []);

  const scheduleDragTransform = useCallback((next: MapWorkbenchTransform) => {
    pendingDragTransformRef.current = next;
    transformRef.current = next;
    if (dragAnimationFrameRef.current !== null) {
      return;
    }

    dragAnimationFrameRef.current = window.requestAnimationFrame(
      paintPendingDragTransform,
    );
  }, [paintPendingDragTransform]);

  const flushPendingDragTransform = useCallback(() => {
    if (dragAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(dragAnimationFrameRef.current);
      dragAnimationFrameRef.current = null;
    }
    commitPendingDragTransform();
  }, [commitPendingDragTransform]);

  useEffect(() => () => {
    if (dragAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(dragAnimationFrameRef.current);
      dragAnimationFrameRef.current = null;
    }
    pendingDragTransformRef.current = null;
  }, []);

  const snapshotStagedEdits = useCallback((): StagedEditSnapshot => ({
    pendingPatches: cloneRecord(pendingPatches, cloneTilePatch),
    pendingPlacementPatches: cloneRecord(pendingPlacementPatches),
    pendingPlacementSources: cloneRecord(pendingPlacementSources),
    pendingPlacementAdds: cloneRecord(pendingPlacementAdds),
    pendingPlacementDeletes: cloneRecord(pendingPlacementDeletes),
  }), [
    pendingPatches,
    pendingPlacementAdds,
    pendingPlacementDeletes,
    pendingPlacementPatches,
    pendingPlacementSources,
  ]);

  const applyStagedEditSnapshot = useCallback((snapshot: StagedEditSnapshot) => {
    const next = cloneStagedEditSnapshot(snapshot);
    const currentSelectedPlacement = selectedPlacementRef.current;
    const currentSelectedPlacementKey = currentSelectedPlacement?.index != null
      ? mapPlacementKey(currentSelectedPlacement.index)
      : null;
    pendingPatchesRef.current = next.pendingPatches;
    pendingPlacementPatchesRef.current = next.pendingPlacementPatches;
    pendingPlacementSourcesRef.current = next.pendingPlacementSources;
    pendingPlacementAddsRef.current = next.pendingPlacementAdds;
    pendingPlacementDeletesRef.current = next.pendingPlacementDeletes;
    setPendingPatches(next.pendingPatches);
    setPendingPlacementPatches(next.pendingPlacementPatches);
    setPendingPlacementSources(next.pendingPlacementSources);
    setPendingPlacementAdds(next.pendingPlacementAdds);
    setPendingPlacementDeletes(next.pendingPlacementDeletes);
    if (
      currentSelectedPlacementKey
      && currentSelectedPlacement
      && currentSelectedPlacement.index < 0
    ) {
      const restoredAdd = next.pendingPlacementAdds[currentSelectedPlacementKey];
      if (restoredAdd) {
        const restoredPlacement = createTemporaryPlacementFromAddEdit(
          restoredAdd,
          currentSelectedPlacement.index,
        );
        placementDraftRef.current = createPlacementEditDraft(restoredPlacement);
        setPlacementDraft(placementDraftRef.current);
        onSelectPlacement(restoredPlacement);
        return;
      }
      onSelectPlacement(null);
    }
  }, [onSelectPlacement]);

  const recordStagedEditHistory = useCallback(() => {
    const snapshot = snapshotStagedEdits();
    setStagedEditUndoStack((current) =>
      [...current, snapshot].slice(-STAGED_EDIT_HISTORY_LIMIT)
    );
    setStagedEditRedoStack([]);
  }, [snapshotStagedEdits]);

  const undoStagedEdit = useCallback(() => {
    if (stagedEditUndoStack.length === 0) {
      return;
    }
    const previous = stagedEditUndoStack[stagedEditUndoStack.length - 1];
    setStagedEditUndoStack(stagedEditUndoStack.slice(0, -1));
    setStagedEditRedoStack((current) =>
      [...current, snapshotStagedEdits()].slice(-STAGED_EDIT_HISTORY_LIMIT)
    );
    applyStagedEditSnapshot(previous);
  }, [applyStagedEditSnapshot, snapshotStagedEdits, stagedEditUndoStack]);

  const redoStagedEdit = useCallback(() => {
    if (stagedEditRedoStack.length === 0) {
      return;
    }
    const next = stagedEditRedoStack[stagedEditRedoStack.length - 1];
    setStagedEditRedoStack(stagedEditRedoStack.slice(0, -1));
    setStagedEditUndoStack((current) =>
      [...current, snapshotStagedEdits()].slice(-STAGED_EDIT_HISTORY_LIMIT)
    );
    applyStagedEditSnapshot(next);
  }, [applyStagedEditSnapshot, snapshotStagedEdits, stagedEditRedoStack]);

  const commitTileBrushPatches = useCallback((brushPatches: MapTilePatch[]): boolean => {
    if (brushPatches.length === 0) {
      return false;
    }

    const hasChangedPatch = brushPatches.some((patch) => {
      const key = mapTileKey(patch.tile_x, patch.tile_y);
      const current = pendingPatchesRef.current[key];
      return !mapTilePatchesEqual(mergeMapTilePatch(current, patch), current);
    });
    if (!hasChangedPatch) {
      return false;
    }

    recordStagedEditHistory();
    setPendingPatches((current) => {
      const next = { ...current };
      for (const patch of brushPatches) {
        const key = mapTileKey(patch.tile_x, patch.tile_y);
        next[key] = mergeMapTilePatch(next[key], patch);
      }
      return next;
    });
    return true;
  }, [recordStagedEditHistory]);

  useEffect(() => {
    const version = buildingCatalogGuard.current.begin();
    setBuildingCatalog([]);
    setBuildingCatalogQuery("");

    if (!projectId) {
      return;
    }

    getBuildingList(projectId)
      .then((list) => {
        if (buildingCatalogGuard.current.isLatest(version)) {
          setBuildingCatalog(list);
        }
      })
      .catch(() => {
        if (buildingCatalogGuard.current.isLatest(version)) {
          setBuildingCatalog([]);
        }
      });

    return () => buildingCatalogGuard.current.invalidate();
  }, [projectId]);

  useEffect(() => {
    const version = effectCatalogGuard.current.begin();
    setEffectCatalog([]);
    setEffectCatalogQuery("");

    if (!projectId) {
      return;
    }

    getSceneEffectList(projectId)
      .then((list) => {
        if (effectCatalogGuard.current.isLatest(version)) {
          setEffectCatalog(list);
        }
      })
      .catch(() => {
        if (effectCatalogGuard.current.isLatest(version)) {
          setEffectCatalog([]);
        }
      });

    return () => effectCatalogGuard.current.invalidate();
  }, [projectId]);

  useEffect(() => {
    const version = terrainTextureCatalogGuard.current.begin();
    setTerrainTextureCatalog([]);
    setTerrainTexturePreviewsById({});
    terrainTexturePreviewRequestsRef.current.clear();
    terrainTexturePreviewProjectRef.current = projectId ?? null;

    if (!projectId) {
      return;
    }

    getTerrainTextureCatalog(projectId)
      .then((catalog) => {
        if (terrainTextureCatalogGuard.current.isLatest(version)) {
          setTerrainTextureCatalog(catalog);
        }
      })
      .catch(() => {
        if (terrainTextureCatalogGuard.current.isLatest(version)) {
          setTerrainTextureCatalog([]);
        }
      });

    return () => terrainTextureCatalogGuard.current.invalidate();
  }, [projectId]);

  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) {
      return;
    }
    const element = node;

    function updateSize() {
      const rect = element.getBoundingClientRect();
      const nextViewport = {
        width: Math.max(1, Math.floor(rect.width)),
        height: Math.max(1, Math.floor(rect.height)),
      };
      setViewport((current) => {
        if (
          current.width === nextViewport.width
          && current.height === nextViewport.height
        ) {
          return current;
        }
        return nextViewport;
      });
    }

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setManifest(null);
    setOverlayLayers([]);
    overlayLayersRef.current = [];
    activeRasterLayersRef.current = [layerRef.current];
    setOverviews({});
    overviewsRef.current = {};
    setChunks({});
    chunksRef.current = {};
    tileInspectionCacheRef.current.clear();
    tileInspectionRequestsRef.current.clear();
    tileInspectionPrefetchQueueRef.current = [];
    tileInspectionPrefetchKeysRef.current.clear();
    tileInspectionPrefetchActiveRef.current = false;
    tileInspectionPrefetchTokenRef.current += 1;
    if (hoverTilePrefetchTimeoutRef.current !== null) {
      window.clearTimeout(hoverTilePrefetchTimeoutRef.current);
      hoverTilePrefetchTimeoutRef.current = null;
    }
    hoverTilePrefetchKeyRef.current = "";
    if (centerTilePrefetchTimeoutRef.current !== null) {
      window.clearTimeout(centerTilePrefetchTimeoutRef.current);
      centerTilePrefetchTimeoutRef.current = null;
    }
    centerTilePrefetchKeyRef.current = "";
    tilePlacementRequestsRef.current.clear();
    tileExactPlacementKeysRef.current.clear();
    setVisiblePlacements([]);
    setInspection(null);
    inspectionRef.current = null;
    inspectionCacheKeyRef.current = null;
    lastHydratedInspectionRef.current = null;
    setSelectedTile(null);
    selectedTileRef.current = null;
    onSelectedTileChange?.(null);
    setTileDraft(null);
    setCopiedTileDraft(null);
    setPlacementDraft(null);
    setPlacementAddDraft(null);
    setJumpDraft({ x: "", y: "" });
    setInteractionMode("select");
    setPendingPatches({});
    setPendingPlacementPatches({});
    setPendingPlacementSources({});
    setPendingPlacementAdds({});
    setPendingPlacementDeletes({});
    setPlacementSelectionGroup({});
    setStagedEditUndoStack([]);
    setStagedEditRedoStack([]);
    setInitialFitApplied(false);
    initialFitAppliedRef.current = false;
    lastAutoFitTransformRef.current = null;
    lastAutoFitSourceRef.current = "";
    setInspectionLoading(false);
    inspectionGuard.current.invalidate();
    imageCacheRef.current.clear();
    detailLoadGenerationRef.current += 1;
    loadingChunksRef.current.clear();
    activeChunkLoadsRef.current.clear();
    cancelledChunkLoadTokensRef.current.clear();
    queuedChunkLoadsRef.current = [];
    activeChunkLoadCountRef.current = 0;
    pendingChunkLoadRef.current = false;
    setDetailLoadActivity({ loading: 0, queued: 0, pending: false });

    if (!projectId || !mapName) {
      return;
    }

    const version = manifestGuard.current.begin();
    setManifestLoading(true);
    getMapWorkbenchManifest(projectId, mapName)
      .then((nextManifest) => {
        if (!manifestGuard.current.isLatest(version)) {
          return;
        }
        setManifest(nextManifest);
        const mapSelectionKey = `${projectId}:${mapName}`;
        const isNewMapSelection = lastLoadedMapSelectionKeyRef.current !== mapSelectionKey;
        lastLoadedMapSelectionKeyRef.current = mapSelectionKey;
        const preservedLayer = nextManifest.available_layers.includes(layer)
          ? layer
          : nextManifest.available_layers[0] ?? "terrain_color";
        const nextLayer = isNewMapSelection
          ? preferredDefaultLayer(nextManifest.available_layers)
          : preservedLayer;
        setLayer(nextLayer);
      })
      .catch((error) => {
        if (manifestGuard.current.isLatest(version)) {
          toast({
            title: "Failed to load map workbench",
            description: String(error),
            variant: "destructive",
          });
        }
      })
      .finally(() => {
        if (manifestGuard.current.isLatest(version)) {
          setManifestLoading(false);
        }
      });

    return () => {
      manifestGuard.current.invalidate();
      tileInspectionPrefetchQueueRef.current = [];
      tileInspectionPrefetchKeysRef.current.clear();
      tileInspectionPrefetchActiveRef.current = false;
      tileInspectionPrefetchTokenRef.current += 1;
      if (hoverTilePrefetchTimeoutRef.current !== null) {
        window.clearTimeout(hoverTilePrefetchTimeoutRef.current);
        hoverTilePrefetchTimeoutRef.current = null;
      }
      hoverTilePrefetchKeyRef.current = "";
      if (centerTilePrefetchTimeoutRef.current !== null) {
        window.clearTimeout(centerTilePrefetchTimeoutRef.current);
        centerTilePrefetchTimeoutRef.current = null;
      }
      centerTilePrefetchKeyRef.current = "";
    };
  }, [projectId, mapName, onSelectedTileChange, refreshNonce]);

  useEffect(() => {
    postReloadTileRef.current = null;
    exportReloadPendingRef.current = false;
    setLastExportResult(null);
    setLastExportSourceGuard(null);
    setLastApplyResult(null);
    setLastRestoreResult(null);
  }, [projectId, mapName]);

  useEffect(() => {
    if (!manifest || viewport.width <= 1 || viewport.height <= 1) {
      return;
    }
    const initialFitViewport = {
      width: Math.max(1, viewport.width - rightOverlayInset),
      height: viewport.height,
    };
    const nextFit = fitMapTransform(manifest, initialFitViewport, {
      minScale: MIN_SCALE,
      maxScale: MAX_SCALE,
    });
    const autoFitSource = mapAutoFitSourceKey(manifest);
    const previousAutoFit = lastAutoFitTransformRef.current;
    const previousAutoFitSource = lastAutoFitSourceRef.current;
    const shouldApplyInitialFit =
      !initialFitAppliedRef.current
      || !previousAutoFit
      || previousAutoFitSource !== autoFitSource;

    if (shouldApplyInitialFit) {
      lastAutoFitTransformRef.current = nextFit;
      lastAutoFitSourceRef.current = autoFitSource;
      applyTransform(nextFit);
    } else {
      applyTransform((current) => {
        if (!transformsNearlyEqual(current, previousAutoFit)) {
          return current;
        }
        lastAutoFitTransformRef.current = nextFit;
        lastAutoFitSourceRef.current = autoFitSource;
        return nextFit;
      });
    }
    initialFitAppliedRef.current = true;
    setInitialFitApplied(true);
  }, [
    manifest?.name,
    manifest?.source.map_file_len,
    manifest?.source.map_modified_ms,
    manifest?.source.content_sha256,
    viewport.width,
    viewport.height,
    applyTransform,
  ]);

  const sourceBaseKey = manifest
    ? `${manifest.name}:${manifest.source.map_modified_ms}:${manifest.source.map_file_len}:${manifest.source.content_sha256}`
    : "";
  const sourceKey = sourceBaseKey;
  const chunkSourceKey = projectId && mapName && sourceKey
    ? `${projectId}:${mapName}:${sourceKey}`
    : "";
  const inspectionSourceKey = mapInspectionSourceKey(projectId, mapName ?? null, manifest);

  useEffect(() => {
    chunkSourceRef.current = chunkSourceKey;
  }, [chunkSourceKey]);

  useEffect(() => {
    inspectionSourceRef.current = inspectionSourceKey;
  }, [inspectionSourceKey]);

  useEffect(() => {
    setOverviews({});
    overviewsRef.current = {};
    setChunks({});
    chunksRef.current = {};
    imageCacheRef.current.clear();
    detailLoadGenerationRef.current += 1;
    loadingChunksRef.current.clear();
    activeChunkLoadsRef.current.clear();
    cancelledChunkLoadTokensRef.current.clear();
    queuedChunkLoadsRef.current = [];
    activeChunkLoadCountRef.current = 0;
    pendingChunkLoadRef.current = false;
    setDetailLoadActivity({ loading: 0, queued: 0, pending: false });
  }, [chunkSourceKey]);

  useEffect(() => {
    if (!projectId || !mapName || !manifest) {
      return;
    }

    const requestedLayers = activeRasterLayers.filter((requestedLayer) =>
      !overviewsRef.current[requestedLayer]
    );
    if (requestedLayers.length === 0) {
      return;
    }

    const version = overviewGuard.current.begin();
    Promise.all(
      requestedLayers.map((requestedLayer) =>
        getMapOverview(
          projectId,
          mapName,
          requestedLayer,
          manifest.recommended_overview_max_size,
        )
          .then((nextOverview) => nextOverview)
          .catch(() => null)
      ),
    )
      .then((nextOverviews) => {
        if (overviewGuard.current.isLatest(version)) {
          const nextRecord: Partial<Record<MapWorkbenchLayer, MapOverviewLayer>> = {
            ...overviewsRef.current,
          };
          for (const nextOverview of nextOverviews) {
            if (nextOverview) {
              nextRecord[nextOverview.layer] = nextOverview;
            }
          }
          overviewsRef.current = nextRecord;
          setOverviews(nextRecord);
        }
      })
      .catch(() => {
        if (overviewGuard.current.isLatest(version)) {
          setOverviews({});
          overviewsRef.current = {};
        }
      });

    return () => overviewGuard.current.invalidate();
  }, [projectId, mapName, manifest, activeRasterLayerKey, activeRasterLayers]);

  const detailChunkScaleEnabled = initialFitApplied
    && shouldLoadDetailChunks(transform.scale, DETAIL_CHUNK_MIN_SCALE);
  const activeTextureDetailZoomBucket = textureDetailZoomBucket(transform.scale);
  const activeTextureDetailChunkSize = manifest
    ? textureDetailChunkSizeFor(activeTextureDetailZoomBucket, manifest.chunk_size)
    : 128;
  const activeDetailChunkCacheLimit = detailChunkCacheLimitFor(
    activeRasterLayers,
    activeTextureDetailZoomBucket,
    activeTextureDetailChunkSize,
    manifest?.chunk_size ?? activeTextureDetailChunkSize,
  );
  const activeDetailZoomKey = activeRasterLayers.some(isTextureDetailLayer)
    ? String(activeTextureDetailZoomBucket)
    : "0";

  const unobscuredViewport = useMemo(() => ({
    width: Math.max(1, viewport.width - rightOverlayInset),
    height: viewport.height,
  }), [rightOverlayInset, viewport.height, viewport.width]);

  const candidateVisibleChunkKeys = useMemo(() => {
    if (!manifest || !detailChunkScaleEnabled) {
      return [];
    }
    return getPrioritizedVisibleChunkKeys(
      manifest,
      unobscuredViewport,
      transform,
      1,
      activeTextureDetailChunkSize,
    );
  }, [
    activeTextureDetailChunkSize,
    detailChunkScaleEnabled,
    manifest,
    transform,
    unobscuredViewport,
  ]);

  const candidateDetailChunkRequestCount = candidateVisibleChunkKeys.length * activeRasterLayers.length;
  const visibleChunkKeys = detailChunkScaleEnabled
    ? detailChunkKeysWithinBudget(
      candidateVisibleChunkKeys,
      activeRasterLayers.length,
      activeDetailChunkCacheLimit,
    )
    : [];
  const activeDetailChunkRequestCount = visibleChunkKeys.length * activeRasterLayers.length;
  const detailChunksEnabled = activeDetailChunkRequestCount > 0;

  const visibleChunkKey = `${activeDetailZoomKey}|s${activeTextureDetailChunkSize}|${visibleChunkKeys.join("|")}`;

  useEffect(() => {
    visibleChunkKeysRef.current = activeRasterLayers.flatMap((requestedLayer) =>
      visibleChunkKeys.map((key) =>
        chunkRecordKey(
          requestedLayer,
          key,
          activeTextureDetailZoomBucket,
          activeTextureDetailChunkSize,
        )
      )
    );
  }, [
    activeRasterLayerKey,
    activeRasterLayers,
    activeTextureDetailChunkSize,
    activeTextureDetailZoomBucket,
    visibleChunkKey,
    visibleChunkKeys,
  ]);

  useEffect(() => {
    if (!detailChunksEnabled) {
      if (Object.keys(chunksRef.current).length === 0) {
        return;
      }
      chunksRef.current = {};
      setChunks({});
      return;
    }

    setChunks((current) => {
      const next = pruneChunkRecord(
        current,
        visibleChunkKeysRef.current,
        activeDetailChunkCacheLimit,
      );
      if (next === current) {
        return current;
      }
      chunksRef.current = next;
      return next;
    });
  }, [activeDetailChunkCacheLimit, activeRasterLayerKey, detailChunksEnabled, visibleChunkKey]);

  useEffect(() => {
    if (!projectId || !mapName || !manifest) {
      return;
    }
    if (visibleChunkKeys.length === 0) {
      queueVisibleDetailChunks([], {
        chunkSourceKey,
        projectId,
        mapName,
        layers: activeRasterLayers,
        zoomBucket: activeTextureDetailZoomBucket,
        chunkSize: activeTextureDetailChunkSize,
        sourceGuard: manifest.source,
      });
      return;
    }

    pendingChunkLoadRef.current = true;
    syncDetailLoadActivity();
    const timeout = window.setTimeout(() => {
      queueVisibleDetailChunks(visibleChunkKeys, {
        chunkSourceKey,
        projectId,
        mapName,
        layers: activeRasterLayers,
        zoomBucket: activeTextureDetailZoomBucket,
        chunkSize: activeTextureDetailChunkSize,
        sourceGuard: manifest.source,
      });
    }, DETAIL_CHUNK_LOAD_DELAY_MS);

    return () => {
      pendingChunkLoadRef.current = false;
      syncDetailLoadActivity();
      window.clearTimeout(timeout);
    };
  }, [
    projectId,
    mapName,
    manifest,
    activeRasterLayerKey,
    activeRasterLayers,
    activeTextureDetailChunkSize,
    activeTextureDetailZoomBucket,
    visibleChunkKey,
    chunkSourceKey,
    queueVisibleDetailChunks,
    syncDetailLoadActivity,
  ]);

  const queueVisibleDetailChunksForTransform = useCallback((
    nextTransform: MapWorkbenchTransform,
    options: { throttle?: boolean } = {},
  ) => {
    if (
      !projectId
      || !mapName
      || !manifest
      || !chunkSourceKey
      || !initialFitAppliedRef.current
    ) {
      return;
    }

    const zoomBucket = textureDetailZoomBucket(nextTransform.scale);
    const chunkSize = textureDetailChunkSizeFor(zoomBucket, manifest.chunk_size);
    const nextDetailChunkCacheLimit = detailChunkCacheLimitFor(
      activeRasterLayers,
      zoomBucket,
      chunkSize,
      manifest.chunk_size,
    );
    const context: DetailChunkQueueContext = {
      chunkSourceKey,
      projectId,
      mapName,
      layers: activeRasterLayers,
      zoomBucket,
      chunkSize,
      sourceGuard: manifest.source,
    };
    const clearCurrentDetailWindow = () => {
      lastDragDetailChunkWindowRef.current = "";
      queueVisibleDetailChunks([], context);
    };

    if (!shouldLoadDetailChunks(nextTransform.scale, DETAIL_CHUNK_MIN_SCALE)) {
      clearCurrentDetailWindow();
      return;
    }

    const nextVisibleChunkKeys = getPrioritizedVisibleChunkKeys(
      manifest,
      unobscuredViewport,
      nextTransform,
      1,
      chunkSize,
    );
    const nextQueueChunkKeys = detailChunkKeysWithinBudget(
      nextVisibleChunkKeys,
      activeRasterLayers.length,
      nextDetailChunkCacheLimit,
    );
    if (nextQueueChunkKeys.length === 0) {
      clearCurrentDetailWindow();
      return;
    }

    const nextWindowKey = [
      chunkSourceKey,
      activeRasterLayerKey,
      activeRasterLayers.some(isTextureDetailLayer) ? zoomBucket : 0,
      chunkSize,
      nextQueueChunkKeys.join("|"),
    ].join(":");
    if (nextWindowKey === lastDragDetailChunkWindowRef.current) {
      return;
    }

    if (options.throttle) {
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (
        lastDragDetailChunkQueueAtRef.current > 0
        && now - lastDragDetailChunkQueueAtRef.current < DRAG_DETAIL_CHUNK_QUEUE_INTERVAL_MS
      ) {
        return;
      }
      lastDragDetailChunkQueueAtRef.current = now;
    }
    lastDragDetailChunkWindowRef.current = nextWindowKey;

    queueVisibleDetailChunks(nextQueueChunkKeys, {
      chunkSourceKey: context.chunkSourceKey,
      projectId: context.projectId,
      mapName: context.mapName,
      layers: context.layers,
      zoomBucket: context.zoomBucket,
      chunkSize: context.chunkSize,
      sourceGuard: context.sourceGuard,
    });
  }, [
    activeRasterLayerKey,
    activeRasterLayers,
    chunkSourceKey,
    manifest,
    mapName,
    projectId,
    queueVisibleDetailChunks,
    unobscuredViewport,
  ]);

  const applyZoomAtPoint = useCallback((point: MapPoint, direction: number) => {
    const nextTransform = applyTransform((current) =>
      zoomAt(
        current,
        point,
        direction,
        MIN_SCALE,
        MAX_SCALE,
      )
    );
    queueVisibleDetailChunksForTransform(nextTransform);
    drawWithTransformRef.current?.(nextTransform);
    return nextTransform;
  }, [applyTransform, queueVisibleDetailChunksForTransform]);

  const viewportBounds = useMemo(() => {
    if (!manifest) {
      return null;
    }
    return tileBoundsForViewport(manifest, unobscuredViewport, transform);
  }, [manifest, transform, unobscuredViewport]);

  useEffect(() => {
    viewportBoundsRef.current = viewportBounds;
  }, [viewportBounds]);

  useEffect(() => {
    onViewportBoundsChange?.(viewportBounds, manifest?.name ?? null);
  }, [
    manifest?.name,
    onViewportBoundsChange,
    viewportBounds?.minX,
    viewportBounds?.minY,
    viewportBounds?.maxX,
    viewportBounds?.maxY,
  ]);

  const navigatorFrame = useMemo(() => {
    if (!manifest) {
      return null;
    }
    return fitMapToNavigator(manifest, {
      width: NAVIGATOR_WIDTH,
      height: NAVIGATOR_HEIGHT,
    });
  }, [manifest]);

  const navigatorViewport = useMemo(() => {
    if (!viewportBounds || !navigatorFrame) {
      return null;
    }
    return navigatorViewportRect(viewportBounds, navigatorFrame);
  }, [navigatorFrame, viewportBounds]);

  const placementBoundsKey = viewportBounds
    ? [
        Math.floor(viewportBounds.minX),
        Math.floor(viewportBounds.minY),
        Math.ceil(viewportBounds.maxX),
        Math.ceil(viewportBounds.maxY),
      ].join(":")
    : "";
  const placementQueryBounds = useMemo(() => {
    if (!manifest || !viewportBounds) {
      return null;
    }

    const pad = 64;
    return {
      minX: Math.max(0, Math.floor(viewportBounds.minX) - pad),
      minY: Math.max(0, Math.floor(viewportBounds.minY) - pad),
      maxX: Math.min(manifest.width, Math.ceil(viewportBounds.maxX) + pad),
      maxY: Math.min(manifest.height, Math.ceil(viewportBounds.maxY) + pad),
    };
  }, [manifest, placementBoundsKey]);
  const placementViewportQueryBounds = useMemo(() => {
    if (!manifest || !viewportBounds) {
      return null;
    }

    return {
      minX: Math.max(0, Math.floor(viewportBounds.minX)),
      minY: Math.max(0, Math.floor(viewportBounds.minY)),
      maxX: Math.min(manifest.width, Math.ceil(viewportBounds.maxX)),
      maxY: Math.min(manifest.height, Math.ceil(viewportBounds.maxY)),
    };
  }, [manifest, placementBoundsKey]);
  const placementFilterQuery = placementFilter?.query.trim() ?? "";
  const placementFilterType = placementFilter?.placementType ?? "all";
  const placementFilterManualNear = Boolean(
    placementFilter?.nearEnabled
    && placementFilter.nearX != null
    && placementFilter.nearY != null
    && placementFilter.nearRadius != null,
  );
  const placementFilterActive = Boolean(
    placementFilter?.valid
    && (
      placementFilterQuery !== ""
      || placementFilterType !== "all"
      || placementFilterManualNear
      || placementFilter.useVisibleBounds
    ),
  );

  useEffect(() => {
    if (placementFilterActive) {
      setShowPlacements(true);
    }
  }, [placementFilterActive]);

  const placementFilterBounds = placementFilter?.nearEnabled || placementFilter?.useVisibleBounds
    ? placementViewportQueryBounds
    : placementQueryBounds;
  const hasQueryableRboRecords = Boolean(
    manifest?.rbo_summary.present
    && manifest.rbo_summary.record_count > 0
    && (
      manifest.rbo_source.content_sha256
      || manifest.rbo_source.map_file_len > 0
    ),
  );
  const rboRecordSourceKey = manifest
    ? [
        manifest.name,
        manifest.rbo_source.map_modified_ms,
        manifest.rbo_source.map_file_len,
        manifest.rbo_source.content_sha256,
        manifest.rbo_summary.record_count,
      ].join(":")
    : "";
  const placementFilterKey = [
    placementFilter?.valid ? "valid" : "invalid",
    placementFilterQuery,
    placementFilterType,
    placementFilter?.nearEnabled ? "near" : "far",
    placementFilter?.nearX ?? "",
    placementFilter?.nearY ?? "",
    placementFilter?.nearRadius ?? "",
    placementFilter?.useVisibleBounds ? "view" : "",
  ].join(":");

  useEffect(() => {
    if (
      !projectId
      || !mapName
      || !manifest
      || !placementFilterBounds
      || !showPlacements
      || (!detailChunkScaleEnabled && !placementFilter?.nearEnabled)
      || placementFilter?.valid === false
    ) {
      setVisiblePlacements([]);
      return;
    }

    const version = placementGuard.current.begin();
    const timeout = window.setTimeout(() => {
      const request = placementFilterActive
        ? queryMapPlacements(
          projectId,
          mapName,
          placementFilterQuery || undefined,
          placementFilterType,
          placementFilterManualNear ? placementFilter?.nearX : undefined,
          placementFilterManualNear ? placementFilter?.nearY : undefined,
          placementFilterManualNear ? placementFilter?.nearRadius : undefined,
          0,
          PLACEMENT_QUERY_LIMIT,
          placementFilterBounds.minX,
          placementFilterBounds.minY,
          placementFilterBounds.maxX,
          placementFilterBounds.maxY,
        )
        : queryMapPlacementsInBounds(
          projectId,
          mapName,
          placementFilterBounds.minX,
          placementFilterBounds.minY,
          placementFilterBounds.maxX,
          placementFilterBounds.maxY,
          PLACEMENT_QUERY_LIMIT,
        );

      request
        .then((page) => {
          if (placementGuard.current.isLatest(version)) {
            setVisiblePlacements(page.items);
          }
        })
        .catch(() => {
          if (placementGuard.current.isLatest(version)) {
            setVisiblePlacements([]);
          }
        });
    }, 120);

    return () => {
      window.clearTimeout(timeout);
      placementGuard.current.invalidate();
    };
  }, [
    projectId,
    mapName,
    manifest,
    placementFilterBounds,
    placementBoundsKey,
    placementFilterActive,
    placementFilterKey,
    placementFilterManualNear,
    placementFilterQuery,
    placementFilterType,
    showPlacements,
    detailChunkScaleEnabled,
  ]);

  useEffect(() => {
    if (
      !projectId
      || !mapName
      || !manifest
      || !placementViewportQueryBounds
      || !showPlacements
      || !detailChunkScaleEnabled
      || !hasQueryableRboRecords
    ) {
      if (visibleRboRecordsRef.current.length > 0 || visibleRboRecordTotalRef.current > 0) {
        visibleRboRecordsRef.current = [];
        visibleRboRecordTotalRef.current = 0;
        setVisibleRboRecords([]);
        setVisibleRboRecordTotal(0);
      }
      return;
    }

    const version = rboRecordGuard.current.begin();
    const timeout = window.setTimeout(() => {
      queryMapRboRecordsInBounds(
        projectId,
        mapName,
        placementViewportQueryBounds.minX,
        placementViewportQueryBounds.minY,
        placementViewportQueryBounds.maxX,
        placementViewportQueryBounds.maxY,
        RBO_RECORD_QUERY_LIMIT,
      )
        .then((page) => {
          if (rboRecordGuard.current.isLatest(version)) {
            visibleRboRecordsRef.current = page.items;
            visibleRboRecordTotalRef.current = page.total;
            setVisibleRboRecords(page.items);
            setVisibleRboRecordTotal(page.total);
          }
        })
        .catch(() => {
          if (rboRecordGuard.current.isLatest(version)) {
            visibleRboRecordsRef.current = [];
            visibleRboRecordTotalRef.current = 0;
            setVisibleRboRecords([]);
            setVisibleRboRecordTotal(0);
          }
        });
    }, 120);

    return () => {
      window.clearTimeout(timeout);
      rboRecordGuard.current.invalidate();
    };
  }, [
    projectId,
    mapName,
    manifest,
    placementViewportQueryBounds,
    placementBoundsKey,
    showPlacements,
    detailChunkScaleEnabled,
    hasQueryableRboRecords,
    rboRecordSourceKey,
  ]);

  const baseRenderedPlacements = useMemo(
    () => {
      if (showPlacements) {
        return dedupePlacements(visiblePlacements, selectedPlacement);
      }
      return selectedPlacement ? [selectedPlacement] : [];
    },
    [visiblePlacements, selectedPlacement, showPlacements],
  );

  const sourceRenderedPlacements = useMemo(
    () => includeStagedPlacementSources(baseRenderedPlacements, pendingPlacementSources),
    [baseRenderedPlacements, pendingPlacementSources],
  );

  const terrainTextureById = useMemo(
    () => new Map(terrainTextureCatalog.map((texture) => [texture.id, texture])),
    [terrainTextureCatalog],
  );
  const activeTexturePreviewIds = useMemo(() => {
    const draftIds = tileDraft?.textureLayers.map((textureLayer) => textureLayer.textureId) ?? [];
    const inspectionIds = inspection?.texture_layers.map((textureLayer) => textureLayer.texture_id) ?? [];
    const ids = [...draftIds, ...inspectionIds]
      .filter((textureId) => textureId > 0 && terrainTextureById.has(textureId));

    return Array.from(new Set(ids)).sort((left, right) => left - right);
  }, [inspection, terrainTextureById, tileDraft]);
  const activeTexturePreviewKey = activeTexturePreviewIds.join(",");
  const selectedTileTexturePreviewKey = inspection
    ? [
        manifest?.source.content_sha256 ?? "",
        manifest?.source.map_file_len ?? 0,
        manifest?.source.map_modified_ms ?? 0,
        inspection.tile_x,
        inspection.tile_y,
        inspection.native.bt_tile_info,
        inspection.native.dw_tile_info,
        inspection.native.s_color,
        inspection.native.c_height,
        inspection.texture_layers
          .map((slot) => `${slot.slot}:${slot.texture_id}:${slot.alpha}`)
          .join(","),
      ].join("|")
    : "";

  useEffect(() => {
    if (!projectId || activeTexturePreviewIds.length === 0) {
      return;
    }

    for (const textureId of activeTexturePreviewIds) {
      if (
        Object.prototype.hasOwnProperty.call(terrainTexturePreviewsById, textureId)
        || terrainTexturePreviewRequestsRef.current.has(textureId)
      ) {
        continue;
      }

      terrainTexturePreviewRequestsRef.current.add(textureId);
      const requestProjectId = projectId;
      getTerrainTexturePreview(projectId, textureId)
        .then((previewDataUri) => {
          setTerrainTexturePreviewsById((current) => {
            if (
              terrainTexturePreviewProjectRef.current !== requestProjectId
              || Object.prototype.hasOwnProperty.call(current, textureId)
            ) {
              return current;
            }

            return {
              ...current,
              [textureId]: previewDataUri ?? null,
            };
          });
        })
        .catch(() => {
          setTerrainTexturePreviewsById((current) => {
            if (
              terrainTexturePreviewProjectRef.current !== requestProjectId
              || Object.prototype.hasOwnProperty.call(current, textureId)
            ) {
              return current;
            }

            return {
              ...current,
              [textureId]: null,
            };
          });
        })
        .finally(() => {
          terrainTexturePreviewRequestsRef.current.delete(textureId);
        });
    }
  }, [
    activeTexturePreviewIds,
    activeTexturePreviewKey,
    projectId,
    terrainTexturePreviewsById,
  ]);

  useEffect(() => {
    const currentInspection = inspection;
    if (
      !projectId
      || !mapName
      || !manifest
      || !currentInspection
      || !currentInspection.texture_layers.some((slot) => slot.texture_id > 0)
    ) {
      tileTexturePreviewGuard.current.invalidate();
      setTileTexturePreview(null);
      setTileTexturePreviewLoading(false);
      return;
    }

    const version = tileTexturePreviewGuard.current.begin();
    const tileX = currentInspection.tile_x;
    const tileY = currentInspection.tile_y;
    setTileTexturePreview(null);
    setTileTexturePreviewLoading(true);
    getMapTileTexturePreview(projectId, mapName, tileX, tileY, manifest.source)
      .then((preview) => {
        if (!tileTexturePreviewGuard.current.isLatest(version)) {
          return;
        }
        if (preview && (preview.tile_x !== tileX || preview.tile_y !== tileY)) {
          return;
        }
        setTileTexturePreview(preview);
      })
      .catch(() => {
        if (tileTexturePreviewGuard.current.isLatest(version)) {
          setTileTexturePreview(null);
        }
      })
      .finally(() => {
        if (tileTexturePreviewGuard.current.isLatest(version)) {
          setTileTexturePreviewLoading(false);
        }
      });

    return () => {
      tileTexturePreviewGuard.current.invalidate();
    };
  }, [
    inspection,
    selectedTileTexturePreviewKey,
    projectId,
    mapName,
    manifest,
  ]);

  const deletedPlacementIndices = useMemo(
    () => new Set(Object.values(pendingPlacementDeletes).map((edit) => edit.index)),
    [pendingPlacementDeletes],
  );
  const selectedPlacementKey = selectedPlacement
    ? mapPlacementKey(selectedPlacement.index)
    : null;
  const selectedPlacementDeleteStaged = Boolean(
    selectedPlacementKey && pendingPlacementDeletes[selectedPlacementKey],
  );
  const placementSelectionItems = useMemo(
    () => Object.values(placementSelectionGroup).sort((left, right) => left.index - right.index),
    [placementSelectionGroup],
  );
  const placementSelectionCount = placementSelectionItems.length;
  const selectedPlacementInGroup = Boolean(
    selectedPlacementKey && placementSelectionGroup[selectedPlacementKey],
  );
  const selectedPendingPlacementPatch = selectedPlacementKey
    ? pendingPlacementPatches[selectedPlacementKey]
    : undefined;

  const stagedAddPlacements = useMemo(
    () => Object.entries(pendingPlacementAdds).map(([key, edit]) =>
      createTemporaryPlacementFromAddEdit(edit, Number(key))
    ),
    [pendingPlacementAdds],
  );

  const renderedPlacements = useMemo(
    () => [
      ...sourceRenderedPlacements
        .filter((placement) =>
          !deletedPlacementIndices.has(placement.index)
          && !pendingPlacementAdds[mapPlacementKey(placement.index)]
        )
        .map((placement) => {
          const key = mapPlacementKey(placement.index);
          const selectedDraftPatch = selectedPlacement?.index === placement.index
            && selectedPlacement.index >= 0
            && placementDraft
            && !pendingPlacementDeletes[key]
            ? createPlacementPatchFromDraft(selectedPlacement, placementDraft)
            : null;
          return applyPlacementPatch(
            placement,
            selectedDraftPatch ?? pendingPlacementPatches[key],
          );
        }),
      ...stagedAddPlacements,
    ],
    [
      sourceRenderedPlacements,
      pendingPlacementPatches,
      pendingPlacementAdds,
      deletedPlacementIndices,
      stagedAddPlacements,
      selectedPlacement,
      placementDraft,
      pendingPlacementDeletes,
    ],
  );

  const pinnedPlacementKeys = useMemo(() => {
    const keys = new Set<string>();
    if (selectedPlacementKey) {
      keys.add(selectedPlacementKey);
    }
    for (const key of Object.keys(pendingPlacementPatches)) {
      keys.add(key);
    }
    for (const key of Object.keys(pendingPlacementAdds)) {
      keys.add(key);
    }
    for (const key of Object.keys(placementSelectionGroup)) {
      keys.add(key);
    }
    return keys;
  }, [selectedPlacementKey, pendingPlacementPatches, pendingPlacementAdds, placementSelectionGroup]);

  const markerPlacements = useMemo(
    () => {
      const density = PLACEMENT_MARKER_DENSITIES[placementMarkerDensity];
      return selectPlacementMarkersForViewport({
        placements: renderedPlacements,
        transform,
        viewport,
        pinnedKeys: pinnedPlacementKeys,
        minSpacingPx: density.minSpacingPx,
        maxMarkers: density.maxMarkers,
      });
    },
    [placementMarkerDensity, renderedPlacements, transform, viewport, pinnedPlacementKeys],
  );
  const hiddenPlacementMarkerCount = Math.max(0, renderedPlacements.length - markerPlacements.length);
  const selectedPlacementForView = useMemo(
    () => selectedPlacement
      ? renderedPlacements.find((placement) => placement.index === selectedPlacement.index)
        ?? selectedPlacement
      : null,
    [renderedPlacements, selectedPlacement],
  );

  useEffect(() => {
    renderedPlacementsRef.current = renderedPlacements;
  }, [renderedPlacements]);

  useEffect(() => {
    markerPlacementsRef.current = markerPlacements;
  }, [markerPlacements]);

  useEffect(() => {
    visibleRboRecordsRef.current = visibleRboRecords;
  }, [visibleRboRecords]);

  useEffect(() => {
    visibleRboRecordTotalRef.current = visibleRboRecordTotal;
  }, [visibleRboRecordTotal]);

  useEffect(() => {
    onSelectedPlacementViewChange?.(selectedPlacementForView);
  }, [onSelectedPlacementViewChange, selectedPlacementForView]);

  const hittablePlacements = useMemo(
    () => markerPlacements.filter((placement) => {
      const selected = selectedPlacement?.index === placement.index;
      return Boolean(getPlacementMarkerVisual({
        selected,
        scale: transform.scale,
        overlayEnabled: showPlacements,
      }));
    }),
    [markerPlacements, selectedPlacement, showPlacements, transform.scale],
  );

  const inspectedTileKey = inspection ? mapTileKey(inspection.tile_x, inspection.tile_y) : null;
  const inspectedPendingPatch = inspectedTileKey ? pendingPatches[inspectedTileKey] : undefined;
  const inspectedTileDraftSourceKey = inspection
    ? [
        inspectedTileKey,
        inspection.native.dw_tile_info,
        inspection.native.bt_tile_info,
        inspection.native.s_color,
        inspection.native.c_height,
        inspection.native.s_region,
        inspection.native.bt_island,
        ...inspection.native.bt_block,
      ].join(":")
    : "none";

  useEffect(() => {
    if (!inspection) {
      setTileDraft(null);
      setPlacementAddDraft(null);
      setPlacementAddEditorOpen(false);
      return;
    }

    const preservedDraft = preservedTileDraftRef.current;
    if (preservedDraft?.key === inspectedTileKey) {
      if (exportReloadPendingRef.current) {
        return;
      }
      preservedTileDraftRef.current = null;
      setTileDraft(preservedDraft.draft);
      return;
    }
    preservedTileDraftRef.current = null;
    setTileDraft(createTileEditDraft(inspection, inspectedPendingPatch));
    setPlacementAddDraft((current) => {
      const next = createPlacementAddDraft({
        x: inspection.tile_x,
        y: inspection.tile_y,
      });
      return current
        ? {
            ...current,
            worldX: next.worldX,
            worldY: next.worldY,
          }
        : next;
    });
  }, [inspectedPendingPatch, inspectedTileDraftSourceKey, inspectedTileKey]);

  useEffect(() => {
    if (!selectedPlacement) {
      setPlacementDraft(null);
      return;
    }

    const preservedDraft = preservedPlacementDraftRef.current;
    if (preservedDraft?.key === selectedPlacementKey) {
      preservedPlacementDraftRef.current = null;
      setPlacementDraft(preservedDraft.draft);
      return;
    }
    preservedPlacementDraftRef.current = null;
    setPlacementDraft(createPlacementEditDraft(
      selectedPlacement,
      selectedPendingPlacementPatch,
    ));
  }, [selectedPendingPlacementPatch, selectedPlacement, selectedPlacementKey]);

  const refreshNearbyPlacementsForTile = useCallback((tileX: number, tileY: number) => {
    const currentProjectId = projectIdRef.current;
    const currentMapName = mapNameRef.current;
    const currentSourceKey = mapInspectionSourceKey(
      currentProjectId,
      currentMapName,
      manifestRef.current,
    ) || inspectionSourceRef.current;
    if (!currentProjectId || !currentMapName || !currentSourceKey) {
      return;
    }

    const tileKey = mapTileKey(tileX, tileY);
    const cacheKey = `${currentSourceKey}|${tileKey}`;
    let placementRequest = tilePlacementRequestsRef.current.get(cacheKey);
    if (!placementRequest) {
      placementRequest = queryMapPlacementsInBounds(
        currentProjectId,
        currentMapName,
        tileX,
        tileY,
        tileX + 1,
        tileY + 1,
        32,
      );
      tilePlacementRequestsRef.current.set(cacheKey, placementRequest);
      placementRequest
        .finally(() => {
          if (tilePlacementRequestsRef.current.get(cacheKey) === placementRequest) {
            tilePlacementRequestsRef.current.delete(cacheKey);
          }
        })
        .catch(() => undefined);
    }

    placementRequest
      .then((page) => {
        if (inspectionSourceRef.current !== currentSourceKey) {
          return;
        }
        const cachedInspection = tileInspectionCacheRef.current.get(cacheKey);
        if (cachedInspection) {
          cacheTileInspection(tileInspectionCacheRef.current, cacheKey, {
            ...cachedInspection,
            nearby_placements: page.items,
          }, tileExactPlacementKeysRef.current);
          tileExactPlacementKeysRef.current.add(cacheKey);
        }
        setInspection((current) => {
          if (
            !current
            || inspectionCacheKeyRef.current !== cacheKey
            || current.tile_x !== tileX
            || current.tile_y !== tileY
          ) {
            return current;
          }
          const next = {
            ...current,
            nearby_placements: page.items,
          };
          inspectionRef.current = next;
          lastHydratedInspectionRef.current = next;
          return next;
        });
      })
      .catch(() => undefined);
  }, []);

  const pumpTileInspectionPrefetchQueue = useCallback(function pumpTileInspectionPrefetchQueue() {
    if (tileInspectionPrefetchActiveRef.current) {
      return;
    }

    const request = tileInspectionPrefetchQueueRef.current.shift();
    if (!request) {
      return;
    }
    tileInspectionPrefetchKeysRef.current.delete(request.cacheKey);

    if (
      inspectionSourceRef.current !== request.sourceKey
      || tileInspectionCacheRef.current.has(request.cacheKey)
    ) {
      pumpTileInspectionPrefetchQueue();
      return;
    }

    let inspectionRequest = tileInspectionRequestsRef.current.get(request.cacheKey);
    if (!inspectionRequest) {
      inspectionRequest = Promise.resolve().then(() => inspectMapTile(
        request.projectId,
        request.mapName,
        request.tileX,
        request.tileY,
        request.sourceGuard,
      ));
      tileInspectionRequestsRef.current.set(request.cacheKey, inspectionRequest);
      inspectionRequest
        .finally(() => {
          if (tileInspectionRequestsRef.current.get(request.cacheKey) === inspectionRequest) {
            tileInspectionRequestsRef.current.delete(request.cacheKey);
          }
        })
        .catch(() => undefined);
    }

    const prefetchToken = tileInspectionPrefetchTokenRef.current + 1;
    tileInspectionPrefetchTokenRef.current = prefetchToken;
    tileInspectionPrefetchActiveRef.current = true;
    inspectionRequest
      .then((nextInspection) => {
        if (
          tileInspectionPrefetchTokenRef.current !== prefetchToken
          || !nextInspection
          || inspectionSourceRef.current !== request.sourceKey
        ) {
          return;
        }
        tileExactPlacementKeysRef.current.delete(request.cacheKey);
        cacheTileInspection(
          tileInspectionCacheRef.current,
          request.cacheKey,
          nextInspection,
          tileExactPlacementKeysRef.current,
        );
      })
      .catch(() => undefined)
      .finally(() => {
        if (tileInspectionPrefetchTokenRef.current !== prefetchToken) {
          return;
        }
        tileInspectionPrefetchActiveRef.current = false;
        if (tileInspectionPrefetchQueueRef.current.length > 0) {
          window.setTimeout(pumpTileInspectionPrefetchQueue, 0);
        }
      });
  }, []);

  const queueTileInspectionPrefetch = useCallback((
    tileX: number,
    tileY: number,
    sourceKey: string,
    options: { priority?: boolean } = {},
  ): boolean => {
    const currentProjectId = projectIdRef.current;
    const currentMapName = mapNameRef.current;
    const currentManifest = manifestRef.current;
    if (!currentProjectId || !currentMapName || !currentManifest || !sourceKey) {
      return false;
    }

    const nextTileX = Math.trunc(tileX);
    const nextTileY = Math.trunc(tileY);
    if (
      !Number.isFinite(tileX)
      || !Number.isFinite(tileY)
      || nextTileX < 0
      || nextTileY < 0
      || nextTileX >= currentManifest.width
      || nextTileY >= currentManifest.height
    ) {
      return false;
    }

    const cacheKey = `${sourceKey}|${mapTileKey(nextTileX, nextTileY)}`;
    if (
      tileInspectionCacheRef.current.has(cacheKey)
      || tileInspectionRequestsRef.current.has(cacheKey)
      || tileInspectionPrefetchKeysRef.current.has(cacheKey)
    ) {
      return false;
    }

    tileInspectionPrefetchKeysRef.current.add(cacheKey);
    const request = {
      cacheKey,
      sourceKey,
      projectId: currentProjectId,
      mapName: currentMapName,
      tileX: nextTileX,
      tileY: nextTileY,
      sourceGuard: currentManifest.source,
    };
    if (options.priority) {
      tileInspectionPrefetchQueueRef.current.unshift(request);
    } else {
      tileInspectionPrefetchQueueRef.current.push(request);
    }
    pumpTileInspectionPrefetchQueue();
    return true;
  }, [pumpTileInspectionPrefetchQueue]);

  const queueAdjacentTileInspectionPrefetch = useCallback((tileX: number, tileY: number, sourceKey: string) => {
    const adjacentTiles = [
      [tileX + 1, tileY],
      [tileX - 1, tileY],
      [tileX, tileY + 1],
      [tileX, tileY - 1],
      [tileX + 1, tileY + 1],
      [tileX + 1, tileY - 1],
      [tileX - 1, tileY + 1],
      [tileX - 1, tileY - 1],
    ] as const;
    for (const [nextTileX, nextTileY] of adjacentTiles) {
      queueTileInspectionPrefetch(nextTileX, nextTileY, sourceKey);
    }
  }, [queueTileInspectionPrefetch]);

  const clearHoverTileInspectionPrefetch = useCallback(() => {
    if (hoverTilePrefetchTimeoutRef.current !== null) {
      window.clearTimeout(hoverTilePrefetchTimeoutRef.current);
      hoverTilePrefetchTimeoutRef.current = null;
    }
    hoverTilePrefetchKeyRef.current = "";
  }, []);

  const scheduleHoverTileInspectionPrefetch = useCallback((tile: MapPoint) => {
    const currentManifest = manifestRef.current;
    const currentProjectId = projectIdRef.current;
    const currentMapName = mapNameRef.current;
    const sourceKey = mapInspectionSourceKey(
      currentProjectId,
      currentMapName,
      currentManifest,
    ) || inspectionSourceRef.current;
    const tileX = Math.floor(tile.x);
    const tileY = Math.floor(tile.y);

    if (
      !currentManifest
      || !sourceKey
      || transformRef.current.scale < HOVER_TILE_PREFETCH_MIN_SCALE
      || interactionModeRef.current !== "select"
      || tilePaintModeRef.current
      || tileX < 0
      || tileY < 0
      || tileX >= currentManifest.width
      || tileY >= currentManifest.height
    ) {
      clearHoverTileInspectionPrefetch();
      return;
    }

    const cacheKey = `${sourceKey}|${mapTileKey(tileX, tileY)}`;
    if (
      hoverTilePrefetchKeyRef.current !== ""
      && hoverTilePrefetchKeyRef.current !== cacheKey
    ) {
      clearHoverTileInspectionPrefetch();
    }
    if (
      hoverTilePrefetchKeyRef.current === cacheKey
      || tileInspectionCacheRef.current.has(cacheKey)
      || tileInspectionRequestsRef.current.has(cacheKey)
      || tileInspectionPrefetchKeysRef.current.has(cacheKey)
    ) {
      return;
    }

    clearHoverTileInspectionPrefetch();
    hoverTilePrefetchKeyRef.current = cacheKey;
    hoverTilePrefetchTimeoutRef.current = window.setTimeout(() => {
      hoverTilePrefetchTimeoutRef.current = null;
      if (hoverTilePrefetchKeyRef.current !== cacheKey) {
        return;
      }
      const latestManifest = manifestRef.current;
      const latestSourceKey = mapInspectionSourceKey(
        projectIdRef.current,
        mapNameRef.current,
        latestManifest,
      ) || inspectionSourceRef.current;
      if (
        !latestManifest
        || latestSourceKey !== sourceKey
        || transformRef.current.scale < HOVER_TILE_PREFETCH_MIN_SCALE
        || interactionModeRef.current !== "select"
        || tilePaintModeRef.current
        || tileX < 0
        || tileY < 0
        || tileX >= latestManifest.width
        || tileY >= latestManifest.height
      ) {
        clearHoverTileInspectionPrefetch();
        return;
      }
      queueTileInspectionPrefetch(tileX, tileY, sourceKey, { priority: true });
    }, HOVER_TILE_PREFETCH_DELAY_MS);
  }, [clearHoverTileInspectionPrefetch, queueTileInspectionPrefetch]);

  const clearCenterTileInspectionPrefetch = useCallback(() => {
    if (centerTilePrefetchTimeoutRef.current !== null) {
      window.clearTimeout(centerTilePrefetchTimeoutRef.current);
      centerTilePrefetchTimeoutRef.current = null;
    }
    centerTilePrefetchKeyRef.current = "";
  }, []);

  const getViewportCenterTile = useCallback((currentTransform: MapWorkbenchTransform): MapPoint => {
    const currentViewport = viewportRef.current;
    const width = Math.max(1, currentViewport.width - rightOverlayInsetRef.current);
    return screenToTile(width / 2, currentViewport.height / 2, currentTransform);
  }, []);

  const scheduleCenterTileInspectionPrefetch = useCallback((
    currentTransform: MapWorkbenchTransform = transformRef.current,
  ) => {
    const currentManifest = manifestRef.current;
    const currentProjectId = projectIdRef.current;
    const currentMapName = mapNameRef.current;
    const sourceKey = mapInspectionSourceKey(
      currentProjectId,
      currentMapName,
      currentManifest,
    ) || inspectionSourceRef.current;
    const centerTile = getViewportCenterTile(currentTransform);
    const tileX = Math.floor(centerTile.x);
    const tileY = Math.floor(centerTile.y);

    if (
      !currentManifest
      || !sourceKey
      || currentTransform.scale < HOVER_TILE_PREFETCH_MIN_SCALE
      || interactionModeRef.current !== "select"
      || tilePaintModeRef.current
      || tileX < 0
      || tileY < 0
      || tileX >= currentManifest.width
      || tileY >= currentManifest.height
    ) {
      clearCenterTileInspectionPrefetch();
      return;
    }

    const cacheKey = `${sourceKey}|${mapTileKey(tileX, tileY)}`;
    if (
      centerTilePrefetchKeyRef.current !== ""
      && centerTilePrefetchKeyRef.current !== cacheKey
    ) {
      clearCenterTileInspectionPrefetch();
    }
    if (
      centerTilePrefetchKeyRef.current === cacheKey
      || tileInspectionCacheRef.current.has(cacheKey)
      || tileInspectionRequestsRef.current.has(cacheKey)
      || tileInspectionPrefetchKeysRef.current.has(cacheKey)
    ) {
      return;
    }

    clearCenterTileInspectionPrefetch();
    centerTilePrefetchKeyRef.current = cacheKey;
    centerTilePrefetchTimeoutRef.current = window.setTimeout(() => {
      centerTilePrefetchTimeoutRef.current = null;
      if (centerTilePrefetchKeyRef.current !== cacheKey) {
        return;
      }
      const latestManifest = manifestRef.current;
      const latestSourceKey = mapInspectionSourceKey(
        projectIdRef.current,
        mapNameRef.current,
        latestManifest,
      ) || inspectionSourceRef.current;
      const latestTransform = transformRef.current;
      const latestCenterTile = getViewportCenterTile(latestTransform);
      const latestTileX = Math.floor(latestCenterTile.x);
      const latestTileY = Math.floor(latestCenterTile.y);
      if (
        !latestManifest
        || latestSourceKey !== sourceKey
        || latestTransform.scale < HOVER_TILE_PREFETCH_MIN_SCALE
        || interactionModeRef.current !== "select"
        || tilePaintModeRef.current
        || latestTileX !== tileX
        || latestTileY !== tileY
        || tileX < 0
        || tileY < 0
        || tileX >= latestManifest.width
        || tileY >= latestManifest.height
      ) {
        clearCenterTileInspectionPrefetch();
        return;
      }
      queueTileInspectionPrefetch(tileX, tileY, sourceKey, { priority: true });
    }, CENTER_TILE_PREFETCH_DELAY_MS);
  }, [
    clearCenterTileInspectionPrefetch,
    getViewportCenterTile,
    queueTileInspectionPrefetch,
  ]);

  useEffect(() => {
    scheduleCenterTileInspectionPrefetch(transform);
    return clearCenterTileInspectionPrefetch;
  }, [
    clearCenterTileInspectionPrefetch,
    interactionMode,
    manifest,
    mapName,
    projectId,
    rightOverlayInset,
    scheduleCenterTileInspectionPrefetch,
    tilePaintMode,
    transform,
    viewport.height,
    viewport.width,
  ]);

  const inspectTile = useCallback(
    async (tileX: number, tileY: number): Promise<boolean> => {
      const version = inspectionGuard.current.begin();
      if (!projectId || !mapName || !manifest) {
        setInspection(null);
        inspectionRef.current = null;
        inspectionCacheKeyRef.current = null;
        lastHydratedInspectionRef.current = null;
        setSelectedTile(null);
        selectedTileRef.current = null;
        onSelectedTileChange?.(null);
        setInspectionLoading(false);
        return false;
      }
      const nextTileX = Math.trunc(tileX);
      const nextTileY = Math.trunc(tileY);
      if (
        !Number.isFinite(tileX)
        || !Number.isFinite(tileY)
        || nextTileX < 0
        || nextTileY < 0
        || nextTileX >= manifest.width
        || nextTileY >= manifest.height
      ) {
        setInspection(null);
        inspectionRef.current = null;
        inspectionCacheKeyRef.current = null;
        lastHydratedInspectionRef.current = null;
        setSelectedTile(null);
        selectedTileRef.current = null;
        onSelectedTileChange?.(null);
        setInspectionLoading(false);
        return false;
      }

      const rollbackInspection = lastHydratedInspectionRef.current;
      const rollbackTile = rollbackInspection
        ? { x: rollbackInspection.tile_x, y: rollbackInspection.tile_y }
        : null;
      const nextSelectedTile = { x: nextTileX, y: nextTileY };
      const tileKey = mapTileKey(nextTileX, nextTileY);
      const currentInspectionSourceKey = mapInspectionSourceKey(
        projectId,
        mapName,
        manifest,
      ) || inspectionSourceKey || inspectionSourceRef.current;
      const tileCacheKey = currentInspectionSourceKey
        ? `${currentInspectionSourceKey}|${tileKey}`
        : tileKey;

      const currentInspection = inspectionRef.current;
      if (
        currentInspection
        && inspectionCacheKeyRef.current === tileCacheKey
        && currentInspection.tile_x === nextTileX
        && currentInspection.tile_y === nextTileY
      ) {
        const hydratedInspection = tileExactPlacementKeysRef.current.has(tileCacheKey)
          ? {
              ...currentInspection,
              nearby_placements: [...currentInspection.nearby_placements],
            }
          : hydrateTileInspectionForView(
            currentInspection,
            renderedPlacementsRef.current,
          );
        setInspection(hydratedInspection);
        inspectionRef.current = hydratedInspection;
        inspectionCacheKeyRef.current = tileCacheKey;
        lastHydratedInspectionRef.current = hydratedInspection;
        setSelectedTile(nextSelectedTile);
        selectedTileRef.current = nextSelectedTile;
        onSelectedTileChange?.(nextSelectedTile);
        setInspectionLoading(false);
        queueAdjacentTileInspectionPrefetch(nextTileX, nextTileY, currentInspectionSourceKey);
        refreshNearbyPlacementsForTile(nextTileX, nextTileY);
        return true;
      }

      const cachedInspection = tileInspectionCacheRef.current.get(tileCacheKey);
      if (cachedInspection) {
        const hydratedInspection = tileExactPlacementKeysRef.current.has(tileCacheKey)
          ? {
              ...cachedInspection,
              nearby_placements: [...cachedInspection.nearby_placements],
            }
          : hydrateTileInspectionForView(
            cachedInspection,
            renderedPlacementsRef.current,
          );
        setInspection(hydratedInspection);
        inspectionRef.current = hydratedInspection;
        inspectionCacheKeyRef.current = tileCacheKey;
        lastHydratedInspectionRef.current = hydratedInspection;
        setSelectedTile(nextSelectedTile);
        selectedTileRef.current = nextSelectedTile;
        onSelectedTileChange?.(nextSelectedTile);
        setInspectionLoading(false);
        queueAdjacentTileInspectionPrefetch(nextTileX, nextTileY, currentInspectionSourceKey);
        refreshNearbyPlacementsForTile(nextTileX, nextTileY);
        return true;
      }

      setSelectedTile(nextSelectedTile);
      selectedTileRef.current = nextSelectedTile;
      onSelectedTileChange?.(nextSelectedTile);
      setInspectionLoading(true);
      try {
        let inspectionRequest = tileInspectionRequestsRef.current.get(tileCacheKey);
        if (!inspectionRequest) {
          inspectionRequest = Promise.resolve(inspectMapTile(
            projectId,
            mapName,
            nextTileX,
            nextTileY,
            manifest.source,
          ));
          tileInspectionRequestsRef.current.set(tileCacheKey, inspectionRequest);
          inspectionRequest
            .finally(() => {
              if (tileInspectionRequestsRef.current.get(tileCacheKey) === inspectionRequest) {
                tileInspectionRequestsRef.current.delete(tileCacheKey);
              }
            })
            .catch(() => undefined);
        }
        const nextInspection = await inspectionRequest;
        if (inspectionGuard.current.isLatest(version)) {
          const hydratedTile = {
            x: nextInspection.tile_x,
            y: nextInspection.tile_y,
          };
          const hydratedTileKey = mapTileKey(nextInspection.tile_x, nextInspection.tile_y);
          const hydratedCacheKey = currentInspectionSourceKey
            ? `${currentInspectionSourceKey}|${hydratedTileKey}`
            : hydratedTileKey;
          const hydratedInspection = {
            ...nextInspection,
            nearby_placements: placementsInsideTile(
              renderedPlacementsRef.current,
              nextInspection.tile_x,
              nextInspection.tile_y,
              32,
            ),
          };
          tileExactPlacementKeysRef.current.delete(hydratedCacheKey);
          cacheTileInspection(
            tileInspectionCacheRef.current,
            hydratedCacheKey,
            nextInspection,
            tileExactPlacementKeysRef.current,
          );
          setInspection(hydratedInspection);
          inspectionRef.current = hydratedInspection;
          inspectionCacheKeyRef.current = hydratedCacheKey;
          lastHydratedInspectionRef.current = hydratedInspection;
          setSelectedTile(hydratedTile);
          selectedTileRef.current = hydratedTile;
          onSelectedTileChange?.(hydratedTile);
          queueAdjacentTileInspectionPrefetch(
            nextInspection.tile_x,
            nextInspection.tile_y,
            currentInspectionSourceKey,
          );
          refreshNearbyPlacementsForTile(nextInspection.tile_x, nextInspection.tile_y);
          return true;
        }
        return isSameTile(selectedTileRef.current, {
          x: nextInspection.tile_x,
          y: nextInspection.tile_y,
        });
      } catch (error) {
        if (inspectionGuard.current.isLatest(version)) {
          setInspection(rollbackInspection);
          inspectionRef.current = rollbackInspection;
          inspectionCacheKeyRef.current = rollbackInspection && currentInspectionSourceKey
            ? `${currentInspectionSourceKey}|${mapTileKey(rollbackInspection.tile_x, rollbackInspection.tile_y)}`
            : null;
          setSelectedTile(rollbackTile);
          selectedTileRef.current = rollbackTile;
          onSelectedTileChange?.(rollbackTile);
          toast({
            title: "Failed to inspect tile",
            description: String(error),
            variant: "destructive",
          });
        }
        return false;
      } finally {
        if (inspectionGuard.current.isLatest(version)) {
          setInspectionLoading(false);
        }
      }
    },
    [
      projectId,
      mapName,
      manifest,
      inspectionSourceKey,
      onSelectedTileChange,
      queueAdjacentTileInspectionPrefetch,
      refreshNearbyPlacementsForTile,
    ],
  );

  const inspectAdjacentTile = useCallback((dx: number, dy: number) => {
    if (!inspection || !manifest) {
      return;
    }

    const tileX = inspection.tile_x + dx;
    const tileY = inspection.tile_y + dy;
    if (
      tileX < 0
      || tileY < 0
      || tileX >= manifest.width
      || tileY >= manifest.height
    ) {
      return;
    }

    onSelectPlacement(null);
    void inspectTile(tileX, tileY);
  }, [inspectTile, inspection, manifest, onSelectPlacement]);

  useEffect(() => {
    if (!manifest || manifestLoading) {
      return;
    }

    const tile = postReloadTileRef.current;
    if (!tile) {
      return;
    }

    postReloadTileRef.current = null;
    exportReloadPendingRef.current = false;
    void inspectTile(tile.x, tile.y);
  }, [inspectTile, manifest, manifestLoading]);

  useEffect(() => {
    if (!placementFocusRequest || !manifest || viewport.width <= 1 || viewport.height <= 1) {
      return;
    }

    const { placement } = placementFocusRequest;
    if (
      !Number.isFinite(placement.world_x)
      || !Number.isFinite(placement.world_y)
    ) {
      return;
    }

    applyTransform((current) =>
      centerTransformOnTile(
        {
          x: placement.world_x,
          y: placement.world_y,
        },
        unobscuredViewport,
        Math.max(current.scale, 4),
      )
    );
    void inspectTile(Math.floor(placement.world_x), Math.floor(placement.world_y));
  }, [applyTransform, inspectTile, manifest, placementFocusRequest, unobscuredViewport, viewport.height, viewport.width]);

  useEffect(() => {
    if (!import.meta.env.DEV || typeof window === "undefined") {
      return;
    }

    const getCanvasRectSnapshot = () => {
      const rect = canvasRef.current?.getBoundingClientRect();
      return rect
        ? {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height,
          }
        : null;
    };
    const getCanvasMetrics = (): MapCanvasMetrics | null => {
      const canvas = canvasRef.current;
      const rect = getCanvasRectSnapshot();
      if (!canvas || !rect || rect.width <= 0 || rect.height <= 0) {
        return null;
      }

      return {
        rect,
        bitmap: {
          width: canvas.width,
          height: canvas.height,
        },
        pixelRatio: {
          x: canvas.width / rect.width,
          y: canvas.height / rect.height,
        },
      };
    };
    const sampleCanvasPixel = (screenX: number, screenY: number): MapCanvasPixel | null => {
      const canvas = canvasRef.current;
      const metrics = getCanvasMetrics();
      if (
        !canvas
        || !metrics
        || !Number.isFinite(screenX)
        || !Number.isFinite(screenY)
        || screenX < metrics.rect.left
        || screenY < metrics.rect.top
        || screenX >= metrics.rect.left + metrics.rect.width
        || screenY >= metrics.rect.top + metrics.rect.height
      ) {
        return null;
      }

      const pixelX = Math.min(
        Math.max(0, Math.floor((screenX - metrics.rect.left) * metrics.pixelRatio.x)),
        Math.max(0, metrics.bitmap.width - 1),
      );
      const pixelY = Math.min(
        Math.max(0, Math.floor((screenY - metrics.rect.top) * metrics.pixelRatio.y)),
        Math.max(0, metrics.bitmap.height - 1),
      );
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return null;
      }

      try {
        const [r, g, b, a] = ctx.getImageData(pixelX, pixelY, 1, 1).data;
        return { x: pixelX, y: pixelY, r, g, b, a };
      } catch {
        return null;
      }
    };
    const sampleTilePixel = (tileX: number, tileY: number): MapCanvasPixel | null => {
      if (!Number.isFinite(tileX) || !Number.isFinite(tileY)) {
        return null;
      }
      const point = tileToScreen(tileX + 0.5, tileY + 0.5, transformRef.current);
      const rect = getCanvasRectSnapshot();
      return sampleCanvasPixel(
        point.x + (rect?.left ?? 0),
        point.y + (rect?.top ?? 0),
      );
    };
    const getUnobscuredCanvasRect = (
      metrics: MapCanvasMetrics,
    ): MapScreenRect => {
      const width = Math.max(
        1,
        Math.min(
          metrics.rect.width,
          metrics.rect.width - rightOverlayInsetRef.current,
        ),
      );
      return {
        left: metrics.rect.left,
        top: metrics.rect.top,
        right: metrics.rect.left + width,
        bottom: metrics.rect.top + metrics.rect.height,
        width,
        height: metrics.rect.height,
      };
    };
    const getMapScreenRect = (
      metrics: MapCanvasMetrics,
      unobscuredRect: MapScreenRect,
    ): MapCanvasDiagnostics["mapRect"] => {
      const currentManifest = manifestRef.current;
      if (!currentManifest) {
        return null;
      }

      const topLeft = tileToScreen(0, 0, transformRef.current);
      const bottomRight = tileToScreen(
        currentManifest.width,
        currentManifest.height,
        transformRef.current,
      );
      const left = Math.min(topLeft.x, bottomRight.x) + metrics.rect.left;
      const top = Math.min(topLeft.y, bottomRight.y) + metrics.rect.top;
      const right = Math.max(topLeft.x, bottomRight.x) + metrics.rect.left;
      const bottom = Math.max(topLeft.y, bottomRight.y) + metrics.rect.top;
      const visibleLeft = Math.max(left, unobscuredRect.left);
      const visibleTop = Math.max(top, unobscuredRect.top);
      const visibleRight = Math.min(right, unobscuredRect.right);
      const visibleBottom = Math.min(bottom, unobscuredRect.bottom);
      const visibleWidth = Math.max(0, visibleRight - visibleLeft);
      const visibleHeight = Math.max(0, visibleBottom - visibleTop);

      return {
        left,
        top,
        right,
        bottom,
        width: right - left,
        height: bottom - top,
        visibleWidth,
        visibleHeight,
        intersectsViewport: visibleWidth > 0 && visibleHeight > 0,
      };
    };
    const getCanvasDiagnostics = (): MapCanvasDiagnostics | null => {
      const metrics = getCanvasMetrics();
      if (!metrics) {
        return null;
      }

      const unobscuredRect = getUnobscuredCanvasRect(metrics);
      const centerScreen = {
        x: unobscuredRect.left + unobscuredRect.width / 2,
        y: unobscuredRect.top + unobscuredRect.height / 2,
      };
      const centerTile = screenToTile(
        centerScreen.x - metrics.rect.left,
        centerScreen.y - metrics.rect.top,
        transformRef.current,
      );
      const samplePoints = [
        { name: "center", x: centerScreen.x, y: centerScreen.y },
        {
          name: "top-left",
          x: unobscuredRect.left + unobscuredRect.width * 0.1,
          y: unobscuredRect.top + unobscuredRect.height * 0.1,
        },
        {
          name: "top-right",
          x: unobscuredRect.left + unobscuredRect.width * 0.9,
          y: unobscuredRect.top + unobscuredRect.height * 0.1,
        },
        {
          name: "bottom-left",
          x: unobscuredRect.left + unobscuredRect.width * 0.1,
          y: unobscuredRect.top + unobscuredRect.height * 0.9,
        },
        {
          name: "bottom-right",
          x: unobscuredRect.left + unobscuredRect.width * 0.9,
          y: unobscuredRect.top + unobscuredRect.height * 0.9,
        },
      ];
      const samples = samplePoints.map((sample) => ({
        name: sample.name,
        screenX: sample.x,
        screenY: sample.y,
        pixel: sampleCanvasPixel(sample.x, sample.y),
      }));
      const opaqueSamples = samples.filter((sample) =>
        Boolean(sample.pixel && sample.pixel.a > 0)
      );
      const distinctColors = new Set(
        samples
          .map((sample) => sample.pixel)
          .filter((pixel): pixel is MapCanvasPixel => Boolean(pixel))
          .map((pixel) => `${pixel.r},${pixel.g},${pixel.b},${pixel.a}`),
      );

      return {
        canvas: metrics,
        unobscuredRect,
        mapRect: getMapScreenRect(metrics, unobscuredRect),
        viewportBounds: viewportBoundsRef.current
          ? { ...viewportBoundsRef.current }
          : null,
        transform: { ...transformRef.current },
        centerTile,
        centerPixel: sampleCanvasPixel(centerScreen.x, centerScreen.y),
        samples,
        sampledOpaquePixels: opaqueSamples.length,
        sampledDistinctColors: distinctColors.size,
        hasOpaqueCanvasSamples: opaqueSamples.length > 0,
      };
    };
    const resolveTile = (tileX: number, tileY: number): MapPoint | null => {
      const currentManifest = manifestRef.current;
      if (
        !currentManifest
        || !Number.isFinite(tileX)
        || !Number.isFinite(tileY)
        || tileX < 0
        || tileY < 0
        || tileX >= currentManifest.width
        || tileY >= currentManifest.height
      ) {
        return null;
      }
      return {
        x: Math.trunc(tileX),
        y: Math.trunc(tileY),
      };
    };
    const getTileScreenRect = (tileX: number, tileY: number): MapTileScreenRect | null => {
      const tile = resolveTile(tileX, tileY);
      if (!tile) {
        return null;
      }
      const rect = getCanvasRectSnapshot();
      const topLeft = tileToScreen(tile.x, tile.y, transformRef.current);
      const bottomRight = tileToScreen(tile.x + 1, tile.y + 1, transformRef.current);
      const left = Math.min(topLeft.x, bottomRight.x) + (rect?.left ?? 0);
      const top = Math.min(topLeft.y, bottomRight.y) + (rect?.top ?? 0);
      const right = Math.max(topLeft.x, bottomRight.x) + (rect?.left ?? 0);
      const bottom = Math.max(topLeft.y, bottomRight.y) + (rect?.top ?? 0);

      return {
        tileX: tile.x,
        tileY: tile.y,
        left,
        top,
        width: right - left,
        height: bottom - top,
        centerX: (left + right) / 2,
        centerY: (top + bottom) / 2,
      };
    };
    const dispatchCanvasPointerEvent = (
      type: "pointerdown" | "pointermove" | "pointerup",
      screenX: number,
      screenY: number,
      options: { button?: number; buttons?: number; pointerId?: number } = {},
    ): boolean => {
      const canvas = canvasRef.current;
      if (
        !canvas
        || !Number.isFinite(screenX)
        || !Number.isFinite(screenY)
      ) {
        return false;
      }

      const eventInit = {
        bubbles: true,
        cancelable: true,
        button: options.button ?? 0,
        buttons: options.buttons ?? 0,
        clientX: screenX,
        clientY: screenY,
        pointerId: options.pointerId ?? 1,
        pointerType: "mouse",
        isPrimary: true,
      };
      const event = typeof window.PointerEvent === "function"
        ? new window.PointerEvent(type, eventInit)
        : new Event(type, { bubbles: true, cancelable: true });
      if (!(typeof window.PointerEvent === "function" && event instanceof window.PointerEvent)) {
        Object.defineProperties(event, {
          button: { value: eventInit.button },
          buttons: { value: eventInit.buttons },
          clientX: { value: eventInit.clientX },
          clientY: { value: eventInit.clientY },
          pointerId: { value: eventInit.pointerId },
          pointerType: { value: eventInit.pointerType },
          isPrimary: { value: eventInit.isPrimary },
        });
      }

      canvas.dispatchEvent(event);
      return true;
    };
    const dispatchCanvasWheelEvent = (
      screenX: number,
      screenY: number,
      deltaY: number,
    ): boolean => {
      const canvas = canvasRef.current;
      if (
        !canvas
        || !Number.isFinite(screenX)
        || !Number.isFinite(screenY)
        || !Number.isFinite(deltaY)
      ) {
        return false;
      }

      const eventInit = {
        bubbles: true,
        cancelable: true,
        clientX: screenX,
        clientY: screenY,
        deltaY,
      };
      const event = typeof window.WheelEvent === "function"
        ? new window.WheelEvent("wheel", eventInit)
        : new Event("wheel", { bubbles: true, cancelable: true });
      if (!(typeof window.WheelEvent === "function" && event instanceof window.WheelEvent)) {
        Object.defineProperties(event, {
          clientX: { value: eventInit.clientX },
          clientY: { value: eventInit.clientY },
          deltaY: { value: eventInit.deltaY },
        });
      }

      canvas.dispatchEvent(event);
      return true;
    };
    const getTileInteractionPoint = (tileX: number, tileY: number): MapPoint | null => {
      const rect = getTileScreenRect(tileX, tileY);
      const metrics = getCanvasMetrics();
      const canvasRect = metrics ? getUnobscuredCanvasRect(metrics) : null;
      if (
        !rect
        || !canvasRect
        || rect.centerX < canvasRect.left
        || rect.centerY < canvasRect.top
        || rect.centerX >= canvasRect.left + canvasRect.width
        || rect.centerY >= canvasRect.top + canvasRect.height
      ) {
        return null;
      }
      return { x: rect.centerX, y: rect.centerY };
    };
    const resolveScale = (scale?: number): number => {
      const requested = scale ?? Math.max(transformRef.current.scale, 4);
      const finiteScale = Number.isFinite(requested) && requested > 0
        ? requested
        : transformRef.current.scale;
      return Math.min(Math.max(finiteScale, MIN_SCALE), MAX_SCALE);
    };
    const centerOnTile = (
      tileX: number,
      tileY: number,
      options?: { scale?: number },
    ): boolean => {
      const tile = resolveTile(tileX, tileY);
      if (!tile) {
        return false;
      }
      const currentViewport = {
        width: Math.max(1, viewportRef.current.width - rightOverlayInsetRef.current),
        height: viewportRef.current.height,
      };
      const nextTransform = centerTransformOnTile(
        { x: tile.x + 0.5, y: tile.y + 0.5 },
        currentViewport,
        resolveScale(options?.scale),
      );
      const currentManifest = manifestRef.current;
      if (currentManifest) {
        viewportBoundsRef.current = tileBoundsForViewport(
          currentManifest,
          currentViewport,
          nextTransform,
        );
      }
      applyTransform(nextTransform);
      queueVisibleDetailChunksForTransform(nextTransform);
      drawWithTransformRef.current?.(nextTransform);
      return true;
    };
    const resolvePlacement = (index: number): MapPlacementRecord | null => {
      if (!Number.isFinite(index)) {
        return null;
      }
      const placementIndex = Math.trunc(index);
      const selected = selectedPlacementRef.current;
      if (selected?.index === placementIndex) {
        return selected;
      }
      return renderedPlacementsRef.current.find((placement) => placement.index === placementIndex)
        ?? markerPlacementsRef.current.find((placement) => placement.index === placementIndex)
        ?? null;
    };
    const resolvePlacementForView = (index: number): MapPlacementRecord | null => {
      if (!Number.isFinite(index)) {
        return null;
      }
      const placementIndex = Math.trunc(index);
      return renderedPlacementsRef.current.find((placement) => placement.index === placementIndex)
        ?? markerPlacementsRef.current.find((placement) => placement.index === placementIndex)
        ?? (selectedPlacementRef.current?.index === placementIndex
          ? selectedPlacementRef.current
          : null);
    };
    const getPlacementScreenPoint = (index: number): MapPlacementScreenPoint | null => {
      const placement = resolvePlacementForView(index);
      if (
        !placement
        || !Number.isFinite(placement.world_x)
        || !Number.isFinite(placement.world_y)
      ) {
        return null;
      }
      const rect = getCanvasRectSnapshot();
      const point = tileToScreen(placement.world_x, placement.world_y, transformRef.current);

      return {
        index: placement.index,
        worldX: placement.world_x,
        worldY: placement.world_y,
        x: point.x + (rect?.left ?? 0),
        y: point.y + (rect?.top ?? 0),
      };
    };
    const centerOnPlacement = (
      index: number,
      options?: { scale?: number },
    ): boolean => {
      const placement = resolvePlacementForView(index);
      if (
        !placement
        || !Number.isFinite(placement.world_x)
        || !Number.isFinite(placement.world_y)
      ) {
        return false;
      }
      const currentViewport = {
        width: Math.max(1, viewportRef.current.width - rightOverlayInsetRef.current),
        height: viewportRef.current.height,
      };
      const nextTransform = centerTransformOnTile(
        { x: placement.world_x, y: placement.world_y },
        currentViewport,
        resolveScale(options?.scale),
      );
      const currentManifest = manifestRef.current;
      if (currentManifest) {
        viewportBoundsRef.current = tileBoundsForViewport(
          currentManifest,
          currentViewport,
          nextTransform,
        );
      }
      applyTransform(nextTransform);
      queueVisibleDetailChunksForTransform(nextTransform);
      drawWithTransformRef.current?.(nextTransform);
      return true;
    };
    const resolveLayer = (nextLayer: string): MapWorkbenchLayer | null => {
      const matched = LAYERS.find((option) => option.value === nextLayer)?.value ?? null;
      if (!matched) {
        return null;
      }
      const currentManifest = manifestRef.current;
      if (currentManifest && !currentManifest.available_layers.includes(matched)) {
        return null;
      }
      return matched;
    };
    const resolveOverlayLayer = (nextLayer: string): MapWorkbenchLayer | null => {
      const matched = resolveLayer(nextLayer);
      if (!matched || !COMPOSITE_OVERLAY_LAYERS.some((entry) => entry.value === matched)) {
        return null;
      }

      return matched;
    };
    const getSelectedTileSnapshot = (): MapPoint | null => selectedTileRef.current
      ? { ...selectedTileRef.current }
      : null;
    const getPendingEditCounts = () => {
      const tiles = Object.keys(pendingPatchesRef.current).length;
      const placementUpdates = Object.keys(pendingPlacementPatchesRef.current).length;
      const placementAdds = Object.keys(pendingPlacementAddsRef.current).length;
      const placementDeletes = Object.keys(pendingPlacementDeletesRef.current).length;
      return {
        tiles,
        placementUpdates,
        placementAdds,
        placementDeletes,
        total: tiles + placementUpdates + placementAdds + placementDeletes,
      };
    };
    const isIdle = () =>
      !manifestLoadingRef.current
      && !inspectionLoadingRef.current
      && !exportingEditsRef.current
      && !pendingChunkLoadRef.current
      && activeChunkLoadCountRef.current === 0
      && loadingChunksRef.current.size === 0;
    const waitForIdle = (timeoutMs = 2000): Promise<boolean> => {
      if (isIdle()) {
        return Promise.resolve(true);
      }
      const startedAt = window.performance.now();
      return new Promise((resolve) => {
        const tick = () => {
          if (isIdle()) {
            resolve(true);
            return;
          }
          if (window.performance.now() - startedAt >= timeoutMs) {
            resolve(false);
            return;
          }
          window.setTimeout(tick, 16);
        };
        tick();
      });
    };
    const getState = (): MapWorkbenchAutomationState => {
      const currentManifest = manifestRef.current;
      const viewportBounds = viewportBoundsRef.current;
      const selectedPlacementSnapshot = selectedPlacementRef.current;
      const detailScaleEnabled = Boolean(
        currentManifest
        && initialFitAppliedRef.current
        && shouldLoadDetailChunks(transformRef.current.scale, DETAIL_CHUNK_MIN_SCALE),
      );
      const visibleCandidateChunkKeys = currentManifest && detailScaleEnabled
        ? getPrioritizedVisibleChunkKeys(
          currentManifest,
          viewportRef.current,
          transformRef.current,
          1,
          textureDetailChunkSizeFor(
            textureDetailZoomBucket(transformRef.current.scale),
            currentManifest.chunk_size,
          ),
        )
        : [];
      const visibleCandidates = visibleCandidateChunkKeys.length * activeRasterLayersRef.current.length;
      const automationTextureZoomBucket = textureDetailZoomBucket(transformRef.current.scale);
      const automationTextureChunkSize = currentManifest
        ? textureDetailChunkSizeFor(automationTextureZoomBucket, currentManifest.chunk_size)
        : 128;
      const automationDetailChunkCacheLimit = detailChunkCacheLimitFor(
        activeRasterLayersRef.current,
        automationTextureZoomBucket,
        automationTextureChunkSize,
        currentManifest?.chunk_size ?? automationTextureChunkSize,
      );
      const automationRenderImageCacheLimit = renderImageCacheLimitFor(
        automationDetailChunkCacheLimit,
      );
      const detailEnabled = detailChunkKeysWithinBudget(
        visibleCandidateChunkKeys,
        activeRasterLayersRef.current.length,
        automationDetailChunkCacheLimit,
      ).length > 0;
      return {
        projectId: projectIdRef.current,
        mapName: mapNameRef.current,
        manifest: currentManifest
          ? {
              name: currentManifest.name,
              width: currentManifest.width,
              height: currentManifest.height,
              chunkSize: currentManifest.chunk_size,
            }
          : null,
        layer: layerRef.current,
        overlayLayers: [...overlayLayersRef.current],
        activeRasterLayers: [...activeRasterLayersRef.current],
        overlayOpacity: overlayOpacityRef.current,
        showGrid: showGridRef.current,
        showPlacements: showPlacementsRef.current,
        placementMarkerDensity: placementMarkerDensityRef.current,
        interactionMode: interactionModeRef.current,
        tilePaintMode: tilePaintModeRef.current,
        tileBrushRadius: tileBrushRadiusRef.current,
        viewport: { ...viewportRef.current },
        viewportBounds: viewportBounds ? { ...viewportBounds } : null,
        transform: { ...transformRef.current },
        selectedTile: getSelectedTileSnapshot(),
        selectedPlacement: selectedPlacementSnapshot ? { ...selectedPlacementSnapshot } : null,
        visiblePlacementCount: markerPlacementsRef.current.length,
        visibleRboRecordCount: visibleRboRecordsRef.current.length,
        visibleRboRecordTotal: visibleRboRecordTotalRef.current,
        pendingEdits: getPendingEditCounts(),
        loading: {
          manifest: manifestLoadingRef.current,
          inspection: inspectionLoadingRef.current,
          chunks: loadingChunksRef.current.size,
          exporting: exportingEditsRef.current,
        },
        detailChunks: {
          enabled: detailEnabled,
          scaleEnabled: detailScaleEnabled,
          windowSuppressed: detailScaleEnabled && visibleCandidates > automationDetailChunkCacheLimit,
          visibleCandidates,
          maxVisible: automationDetailChunkCacheLimit,
        },
        cache: {
          detailChunks: Object.keys(chunksRef.current).length,
          renderImages: imageCacheRef.current.size,
          maxDetailChunks: automationDetailChunkCacheLimit,
          maxRenderImages: automationRenderImageCacheLimit,
        },
      };
    };

    const api: MapWorkbenchAutomationApi = {
      inspectTile: (tileX, tileY) => inspectTile(Math.floor(tileX), Math.floor(tileY)),
      selectTile: async (tileX, tileY, options) => {
        const tile = resolveTile(tileX, tileY);
        if (!tile) {
          return false;
        }
        const inspected = await inspectTile(tile.x, tile.y);
        if (!inspected) {
          return false;
        }
        onSelectPlacement(null);
        centerOnTile(tile.x, tile.y, options);
        return true;
      },
      centerOnTile,
      frameTileBounds: (bounds, options) => {
        const currentManifest = manifestRef.current;
        const parsedBounds = parseAutomationTileBounds(bounds);
        if (
          !currentManifest
          || !parsedBounds
          || parsedBounds.maxX <= parsedBounds.minX
          || parsedBounds.maxY <= parsedBounds.minY
        ) {
          return false;
        }

        const clampedBounds: MapTileBounds = {
          minX: Math.min(Math.max(0, parsedBounds.minX), currentManifest.width),
          minY: Math.min(Math.max(0, parsedBounds.minY), currentManifest.height),
          maxX: Math.min(Math.max(0, parsedBounds.maxX), currentManifest.width),
          maxY: Math.min(Math.max(0, parsedBounds.maxY), currentManifest.height),
        };
        if (
          clampedBounds.maxX <= clampedBounds.minX
          || clampedBounds.maxY <= clampedBounds.minY
        ) {
          return false;
        }

        const unobscuredViewport = {
          width: Math.max(1, viewportRef.current.width - rightOverlayInsetRef.current),
          height: viewportRef.current.height,
        };
        const nextTransform = fitTileBoundsTransform(
          clampedBounds,
          unobscuredViewport,
          {
            minScale: MIN_SCALE,
            maxScale: MAX_SCALE,
            paddingRatio: parseFramePaddingRatio(options),
          },
        );
        viewportBoundsRef.current = tileBoundsForViewport(
          currentManifest,
          unobscuredViewport,
          nextTransform,
        );
        const currentProjectId = projectIdRef.current;
        const currentMapName = mapNameRef.current;
        const currentChunkSourceKey = chunkSourceRef.current;
        if (currentProjectId && currentMapName && currentChunkSourceKey) {
          const zoomBucket = textureDetailZoomBucket(nextTransform.scale);
          const chunkSize = textureDetailChunkSizeFor(zoomBucket, currentManifest.chunk_size);
          const detailChunkCacheLimit = detailChunkCacheLimitFor(
            activeRasterLayersRef.current,
            zoomBucket,
            chunkSize,
            currentManifest.chunk_size,
          );
          const candidateChunkKeys = getPrioritizedVisibleChunkKeys(
            currentManifest,
            unobscuredViewport,
            nextTransform,
            1,
            chunkSize,
          );
          const nextVisibleChunkKeys = shouldLoadDetailChunks(
            nextTransform.scale,
            DETAIL_CHUNK_MIN_SCALE,
          )
            ? detailChunkKeysWithinBudget(
              candidateChunkKeys,
              activeRasterLayersRef.current.length,
              detailChunkCacheLimit,
            )
            : [];
          queueVisibleDetailChunks(nextVisibleChunkKeys, {
            chunkSourceKey: currentChunkSourceKey,
            projectId: currentProjectId,
            mapName: currentMapName,
            layers: activeRasterLayersRef.current,
            zoomBucket,
            chunkSize,
            sourceGuard: currentManifest.source,
          });
        }
        applyTransform(nextTransform);
        drawWithTransformRef.current?.(nextTransform);
        return true;
      },
      centerOnPlacement,
      selectPlacement: (index, options) => {
        const placement = resolvePlacement(index);
        if (!placement || !centerOnPlacement(index, options)) {
          return false;
        }
        selectedPlacementRef.current = placement;
        onSelectPlacement(placement);
        return true;
      },
      fitMap: () => {
        const currentManifest = manifestRef.current;
        if (!currentManifest) {
          return false;
        }
        const currentViewport = {
          width: Math.max(1, viewportRef.current.width - rightOverlayInsetRef.current),
          height: viewportRef.current.height,
        };
        const nextFit = fitMapTransform(currentManifest, currentViewport, {
          minScale: MIN_SCALE,
          maxScale: MAX_SCALE,
        });
        lastAutoFitTransformRef.current = nextFit;
        lastAutoFitSourceRef.current = mapAutoFitSourceKey(currentManifest);
        applyTransform(nextFit);
        return true;
      },
      zoomAtCenter: (direction) => {
        const currentViewport = {
          width: Math.max(1, viewportRef.current.width - rightOverlayInsetRef.current),
          height: viewportRef.current.height,
        };
        applyZoomAtPoint(
          { x: currentViewport.width / 2, y: currentViewport.height / 2 },
          direction,
        );
        return true;
      },
      getViewportBounds: () => viewportBoundsRef.current
        ? { ...viewportBoundsRef.current }
        : null,
      getViewport: () => ({ ...viewportRef.current }),
      getCanvasRect: () => getCanvasRectSnapshot(),
      getCanvasMetrics,
      getCanvasDiagnostics,
      sampleCanvasPixel,
      sampleTilePixel,
      getTileScreenRect,
      getTransform: () => ({ ...transformRef.current }),
      getSelectedTile: () => getSelectedTileSnapshot(),
      getSelectedPlacement: () => selectedPlacementRef.current
        ? { ...selectedPlacementRef.current }
        : null,
      getVisiblePlacements: () => markerPlacementsRef.current.map((placement) => ({ ...placement })),
      getVisibleRboRecords: () => visibleRboRecordsRef.current.map((record) => ({ ...record })),
      getState,
      setLayer: (nextLayer) => {
        const resolvedLayer = resolveLayer(nextLayer);
        if (!resolvedLayer) {
          return false;
        }
        setLayer(resolvedLayer);
        layerRef.current = resolvedLayer;
        activeRasterLayersRef.current = [
          resolvedLayer,
          ...activeOverlayLayersFor(
            overlayLayersRef.current,
            resolvedLayer,
            manifestRef.current,
          ),
        ];
        return true;
      },
      setLayerOverlay: (nextLayer, enabled) => {
        const resolvedLayer = resolveOverlayLayer(nextLayer);
        if (!resolvedLayer) {
          return false;
        }
        setLayerOverlayState(resolvedLayer, Boolean(enabled));
        return true;
      },
      setOverlayOpacity: (nextOpacity) => {
        if (!Number.isFinite(nextOpacity)) {
          return false;
        }
        updateOverlayOpacity(nextOpacity * 100);
        return true;
      },
      setShowGrid: (enabled) => {
        setShowGrid(Boolean(enabled));
        showGridRef.current = Boolean(enabled);
        return true;
      },
      setShowPlacements: (enabled) => {
        setShowPlacements(Boolean(enabled));
        showPlacementsRef.current = Boolean(enabled);
        return true;
      },
      setTilePaintMode: (enabled) => {
        const nextEnabled = Boolean(enabled);
        const nextMode: CanvasInteractionMode = nextEnabled ? "paint" : "select";
        setInteractionMode(nextMode);
        interactionModeRef.current = nextMode;
        tilePaintModeRef.current = nextEnabled;
        return true;
      },
      stageTileBrushAt: (tileX, tileY) => {
        const currentManifest = manifestRef.current;
        const sourcePatch = draftPatchRef.current;
        if (
          !currentManifest
          || !sourcePatch
          || !Number.isFinite(tileX)
          || !Number.isFinite(tileY)
        ) {
          return false;
        }

        const centerPatch = {
          ...sourcePatch,
          tile_x: Math.min(Math.max(0, Math.trunc(tileX)), Math.max(0, currentManifest.width - 1)),
          tile_y: Math.min(Math.max(0, Math.trunc(tileY)), Math.max(0, currentManifest.height - 1)),
        };
        return commitTileBrushPatches(createTileBrushPatches(
          centerPatch,
          tileBrushRadiusRef.current,
          currentManifest,
        ));
      },
      hoverTile: (tileX, tileY) => {
        const point = getTileInteractionPoint(tileX, tileY);
        return point
          ? dispatchCanvasPointerEvent("pointermove", point.x, point.y, {
            buttons: 0,
          })
          : false;
      },
      clickTile: (tileX, tileY) => {
        const point = getTileInteractionPoint(tileX, tileY);
        if (!point) {
          return false;
        }
        const pointerId = 1;
        const pressed = dispatchCanvasPointerEvent("pointerdown", point.x, point.y, {
          button: 0,
          buttons: 1,
          pointerId,
        });
        const released = dispatchCanvasPointerEvent("pointerup", point.x, point.y, {
          button: 0,
          buttons: 0,
          pointerId,
        });
        return pressed && released;
      },
      wheelAtTile: (tileX, tileY, deltaY) => {
        const point = getTileInteractionPoint(tileX, tileY);
        return point ? dispatchCanvasWheelEvent(point.x, point.y, deltaY) : false;
      },
      waitForIdle,
      screenToTile: (screenX, screenY) => {
        const rect = getCanvasRectSnapshot();
        return screenToTile(
          screenX - (rect?.left ?? 0),
          screenY - (rect?.top ?? 0),
          transformRef.current,
        );
      },
      tileToScreen: (tileX, tileY) => {
        const rect = getCanvasRectSnapshot();
        const point = tileToScreen(tileX, tileY, transformRef.current);
        return {
          x: point.x + (rect?.left ?? 0),
          y: point.y + (rect?.top ?? 0),
        };
      },
      getPlacementScreenPoint,
    };

    window.__PKO_TOOLS_MAP_WORKBENCH__ = api;
    return () => {
      if (window.__PKO_TOOLS_MAP_WORKBENCH__ === api) {
        delete window.__PKO_TOOLS_MAP_WORKBENCH__;
      }
    };
  }, [
    applyTransform,
    applyZoomAtPoint,
    commitTileBrushPatches,
    inspectTile,
    onSelectPlacement,
    queueVisibleDetailChunks,
    queueVisibleDetailChunksForTransform,
    setLayerOverlayState,
    updateOverlayOpacity,
  ]);

  const fitMap = useCallback(() => {
    if (!manifest) {
      return;
    }
    const nextFit = fitMapTransform(manifest, unobscuredViewport, {
      minScale: MIN_SCALE,
      maxScale: MAX_SCALE,
    });
    lastAutoFitTransformRef.current = nextFit;
    lastAutoFitSourceRef.current = mapAutoFitSourceKey(manifest);
    applyTransform(nextFit);
  }, [applyTransform, manifest, unobscuredViewport]);

  const zoomToNativeTextureDetail = useCallback(() => {
    if (!manifest) {
      return;
    }

    const currentTransform = transformRef.current;
    const focusTile = selectedTileRef.current
      ? { x: selectedTileRef.current.x + 0.5, y: selectedTileRef.current.y + 0.5 }
      : screenToTile(
        unobscuredViewport.width / 2,
        unobscuredViewport.height / 2,
        currentTransform,
      );
    const nextTransform = centerTransformOnTile(
      {
        x: Math.min(Math.max(focusTile.x, 0), manifest.width),
        y: Math.min(Math.max(focusTile.y, 0), manifest.height),
      },
      unobscuredViewport,
      NATIVE_TEXTURE_DETAIL_SCALE,
    );
    applyTransform(nextTransform);
    queueVisibleDetailChunksForTransform(nextTransform);
    drawWithTransformRef.current?.(nextTransform);
  }, [
    applyTransform,
    manifest,
    queueVisibleDetailChunksForTransform,
    unobscuredViewport,
  ]);

  const centerSelectedPlacement = useCallback(() => {
    if (!selectedPlacementForView) {
      return;
    }
    const nextTransform = centerTransformOnTile(
      {
        x: selectedPlacementForView.world_x,
        y: selectedPlacementForView.world_y,
      },
      unobscuredViewport,
      Math.max(transformRef.current.scale, 4),
    );
    applyTransform(nextTransform);
    queueVisibleDetailChunksForTransform(nextTransform);
    drawWithTransformRef.current?.(nextTransform);
  }, [
    applyTransform,
    queueVisibleDetailChunksForTransform,
    selectedPlacementForView,
    unobscuredViewport,
  ]);

  const canJumpToTile = Boolean(
    manifest
    && jumpDraft.x.trim() !== ""
    && jumpDraft.y.trim() !== ""
    && Number.isFinite(Number(jumpDraft.x))
    && Number.isFinite(Number(jumpDraft.y)),
  );

  const jumpToTile = useCallback(() => {
    if (!manifest || !canJumpToTile) {
      return;
    }
    const tileX = Math.min(
      Math.max(0, Math.trunc(Number(jumpDraft.x))),
      Math.max(0, manifest.width - 1),
    );
    const tileY = Math.min(
      Math.max(0, Math.trunc(Number(jumpDraft.y))),
      Math.max(0, manifest.height - 1),
    );

    onSelectPlacement(null);
    const nextTransform = centerTransformOnTile(
      { x: tileX + 0.5, y: tileY + 0.5 },
      unobscuredViewport,
      Math.max(transformRef.current.scale, 4),
    );
    applyTransform(nextTransform);
    queueVisibleDetailChunksForTransform(nextTransform);
    drawWithTransformRef.current?.(nextTransform);
    void inspectTile(tileX, tileY);
  }, [
    applyTransform,
    canJumpToTile,
    inspectTile,
    jumpDraft,
    manifest,
    onSelectPlacement,
    queueVisibleDetailChunksForTransform,
    unobscuredViewport,
  ]);

  const moveNavigatorToEvent = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!manifest || !navigatorFrame) {
        return;
      }

      const rect = event.currentTarget.getBoundingClientRect();
      const tile = navigatorPointToTile(
        {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        },
        navigatorFrame,
        manifest,
      );
      const nextTransform = centerTransformOnTile(
        tile,
        unobscuredViewport,
        transformRef.current.scale,
      );
      applyTransform(nextTransform);
      queueVisibleDetailChunksForTransform(nextTransform, { throttle: true });
    },
    [
      applyTransform,
      manifest,
      navigatorFrame,
      queueVisibleDetailChunksForTransform,
      unobscuredViewport,
    ],
  );

  const handleNavigatorPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      navigatorPointerRef.current = event.pointerId;
      safeSetPointerCapture(event.currentTarget, event.pointerId);
      moveNavigatorToEvent(event);
    },
    [moveNavigatorToEvent],
  );

  const handleNavigatorPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (navigatorPointerRef.current !== event.pointerId) {
        return;
      }
      event.preventDefault();
      moveNavigatorToEvent(event);
    },
    [moveNavigatorToEvent],
  );

  const handleNavigatorPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (navigatorPointerRef.current !== event.pointerId) {
        return;
      }
      navigatorPointerRef.current = null;
      safeReleasePointerCapture(event.currentTarget, event.pointerId);
    },
    [],
  );

  const zoomBy = useCallback(
    (direction: number) => {
      applyZoomAtPoint(
        { x: unobscuredViewport.width / 2, y: unobscuredViewport.height / 2 },
        direction,
      );
    },
    [applyZoomAtPoint, unobscuredViewport],
  );

  const draftPatch = useMemo(() => {
    if (!inspection || !tileDraft) {
      return null;
    }
    return createTilePatchFromDraft(inspection, tileDraft);
  }, [inspection, tileDraft]);
  draftPatchRef.current = draftPatch;

  useEffect(() => {
    if (interactionMode === "paint" && !draftPatch) {
      setInteractionMode("select");
    }
  }, [draftPatch, interactionMode]);

  const placementDraftPatch = useMemo(() => {
    if (!selectedPlacement || !placementDraft || selectedPlacement.index < 0) {
      return null;
    }
    if (pendingPlacementDeletes[mapPlacementKey(selectedPlacement.index)]) {
      return null;
    }
    return createPlacementPatchFromDraft(selectedPlacement, placementDraft);
  }, [selectedPlacement, placementDraft, pendingPlacementDeletes]);

  const pendingPatchCount = Object.keys(pendingPatches).length;
  const pendingPlacementPatchCount = Object.keys(pendingPlacementPatches).length;
  const pendingPlacementAddCount = Object.keys(pendingPlacementAdds).length;
  const pendingPlacementDeleteCount = Object.keys(pendingPlacementDeletes).length;
  const pendingPlacementEditCount =
    pendingPlacementPatchCount + pendingPlacementAddCount + pendingPlacementDeleteCount;
  const totalPendingEditCount = pendingPatchCount + pendingPlacementEditCount;
  const canUndoStagedEdit = stagedEditUndoStack.length > 0;
  const canRedoStagedEdit = stagedEditRedoStack.length > 0;

  const updateDraftNumber = useCallback(
    (field: "sColor" | "cHeight" | "sRegion" | "btIsland", value: number) => {
      setTileDraft((current) => current ? { ...current, [field]: value } : current);
    },
    [],
  );

  const updateDraftRegionTerrain = useCallback((terrainValue: number) => {
    setTileDraft((current) =>
      current
        ? { ...current, sRegion: setRegionTerrain(current.sRegion, terrainValue) }
        : current,
    );
  }, []);

  const toggleDraftRegionFlag = useCallback((bit: number) => {
    setTileDraft((current) =>
      current ? { ...current, sRegion: toggleRegionFlag(current.sRegion, bit) } : current,
    );
  }, []);

  const updateDraftTextureLayer = useCallback((
    index: number,
    field: "textureId" | "alpha",
    value: number,
  ) => {
    setTileDraft((current) => {
      if (!current) {
        return current;
      }
      const nextLayers = current.textureLayers.map((layer, layerIndex) =>
        layerIndex === index ? { ...layer, [field]: value } : layer
      ) as MapTileEditDraft["textureLayers"];
      return { ...current, textureLayers: nextLayers };
    });
  }, []);

  const updateDraftBlock = useCallback((index: number, value: number) => {
    setTileDraft((current) => {
      if (!current) {
        return current;
      }
      const nextBlock = [...current.btBlock] as [number, number, number, number];
      nextBlock[index] = value;
      return { ...current, btBlock: nextBlock };
    });
  }, []);

  const updateDraftBlockCollision = useCallback((index: number, blocked: boolean) => {
    setTileDraft((current) => {
      if (!current) {
        return current;
      }
      const nextBlock = [...current.btBlock] as [number, number, number, number];
      nextBlock[index] = setBtBlockBlocked(nextBlock[index], blocked);
      return { ...current, btBlock: nextBlock };
    });
  }, []);

  const updateAllDraftBlockCollision = useCallback((blocked: boolean) => {
    setTileDraft((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        btBlock: current.btBlock.map((value) =>
          setBtBlockBlocked(value, blocked)
        ) as [number, number, number, number],
      };
    });
  }, []);

  const updateDraftBlockObjectHeight = useCallback((index: number, height: number) => {
    setTileDraft((current) => {
      if (!current) {
        return current;
      }
      const nextBlock = [...current.btBlock] as [number, number, number, number];
      nextBlock[index] = setBtBlockObjectHeight(nextBlock[index], height);
      return { ...current, btBlock: nextBlock };
    });
  }, []);

  const resetAllDraftBlockObjectHeights = useCallback(() => {
    setTileDraft((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        btBlock: current.btBlock.map((value) =>
          setBtBlockObjectHeight(value, 0)
        ) as [number, number, number, number],
      };
    });
  }, []);

  const syncSelectedTemporaryPlacementAdd = useCallback((draft: MapPlacementEditDraft) => {
    const selected = selectedPlacementRef.current;
    if (!selected || selected.index >= 0) {
      return;
    }

    const key = mapPlacementKey(selected.index);
    setPendingPlacementAdds((current) => {
      const edit = current[key];
      if (!edit) {
        return current;
      }
      const nextEdit = createPlacementAddEditFromPlacementDraft(draft);
      if (mapPlacementAddEditsEqual(edit, nextEdit)) {
        return current;
      }
      return {
        ...current,
        [key]: nextEdit,
      };
    });
  }, []);

  const updatePlacementDraft = useCallback(
    (updater: (current: MapPlacementEditDraft) => MapPlacementEditDraft) => {
      setPlacementDraft((current) => {
        if (!current) {
          return current;
        }
        const next = updater(current);
        placementDraftRef.current = next;
        syncSelectedTemporaryPlacementAdd(next);
        return next;
      });
    },
    [syncSelectedTemporaryPlacementAdd],
  );

  const updatePlacementDraftNumber = useCallback(
    (field: keyof MapPlacementEditDraft, value: number) => {
      updatePlacementDraft((current) => ({ ...current, [field]: value }));
    },
    [updatePlacementDraft],
  );

  const updatePlacementAddDraftNumber = useCallback(
    (field: keyof MapPlacementAddDraft, value: number) => {
      setPlacementAddDraft((current) => current ? { ...current, [field]: value } : current);
    },
    [],
  );

  const clampPlacementX = useCallback((value: number) => {
    const finite = Number.isFinite(value) ? value : 0;
    return manifest ? Math.min(Math.max(0, finite), manifest.width) : finite;
  }, [manifest]);

  const clampPlacementY = useCallback((value: number) => {
    const finite = Number.isFinite(value) ? value : 0;
    return manifest ? Math.min(Math.max(0, finite), manifest.height) : finite;
  }, [manifest]);

  const nudgePlacementDraft = useCallback((dx: number, dy: number) => {
    updatePlacementDraft((current) => ({
      ...current,
      worldX: clampPlacementX(current.worldX + dx),
      worldY: clampPlacementY(current.worldY + dy),
    }));
  }, [clampPlacementX, clampPlacementY, updatePlacementDraft]);

  const nudgePlacementAddDraft = useCallback((dx: number, dy: number) => {
    setPlacementAddDraft((current) =>
      current
        ? {
            ...current,
            worldX: clampPlacementX(current.worldX + dx),
            worldY: clampPlacementY(current.worldY + dy),
          }
        : current
    );
  }, [clampPlacementX, clampPlacementY]);

  const copyCurrentTileDraft = useCallback(() => {
    if (!tileDraft) {
      return;
    }
    setCopiedTileDraft(cloneTileEditDraft(tileDraft));
  }, [tileDraft]);

  const pasteCopiedTileDraft = useCallback(() => {
    setTileDraft((current) =>
      current && copiedTileDraft ? cloneTileEditDraft(copiedTileDraft) : current
    );
  }, [copiedTileDraft]);

  const updateTileBrushRadius = useCallback((value: number) => {
    const nextRadius = Number.isFinite(value) ? Math.trunc(value) : 0;
    setTileBrushRadius(Math.min(Math.max(0, nextRadius), TILE_BRUSH_MAX_RADIUS));
  }, []);

  const stageCurrentTileEdit = useCallback(() => {
    if (!inspection || !tileDraft) {
      return;
    }

    const key = mapTileKey(inspection.tile_x, inspection.tile_y);
    const patch = createTilePatchFromDraft(inspection, tileDraft);
    const currentPatch = pendingPatchesRef.current[key];
    if (patch ? mapTilePatchesEqual(patch, currentPatch) : !currentPatch) {
      return;
    }
    recordStagedEditHistory();
    setPendingPatches((current) => {
      const next = { ...current };
      if (patch) {
        next[key] = patch;
      } else {
        delete next[key];
      }
      return next;
    });
  }, [inspection, recordStagedEditHistory, tileDraft]);

  const stageTileBrushAt = useCallback((tileX: number, tileY: number): boolean => {
    if (!manifest || !draftPatch) {
      return false;
    }

    const centerPatch = {
      ...draftPatch,
      tile_x: Math.min(Math.max(0, Math.trunc(tileX)), Math.max(0, manifest.width - 1)),
      tile_y: Math.min(Math.max(0, Math.trunc(tileY)), Math.max(0, manifest.height - 1)),
    };
    const brushPatches = createTileBrushPatches(
      centerPatch,
      tileBrushRadius,
      manifest,
    );
    return commitTileBrushPatches(brushPatches);
  }, [commitTileBrushPatches, draftPatch, manifest, tileBrushRadius]);

  const stageCurrentTileBrush = useCallback(() => {
    if (!draftPatch) {
      return;
    }
    stageTileBrushAt(draftPatch.tile_x, draftPatch.tile_y);
  }, [draftPatch, stageTileBrushAt]);

  const resetCurrentTileEdit = useCallback(() => {
    if (!inspection) {
      return;
    }

    const key = mapTileKey(inspection.tile_x, inspection.tile_y);
    if (pendingPatchesRef.current[key]) {
      recordStagedEditHistory();
    }
    setPendingPatches((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setTileDraft(createTileEditDraft(inspection));
  }, [inspection, recordStagedEditHistory]);

  const stageCurrentPlacementEdit = useCallback(() => {
    if (!selectedPlacement || !placementDraft || selectedPlacement.index < 0) {
      return;
    }

    const key = mapPlacementKey(selectedPlacement.index);
    if (pendingPlacementDeletes[key]) {
      return;
    }
    const patch = createPlacementPatchFromDraft(selectedPlacement, placementDraft);
    const currentPatch = pendingPlacementPatchesRef.current[key];
    if (patch ? mapPlacementPatchesEqual(patch, currentPatch) : !currentPatch) {
      return;
    }
    recordStagedEditHistory();
    setPendingPlacementPatches((current) => {
      const next = { ...current };
      if (patch) {
        next[key] = patch;
      } else {
        delete next[key];
      }
      return next;
    });
    setPendingPlacementSources((current) => {
      const next = { ...current };
      if (patch) {
        next[key] = selectedPlacement;
      } else {
        delete next[key];
      }
      return next;
    });
  }, [selectedPlacement, placementDraft, pendingPlacementDeletes, recordStagedEditHistory]);

  const stagePlacementAdd = useCallback(() => {
    if (!placementAddDraft) {
      return;
    }

    const edit = createPlacementAddEditFromDraft(placementAddDraft);
    const tempIndex = -1 - placementAddSequenceRef.current;
    placementAddSequenceRef.current += 1;
    const key = mapPlacementKey(tempIndex);
    recordStagedEditHistory();
    setPendingPlacementAdds((current) => ({ ...current, [key]: edit }));
    setPlacementAddDraft(null);
    setPlacementAddEditorOpen(false);
    setShowPlacements(true);
    onSelectPlacement(createTemporaryPlacementFromAddEdit(edit, tempIndex));
  }, [placementAddDraft, onSelectPlacement, recordStagedEditHistory]);

  const stageCurrentPlacementDelete = useCallback(() => {
    if (!selectedPlacement) {
      return;
    }

    const key = mapPlacementKey(selectedPlacement.index);
    if (selectedPlacement.index < 0) {
      if (!pendingPlacementAddsRef.current[key]) {
        return;
      }
      recordStagedEditHistory();
      setPendingPlacementAdds((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      onSelectPlacement(null);
      return;
    }

    if (
      pendingPlacementDeletesRef.current[key]
      && !pendingPlacementPatchesRef.current[key]
    ) {
      return;
    }
    recordStagedEditHistory();
    setPendingPlacementDeletes((current) => ({
      ...current,
      [key]: { op: "delete", index: selectedPlacement.index },
    }));
    setPendingPlacementPatches((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setPendingPlacementSources((current) => {
      return {
        ...current,
        [key]: selectedPlacement,
      };
    });
  }, [selectedPlacement, onSelectPlacement, recordStagedEditHistory]);

  const addSelectedPlacementToGroup = useCallback(() => {
    if (!selectedPlacement || selectedPlacement.index < 0) {
      return;
    }
    const key = mapPlacementKey(selectedPlacement.index);
    if (pendingPlacementDeletesRef.current[key]) {
      return;
    }
    setPlacementSelectionGroup((current) => {
      if (current[key]) {
        return current;
      }
      return { ...current, [key]: selectedPlacement };
    });
  }, [selectedPlacement]);

  const clearPlacementSelectionGroup = useCallback(() => {
    setPlacementSelectionGroup({});
  }, []);

  const stagePlacementSelectionDeletes = useCallback(() => {
    const entries = Object.entries(placementSelectionGroupRef.current)
      .filter(([, placement]) => placement.index >= 0)
      .filter(([key]) => !pendingPlacementDeletesRef.current[key]);
    if (entries.length === 0) {
      setPlacementSelectionGroup({});
      return;
    }

    recordStagedEditHistory();
    setPendingPlacementDeletes((current) => {
      const next = { ...current };
      for (const [key, placement] of entries) {
        next[key] = { op: "delete", index: placement.index };
      }
      return next;
    });
    setPendingPlacementPatches((current) => {
      const next = { ...current };
      for (const [key] of entries) {
        delete next[key];
      }
      return next;
    });
    setPendingPlacementSources((current) => {
      const next = { ...current };
      for (const [key, placement] of entries) {
        next[key] = placement;
      }
      return next;
    });
    setPlacementSelectionGroup({});
    const selected = selectedPlacementRef.current;
    if (selected && entries.some(([, placement]) => placement.index === selected.index)) {
      onSelectPlacement(null);
    }
  }, [onSelectPlacement, recordStagedEditHistory]);

  const resetCurrentPlacementEdit = useCallback(() => {
    if (!selectedPlacement) {
      return;
    }

    const key = mapPlacementKey(selectedPlacement.index);
    if (selectedPlacement.index < 0) {
      if (!pendingPlacementAddsRef.current[key]) {
        return;
      }
      recordStagedEditHistory();
      setPendingPlacementAdds((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      onSelectPlacement(null);
      return;
    }
    const hasStagedPlacementEdit = Boolean(
      pendingPlacementPatchesRef.current[key]
      || pendingPlacementSourcesRef.current[key]
      || pendingPlacementDeletesRef.current[key],
    );
    if (hasStagedPlacementEdit) {
      recordStagedEditHistory();
    }
    setPendingPlacementPatches((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setPendingPlacementSources((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setPendingPlacementDeletes((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setPlacementDraft(createPlacementEditDraft(selectedPlacement));
  }, [selectedPlacement, onSelectPlacement, recordStagedEditHistory]);

  const removeStagedTileEdit = useCallback((tileX: number, tileY: number) => {
    const key = mapTileKey(tileX, tileY);
    if (!pendingPatchesRef.current[key]) {
      return;
    }
    recordStagedEditHistory();
    setPendingPatches((current) => {
      if (!current[key]) {
        return current;
      }
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, [recordStagedEditHistory]);

  const removeStagedPlacementUpdate = useCallback((index: number) => {
    const key = mapPlacementKey(index);
    if (!pendingPlacementPatchesRef.current[key]) {
      return;
    }
    recordStagedEditHistory();
    setPendingPlacementPatches((current) => {
      if (!current[key]) {
        return current;
      }
      const next = { ...current };
      delete next[key];
      return next;
    });
    setPendingPlacementSources((current) => {
      if (!current[key]) {
        return current;
      }
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, [recordStagedEditHistory]);

  const removeStagedPlacementAdd = useCallback((tempIndex: number) => {
    const key = mapPlacementKey(tempIndex);
    if (!pendingPlacementAddsRef.current[key]) {
      return;
    }
    recordStagedEditHistory();
    setPendingPlacementAdds((current) => {
      if (!current[key]) {
        return current;
      }
      const next = { ...current };
      delete next[key];
      return next;
    });
    if (selectedPlacement?.index === tempIndex) {
      onSelectPlacement(null);
    }
  }, [onSelectPlacement, recordStagedEditHistory, selectedPlacement?.index]);

  const removeStagedPlacementDelete = useCallback((index: number) => {
    const key = mapPlacementKey(index);
    if (!pendingPlacementDeletesRef.current[key]) {
      return;
    }
    recordStagedEditHistory();
    setPendingPlacementDeletes((current) => {
      if (!current[key]) {
        return current;
      }
      const next = { ...current };
      delete next[key];
      return next;
    });
    setPendingPlacementSources((current) => {
      if (!current[key]) {
        return current;
      }
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, [recordStagedEditHistory]);

  const clearStagedEdits = useCallback(() => {
    if (totalPendingEditCount > 0) {
      recordStagedEditHistory();
    }
    setPendingPatches({});
    setPendingPlacementPatches({});
    setPendingPlacementSources({});
    setPendingPlacementAdds({});
    setPendingPlacementDeletes({});
    setPlacementSelectionGroup({});

    if (inspection) {
      setTileDraft(createTileEditDraft(inspection));
    }
    if ((selectedPlacement && selectedPlacement.index < 0) || selectedPlacementDeleteStaged) {
      onSelectPlacement(null);
      return;
    }
    if (selectedPlacement) {
      setPlacementDraft(createPlacementEditDraft(selectedPlacement));
    }
  }, [
    inspection,
    selectedPlacement,
    selectedPlacementDeleteStaged,
    onSelectPlacement,
    recordStagedEditHistory,
    totalPendingEditCount,
  ]);

  const reloadMapSource = useCallback(() => {
    manifestGuard.current.invalidate();
    overviewGuard.current.invalidate();
    setManifest(null);
    setOverviews({});
    overviewsRef.current = {};
    setChunks({});
    chunksRef.current = {};
    imageCacheRef.current.clear();
    detailLoadGenerationRef.current += 1;
    loadingChunksRef.current.clear();
    activeChunkLoadsRef.current.clear();
    cancelledChunkLoadTokensRef.current.clear();
    queuedChunkLoadsRef.current = [];
    activeChunkLoadCountRef.current = 0;
    pendingChunkLoadRef.current = false;
    if (hoverTilePrefetchTimeoutRef.current !== null) {
      window.clearTimeout(hoverTilePrefetchTimeoutRef.current);
      hoverTilePrefetchTimeoutRef.current = null;
    }
    hoverTilePrefetchKeyRef.current = "";
    if (centerTilePrefetchTimeoutRef.current !== null) {
      window.clearTimeout(centerTilePrefetchTimeoutRef.current);
      centerTilePrefetchTimeoutRef.current = null;
    }
    centerTilePrefetchKeyRef.current = "";
    setDetailLoadActivity({ loading: 0, queued: 0, pending: false });
    setRefreshNonce((current) => current + 1);
  }, []);

  const exportMapEdits = useCallback(async () => {
    if (!projectId || !mapName || !manifest || totalPendingEditCount === 0) {
      return;
    }

    const currentTileKey = inspection ? mapTileKey(inspection.tile_x, inspection.tile_y) : null;
    const stagedPatch = currentTileKey ? pendingPatches[currentTileKey] : null;
    const shouldPreserveDraft = Boolean(
      currentTileKey
      && tileDraft
      && draftPatch
      && !mapTilePatchesEqual(draftPatch, stagedPatch),
    );
    const currentPlacementKey = selectedPlacement
      ? mapPlacementKey(selectedPlacement.index)
      : null;
    const stagedPlacementPatch = currentPlacementKey
      ? pendingPlacementPatches[currentPlacementKey]
      : null;
    const shouldPreservePlacementDraft = Boolean(
      currentPlacementKey
      && placementDraft
      && placementDraftPatch
      && !pendingPlacementDeletes[currentPlacementKey]
      && !mapPlacementPatchesEqual(placementDraftPatch, stagedPlacementPatch),
    );
    const shouldClearSelectedPlacement = Boolean(
      selectedPlacement
      && (
        selectedPlacement.index < 0
        || (currentPlacementKey && pendingPlacementDeletes[currentPlacementKey])
      ),
    );

    setExportingEdits(true);
    try {
      const placementEdits: MapPlacementEdit[] = [
        ...Object.values(pendingPlacementPatches).map((patch) => ({
          op: "update" as const,
          ...patch,
        })),
        ...Object.values(pendingPlacementAdds),
        ...Object.values(pendingPlacementDeletes),
      ];
      const sourceGuard: MapEditSourceGuard = {
        map_source: manifest.source,
        obj_source: manifest.placement_source,
        rbo_source: manifest.rbo_source,
      };
      const result = await exportMapEditsCommand(
        projectId,
        mapName,
        Object.values(pendingPatches),
        placementEdits,
        sourceGuard,
      );
      const exportedPaths = [
        result.map_path,
        result.obj_path,
        result.rbo_path,
        result.atr_path,
        result.blk_path,
      ].filter((path): path is string => Boolean(path));
      toast({
        title: "Native map package exported",
        description: `Saved to ${exportedPaths.join(", ")}`,
      });
      setLastExportResult(result);
      setLastExportSourceGuard(sourceGuard);
      setLastApplyResult(null);
      setLastRestoreResult(null);
      if (shouldPreserveDraft && currentTileKey && tileDraft) {
        preservedTileDraftRef.current = { key: currentTileKey, draft: tileDraft };
      }
      if (shouldPreservePlacementDraft && currentPlacementKey && placementDraft) {
        preservedPlacementDraftRef.current = {
          key: currentPlacementKey,
          draft: placementDraft,
        };
      }
      setPendingPatches({});
      setPendingPlacementPatches({});
      setPendingPlacementSources({});
      setPendingPlacementAdds({});
      setPendingPlacementDeletes({});
      setPlacementSelectionGroup({});
      setStagedEditUndoStack([]);
      setStagedEditRedoStack([]);
      if (shouldClearSelectedPlacement) {
        onSelectPlacement(null);
      }
      if (inspection) {
        postReloadTileRef.current = {
          x: inspection.tile_x,
          y: inspection.tile_y,
        };
        exportReloadPendingRef.current = true;
      }
      reloadMapSource();
    } catch (error) {
      toast(exportMapEditsErrorToast(error));
    } finally {
      setExportingEdits(false);
    }
  }, [
    projectId,
    mapName,
    manifest,
    totalPendingEditCount,
    inspection,
    pendingPatches,
    tileDraft,
    draftPatch,
    selectedPlacement,
    pendingPlacementPatches,
    pendingPlacementAdds,
    pendingPlacementDeletes,
    placementDraft,
    placementDraftPatch,
    onSelectPlacement,
    reloadMapSource,
  ]);

  const draw = useCallback((drawTransform: MapWorkbenchTransform = transformRef.current) => {
    const canvas = canvasRef.current;
    if (!canvas || !manifest) {
      return;
    }
    const activeTransform = drawTransform;
    const drawStartedAt = performance.now();

    const dpr = canvasDevicePixelRatio(window.devicePixelRatio);
    const pixelWidth = Math.max(1, Math.floor(viewport.width * dpr));
    const pixelHeight = Math.max(1, Math.floor(viewport.height * dpr));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    const lastCanvasDrawAt = lastCanvasDrawAtRef.current;
    lastCanvasDrawAtRef.current = drawStartedAt;
    if (lastCanvasDrawAt != null) {
      const intervalMs = drawStartedAt - lastCanvasDrawAt;
      if (
        Number.isFinite(intervalMs)
        && intervalMs > 0
        && intervalMs <= MAX_CANVAS_FRAME_INTERVAL_MS
      ) {
        recordFrame("mapEditor", intervalMs);
      }
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, viewport.width, viewport.height);
    ctx.fillStyle = "#020617";
    ctx.fillRect(0, 0, viewport.width, viewport.height);
    ctx.imageSmoothingEnabled = false;
    ctx.imageSmoothingQuality = "low";

    ctx.save();
    ctx.translate(activeTransform.offsetX, activeTransform.offsetY);
    ctx.scale(activeTransform.scale, activeTransform.scale);
    const hasRasterOverview = activeRasterLayers.some((rasterLayer) => overviews[rasterLayer]);
    ctx.fillStyle = hasRasterOverview ? "#0f172a" : "#1e293b";
    ctx.fillRect(0, 0, manifest.width, manifest.height);

    const drawTextureZoomBucket = textureDetailZoomBucket(activeTransform.scale);
    const drawTextureChunkSize = textureDetailChunkSizeFor(
      drawTextureZoomBucket,
      manifest.chunk_size,
    );
    const activeVisibleChunkKeys = detailChunksEnabled
      ? getVisibleChunkKeys(manifest, viewport, activeTransform, 1, drawTextureChunkSize)
      : [];
    const renderImageCacheLimit = renderImageCacheLimitFor(
      detailChunkCacheLimitFor(
        activeRasterLayers,
        drawTextureZoomBucket,
        drawTextureChunkSize,
        manifest.chunk_size,
      ),
    );
    activeRasterLayers.forEach((rasterLayer, layerIndex) => {
      const layerOverview = overviews[rasterLayer] ?? null;
      const layerOpacity = layerIndex === 0 ? 1 : layerOverlayOpacity(rasterLayer, overlayOpacity);
      const smoothRaster = isTextureDetailLayer(rasterLayer);
      const chunkList = activeVisibleChunkKeys
        .map((key) =>
          chunks[chunkRecordKey(rasterLayer, key, drawTextureZoomBucket, drawTextureChunkSize)]
        )
        .filter((chunk): chunk is MapChunkPayload => Boolean(chunk));

      if (layerOverview) {
        const entry = getCachedImage(
          imageCacheRef.current,
          layerOverview.image_data_uri,
          renderImageCacheLimit,
          () => setDrawVersion((current) => current + 1),
        );
        if (entry.ready) {
          ctx.save();
          if (layerIndex > 0 && chunkList.length > 0) {
            ctx.beginPath();
            ctx.rect(0, 0, manifest.width, manifest.height);
            for (const chunk of chunkList) {
              ctx.rect(chunk.tile_x, chunk.tile_y, chunk.tile_width, chunk.tile_height);
            }
            ctx.clip("evenodd");
          }
          ctx.globalAlpha = layerOpacity;
          ctx.imageSmoothingEnabled = smoothRaster;
          ctx.imageSmoothingQuality = smoothRaster ? "high" : "low";
          ctx.drawImage(entry.image, 0, 0, manifest.width, manifest.height);
          ctx.restore();
        }
      }

      for (const chunk of chunkList) {
        const entry = getCachedImage(
          imageCacheRef.current,
          chunk.image_data_uri,
          renderImageCacheLimit,
          () => setDrawVersion((current) => current + 1),
        );
        if (entry.ready) {
          ctx.globalAlpha = layerOpacity;
          ctx.imageSmoothingEnabled = smoothRaster;
          ctx.imageSmoothingQuality = smoothRaster ? "high" : "low";
          ctx.drawImage(
            entry.image,
            chunk.tile_x,
            chunk.tile_y,
            chunk.tile_width,
            chunk.tile_height,
          );
          ctx.globalAlpha = 1;
        }
      }
    });
    ctx.imageSmoothingEnabled = false;
    ctx.imageSmoothingQuality = "low";

    if (showGrid && activeTransform.scale >= 5) {
      const bounds = tileBoundsForViewport(manifest, viewport, activeTransform);
      const step = activeTransform.scale >= 24 ? 1 : activeTransform.scale >= 10 ? 4 : 16;
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 1 / activeTransform.scale;
      ctx.beginPath();
      for (let x = Math.floor(bounds.minX / step) * step; x <= bounds.maxX; x += step) {
        ctx.moveTo(x, bounds.minY);
        ctx.lineTo(x, bounds.maxY);
      }
      for (let y = Math.floor(bounds.minY / step) * step; y <= bounds.maxY; y += step) {
        ctx.moveTo(bounds.minX, y);
        ctx.lineTo(bounds.maxX, y);
      }
      ctx.stroke();
    }

    const visibleTileBounds = tileBoundsForViewport(manifest, viewport, activeTransform);

    for (const patch of Object.values(pendingPatches)) {
      if (!tilePatchIntersectsBounds(patch, visibleTileBounds)) {
        continue;
      }
      const tileX = patch.tile_x;
      const tileY = patch.tile_y;
      if (!Number.isFinite(tileX) || !Number.isFinite(tileY)) {
        continue;
      }

      const hasLayerPreview = drawTilePatchLayerPreviewForLayers(
        ctx,
        patch,
        activeRasterLayers,
      );
      if (!hasLayerPreview) {
        ctx.fillStyle = "rgba(34,197,94,0.24)";
        ctx.fillRect(tileX, tileY, 1, 1);
      }
      ctx.strokeStyle = "#22c55e";
      ctx.lineWidth = 2 / activeTransform.scale;
      ctx.strokeRect(tileX, tileY, 1, 1);
    }

    if (draftPatch && tilePatchIntersectsBounds(draftPatch, visibleTileBounds)) {
      const hasLayerPreview = drawTilePatchLayerPreviewForLayers(
        ctx,
        draftPatch,
        activeRasterLayers,
      );
      if (hasLayerPreview) {
        ctx.strokeStyle = "#fbbf24";
        ctx.lineWidth = 2 / activeTransform.scale;
        ctx.strokeRect(draftPatch.tile_x, draftPatch.tile_y, 1, 1);
      }
    }

    if (draftPatch && tileBrushRadius > 0) {
      const rawBrushCenterX = tilePaintMode && hoverTile
        ? Math.floor(hoverTile.x)
        : draftPatch.tile_x;
      const rawBrushCenterY = tilePaintMode && hoverTile
        ? Math.floor(hoverTile.y)
        : draftPatch.tile_y;
      const brushCenterX = Math.min(Math.max(0, rawBrushCenterX), Math.max(0, manifest.width - 1));
      const brushCenterY = Math.min(Math.max(0, rawBrushCenterY), Math.max(0, manifest.height - 1));
      const minX = Math.max(0, brushCenterX - tileBrushRadius);
      const minY = Math.max(0, brushCenterY - tileBrushRadius);
      const maxX = Math.min(manifest.width - 1, brushCenterX + tileBrushRadius);
      const maxY = Math.min(manifest.height - 1, brushCenterY + tileBrushRadius);
      const brushWidth = maxX - minX + 1;
      const brushHeight = maxY - minY + 1;
      ctx.fillStyle = "rgba(251,191,36,0.12)";
      ctx.strokeStyle = "#fbbf24";
      ctx.lineWidth = 2 / activeTransform.scale;
      ctx.fillRect(minX, minY, brushWidth, brushHeight);
      ctx.strokeRect(minX, minY, brushWidth, brushHeight);
    }

    if (hoverTile) {
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = 1.5 / activeTransform.scale;
      ctx.strokeRect(Math.floor(hoverTile.x), Math.floor(hoverTile.y), 1, 1);
    }

    const highlightedTile = inspection
      ? { x: inspection.tile_x, y: inspection.tile_y }
      : selectedTile;
    if (highlightedTile) {
      ctx.strokeStyle = "#fbbf24";
      ctx.lineWidth = 2 / activeTransform.scale;
      ctx.strokeRect(highlightedTile.x, highlightedTile.y, 1, 1);
    }

    const activeMarkerDensity = PLACEMENT_MARKER_DENSITIES[placementMarkerDensity];
    const activeMarkerPlacements = selectPlacementMarkersForViewport({
      placements: renderedPlacements,
      transform: activeTransform,
      viewport,
      pinnedKeys: pinnedPlacementKeys,
      minSpacingPx: activeMarkerDensity.minSpacingPx,
      maxMarkers: activeMarkerDensity.maxMarkers,
    });
    for (const placement of activeMarkerPlacements) {
      const selected = selectedPlacement?.index === placement.index;
      const inPlacementGroup = Boolean(placementSelectionGroup[mapPlacementKey(placement.index)]);
      const staged = Boolean(
        pendingPlacementPatches[mapPlacementKey(placement.index)]
        || pendingPlacementAdds[mapPlacementKey(placement.index)],
      );
      const visual = getPlacementMarkerVisual({
        selected,
        scale: activeTransform.scale,
        overlayEnabled: showPlacements,
      });
      if (!visual) {
        continue;
      }
      const radius = visual.radiusPx / activeTransform.scale;
      const color = placement.obj_type === 1 ? "56,189,248" : "249,115,22";
      ctx.beginPath();
      ctx.arc(placement.world_x, placement.world_y, radius, 0, Math.PI * 2);
      ctx.fillStyle = staged
        ? "rgba(34,197,94,0.82)"
        : inPlacementGroup
          ? "rgba(250,204,21,0.82)"
          : `rgba(${color},${visual.fillAlpha})`;
      ctx.fill();
      ctx.lineWidth = (selected || staged || inPlacementGroup ? 2.5 : 1) / activeTransform.scale;
      ctx.strokeStyle = selected
        ? "#ffffff"
        : staged
          ? "#22c55e"
          : inPlacementGroup
            ? "#facc15"
            : `rgba(15,23,42,${visual.strokeAlpha})`;
      ctx.stroke();
    }

    if (showPlacements && visibleRboRecords.length > 0 && activeTransform.scale >= DETAIL_CHUNK_MIN_SCALE) {
      const radius = 4 / activeTransform.scale;
      for (const record of visibleRboRecords) {
        if (!Number.isFinite(record.x) || !Number.isFinite(record.y)) {
          continue;
        }
        ctx.beginPath();
        ctx.moveTo(record.x, record.y - radius);
        ctx.lineTo(record.x + radius, record.y);
        ctx.lineTo(record.x, record.y + radius);
        ctx.lineTo(record.x - radius, record.y);
        ctx.lineTo(record.x, record.y - radius);
        ctx.fillStyle = "rgba(14,165,233,0.28)";
        ctx.fill();
        ctx.lineWidth = 1 / activeTransform.scale;
        ctx.strokeStyle = "rgba(224,242,254,0.8)";
        ctx.stroke();
      }
    }

    ctx.strokeStyle = "rgba(226,232,240,0.75)";
    ctx.lineWidth = 2 / activeTransform.scale;
    ctx.strokeRect(0, 0, manifest.width, manifest.height);
    ctx.restore();
  }, [
    activeRasterLayerKey,
    activeRasterLayers,
    chunks,
    detailChunksEnabled,
    draftPatch,
    drawVersion,
    hoverTile,
    inspection,
    manifest,
    overviews,
    overlayOpacity,
    pendingPatches,
    pendingPlacementPatches,
    pendingPlacementAdds,
    placementSelectionGroup,
    placementMarkerDensity,
    pinnedPlacementKeys,
    renderedPlacements,
    selectedPlacement,
    selectedTile,
    showGrid,
    showPlacements,
    tilePaintMode,
    tileBrushRadius,
    visibleRboRecords,
    viewport,
  ]);

  useLayoutEffect(() => {
    drawWithTransformRef.current = draw;
  }, [draw]);

  useEffect(() => {
    draw(transformRef.current);
  }, [draw, transform]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) {
      return;
    }
    event.currentTarget.focus();
    clearHoverTileInspectionPrefetch();
    clearCenterTileInspectionPrefetch();
    flushPendingDragTransform();
    const point = getCanvasPoint(event);
    if (tilePaintMode && draftPatch) {
      const tile = screenToTile(point.x, point.y, transformRef.current);
      const paintTile = { x: Math.floor(tile.x), y: Math.floor(tile.y) };
      stageTileBrushAt(paintTile.x, paintTile.y);
      setHoverTile(paintTile);
      dragRef.current = {
        pointerId: event.pointerId,
        startX: point.x,
        startY: point.y,
        startOffsetX: transformRef.current.offsetX,
        startOffsetY: transformRef.current.offsetY,
        moved: false,
        painting: true,
        lastPaintTile: paintTile,
      };
      safeSetPointerCapture(event.currentTarget, event.pointerId);
      return;
    }

    dragRef.current = {
      pointerId: event.pointerId,
      startX: point.x,
      startY: point.y,
      startOffsetX: transformRef.current.offsetX,
      startOffsetY: transformRef.current.offsetY,
      moved: false,
      painting: false,
      panOnly: interactionModeRef.current === "pan",
    };
    if (interactionModeRef.current === "select" && selectedPlacementRef.current) {
      const hit = hitTestPlacementMarker(
        hittablePlacements,
        point,
        transformRef.current,
        8,
      );
      if (hit?.index === selectedPlacementRef.current.index) {
        const tile = screenToTile(point.x, point.y, transformRef.current);
        dragRef.current.placementDrag = {
          index: hit.index,
          startWorldX: placementDraft?.worldX ?? selectedPlacementRef.current.world_x,
          startWorldY: placementDraft?.worldY ?? selectedPlacementRef.current.world_y,
          startTileX: tile.x,
          startTileY: tile.y,
        };
      }
    }
    safeSetPointerCapture(event.currentTarget, event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const point = getCanvasPoint(event);
    clearCenterTileInspectionPrefetch();
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      const tile = screenToTile(point.x, point.y, transformRef.current);
      setHoverTile((current) => isSameTile(current, tile) ? current : tile);
      scheduleHoverTileInspectionPrefetch(tile);
      return;
    }

    if (drag.painting) {
      const tile = screenToTile(point.x, point.y, transformRef.current);
      const paintTile = { x: Math.floor(tile.x), y: Math.floor(tile.y) };
      setHoverTile((current) => isSameTile(current, paintTile) ? current : paintTile);
      if (!isSameTile(drag.lastPaintTile ?? null, paintTile)) {
        stageTileBrushAt(paintTile.x, paintTile.y);
        drag.lastPaintTile = paintTile;
      }
      return;
    }

    const dx = point.x - drag.startX;
    const dy = point.y - drag.startY;
    if (Math.hypot(dx, dy) > 2) {
      drag.moved = true;
    }
    if (drag.placementDrag) {
      if (!drag.moved) {
        return;
      }
      const tile = screenToTile(point.x, point.y, transformRef.current);
      const nextWorldX = roundPlacementCoordinate(clampPlacementX(
        drag.placementDrag.startWorldX + tile.x - drag.placementDrag.startTileX,
      ));
      const nextWorldY = roundPlacementCoordinate(clampPlacementY(
        drag.placementDrag.startWorldY + tile.y - drag.placementDrag.startTileY,
      ));
      const currentDraft = placementDraftRef.current;
      const placementChanged = Boolean(
        currentDraft
        && (
          currentDraft.worldX !== nextWorldX
          || currentDraft.worldY !== nextWorldY
        ),
      );
      if (!placementChanged) {
        setHoverTile({ x: Math.floor(tile.x), y: Math.floor(tile.y) });
        return;
      }
      if (drag.placementDrag.index < 0 && !drag.placementDrag.stagedAddHistoryRecorded) {
        recordStagedEditHistory();
        drag.placementDrag.stagedAddHistoryRecorded = true;
      }
      updatePlacementDraft((current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          worldX: nextWorldX,
          worldY: nextWorldY,
        };
      });
      setHoverTile({ x: Math.floor(tile.x), y: Math.floor(tile.y) });
      return;
    }
    const nextTransform = {
      ...transformRef.current,
      offsetX: drag.startOffsetX + dx,
      offsetY: drag.startOffsetY + dy,
    };
    scheduleDragTransform(nextTransform);
    queueVisibleDetailChunksForTransform(nextTransform, { throttle: true });
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    flushPendingDragTransform();
    dragRef.current = null;
    safeReleasePointerCapture(event.currentTarget, event.pointerId);
    if (drag.painting) {
      const point = getCanvasPoint(event);
      const tile = screenToTile(point.x, point.y, transformRef.current);
      const paintTile = { x: Math.floor(tile.x), y: Math.floor(tile.y) };
      if (!isSameTile(drag.lastPaintTile ?? null, paintTile)) {
        stageTileBrushAt(paintTile.x, paintTile.y);
      }
      return;
    }
    if (drag.placementDrag) {
      if (!drag.moved && selectedPlacementRef.current) {
        void inspectTile(
          Math.floor(drag.placementDrag.startWorldX),
          Math.floor(drag.placementDrag.startWorldY),
        );
      }
      return;
    }
    if (drag.moved) {
      return;
    }
    if (drag.panOnly) {
      return;
    }

    const point = getCanvasPoint(event);
    const hit = hitTestPlacementMarker(
      hittablePlacements,
      point,
      transformRef.current,
      8,
    );
    if (hit) {
      const sourcePlacement = sourceRenderedPlacements.find((placement) =>
        placement.index === hit.index
      );
      onSelectPlacement(sourcePlacement ?? hit);
      void inspectTile(Math.floor(hit.world_x), Math.floor(hit.world_y));
      return;
    }

    const tile = screenToTile(point.x, point.y, transformRef.current);
    onSelectPlacement(null);
    const tileX = Math.floor(tile.x);
    const tileY = Math.floor(tile.y);
    if (tilePaintMode && draftPatch) {
      stageTileBrushAt(tileX, tileY);
      return;
    }
    void inspectTile(tileX, tileY);
  };

  const handleWheel = (event: ReactWheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const point = getCanvasPoint(event);
    const nextTransform = applyZoomAtPoint(point, event.deltaY < 0 ? 1 : -1);
    const drag = dragRef.current;
    if (drag && !drag.painting && !drag.placementDrag) {
      pendingDragTransformRef.current = nextTransform;
      drag.startX = point.x;
      drag.startY = point.y;
      drag.startOffsetX = nextTransform.offsetX;
      drag.startOffsetY = nextTransform.offsetY;
    }
  };

  const handleCanvasKeyDown = (event: ReactKeyboardEvent<HTMLCanvasElement>) => {
    if (!manifest) {
      return;
    }

    if ((event.ctrlKey || event.metaKey) && !event.altKey) {
      const key = event.key.toLowerCase();
      if (key === "z" && event.shiftKey) {
        event.preventDefault();
        if (canRedoStagedEdit) {
          redoStagedEdit();
        }
        return;
      }
      if (key === "z") {
        event.preventDefault();
        if (canUndoStagedEdit) {
          undoStagedEdit();
        }
        return;
      }
      if (key === "y") {
        event.preventDefault();
        if (canRedoStagedEdit) {
          redoStagedEdit();
        }
        return;
      }
    }

    switch (event.key) {
      case "ArrowLeft":
        event.preventDefault();
        applyTransform((current) => ({
          ...current,
          offsetX: current.offsetX + KEYBOARD_PAN_STEP_PX,
        }));
        return;
      case "ArrowRight":
        event.preventDefault();
        applyTransform((current) => ({
          ...current,
          offsetX: current.offsetX - KEYBOARD_PAN_STEP_PX,
        }));
        return;
      case "ArrowUp":
        event.preventDefault();
        applyTransform((current) => ({
          ...current,
          offsetY: current.offsetY + KEYBOARD_PAN_STEP_PX,
        }));
        return;
      case "ArrowDown":
        event.preventDefault();
        applyTransform((current) => ({
          ...current,
          offsetY: current.offsetY - KEYBOARD_PAN_STEP_PX,
        }));
        return;
      case "+":
      case "=":
        event.preventDefault();
        zoomBy(1);
        return;
      case "-":
      case "_":
        event.preventDefault();
        zoomBy(-1);
        return;
      case "f":
      case "F":
        event.preventDefault();
        fitMap();
        return;
      case "g":
      case "G":
        event.preventDefault();
        setShowGrid((current) => !current);
        return;
      case "o":
      case "O":
        event.preventDefault();
        setShowPlacements((current) => !current);
        return;
      default:
    }
  };

  const activeLayers = manifest
    ? LAYERS.filter((entry) => manifest.available_layers.includes(entry.value))
    : LAYERS;
  const availableOverlayLayers = manifest
    ? COMPOSITE_OVERLAY_LAYERS.filter((entry) =>
      entry.value !== layer && manifest.available_layers.includes(entry.value)
    )
    : [];
  const currentLayerLabel = LAYERS.find((entry) => entry.value === layer)?.label ?? layer;
  const currentLayerLegend = LAYER_LEGENDS[layer];
  const activeOverlayLegendLabel = activeOverlayLayers
    .map((entry) => LAYER_LEGENDS[entry]?.label ?? entry)
    .join(", ");
  const displayedLayerLegend = currentLayerLegend
    ? {
        label: activeOverlayLayers.length > 0
          ? `${activeOverlayLegendLabel} ${activeOverlayLayers.length === 1 ? "overlay" : "overlays"}`
          : currentLayerLegend.label,
        hint: activeOverlayLayers.length > 0
          ? `Over ${currentLayerLegend.label}`
          : currentLayerLegend.hint,
        title: activeOverlayLayers.length > 0
          ? `${currentLayerLegend.label} with ${activeOverlayLegendLabel} overlay`
          : `${currentLayerLegend.label}: ${currentLayerLegend.hint}`,
      }
    : null;
  const detailChunkWindowSuppressed =
    detailChunkScaleEnabled && candidateDetailChunkRequestCount > activeDetailChunkCacheLimit;
  const activeVisibleDetailRecordKeys = detailChunksEnabled
    ? activeRasterLayers.flatMap((requestedLayer) =>
      visibleChunkKeys.map((key) =>
        chunkRecordKey(
          requestedLayer,
          key,
          activeTextureDetailZoomBucket,
          activeTextureDetailChunkSize,
        )
      )
    )
    : [];
  const activeLoadedDetailChunkCount = activeVisibleDetailRecordKeys.filter((key) => chunks[key]).length;
  const activeDetailLoadCount = detailLoadActivity.loading + detailLoadActivity.queued;
  const detailChunksPending = detailChunksEnabled && detailLoadActivity.pending;
  const detailChunksLoading = detailChunksEnabled && (activeDetailLoadCount > 0 || detailChunksPending);
  const activeTextureDetailLayer = activeRasterLayers.find(isTextureDetailLayer);
  const activeTextureDetailLabel = activeTextureDetailLayer === "texture_raw"
    ? "Raw texture"
    : "Client texture";
  const activeDetailTargetLabel = activeTextureDetailLayer
    ? `${activeTextureDetailLabel} ${textureDetailSamplesPerTile(activeTextureDetailZoomBucket)} px/tile${activeRasterLayers.length > 1 ? " + overlays" : ""}`
    : "Map detail";
  const detailChunkStatus = detailChunksEnabled
    ? detailChunksLoading
      ? detailChunksPending && activeDetailLoadCount === 0
        ? `Queueing ${activeDetailTargetLabel} ${activeLoadedDetailChunkCount}/${activeDetailChunkRequestCount}`
        : `Loading ${activeDetailTargetLabel} ${activeLoadedDetailChunkCount}/${activeDetailChunkRequestCount}`
      : `Loaded ${activeDetailTargetLabel} ${activeLoadedDetailChunkCount}/${activeDetailChunkRequestCount}`
    : detailChunkWindowSuppressed
      ? "Overview: wide view"
      : "Overview";
  const canvasCursorClass = interactionMode === "pan"
    ? "cursor-grab active:cursor-grabbing"
    : interactionMode === "paint"
      ? "cursor-cell"
      : "cursor-crosshair";
  const selectedPlacementIsTemporary = Boolean(
    selectedPlacement && selectedPlacement.index < 0,
  );
  const pendingEditSummary = formatPendingEditSummary({
    tileCount: pendingPatchCount,
    placementUpdateCount: pendingPlacementPatchCount,
    placementAddCount: pendingPlacementAddCount,
    placementDeleteCount: pendingPlacementDeleteCount,
  });
  const stagedEditSummaryLabel = pendingEditSummary || `${totalPendingEditCount} edits`;
  const serverOutputPreflight = manifest ? getServerOutputPreflight(manifest) : null;
  const nativeExportBlockedReason =
    serverOutputPreflight && !serverOutputPreflight.blkAligned
      ? "Cannot export BLK: collision row width must be byte-aligned"
      : null;
  const nativeExportTooltip =
    nativeExportBlockedReason ?? "Export staged edits as native MAP, OBJ, ATR, and BLK files";
  const lastExportRows: MapExportReceiptRow[] = lastExportResult
    ? [
        {
          target: "Client",
          label: "MAP",
          path: lastExportResult.map_path,
          bytes: lastExportResult.map_bytes_written,
          sha256: lastExportResult.map_sha256,
        },
        {
          target: "Client",
          label: "OBJ",
          path: lastExportResult.obj_path,
          bytes: lastExportResult.obj_bytes_written,
          sha256: lastExportResult.obj_sha256,
        },
        ...(lastExportResult.rbo_path
          ? [{
              target: "Client",
              label: "RBO",
              path: lastExportResult.rbo_path,
              bytes: lastExportResult.rbo_bytes_written,
              sha256: lastExportResult.rbo_sha256 ?? "",
            }]
          : []),
        {
          target: "Server",
          label: "ATR",
          path: lastExportResult.atr_path,
          bytes: lastExportResult.atr_bytes_written,
          sha256: lastExportResult.atr_sha256,
        },
        {
          target: "Server",
          label: "BLK",
          path: lastExportResult.blk_path,
          bytes: lastExportResult.blk_bytes_written,
          sha256: lastExportResult.blk_sha256,
        },
      ]
    : [];

  useEffect(() => {
    if (!mapName || totalPendingEditCount === 0) {
      setMapStagedEditState((current) =>
        !mapName || current?.mapName === mapName ? null : current
      );
      return;
    }

    setMapStagedEditState({
      mapName,
      count: totalPendingEditCount,
      summary: stagedEditSummaryLabel,
    });
  }, [mapName, setMapStagedEditState, stagedEditSummaryLabel, totalPendingEditCount]);

  useEffect(() => () => {
    if (!mapName) {
      return;
    }
    setMapStagedEditState((current) =>
      current?.mapName === mapName ? null : current
    );
  }, [mapName, setMapStagedEditState]);

  const reviewStagedTile = useCallback(
    (tileX: number, tileY: number) => {
      if (!manifest) {
        return;
      }
      onSelectPlacement(null);
      applyTransform((current) =>
        centerTransformOnTile(
          { x: tileX + 0.5, y: tileY + 0.5 },
          unobscuredViewport,
          Math.max(current.scale, 4),
        )
      );
      void inspectTile(tileX, tileY);
    },
    [applyTransform, inspectTile, manifest, onSelectPlacement, unobscuredViewport],
  );
  const reviewStagedPlacement = useCallback(
    (placement: MapPlacementRecord, patch?: MapPlacementPatch | null) => {
      const placementForView = applyPlacementPatch(placement, patch);
      onSelectPlacement(placement);
      applyTransform((current) =>
        centerTransformOnTile(
          {
            x: placementForView.world_x,
            y: placementForView.world_y,
          },
          unobscuredViewport,
          Math.max(current.scale, 4),
        )
      );
    },
    [applyTransform, onSelectPlacement, unobscuredViewport],
  );

  const reloadMap = useCallback(() => {
    if (!projectId || !mapName) {
      return;
    }
    if (
      totalPendingEditCount > 0
      && !window.confirm(`Discard ${pendingEditSummary || `${totalPendingEditCount} edits`} and reload this map?`)
    ) {
      return;
    }

    reloadMapSource();
  }, [mapName, pendingEditSummary, projectId, reloadMapSource, totalPendingEditCount]);

  const stagedEditReviewItems = useMemo<StagedEditReviewItem[]>(() => {
    const items: StagedEditReviewItem[] = [];

    for (const patch of Object.values(pendingPatches)
      .sort((left, right) => left.tile_x - right.tile_x || left.tile_y - right.tile_y)) {
      const removeLabel = formatTilePatchReviewLabel(patch, "Remove staged tile");
      items.push({
        key: `tile:${patch.tile_x}:${patch.tile_y}`,
        label: formatTilePatchReviewLabel(patch, "Review tile"),
        ariaLabel: formatTilePatchReviewLabel(patch, "Review staged tile"),
        onActivate: () => reviewStagedTile(patch.tile_x, patch.tile_y),
        removeAriaLabel: removeLabel,
        onRemove: () => removeStagedTileEdit(patch.tile_x, patch.tile_y),
      });
    }

    for (const patch of Object.values(pendingPlacementPatches)
      .sort((left, right) => left.index - right.index)) {
      const key = mapPlacementKey(patch.index);
      const source = pendingPlacementSources[key];
      if (!source) {
        continue;
      }
      items.push({
        key: `placement-update:${patch.index}`,
        label: `Review placement update idx ${patch.index}`,
        ariaLabel: `Review staged placement update idx ${patch.index}`,
        onActivate: () => reviewStagedPlacement(source, patch),
        removeAriaLabel: `Remove staged placement update idx ${patch.index}`,
        onRemove: () => removeStagedPlacementUpdate(patch.index),
      });
    }

    for (const [key, edit] of Object.entries(pendingPlacementAdds)) {
      const tempIndex = Number(key);
      const placement = createTemporaryPlacementFromAddEdit(edit, tempIndex);
      items.push({
        key: `placement-add:${key}`,
        label: `Review placement add id ${edit.obj_id}`,
        ariaLabel: `Review staged placement add id ${edit.obj_id}`,
        onActivate: () => reviewStagedPlacement(placement),
        removeAriaLabel: `Remove staged placement add id ${edit.obj_id}`,
        onRemove: () => removeStagedPlacementAdd(tempIndex),
      });
    }

    for (const edit of Object.values(pendingPlacementDeletes)
      .sort((left, right) => left.index - right.index)) {
      const key = mapPlacementKey(edit.index);
      const source = pendingPlacementSources[key];
      if (!source) {
        continue;
      }
      items.push({
        key: `placement-delete:${edit.index}`,
        label: `Review placement delete idx ${edit.index}`,
        ariaLabel: `Review staged placement delete idx ${edit.index}`,
        onActivate: () => reviewStagedPlacement(source),
        removeAriaLabel: `Remove staged placement delete idx ${edit.index}`,
        onRemove: () => removeStagedPlacementDelete(edit.index),
      });
    }

    return items;
  }, [
    pendingPatches,
    pendingPlacementPatches,
    pendingPlacementAdds,
    pendingPlacementDeletes,
    pendingPlacementSources,
    removeStagedPlacementAdd,
    removeStagedPlacementDelete,
    removeStagedPlacementUpdate,
    removeStagedTileEdit,
    reviewStagedPlacement,
    reviewStagedTile,
  ]);
  const stagedEditPreviewItems = stagedEditReviewItems;
  const placementBuildingOptions = useMemo(() => {
    const query = buildingCatalogQuery.trim().toLowerCase();
    const matches = query
      ? buildingCatalog.filter((building) =>
          building.display_name.toLowerCase().includes(query)
          || building.filename.toLowerCase().includes(query)
          || String(building.id).includes(query)
        )
      : buildingCatalog;
    return matches.slice(0, 6);
  }, [buildingCatalog, buildingCatalogQuery]);

  const placementEffectOptions = useMemo(() => {
    const query = effectCatalogQuery.trim().toLowerCase();
    const matches = query
      ? effectCatalog.filter((effect) =>
          effect.display_name.toLowerCase().includes(query)
          || effect.filename.toLowerCase().includes(query)
          || String(effect.id).includes(query)
        )
      : effectCatalog;
    return matches.slice(0, 6);
  }, [effectCatalog, effectCatalogQuery]);

  const selectPlacementBuilding = useCallback((building: BuildingEntry) => {
    setPlacementAddDraft((current) =>
      current
        ? { ...current, objType: 0, objId: building.id }
        : current
    );
    setBuildingCatalogQuery(building.display_name);
  }, []);

  const selectPlacementEffect = useCallback((effect: SceneEffectEntry) => {
    setPlacementAddDraft((current) =>
      current
        ? { ...current, objType: 1, objId: effect.id }
        : current
    );
    setEffectCatalogQuery(effect.display_name);
  }, []);

  const selectReplacementBuilding = useCallback((building: BuildingEntry) => {
    updatePlacementDraft((current) => ({
      ...current,
      objType: 0,
      objId: building.id,
    }));
    setBuildingCatalogQuery(building.display_name);
  }, [updatePlacementDraft]);

  const selectReplacementEffect = useCallback((effect: SceneEffectEntry) => {
    updatePlacementDraft((current) => ({
      ...current,
      objType: 1,
      objId: effect.id,
    }));
    setEffectCatalogQuery(effect.display_name);
  }, [updatePlacementDraft]);

  const placementAddPreviewPlacement = useMemo<MapPlacementRecord | null>(() => {
    if (!placementAddDraft || placementAddDraft.objType !== 0) {
      return null;
    }

    const building = buildingCatalog.find((entry) => entry.id === placementAddDraft.objId);
    if (!building) {
      return null;
    }

    return {
      index: -1,
      obj_type: 0,
      obj_id: placementAddDraft.objId,
      kind: "building",
      world_x: placementAddDraft.worldX,
      world_y: placementAddDraft.worldY,
      world_z: placementAddDraft.worldZ,
      yaw_angle: placementAddDraft.yawAngle,
      scale: placementAddDraft.scale,
      display_name: building.display_name,
      asset_name: building.filename,
      attach_effect_id: null,
      distance: null,
    };
  }, [buildingCatalog, placementAddDraft]);
  const selectedPlacementDraftView = selectedPlacementForView ?? selectedPlacement;
  const selectedPlacementEffect = useMemo(() => {
    if (!selectedPlacementDraftView || selectedPlacementDraftView.obj_type !== 1) {
      return null;
    }

    return effectCatalog.find((entry) => entry.id === selectedPlacementDraftView.obj_id) ?? null;
  }, [effectCatalog, selectedPlacementDraftView]);
  const placementAddEffect = useMemo(() => {
    if (!placementAddDraft || placementAddDraft.objType !== 1) {
      return null;
    }

    return effectCatalog.find((entry) => entry.id === placementAddDraft.objId) ?? null;
  }, [effectCatalog, placementAddDraft]);

  const copyText = useCallback(async (text: string, description: string) => {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard is unavailable");
      }
      await navigator.clipboard.writeText(text);
      toast({
        title: "Copied",
        description,
      });
    } catch (error) {
      toast({
        title: "Failed to copy",
        description: String(error),
        variant: "destructive",
      });
    }
  }, []);

  const revealLastExport = useCallback(async () => {
    if (!lastExportResult) {
      return;
    }
    try {
      await revealItemInDir(lastExportResult.map_path);
    } catch (error) {
      toast({
        title: "Could not open export folder",
        description: errorMessage(error),
        variant: "destructive",
      });
    }
  }, [lastExportResult]);

  const installLastClientPackage = useCallback(async () => {
    if (!projectId || !mapName || !lastExportResult || !lastExportSourceGuard) {
      return;
    }

    setApplyingClientPackage(true);
    try {
      const result = await applyMapEditClientPackageCommand(
        projectId,
        mapName,
        {
          map_path: lastExportResult.map_path,
          obj_path: lastExportResult.obj_path,
          rbo_path: lastExportResult.rbo_path,
          map_bytes: lastExportResult.map_bytes_written,
          obj_bytes: lastExportResult.obj_bytes_written,
          rbo_bytes: lastExportResult.rbo_bytes_written,
          map_sha256: lastExportResult.map_sha256,
          obj_sha256: lastExportResult.obj_sha256,
          rbo_sha256: lastExportResult.rbo_sha256,
        },
        lastExportSourceGuard,
      );
      setLastApplyResult(result);
      setLastRestoreResult(null);
      toast({
        title: "Client files installed",
        description: `Backed up originals to ${result.backup_dir}`,
      });
      reloadMapSource();
    } catch (error) {
      toast({
        title: "Failed to install client files",
        description: errorMessage(error),
        variant: "destructive",
      });
    } finally {
      setApplyingClientPackage(false);
    }
  }, [lastExportResult, lastExportSourceGuard, mapName, projectId, reloadMapSource]);

  const restoreLastClientBackup = useCallback(async () => {
    if (!projectId || !mapName || !lastApplyResult) {
      return;
    }

    setRestoringClientBackup(true);
    try {
      const result = await restoreMapEditClientBackupCommand(
        projectId,
        mapName,
        lastApplyResult.backup_dir,
      );
      setLastRestoreResult(result);
      setLastApplyResult(null);
      toast({
        title: "Client files restored",
        description: `Current files backed up to ${result.restore_backup_dir}`,
      });
      reloadMapSource();
    } catch (error) {
      toast({
        title: "Failed to restore client files",
        description: errorMessage(error),
        variant: "destructive",
      });
    } finally {
      setRestoringClientBackup(false);
    }
  }, [lastApplyResult, mapName, projectId, reloadMapSource]);

  const duplicateSelectedPlacement = useCallback(() => {
    if (!selectedPlacement) {
      return;
    }
    setPlacementAddEditorOpen(true);
    const worldX = placementDraft?.worldX ?? selectedPlacement.world_x;
    const worldY = placementDraft?.worldY ?? selectedPlacement.world_y;
    setPlacementAddDraft({
      objType: placementDraft?.objType ?? selectedPlacement.obj_type,
      objId: placementDraft?.objId ?? selectedPlacement.obj_id,
      worldX: worldX + 1,
      worldY: worldY + 1,
      worldZ: placementDraft?.worldZ ?? selectedPlacement.world_z,
      yawAngle: placementDraft?.yawAngle ?? selectedPlacement.yaw_angle,
      scale: placementDraft?.scale ?? selectedPlacement.scale,
    });
    const query =
      selectedPlacementForView?.display_name
      ?? selectedPlacementForView?.asset_name
      ?? String(placementDraft?.objId ?? selectedPlacement.obj_id);
    if ((placementDraft?.objType ?? selectedPlacement.obj_type) === 0) {
      setBuildingCatalogQuery(query);
    } else {
      setEffectCatalogQuery(query);
    }
    onSelectPlacement(null);
  }, [onSelectPlacement, placementDraft, selectedPlacement, selectedPlacementForView]);

  const selectedPlacementEditor = selectedPlacement && placementDraft ? (
    <div className="mt-3 rounded border p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] uppercase text-muted-foreground">
            Selected placement
          </div>
          <div className="truncate text-sm font-medium">
            {selectedPlacementDraftView?.display_name
              ?? selectedPlacementDraftView?.asset_name
              ?? `${selectedPlacementDraftView?.kind ?? selectedPlacement.kind} ${
                selectedPlacementDraftView?.obj_id ?? selectedPlacement.obj_id
              }`}
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-1">
          <div
            className="flex h-7 items-center gap-1 rounded border bg-muted/30 px-2 text-[11px] text-muted-foreground"
            aria-label="Selected placement can be dragged on the map"
            title="Drag the selected marker on the map"
          >
            <MousePointer2 className="h-3.5 w-3.5" />
            <span>Drag marker on map</span>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-xs"
            title="Copy placement coordinates"
            aria-label="Copy placement coordinates"
            onClick={() => void copyText(
              [
                placementDraft.worldX.toFixed(2),
                placementDraft.worldY.toFixed(2),
                placementDraft.worldZ.toFixed(2),
              ].join(", "),
              "Placement coordinates copied",
            )}
          >
            <Copy className="h-3.5 w-3.5" />
            <span>Copy</span>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-xs"
            title="Duplicate placement"
            aria-label="Duplicate placement"
            onClick={duplicateSelectedPlacement}
          >
            <Copy className="h-3.5 w-3.5" />
            <span>Duplicate</span>
          </Button>
          {!selectedPlacementIsTemporary && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 px-2 text-xs"
              disabled={selectedPlacementInGroup || selectedPlacementDeleteStaged}
              title={selectedPlacementInGroup ? "Placement is already in the group" : "Add placement to group"}
              aria-label="Add placement to group"
              onClick={addSelectedPlacementToGroup}
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Group</span>
            </Button>
          )}
          {!selectedPlacementIsTemporary && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 px-2 text-xs"
              title="Reset placement edit"
              aria-label="Reset placement edit"
              onClick={resetCurrentPlacementEdit}
            >
              <Undo2 className="h-3.5 w-3.5" />
              <span>Reset</span>
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-xs text-destructive"
            title={selectedPlacementIsTemporary ? "Remove staged placement" : "Stage placement delete"}
            aria-label={selectedPlacementIsTemporary ? "Remove staged placement" : "Stage placement delete"}
            onClick={stageCurrentPlacementDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>{selectedPlacementIsTemporary ? "Remove" : "Delete"}</span>
          </Button>
          {!selectedPlacementIsTemporary && (
            <Button
              size="sm"
              variant="secondary"
              className="h-7 gap-1 px-2 text-xs"
              disabled={!placementDraftPatch || selectedPlacementDeleteStaged}
              title="Stage placement edit"
              aria-label="Stage placement edit"
              onClick={stageCurrentPlacementEdit}
            >
              <Check className="h-3.5 w-3.5" />
              <span>Stage</span>
            </Button>
          )}
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[11px] uppercase text-muted-foreground">Type</span>
          <Select
            value={String(placementDraft.objType)}
            onValueChange={(value) =>
              updatePlacementDraftNumber("objType", Number(value))
            }
          >
            <SelectTrigger
              aria-label="Selected placement type"
              className="mt-1 h-7 w-full px-2 font-mono text-[11px]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Building</SelectItem>
              <SelectItem value="1">Effect</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <NumberField
          label="Selected placement object id"
          value={placementDraft.objId}
          min={1}
          max={0x3fff}
          onChange={(value) => updatePlacementDraftNumber("objId", value)}
        />
      </div>
      {showSelectedPlacementPreview && selectedPlacementDraftView?.obj_type === 0 && (
        <MapPlacementBuildingPreview placement={selectedPlacementDraftView} />
      )}
      {selectedPlacementDraftView?.obj_type === 1 && (
        <MapPlacementEffectInfo
          effect={selectedPlacementEffect}
          effectId={selectedPlacementDraftView.obj_id}
          displayName={selectedPlacementDraftView.display_name}
          assetName={selectedPlacementDraftView.asset_name}
        />
      )}
      {placementDraft.objType === 0 && buildingCatalog.length > 0 && (
        <div className="mt-2 rounded border bg-muted/30 p-2">
          <Input
            aria-label="Search replacement buildings"
            placeholder="Search buildings..."
            value={buildingCatalogQuery}
            onChange={(event) => setBuildingCatalogQuery(event.target.value)}
            className="h-7 px-2 text-xs"
          />
          <div className="mt-2 max-h-36 space-y-1 overflow-y-auto">
            {placementBuildingOptions.map((building) => {
              const selected = placementDraft.objId === building.id;
              return (
                <button
                  key={building.id}
                  type="button"
                  aria-label={`Replace with building ${building.display_name}`}
                  className={`w-full rounded px-2 py-1.5 text-left text-xs hover:bg-accent ${
                    selected ? "bg-accent" : ""
                  }`}
                  onClick={() => selectReplacementBuilding(building)}
                >
                  <div className="truncate font-medium">{building.display_name}</div>
                  <div className="truncate font-mono text-[11px] text-muted-foreground">
                    id {building.id} {building.filename}
                  </div>
                </button>
              );
            })}
            {placementBuildingOptions.length === 0 && (
              <div className="px-2 py-1 text-[11px] text-muted-foreground">
                No buildings found
              </div>
            )}
          </div>
        </div>
      )}
      {placementDraft.objType === 1 && effectCatalog.length > 0 && (
        <div className="mt-2 rounded border bg-muted/30 p-2">
          <Input
            aria-label="Search replacement effects"
            placeholder="Search effects..."
            value={effectCatalogQuery}
            onChange={(event) => setEffectCatalogQuery(event.target.value)}
            className="h-7 px-2 text-xs"
          />
          <div className="mt-2 max-h-36 space-y-1 overflow-y-auto">
            {placementEffectOptions.map((effect) => {
              const selected = placementDraft.objId === effect.id;
              return (
                <button
                  key={effect.id}
                  type="button"
                  aria-label={`Replace with effect ${effect.display_name}`}
                  className={`w-full rounded px-2 py-1.5 text-left text-xs hover:bg-accent ${
                    selected ? "bg-accent" : ""
                  }`}
                  onClick={() => selectReplacementEffect(effect)}
                >
                  <div className="truncate font-medium">{effect.display_name}</div>
                  <div className="truncate font-mono text-[11px] text-muted-foreground">
                    id {effect.id} type {effect.effect_type} {effect.filename}
                  </div>
                </button>
              );
            })}
            {placementEffectOptions.length === 0 && (
              <div className="px-2 py-1 text-[11px] text-muted-foreground">
                No effects found
              </div>
            )}
          </div>
        </div>
      )}
      <div className="mt-2 grid grid-cols-3 gap-2">
        <NumberField
          label="X"
          value={placementDraft.worldX}
          min={0}
          max={manifest?.width ?? 0}
          step={0.01}
          onChange={(value) => updatePlacementDraftNumber("worldX", value)}
        />
        <NumberField
          label="Y"
          value={placementDraft.worldY}
          min={0}
          max={manifest?.height ?? 0}
          step={0.01}
          onChange={(value) => updatePlacementDraftNumber("worldY", value)}
        />
        <NumberField
          label="Z"
          value={placementDraft.worldZ}
          min={-327.68}
          max={327.67}
          step={0.01}
          onChange={(value) => updatePlacementDraftNumber("worldZ", value)}
        />
      </div>
      <PlacementNudgeControls
        labelPrefix="placement"
        onNudge={nudgePlacementDraft}
      />
      <div className="mt-2 grid grid-cols-2 gap-2">
        <NumberField
          label="Yaw"
          value={placementDraft.yawAngle}
          min={-32768}
          max={32767}
          onChange={(value) => updatePlacementDraftNumber("yawAngle", value)}
        />
        <NumberField
          label="Scale"
          value={placementDraft.scale}
          min={-32768}
          max={32767}
          onChange={(value) => updatePlacementDraftNumber("scale", value)}
        />
      </div>
      {pendingPlacementPatches[mapPlacementKey(selectedPlacement.index)] && (
        <div className="mt-2 text-[11px] text-emerald-700">
          Placement edit staged for export.
        </div>
      )}
      {selectedPlacementDeleteStaged && (
        <div className="mt-2 text-[11px] text-destructive">
          Placement delete staged for export.
        </div>
      )}
    </div>
  ) : null;
  const placementAddPrompt = placementAddDraft && !placementAddEditorOpen ? (
    <div className="mt-3 rounded border bg-muted/20 p-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase text-muted-foreground">Placement</div>
          <div className="truncate font-mono text-[11px] text-muted-foreground">
            x {placementAddDraft.worldX.toFixed(2)} y {placementAddDraft.worldY.toFixed(2)}
          </div>
        </div>
        <Button
          size="sm"
          variant="secondary"
          className="h-7 shrink-0 gap-1 px-2 text-xs"
          title="Add placement at selected tile"
          aria-label="Add placement at selected tile"
          onClick={() => setPlacementAddEditorOpen(true)}
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Add</span>
        </Button>
      </div>
    </div>
  ) : null;

  const placementAddEditor = placementAddDraft && placementAddEditorOpen ? (
    <div className="mt-3 rounded border p-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] uppercase text-muted-foreground">New placement</div>
        <Button
          size="sm"
          variant="secondary"
          className="h-7 gap-1 px-2 text-xs"
          title="Stage new placement"
          aria-label="Stage new placement"
          onClick={stagePlacementAdd}
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Stage</span>
        </Button>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-[11px] uppercase text-muted-foreground">Type</span>
          <Select
            value={String(placementAddDraft.objType)}
            onValueChange={(value) =>
              updatePlacementAddDraftNumber("objType", Number(value))
            }
          >
            <SelectTrigger
              aria-label="Placement type"
              className="mt-1 h-7 w-full px-2 font-mono text-[11px]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">Building</SelectItem>
              <SelectItem value="1">Effect</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <NumberField
          label="Placement object id"
          value={placementAddDraft.objId}
          min={1}
          max={0x3fff}
          onChange={(value) => updatePlacementAddDraftNumber("objId", value)}
        />
      </div>
      {placementAddPreviewPlacement && (
        <MapPlacementBuildingPreview placement={placementAddPreviewPlacement} />
      )}
      {placementAddDraft.objType === 1 && placementAddEffect && (
        <MapPlacementEffectInfo
          effect={placementAddEffect}
          effectId={placementAddDraft.objId}
          displayName={placementAddEffect.display_name}
          assetName={placementAddEffect.filename}
        />
      )}
      {placementAddDraft.objType === 0 && buildingCatalog.length > 0 && (
        <div className="mt-2 rounded border bg-muted/30 p-2">
          <Input
            aria-label="Search buildings for placement"
            placeholder="Search buildings..."
            value={buildingCatalogQuery}
            onChange={(event) => setBuildingCatalogQuery(event.target.value)}
            className="h-7 px-2 text-xs"
          />
          <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
            {placementBuildingOptions.map((building) => {
              const selected = placementAddDraft.objId === building.id;
              return (
                <button
                  key={building.id}
                  type="button"
                  aria-label={`Use building ${building.display_name}`}
                  className={`w-full rounded px-2 py-1.5 text-left text-xs hover:bg-accent ${
                    selected ? "bg-accent" : ""
                  }`}
                  onClick={() => selectPlacementBuilding(building)}
                >
                  <div className="truncate font-medium">{building.display_name}</div>
                  <div className="truncate font-mono text-[11px] text-muted-foreground">
                    id {building.id} {building.filename}
                  </div>
                </button>
              );
            })}
            {placementBuildingOptions.length === 0 && (
              <div className="px-2 py-1 text-[11px] text-muted-foreground">
                No buildings found
              </div>
            )}
          </div>
        </div>
      )}
      {placementAddDraft.objType === 1 && effectCatalog.length > 0 && (
        <div className="mt-2 rounded border bg-muted/30 p-2">
          <Input
            aria-label="Search effects for placement"
            placeholder="Search effects..."
            value={effectCatalogQuery}
            onChange={(event) => setEffectCatalogQuery(event.target.value)}
            className="h-7 px-2 text-xs"
          />
          <div className="mt-2 max-h-40 space-y-1 overflow-y-auto">
            {placementEffectOptions.map((effect) => {
              const selected = placementAddDraft.objId === effect.id;
              return (
                <button
                  key={effect.id}
                  type="button"
                  aria-label={`Use effect ${effect.display_name}`}
                  className={`w-full rounded px-2 py-1.5 text-left text-xs hover:bg-accent ${
                    selected ? "bg-accent" : ""
                  }`}
                  onClick={() => selectPlacementEffect(effect)}
                >
                  <div className="truncate font-medium">{effect.display_name}</div>
                  <div className="truncate font-mono text-[11px] text-muted-foreground">
                    id {effect.id} type {effect.effect_type} {effect.filename}
                  </div>
                </button>
              );
            })}
            {placementEffectOptions.length === 0 && (
              <div className="px-2 py-1 text-[11px] text-muted-foreground">
                No effects found
              </div>
            )}
          </div>
        </div>
      )}
      <div className="mt-2 grid grid-cols-3 gap-2">
        <NumberField
          label="New placement X"
          value={placementAddDraft.worldX}
          min={0}
          max={manifest?.width ?? 0}
          step={0.01}
          onChange={(value) => updatePlacementAddDraftNumber("worldX", value)}
        />
        <NumberField
          label="New placement Y"
          value={placementAddDraft.worldY}
          min={0}
          max={manifest?.height ?? 0}
          step={0.01}
          onChange={(value) => updatePlacementAddDraftNumber("worldY", value)}
        />
        <NumberField
          label="New placement Z"
          value={placementAddDraft.worldZ}
          min={-327.68}
          max={327.67}
          step={0.01}
          onChange={(value) => updatePlacementAddDraftNumber("worldZ", value)}
        />
      </div>
      <PlacementNudgeControls
        labelPrefix="new placement"
        onNudge={nudgePlacementAddDraft}
      />
      <div className="mt-2 grid grid-cols-2 gap-2">
        <NumberField
          label="New placement yaw"
          value={placementAddDraft.yawAngle}
          min={-32768}
          max={32767}
          onChange={(value) => updatePlacementAddDraftNumber("yawAngle", value)}
        />
        <NumberField
          label="New placement scale"
          value={placementAddDraft.scale}
          min={-32768}
          max={32767}
          onChange={(value) => updatePlacementAddDraftNumber("scale", value)}
        />
      </div>
    </div>
  ) : null;
  const showInspectorPanel = Boolean(
    inspection || placementAddEditor || selectedPlacementEditor || inspectionLoading,
  );
  const selectedTileContext = useMemo(() => {
    if (!selectedTile || !manifest) {
      return null;
    }

    const sectionX = Math.floor(selectedTile.x / manifest.section_width);
    const sectionY = Math.floor(selectedTile.y / manifest.section_height);
    const chunkX = Math.floor(selectedTile.x / manifest.chunk_size);
    const chunkY = Math.floor(selectedTile.y / manifest.chunk_size);
    return {
      sectionX,
      sectionY,
      localX: selectedTile.x - sectionX * manifest.section_width,
      localY: selectedTile.y - sectionY * manifest.section_height,
      chunkX,
      chunkY,
    };
  }, [manifest, selectedTile]);
  const selectedTileSection = selectedTileContext
    ? { x: selectedTileContext.sectionX, y: selectedTileContext.sectionY }
    : null;
  const pendingInspectionTarget = useMemo(() => {
    if (!inspectionLoading || !selectedTile) {
      return null;
    }

    if (
      inspection
      && isSameTile(
        { x: inspection.tile_x, y: inspection.tile_y },
        selectedTile,
      )
    ) {
      return null;
    }

    return selectedTile;
  }, [inspection, inspectionLoading, selectedTile]);
  const inspectorContextKey = useMemo(() => {
    if (pendingInspectionTarget) {
      return `tile:loading:${pendingInspectionTarget.x}:${pendingInspectionTarget.y}`;
    }
    if (inspection) {
      return `tile:${inspection.tile_x}:${inspection.tile_y}`;
    }
    if (inspectionLoading && selectedTile) {
      return `tile:loading:${selectedTile.x}:${selectedTile.y}`;
    }
    if (inspectionLoading) {
      return "tile:loading";
    }
    if (placementAddDraft) {
      return `placement-add:${placementAddDraft.objType}:${placementAddDraft.objId}`;
    }
    if (selectedPlacement) {
      return `placement:${selectedPlacement.index}:${selectedPlacement.obj_type}:${selectedPlacement.obj_id}`;
    }
    return "none";
  }, [inspection, inspectionLoading, pendingInspectionTarget, placementAddDraft, selectedPlacement, selectedTile]);
  useEffect(() => {
    if (preferCollapsedInspector && showInspectorPanel) {
      setInspectorCollapsed((current) => {
        if (current) {
          return current;
        }
        compactInspectorAutoCollapsedRef.current = true;
        return true;
      });
      return;
    }

    if (!preferCollapsedInspector && compactInspectorAutoCollapsedRef.current) {
      compactInspectorAutoCollapsedRef.current = false;
      setInspectorCollapsed(false);
    }
  }, [inspectorContextKey, preferCollapsedInspector, showInspectorPanel]);

  const expandInspector = useCallback(() => {
    compactInspectorAutoCollapsedRef.current = false;
    setInspectorCollapsed(false);
  }, []);

  const collapseInspector = useCallback(() => {
    compactInspectorAutoCollapsedRef.current = false;
    setInspectorCollapsed(true);
  }, []);

  const inspectorSummary = useMemo(() => {
    if (pendingInspectionTarget) {
      return {
        title: "Tile",
        primary: `${pendingInspectionTarget.x}, ${pendingInspectionTarget.y}`,
        secondary: selectedTileSection
          ? `section ${selectedTileSection.x}, ${selectedTileSection.y} - loading data`
          : "Loading tile data",
        expandLabel: `Expand loading tile inspector for ${pendingInspectionTarget.x}, ${pendingInspectionTarget.y}`,
      };
    }

    if (inspection) {
      return {
        title: "Tile",
        primary: `${inspection.tile_x}, ${inspection.tile_y}`,
        secondary: `h ${inspection.terrain_height.toFixed(2)} island ${inspection.island}`,
        expandLabel: `Expand tile inspector for ${inspection.tile_x}, ${inspection.tile_y}`,
      };
    }

    if (inspectionLoading) {
      return {
        title: "Tile",
        primary: selectedTile ? `${selectedTile.x}, ${selectedTile.y}` : "Loading",
        secondary: selectedTileSection
          ? `section ${selectedTileSection.x}, ${selectedTileSection.y} - loading data`
          : "Loading tile data",
        expandLabel: "Expand tile inspector",
      };
    }

    if (placementAddDraft) {
      return {
        title: "New placement",
        primary: `id ${placementAddDraft.objId}`,
        secondary: `x ${placementAddDraft.worldX.toFixed(2)} y ${placementAddDraft.worldY.toFixed(2)}`,
        expandLabel: "Expand new placement inspector",
      };
    }

    if (selectedPlacement) {
      const name = selectedPlacement.display_name
        ?? selectedPlacement.asset_name
        ?? `${selectedPlacement.kind} ${selectedPlacement.obj_id}`;
      return {
        title: "Placement",
        primary: name,
        secondary: `idx ${selectedPlacement.index} x ${selectedPlacement.world_x.toFixed(2)} y ${selectedPlacement.world_y.toFixed(2)}`,
        expandLabel: `Expand placement inspector for ${name}`,
      };
    }

    return null;
  }, [
    inspection,
    inspectionLoading,
    pendingInspectionTarget,
    placementAddDraft,
    selectedPlacement,
    selectedTile,
    selectedTileSection,
  ]);
  const copyableTile = inspection
    ? pendingInspectionTarget ?? { x: inspection.tile_x, y: inspection.tile_y }
    : selectedTile;
  const showExportReceipt = Boolean(lastExportResult && totalPendingEditCount === 0);
  const placementSelectionGroupCard = placementSelectionCount > 0 ? (
    <div
      data-testid="map-placement-selection-group"
      className="pointer-events-auto order-1 w-full shrink-0 rounded-md border bg-background/95 p-3 text-xs shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] uppercase text-muted-foreground">Placement group</div>
          <div className="mt-0.5 truncate font-medium">
            {placementSelectionCount} selected
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            title="Clear placement group"
            aria-label="Clear placement group"
            onClick={clearPlacementSelectionGroup}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="destructive"
            className="h-7 gap-1 px-2 text-xs"
            title="Stage deletes for selected placements"
            aria-label="Stage deletes for selected placements"
            onClick={stagePlacementSelectionDeletes}
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Delete</span>
          </Button>
        </div>
      </div>
      <div className="mt-2 max-h-28 space-y-1 overflow-y-auto pr-1">
        {placementSelectionItems.slice(0, 8).map((placement) => (
          <div key={placement.index} className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate font-medium">
              {formatPlacementDisplayName(placement)}
            </span>
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
              idx {placement.index}
            </span>
          </div>
        ))}
        {placementSelectionCount > 8 && (
          <div className="text-[11px] text-muted-foreground">
            +{placementSelectionCount - 8} more
          </div>
        )}
      </div>
    </div>
  ) : null;
  const showRightDock = showInspectorPanel
    || totalPendingEditCount > 0
    || showExportReceipt
    || placementSelectionCount > 0;
  const useCompactRightDock = showInspectorPanel
    && inspectorCollapsed
    && totalPendingEditCount === 0
    && !showExportReceipt
    && placementSelectionCount === 0;
  const overlayOpacityPercent = Math.round(overlayOpacity * 100);
  const hasRboSource = Boolean(
    manifest?.rbo_source.content_sha256
    || (manifest?.rbo_source.map_file_len ?? 0) > 0,
  );
  const rboMayLagPlacementEdits = Boolean(
    pendingPlacementEditCount > 0
    && (manifest?.rbo_source.map_file_len ?? 0) > 0,
  );
  const rboStatus = useMemo(
    () => manifest?.rbo_summary ? formatRboSummary(manifest.rbo_summary) : null,
    [manifest?.rbo_summary],
  );

  return (
    <div ref={containerRef} className="relative h-full min-h-0 w-full min-w-0 overflow-hidden bg-slate-950">
      <canvas
        ref={canvasRef}
        tabIndex={0}
        aria-label="Map editor canvas"
        className={`absolute inset-0 block h-full w-full touch-none ${canvasCursorClass}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => {
          setHoverTile(null);
          clearHoverTileInspectionPrefetch();
        }}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
        onKeyDown={handleCanvasKeyDown}
      />

      {manifest && navigatorFrame && navigatorViewport && (
        overviewNavigatorCollapsed ? (
          <Button
            type="button"
            variant="secondary"
            className="absolute bottom-14 left-3 z-10 h-9 gap-1 rounded-md border bg-background/95 px-2 text-xs shadow-sm"
            aria-label="Show overview navigator"
            title="Show overview navigator"
            onClick={() => setOverviewNavigatorCollapsed(false)}
          >
            <MapIcon className="h-3.5 w-3.5" />
            <span>Overview</span>
          </Button>
        ) : (
          <div
            data-testid="map-overview-navigator-panel"
            className="absolute bottom-14 left-3 z-10 rounded-md border bg-background/95 p-2 shadow-sm"
          >
            <div className="mb-1 flex items-center justify-between gap-2 text-[11px]">
              <span className="font-medium">Overview</span>
              <div className="flex items-center gap-1">
                <span className="font-mono text-muted-foreground">
                  {(transform.scale * 100).toFixed(0)}%
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  aria-label="Collapse overview navigator"
                  title="Collapse overview navigator"
                  onClick={() => setOverviewNavigatorCollapsed(true)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <button
              type="button"
              className="relative block overflow-hidden rounded bg-slate-900 p-0 text-left outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
              style={{ width: NAVIGATOR_WIDTH, height: NAVIGATOR_HEIGHT }}
              title="Click or drag to move the visible map area"
              aria-label="Map overview navigator"
              onPointerDown={handleNavigatorPointerDown}
              onPointerMove={handleNavigatorPointerMove}
              onPointerUp={handleNavigatorPointerUp}
              onPointerCancel={handleNavigatorPointerUp}
            >
              <div
                className="absolute bg-slate-950"
                style={{
                  left: navigatorFrame.x,
                  top: navigatorFrame.y,
                  width: navigatorFrame.width,
                  height: navigatorFrame.height,
                }}
              >
                {overview && (
                  <img
                    src={overview.image_data_uri}
                    alt=""
                    draggable={false}
                    className="pointer-events-none h-full w-full select-none object-fill"
                  />
                )}
              </div>
              <div
                className="pointer-events-none absolute border border-white/90 bg-white/10 shadow-[0_0_0_1px_rgba(15,23,42,0.85)]"
                style={{
                  left: navigatorViewport.x,
                  top: navigatorViewport.y,
                  width: navigatorViewport.width,
                  height: navigatorViewport.height,
                }}
              />
            </button>
          </div>
        )
      )}

      <TooltipProvider delayDuration={250}>
        <div
          data-testid="map-workbench-toolbar"
          role="toolbar"
          aria-label="Map toolbar"
          className="absolute left-3 top-14 z-10 flex max-w-[calc(100%-1.5rem)] flex-nowrap items-center gap-2 overflow-x-auto pr-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
        >
        <div
          role="toolbar"
          aria-label="Canvas interaction mode"
          className="flex h-9 shrink-0 items-center gap-1 rounded-md border bg-background/95 p-1 shadow-sm"
        >
          <Button
            type="button"
            size="sm"
            variant={interactionMode === "select" ? "default" : "ghost"}
            className="h-7 gap-1 px-2 text-xs"
            aria-label="Select tiles"
            aria-pressed={interactionMode === "select"}
            title="Select tiles and objects"
            onClick={() => setInteractionMode("select")}
          >
            <MousePointer2 className="h-3.5 w-3.5" />
            <span>Select</span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant={interactionMode === "pan" ? "default" : "ghost"}
            className="h-7 gap-1 px-2 text-xs"
            aria-label="Pan map"
            aria-pressed={interactionMode === "pan"}
            title="Pan without selecting tiles"
            onClick={() => setInteractionMode("pan")}
          >
            <Hand className="h-3.5 w-3.5" />
            <span>Pan</span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant={interactionMode === "paint" ? "default" : "ghost"}
            className="h-7 gap-1 px-2 text-xs"
            aria-label="Paint tiles"
            aria-pressed={interactionMode === "paint"}
            title={draftPatch ? "Paint the current tile draft on canvas" : "Inspect and edit a tile before painting"}
            disabled={!draftPatch}
            onClick={() => setInteractionMode("paint")}
          >
            <Paintbrush className="h-3.5 w-3.5" />
            <span>Paint</span>
          </Button>
        </div>

        <div className="flex h-9 shrink-0 items-center gap-2 rounded-md border bg-background/95 px-2 shadow-sm">
          <span className="flex items-center gap-1 text-xs font-medium text-foreground">
            <Layers className="h-4 w-4 text-muted-foreground" />
            <span>Primary layer</span>
          </span>
          <Select
            value={layer}
            onValueChange={(value) => setLayer(value as MapWorkbenchLayer)}
            disabled={!manifest}
          >
            <SelectTrigger
              aria-label="Primary map layer"
              className="h-7 w-[9rem] border-0 px-1 text-xs shadow-none focus:ring-0"
            >
              <SelectValue placeholder={currentLayerLabel} />
            </SelectTrigger>
            <SelectContent>
              {activeLayers.map((entry) => (
                <SelectItem key={entry.value} value={entry.value}>
                  {entry.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {availableOverlayLayers.length > 0 && (
          <div
            role="toolbar"
            aria-label="Comparison overlays"
            className="flex h-9 shrink-0 items-center gap-1 rounded-md border bg-background/95 p-1 shadow-sm"
          >
            <span className="flex h-7 shrink-0 items-center px-1 text-xs font-medium text-foreground">
              Overlays
            </span>
            {availableOverlayLayers.map((entry) => {
              const active = activeOverlayLayers.includes(entry.value);
              const label = `${entry.label} comparison overlay`;
              const title = `${active ? "Hide" : "Show"} ${entry.label.toLowerCase()} as a comparison overlay`;
              return (
                <Button
                  key={entry.value}
                  type="button"
                  size="sm"
                  variant={active ? "secondary" : "ghost"}
                  className="h-7 shrink-0 gap-1 px-2 text-xs"
                  aria-label={label}
                  aria-pressed={active}
                  title={title}
                  onClick={() => toggleOverlayLayer(entry.value)}
                >
                  <Layers className="h-3.5 w-3.5" />
                  <span>{entry.label}</span>
                </Button>
              );
            })}
            {activeOverlayLayers.length > 0 && (
              <label className="ml-1 flex h-7 shrink-0 items-center gap-2 border-l pl-2 text-[11px] text-muted-foreground">
                <span className="min-w-[7rem] font-medium text-foreground">
                  Overlay strength
                </span>
                <span className="w-8 text-right font-mono text-foreground">
                  {overlayOpacityPercent}%
                </span>
                <input
                  type="range"
                  aria-label="Comparison overlay strength"
                  min={OVERLAY_OPACITY_MIN}
                  max={OVERLAY_OPACITY_MAX}
                  step={OVERLAY_OPACITY_STEP}
                  value={overlayOpacityPercent}
                  onChange={(event) => updateOverlayOpacity(Number(event.target.value))}
                  className="h-2 w-20 accent-primary"
                />
              </label>
            )}
          </div>
        )}

        <div className="flex h-9 shrink-0 items-center rounded-md border bg-background/95 p-1 shadow-sm">
          <ToolbarIconButton label="Zoom in" onClick={() => zoomBy(1)}>
            <ZoomIn className="h-4 w-4" />
          </ToolbarIconButton>
          <ToolbarIconButton label="Zoom out" onClick={() => zoomBy(-1)}>
            <ZoomOut className="h-4 w-4" />
          </ToolbarIconButton>
          <ToolbarIconButton label="Fit map" onClick={fitMap}>
            <LocateFixed className="h-4 w-4" />
          </ToolbarIconButton>
          <ToolbarIconButton
            label="Zoom to native texture detail"
            tooltip="Zoom to 64 px/tile texture detail around the selected tile or view center"
            disabled={!manifest || !activeRasterLayers.some(isTextureDetailLayer)}
            onClick={zoomToNativeTextureDetail}
          >
            <ScanSearch className="h-4 w-4" />
          </ToolbarIconButton>
          <ToolbarIconButton
            label={showGrid ? "Hide grid" : "Show grid"}
            tooltip={showGrid ? "Hide tile grid" : "Show tile grid"}
            variant={showGrid ? "secondary" : "ghost"}
            onClick={() => setShowGrid((current) => !current)}
          >
            <Grid3X3 className="h-4 w-4" />
          </ToolbarIconButton>
          <ToolbarIconButton
            label={showPlacements ? "Hide object markers" : "Show object markers"}
            tooltip={showPlacements ? "Hide object markers" : "Show object markers"}
            variant={showPlacements ? "secondary" : "ghost"}
            onClick={() => setShowPlacements((current) => !current)}
          >
            <MapPin className="h-4 w-4" />
          </ToolbarIconButton>
          <span className="ml-1 border-l pl-2 text-xs font-medium text-foreground">
            Object markers
          </span>
          <select
            aria-label="Object marker density"
            title="Object marker density"
            value={placementMarkerDensity}
            disabled={!showPlacements}
            onChange={(event) =>
              setPlacementMarkerDensity(event.target.value as PlacementMarkerDensity)
            }
            className="h-7 w-[5.75rem] rounded border-0 bg-transparent px-1 text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
          >
            {PLACEMENT_MARKER_DENSITY_OPTIONS.map(([value, option]) => (
              <option key={value} value={value}>
                {option.label}
              </option>
            ))}
          </select>
          <ToolbarIconButton
            label="Center selected placement"
            disabled={!selectedPlacement}
            onClick={centerSelectedPlacement}
          >
            <Crosshair className="h-4 w-4" />
          </ToolbarIconButton>
        </div>

        <div className="flex h-9 shrink-0 items-center gap-1 rounded-md border bg-background/95 px-2 shadow-sm">
          <label className="flex items-center gap-1 text-[11px] uppercase text-muted-foreground">
            <span>X</span>
            <Input
              type="number"
              aria-label="Jump to x"
              value={jumpDraft.x}
              min={0}
              max={manifest ? Math.max(0, manifest.width - 1) : undefined}
              onChange={(event) =>
                setJumpDraft((current) => ({ ...current, x: event.target.value }))
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  jumpToTile();
                }
              }}
              className="h-7 w-16 px-2 py-0 font-mono text-xs"
            />
          </label>
          <label className="flex items-center gap-1 text-[11px] uppercase text-muted-foreground">
            <span>Y</span>
            <Input
              type="number"
              aria-label="Jump to y"
              value={jumpDraft.y}
              min={0}
              max={manifest ? Math.max(0, manifest.height - 1) : undefined}
              onChange={(event) =>
                setJumpDraft((current) => ({ ...current, y: event.target.value }))
              }
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  jumpToTile();
                }
              }}
              className="h-7 w-16 px-2 py-0 font-mono text-xs"
            />
          </label>
          <ToolbarIconButton
            label="Go to tile"
            disabled={!canJumpToTile}
            onClick={jumpToTile}
          >
            <Crosshair className="h-4 w-4" />
          </ToolbarIconButton>
        </div>

        <div className="flex h-9 shrink-0 items-center rounded-md border bg-background/95 p-1 shadow-sm">
          <ToolbarIconButton
            label="Undo staged edit"
            tooltip="Undo last staged edit change"
            disabled={!canUndoStagedEdit}
            onClick={undoStagedEdit}
          >
            <Undo2 className="h-4 w-4" />
          </ToolbarIconButton>
          <ToolbarIconButton
            label="Redo staged edit"
            tooltip="Redo last staged edit change"
            disabled={!canRedoStagedEdit}
            onClick={redoStagedEdit}
          >
            <Redo2 className="h-4 w-4" />
          </ToolbarIconButton>
        </div>

        <ToolbarIconButton
          label="Export staged edits"
          tooltip={nativeExportTooltip}
          title={nativeExportTooltip}
          variant={totalPendingEditCount > 0 ? "default" : "secondary"}
          className="h-9 w-9"
          disabled={
            !projectId
            || !mapName
            || !manifest
            || manifestLoading
            || Boolean(nativeExportBlockedReason)
            || totalPendingEditCount === 0
            || exportingEdits
          }
          onClick={() => void exportMapEdits()}
        >
          <Download className={`h-4 w-4 ${exportingEdits ? "animate-pulse" : ""}`} />
        </ToolbarIconButton>

        <ToolbarIconButton
          label="Reload map"
          variant="secondary"
          className="h-9 w-9"
          disabled={!projectId || !mapName || manifestLoading}
          onClick={reloadMap}
        >
          <RefreshCw className={`h-4 w-4 ${manifestLoading ? "animate-spin" : ""}`} />
        </ToolbarIconButton>
        </div>
      </TooltipProvider>

      <div className="absolute bottom-3 left-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-2 text-xs">
        <div className="rounded-md border bg-background/95 px-2 py-1.5 shadow-sm">
          {manifest ? `${manifest.width} x ${manifest.height}` : "No map"}
        </div>
        <div className="rounded-md border bg-background/95 px-2 py-1.5 shadow-sm">
          {(transform.scale * 100).toFixed(0)}%
        </div>
        <div
          data-testid="map-detail-status"
          className="flex items-center gap-1 rounded-md border bg-background/95 px-2 py-1.5 shadow-sm"
          title={detailChunkWindowSuppressed
            ? `${candidateDetailChunkRequestCount} detail chunks are visible; loading the nearest ${activeDetailChunkRequestCount} to keep panning responsive`
            : undefined}
        >
          {detailChunksLoading && (
            <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />
          )}
          <span>{detailChunkStatus}</span>
        </div>
        {displayedLayerLegend && (
          <div
            data-testid="map-layer-legend"
            className="flex min-w-0 max-w-[18rem] items-center gap-2 rounded-md border bg-background/95 px-2 py-1.5 shadow-sm"
            title={displayedLayerLegend.title}
          >
            <span className="truncate font-medium">{displayedLayerLegend.label}</span>
            <span className="min-w-0 truncate text-muted-foreground">
              {displayedLayerLegend.hint}
            </span>
          </div>
        )}
        {manifest?.terrain_texture_status
          && (!manifest.terrain_texture_status.available
            || manifest.terrain_texture_status.message) && (
          <div
            data-testid="map-texture-status"
            className="flex min-w-0 max-w-[24rem] items-center gap-2 rounded-md border border-amber-300/70 bg-amber-50/95 px-2 py-1.5 text-amber-950 shadow-sm dark:border-amber-700/70 dark:bg-amber-950/85 dark:text-amber-50"
            title={
              manifest.terrain_texture_status.message
                ?? "Real terrain textures are unavailable"
            }
          >
            <span className="shrink-0 font-medium">
              {terrainTextureStatusLabel(manifest.terrain_texture_status)}
            </span>
            {manifest.terrain_texture_status.message && (
              <span className="min-w-0 truncate text-amber-800 dark:text-amber-100">
                {manifest.terrain_texture_status.message}
              </span>
            )}
          </div>
        )}
        {showPlacements && hiddenPlacementMarkerCount > 0 && (
          <div className="rounded-md border bg-background/95 px-2 py-1.5 shadow-sm">
            {markerPlacements.length}/{renderedPlacements.length} objects shown
          </div>
        )}
        {showPlacements && visibleRboRecords.length > 0 && manifest?.rbo_summary.record_count ? (
          <div
            data-testid="map-rbo-visible-summary"
            className="rounded-md border bg-background/95 px-2 py-1.5 shadow-sm"
            title={`Read-only RBO sidecar records in this view; ${manifest.rbo_summary.record_count} total records in the sidecar`}
          >
            {formatVisibleRboSummary(visibleRboRecords.length, visibleRboRecordTotal)}
          </div>
        ) : null}
        {rboStatus && (
          <div
            data-testid="map-rbo-summary"
            className="flex items-center gap-1 rounded-md border bg-background/95 px-2 py-1.5 shadow-sm"
            title={rboStatus.title}
          >
            <span className="font-medium">{rboStatus.label}</span>
            <span className="text-muted-foreground">{rboStatus.detail}</span>
          </div>
        )}
        {totalPendingEditCount > 0 && (
          <div className="rounded-md border bg-background/95 px-2 py-1.5 shadow-sm">
            {pendingEditSummary || `${totalPendingEditCount} edits`}
          </div>
        )}
        {hoverTile && manifest && (
          <div className="rounded-md border bg-background/95 px-2 py-1.5 font-mono shadow-sm">
            x {Math.floor(hoverTile.x)} y {Math.floor(hoverTile.y)}
          </div>
        )}
      </div>

      {showRightDock && (
        <div
          data-testid="map-workbench-right-dock"
          className={`pointer-events-none absolute bottom-3 top-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-col gap-2 overflow-hidden ${
            useCompactRightDock ? "w-56" : "w-[min(20rem,calc(100%-1.5rem))]"
          }`}
          style={{ right: `${rightDockInset + 12}px` }}
        >
          {placementSelectionGroupCard}
      {totalPendingEditCount > 0 && (
        <div
          data-testid="map-staged-edits-card"
          className="pointer-events-auto order-2 mt-auto w-full shrink-0 rounded-md border bg-background/95 p-3 text-xs shadow-sm"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] uppercase text-muted-foreground">Staged edits</div>
              <div className="mt-0.5 truncate font-medium">
                {pendingEditSummary || `${totalPendingEditCount} edits`}
              </div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 shrink-0 gap-1 px-2 text-xs text-destructive"
              title="Clear staged edits"
              aria-label="Clear staged edits"
              onClick={clearStagedEdits}
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Clear</span>
            </Button>
          </div>
          <div
            data-testid="map-export-package-impact"
            className="mt-2 rounded border bg-muted/30 px-2 py-1.5"
          >
            <div className="text-[11px] uppercase text-muted-foreground">Native package</div>
            <div className="mt-1 flex flex-wrap gap-1 font-mono text-[10px]">
              <span className="rounded bg-background px-1.5 py-0.5">Client MAP</span>
              <span className="rounded bg-background px-1.5 py-0.5">Client OBJ</span>
              {hasRboSource && (
                <span className="rounded bg-background px-1.5 py-0.5">Client RBO</span>
              )}
              <span className="rounded bg-background px-1.5 py-0.5">Server ATR</span>
              <span className="rounded bg-background px-1.5 py-0.5">Server BLK</span>
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              Export writes native client and server map files.
            </div>
            {rboMayLagPlacementEdits && (
              <div className="mt-1 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-950">
                <span className="font-medium">RBO preserved from source.</span>{" "}
                <span>OBJ placement edits are exported, but placement edits are not reflected in RBO.</span>
              </div>
            )}
          </div>
          {manifest && (
            <div
              data-testid="map-export-preflight"
              className="mt-2 rounded border bg-muted/30 px-2 py-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] uppercase text-muted-foreground">
                  Native preflight
                </div>
                <div className="font-mono text-[10px] text-muted-foreground">
                  Source guarded
                </div>
              </div>
              <div className="mt-1 space-y-1 font-mono text-[10px]">
                <div className="grid grid-cols-[4.75rem_minmax(0,1fr)] gap-2 rounded bg-background px-1.5 py-1">
                  <span className="text-muted-foreground">MAP source</span>
                  <span className="truncate">
                    {formatCountLabel(pendingPatchCount, "tile")} / {formatSourceGuardFingerprint(manifest.source)}
                  </span>
                </div>
                <div className="grid grid-cols-[4.75rem_minmax(0,1fr)] gap-2 rounded bg-background px-1.5 py-1">
                  <span className="text-muted-foreground">OBJ source</span>
                  <span className="truncate">
                    {formatCountLabel(pendingPlacementEditCount, "placement")} / {formatSourceGuardFingerprint(manifest.placement_source)}
                  </span>
                </div>
                <div className="grid grid-cols-[4.75rem_minmax(0,1fr)] gap-2 rounded bg-background px-1.5 py-1">
                  <span className="text-muted-foreground">RBO source</span>
                  <span className="min-w-0">
                    <span className="block truncate">
                      {hasRboSource
                        ? `Preserve sidecar / ${formatSourceGuardFingerprint(manifest.rbo_source)}`
                        : "No sidecar in source"}
                    </span>
                    {rboMayLagPlacementEdits && (
                      <span className="block truncate text-amber-700">
                        Placement edits are not reflected in RBO
                      </span>
                    )}
                  </span>
                </div>
                <div className="grid grid-cols-[4.75rem_minmax(0,1fr)] gap-2 rounded bg-background px-1.5 py-1">
                  <span className="text-muted-foreground">Server ATR</span>
                  <span className="min-w-0">
                    <span className="block truncate">{serverOutputPreflight?.atr}</span>
                    <span className="block truncate text-muted-foreground">
                      Regenerated from MAP tile data
                    </span>
                  </span>
                </div>
                <div className="grid grid-cols-[4.75rem_minmax(0,1fr)] gap-2 rounded bg-background px-1.5 py-1">
                  <span className="text-muted-foreground">Server BLK</span>
                  <span className="min-w-0">
                    <span className="block truncate">{serverOutputPreflight?.blk}</span>
                    <span className="block truncate text-muted-foreground">
                      {serverOutputPreflight?.blkAligned
                        ? "Regenerated from MAP collision bits"
                        : "Export will fail until the map width is byte-aligned"}
                    </span>
                  </span>
                </div>
              </div>
            </div>
          )}
          <div className="mt-2 max-h-44 space-y-1 overflow-y-auto pr-1">
            {stagedEditPreviewItems.map((item) => (
              <div
                key={item.key}
                className="grid grid-cols-[minmax(0,1fr)_1.75rem] gap-1"
              >
                <button
                  type="button"
                  aria-label={item.ariaLabel}
                  title={item.ariaLabel}
                  className="min-w-0 truncate rounded bg-muted px-2 py-1 text-left font-mono text-[11px] outline-none transition-colors hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring"
                  onClick={item.onActivate}
                >
                  {item.label}
                </button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 text-destructive"
                  aria-label={item.removeAriaLabel}
                  title={item.removeAriaLabel}
                  onClick={item.onRemove}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {lastExportResult && totalPendingEditCount === 0 && (
        <div
          data-testid="map-export-receipt"
          className="pointer-events-auto order-2 mt-auto w-full shrink-0 rounded-md border bg-background/95 p-3 text-xs shadow-sm"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[11px] uppercase text-muted-foreground">Last export</div>
              <div className="mt-0.5 truncate font-medium">
                {formatExportEditSummary(lastExportResult)}
              </div>
            </div>
            <div className="flex min-w-0 max-w-full flex-wrap justify-end gap-1">
              <Button
                size="sm"
                variant="secondary"
                className="h-7 gap-1 px-2 text-xs"
                title="Install exported client MAP, OBJ, and RBO files after backing up originals. Server ATR and BLK stay in the export folder."
                aria-label="Install client map files"
                disabled={
                  !lastExportSourceGuard ||
                  applyingClientPackage ||
                  Boolean(lastApplyResult)
                }
                onClick={() => void installLastClientPackage()}
              >
                {applyingClientPackage ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Upload className="h-3.5 w-3.5" />
                )}
                <span>Install client</span>
              </Button>
              {lastApplyResult && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 px-2 text-xs"
                  title="Restore client MAP, OBJ, and RBO files from the install backup"
                  aria-label="Restore client files from backup"
                  disabled={restoringClientBackup || Boolean(lastRestoreResult)}
                  onClick={() => void restoreLastClientBackup()}
                >
                  {restoringClientBackup ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Undo2 className="h-3.5 w-3.5" />
                  )}
                  <span>Restore</span>
                </Button>
              )}
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                title="Show export files"
                aria-label="Show export files"
                onClick={() => void revealLastExport()}
              >
                <FolderOpen className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                title="Copy export report"
                aria-label="Copy export report"
                onClick={() => void copyText(
                  formatExportReport(lastExportResult, lastExportRows),
                  "Map export report copied",
                )}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                title="Copy server ATR/BLK paths"
                aria-label="Copy server output paths"
                onClick={() => void copyText(
                  lastExportRows
                    .filter((row) => row.target === "Server")
                    .map((row) => row.path)
                    .join("\n"),
                  "Server export paths copied",
                )}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                title="Copy output paths"
                aria-label="Copy output paths"
                onClick={() => void copyText(
                  lastExportRows.map((row) => row.path).join("\n"),
                  "Map export paths copied",
                )}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                title="Dismiss export receipt"
                aria-label="Dismiss export receipt"
                onClick={() => {
                  setLastExportResult(null);
                  setLastExportSourceGuard(null);
                  setLastApplyResult(null);
                  setLastRestoreResult(null);
                }}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <div
            data-testid="map-server-export-note"
            className="mt-2 rounded border border-sky-200 bg-sky-50 px-2 py-1.5 text-[11px] text-sky-950"
          >
            <div className="font-medium">Server ATR/BLK are export-only</div>
            <div className="mt-0.5 text-sky-900">
              Install only applies client files. Copy ATR/BLK from this export into your server deployment workflow.
            </div>
          </div>
          {lastExportResult.rbo_may_be_stale && (
            <div
              data-testid="map-rbo-preserved-warning"
              className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-950"
            >
              <div className="font-medium">RBO preserved from source</div>
              <div className="mt-0.5 text-amber-900">
                OBJ placement edits were exported, but placement edits are not reflected in RBO.
              </div>
            </div>
          )}
          <div className="mt-2 space-y-1">
            {lastExportRows.map((row) => (
              <div
                key={row.label}
                className="grid grid-cols-[5.25rem_minmax(0,1fr)_7rem] items-center gap-2 rounded bg-muted px-2 py-1 font-mono text-[11px]"
                title={`${row.path}\nsha256 ${row.sha256 || "no hash"}`}
              >
                <span className="flex min-w-0 items-center gap-1 text-muted-foreground">
                  <span>{row.target}</span>
                  <span className="rounded bg-background px-1 py-0.5">{row.label}</span>
                </span>
                <span className="truncate">{formatExportFileName(row.path)}</span>
                <span className="min-w-0 text-right text-muted-foreground">
                  <span className="block">{formatByteCount(row.bytes)}</span>
                  <span className="block truncate" aria-label={`${row.label} sha256 ${row.sha256 || "no hash"}`}>
                    {formatSha256Short(row.sha256)}
                  </span>
                </span>
              </div>
            ))}
          </div>
          {lastApplyResult && (
            <div className="mt-2 rounded border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-[11px] text-emerald-950">
              <div className="font-medium">Client files installed</div>
              <div className="mt-0.5 flex min-w-0 items-center gap-2">
                <span>{formatCountLabel(lastApplyResult.backups.length, "backup")}</span>
                <span
                  className="truncate font-mono text-emerald-800"
                  title={lastApplyResult.backup_dir}
                >
                  {formatExportFileName(lastApplyResult.backup_dir)}
                </span>
              </div>
            </div>
          )}
          {lastRestoreResult && (
            <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-950">
              <div className="font-medium">Client files restored</div>
              <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-2">
                <span>
                  {formatCountLabel(
                    lastRestoreResult.current_backups.length,
                    "pre-restore backup",
                  )}
                </span>
                {lastRestoreResult.removed_paths.length > 0 && (
                  <span>
                    {formatCountLabel(lastRestoreResult.removed_paths.length, "generated file")} removed
                  </span>
                )}
                <span
                  className="truncate font-mono text-amber-800"
                  title={lastRestoreResult.restore_backup_dir}
                >
                  {formatExportFileName(lastRestoreResult.restore_backup_dir)}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {showInspectorPanel && inspectorCollapsed && inspectorSummary && (
        <button
          type="button"
          data-testid="map-inspector-collapsed"
          className="pointer-events-auto order-1 flex w-full shrink-0 items-center gap-2 rounded-md border bg-background/95 px-3 py-2 text-left text-xs shadow-sm outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          title={inspectorSummary.expandLabel}
          aria-label={inspectorSummary.expandLabel}
          onClick={expandInspector}
        >
          <MousePointer2 className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] uppercase text-muted-foreground">
              {inspectorSummary.title}
            </span>
            <span className="block truncate font-medium" title={inspectorSummary.primary}>
              {inspectorSummary.primary}
            </span>
            <span className="block truncate font-mono text-[10px] text-muted-foreground" title={inspectorSummary.secondary}>
              {inspectorSummary.secondary}
            </span>
          </span>
          <ArrowLeft className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      )}

      {showInspectorPanel && !inspectorCollapsed && (
        <div
          data-testid="map-inspector-panel"
          className="pointer-events-auto order-1 flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-md border bg-background/95 shadow-sm"
        >
          <div className="flex items-center justify-between border-b px-3 py-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <MousePointer2 className="h-4 w-4 text-muted-foreground" />
              {inspection || inspectionLoading ? "Tile" : "Placement"}
            </div>
            <div className="flex items-center gap-1">
              {copyableTile && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 px-2 text-xs"
                  title="Copy tile coordinates"
                  aria-label="Copy tile coordinates"
                  onClick={() => void copyText(
                    `${copyableTile.x}, ${copyableTile.y}`,
                    "Tile coordinates copied",
                  )}
                >
                  <Copy className="h-3.5 w-3.5" />
                  <span>Copy</span>
                </Button>
              )}
              {inspectionLoading && (
                <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              )}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 gap-1 px-2 text-xs"
                title="Collapse inspector"
                aria-label="Collapse inspector"
                onClick={collapseInspector}
              >
                <ArrowRight className="h-3.5 w-3.5" />
                <span>Collapse</span>
              </Button>
            </div>
          </div>
          {inspection ? (
            <div
              data-testid="map-inspector-scroll"
              className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto p-3 text-xs"
            >
              {pendingInspectionTarget && (
                <div
                  data-testid="map-pending-tile-inspection"
                  className="mb-3 flex items-center gap-2 rounded border border-sky-200 bg-sky-50 px-2 py-1.5 text-[11px] text-sky-900"
                >
                  <RefreshCw className="h-3.5 w-3.5 shrink-0 animate-spin" />
                  <span className="min-w-0">
                    Loading tile {pendingInspectionTarget.x}, {pendingInspectionTarget.y}; showing tile{" "}
                    {inspection.tile_x}, {inspection.tile_y} until full data arrives.
                  </span>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Metric label="Tile" value={`${inspection.tile_x}, ${inspection.tile_y}`} />
                <Metric label="Section" value={`${inspection.section_x}, ${inspection.section_y}`} />
                <Metric label="Height" value={inspection.terrain_height.toFixed(2)} />
                <Metric label="Island" value={String(inspection.island)} />
              </div>

              {manifest && !pendingInspectionTarget && (
                <TileNeighborControls
                  tileX={inspection.tile_x}
                  tileY={inspection.tile_y}
                  mapWidth={manifest.width}
                  mapHeight={manifest.height}
                  onInspect={inspectAdjacentTile}
                />
              )}

              {inspection.is_empty_section ? (
                <div
                  data-testid="map-empty-section-note"
                  className="mt-3 rounded border border-sky-200 bg-sky-50 px-2 py-1.5 text-[11px] text-sky-900"
                >
                  Empty section. Showing the client default underwater tile; staging an edit will create this section in the exported map.
                </div>
              ) : null}

              {inspection.area ? (
                <div data-testid="map-tile-area-info" className="mt-3 rounded border p-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[11px] uppercase text-muted-foreground">Area</div>
                    <span className="rounded border px-1.5 py-0.5 text-[11px]">
                      {inspection.area.zone_label}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="h-5 w-5 shrink-0 rounded border"
                      style={{ backgroundColor: areaColorCss(inspection.area.color) }}
                    />
                    <div className="min-w-0">
                      <div className="truncate font-medium">
                        {inspection.area.name || `Area ${inspection.area.area_id}`}
                      </div>
                      <div className="font-mono text-[11px] text-muted-foreground">
                        id {inspection.area.area_id} music {inspection.area.music}
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-[11px] text-muted-foreground">
                    <div>minimap {formatRgbTuple(inspection.area.color)}</div>
                    <div>env {formatRgbTuple(inspection.area.env_color)}</div>
                    <div>light {formatRgbTuple(inspection.area.light_color)}</div>
                    <div>dir {formatVectorTuple(inspection.area.light_dir)}</div>
                  </div>
                </div>
              ) : null}

            <div data-testid="map-texture-slots" className="mt-3 rounded border p-2">
              <div className="text-[11px] uppercase text-muted-foreground">Texture slots</div>
              <div className="mt-2 grid grid-cols-2 gap-1 font-mono">
                {inspection.texture_layers.map((slot) => {
                  const texture = terrainTextureById.get(slot.texture_id);
                  const slotLabel = slot.slot === 0 ? "Base" : `Layer ${slot.slot}`;
                  const alphaLabel = slot.slot === 0 ? "full" : `a ${slot.alpha}`;
                  return (
                    <div
                      key={slot.slot}
                      className="flex min-w-0 items-center gap-1.5 rounded bg-muted px-1.5 py-1"
                      title={texture?.path ?? `Texture id ${slot.texture_id}`}
                    >
                      <span
                        aria-hidden="true"
                        className="h-7 w-7 shrink-0 rounded border"
                        data-texture-slot-preview={slot.texture_id}
                        style={terrainTexturePreviewStyle(
                          slot.texture_id,
                          texture,
                          terrainTexturePreviewsById[slot.texture_id],
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center justify-between gap-2">
                          <span className="truncate">
                            {slotLabel} #{slot.texture_id}
                          </span>
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            {alphaLabel}
                          </span>
                        </div>
                        <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
                          {texture?.file_name ?? "Unknown texture"}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {(tileTexturePreview || tileTexturePreviewLoading) ? (
              <div data-testid="map-tile-texture-preview" className="mt-3 rounded border p-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] uppercase text-muted-foreground">Texture render</div>
                  {tileTexturePreview ? (
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {tileTexturePreview.sample_width} x {tileTexturePreview.sample_height}
                    </span>
                  ) : null}
                </div>
                {tileTexturePreview ? (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <div className="min-w-0">
                      <div className="mb-1 truncate text-[10px] text-muted-foreground">
                        Raw texture blend
                      </div>
                      <img
                        alt="Raw terrain texture blend"
                        className="h-20 w-full rounded border bg-muted object-cover"
                        draggable={false}
                        src={tileTexturePreview.raw_image_data_uri}
                      />
                    </div>
                    <div className="min-w-0">
                      <div className="mb-1 truncate text-[10px] text-muted-foreground">
                        Client texture
                      </div>
                      <img
                        alt="Client-tinted terrain texture blend"
                        className="h-20 w-full rounded border bg-muted object-cover"
                        draggable={false}
                        src={tileTexturePreview.client_image_data_uri}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 h-20 rounded border bg-muted/60" />
                )}
              </div>
            ) : null}

            <div className="mt-3 rounded border p-2">
              <div className="text-[11px] uppercase text-muted-foreground">Subtiles</div>
              <div className="mt-2 grid grid-cols-2 gap-1 font-mono">
                {inspection.subtiles.map((subtile) => (
                  <div
                    key={subtile.index}
                    className={`rounded px-1.5 py-1 ${
                      subtile.blocked ? "bg-red-500/15 text-red-700" : "bg-muted"
                    }`}
                  >
                    <div>#{subtile.index} raw {subtile.raw}</div>
                    <div className="text-muted-foreground">
                      h {subtile.object_height.toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-3 rounded border p-2">
              <div className="text-[11px] uppercase text-muted-foreground">Native</div>
              <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 font-mono text-[11px]">
                <div>dw {inspection.native.dw_tile_info}</div>
                <div>bt {inspection.native.bt_tile_info}</div>
                <div>color {inspection.native.s_color}</div>
                <div>region {inspection.native.s_region}</div>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {inspection.region_flags.length > 0 ? (
                  inspection.region_flags.map((flag) => (
                    <span key={flag} className="rounded border px-1.5 py-0.5 text-[11px]">
                      {flag}
                    </span>
                  ))
                ) : (
                  <span className="text-muted-foreground">none</span>
                )}
              </div>
            </div>

            {!pendingInspectionTarget && placementAddPrompt}

            {!pendingInspectionTarget && placementAddEditor}

            {!pendingInspectionTarget && selectedPlacementEditor}

            {tileDraft && !pendingInspectionTarget && (
              <div className="mt-3 rounded border p-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-[11px] uppercase text-muted-foreground">Edit</div>
                  <div data-testid="tile-edit-actions" className="flex flex-wrap justify-end gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1 px-2 text-xs"
                      title="Copy tile draft"
                      aria-label="Copy tile draft"
                      onClick={copyCurrentTileDraft}
                    >
                      <Copy className="h-3.5 w-3.5" />
                      <span>Copy</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1 px-2 text-xs"
                      disabled={!copiedTileDraft}
                      title="Paste tile draft"
                      aria-label="Paste tile draft"
                      onClick={pasteCopiedTileDraft}
                    >
                      <ClipboardPaste className="h-3.5 w-3.5" />
                      <span>Paste</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1 px-2 text-xs"
                      title="Reset tile edit"
                      aria-label="Reset tile edit"
                      onClick={resetCurrentTileEdit}
                    >
                      <Undo2 className="h-3.5 w-3.5" />
                      <span>Reset</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-7 gap-1 px-2 text-xs"
                      disabled={!draftPatch}
                      title="Stage tile edit"
                      aria-label="Stage tile edit"
                      onClick={stageCurrentTileEdit}
                    >
                      <Check className="h-3.5 w-3.5" />
                      <span>Stage tile</span>
                    </Button>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto_auto] items-end gap-2 rounded border bg-muted/20 p-2">
                  <NumberField
                    label="Brush radius"
                    value={tileBrushRadius}
                    min={0}
                    max={TILE_BRUSH_MAX_RADIUS}
                    hint={`${tileBrushRadius * 2 + 1} x ${tileBrushRadius * 2 + 1}`}
                    onChange={updateTileBrushRadius}
                  />
                  <Button
                    size="sm"
                    variant={tilePaintMode ? "default" : "outline"}
                    className="h-7 gap-1 px-2 text-xs"
                    disabled={!draftPatch}
                    title="Paint tile brush on canvas clicks"
                    aria-label="Toggle tile paint mode"
                    aria-pressed={tilePaintMode}
                    onClick={() => setTilePaintMode((current) => !current)}
                  >
                    <Paintbrush className="h-3.5 w-3.5" />
                    <span>Paint</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="h-7 gap-1 px-2 text-xs"
                    disabled={!draftPatch}
                    title="Stage current tile draft across brush area"
                    aria-label="Stage tile brush"
                    onClick={stageCurrentTileBrush}
                  >
                    <Paintbrush className="h-3.5 w-3.5" />
                    <span>{tileBrushRadius * 2 + 1} x {tileBrushRadius * 2 + 1}</span>
                  </Button>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <TextureField
                    label="Base texture"
                    value={tileDraft.textureLayers[0].textureId}
                    min={0}
                    max={255}
                    previewDataUri={
                      terrainTexturePreviewsById[tileDraft.textureLayers[0].textureId]
                    }
                    hint={formatTerrainTextureHint(
                      tileDraft.textureLayers[0].textureId,
                      terrainTextureById.get(tileDraft.textureLayers[0].textureId),
                      "0 = empty",
                    )}
                    catalog={terrainTextureCatalog}
                    onChange={(value) => updateDraftTextureLayer(0, "textureId", value)}
                  />
                  <NumberField
                    label="Tile color"
                    value={tileDraft.sColor}
                    min={-32768}
                    max={32767}
                    hint="signed RGB565"
                    onChange={(value) => updateDraftNumber("sColor", value)}
                  />
                </div>
                <div className="mt-2 flex min-w-0 items-center gap-2 rounded border bg-muted/30 px-2 py-1 text-[11px] text-muted-foreground">
                  <span
                    className="h-4 w-4 shrink-0 rounded border"
                    style={{ backgroundColor: tileColorToCss(tileDraft.sColor) }}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 truncate" title={formatTileColorPreview(tileDraft.sColor)}>
                    {formatTileColorPreview(tileDraft.sColor)}
                  </span>
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <div className="text-[11px] uppercase text-muted-foreground">
                    Terrain layers
                  </div>
                  <div className="truncate text-[10px] text-muted-foreground">
                    texture 0-63 / alpha 0-15
                  </div>
                </div>
                <div className="mt-2 space-y-1.5">
                  {tileDraft.textureLayers.slice(1).map((textureLayer, layerIndex) => {
                    const layerNumber = layerIndex + 1;
                    return (
                      <div
                        key={layerNumber}
                        className="grid grid-cols-[1.75rem_minmax(0,1fr)_minmax(0,1fr)] items-end gap-1.5"
                      >
                        <div
                          className="pb-1.5 font-mono text-[11px] text-muted-foreground"
                          title={`Layer ${layerNumber}`}
                        >
                          L{layerNumber}
                        </div>
                        <TextureField
                          label={`Layer ${layerNumber} texture`}
                          value={textureLayer.textureId}
                          min={0}
                          max={63}
                          previewDataUri={terrainTexturePreviewsById[textureLayer.textureId]}
                          hint={formatTerrainTextureHint(
                            textureLayer.textureId,
                            terrainTextureById.get(textureLayer.textureId),
                            "0 = unused",
                          )}
                          catalog={terrainTextureCatalog}
                          onChange={(value) =>
                            updateDraftTextureLayer(layerNumber, "textureId", value)
                          }
                        />
                        <NumberField
                          label={`Layer ${layerNumber} alpha`}
                          value={textureLayer.alpha}
                          min={0}
                          max={15}
                          onChange={(value) =>
                            updateDraftTextureLayer(layerNumber, "alpha", value)
                          }
                        />
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <NumberField
                    label="Height"
                    value={tileDraft.cHeight}
                    min={-128}
                    max={127}
                    onChange={(value) => updateDraftNumber("cHeight", value)}
                  />
                  <NumberField
                    label="Region"
                    value={tileDraft.sRegion}
                    min={-32768}
                    max={32767}
                    onChange={(value) => updateDraftNumber("sRegion", value)}
                  />
                  <NumberField
                    label="Island"
                    value={tileDraft.btIsland}
                    min={0}
                    max={255}
                    onChange={(value) => updateDraftNumber("btIsland", value)}
                  />
                </div>
                <div className="mt-3 rounded border bg-muted/20 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[11px] uppercase text-muted-foreground">
                      Region flags
                    </div>
                    <div className="truncate font-mono text-[10px] text-muted-foreground">
                      raw {tileDraft.sRegion}
                    </div>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-1">
                    {REGION_TERRAIN_OPTIONS.map((option) => {
                      const selected = regionTerrainValue(tileDraft.sRegion) === option.value;
                      return (
                        <Button
                          key={option.label}
                          type="button"
                          size="sm"
                          variant={selected ? "default" : "outline"}
                          className="h-7 px-2 text-xs"
                          aria-label={`Set region terrain to ${option.label}`}
                          aria-pressed={selected}
                          title={`Set region terrain to ${option.label}`}
                          onClick={() => updateDraftRegionTerrain(option.value)}
                        >
                          {option.label}
                        </Button>
                      );
                    })}
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-1">
                    {REGION_FLAG_OPTIONS.map((option) => {
                      const enabled = (tileDraft.sRegion & option.bit) === option.bit;
                      return (
                        <Button
                          key={option.label}
                          type="button"
                          size="sm"
                          variant={enabled ? "secondary" : "outline"}
                          className="h-7 justify-start gap-1.5 px-2 text-xs"
                          aria-label={`Toggle ${option.label} region flag`}
                          aria-pressed={enabled}
                          title={`${enabled ? "Disable" : "Enable"} ${option.label} region flag`}
                          onClick={() => toggleDraftRegionFlag(option.bit)}
                        >
                          {enabled && <Check className="h-3.5 w-3.5" />}
                          <span className="truncate">{option.label}</span>
                        </Button>
                      );
                    })}
                  </div>
                </div>
                <div className="mt-3 rounded border bg-muted/20 p-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[11px] uppercase text-muted-foreground">
                      Walkability
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 px-2 text-xs"
                        aria-label="Mark all subtiles walkable"
                        title="Mark all subtiles walkable"
                        onClick={() => updateAllDraftBlockCollision(false)}
                      >
                        <Unlock className="h-3.5 w-3.5" />
                        <span>Open all</span>
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 px-2 text-xs"
                        aria-label="Mark all subtiles blocked"
                        title="Mark all subtiles blocked"
                        onClick={() => updateAllDraftBlockCollision(true)}
                      >
                        <Lock className="h-3.5 w-3.5" />
                        <span>Block all</span>
                      </Button>
                    </div>
                  </div>
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    collision bit 7
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-1.5">
                    {tileDraft.btBlock.map((value, index) => {
                      const blocked = isBtBlockBlocked(value);
                      const toggleLabel = formatSubtileToggleLabel(index, blocked);
                      return (
                        <button
                          key={index}
                          type="button"
                          aria-label={toggleLabel}
                          aria-pressed={blocked}
                          title={toggleLabel}
                          className={`flex min-h-12 items-center gap-2 rounded border px-2 py-1.5 text-left outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring ${
                            blocked
                              ? "border-red-300 bg-red-500/15 text-red-700 hover:bg-red-500/20"
                              : "bg-background hover:bg-accent"
                          }`}
                          onClick={() => updateDraftBlockCollision(index, !blocked)}
                        >
                          {blocked ? (
                            <Lock className="h-3.5 w-3.5 shrink-0" />
                          ) : (
                            <Unlock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          )}
                          <span className="min-w-0">
                            <span className="block font-mono text-[11px]">
                              #{index} {blocked ? "blocked" : "open"}
                            </span>
                            <span className="block font-mono text-[10px] text-muted-foreground">
                              {formatBtBlockByte(value)}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <div className="text-[11px] uppercase text-muted-foreground">
                    Object height
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <div className="truncate text-[10px] text-muted-foreground">
                      units, step 0.05
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 px-2 text-xs"
                      aria-label="Reset all object heights"
                      title="Reset all object heights"
                      onClick={resetAllDraftBlockObjectHeights}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      <span>Zero all</span>
                    </Button>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {tileDraft.btBlock.map((value, index) => (
                    <NumberField
                      key={index}
                      label={`${SUBTILE_LABELS[index]} object height`}
                      value={Number(decodeBtBlockObjectHeight(value).toFixed(2))}
                      min={-3.15}
                      max={3.15}
                      step={0.05}
                      hint={formatBtBlockByte(value)}
                      onChange={(nextValue) => updateDraftBlockObjectHeight(index, nextValue)}
                    />
                  ))}
                </div>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <div className="text-[11px] uppercase text-muted-foreground">
                    Raw block bytes
                  </div>
                  <div className="truncate text-[10px] text-muted-foreground">
                    advanced
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-4 gap-1">
                  {tileDraft.btBlock.map((value, index) => (
                    <NumberField
                      key={index}
                      label={`B${index}`}
                      value={value}
                      min={0}
                      max={255}
                      onChange={(nextValue) => updateDraftBlock(index, nextValue)}
                    />
                  ))}
                </div>
              </div>
            )}

            {!pendingInspectionTarget && inspection.nearby_placements.length > 0 && (
              <div className="mt-3 rounded border p-2">
                <div className="text-[11px] uppercase text-muted-foreground">Placements</div>
                <div className="mt-2 space-y-1">
                  {inspection.nearby_placements.slice(0, 6).map((placement) => (
                    <button
                      key={placement.index}
                      type="button"
                      className="w-full rounded px-1.5 py-1 text-left hover:bg-accent"
                      onClick={() => onSelectPlacement(placement)}
                    >
                      <div className="truncate font-medium">
                        {placement.display_name ?? placement.asset_name ?? `${placement.kind} ${placement.obj_id}`}
                      </div>
                      <div className="font-mono text-[11px] text-muted-foreground">
                        idx {placement.index} id {placement.obj_id}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
            </div>
          ) : inspectionLoading && selectedTile ? (
            <div
              data-testid="map-tile-loading-summary"
              className="min-h-0 overflow-y-auto p-3 text-xs"
            >
              <div className="grid grid-cols-2 gap-2">
                <Metric label="Tile" value={`${selectedTile.x}, ${selectedTile.y}`} />
                <Metric
                  label="Section"
                  value={selectedTileSection
                    ? `${selectedTileSection.x}, ${selectedTileSection.y}`
                    : "Loading"}
                />
                <Metric
                  label="Local"
                  value={selectedTileContext
                    ? `${selectedTileContext.localX}, ${selectedTileContext.localY}`
                    : "Loading"}
                />
                <Metric
                  label="Chunk"
                  value={selectedTileContext
                    ? `${selectedTileContext.chunkX}, ${selectedTileContext.chunkY}`
                    : "Loading"}
                />
              </div>
              <div className="mt-3 flex items-center gap-2 rounded border bg-muted/30 px-2 py-1.5 text-[11px] text-muted-foreground">
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                <span>Loading full tile data</span>
              </div>
            </div>
          ) : selectedPlacementEditor || placementAddEditor ? (
            <div className="min-h-0 overflow-y-auto p-3 text-xs">
              {placementAddEditor}
              {selectedPlacementEditor}
            </div>
          ) : null}
        </div>
      )}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border px-2 py-1.5">
      <div className="text-[11px] uppercase text-muted-foreground">{label}</div>
      <div className="font-mono">{value}</div>
    </div>
  );
}

function areaColorCss(color: readonly number[]): string {
  const [r = 0, g = 0, b = 0, a = 255] = color;
  return `rgba(${clampColor(r)}, ${clampColor(g)}, ${clampColor(b)}, ${clampColor(a) / 255})`;
}

function formatRgbTuple(color: readonly number[]): string {
  return color
    .slice(0, 3)
    .map((value) => String(clampColor(value)))
    .join(", ");
}

function formatVectorTuple(values: readonly number[]): string {
  return values
    .slice(0, 3)
    .map((value) => (Number.isFinite(value) ? value.toFixed(2) : "0.00"))
    .join(", ");
}

function clampColor(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(255, Math.max(0, Math.round(value)));
}

function MapPlacementEffectInfo({
  effect,
  effectId,
  displayName,
  assetName,
}: {
  effect: SceneEffectEntry | null;
  effectId: number;
  displayName?: string | null;
  assetName?: string | null;
}) {
  const name = effect?.display_name ?? displayName ?? `Effect ${effectId}`;
  const filename = effect?.filename ?? assetName ?? "unknown effect file";

  return (
    <div data-testid="map-effect-placement-info" className="mt-2 rounded border bg-muted/20 p-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] uppercase text-muted-foreground">Effect details</div>
          <div className="truncate text-xs font-medium">{name}</div>
        </div>
        <div className="shrink-0 font-mono text-[11px] text-muted-foreground">
          id {effect?.id ?? effectId} {effect ? `type ${effect.effect_type}` : "type unknown"}
        </div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Metric label="Play time" value={effect ? `${effect.play_time.toFixed(2)}s` : "unknown"} />
        <Metric label="Base size" value={effect ? String(effect.base_size) : "unknown"} />
      </div>
      <div className="mt-2 truncate rounded bg-background/80 px-2 py-1 font-mono text-[11px] text-muted-foreground">
        {filename}
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  hint?: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block min-w-0">
      <span className="block truncate text-[11px] uppercase text-muted-foreground" title={label}>
        {label}
      </span>
      <input
        type="number"
        aria-label={label}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => {
          const next = Number(event.target.value);
          onChange(Number.isFinite(next) ? next : 0);
        }}
        className="mt-1 h-7 w-full min-w-0 rounded border bg-background px-1.5 font-mono text-[11px] outline-none focus:ring-1 focus:ring-ring"
      />
      {hint ? (
        <span className="mt-0.5 block truncate text-[10px] text-muted-foreground" title={hint}>
          {hint}
        </span>
      ) : null}
    </label>
  );
}

function TextureField({
  label,
  value,
  min,
  max,
  hint,
  catalog,
  previewDataUri,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  hint?: string;
  catalog: TerrainTextureEntry[];
  previewDataUri?: string | null;
  onChange: (value: number) => void;
}) {
  const catalogOptions = catalog.filter((texture) => texture.id >= min && texture.id <= max);
  const selectedTexture = catalogOptions.find((texture) => texture.id === value);
  const selectValue = selectedTexture ? String(value) : "__custom";

  return (
    <div className="block min-w-0" data-texture-field={label}>
      <span className="block truncate text-[11px] uppercase text-muted-foreground" title={label}>
        {label}
      </span>
      <div className="mt-1 flex min-w-0 items-center gap-1">
        <span
          className="h-5 w-5 shrink-0 rounded border"
          data-texture-preview={label}
          style={terrainTexturePreviewStyle(value, selectedTexture, previewDataUri)}
          title={selectedTexture?.path ?? `Texture id ${value}`}
          aria-hidden="true"
        />
        <input
          type="number"
          aria-label={label}
          value={value}
          min={min}
          max={max}
          onChange={(event) => {
            const next = Number(event.target.value);
            onChange(Number.isFinite(next) ? next : 0);
          }}
          className="h-7 w-16 min-w-0 rounded border bg-background px-1.5 font-mono text-[11px] outline-none focus:ring-1 focus:ring-ring"
        />
        {catalogOptions.length > 0 ? (
          <label className="min-w-0 flex-1">
            <span className="sr-only">{label} catalog</span>
            <select
              aria-label={`${label} catalog`}
              value={selectValue}
              onChange={(event) => {
                if (event.target.value === "__custom") {
                  return;
                }
                onChange(Number(event.target.value));
              }}
              className="h-7 w-full min-w-0 rounded border bg-background px-1.5 text-[11px] outline-none focus:ring-1 focus:ring-ring"
            >
              {!selectedTexture ? (
                <option value="__custom">Current custom #{value}</option>
              ) : null}
              {catalogOptions.map((texture) => (
                <option key={texture.id} value={texture.id}>
                  #{texture.id} {texture.file_name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      {hint ? (
        <span className="mt-0.5 block truncate text-[10px] text-muted-foreground" title={hint}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}
