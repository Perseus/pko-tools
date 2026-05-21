import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider, createStore } from "jotai";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MapChunkedWorkbench from "../MapChunkedWorkbench";
import { currentProjectAtom } from "@/store/project";
import { mapStagedEditStateAtom, selectedMapAtom } from "@/store/map";
import type { MapPlacementRecord, MapTileInspection, MapWorkbenchManifest } from "@/types/map";

const getMapWorkbenchManifestMock = vi.fn();
const getMapOverviewMock = vi.fn();
const getMapChunkMock = vi.fn();
const inspectMapTileMock = vi.fn();
const exportMapEditsMock = vi.fn();
const applyMapEditClientPackageMock = vi.fn();
const restoreMapEditClientBackupMock = vi.fn();
const exportMapTileEditsMock = vi.fn();
const exportMapPlacementEditsMock = vi.fn();
const queryMapPlacementsMock = vi.fn();
const queryMapPlacementsInBoundsMock = vi.fn();
const queryMapRboRecordsInBoundsMock = vi.fn();
const getMapTileTexturePreviewMock = vi.fn();
const getTerrainTextureCatalogMock = vi.fn();
const getTerrainTexturePreviewMock = vi.fn();
const getBuildingListMock = vi.fn();
const getSceneEffectListMock = vi.fn();
const revealItemInDirMock = vi.fn();
const toastMock = vi.fn();
const recordFrameMock = vi.fn();
const mapPlacementBuildingPreviewMock = vi.fn(
  ({ placement }: { placement: MapPlacementRecord | null }) => (
    <div data-testid="placement-building-preview">
      {placement?.display_name ?? "No placement"}
    </div>
  ),
);

function countInspectMapTileCalls(tileX: number, tileY: number): number {
  return inspectMapTileMock.mock.calls.filter((call) =>
    call[2] === tileX && call[3] === tileY
  ).length;
}

function hasInvalidInspectMapTileCall(): boolean {
  return inspectMapTileMock.mock.calls.some((call) =>
    !Number.isFinite(call[2]) || !Number.isFinite(call[3])
  );
}

vi.mock("@/commands/map", () => ({
  applyMapEditClientPackage: (...args: unknown[]) => applyMapEditClientPackageMock(...args),
  exportMapEdits: (...args: unknown[]) => exportMapEditsMock(...args),
  exportMapPlacementEdits: (...args: unknown[]) => exportMapPlacementEditsMock(...args),
  exportMapTileEdits: (...args: unknown[]) => exportMapTileEditsMock(...args),
  getMapChunk: (...args: unknown[]) => getMapChunkMock(...args),
  getMapTileTexturePreview: (...args: unknown[]) => getMapTileTexturePreviewMock(...args),
  getMapOverview: (...args: unknown[]) => getMapOverviewMock(...args),
  getMapWorkbenchManifest: (...args: unknown[]) => getMapWorkbenchManifestMock(...args),
  getTerrainTextureCatalog: (...args: unknown[]) => getTerrainTextureCatalogMock(...args),
  getTerrainTexturePreview: (...args: unknown[]) => getTerrainTexturePreviewMock(...args),
  inspectMapTile: (...args: unknown[]) => inspectMapTileMock(...args),
  queryMapPlacements: (...args: unknown[]) => queryMapPlacementsMock(...args),
  queryMapPlacementsInBounds: (...args: unknown[]) => queryMapPlacementsInBoundsMock(...args),
  queryMapRboRecordsInBounds: (...args: unknown[]) => queryMapRboRecordsInBoundsMock(...args),
  restoreMapEditClientBackup: (...args: unknown[]) => restoreMapEditClientBackupMock(...args),
  getSceneEffectList: (...args: unknown[]) => getSceneEffectListMock(...args),
}));

vi.mock("@/commands/buildings", () => ({
  getBuildingList: (...args: unknown[]) => getBuildingListMock(...args),
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: (...args: unknown[]) => revealItemInDirMock(...args),
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: (...args: unknown[]) => toastMock(...args),
}));

vi.mock("@/features/perf/metrics", () => ({
  recordFrame: (...args: unknown[]) => recordFrameMock(...args),
}));

vi.mock("../MapPlacementBuildingPreview", () => ({
  default: (props: { placement: MapPlacementRecord | null }) =>
    mapPlacementBuildingPreviewMock(props),
}));

const manifest: MapWorkbenchManifest = {
  name: "garner",
  width: 4096,
  height: 4096,
  section_width: 8,
  section_height: 8,
  section_count_x: 512,
  section_count_y: 512,
  chunk_size: 128,
  chunk_count_x: 32,
  chunk_count_y: 32,
  total_sections: 262144,
  non_empty_sections: 262144,
  available_layers: [
    "terrain_color",
    "texture_base",
    "texture_raw",
    "texture_layers",
    "height",
    "collision",
    "object_height",
    "region",
    "island",
  ],
  terrain_texture_status: {
    available: true,
    message: null,
    referenced_count: 8,
    loaded_count: 8,
    missing_count: 0,
    alpha_atlas_available: true,
  },
  placement_count: 0,
  coordinate_system: "map_tiles",
  recommended_overview_max_size: 768,
  source: {
    map_file_len: 1024,
    map_modified_ms: 1000,
    content_sha256: "map-hash",
  },
  placement_source: {
    map_file_len: 512,
    map_modified_ms: 2000,
    content_sha256: "obj-hash",
  },
  rbo_source: {
    map_file_len: 0,
    map_modified_ms: 0,
    content_sha256: "",
  },
  rbo_summary: {
    present: false,
    byte_len: 0,
    record_count: 0,
    distinct_type_ids: [],
    sample_records: [],
    bounds: null,
    warning_count: 0,
    first_warning: null,
  },
};

const selectedPlacement = {
  index: 12,
  obj_type: 0,
  obj_id: 26,
  kind: "building" as const,
  world_x: 118.2,
  world_y: 14.2,
  world_z: 0,
  yaw_angle: -180,
  scale: 100,
  display_name: "Volcano 01",
  asset_name: "nml-bd151.lmo",
  attach_effect_id: null,
  distance: null,
};

const temporaryPlacement = {
  ...selectedPlacement,
  index: -1,
  display_name: "New placement",
};

const effectPlacement: MapPlacementRecord = {
  ...selectedPlacement,
  obj_type: 1,
  obj_id: 401,
  kind: "effect",
  display_name: "Fire Burst",
  asset_name: "fire-burst.par",
};

const inspectedTile: MapTileInspection = {
  tile_x: 32,
  tile_y: 48,
  section_x: 4,
  section_y: 6,
  local_x: 0,
  local_y: 0,
  native: {
    dw_tile_info: 1,
    bt_tile_info: 2,
    s_color: -1,
    c_height: 10,
    s_region: 1,
    bt_island: 3,
    bt_block: [0, 0, 0, 0],
  },
  texture_layers: [],
  color_rgb: [255, 255, 255],
  terrain_height: 1,
  region_flags: [],
  island: 3,
  subtiles: [],
  nearby_placements: [],
};

let currentCanvasSize = { width: 1, height: 1 };
let resizeObserverFlushers: Array<() => void> = [];

function applyCanvasSize(target: Element) {
  Object.defineProperty(target, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: currentCanvasSize.width,
      bottom: currentCanvasSize.height,
      width: currentCanvasSize.width,
      height: currentCanvasSize.height,
      toJSON: () => ({}),
    }),
  });
}

function setCanvasSize(width: number, height: number) {
  currentCanvasSize = { width, height };
  resizeObserverFlushers = [];

  class TestResizeObserver {
    private callback: ResizeObserverCallback;
    private target: Element | null = null;

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }

    observe(target: Element) {
      this.target = target;
      applyCanvasSize(target);
      resizeObserverFlushers.push(() => {
        if (!this.target) {
          return;
        }
        applyCanvasSize(this.target);
        this.callback([], this as unknown as ResizeObserver);
      });
      this.callback([], this as unknown as ResizeObserver);
    }

    unobserve() {}

    disconnect() {
      this.target = null;
    }
  }

  vi.stubGlobal("ResizeObserver", TestResizeObserver);
}

function resizeCanvas(width: number, height: number) {
  currentCanvasSize = { width, height };
  resizeObserverFlushers.forEach((flush) => flush());
}

function mockCanvasContext() {
  Object.defineProperty(HTMLCanvasElement.prototype, "setPointerCapture", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLCanvasElement.prototype, "releasePointerCapture", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
    configurable: true,
    value: vi.fn(() => false),
  });
  const globalAlphaValues: number[] = [];
  const imageSmoothingEnabledValues: boolean[] = [];
  const drawImageSmoothingValues: boolean[] = [];
  const drawImageSmoothingQualityValues: ImageSmoothingQuality[] = [];
  let imageSmoothingEnabled = true;
  let imageSmoothingQuality: ImageSmoothingQuality = "low";
  const canvasContext = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    save: vi.fn(),
    translate: vi.fn(),
    scale: vi.fn(),
    drawImage: vi.fn(() => {
      drawImageSmoothingValues.push(imageSmoothingEnabled);
      drawImageSmoothingQualityValues.push(imageSmoothingQuality);
    }),
    stroke: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    strokeRect: vi.fn(),
    restore: vi.fn(),
    getImageData: vi.fn(() => ({
      data: new Uint8ClampedArray([4, 5, 6, 255]),
    })),
    globalAlphaValues,
    imageSmoothingEnabledValues,
    drawImageSmoothingValues,
    drawImageSmoothingQualityValues,
  };
  let globalAlpha = 1;
  Object.defineProperty(canvasContext, "globalAlpha", {
    configurable: true,
    get: () => globalAlpha,
    set: (value: number) => {
      globalAlpha = value;
      globalAlphaValues.push(value);
    },
  });
  Object.defineProperty(canvasContext, "imageSmoothingEnabled", {
    configurable: true,
    get: () => imageSmoothingEnabled,
    set: (value: boolean) => {
      imageSmoothingEnabled = value;
      imageSmoothingEnabledValues.push(value);
    },
  });
  Object.defineProperty(canvasContext, "imageSmoothingQuality", {
    configurable: true,
    get: () => imageSmoothingQuality,
    set: (value: ImageSmoothingQuality) => {
      imageSmoothingQuality = value;
    },
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => canvasContext as unknown as never,
  );
  return canvasContext;
}

function seedMapStore() {
  const store = createStore();
  store.set(currentProjectAtom, {
    id: "project-1",
    name: "Project",
    projectDirectory: "C:/project",
  });
  store.set(selectedMapAtom, {
    name: "garner",
    display_name: "Garner",
    map_file: "garner.map",
    has_obj: true,
    has_rbo: false,
    width: 4096,
    height: 4096,
  });
  return store;
}

function mockMapShellData() {
  getBuildingListMock.mockResolvedValue([
    { id: 26, display_name: "Volcano 01", filename: "nml-bd151.lmo" },
    { id: 316, display_name: "Grass 06", filename: "nml-bd034.lmo" },
  ]);
  getSceneEffectListMock.mockResolvedValue([
    {
      id: 401,
      display_name: "Fire Burst",
      filename: "fire-burst.par",
      effect_type: 3,
      object_type: 1,
      play_time: 2.5,
      base_size: 120,
    },
    {
      id: 777,
      display_name: "Portal Spark",
      filename: "portal-spark.par",
      effect_type: 8,
      object_type: 1,
      play_time: 1.25,
      base_size: -1,
    },
  ]);
  queryMapPlacementsInBoundsMock.mockResolvedValue({ items: [] });
  queryMapPlacementsMock.mockResolvedValue({
    total: 0,
    offset: 0,
    limit: 200,
    items: [],
  });
  queryMapRboRecordsInBoundsMock.mockResolvedValue({
    total: 0,
    offset: 0,
    limit: 1000,
    warning_count: 0,
    first_warning: null,
    items: [],
  });
  getMapTileTexturePreviewMock.mockResolvedValue(null);
  getTerrainTextureCatalogMock.mockResolvedValue([
    { id: 2, path: "texture/terrain/terrain_002.tga", file_name: "terrain_002.tga" },
    { id: 7, path: "texture/terrain/grass_007.tga", file_name: "grass_007.tga" },
  ]);
  getTerrainTexturePreviewMock.mockImplementation(
    async (_projectId: string, textureId: number) =>
      textureId === 7 ? "data:image/png;base64,grass-preview" : null,
  );
  getMapWorkbenchManifestMock.mockResolvedValue(manifest);
  getMapOverviewMock.mockResolvedValue({
    layer: "texture_base",
    map_width: 4096,
    map_height: 4096,
    sample_width: 256,
    sample_height: 256,
    image_data_uri: "data:image/png;base64,",
  });
  getMapChunkMock.mockResolvedValue({
    chunk_x: 0,
    chunk_y: 0,
    layer: "texture_base",
    tile_x: 0,
    tile_y: 0,
    tile_width: 128,
    tile_height: 128,
    sample_width: 128,
    sample_height: 128,
    image_data_uri: "data:image/png;base64,",
    numeric_format: null,
    numeric_payload: null,
  });
}

function dispatchCanvasPointerEvent(
  canvas: HTMLCanvasElement,
  type: "pointerdown" | "pointermove" | "pointerup",
  init: {
    button?: number;
    buttons?: number;
    clientX: number;
    clientY: number;
    pointerId: number;
  },
) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    button: { value: init.button ?? 0 },
    buttons: { value: init.buttons ?? 0 },
    clientX: { value: init.clientX },
    clientY: { value: init.clientY },
    pointerId: { value: init.pointerId },
  });
  fireEvent(canvas, event);
}

function flushAnimationFrames(frames: FrameRequestCallback[]) {
  while (frames.length > 0) {
    const callback = frames.shift();
    callback?.(performance.now());
  }
}

function expectTranslateCall(
  canvasContext: ReturnType<typeof mockCanvasContext>,
  expectedX: number,
  expectedY: number,
) {
  const found = canvasContext.translate.mock.calls.some(([x, y]) =>
    Math.abs(Number(x) - expectedX) < 0.001
    && Math.abs(Number(y) - expectedY) < 0.001
  );
  expect(found).toBe(true);
}

async function openPlacementAddAtSelectedTile() {
  fireEvent.click(await screen.findByRole("button", { name: "Add placement at selected tile" }));
  await screen.findByText("New placement");
}

function WorkbenchHarness({
  onSelectPlacement,
  onSelectedPlacementViewChange,
  initialSelectedPlacement = null,
  selectedPlacement,
  rightOverlayInset = 0,
  rightDockInset,
  preferCollapsedInspector = false,
}: {
  onSelectPlacement?: (placement: MapPlacementRecord | null) => void;
  onSelectedPlacementViewChange?: (placement: MapPlacementRecord | null) => void;
  initialSelectedPlacement?: MapPlacementRecord | null;
  selectedPlacement?: MapPlacementRecord | null;
  rightOverlayInset?: number;
  rightDockInset?: number;
  preferCollapsedInspector?: boolean;
}) {
  const [selectedPlacementState, setSelectedPlacementState] =
    useState<MapPlacementRecord | null>(initialSelectedPlacement);
  const currentSelectedPlacement = selectedPlacement === undefined
    ? selectedPlacementState
    : selectedPlacement;

  return (
    <MapChunkedWorkbench
      selectedPlacement={currentSelectedPlacement}
      onSelectPlacement={(placement) => {
        onSelectPlacement?.(placement);
        if (selectedPlacement === undefined) {
          setSelectedPlacementState(placement);
        }
      }}
      onSelectedPlacementViewChange={onSelectedPlacementViewChange}
      rightOverlayInset={rightOverlayInset}
      rightDockInset={rightDockInset}
      preferCollapsedInspector={preferCollapsedInspector}
    />
  );
}

describe("MapChunkedWorkbench", () => {
  afterEach(() => {
    delete (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: unknown;
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("does not request detail chunks before the initial fitted overview transform is applied", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockResolvedValue(inspectedTile);
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapWorkbenchManifestMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));

    expect(getMapChunkMock).not.toHaveBeenCalled();
  });

  it("records 2D map frame cadence without mixing it into 3D map FPS", async () => {
    setCanvasSize(820, 300);
    const canvasContext = mockCanvasContext();
    mockMapShellData();
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(canvasContext.fillRect).toHaveBeenCalled());
    expect(recordFrameMock.mock.calls.some(([surface]) => surface === "maps")).toBe(false);

    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        centerOnTile: (tileX: number, tileY: number, options?: { scale?: number }) => boolean;
        getState: () => { cache: { detailChunks: number } };
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    recordFrameMock.mockClear();
    act(() => {
      expect(api!.centerOnTile(80, 90, { scale: 5 })).toBe(true);
    });

    await waitFor(() => expect(recordFrameMock).toHaveBeenCalledWith("mapEditor", expect.any(Number)));
    const frameIntervals = recordFrameMock.mock.calls
      .filter(([surface]) => surface === "mapEditor")
      .map(([, duration]) => duration);
    expect(frameIntervals.length).toBeGreaterThan(0);
    expect(frameIntervals.every((duration) =>
      typeof duration === "number" && Number.isFinite(duration) && duration > 0
    )).toBe(true);
    expect(recordFrameMock.mock.calls.some(([surface]) => surface === "maps")).toBe(false);
  });

  it("shows read-only RBO status when the manifest includes RBO records", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    getMapWorkbenchManifestMock.mockResolvedValue({
      ...manifest,
      rbo_source: {
        map_file_len: 120,
        map_modified_ms: 3000,
        content_sha256: "rbo-hash",
      },
      rbo_summary: {
        present: true,
        byte_len: 120,
        record_count: 2,
        distinct_type_ids: [26, 316],
        sample_records: [
          {
            type_id: 26,
            x: 10,
            y: 20,
            z: 0,
            yaw: -180,
            terrain_height: 4,
          },
        ],
        bounds: {
          min_x: 10,
          min_y: 20,
          min_z: 0,
          max_x: 30,
          max_y: 40,
          max_z: 2,
        },
        warning_count: 1,
        first_warning: "line 4 has 2 fields; expected 9",
      },
    });
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    const rboStatus = await screen.findByTestId("map-rbo-summary");

    expect(rboStatus).toHaveTextContent("RBO 2 objects");
    expect(rboStatus).toHaveTextContent("1 warning");
    expect(rboStatus).toHaveAttribute(
      "title",
      expect.stringContaining("read-only"),
    );
    expect(rboStatus).toHaveAttribute(
      "title",
      expect.stringContaining("types 26, 316"),
    );
    expect(rboStatus).toHaveAttribute(
      "title",
      expect.stringContaining("sample type 26 at x 10.00, y 20.00"),
    );
  });

  it("keeps RBO status usable when a running backend has not sent sample records yet", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    getMapWorkbenchManifestMock.mockResolvedValue({
      ...manifest,
      rbo_summary: {
        present: true,
        byte_len: 120,
        record_count: 2,
        distinct_type_ids: [26, 316],
        bounds: {
          min_x: 10,
          min_y: 20,
          min_z: 0,
          max_x: 30,
          max_y: 40,
          max_z: 2,
        },
        warning_count: 0,
        first_warning: null,
      },
    });
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    const rboStatus = await screen.findByTestId("map-rbo-summary");

    expect(rboStatus).toHaveTextContent("RBO 2 objects");
    expect(rboStatus).toHaveAttribute(
      "title",
      expect.stringContaining("no sampled objects"),
    );
  });

  it("queries visible RBO sidecar records as read-only object context", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    const rboRecord = {
      index: 0,
      line_number: 1,
      type_id: 26,
      x: 2048.5,
      y: 2049.25,
      z: 0,
      yaw: -180,
      qx: 0,
      qy: 0,
      qz: 0,
      terrain_height: -2,
    };
    getMapWorkbenchManifestMock.mockResolvedValue({
      ...manifest,
      rbo_source: {
        map_file_len: 120,
        map_modified_ms: 3000,
        content_sha256: "rbo-hash",
      },
      rbo_summary: {
        present: true,
        byte_len: 120,
        record_count: 7,
        distinct_type_ids: [26],
        sample_records: [],
        bounds: {
          min_x: 2048,
          min_y: 2048,
          min_z: -2,
          max_x: 2050,
          max_y: 2050,
          max_z: 0,
        },
        warning_count: 0,
        first_warning: null,
      },
    });
    queryMapRboRecordsInBoundsMock.mockResolvedValue({
      total: 7,
      offset: 0,
      limit: 1000,
      warning_count: 0,
      first_warning: null,
      items: [rboRecord],
    });
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        centerOnTile: (tileX: number, tileY: number, options?: { scale?: number }) => boolean;
        setShowPlacements: (enabled: boolean) => boolean;
        getVisiblePlacements: () => MapPlacementRecord[];
        getVisibleRboRecords: () => Array<typeof rboRecord>;
        getState: () => {
          showPlacements: boolean;
          visiblePlacementCount: number;
          visibleRboRecordCount: number;
          visibleRboRecordTotal: number;
        };
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    act(() => {
      expect(api!.centerOnTile(2048, 2048, { scale: 4 })).toBe(true);
      expect(api!.setShowPlacements(true)).toBe(true);
    });

    await waitFor(() => expect(queryMapRboRecordsInBoundsMock).toHaveBeenCalled());
    const [, mapNameArg, minX, minY, maxX, maxY, limit] =
      queryMapRboRecordsInBoundsMock.mock.calls.at(-1)!;

    expect(mapNameArg).toBe("garner");
    expect(minX).toBeLessThanOrEqual(rboRecord.x);
    expect(minY).toBeLessThanOrEqual(rboRecord.y);
    expect(maxX).toBeGreaterThan(rboRecord.x);
    expect(maxY).toBeGreaterThan(rboRecord.y);
    expect(limit).toBe(1000);
    expect(api!.getVisiblePlacements()).toEqual([]);
    expect(api!.getVisibleRboRecords()).toEqual([rboRecord]);
    expect(api!.getState()).toEqual(expect.objectContaining({
      showPlacements: true,
      visiblePlacementCount: 0,
      visibleRboRecordCount: 1,
      visibleRboRecordTotal: 7,
    }));
    expect(screen.getByTestId("map-rbo-visible-summary")).toHaveTextContent("RBO 1/7 in view");
  });

  it("keeps the overview and loads a focused detail budget when the visible detail window is huge", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockResolvedValue(inspectedTile);
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));

    const canvas = screen.getByLabelText("Map editor canvas");
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 10,
        y: 20,
        top: 20,
        left: 10,
        right: 830,
        bottom: 320,
        width: 820,
        height: 300,
        toJSON: () => ({}),
      }),
    });

    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        centerOnTile: (tileX: number, tileY: number, options?: { scale?: number }) => boolean;
        getState: () => {
          cache: { detailChunks: number; maxDetailChunks: number };
          detailChunks: {
            enabled: boolean;
            scaleEnabled: boolean;
            windowSuppressed: boolean;
            visibleCandidates: number;
            maxVisible: number;
          };
          transform: { scale: number };
        };
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    act(() => {
      expect(api!.centerOnTile(2048, 2048, { scale: 0.3 })).toBe(true);
    });

    await waitFor(() => expect(api!.getState().transform.scale).toBe(0.3));
    await waitFor(() => expect(getMapChunkMock).toHaveBeenCalled());

    expect(getMapChunkMock.mock.calls.length).toBeLessThanOrEqual(96);
    expect(api!.getState().cache.maxDetailChunks).toBe(96);
    const detailState = api!.getState().detailChunks;

    expect(detailState).toEqual(expect.objectContaining({
      enabled: true,
      scaleEnabled: true,
      windowSuppressed: true,
      maxVisible: 96,
    }));
    expect(detailState.visibleCandidates).toBeGreaterThan(detailState.maxVisible);
    const status = screen.getByTestId("map-detail-status");
    expect(status).toHaveTextContent(/Client texture 1 px\/tile/);
    expect(status).toHaveAttribute(
      "title",
      expect.stringContaining("to keep panning responsive"),
    );
  });

  it("still queries placement overlays while wide views load a focused detail budget", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    queryMapPlacementsInBoundsMock.mockResolvedValue({
      total: 1,
      offset: 0,
      limit: 1500,
      items: [selectedPlacement],
    });
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));

    const canvas = screen.getByLabelText("Map editor canvas");
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 10,
        y: 20,
        top: 20,
        left: 10,
        right: 830,
        bottom: 320,
        width: 820,
        height: 300,
        toJSON: () => ({}),
      }),
    });

    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        centerOnTile: (tileX: number, tileY: number, options?: { scale?: number }) => boolean;
        getState: () => { cache: { detailChunks: number }; showPlacements: boolean };
        setShowPlacements: (enabled: boolean) => boolean;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    act(() => {
      expect(api!.centerOnTile(2048, 2048, { scale: 0.3 })).toBe(true);
      expect(api!.setShowPlacements(true)).toBe(true);
    });

    await waitFor(() => expect(api!.getState().showPlacements).toBe(true));
    await waitFor(() => expect(queryMapPlacementsInBoundsMock).toHaveBeenCalled());
    await waitFor(() => expect(getMapChunkMock).toHaveBeenCalled());
    expect(getMapChunkMock.mock.calls.length).toBeLessThanOrEqual(96);
  });

  it("lets users choose a quieter or denser object marker display", async () => {
    setCanvasSize(820, 300);
    const canvasContext = mockCanvasContext();
    mockMapShellData();
    const store = seedMapStore();
    const placements = [0, 1, 2, 3].map((offset) => ({
      ...selectedPlacement,
      index: offset + 1,
      world_x: 100 + offset,
      world_y: 100,
      display_name: `Tree ${offset + 1}`,
    }));
    queryMapPlacementsInBoundsMock.mockResolvedValue({
      total: placements.length,
      offset: 0,
      limit: 1500,
      items: placements,
    });

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        centerOnTile: (tileX: number, tileY: number, options?: { scale?: number }) => boolean;
        getState: () => { placementMarkerDensity: string; visiblePlacementCount: number };
        setShowPlacements: (enabled: boolean) => boolean;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    act(() => {
      expect(api!.centerOnTile(100, 100, { scale: 10 })).toBe(true);
      expect(api!.setShowPlacements(true)).toBe(true);
    });

    await waitFor(() => expect(queryMapPlacementsInBoundsMock).toHaveBeenCalled());
    await waitFor(() => expect(api!.getState().placementMarkerDensity).toBe("quiet"));
    expect(api!.getState().visiblePlacementCount).toBe(1);
    await waitFor(() => expect(canvasContext.arc).toHaveBeenCalled());
    expect(new Set(canvasContext.arc.mock.calls.map((call) => call[0]))).toEqual(new Set([100]));

    canvasContext.arc.mockClear();
    fireEvent.change(screen.getByRole("combobox", { name: "Object marker density" }), {
      target: { value: "dense" },
    });

    await waitFor(() => expect(api!.getState().placementMarkerDensity).toBe("dense"));
    expect(api!.getState().visiblePlacementCount).toBe(placements.length);
    await waitFor(() =>
      expect(new Set(canvasContext.arc.mock.calls.map((call) => call[0]))).toEqual(
        new Set([100, 101, 102, 103]),
      )
    );
  });

  it("applies active placement filters to canvas object marker queries", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockResolvedValue(inspectedTile);
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench
            selectedPlacement={null}
            onSelectPlacement={() => undefined}
            placementFilter={{
              query: "grass",
              placementType: "building",
              nearEnabled: false,
              useVisibleBounds: false,
              valid: true,
            }}
          />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));

    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        centerOnTile: (tileX: number, tileY: number, options?: { scale?: number }) => boolean;
        getState: () => { showPlacements: boolean };
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    act(() => {
      expect(api!.centerOnTile(2048, 2048, { scale: 2 })).toBe(true);
    });

    await waitFor(() => expect(api!.getState().showPlacements).toBe(true));
    await waitFor(() => expect(queryMapPlacementsMock).toHaveBeenCalled());
    expect(queryMapPlacementsInBoundsMock).not.toHaveBeenCalled();
    expect(queryMapPlacementsMock).toHaveBeenLastCalledWith(
      "project-1",
      "garner",
      "grass",
      "building",
      undefined,
      undefined,
      undefined,
      0,
      1500,
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    );
  });

  it("allows active placement filters to query markers at overview scale", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    queryMapPlacementsMock.mockResolvedValue({
      total: 1,
      offset: 0,
      limit: 1500,
      items: [selectedPlacement],
    });
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench
            selectedPlacement={null}
            onSelectPlacement={() => undefined}
            placementFilter={{
              query: "volcano",
              placementType: "building",
              nearEnabled: true,
              nearX: undefined,
              nearY: undefined,
              nearRadius: undefined,
              useVisibleBounds: true,
              valid: true,
            }}
          />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));

    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        getState: () => {
          cache: { detailChunks: number };
          detailChunks: { scaleEnabled: boolean };
          showPlacements: boolean;
          visiblePlacementCount: number;
        };
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    await waitFor(() => expect(api!.getState().showPlacements).toBe(true));
    expect(api!.getState().detailChunks.scaleEnabled).toBe(false);
    expect(api!.getState().cache.detailChunks).toBe(0);
    await waitFor(() => expect(queryMapPlacementsMock).toHaveBeenCalledWith(
      "project-1",
      "garner",
      "volcano",
      "building",
      undefined,
      undefined,
      undefined,
      0,
      1500,
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    ));
    await waitFor(() => expect(api!.getState().visiblePlacementCount).toBe(1));
    expect(getMapChunkMock).not.toHaveBeenCalled();
  });

  it("keeps unbounded placement filters gated at overview scale", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench
            selectedPlacement={null}
            onSelectPlacement={() => undefined}
            placementFilter={{
              query: "grass",
              placementType: "all",
              nearEnabled: false,
              useVisibleBounds: false,
              valid: true,
            }}
          />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));

    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        getState: () => {
          detailChunks: { scaleEnabled: boolean };
          showPlacements: boolean;
          visiblePlacementCount: number;
        };
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    await waitFor(() => expect(api!.getState().showPlacements).toBe(true));
    expect(api!.getState().detailChunks.scaleEnabled).toBe(false);
    await new Promise((resolve) => window.setTimeout(resolve, 160));

    expect(queryMapPlacementsMock).not.toHaveBeenCalled();
    expect(queryMapPlacementsInBoundsMock).not.toHaveBeenCalled();
    expect(api!.getState().visiblePlacementCount).toBe(0);
  });

  it("keeps manual near placement marker queries inside the visible editor bounds", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench
            selectedPlacement={null}
            onSelectPlacement={() => undefined}
            placementFilter={{
              query: "",
              placementType: "all",
              nearEnabled: true,
              nearX: 2100,
              nearY: 2050,
              nearRadius: 75,
              useVisibleBounds: false,
              valid: true,
            }}
          />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));

    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        centerOnTile: (tileX: number, tileY: number, options?: { scale?: number }) => boolean;
        getState: () => { viewportBounds: { minX: number; minY: number; maxX: number; maxY: number } | null };
        setShowPlacements: (enabled: boolean) => boolean;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    act(() => {
      expect(api!.centerOnTile(2048, 2048, { scale: 2 })).toBe(true);
      expect(api!.setShowPlacements(true)).toBe(true);
    });

    await waitFor(() => expect(queryMapPlacementsMock).toHaveBeenCalled());
    const viewportBounds = api!.getState().viewportBounds;
    expect(viewportBounds).not.toBeNull();

    expect(queryMapPlacementsMock).toHaveBeenLastCalledWith(
      "project-1",
      "garner",
      undefined,
      "all",
      2100,
      2050,
      75,
      0,
      1500,
      Math.max(0, Math.floor(viewportBounds!.minX)),
      Math.max(0, Math.floor(viewportBounds!.minY)),
      Math.min(manifest.width, Math.ceil(viewportBounds!.maxX)),
      Math.min(manifest.height, Math.ceil(viewportBounds!.maxY)),
    );
  });

  it("exposes a dev-only tile inspection API for canvas automation", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockImplementation(
      async (_projectId: string, _mapName: string, tileX: number, tileY: number) => ({
        ...inspectedTile,
        tile_x: tileX,
        tile_y: tileY,
      }),
    );
    const store = seedMapStore();

    const { unmount } = render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));

    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        inspectTile: (tileX: number, tileY: number) => Promise<boolean>;
        selectTile: (tileX: number, tileY: number, options?: { scale?: number }) => Promise<boolean>;
        centerOnTile: (tileX: number, tileY: number, options?: { scale?: number }) => boolean;
        frameTileBounds: (
          bounds: unknown,
          options?: { paddingRatio?: number } | null,
        ) => boolean;
        fitMap: () => boolean;
        zoomAtCenter: (direction: number) => boolean;
        getViewportBounds: () => { minX: number; minY: number; maxX: number; maxY: number } | null;
        getViewport: () => { width: number; height: number };
        getCanvasRect: () => { left: number; top: number; width: number; height: number } | null;
        getCanvasMetrics: () => {
          rect: { left: number; top: number; width: number; height: number };
          bitmap: { width: number; height: number };
          pixelRatio: { x: number; y: number };
        } | null;
        sampleCanvasPixel: (
          screenX: number,
          screenY: number,
        ) => { x: number; y: number; r: number; g: number; b: number; a: number } | null;
        sampleTilePixel: (
          tileX: number,
          tileY: number,
        ) => { x: number; y: number; r: number; g: number; b: number; a: number } | null;
        getTransform: () => { offsetX: number; offsetY: number; scale: number };
        getSelectedTile: () => { x: number; y: number } | null;
        getSelectedPlacement: () => MapPlacementRecord | null;
        getVisiblePlacements: () => MapPlacementRecord[];
        getState: () => {
          projectId: string | null;
          mapName: string | null;
          layer: string;
          showGrid: boolean;
          showPlacements: boolean;
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
          cache: {
            detailChunks: number;
            renderImages: number;
            maxDetailChunks: number;
            maxRenderImages: number;
          };
        };
        setLayer: (layer: string) => boolean;
        setShowGrid: (enabled: boolean) => boolean;
        setShowPlacements: (enabled: boolean) => boolean;
        waitForIdle: (timeoutMs?: number) => Promise<boolean>;
        screenToTile: (screenX: number, screenY: number) => { x: number; y: number };
        tileToScreen: (tileX: number, tileY: number) => { x: number; y: number };
        getTileScreenRect: (
          tileX: number,
          tileY: number,
        ) => {
          tileX: number;
          tileY: number;
          left: number;
          top: number;
          width: number;
          height: number;
          centerX: number;
          centerY: number;
        } | null;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    const canvas = document.querySelector("canvas");
    if (!canvas) {
      throw new Error("Expected workbench canvas");
    }
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 10,
        y: 20,
        top: 20,
        left: 10,
        right: 830,
        bottom: 320,
        width: 820,
        height: 300,
        toJSON: () => ({}),
      }),
    });

    expect(api!.getViewport()).toEqual({ width: 820, height: 300 });
    expect(api!.getCanvasRect()).toEqual({ left: 10, top: 20, width: 820, height: 300 });
    expect(api!.getCanvasMetrics()).toEqual({
      rect: { left: 10, top: 20, width: 820, height: 300 },
      bitmap: { width: 820, height: 300 },
      pixelRatio: { x: 1, y: 1 },
    });
    expect(api!.sampleCanvasPixel(420, 170)).toEqual({
      x: 410,
      y: 150,
      r: 4,
      g: 5,
      b: 6,
      a: 255,
    });
    expect(api!.sampleCanvasPixel(5, 170)).toBeNull();
    expect(api!.getSelectedPlacement()).toBeNull();
    expect(api!.getVisiblePlacements()).toEqual([]);
    expect(api!.getState()).toEqual(expect.objectContaining({
      projectId: "project-1",
      mapName: "garner",
      layer: "texture_base",
      showGrid: false,
      showPlacements: false,
      pendingEdits: {
        tiles: 0,
        placementUpdates: 0,
        placementAdds: 0,
        placementDeletes: 0,
        total: 0,
      },
      loading: expect.objectContaining({
        manifest: false,
        inspection: false,
        exporting: false,
      }),
      cache: {
        detailChunks: 0,
        renderImages: expect.any(Number),
        maxDetailChunks: expect.any(Number),
        maxRenderImages: expect.any(Number),
      },
    }));
    await expect(api!.waitForIdle(50)).resolves.toBe(true);
    act(() => {
      expect(api!.setLayer("collision")).toBe(true);
    });
    await waitFor(() => expect(api!.getState().layer).toBe("collision"));
    expect(api!.setLayer("not-a-layer")).toBe(false);
    expect(api!.getState().layer).toBe("collision");
    act(() => {
      expect(api!.setShowGrid(true)).toBe(true);
      expect(api!.setShowPlacements(true)).toBe(true);
    });
    await waitFor(() => expect(api!.getState()).toEqual(expect.objectContaining({
      showGrid: true,
      showPlacements: true,
    })));
    const viewportBounds = api!.getViewportBounds();
    expect(viewportBounds).toEqual(expect.objectContaining({
      minX: expect.any(Number),
      minY: expect.any(Number),
      maxX: expect.any(Number),
      maxY: expect.any(Number),
    }));
    const transform = api!.getTransform();
    expect(transform).toEqual(expect.objectContaining({
      offsetX: expect.any(Number),
      offsetY: expect.any(Number),
      scale: expect.any(Number),
    }));
    if (!viewportBounds) {
      throw new Error("Expected viewport bounds");
    }
    viewportBounds.minX = -999;
    transform.scale = -999;
    expect(api!.getViewportBounds()?.minX).not.toBe(-999);
    expect(api!.getTransform().scale).not.toBe(-999);

    const initialCenterTile = api!.screenToTile(420, 170);
    const initialCenterScreen = api!.tileToScreen(initialCenterTile.x, initialCenterTile.y);
    expect(initialCenterScreen.x).toBeCloseTo(420);
    expect(initialCenterScreen.y).toBeCloseTo(170);
    const sampledTile = api!.sampleTilePixel(initialCenterTile.x, initialCenterTile.y);
    expect(sampledTile).toEqual(expect.objectContaining({
      r: 4,
      g: 5,
      b: 6,
      a: 255,
    }));
    expect(sampledTile?.x).toBeGreaterThanOrEqual(0);
    expect(sampledTile?.y).toBeGreaterThanOrEqual(0);

    await act(async () => {
      expect(api!.centerOnTile(80, 90, { scale: 5 })).toBe(true);
    });
    await waitFor(() => expect(api!.getTransform().scale).toBe(5));
    const centeredTile = api!.screenToTile(420, 170);
    expect(centeredTile.x).toBeCloseTo(80.5);
    expect(centeredTile.y).toBeCloseTo(90.5);
    expect(api!.getTileScreenRect(80, 90)).toEqual({
      tileX: 80,
      tileY: 90,
      left: 417.5,
      top: 167.5,
      width: 5,
      height: 5,
      centerX: 420,
      centerY: 170,
    });
    expect(api!.getTileScreenRect(-1, 90)).toBeNull();
    act(() => {
      expect(api!.centerOnTile(81, 91, { scale: 10 })).toBe(true);
    });
    expect(api!.getTileScreenRect(81, 91)).toEqual({
      tileX: 81,
      tileY: 91,
      left: 415,
      top: 165,
      width: 10,
      height: 10,
      centerX: 420,
      centerY: 170,
    });

    const transformBeforeInvalidCenter = api!.getTransform();
    expect(api!.centerOnTile(-1, 90, { scale: 3 })).toBe(false);
    expect(api!.centerOnTile(4096, 90, { scale: 3 })).toBe(false);
    expect(api!.centerOnTile(Number.NaN, 90, { scale: 3 })).toBe(false);
    expect(api!.getTransform()).toEqual(transformBeforeInvalidCenter);

    const transformBeforeMalformedFrame = api!.getTransform();
    expect(api!.frameTileBounds(null)).toBe(false);
    expect(api!.getTransform()).toEqual(transformBeforeMalformedFrame);
    await act(async () => {
      expect(api!.frameTileBounds({
        minX: 100,
        minY: 200,
        maxX: 228,
        maxY: 264,
      }, { paddingRatio: Number.NaN })).toBe(true);
    });
    expect(Number.isFinite(api!.getTransform().scale)).toBe(true);
    await expect(api!.waitForIdle(1000)).resolves.toBe(true);

    await act(async () => {
      expect(api!.frameTileBounds({
        minX: 100,
        minY: 200,
        maxX: 228,
        maxY: 264,
      }, { paddingRatio: 0.9 })).toBe(true);
    });
    await waitFor(() => expect(api!.getTransform().scale).toBeCloseTo(4.21875, 5));
    const framedCenter = api!.screenToTile(420, 170);
    expect(framedCenter.x).toBeCloseTo(164);
    expect(framedCenter.y).toBeCloseTo(232);
    const framedViewportBounds = api!.getViewportBounds();
    expect(framedViewportBounds?.minX).toBeLessThanOrEqual(100);
    expect(framedViewportBounds?.minY).toBeLessThanOrEqual(200);
    expect(framedViewportBounds?.maxX).toBeGreaterThanOrEqual(228);
    expect(framedViewportBounds?.maxY).toBeGreaterThanOrEqual(264);
    await expect(api!.waitForIdle(1000)).resolves.toBe(true);

    const transformBeforeInvalidFrame = api!.getTransform();
    expect(api!.frameTileBounds({
      minX: 200,
      minY: 200,
      maxX: 100,
      maxY: 264,
    })).toBe(false);
    expect(api!.getTransform()).toEqual(transformBeforeInvalidFrame);

    await act(async () => {
      expect(api!.zoomAtCenter(1)).toBe(true);
    });
    await waitFor(() => expect(api!.getTransform().scale).toBeGreaterThan(5));

    await act(async () => {
      expect(api!.fitMap()).toBe(true);
    });
    await waitFor(() => expect(api!.getTransform().scale).not.toBeGreaterThan(5));

    await act(async () => {
      await expect(api!.inspectTile(32, 48)).resolves.toBe(true);
    });

    await waitFor(() =>
      expect(inspectMapTileMock).toHaveBeenCalledWith("project-1", "garner", 32, 48, manifest.source)
    );
    expect(api!.getSelectedTile()).toEqual({ x: 32, y: 48 });

    await act(async () => {
      await expect(api!.inspectTile(Number.NaN, 48)).resolves.toBe(false);
    });
    expect(countInspectMapTileCalls(32, 48)).toBe(1);
    expect(hasInvalidInspectMapTileCall()).toBe(false);
    expect(api!.getSelectedTile()).toBeNull();

    await act(async () => {
      await expect(api!.selectTile(96, 112, { scale: 6 })).resolves.toBe(true);
    });
    await waitFor(() =>
      expect(inspectMapTileMock).toHaveBeenCalledWith("project-1", "garner", 96, 112, expect.any(Object))
    );
    await waitFor(() => expect(api!.getTransform().scale).toBe(6));
    await waitFor(() => expect(api!.getSelectedTile()).toEqual({ x: 96, y: 112 }));

    const transformBeforeInvalidSelect = api!.getTransform();
    await act(async () => {
      await expect(api!.selectTile(-1, 112, { scale: 4 })).resolves.toBe(false);
    });
    expect(countInspectMapTileCalls(96, 112)).toBe(1);
    expect(hasInvalidInspectMapTileCall()).toBe(false);
    expect(api!.getTransform()).toEqual(transformBeforeInvalidSelect);
    expect(api!.getSelectedTile()).toEqual({ x: 96, y: 112 });

    inspectMapTileMock.mockImplementation(
      async (_projectId: string, _mapName: string, tileX: number, tileY: number) => {
        if (tileX === 98 && tileY === 114) {
          throw new Error("inspect failed");
        }
        return {
          ...inspectedTile,
          tile_x: tileX,
          tile_y: tileY,
        };
      },
    );
    const transformBeforeFailedSelect = api!.getTransform();
    await act(async () => {
      await expect(api!.selectTile(98, 114, { scale: 4 })).resolves.toBe(false);
    });
    expect(api!.getTransform()).toEqual(transformBeforeFailedSelect);
    expect(api!.getSelectedTile()).toEqual({ x: 96, y: 112 });

    unmount();
    expect((window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: unknown;
    }).__PKO_TOOLS_MAP_WORKBENCH__).toBeUndefined();
  });

  it("exposes event-level canvas helpers for Tauri workbench probes", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockImplementation(
      async (_projectId: string, _mapName: string, tileX: number, tileY: number) => ({
        ...inspectedTile,
        tile_x: tileX,
        tile_y: tileY,
        section_x: Math.floor(tileX / 8),
        section_y: Math.floor(tileY / 8),
        local_x: tileX % 8,
        local_y: tileY % 8,
      }),
    );
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        centerOnTile: (tileX: number, tileY: number, options?: { scale?: number }) => boolean;
        clickTile: (tileX: number, tileY: number) => boolean;
        getSelectedTile: () => { x: number; y: number } | null;
        getTransform: () => { scale: number };
        hoverTile: (tileX: number, tileY: number) => boolean;
        waitForIdle: (timeoutMs?: number) => Promise<boolean>;
        wheelAtTile: (tileX: number, tileY: number, deltaY: number) => boolean;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    const canvas = document.querySelector("canvas");
    if (!canvas) {
      throw new Error("Expected workbench canvas");
    }
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 820,
        bottom: 300,
        width: 820,
        height: 300,
        toJSON: () => ({}),
      }),
    });

    act(() => {
      expect(api!.centerOnTile(100, 200, { scale: 6 })).toBe(true);
    });
    await waitFor(() => expect(api!.getTransform().scale).toBe(6));

    let hoverResult = false;
    act(() => {
      hoverResult = api!.hoverTile(100, 200);
    });
    expect(hoverResult).toBe(true);
    await waitFor(() =>
      expect(inspectMapTileMock).toHaveBeenCalledWith(
        "project-1",
        "garner",
        100,
        200,
        expect.any(Object),
      )
    );
    await act(async () => {
      await Promise.resolve();
    });

    let clickResult = false;
    act(() => {
      clickResult = api!.clickTile(100, 200);
    });
    expect(clickResult).toBe(true);
    await waitFor(() => expect(api!.getSelectedTile()).toEqual({ x: 100, y: 200 }));

    const scaleBeforeWheel = api!.getTransform().scale;
    let wheelResult = false;
    act(() => {
      wheelResult = api!.wheelAtTile(100, 200, -100);
    });
    expect(wheelResult).toBe(true);
    await waitFor(() => expect(api!.getTransform().scale).toBeGreaterThan(scaleBeforeWheel));

    expect(api!.hoverTile(-1, 200)).toBe(false);
    expect(api!.clickTile(4096, 200)).toBe(false);
    expect(api!.wheelAtTile(Number.NaN, 200, -100)).toBe(false);
  });

  it("keeps event-level canvas helpers usable without PointerEvent or pointer capture APIs", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    delete (HTMLCanvasElement.prototype as Partial<Pick<
      HTMLCanvasElement,
      "setPointerCapture"
    >>).setPointerCapture;
    delete (HTMLCanvasElement.prototype as Partial<Pick<
      HTMLCanvasElement,
      "releasePointerCapture"
    >>).releasePointerCapture;
    vi.stubGlobal("PointerEvent", undefined);
    mockMapShellData();
    inspectMapTileMock.mockResolvedValue(inspectedTile);
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        centerOnTile: (tileX: number, tileY: number, options?: { scale?: number }) => boolean;
        clickTile: (tileX: number, tileY: number) => boolean;
        getSelectedTile: () => { x: number; y: number } | null;
        hoverTile: (tileX: number, tileY: number) => boolean;
        wheelAtTile: (tileX: number, tileY: number, deltaY: number) => boolean;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    const canvas = document.querySelector("canvas");
    if (!canvas) {
      throw new Error("Expected workbench canvas");
    }
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 820,
        bottom: 300,
        width: 820,
        height: 300,
        toJSON: () => ({}),
      }),
    });

    act(() => {
      expect(api!.centerOnTile(100, 200, { scale: 6 })).toBe(true);
    });

    let hoverResult = false;
    let clickResult = false;
    let wheelResult = false;
    expect(() => {
      act(() => {
        hoverResult = api!.hoverTile(100, 200);
        clickResult = api!.clickTile(100, 200);
        wheelResult = api!.wheelAtTile(100, 200, -100);
      });
    }).not.toThrow();
    expect(hoverResult).toBe(true);
    expect(clickResult).toBe(true);
    expect(wheelResult).toBe(true);
    await waitFor(() => expect(api!.getSelectedTile()).toEqual({ x: 100, y: 200 }));
  });

  it("rejects event-level canvas helpers for tiles hidden by the right overlay", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockResolvedValue(inspectedTile);
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench
            selectedPlacement={null}
            onSelectPlacement={() => undefined}
            rightOverlayInset={364}
          />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        centerOnTile: (tileX: number, tileY: number, options?: { scale?: number }) => boolean;
        clickTile: (tileX: number, tileY: number) => boolean;
        getSelectedTile: () => { x: number; y: number } | null;
        hoverTile: (tileX: number, tileY: number) => boolean;
        wheelAtTile: (tileX: number, tileY: number, deltaY: number) => boolean;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    const canvas = document.querySelector("canvas");
    if (!canvas) {
      throw new Error("Expected workbench canvas");
    }
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 820,
        bottom: 300,
        width: 820,
        height: 300,
        toJSON: () => ({}),
      }),
    });

    act(() => {
      expect(api!.centerOnTile(100, 200, { scale: 6 })).toBe(true);
    });

    expect(api!.hoverTile(150, 200)).toBe(false);
    expect(api!.clickTile(150, 200)).toBe(false);
    expect(api!.wheelAtTile(150, 200, -100)).toBe(false);
    expect(api!.getSelectedTile()).toBeNull();
  });

  it("frames automation tile bounds inside the unobscured canvas area", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench
            selectedPlacement={null}
            onSelectPlacement={() => undefined}
            rightOverlayInset={364}
          />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));

    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        frameTileBounds: (
          bounds: unknown,
          options?: { paddingRatio?: number } | null,
        ) => boolean;
        waitForIdle: (timeoutMs?: number) => Promise<boolean>;
        tileToScreen: (tileX: number, tileY: number) => { x: number; y: number };
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    const canvas = document.querySelector("canvas");
    if (!canvas) {
      throw new Error("Expected workbench canvas");
    }
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 10,
        y: 20,
        top: 20,
        left: 10,
        right: 830,
        bottom: 320,
        width: 820,
        height: 300,
        toJSON: () => ({}),
      }),
    });

    act(() => {
      expect(api!.frameTileBounds({
        minX: 100,
        minY: 200,
        maxX: 228,
        maxY: 264,
      }, { paddingRatio: 0.9 })).toBe(true);
    });

    const maxScreen = api!.tileToScreen(228, 264);
    expect(maxScreen.x).toBeLessThanOrEqual(10 + 820 - 364);
    expect(maxScreen.y).toBeLessThanOrEqual(20 + 300);
    await expect(api!.waitForIdle(1000)).resolves.toBe(true);
  });

  it("exposes canvas render diagnostics for lightweight app probes", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench
            selectedPlacement={null}
            onSelectPlacement={() => undefined}
            rightOverlayInset={364}
          />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));

    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        getCanvasDiagnostics: () => {
          canvas: {
            rect: { left: number; top: number; width: number; height: number };
            bitmap: { width: number; height: number };
            pixelRatio: { x: number; y: number };
          };
          unobscuredRect: {
            left: number;
            top: number;
            right: number;
            bottom: number;
            width: number;
            height: number;
          };
          mapRect: {
            left: number;
            top: number;
            right: number;
            bottom: number;
            width: number;
            height: number;
            visibleWidth: number;
            visibleHeight: number;
            intersectsViewport: boolean;
          } | null;
          centerTile: { x: number; y: number };
          centerPixel: { r: number; g: number; b: number; a: number } | null;
          samples: Array<{
            name: string;
            screenX: number;
            screenY: number;
            pixel: { r: number; g: number; b: number; a: number } | null;
          }>;
          sampledOpaquePixels: number;
          sampledDistinctColors: number;
          hasOpaqueCanvasSamples: boolean;
        } | null;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    const canvas = document.querySelector("canvas");
    if (!canvas) {
      throw new Error("Expected workbench canvas");
    }
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 10,
        y: 20,
        top: 20,
        left: 10,
        right: 830,
        bottom: 320,
        width: 820,
        height: 300,
        toJSON: () => ({}),
      }),
    });

    const diagnostics = api!.getCanvasDiagnostics();
    expect(diagnostics).toEqual(expect.objectContaining({
      canvas: expect.objectContaining({
        rect: { left: 10, top: 20, width: 820, height: 300 },
        bitmap: { width: 820, height: 300 },
        pixelRatio: { x: 1, y: 1 },
      }),
      unobscuredRect: {
        left: 10,
        top: 20,
        right: 466,
        bottom: 320,
        width: 456,
        height: 300,
      },
      centerTile: expect.objectContaining({
        x: expect.any(Number),
        y: expect.any(Number),
      }),
      centerPixel: expect.objectContaining({
        r: 4,
        g: 5,
        b: 6,
        a: 255,
      }),
      sampledOpaquePixels: 5,
      sampledDistinctColors: 1,
      hasOpaqueCanvasSamples: true,
    }));
    expect(diagnostics?.mapRect).toEqual(expect.objectContaining({
      intersectsViewport: true,
      visibleWidth: expect.any(Number),
      visibleHeight: expect.any(Number),
    }));
    expect(diagnostics?.mapRect?.visibleWidth).toBeGreaterThan(0);
    expect(diagnostics?.mapRect?.visibleHeight).toBeGreaterThan(0);
    expect(diagnostics?.samples.map((sample) => sample.name)).toEqual([
      "center",
      "top-left",
      "top-right",
      "bottom-left",
      "bottom-right",
    ]);
  });

  it("centers automation jumps inside the unobscured canvas area", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench
            selectedPlacement={null}
            onSelectPlacement={() => undefined}
            rightOverlayInset={364}
          />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));

    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        centerOnTile: (tileX: number, tileY: number, options?: { scale?: number }) => boolean;
        tileToScreen: (tileX: number, tileY: number) => { x: number; y: number };
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    const canvas = document.querySelector("canvas");
    if (!canvas) {
      throw new Error("Expected workbench canvas");
    }
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 10,
        y: 20,
        top: 20,
        left: 10,
        right: 830,
        bottom: 320,
        width: 820,
        height: 300,
        toJSON: () => ({}),
      }),
    });

    const initialMapCenter = api!.tileToScreen(manifest.width / 2, manifest.height / 2);
    expect(initialMapCenter.x).toBeCloseTo(10 + ((820 - 364) / 2));
    expect(initialMapCenter.y).toBeCloseTo(20 + 150);

    act(() => {
      expect(api!.centerOnTile(100, 200, { scale: 5 })).toBe(true);
    });

    const centered = api!.tileToScreen(100.5, 200.5);
    expect(centered.x).toBeCloseTo(10 + ((820 - 364) / 2));
    expect(centered.y).toBeCloseTo(20 + 150);

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));

    const zoomed = api!.tileToScreen(100.5, 200.5);
    expect(zoomed.x).toBeCloseTo(10 + ((820 - 364) / 2));
    expect(zoomed.y).toBeCloseTo(20 + 150);
  });

  it("refits a whole-map view when the right overlay grows", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    const store = seedMapStore();

    const { rerender } = render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench
            selectedPlacement={null}
            onSelectPlacement={() => undefined}
            rightOverlayInset={60}
          />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        tileToScreen: (tileX: number, tileY: number) => { x: number; y: number };
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    const beforeMax = api!.tileToScreen(manifest.width, manifest.height);
    expect(beforeMax.x).toBeLessThanOrEqual(820 - 60);

    rerender(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench
            selectedPlacement={null}
            onSelectPlacement={() => undefined}
            rightOverlayInset={364}
          />
        </div>
      </Provider>,
    );

    await waitFor(() => {
      const min = api!.tileToScreen(0, 0);
      const max = api!.tileToScreen(manifest.width, manifest.height);
      expect(min.x).toBeGreaterThanOrEqual(-0.5);
      expect(max.x).toBeLessThanOrEqual((820 - 364) + 0.5);
    });
  });

  it("keeps an auto-fitted view fitted when the overlay and viewport resize together", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    const store = seedMapStore();

    const { rerender } = render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench
            selectedPlacement={null}
            onSelectPlacement={() => undefined}
            rightOverlayInset={60}
          />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        getViewport: () => { width: number; height: number };
        tileToScreen: (tileX: number, tileY: number) => { x: number; y: number };
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    rerender(
      <Provider store={store}>
        <div style={{ width: 821, height: 300 }}>
          <MapChunkedWorkbench
            selectedPlacement={null}
            onSelectPlacement={() => undefined}
            rightOverlayInset={364}
          />
        </div>
      </Provider>,
    );
    act(() => {
      resizeCanvas(821, 300);
    });

    await waitFor(() => expect(api!.getViewport().width).toBe(821));
    await waitFor(() => {
      const min = api!.tileToScreen(0, 0);
      const max = api!.tileToScreen(manifest.width, manifest.height);
      expect(min.x).toBeGreaterThanOrEqual(-0.5);
      expect(max.x).toBeLessThanOrEqual((821 - 364) + 0.5);
    });
  });

  it("queues framed detail chunks before automation idle resolves", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    getMapChunkMock.mockImplementation(
      async (_projectId: string, _mapName: string, args: { chunk_x: number; chunk_y: number; layer: string }) =>
        new Promise((resolve) => {
          window.setTimeout(() => resolve({
            chunk_x: args.chunk_x,
            chunk_y: args.chunk_y,
            layer: args.layer,
            tile_x: args.chunk_x * 128,
            tile_y: args.chunk_y * 128,
            tile_width: 128,
            tile_height: 128,
            sample_width: 128,
            sample_height: 128,
            image_data_uri: "data:image/png;base64,",
            numeric_format: null,
            numeric_payload: null,
          }), 40);
        }),
    );
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    getMapChunkMock.mockClear();

    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        frameTileBounds: (
          bounds: unknown,
          options?: { paddingRatio?: number } | null,
        ) => boolean;
        waitForIdle: (timeoutMs?: number) => Promise<boolean>;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    act(() => {
      expect(api!.frameTileBounds({
        minX: 100,
        minY: 200,
        maxX: 228,
        maxY: 264,
      }, { paddingRatio: 0.9 })).toBe(true);
    });

    expect(getMapChunkMock).toHaveBeenCalled();
    await expect(api!.waitForIdle(20)).resolves.toBe(false);
    await expect(api!.waitForIdle(1000)).resolves.toBe(true);
  });

  it("publishes visible tile bounds for placement filtering", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    const store = seedMapStore();
    const onViewportBoundsChange = vi.fn();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench
            selectedPlacement={null}
            onSelectPlacement={() => undefined}
            onViewportBoundsChange={onViewportBoundsChange}
          />
        </div>
      </Provider>,
    );

    await waitFor(() =>
      expect(onViewportBoundsChange).toHaveBeenCalledWith(
        expect.objectContaining({
          minX: expect.any(Number),
          minY: expect.any(Number),
          maxX: expect.any(Number),
          maxY: expect.any(Number),
        }),
        "garner",
      )
    );
  });

  it("keeps automation idle pending while centered detail chunks are loading", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    getMapChunkMock.mockImplementation(
      async () => new Promise(() => undefined),
    );
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    getMapChunkMock.mockClear();

    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        centerOnTile: (tileX: number, tileY: number, options?: { scale?: number }) => boolean;
        waitForIdle: (timeoutMs?: number) => Promise<boolean>;
        getState: () => { cache: { maxDetailChunks: number } };
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    act(() => {
      expect(api!.centerOnTile(80, 90, { scale: 5 })).toBe(true);
    });

    expect(getMapChunkMock).toHaveBeenCalled();
    await expect(api!.waitForIdle(20)).resolves.toBe(false);
  });

  it("limits concurrent detail chunk loads to protect editor FPS", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    const chunkResolves: Array<() => void> = [];
    getMapChunkMock.mockImplementation(
      async (_projectId: string, _mapName: string, args: { chunk_x: number; chunk_y: number; layer: string }) =>
        new Promise((resolve) => {
          chunkResolves.push(() => resolve({
            chunk_x: args.chunk_x,
            chunk_y: args.chunk_y,
            layer: args.layer,
            tile_x: args.chunk_x * 128,
            tile_y: args.chunk_y * 128,
            tile_width: 128,
            tile_height: 128,
            sample_width: 128,
            sample_height: 128,
            image_data_uri: "data:image/png;base64,",
            numeric_format: null,
            numeric_payload: null,
          }));
        }),
    );
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    getMapChunkMock.mockClear();

    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        centerOnTile: (tileX: number, tileY: number, options?: { scale?: number }) => boolean;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    act(() => {
      expect(api!.centerOnTile(2048, 2048, { scale: 2 })).toBe(true);
    });

    await waitFor(() => expect(getMapChunkMock).toHaveBeenCalledTimes(4));
    expect(chunkResolves).toHaveLength(4);

    await act(async () => {
      chunkResolves.shift()?.();
    });

    await waitFor(() => expect(getMapChunkMock).toHaveBeenCalledTimes(5));
  });

  it("reprioritizes queued detail chunks around the newest viewport center", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    const chunkResolves: Array<() => void> = [];
    getMapChunkMock.mockImplementation(
      async (_projectId: string, _mapName: string, args: { chunk_x: number; chunk_y: number; layer: string }) =>
        new Promise((resolve) => {
          chunkResolves.push(() => resolve({
            chunk_x: args.chunk_x,
            chunk_y: args.chunk_y,
            layer: args.layer,
            tile_x: args.chunk_x * 128,
            tile_y: args.chunk_y * 128,
            tile_width: 128,
            tile_height: 128,
            sample_width: 128,
            sample_height: 128,
            image_data_uri: "data:image/png;base64,",
            numeric_format: null,
            numeric_payload: null,
          }));
        }),
    );
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    getMapChunkMock.mockClear();

    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        frameTileBounds: (
          bounds: { minX: number; minY: number; maxX: number; maxY: number },
          options?: { paddingRatio?: number } | null,
        ) => boolean;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    act(() => {
      expect(api!.frameTileBounds({
        minX: 1920,
        minY: 1920,
        maxX: 2176,
        maxY: 2176,
      }, { paddingRatio: 1 })).toBe(true);
    });

    await waitFor(() => expect(getMapChunkMock).toHaveBeenCalledTimes(4));

    act(() => {
      expect(api!.frameTileBounds({
        minX: 1984,
        minY: 1920,
        maxX: 2240,
        maxY: 2176,
      }, { paddingRatio: 1 })).toBe(true);
    });
    expect(getMapChunkMock).toHaveBeenCalledTimes(4);

    await act(async () => {
      chunkResolves.shift()?.();
    });

    await waitFor(() => expect(getMapChunkMock).toHaveBeenCalledTimes(5));
    expect(getMapChunkMock.mock.calls[4][2]).toEqual(
      expect.objectContaining({ chunk_x: 17, chunk_y: 15 }),
    );
  });

  it("shows an active detail-loading status while high-resolution chunks are refining", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    getMapChunkMock.mockImplementation(
      async () => new Promise(() => undefined),
    );
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    getMapChunkMock.mockClear();

    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        centerOnTile: (tileX: number, tileY: number, options?: { scale?: number }) => boolean;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    act(() => {
      expect(api!.centerOnTile(2048, 2048, { scale: 2 })).toBe(true);
    });

    await waitFor(() => expect(getMapChunkMock).toHaveBeenCalled());
    expect(screen.getByTestId("map-detail-status"))
      .toHaveTextContent("Loading Client texture 2 px/tile");
  });

  it("shows an active detail status immediately after centered navigation starts chunk loads", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    getMapChunkMock.mockImplementation(
      async () => new Promise(() => undefined),
    );
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    getMapChunkMock.mockClear();

    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        centerOnTile: (tileX: number, tileY: number, options?: { scale?: number }) => boolean;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    act(() => {
      expect(api!.centerOnTile(2048, 2048, { scale: 2 })).toBe(true);
    });

    expect(getMapChunkMock).toHaveBeenCalled();
    expect(screen.getByTestId("map-detail-status"))
      .toHaveTextContent("Loading Client texture 2 px/tile");
  });

  it("starts new detail loads after switching maps while old chunks are still in flight", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    getMapChunkMock.mockImplementation(
      async () => new Promise(() => undefined),
    );
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));

    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        centerOnTile: (tileX: number, tileY: number, options?: { scale?: number }) => boolean;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    act(() => {
      expect(api!.centerOnTile(2048, 2048, { scale: 2 })).toBe(true);
    });

    await waitFor(() => expect(getMapChunkMock).toHaveBeenCalledTimes(4));

    act(() => {
      store.set(selectedMapAtom, {
        name: "darkblue",
        display_name: "Darkblue",
        map_file: "darkblue.map",
        has_obj: true,
        has_rbo: false,
        width: 4096,
        height: 4096,
      });
    });

    await waitFor(() => expect(getMapWorkbenchManifestMock).toHaveBeenCalledTimes(2));

    act(() => {
      expect(api!.centerOnTile(1024, 1024, { scale: 2 })).toBe(true);
    });

    await waitFor(() =>
      expect(getMapChunkMock.mock.calls.some((call) => call[1] === "darkblue")).toBe(true)
    );
  });

  it("does not let stale chunk completions consume the new map detail budget", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    const oldChunkResolves: Array<() => void> = [];
    const newChunkResolves: Array<() => void> = [];
    getMapChunkMock.mockImplementation(
      async (_projectId: string, mapName: string, args: { chunk_x: number; chunk_y: number; layer: string }) =>
        new Promise((resolve) => {
          const resolveChunk = () => resolve({
            chunk_x: args.chunk_x,
            chunk_y: args.chunk_y,
            layer: args.layer,
            tile_x: args.chunk_x * 128,
            tile_y: args.chunk_y * 128,
            tile_width: 128,
            tile_height: 128,
            sample_width: 128,
            sample_height: 128,
            image_data_uri: "data:image/png;base64,",
            numeric_format: null,
            numeric_payload: null,
          });
          if (mapName === "darkblue") {
            newChunkResolves.push(resolveChunk);
          } else {
            oldChunkResolves.push(resolveChunk);
          }
        }),
    );
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));

    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        centerOnTile: (tileX: number, tileY: number, options?: { scale?: number }) => boolean;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    act(() => {
      expect(api!.centerOnTile(2048, 2048, { scale: 2 })).toBe(true);
    });

    await waitFor(() => expect(oldChunkResolves).toHaveLength(4));

    act(() => {
      store.set(selectedMapAtom, {
        name: "darkblue",
        display_name: "Darkblue",
        map_file: "darkblue.map",
        has_obj: true,
        has_rbo: false,
        width: 4096,
        height: 4096,
      });
    });

    await waitFor(() => expect(getMapWorkbenchManifestMock).toHaveBeenCalledTimes(2));

    act(() => {
      expect(api!.centerOnTile(1024, 1024, { scale: 2 })).toBe(true);
    });

    await waitFor(() => expect(newChunkResolves).toHaveLength(4));

    await act(async () => {
      oldChunkResolves.splice(0).forEach((resolve) => resolve());
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(newChunkResolves).toHaveLength(4);
  });

  it("does not let stale chunk completions consume the reloaded map detail budget", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    const oldChunkResolves: Array<() => void> = [];
    const reloadedChunkResolves: Array<() => void> = [];
    let afterReload = false;
    getMapChunkMock.mockImplementation(
      async (_projectId: string, _mapName: string, args: { chunk_x: number; chunk_y: number; layer: string }) =>
        new Promise((resolve) => {
          const resolveChunk = () => resolve({
            chunk_x: args.chunk_x,
            chunk_y: args.chunk_y,
            layer: args.layer,
            tile_x: args.chunk_x * 128,
            tile_y: args.chunk_y * 128,
            tile_width: 128,
            tile_height: 128,
            sample_width: 128,
            sample_height: 128,
            image_data_uri: "data:image/png;base64,",
            numeric_format: null,
            numeric_payload: null,
          });
          if (afterReload) {
            reloadedChunkResolves.push(resolveChunk);
          } else {
            oldChunkResolves.push(resolveChunk);
          }
        }),
    );
    const store = seedMapStore();
    const user = userEvent.setup();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));

    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        centerOnTile: (tileX: number, tileY: number, options?: { scale?: number }) => boolean;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    act(() => {
      expect(api!.centerOnTile(2048, 2048, { scale: 2 })).toBe(true);
    });

    await waitFor(() => expect(oldChunkResolves).toHaveLength(4));

    afterReload = true;
    await user.click(screen.getByRole("button", { name: "Reload map" }));
    await waitFor(() => expect(getMapWorkbenchManifestMock).toHaveBeenCalledTimes(2));

    act(() => {
      expect(api!.centerOnTile(2048, 2048, { scale: 2 })).toBe(true);
    });

    await waitFor(() => expect(reloadedChunkResolves).toHaveLength(4));

    await act(async () => {
      oldChunkResolves.splice(0).forEach((resolve) => resolve());
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(reloadedChunkResolves).toHaveLength(4);
    expect(api!.getState().cache.detailChunks).toBe(0);
  });

  it("keeps a panned view stable when detail chunks resolve after a resize", async () => {
    const animationFrames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    const chunkResolves: Array<() => void> = [];
    getMapChunkMock.mockImplementation(
      async (_projectId: string, _mapName: string, args: { chunk_x: number; chunk_y: number; layer: string }) =>
        new Promise((resolve) => {
          chunkResolves.push(() => resolve({
            chunk_x: args.chunk_x,
            chunk_y: args.chunk_y,
            layer: args.layer,
            tile_x: args.chunk_x * 128,
            tile_y: args.chunk_y * 128,
            tile_width: 128,
            tile_height: 128,
            sample_width: 128,
            sample_height: 128,
            image_data_uri: "data:image/png;base64,",
            numeric_format: null,
            numeric_payload: null,
          }));
        }),
    );
    const store = seedMapStore();

    const { container } = render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    getMapChunkMock.mockClear();

    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        centerOnTile: (tileX: number, tileY: number, options?: { scale?: number }) => boolean;
        getTransform: () => { offsetX: number; offsetY: number; scale: number };
        getViewport: () => { width: number; height: number };
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    act(() => {
      expect(api!.centerOnTile(2048, 2048, { scale: 2 })).toBe(true);
    });
    await waitFor(() => expect(getMapChunkMock).toHaveBeenCalled());

    const canvas = container.querySelector("canvas");
    if (!canvas) {
      throw new Error("Expected workbench canvas");
    }
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 820,
        bottom: 300,
        width: 820,
        height: 300,
        toJSON: () => ({}),
      }),
    });

    const centeredTransform = api!.getTransform();
    dispatchCanvasPointerEvent(canvas, "pointerdown", {
      button: 0,
      buttons: 1,
      clientX: 220,
      clientY: 140,
      pointerId: 1,
    });
    dispatchCanvasPointerEvent(canvas, "pointermove", {
      button: 0,
      buttons: 1,
      clientX: 284,
      clientY: 188,
      pointerId: 1,
    });
    await act(async () => {
      flushAnimationFrames(animationFrames);
    });
    dispatchCanvasPointerEvent(canvas, "pointerup", {
      button: 0,
      buttons: 0,
      clientX: 284,
      clientY: 188,
      pointerId: 1,
    });

    await waitFor(() => {
      expect(api!.getTransform().offsetX).not.toBeCloseTo(centeredTransform.offsetX);
    });
    const pannedTransform = api!.getTransform();

    act(() => {
      resizeCanvas(821, 300);
    });
    await waitFor(() => expect(api!.getViewport().width).toBe(821));

    await act(async () => {
      chunkResolves.splice(0).forEach((resolve) => resolve());
    });

    await waitFor(() => {
      expect(api!.getTransform().scale).toBeCloseTo(pannedTransform.scale);
      expect(api!.getTransform().offsetX).toBeCloseTo(pannedTransform.offsetX);
      expect(api!.getTransform().offsetY).toBeCloseTo(pannedTransform.offsetY);
    });
  });

  it("keeps the base terrain overview opaque while detail chunks load", async () => {
    const imageLoaders: Array<() => void> = [];
    class TestImage {
      onload: ((event: Event) => void) | null = null;

      set src(_value: string) {
        imageLoaders.push(() => this.onload?.(new Event("load")));
      }
    }
    vi.stubGlobal("Image", TestImage);
    setCanvasSize(820, 300);
    const canvasContext = mockCanvasContext();
    mockMapShellData();
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    await act(async () => {
      imageLoaders.splice(0).forEach((load) => load());
      await Promise.resolve();
    });
    canvasContext.globalAlphaValues.length = 0;

    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        centerOnTile: (tileX: number, tileY: number, options?: { scale?: number }) => boolean;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    act(() => {
      expect(api!.centerOnTile(2048, 2048, { scale: 2 })).toBe(true);
    });

    await waitFor(() => expect(getMapChunkMock).toHaveBeenCalled());
    await waitFor(() => expect(canvasContext.globalAlphaValues.length).toBeGreaterThan(0));

    expect(canvasContext.globalAlphaValues.filter((value) => value < 1)).toEqual([]);
  });

  it("smooths terrain texture rasters instead of nearest-neighbor stretching them", async () => {
    const imageLoaders: Array<() => void> = [];
    class TestImage {
      onload: ((event: Event) => void) | null = null;

      set src(_value: string) {
        imageLoaders.push(() => this.onload?.(new Event("load")));
      }
    }
    vi.stubGlobal("Image", TestImage);
    setCanvasSize(820, 300);
    const canvasContext = mockCanvasContext();
    mockMapShellData();
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    await act(async () => {
      imageLoaders.splice(0).forEach((load) => load());
      await Promise.resolve();
    });

    await waitFor(() => expect(canvasContext.drawImage).toHaveBeenCalled());
    expect(canvasContext.drawImageSmoothingValues).toContain(true);
  });

  it("uses high-quality interpolation when scaling terrain texture rasters", async () => {
    const imageLoaders: Array<() => void> = [];
    class TestImage {
      onload: ((event: Event) => void) | null = null;

      set src(_value: string) {
        imageLoaders.push(() => this.onload?.(new Event("load")));
      }
    }
    vi.stubGlobal("Image", TestImage);
    setCanvasSize(820, 300);
    const canvasContext = mockCanvasContext();
    mockMapShellData();
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    await act(async () => {
      imageLoaders.splice(0).forEach((load) => load());
      await Promise.resolve();
    });

    await waitFor(() => expect(canvasContext.drawImage).toHaveBeenCalled());
    expect(canvasContext.drawImageSmoothingQualityValues).toContain("high");
  });

  it("collapses the overview navigator into a compact restore control", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    const store = seedMapStore();
    const user = userEvent.setup();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("button", { name: "Map overview navigator" }))
      .toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Collapse overview navigator" }));

    expect(screen.queryByRole("button", { name: "Map overview navigator" }))
      .not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show overview navigator" }))
      .toHaveTextContent("Overview");

    await user.click(screen.getByRole("button", { name: "Show overview navigator" }));

    expect(screen.getByRole("button", { name: "Map overview navigator" }))
      .toBeInTheDocument();
  });

  it("coalesces drag panning into animation frames for editor FPS", async () => {
    const animationFrames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    setCanvasSize(820, 300);
    const canvasContext = mockCanvasContext();
    mockMapShellData();
    const store = seedMapStore();

    const { container } = render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    const canvas = container.querySelector("canvas");
    if (!canvas) {
      throw new Error("Expected workbench canvas");
    }
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 820,
        bottom: 300,
        width: 820,
        height: 300,
        toJSON: () => ({}),
      }),
    });

    canvasContext.translate.mockClear();
    dispatchCanvasPointerEvent(canvas, "pointerdown", {
      button: 0,
      buttons: 1,
      clientX: 100,
      clientY: 100,
      pointerId: 1,
    });

    for (let index = 1; index <= 8; index += 1) {
      dispatchCanvasPointerEvent(canvas, "pointermove", {
        button: 0,
        buttons: 1,
        clientX: 100 + index * 5,
        clientY: 100 + index * 3,
        pointerId: 1,
      });
    }

    expect(canvasContext.translate).not.toHaveBeenCalled();
    expect(animationFrames).toHaveLength(1);

    await act(async () => {
      flushAnimationFrames(animationFrames);
    });

    await waitFor(() => expect(canvasContext.translate).toHaveBeenCalled());
    expect(canvasContext.translate.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it("keeps drag-frame panning out of React viewport updates until release", async () => {
    const animationFrames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    const store = seedMapStore();
    const onViewportBoundsChange = vi.fn();

    const { container } = render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench
            selectedPlacement={null}
            onSelectPlacement={() => undefined}
            onViewportBoundsChange={onViewportBoundsChange}
          />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onViewportBoundsChange).toHaveBeenCalled());
    onViewportBoundsChange.mockClear();

    const canvas = container.querySelector("canvas");
    if (!canvas) {
      throw new Error("Expected workbench canvas");
    }
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 820,
        bottom: 300,
        width: 820,
        height: 300,
        toJSON: () => ({}),
      }),
    });

    dispatchCanvasPointerEvent(canvas, "pointerdown", {
      button: 0,
      buttons: 1,
      clientX: 100,
      clientY: 100,
      pointerId: 1,
    });
    dispatchCanvasPointerEvent(canvas, "pointermove", {
      button: 0,
      buttons: 1,
      clientX: 160,
      clientY: 130,
      pointerId: 1,
    });

    await act(async () => {
      flushAnimationFrames(animationFrames);
    });

    expect(onViewportBoundsChange).not.toHaveBeenCalled();

    dispatchCanvasPointerEvent(canvas, "pointerup", {
      button: 0,
      buttons: 0,
      clientX: 160,
      clientY: 130,
      pointerId: 1,
    });

    await waitFor(() => expect(onViewportBoundsChange).toHaveBeenCalledTimes(1));
  });

  it("requests visible detail chunks while drag panning before the viewport state commits", async () => {
    const animationFrames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    const store = seedMapStore();

    const { container } = render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        centerOnTile: (tileX: number, tileY: number, options?: { scale?: number }) => boolean;
        waitForIdle: (timeoutMs?: number) => Promise<boolean>;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    act(() => {
      expect(api!.centerOnTile(2048, 2048, { scale: 2 })).toBe(true);
    });
    await waitFor(() => expect(getMapChunkMock).toHaveBeenCalled());
    await expect(api!.waitForIdle(1000)).resolves.toBe(true);
    getMapChunkMock.mockClear();

    const canvas = container.querySelector("canvas");
    if (!canvas) {
      throw new Error("Expected workbench canvas");
    }
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 820,
        bottom: 300,
        width: 820,
        height: 300,
        toJSON: () => ({}),
      }),
    });

    dispatchCanvasPointerEvent(canvas, "pointerdown", {
      button: 0,
      buttons: 1,
      clientX: 100,
      clientY: 100,
      pointerId: 1,
    });
    dispatchCanvasPointerEvent(canvas, "pointermove", {
      button: 0,
      buttons: 1,
      clientX: 700,
      clientY: 100,
      pointerId: 1,
    });

    expect(animationFrames).toHaveLength(1);
    await waitFor(() => expect(getMapChunkMock).toHaveBeenCalled());
  });

  it("starts loading the new visible detail window before stale chunk requests finish", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    type ChunkRequest = { chunk_x: number; chunk_y: number; layer: string };
    const pendingChunks: Array<{
      request: ChunkRequest;
      resolve: () => void;
    }> = [];
    getMapChunkMock.mockImplementation(
      async (
        _projectId: string,
        _mapName: string,
        request: ChunkRequest,
      ) =>
        new Promise((resolve) => {
          pendingChunks.push({
            request,
            resolve: () => resolve({
              chunk_x: request.chunk_x,
              chunk_y: request.chunk_y,
              layer: request.layer,
              tile_x: request.chunk_x * 128,
              tile_y: request.chunk_y * 128,
              tile_width: 128,
              tile_height: 128,
              sample_width: 128,
              sample_height: 128,
              image_data_uri: "data:image/png;base64,",
              numeric_format: null,
              numeric_payload: null,
            }),
          });
        }),
    );
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        centerOnTile: (tileX: number, tileY: number, options?: { scale?: number }) => boolean;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    act(() => {
      expect(api!.centerOnTile(512, 512, { scale: 2 })).toBe(true);
    });
    await waitFor(() => expect(getMapChunkMock).toHaveBeenCalledTimes(4));
    const firstWindowRequests = pendingChunks.map(
      (entry) => `${entry.request.chunk_x}:${entry.request.chunk_y}`,
    );

    act(() => {
      expect(api!.centerOnTile(3200, 3200, { scale: 2 })).toBe(true);
    });

    await waitFor(() => expect(getMapChunkMock.mock.calls.length).toBeGreaterThan(4));
    const laterWindowRequests = pendingChunks
      .slice(4)
      .map((entry) => `${entry.request.chunk_x}:${entry.request.chunk_y}`);
    expect(laterWindowRequests.length).toBeGreaterThan(0);
    expect(laterWindowRequests.some((key) => !firstWindowRequests.includes(key))).toBe(true);

    await act(async () => {
      pendingChunks.splice(0).forEach((entry) => entry.resolve());
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it("applies a re-requested visible chunk while the old cancelled request is still pending", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    type ChunkRequest = { chunk_x: number; chunk_y: number; layer: string };
    const requestKey = (request: ChunkRequest) => `${request.chunk_x}:${request.chunk_y}`;
    const pendingChunks: Array<{
      request: ChunkRequest;
      resolved: boolean;
      resolve: () => void;
    }> = [];
    getMapChunkMock.mockImplementation(
      async (
        _projectId: string,
        _mapName: string,
        request: ChunkRequest,
      ) =>
        new Promise((resolve) => {
          const entry: {
            request: ChunkRequest;
            resolved: boolean;
            resolve: () => void;
          } = {
            request,
            resolved: false,
            resolve: () => undefined,
          };
          entry.resolve = () => {
            entry.resolved = true;
            resolve({
              chunk_x: request.chunk_x,
              chunk_y: request.chunk_y,
              layer: request.layer,
              tile_x: request.chunk_x * 128,
              tile_y: request.chunk_y * 128,
              tile_width: 128,
              tile_height: 128,
              sample_width: 128,
              sample_height: 128,
              image_data_uri: "data:image/png;base64,",
              numeric_format: null,
              numeric_payload: null,
            });
          };
          pendingChunks.push(entry);
        }),
    );
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        centerOnTile: (tileX: number, tileY: number, options?: { scale?: number }) => boolean;
        getState: () => {
          cache: { detailChunks: number };
          loading: { chunks: number };
        };
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    act(() => {
      expect(api!.centerOnTile(512, 512, { scale: 2 })).toBe(true);
    });
    await waitFor(() => expect(pendingChunks).toHaveLength(4));
    const firstWindowRequests = new Set(pendingChunks.map((entry) => requestKey(entry.request)));

    act(() => {
      expect(api!.centerOnTile(3200, 3200, { scale: 2 })).toBe(true);
    });
    await waitFor(() => expect(pendingChunks.length).toBeGreaterThan(4));
    const farWindowRequests = pendingChunks.filter(
      (entry) => !firstWindowRequests.has(requestKey(entry.request)),
    );
    expect(farWindowRequests.length).toBeGreaterThan(0);

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const unresolvedFarRequests = pendingChunks.filter(
        (entry) => !entry.resolved && !firstWindowRequests.has(requestKey(entry.request)),
      );
      if (unresolvedFarRequests.length === 0) {
        break;
      }
      await act(async () => {
        unresolvedFarRequests.forEach((entry) => entry.resolve());
        await Promise.resolve();
        await Promise.resolve();
      });
    }
    await waitFor(() => expect(api!.getState().loading.chunks).toBe(0));
    await waitFor(() => expect(api!.getState().cache.detailChunks).toBeGreaterThan(0));
    const farCacheCount = api!.getState().cache.detailChunks;
    const requestCountBeforeReturn = pendingChunks.length;

    act(() => {
      expect(api!.centerOnTile(512, 512, { scale: 2 })).toBe(true);
    });

    await waitFor(() =>
      expect(
        pendingChunks
          .slice(requestCountBeforeReturn)
          .some((entry) => firstWindowRequests.has(requestKey(entry.request))),
      ).toBe(true)
    );
    const returnedWindowRequests = pendingChunks
      .slice(requestCountBeforeReturn)
      .filter((entry) => firstWindowRequests.has(requestKey(entry.request)));

    await act(async () => {
      returnedWindowRequests.forEach((entry) => entry.resolve());
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(api!.getState().cache.detailChunks).toBeGreaterThan(farCacheCount));

    await act(async () => {
      pendingChunks.splice(0).forEach((entry) => {
        if (!entry.resolved) {
          entry.resolve();
        }
      });
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it("keeps an active drag-pan transform when a raster image finishes loading", async () => {
    const animationFrames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const imageLoaders: Array<() => void> = [];
    class TestImage {
      onload: ((event: Event) => void) | null = null;

      set src(_value: string) {
        imageLoaders.push(() => this.onload?.(new Event("load")));
      }
    }
    vi.stubGlobal("Image", TestImage);
    setCanvasSize(820, 300);
    const canvasContext = mockCanvasContext();
    mockMapShellData();
    const store = seedMapStore();

    const { container } = render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(imageLoaders.length).toBeGreaterThan(0));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        getTransform: () => { offsetX: number; offsetY: number; scale: number };
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    const canvas = container.querySelector("canvas");
    if (!canvas) {
      throw new Error("Expected workbench canvas");
    }
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 820,
        bottom: 300,
        width: 820,
        height: 300,
        toJSON: () => ({}),
      }),
    });

    const initialTransform = api!.getTransform();
    dispatchCanvasPointerEvent(canvas, "pointerdown", {
      button: 0,
      buttons: 1,
      clientX: 100,
      clientY: 100,
      pointerId: 1,
    });
    dispatchCanvasPointerEvent(canvas, "pointermove", {
      button: 0,
      buttons: 1,
      clientX: 160,
      clientY: 130,
      pointerId: 1,
    });

    await act(async () => {
      flushAnimationFrames(animationFrames);
    });

    const activeDragTransform = api!.getTransform();
    expect(activeDragTransform.offsetX).toBeCloseTo(initialTransform.offsetX + 60);
    expect(activeDragTransform.offsetY).toBeCloseTo(initialTransform.offsetY + 30);
    canvasContext.translate.mockClear();

    await act(async () => {
      imageLoaders.shift()?.();
      await Promise.resolve();
    });

    await waitFor(() => expect(canvasContext.translate).toHaveBeenCalled());
    const lastTranslate = canvasContext.translate.mock.calls.at(-1);
    expect(Number(lastTranslate?.[0])).toBeCloseTo(activeDragTransform.offsetX);
    expect(Number(lastTranslate?.[1])).toBeCloseTo(activeDragTransform.offsetY);
  });

  it("uses the latest pending drag transform when raster images load before the drag frame paints", async () => {
    const animationFrames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const imageLoaders: Array<() => void> = [];
    class TestImage {
      onload: ((event: Event) => void) | null = null;

      set src(_value: string) {
        imageLoaders.push(() => this.onload?.(new Event("load")));
      }
    }
    vi.stubGlobal("Image", TestImage);
    setCanvasSize(820, 300);
    const canvasContext = mockCanvasContext();
    mockMapShellData();
    const store = seedMapStore();

    const { container } = render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(imageLoaders.length).toBeGreaterThan(0));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        getTransform: () => { offsetX: number; offsetY: number; scale: number };
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    const canvas = container.querySelector("canvas");
    if (!canvas) {
      throw new Error("Expected workbench canvas");
    }
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 820,
        bottom: 300,
        width: 820,
        height: 300,
        toJSON: () => ({}),
      }),
    });

    const initialTransform = api!.getTransform();
    canvasContext.translate.mockClear();
    dispatchCanvasPointerEvent(canvas, "pointerdown", {
      button: 0,
      buttons: 1,
      clientX: 100,
      clientY: 100,
      pointerId: 1,
    });
    dispatchCanvasPointerEvent(canvas, "pointermove", {
      button: 0,
      buttons: 1,
      clientX: 160,
      clientY: 130,
      pointerId: 1,
    });

    expect(animationFrames).toHaveLength(1);

    await act(async () => {
      imageLoaders.shift()?.();
      await Promise.resolve();
    });

    await waitFor(() => expect(canvasContext.translate).toHaveBeenCalled());
    const lastTranslate = canvasContext.translate.mock.calls.at(-1);
    expect(Number(lastTranslate?.[0])).toBeCloseTo(initialTransform.offsetX + 60);
    expect(Number(lastTranslate?.[1])).toBeCloseTo(initialTransform.offsetY + 30);
  });

  it("updates the live transform immediately while wheel zoom state is still batching", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    const store = seedMapStore();

    const { container } = render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        getTransform: () => { offsetX: number; offsetY: number; scale: number };
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    const canvas = container.querySelector("canvas");
    if (!canvas) {
      throw new Error("Expected workbench canvas");
    }
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 820,
        bottom: 300,
        width: 820,
        height: 300,
        toJSON: () => ({}),
      }),
    });

    const initialTransform = api!.getTransform();
    act(() => {
      fireEvent.wheel(canvas, {
        deltaY: -100,
        clientX: 410,
        clientY: 150,
      });
      expect(api!.getTransform().scale).toBeGreaterThan(initialTransform.scale);
    });
  });

  it("does not let a batched wheel zoom overwrite an in-progress pan drag", async () => {
    const animationFrames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    const store = seedMapStore();

    const { container } = render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        getTransform: () => { offsetX: number; offsetY: number; scale: number };
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    const canvas = container.querySelector("canvas");
    if (!canvas) {
      throw new Error("Expected workbench canvas");
    }
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 820,
        bottom: 300,
        width: 820,
        height: 300,
        toJSON: () => ({}),
      }),
    });

    let afterWheelTransform = api!.getTransform();
    act(() => {
      fireEvent.wheel(canvas, {
        deltaY: -100,
        clientX: 410,
        clientY: 150,
      });
      afterWheelTransform = api!.getTransform();
      dispatchCanvasPointerEvent(canvas, "pointerdown", {
        button: 0,
        buttons: 1,
        clientX: 100,
        clientY: 100,
        pointerId: 1,
      });
      dispatchCanvasPointerEvent(canvas, "pointermove", {
        button: 0,
        buttons: 1,
        clientX: 160,
        clientY: 130,
        pointerId: 1,
      });
    });

    expect(animationFrames).toHaveLength(1);
    const activeDragTransform = api!.getTransform();
    expect(activeDragTransform.offsetX).toBeCloseTo(afterWheelTransform.offsetX + 60);
    expect(activeDragTransform.offsetY).toBeCloseTo(afterWheelTransform.offsetY + 30);
    expect(activeDragTransform.scale).toBeCloseTo(afterWheelTransform.scale);
  });

  it("commits wheel zooms made during an active pan drag", async () => {
    const animationFrames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    const store = seedMapStore();

    const { container } = render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        getTransform: () => { offsetX: number; offsetY: number; scale: number };
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    const canvas = container.querySelector("canvas");
    if (!canvas) {
      throw new Error("Expected workbench canvas");
    }
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 820,
        bottom: 300,
        width: 820,
        height: 300,
        toJSON: () => ({}),
      }),
    });

    dispatchCanvasPointerEvent(canvas, "pointerdown", {
      button: 0,
      buttons: 1,
      clientX: 100,
      clientY: 100,
      pointerId: 1,
    });
    dispatchCanvasPointerEvent(canvas, "pointermove", {
      button: 0,
      buttons: 1,
      clientX: 160,
      clientY: 130,
      pointerId: 1,
    });
    const preWheelDragTransform = api!.getTransform();

    act(() => {
      fireEvent.wheel(canvas, {
        deltaY: -100,
        clientX: 410,
        clientY: 150,
      });
    });
    const wheelTransform = api!.getTransform();
    expect(wheelTransform.scale).toBeGreaterThan(preWheelDragTransform.scale);

    dispatchCanvasPointerEvent(canvas, "pointerup", {
      button: 0,
      buttons: 0,
      clientX: 160,
      clientY: 130,
      pointerId: 1,
    });

    expect(api!.getTransform().scale).toBeCloseTo(wheelTransform.scale);
  });

  it("queues visible detail chunks immediately when wheel zooming into detail range", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    getMapChunkMock.mockReturnValue(new Promise(() => undefined));
    const store = seedMapStore();

    const { container } = render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        centerOnTile: (tileX: number, tileY: number, options?: { scale?: number }) => boolean;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    const canvas = container.querySelector("canvas");
    if (!canvas) {
      throw new Error("Expected workbench canvas");
    }
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 820,
        bottom: 300,
        width: 820,
        height: 300,
        toJSON: () => ({}),
      }),
    });

    act(() => {
      expect(api!.centerOnTile(2048, 2048, { scale: 0.22 })).toBe(true);
    });
    getMapChunkMock.mockClear();

    act(() => {
      fireEvent.wheel(canvas, {
        deltaY: -100,
        clientX: 410,
        clientY: 150,
      });
    });

    expect(getMapChunkMock).toHaveBeenCalled();
  });

  it("queues visible detail chunks immediately when centering on a tile", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    getMapChunkMock.mockReturnValue(new Promise(() => undefined));
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        centerOnTile: (tileX: number, tileY: number, options?: { scale?: number }) => boolean;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();
    getMapChunkMock.mockClear();

    act(() => {
      expect(api!.centerOnTile(512, 512, { scale: 5 })).toBe(true);
    });

    expect(getMapChunkMock).toHaveBeenCalled();
  });

  it("queues visible detail chunks immediately when jumping to a tile", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    getMapChunkMock.mockReturnValue(new Promise(() => undefined));
    const store = seedMapStore();
    const user = userEvent.setup();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    getMapChunkMock.mockClear();

    await user.type(screen.getByLabelText("Jump to x"), "512");
    await user.type(screen.getByLabelText("Jump to y"), "512");
    await user.click(screen.getByRole("button", { name: "Go to tile" }));

    expect(getMapChunkMock).toHaveBeenCalled();
  });

  it("zooms directly to native texture detail from the toolbar", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    getMapChunkMock.mockReturnValue(new Promise(() => undefined));
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    getMapChunkMock.mockClear();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Zoom to native texture detail" }));
    });

    expect(getMapChunkMock).toHaveBeenCalledWith(
      "project-1",
      "garner",
      expect.objectContaining({
        layer: "texture_base",
        zoom_bucket: 6,
        chunk_size: 16,
        source_guard: manifest.source,
      }),
    );
    expect(screen.getByTestId("map-detail-status"))
      .toHaveTextContent("Client texture 64 px/tile");
  });

  it("re-requests texture detail chunks at higher resolution after zooming in", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    getMapChunkMock.mockImplementation(
      async (_projectId: string, _mapName: string, args: { chunk_x: number; chunk_y: number; layer: string; zoom_bucket: number; chunk_size?: number }) => ({
        chunk_x: args.chunk_x,
        chunk_y: args.chunk_y,
        layer: args.layer,
        tile_x: args.chunk_x * (args.chunk_size ?? 128),
        tile_y: args.chunk_y * (args.chunk_size ?? 128),
        tile_width: args.chunk_size ?? 128,
        tile_height: args.chunk_size ?? 128,
        sample_width: args.chunk_size ?? 128,
        sample_height: args.chunk_size ?? 128,
        image_data_uri: `data:image/png;base64,chunk-${args.zoom_bucket}-${args.chunk_size ?? 128}-${args.chunk_x}-${args.chunk_y}`,
        numeric_format: null,
        numeric_payload: null,
      }),
    );
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        centerOnTile: (tileX: number, tileY: number, options?: { scale?: number }) => boolean;
        waitForIdle: (timeoutMs?: number) => Promise<boolean>;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    act(() => {
      expect(api!.centerOnTile(512, 512, { scale: 0.5 })).toBe(true);
    });
    await waitFor(() => expect(getMapChunkMock).toHaveBeenCalled());
    await expect(api!.waitForIdle(1000)).resolves.toBe(true);

    expect(getMapChunkMock.mock.calls.some((call) => call[2].zoom_bucket === 0)).toBe(true);
    const lowResolutionRequestCount = getMapChunkMock.mock.calls.length;

    act(() => {
      expect(api!.centerOnTile(512, 512, { scale: 5 })).toBe(true);
    });

    await waitFor(() =>
      expect(getMapChunkMock.mock.calls.length).toBeGreaterThan(lowResolutionRequestCount)
    );
    expect(
      getMapChunkMock.mock.calls
        .slice(lowResolutionRequestCount)
        .some((call) => call[2].zoom_bucket === 3),
    ).toBe(true);
    expect(screen.getByTestId("map-detail-status")).toHaveTextContent("Client texture 8 px/tile");

    const midResolutionRequestCount = getMapChunkMock.mock.calls.length;
    act(() => {
      expect(api!.centerOnTile(512, 512, { scale: 8 })).toBe(true);
    });

    await waitFor(() =>
      expect(getMapChunkMock.mock.calls.length).toBeGreaterThan(midResolutionRequestCount)
    );
    expect(
      getMapChunkMock.mock.calls
        .slice(midResolutionRequestCount)
        .some((call) => call[2].zoom_bucket === 4 && call[2].chunk_size === 64),
    ).toBe(true);
    expect(screen.getByTestId("map-detail-status")).toHaveTextContent("Client texture 16 px/tile");

    const highResolutionRequestCount = getMapChunkMock.mock.calls.length;
    act(() => {
      expect(api!.centerOnTile(512, 512, { scale: 16 })).toBe(true);
    });

    await waitFor(() =>
      expect(getMapChunkMock.mock.calls.length).toBeGreaterThan(highResolutionRequestCount)
    );
    expect(
      getMapChunkMock.mock.calls
        .slice(highResolutionRequestCount)
        .some((call) => call[2].zoom_bucket === 5 && call[2].chunk_size === 32),
    ).toBe(true);
    expect(screen.getByTestId("map-detail-status")).toHaveTextContent("Client texture 32 px/tile");

    const sharperResolutionRequestCount = getMapChunkMock.mock.calls.length;
    act(() => {
      expect(api!.centerOnTile(512, 512, { scale: 32 })).toBe(true);
    });

    await waitFor(() =>
      expect(getMapChunkMock.mock.calls.length).toBeGreaterThan(sharperResolutionRequestCount)
    );
    expect(
      getMapChunkMock.mock.calls
        .slice(sharperResolutionRequestCount)
        .some((call) => call[2].zoom_bucket === 6 && call[2].chunk_size === 16),
    ).toBe(true);
    expect(api!.getState().cache.maxDetailChunks).toBe(96);
    expect(screen.getByTestId("map-detail-status")).toHaveTextContent("Client texture 64 px/tile");
  });

  it("loads raw terrain texture as a high-detail primary layer", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    getMapOverviewMock.mockImplementation(
      async (_projectId: string, _mapName: string, layer: string) => ({
        layer,
        map_width: 4096,
        map_height: 4096,
        sample_width: 256,
        sample_height: 256,
        image_data_uri: `data:image/png;base64,overview-${layer}`,
      }),
    );
    getMapChunkMock.mockImplementation(
      async (_projectId: string, _mapName: string, args: { chunk_x: number; chunk_y: number; layer: string; zoom_bucket: number }) => ({
        chunk_x: args.chunk_x,
        chunk_y: args.chunk_y,
        layer: args.layer,
        tile_x: args.chunk_x * 128,
        tile_y: args.chunk_y * 128,
        tile_width: 128,
        tile_height: 128,
        sample_width: 2048,
        sample_height: 2048,
        image_data_uri: `data:image/png;base64,chunk-${args.layer}-${args.zoom_bucket}-${args.chunk_x}-${args.chunk_y}`,
        numeric_format: null,
        numeric_payload: null,
      }),
    );
    const store = seedMapStore();
    const user = userEvent.setup();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("combobox", { name: "Primary map layer" }));
    expect(screen.getByRole("option", { name: "Client texture" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Raw texture" })).toBeInTheDocument();
    await user.keyboard("{Escape}");

    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        setLayer: (layer: string) => boolean;
        centerOnTile: (tileX: number, tileY: number, options?: { scale?: number }) => boolean;
        getState: () => {
          activeRasterLayers: string[];
          cache: { maxDetailChunks: number };
        };
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    act(() => {
      expect(api!.setLayer("texture_raw")).toBe(true);
    });

    await waitFor(() =>
      expect(getMapOverviewMock).toHaveBeenCalledWith(
        "project-1",
        "garner",
        "texture_raw",
        manifest.recommended_overview_max_size,
      )
    );
    expect(screen.getByTestId("map-layer-legend")).toHaveTextContent("Raw texture");
    expect(screen.getByTestId("map-layer-legend")).toHaveTextContent("Real terrain, no tint");

    act(() => {
      expect(api!.centerOnTile(512, 512, { scale: 12 })).toBe(true);
    });

    await waitFor(() =>
      expect(
        getMapChunkMock.mock.calls.some((call) =>
          call[2].layer === "texture_raw" && call[2].zoom_bucket === 4
        ),
      ).toBe(true)
    );
    expect(api!.getState().activeRasterLayers).toEqual(["texture_raw"]);
    expect(api!.getState().cache.maxDetailChunks).toBe(96);
    expect(screen.getByTestId("map-detail-status")).toHaveTextContent("Raw texture 16 px/tile");
  });

  it("clears transient detail loads when zooming back out of detail range", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    getMapChunkMock.mockImplementation(
      async () => new Promise(() => undefined),
    );
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        centerOnTile: (tileX: number, tileY: number, options?: { scale?: number }) => boolean;
        zoomAtCenter: (direction: number) => boolean;
        getState: () => { loading: { chunks: number }; transform: { scale: number } };
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    act(() => {
      expect(api!.centerOnTile(2048, 2048, { scale: 0.22 })).toBe(true);
    });
    getMapChunkMock.mockClear();

    act(() => {
      expect(api!.zoomAtCenter(1)).toBe(true);
    });

    expect(getMapChunkMock).toHaveBeenCalled();
    expect(api!.getState().loading.chunks).toBeGreaterThan(0);

    act(() => {
      expect(api!.zoomAtCenter(-6)).toBe(true);
      expect(api!.getState().transform.scale).toBeLessThan(0.25);
      expect(api!.getState().loading.chunks).toBe(0);
    });
  });

  it("supports keyboard canvas navigation and layer toggles", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        getTransform: () => { offsetX: number; offsetY: number; scale: number };
        getState: () => { showGrid: boolean; showPlacements: boolean };
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    const canvas = document.querySelector("canvas");
    if (!canvas) {
      throw new Error("Expected workbench canvas");
    }

    expect(canvas).toHaveAttribute("tabindex", "0");
    const initialTransform = api!.getTransform();

    fireEvent.keyDown(canvas, { key: "ArrowRight" });
    await waitFor(() =>
      expect(api!.getTransform().offsetX).toBeCloseTo(initialTransform.offsetX - 64)
    );

    fireEvent.keyDown(canvas, { key: "ArrowDown" });
    await waitFor(() =>
      expect(api!.getTransform().offsetY).toBeCloseTo(initialTransform.offsetY - 64)
    );

    const pannedTransform = api!.getTransform();
    fireEvent.keyDown(canvas, { key: "=" });
    await waitFor(() => expect(api!.getTransform().scale).toBeGreaterThan(pannedTransform.scale));

    fireEvent.keyDown(canvas, { key: "g" });
    await waitFor(() => expect(api!.getState().showGrid).toBe(true));

    fireEvent.keyDown(canvas, { key: "o" });
    await waitFor(() => expect(api!.getState().showPlacements).toBe(true));

    fireEvent.keyDown(canvas, { key: "f" });
    await waitFor(() => expect(api!.getTransform().scale).toBeCloseTo(initialTransform.scale));
  });

  it("steps between adjacent inspected tiles from the tile inspector", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockImplementation(
      async (_projectId: string, _mapName: string, tileX: number, tileY: number) => ({
        ...inspectedTile,
        tile_x: tileX,
        tile_y: tileY,
      }),
    );
    const store = seedMapStore();
    const user = userEvent.setup();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    const api = window.__PKO_TOOLS_MAP_WORKBENCH__;
    if (!api) {
      throw new Error("Expected map workbench automation API");
    }

    await act(async () => {
      await expect(api.selectTile(32, 48)).resolves.toBe(true);
    });
    await screen.findByText("32, 48");

    await user.click(screen.getByRole("button", { name: "Inspect east tile" }));
    await waitFor(() => expect(countInspectMapTileCalls(33, 48)).toBeGreaterThan(0));
    expect(await screen.findByText("33, 48")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Inspect south tile" }));
    await waitFor(() => expect(countInspectMapTileCalls(33, 49)).toBeGreaterThan(0));
    expect(await screen.findByText("33, 49")).toBeInTheDocument();
  });

  it("disables adjacent tile inspection at map edges", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockImplementation(
      async (_projectId: string, _mapName: string, tileX: number, tileY: number) => ({
        ...inspectedTile,
        tile_x: tileX,
        tile_y: tileY,
      }),
    );
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    const api = window.__PKO_TOOLS_MAP_WORKBENCH__;
    if (!api) {
      throw new Error("Expected map workbench automation API");
    }

    await act(async () => {
      await expect(api.selectTile(0, 0)).resolves.toBe(true);
    });
    await screen.findByText("0, 0");

    expect(screen.getByRole("button", { name: "Inspect north tile" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Inspect west tile" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Inspect east tile" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Inspect south tile" })).toBeEnabled();

    await act(async () => {
      await expect(api.selectTile(4095, 4095)).resolves.toBe(true);
    });
    await screen.findByText("4095, 4095");

    expect(screen.getByRole("button", { name: "Inspect north tile" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Inspect west tile" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Inspect east tile" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Inspect south tile" })).toBeDisabled();
  });

  it("makes canvas interaction modes explicit and keeps pan clicks from inspecting tiles", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockResolvedValue(inspectedTile);
    const store = seedMapStore();

    const { container } = render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));

    expect(screen.getByRole("toolbar", { name: "Canvas interaction mode" }))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select tiles" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Pan map" }))
      .toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Paint tiles" }))
      .toBeDisabled();

    const canvas = container.querySelector("canvas");
    if (!canvas) {
      throw new Error("Expected workbench canvas");
    }
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 820,
        bottom: 300,
        width: 820,
        height: 300,
        toJSON: () => ({}),
      }),
    });

    fireEvent.click(screen.getByRole("button", { name: "Pan map" }));

    expect(screen.getByRole("button", { name: "Pan map" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(canvas).toHaveClass("cursor-grab");

    dispatchCanvasPointerEvent(canvas, "pointerdown", {
      button: 0,
      buttons: 1,
      clientX: 410,
      clientY: 150,
      pointerId: 1,
    });
    dispatchCanvasPointerEvent(canvas, "pointerup", {
      button: 0,
      clientX: 410,
      clientY: 150,
      pointerId: 1,
    });

    expect(inspectMapTileMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Select tiles" }));
    expect(screen.getByRole("button", { name: "Select tiles" }))
      .toHaveAttribute("aria-pressed", "true");

    dispatchCanvasPointerEvent(canvas, "pointerdown", {
      button: 0,
      buttons: 1,
      clientX: 410,
      clientY: 150,
      pointerId: 2,
    });
    dispatchCanvasPointerEvent(canvas, "pointerup", {
      button: 0,
      clientX: 410,
      clientY: 150,
      pointerId: 2,
    });

    await waitFor(() =>
      expect(inspectMapTileMock).toHaveBeenCalledWith("project-1", "garner", 2048, 2048, expect.any(Object))
    );
  });

  it("frames selected placements through the dev-only automation API", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    const store = seedMapStore();
    const onSelectPlacement = vi.fn();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench
            selectedPlacement={selectedPlacement}
            onSelectPlacement={onSelectPlacement}
          />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));

    const canvas = screen.getByLabelText("Map editor canvas");
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 10,
        y: 20,
        top: 20,
        left: 10,
        right: 830,
        bottom: 320,
        width: 820,
        height: 300,
        toJSON: () => ({}),
      }),
    });

    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        getState: () => {
          selectedPlacement: MapPlacementRecord | null;
          transform: { offsetX: number; offsetY: number; scale: number };
        };
        centerOnPlacement: (index: number, options?: { scale?: number }) => boolean;
        selectPlacement: (index: number, options?: { scale?: number }) => boolean;
        screenToTile: (screenX: number, screenY: number) => { x: number; y: number };
        getPlacementScreenPoint: (
          index: number,
        ) => {
          index: number;
          worldX: number;
          worldY: number;
          x: number;
          y: number;
        } | null;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();
    expect(api!.getState().selectedPlacement?.index).toBe(12);

    act(() => {
      expect(api!.centerOnPlacement(12, { scale: 7 })).toBe(true);
    });
    await waitFor(() => expect(api!.getState().transform.scale).toBe(7));
    const centeredPlacement = api!.screenToTile(420, 170);
    expect(centeredPlacement.x).toBeCloseTo(selectedPlacement.world_x);
    expect(centeredPlacement.y).toBeCloseTo(selectedPlacement.world_y);
    const placementPoint = api!.getPlacementScreenPoint(12);
    expect(placementPoint).toEqual(expect.objectContaining({
      index: 12,
      worldX: selectedPlacement.world_x,
      worldY: selectedPlacement.world_y,
    }));
    expect(placementPoint?.x).toBeCloseTo(420);
    expect(placementPoint?.y).toBeCloseTo(170);
    expect(api!.getPlacementScreenPoint(999)).toBeNull();
    act(() => {
      expect(api!.centerOnPlacement(12, { scale: 8 })).toBe(true);
    });
    const immediatePlacementPoint = api!.getPlacementScreenPoint(12);
    expect(immediatePlacementPoint?.x).toBeCloseTo(420);
    expect(immediatePlacementPoint?.y).toBeCloseTo(170);
    expect(api!.getState().transform.scale).toBe(8);

    const transformBeforeInvalidCenter = api!.getState().transform;
    expect(api!.centerOnPlacement(999, { scale: 4 })).toBe(false);
    expect(api!.getState().transform).toEqual(transformBeforeInvalidCenter);

    act(() => {
      expect(api!.selectPlacement(12, { scale: 6 })).toBe(true);
    });
    expect(onSelectPlacement).toHaveBeenLastCalledWith(selectedPlacement);
    await waitFor(() => expect(api!.getState().transform.scale).toBe(6));
    expect(api!.selectPlacement(999, { scale: 3 })).toBe(false);
  });

  it("frames placement focus requests without relying on canvas coordinates", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockImplementation(
      async (_projectId: string, _mapName: string, tileX: number, tileY: number) => ({
        ...inspectedTile,
        tile_x: tileX,
        tile_y: tileY,
      }),
    );
    const store = seedMapStore();

    const { rerender } = render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench
            selectedPlacement={selectedPlacement}
            onSelectPlacement={() => undefined}
            placementFocusRequest={null}
          />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        getState: () => {
          transform: { scale: number };
        };
        screenToTile: (screenX: number, screenY: number) => { x: number; y: number };
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    rerender(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench
            selectedPlacement={selectedPlacement}
            onSelectPlacement={() => undefined}
            placementFocusRequest={{ placement: selectedPlacement, nonce: 1 }}
          />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(api!.getState().transform.scale).toBeGreaterThanOrEqual(4));
    const centeredPlacement = api!.screenToTile(410, 150);
    expect(centeredPlacement.x).toBeCloseTo(selectedPlacement.world_x);
    expect(centeredPlacement.y).toBeCloseTo(selectedPlacement.world_y);
    await waitFor(() =>
      expect(inspectMapTileMock).toHaveBeenCalledWith(
        "project-1",
        "garner",
        Math.floor(selectedPlacement.world_x),
        Math.floor(selectedPlacement.world_y),
        expect.any(Object),
      )
    );
  });

  it("publishes bounds for the unobscured editor area when the right edge is reserved", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    const store = seedMapStore();
    const onViewportBoundsChange = vi.fn();

    const { container } = render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench
            selectedPlacement={null}
            onSelectPlacement={() => undefined}
            onViewportBoundsChange={onViewportBoundsChange}
            rightOverlayInset={364}
          />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        getState: () => { transform: { scale: number } };
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    const canvas = container.querySelector("canvas");
    if (!canvas) {
      throw new Error("Expected workbench canvas");
    }
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 820,
        bottom: 300,
        width: 820,
        height: 300,
        toJSON: () => ({}),
      }),
    });

    onViewportBoundsChange.mockClear();
    for (let index = 0; index < 5; index += 1) {
      fireEvent.wheel(canvas, {
        deltaY: -100,
        clientX: (820 - 364) / 2,
        clientY: 150,
      });
    }

    await waitFor(() => expect(onViewportBoundsChange).toHaveBeenCalled());
    const lastCall = onViewportBoundsChange.mock.calls.at(-1);
    expect(lastCall?.[0]).toEqual(expect.objectContaining({ maxX: expect.any(Number) }));
    const visibleTileSpan = lastCall![0].maxX - lastCall![0].minX;
    const scale = api!.getState().transform.scale;
    expect(visibleTileSpan).toBeLessThanOrEqual(((820 - 364) / scale) + 1);
    expect(visibleTileSpan).toBeLessThan((820 / scale) - 1);
  });

  it("does not cover the map with an empty tile inspector before selection", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockResolvedValue(inspectedTile);
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapWorkbenchManifestMock).toHaveBeenCalledTimes(1));

    expect(screen.queryByText("No tile selected")).not.toBeInTheDocument();
  });

  it("shows clicked tile coordinates immediately while full inspection data loads", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    let resolveInspection: ((value: MapTileInspection) => void) | null = null;
    inspectMapTileMock.mockImplementation(
      () => new Promise<MapTileInspection>((resolve) => {
        resolveInspection = resolve;
      }),
    );
    const store = seedMapStore();
    const onSelectedTileChange = vi.fn();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench
            selectedPlacement={null}
            onSelectPlacement={() => undefined}
            onSelectedTileChange={onSelectedTileChange}
          />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapWorkbenchManifestMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        inspectTile: (tileX: number, tileY: number) => Promise<boolean>;
        getSelectedTile: () => { x: number; y: number } | null;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    let inspectPromise: Promise<boolean> | null = null;
    act(() => {
      inspectPromise = api!.inspectTile(321, 654);
    });

    await waitFor(() => {
      const summary = screen.getByTestId("map-tile-loading-summary");
      expect(summary).toHaveTextContent("321, 654");
      expect(summary).toHaveTextContent("40, 81");
      expect(summary).toHaveTextContent("1, 6");
      expect(summary).toHaveTextContent("2, 5");
    });
    expect(api!.getSelectedTile()).toEqual({ x: 321, y: 654 });
    expect(onSelectedTileChange).toHaveBeenCalledWith({ x: 321, y: 654 });

    await act(async () => {
      resolveInspection?.({
        ...inspectedTile,
        tile_x: 321,
        tile_y: 654,
        section_x: 40,
        section_y: 81,
        local_x: 1,
        local_y: 6,
      });
      await inspectPromise;
    });

    await screen.findByTestId("map-texture-slots");
  });

  it("keeps the previous tile details visible while a new tile inspection loads", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    let resolveNextInspection: ((value: MapTileInspection) => void) | null = null;
    inspectMapTileMock.mockImplementation(
      (_projectId: string, _mapName: string, tileX: number, tileY: number) => {
        if (tileX === 40 && tileY === 48) {
          return new Promise<MapTileInspection>((resolve) => {
            resolveNextInspection = resolve;
          });
        }

        return Promise.resolve({
          ...inspectedTile,
          tile_x: tileX,
          tile_y: tileY,
          section_x: Math.floor(tileX / 8),
          section_y: Math.floor(tileY / 8),
          local_x: tileX % 8,
          local_y: tileY % 8,
        });
      },
    );
    const resolvePlacementQueries: Array<(value: { items: MapPlacementRecord[] }) => void> = [];
    queryMapPlacementsInBoundsMock.mockImplementation(
      () => new Promise((resolve) => {
        resolvePlacementQueries.push(resolve);
      }),
    );
    const nearbyPlacement: MapPlacementRecord = {
      ...selectedPlacement,
      index: 42,
      world_x: 32.25,
      world_y: 48.25,
      display_name: "Tile-side crate",
    };
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench
            selectedPlacement={selectedPlacement}
            onSelectPlacement={() => undefined}
          />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapWorkbenchManifestMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        inspectTile: (tileX: number, tileY: number) => Promise<boolean>;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    await act(async () => {
      await api!.inspectTile(32, 48);
    });
    await screen.findByTestId("map-texture-slots");
    expect(resolvePlacementQueries.length).toBeGreaterThan(0);
    await act(async () => {
      for (const resolve of resolvePlacementQueries) {
        resolve({ items: [nearbyPlacement] });
      }
    });
    expect(await screen.findByText("Tile-side crate")).toBeInTheDocument();
    expect(await screen.findByText("Selected placement")).toBeInTheDocument();

    let nextInspect: Promise<boolean> | null = null;
    act(() => {
      nextInspect = api!.inspectTile(40, 48);
    });

    await waitFor(() => {
      expect(screen.getByTestId("map-inspector-scroll")).toHaveTextContent("32, 48");
      expect(screen.getByTestId("map-pending-tile-inspection")).toHaveTextContent(
        "Loading tile 40, 48",
      );
      expect(screen.getByTestId("map-pending-tile-inspection")).toHaveTextContent(
        "showing tile 32, 48",
      );
    });
    expect(screen.queryByTestId("map-tile-loading-summary")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tile-edit-actions")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Inspect north tile" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add placement at selected tile" }))
      .not.toBeInTheDocument();
    expect(screen.queryByText("Tile-side crate")).not.toBeInTheDocument();
    expect(screen.queryByText("Selected placement")).not.toBeInTheDocument();

    await act(async () => {
      resolveNextInspection?.({
        ...inspectedTile,
        tile_x: 40,
        tile_y: 48,
        section_x: 5,
        section_y: 6,
        local_x: 0,
        local_y: 0,
      });
      await nextInspect;
    });

    expect(screen.getByTestId("map-inspector-scroll")).toHaveTextContent("40, 48");
    expect(screen.queryByTestId("map-pending-tile-inspection")).not.toBeInTheDocument();
    expect(screen.getByTestId("tile-edit-actions")).toBeInTheDocument();
  });

  it("reuses cached tile inspection data immediately when reselecting a hydrated tile", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockResolvedValue(inspectedTile);
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapWorkbenchManifestMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        inspectTile: (tileX: number, tileY: number) => Promise<boolean>;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    await act(async () => {
      await api!.inspectTile(32, 48);
    });
    await screen.findByTestId("map-texture-slots");

    inspectMapTileMock.mockClear();
    inspectMapTileMock.mockImplementation(() => new Promise(() => undefined));

    await act(async () => {
      const cachedResult = api!.inspectTile(32, 48);
      expect(countInspectMapTileCalls(32, 48)).toBe(0);
      await expect(cachedResult).resolves.toBe(true);
    });

    expect(screen.queryByTestId("map-tile-loading-summary")).not.toBeInTheDocument();
    expect(screen.getByTestId("map-texture-slots")).toBeInTheDocument();
    expect(screen.getByTestId("map-inspector-scroll")).toHaveTextContent("32, 48");
  });

  it("prefetches nearby tile inspections so local tile selection is instant", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockImplementation(
      async (_projectId: string, _mapName: string, tileX: number, tileY: number) => ({
        ...inspectedTile,
        tile_x: tileX,
        tile_y: tileY,
        section_x: Math.floor(tileX / 8),
        section_y: Math.floor(tileY / 8),
        local_x: tileX % 8,
        local_y: tileY % 8,
      }),
    );
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapWorkbenchManifestMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        inspectTile: (tileX: number, tileY: number) => Promise<boolean>;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    await act(async () => {
      await api!.inspectTile(32, 48);
    });
    await waitFor(() =>
      expect(inspectMapTileMock).toHaveBeenCalledWith("project-1", "garner", 33, 48, expect.any(Object))
    );
    await waitFor(() =>
      expect(inspectMapTileMock).toHaveBeenCalledWith("project-1", "garner", 33, 49, expect.any(Object))
    );
    await waitFor(() => expect(inspectMapTileMock).toHaveBeenCalledTimes(9));

    inspectMapTileMock.mockClear();
    inspectMapTileMock.mockImplementation(() => new Promise(() => undefined));

    await act(async () => {
      const cachedResult = api!.inspectTile(33, 49);
      expect(inspectMapTileMock).not.toHaveBeenCalledWith("project-1", "garner", 33, 49, expect.any(Object));
      await expect(cachedResult).resolves.toBe(true);
    });

    expect(screen.queryByTestId("map-tile-loading-summary")).not.toBeInTheDocument();
    expect(screen.getByTestId("map-inspector-scroll")).toHaveTextContent("33, 49");
  });

  it("prefetches the hovered tile at inspection zoom so tile clicks feel instant", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockImplementation(
      async (_projectId: string, _mapName: string, tileX: number, tileY: number) => ({
        ...inspectedTile,
        tile_x: tileX,
        tile_y: tileY,
        section_x: Math.floor(tileX / 8),
        section_y: Math.floor(tileY / 8),
        local_x: tileX % 8,
        local_y: tileY % 8,
      }),
    );
    const store = seedMapStore();

    const { container } = render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapWorkbenchManifestMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        centerOnTile: (tileX: number, tileY: number, options?: { scale?: number }) => boolean;
        getTransform: () => { scale: number };
        inspectTile: (tileX: number, tileY: number) => Promise<boolean>;
        tileToScreen: (tileX: number, tileY: number) => { x: number; y: number };
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    act(() => {
      expect(api!.centerOnTile(100, 200, { scale: 6 })).toBe(true);
    });
    await waitFor(() => expect(api!.getTransform().scale).toBe(6));

    const canvas = container.querySelector("canvas");
    if (!canvas) {
      throw new Error("Expected workbench canvas");
    }
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 820,
        bottom: 300,
        width: 820,
        height: 300,
        toJSON: () => ({}),
      }),
    });

    const hoverPoint = api!.tileToScreen(100.5, 200.5);
    dispatchCanvasPointerEvent(canvas, "pointermove", {
      button: 0,
      buttons: 0,
      clientX: hoverPoint.x,
      clientY: hoverPoint.y,
      pointerId: 1,
    });

    await waitFor(() =>
      expect(inspectMapTileMock).toHaveBeenCalledWith(
        "project-1",
        "garner",
        100,
        200,
        expect.any(Object),
      )
    );

    inspectMapTileMock.mockClear();
    inspectMapTileMock.mockImplementation(() => new Promise(() => undefined));

    await act(async () => {
      const cachedResult = api!.inspectTile(100, 200);
      expect(countInspectMapTileCalls(100, 200)).toBe(0);
      await expect(cachedResult).resolves.toBe(true);
    });

    expect(screen.queryByTestId("map-tile-loading-summary")).not.toBeInTheDocument();
    expect(screen.getByTestId("map-inspector-scroll")).toHaveTextContent("100, 200");
  });

  it("prefetches the centered tile at inspection zoom so immediate clicks feel instant", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockImplementation(
      async (_projectId: string, _mapName: string, tileX: number, tileY: number) => ({
        ...inspectedTile,
        tile_x: tileX,
        tile_y: tileY,
        section_x: Math.floor(tileX / 8),
        section_y: Math.floor(tileY / 8),
        local_x: tileX % 8,
        local_y: tileY % 8,
      }),
    );
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapWorkbenchManifestMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        centerOnTile: (tileX: number, tileY: number, options?: { scale?: number }) => boolean;
        getTransform: () => { scale: number };
        inspectTile: (tileX: number, tileY: number) => Promise<boolean>;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    act(() => {
      expect(api!.centerOnTile(100, 200, { scale: 6 })).toBe(true);
    });
    await waitFor(() => expect(api!.getTransform().scale).toBe(6));
    await waitFor(() =>
      expect(inspectMapTileMock).toHaveBeenCalledWith(
        "project-1",
        "garner",
        100,
        200,
        expect.any(Object),
      )
    );

    inspectMapTileMock.mockClear();
    inspectMapTileMock.mockImplementation(() => new Promise(() => undefined));

    await act(async () => {
      const cachedResult = api!.inspectTile(100, 200);
      expect(countInspectMapTileCalls(100, 200)).toBe(0);
      await expect(cachedResult).resolves.toBe(true);
    });

    expect(screen.queryByTestId("map-tile-loading-summary")).not.toBeInTheDocument();
    expect(screen.getByTestId("map-inspector-scroll")).toHaveTextContent("100, 200");
  });

  it("does not prefetch hovered tiles before inspection zoom", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockResolvedValue(inspectedTile);
    const store = seedMapStore();

    const { container } = render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapWorkbenchManifestMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        centerOnTile: (tileX: number, tileY: number, options?: { scale?: number }) => boolean;
        getTransform: () => { scale: number };
        tileToScreen: (tileX: number, tileY: number) => { x: number; y: number };
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    act(() => {
      expect(api!.centerOnTile(100, 200, { scale: 2 })).toBe(true);
    });
    await waitFor(() => expect(api!.getTransform().scale).toBe(2));

    const canvas = container.querySelector("canvas");
    if (!canvas) {
      throw new Error("Expected workbench canvas");
    }
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 820,
        bottom: 300,
        width: 820,
        height: 300,
        toJSON: () => ({}),
      }),
    });

    const hoverPoint = api!.tileToScreen(100.5, 200.5);
    dispatchCanvasPointerEvent(canvas, "pointermove", {
      button: 0,
      buttons: 0,
      clientX: hoverPoint.x,
      clientY: hoverPoint.y,
      pointerId: 1,
    });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 120));
    });

    expect(inspectMapTileMock).not.toHaveBeenCalled();
  });

  it("cancels a pending hover prefetch when the cursor moves onto an in-flight tile", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    let resolveInFlightInspection: ((value: MapTileInspection) => void) | null = null;
    inspectMapTileMock.mockImplementation(
      async (_projectId: string, _mapName: string, tileX: number, tileY: number) => {
        if (tileX === 101 && tileY === 200) {
          return new Promise<MapTileInspection>((resolve) => {
            resolveInFlightInspection = resolve;
          });
        }

        return {
          ...inspectedTile,
          tile_x: tileX,
          tile_y: tileY,
          section_x: Math.floor(tileX / 8),
          section_y: Math.floor(tileY / 8),
          local_x: tileX % 8,
          local_y: tileY % 8,
        };
      },
    );
    const store = seedMapStore();

    const { container } = render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapWorkbenchManifestMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        centerOnTile: (tileX: number, tileY: number, options?: { scale?: number }) => boolean;
        getTransform: () => { scale: number };
        inspectTile: (tileX: number, tileY: number) => Promise<boolean>;
        tileToScreen: (tileX: number, tileY: number) => { x: number; y: number };
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    act(() => {
      expect(api!.centerOnTile(100, 200, { scale: 6 })).toBe(true);
    });
    await waitFor(() => expect(api!.getTransform().scale).toBe(6));

    const canvas = container.querySelector("canvas");
    if (!canvas) {
      throw new Error("Expected workbench canvas");
    }
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 820,
        bottom: 300,
        width: 820,
        height: 300,
        toJSON: () => ({}),
      }),
    });

    act(() => {
      void api!.inspectTile(101, 200);
    });
    await waitFor(() =>
      expect(inspectMapTileMock).toHaveBeenCalledWith(
        "project-1",
        "garner",
        101,
        200,
        expect.any(Object),
      )
    );
    inspectMapTileMock.mockClear();

    const firstHoverPoint = api!.tileToScreen(100.5, 200.5);
    dispatchCanvasPointerEvent(canvas, "pointermove", {
      button: 0,
      buttons: 0,
      clientX: firstHoverPoint.x,
      clientY: firstHoverPoint.y,
      pointerId: 1,
    });
    const secondHoverPoint = api!.tileToScreen(101.5, 200.5);
    dispatchCanvasPointerEvent(canvas, "pointermove", {
      button: 0,
      buttons: 0,
      clientX: secondHoverPoint.x,
      clientY: secondHoverPoint.y,
      pointerId: 1,
    });

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 120));
    });

    expect(inspectMapTileMock).not.toHaveBeenCalled();

    await act(async () => {
      resolveInFlightInspection?.({
        ...inspectedTile,
        tile_x: 101,
        tile_y: 200,
        section_x: 12,
        section_y: 25,
        local_x: 5,
        local_y: 0,
      });
      await Promise.resolve();
    });
  });

  it("cancels a pending hover prefetch when zoom leaves inspection scale before debounce", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockResolvedValue(inspectedTile);
    const store = seedMapStore();

    const { container } = render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapWorkbenchManifestMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        centerOnTile: (tileX: number, tileY: number, options?: { scale?: number }) => boolean;
        getTransform: () => { scale: number };
        tileToScreen: (tileX: number, tileY: number) => { x: number; y: number };
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    act(() => {
      expect(api!.centerOnTile(100, 200, { scale: 6 })).toBe(true);
    });
    await waitFor(() => expect(api!.getTransform().scale).toBe(6));

    const canvas = container.querySelector("canvas");
    if (!canvas) {
      throw new Error("Expected workbench canvas");
    }
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 820,
        bottom: 300,
        width: 820,
        height: 300,
        toJSON: () => ({}),
      }),
    });

    const hoverPoint = api!.tileToScreen(100.5, 200.5);
    dispatchCanvasPointerEvent(canvas, "pointermove", {
      button: 0,
      buttons: 0,
      clientX: hoverPoint.x,
      clientY: hoverPoint.y,
      pointerId: 1,
    });
    act(() => {
      expect(api!.centerOnTile(100, 200, { scale: 2 })).toBe(true);
    });
    await waitFor(() => expect(api!.getTransform().scale).toBe(2));

    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 120));
    });

    expect(inspectMapTileMock).not.toHaveBeenCalled();
  });

  it("drops pending adjacent tile prefetches after leaving and returning to the same map", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    let stalePrefetchStarted = false;
    let resolveStalePrefetch: ((value: MapTileInspection) => void) | null = null;
    inspectMapTileMock.mockImplementation(
      (_projectId: string, mapName: string, tileX: number, tileY: number) => {
        if (mapName === "garner" && tileX === 33 && tileY === 48 && !stalePrefetchStarted) {
          stalePrefetchStarted = true;
          return new Promise<MapTileInspection>((resolve) => {
            resolveStalePrefetch = resolve;
          });
        }

        const height = mapName === "garner" && tileX === 33 && tileY === 48 ? 12 : 10;
        return Promise.resolve({
          ...inspectedTile,
          tile_x: tileX,
          tile_y: tileY,
          section_x: Math.floor(tileX / 8),
          section_y: Math.floor(tileY / 8),
          local_x: tileX % 8,
          local_y: tileY % 8,
          native: {
            ...inspectedTile.native,
            c_height: height,
          },
          terrain_height: height / 10,
        });
      },
    );
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapWorkbenchManifestMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        inspectTile: (tileX: number, tileY: number) => Promise<boolean>;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    await act(async () => {
      await api!.inspectTile(32, 48);
    });
    await waitFor(() => expect(countInspectMapTileCalls(33, 48)).toBe(1));
    expect(resolveStalePrefetch).not.toBeNull();

    await act(async () => {
      store.set(selectedMapAtom, {
        name: "garner2",
        display_name: "Garner 2",
        map_file: "garner2.map",
        has_obj: true,
        has_rbo: false,
        width: 4096,
        height: 4096,
      });
    });
    await waitFor(() => expect(getMapWorkbenchManifestMock).toHaveBeenCalledTimes(2));

    await act(async () => {
      store.set(selectedMapAtom, {
        name: "garner",
        display_name: "Garner",
        map_file: "garner.map",
        has_obj: true,
        has_rbo: false,
        width: 4096,
        height: 4096,
      });
    });
    await waitFor(() => expect(getMapWorkbenchManifestMock).toHaveBeenCalledTimes(3));

    await act(async () => {
      resolveStalePrefetch?.({
        ...inspectedTile,
        tile_x: 33,
        tile_y: 48,
        section_x: 4,
        section_y: 6,
        local_x: 1,
        local_y: 0,
        native: {
          ...inspectedTile.native,
          c_height: 77,
        },
        terrain_height: 7.7,
      });
    });

    const nextApi = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        inspectTile: (tileX: number, tileY: number) => Promise<boolean>;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(nextApi).toBeDefined();

    await act(async () => {
      await expect(nextApi!.inspectTile(33, 48)).resolves.toBe(true);
    });

    expect(countInspectMapTileCalls(33, 48)).toBe(2);
    expect(screen.getByLabelText("Height")).toHaveValue(12);
  });

  it("deduplicates repeated tile inspections while the first request is still pending", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    let resolveInspection: ((value: MapTileInspection) => void) | null = null;
    inspectMapTileMock.mockImplementation(
      () => new Promise<MapTileInspection>((resolve) => {
        resolveInspection = resolve;
      }),
    );
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapWorkbenchManifestMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        inspectTile: (tileX: number, tileY: number) => Promise<boolean>;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    let firstInspect: Promise<boolean> | null = null;
    let secondInspect: Promise<boolean> | null = null;
    act(() => {
      firstInspect = api!.inspectTile(32, 48);
      secondInspect = api!.inspectTile(32, 48);
    });

    expect(inspectMapTileMock).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.getByTestId("map-tile-loading-summary")).toHaveTextContent("32, 48")
    );

    await act(async () => {
      resolveInspection?.(inspectedTile);
      await expect(Promise.all([firstInspect, secondInspect])).resolves.toEqual([true, true]);
    });

    await screen.findByTestId("map-texture-slots");
    expect(screen.getByTestId("map-inspector-scroll")).toHaveTextContent("32, 48");
  });

  it("keeps exact nearby placement hydration alive when reselecting a cached tile", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockResolvedValue({
      ...inspectedTile,
      nearby_placements: [],
    });
    const resolvePlacementQueries: Array<(value: { items: MapPlacementRecord[] }) => void> = [];
    queryMapPlacementsInBoundsMock.mockImplementation(
      () => new Promise((resolve) => {
        resolvePlacementQueries.push(resolve);
      }),
    );
    const nearbyPlacement: MapPlacementRecord = {
      ...selectedPlacement,
      index: 42,
      world_x: 32.25,
      world_y: 48.25,
      display_name: "Tile-side crate",
    };
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapWorkbenchManifestMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        inspectTile: (tileX: number, tileY: number) => Promise<boolean>;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    await act(async () => {
      await api!.inspectTile(32, 48);
    });
    expect(screen.queryByText("Tile-side crate")).not.toBeInTheDocument();

    inspectMapTileMock.mockClear();
    await act(async () => {
      await expect(api!.inspectTile(32, 48)).resolves.toBe(true);
    });

    expect(countInspectMapTileCalls(32, 48)).toBe(0);
    expect(resolvePlacementQueries.length).toBeGreaterThan(0);

    await act(async () => {
      for (const resolve of resolvePlacementQueries) {
        resolve({ items: [nearbyPlacement] });
      }
    });

    expect(await screen.findByText("Tile-side crate")).toBeInTheDocument();
  });

  it("shows already hydrated nearby placements immediately when returning to a cached tile", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockImplementation(
      async (_projectId, _mapName, tileX, tileY) => ({
        ...inspectedTile,
        tile_x: tileX,
        tile_y: tileY,
        local_x: tileX % 8,
        local_y: tileY % 8,
        nearby_placements: [],
      }),
    );
    const nearbyPlacement: MapPlacementRecord = {
      ...selectedPlacement,
      index: 42,
      world_x: 32.25,
      world_y: 48.25,
      display_name: "Tile-side crate",
    };
    queryMapPlacementsInBoundsMock
      .mockResolvedValueOnce({ items: [nearbyPlacement], total: 1, offset: 0, limit: 32 })
      .mockImplementation(() => new Promise(() => undefined));
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapWorkbenchManifestMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        inspectTile: (tileX: number, tileY: number) => Promise<boolean>;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    await act(async () => {
      await api!.inspectTile(32, 48);
    });
    expect(await screen.findByText("Tile-side crate")).toBeInTheDocument();

    await act(async () => {
      await api!.inspectTile(33, 48);
    });
    expect(screen.queryByText("Tile-side crate")).not.toBeInTheDocument();

    inspectMapTileMock.mockClear();
    await act(async () => {
      await expect(api!.inspectTile(32, 48)).resolves.toBe(true);
    });

    expect(countInspectMapTileCalls(32, 48)).toBe(0);
    expect(screen.getByText("Tile-side crate")).toBeInTheDocument();
  });

  it("preserves exact nearby placement results on cached tile hits", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockResolvedValue({
      ...inspectedTile,
      nearby_placements: [],
    });
    const exactPlacement: MapPlacementRecord = {
      ...selectedPlacement,
      index: 42,
      world_x: 32.25,
      world_y: 48.25,
      display_name: "Exact tile crate",
    };
    const renderedOnlyPlacement: MapPlacementRecord = {
      ...selectedPlacement,
      index: 99,
      world_x: 32.5,
      world_y: 48.5,
      display_name: "Rendered-only marker",
    };
    queryMapPlacementsInBoundsMock
      .mockResolvedValueOnce({ items: [exactPlacement], total: 1, offset: 0, limit: 32 })
      .mockImplementation(() => new Promise(() => undefined));
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench
            selectedPlacement={renderedOnlyPlacement}
            onSelectPlacement={() => undefined}
          />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapWorkbenchManifestMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        inspectTile: (tileX: number, tileY: number) => Promise<boolean>;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    await act(async () => {
      await api!.inspectTile(32, 48);
    });
    expect(await screen.findByText("Exact tile crate")).toBeInTheDocument();

    inspectMapTileMock.mockClear();
    await act(async () => {
      await expect(api!.inspectTile(32, 48)).resolves.toBe(true);
    });

    expect(countInspectMapTileCalls(32, 48)).toBe(0);
    const exactPlacementButton = screen.getByText("Exact tile crate").closest("button");
    expect(exactPlacementButton).not.toBeNull();
    expect(exactPlacementButton!.parentElement).not.toHaveTextContent("Rendered-only marker");
  });

  it("does not reuse cached tile inspections after switching maps", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockResolvedValue({
      ...inspectedTile,
      native: {
        ...inspectedTile.native,
        c_height: 10,
      },
    });
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapWorkbenchManifestMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        inspectTile: (tileX: number, tileY: number) => Promise<boolean>;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    await act(async () => {
      await api!.inspectTile(32, 48);
    });

    await act(async () => {
      store.set(selectedMapAtom, {
        name: "garner2",
        display_name: "Garner 2",
        map_file: "garner2.map",
        has_obj: true,
        has_rbo: false,
        width: 4096,
        height: 4096,
      });
    });
    await waitFor(() => expect(getMapWorkbenchManifestMock).toHaveBeenCalledTimes(2));

    inspectMapTileMock.mockClear();
    inspectMapTileMock.mockResolvedValue({
      ...inspectedTile,
      native: {
        ...inspectedTile.native,
        c_height: 22,
      },
    });
    const nextApi = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        inspectTile: (tileX: number, tileY: number) => Promise<boolean>;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(nextApi).toBeDefined();

    await act(async () => {
      await expect(nextApi!.inspectTile(32, 48)).resolves.toBe(true);
    });

    expect(inspectMapTileMock).toHaveBeenCalledWith("project-1", "garner2", 32, 48, expect.any(Object));
  });

  it("shows tile data before the nearby placement lookup finishes", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockResolvedValue({
      ...inspectedTile,
      nearby_placements: [],
    });
    let resolveNearbyPlacements: ((value: { items: MapPlacementRecord[] }) => void) | null = null;
    queryMapPlacementsInBoundsMock.mockImplementation(
      () => new Promise((resolve) => {
        resolveNearbyPlacements = resolve;
      }),
    );
    const nearbyPlacement: MapPlacementRecord = {
      ...selectedPlacement,
      index: 42,
      world_x: 32.25,
      world_y: 48.25,
      display_name: "Tile-side crate",
    };
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapWorkbenchManifestMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        inspectTile: (tileX: number, tileY: number) => Promise<boolean>;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    await act(async () => {
      await api!.inspectTile(32, 48);
    });

    expect(screen.getByTestId("map-texture-slots")).toBeInTheDocument();
    expect(queryMapPlacementsInBoundsMock).toHaveBeenCalledWith(
      "project-1",
      "garner",
      32,
      48,
      33,
      49,
      32,
    );
    expect(screen.queryByText("Tile-side crate")).not.toBeInTheDocument();

    await act(async () => {
      resolveNearbyPlacements?.({ items: [nearbyPlacement] });
    });

    expect(await screen.findByText("Tile-side crate")).toBeInTheDocument();
  });

  it("keeps tile draft edits when nearby placements hydrate", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockResolvedValue({
      ...inspectedTile,
      nearby_placements: [],
    });
    let resolveNearbyPlacements: ((value: { items: MapPlacementRecord[] }) => void) | null = null;
    queryMapPlacementsInBoundsMock.mockImplementation(
      () => new Promise((resolve) => {
        resolveNearbyPlacements = resolve;
      }),
    );
    const nearbyPlacement: MapPlacementRecord = {
      ...selectedPlacement,
      index: 42,
      world_x: 32.25,
      world_y: 48.25,
      display_name: "Tile-side crate",
    };
    const store = seedMapStore();
    const user = userEvent.setup();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapWorkbenchManifestMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        inspectTile: (tileX: number, tileY: number) => Promise<boolean>;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    await act(async () => {
      await api!.inspectTile(32, 48);
    });

    const heightInput = await screen.findByLabelText("Height");
    await user.clear(heightInput);
    await user.type(heightInput, "12");
    expect(heightInput).toHaveValue(12);

    await act(async () => {
      resolveNearbyPlacements?.({ items: [nearbyPlacement] });
    });

    expect(await screen.findByText("Tile-side crate")).toBeInTheDocument();
    expect(heightInput).toHaveValue(12);
  });

  it("does not restore a stale optimistic tile when a newer inspection fails", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    const pendingInspections = new Map<string, {
      resolve: (value: MapTileInspection) => void;
      reject: (error: Error) => void;
    }>();
    inspectMapTileMock.mockImplementation(
      async (_projectId: string, _mapName: string, tileX: number, tileY: number) =>
        new Promise<MapTileInspection>((resolve, reject) => {
          pendingInspections.set(`${tileX},${tileY}`, { resolve, reject });
        }),
    );
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapWorkbenchManifestMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        inspectTile: (tileX: number, tileY: number) => Promise<boolean>;
        getSelectedTile: () => { x: number; y: number } | null;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    let firstInspection: Promise<boolean> | null = null;
    act(() => {
      firstInspection = api!.inspectTile(32, 48);
    });
    await waitFor(() => expect(api!.getSelectedTile()).toEqual({ x: 32, y: 48 }));

    let secondInspection: Promise<boolean> | null = null;
    act(() => {
      secondInspection = api!.inspectTile(64, 80);
    });
    await waitFor(() => expect(api!.getSelectedTile()).toEqual({ x: 64, y: 80 }));

    await act(async () => {
      pendingInspections.get("64,80")?.reject(new Error("inspect failed"));
      await secondInspection;
    });
    await waitFor(() => expect(api!.getSelectedTile()).toBeNull());

    await act(async () => {
      pendingInspections.get("32,48")?.resolve({
        ...inspectedTile,
        tile_x: 32,
        tile_y: 48,
      });
      await firstInspection;
    });
    expect(api!.getSelectedTile()).toBeNull();
  });

  it("leaves canvas layout sizing to the clipped workbench pane", async () => {
    vi.stubGlobal("devicePixelRatio", 2);
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    const store = seedMapStore();

    const { container } = render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapWorkbenchManifestMock).toHaveBeenCalledTimes(1));

    const canvas = container.querySelector("canvas");
    expect(canvas).not.toBeNull();
    expect(canvas?.style.width).toBe("");
    expect(canvas?.style.height).toBe("");
    await waitFor(() => {
      expect(canvas?.width).toBe(1025);
      expect(canvas?.height).toBe(375);
    });
  });

  it("uses visible labels for placement edit actions", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench
            selectedPlacement={selectedPlacement}
            onSelectPlacement={() => undefined}
          />
        </div>
      </Provider>,
    );

    await screen.findByText("Selected placement");

    expect(screen.getByRole("button", { name: "Reset placement edit" }))
      .toHaveTextContent("Reset");
    expect(screen.getByRole("button", { name: "Stage placement delete" }))
      .toHaveTextContent("Delete");
    expect(screen.getByRole("button", { name: "Stage placement edit" }))
      .toHaveTextContent("Stage");
  });

  it("collapses and restores the tile inspector without losing the selected tile", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockResolvedValue(inspectedTile);
    const store = seedMapStore();
    const user = userEvent.setup();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        inspectTile: (tileX: number, tileY: number) => Promise<boolean>;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    await act(async () => {
      await expect(api!.inspectTile(32, 48)).resolves.toBe(true);
    });

    expect(await screen.findByLabelText("Base texture")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Collapse inspector" }));

    expect(screen.queryByLabelText("Base texture")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand tile inspector for 32, 48" }))
      .toHaveTextContent("Tile");
    expect(screen.getByText("32, 48")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Expand tile inspector for 32, 48" }));

    expect(await screen.findByLabelText("Base texture")).toBeInTheDocument();
  });

  it("shows AreaSet metadata in the tile inspector while preserving the raw island id", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockResolvedValue({
      ...inspectedTile,
      island: 2,
      native: {
        ...inspectedTile.native,
        bt_island: 2,
      },
      area: {
        area_id: 2,
        name: "Argent City",
        color: [32, 96, 192, 255],
        music: 7,
        env_color: [12, 24, 36],
        light_color: [48, 60, 72],
        light_dir: [-1, -0.5, 0.25],
        zone_type: 1,
        zone_label: "City",
      },
    });
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        inspectTile: (tileX: number, tileY: number) => Promise<boolean>;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    await act(async () => {
      await expect(api!.inspectTile(32, 48)).resolves.toBe(true);
    });

    const inspector = await screen.findByTestId("map-inspector-scroll");
    expect(within(inspector).getAllByText("Island").length).toBeGreaterThan(0);
    expect(within(inspector).getAllByText("2").length).toBeGreaterThan(0);

    const area = await screen.findByTestId("map-tile-area-info");
    expect(area).toHaveTextContent("Area");
    expect(area).toHaveTextContent("Argent City");
    expect(area).toHaveTextContent("City");
    expect(area).toHaveTextContent("id 2");
    expect(area).toHaveTextContent("music 7");
    expect(area).toHaveTextContent("32, 96, 192");
    expect(area).toHaveTextContent("env 12, 24, 36");
    expect(area).toHaveTextContent("light 48, 60, 72");
    expect(area).toHaveTextContent("dir -1.00, -0.50, 0.25");
  });

  it("keeps placement creation compact until the user asks to add one at the selected tile", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockResolvedValue(inspectedTile);
    const store = seedMapStore();
    const user = userEvent.setup();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        inspectTile: (tileX: number, tileY: number) => Promise<boolean>;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    await act(async () => {
      await expect(api!.inspectTile(32, 48)).resolves.toBe(true);
    });

    expect(await screen.findByLabelText("Base texture")).toBeInTheDocument();
    expect(screen.queryByText("New placement")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add placement at selected tile" }));

    await screen.findByText("New placement");
    expect(screen.getByLabelText("New placement X")).toHaveValue(32.5);
    expect(screen.getByLabelText("New placement Y")).toHaveValue(48.5);
  });

  it("keeps the tile inspector horizontally clipped inside the floating panel", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockResolvedValue(inspectedTile);
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        inspectTile: (tileX: number, tileY: number) => Promise<boolean>;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    await act(async () => {
      await expect(api!.inspectTile(32, 48)).resolves.toBe(true);
    });

    const inspector = await screen.findByTestId("map-inspector-scroll");
    expect(inspector).toHaveClass("overflow-x-hidden", "min-w-0");
    expect(screen.getByTestId("tile-edit-actions")).toHaveClass("flex-wrap", "justify-end");
    expect(screen.getByTestId("map-workbench-right-dock"))
      .toHaveClass("w-[min(20rem,calc(100%-1.5rem))]");
  });

  it("collapses selected placement details into a compact context chip", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    const store = seedMapStore();
    const user = userEvent.setup();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness initialSelectedPlacement={selectedPlacement} />
        </div>
      </Provider>,
    );

    await screen.findByText("Selected placement");

    await user.click(screen.getByRole("button", { name: "Collapse inspector" }));

    expect(screen.queryByText("Selected placement")).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton", { name: "X" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand placement inspector for Volcano 01" }))
      .toHaveTextContent("Volcano 01");

    await user.click(screen.getByRole("button", { name: "Expand placement inspector for Volcano 01" }));

    expect(await screen.findByText("Selected placement")).toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "X" })).toHaveValue(118.2);
  });

  it("auto-collapses selected placement details when compact inspector mode is preferred", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    const store = seedMapStore();
    const user = userEvent.setup();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness
            initialSelectedPlacement={selectedPlacement}
            preferCollapsedInspector
          />
        </div>
      </Provider>,
    );

    await screen.findByRole("button", { name: "Expand placement inspector for Volcano 01" });
    expect(screen.queryByText("Selected placement")).not.toBeInTheDocument();
    expect(screen.getByTestId("map-workbench-right-dock")).toHaveClass("w-56");

    await user.click(screen.getByRole("button", { name: "Expand placement inspector for Volcano 01" }));

    expect(await screen.findByText("Selected placement")).toBeInTheDocument();
    expect(screen.getByLabelText("Selected placement object id")).toHaveValue(26);
  });

  it("restores an auto-collapsed inspector when compact inspector mode ends", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    const store = seedMapStore();

    const { rerender } = render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness
            initialSelectedPlacement={selectedPlacement}
            preferCollapsedInspector
          />
        </div>
      </Provider>,
    );

    await screen.findByRole("button", { name: "Expand placement inspector for Volcano 01" });

    rerender(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness initialSelectedPlacement={selectedPlacement} />
        </div>
      </Provider>,
    );

    expect(await screen.findByText("Selected placement")).toBeInTheDocument();
    expect(screen.queryByTestId("map-inspector-collapsed")).not.toBeInTheDocument();
  });

  it("keeps a manually collapsed inspector collapsed after compact inspector mode ends", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    const store = seedMapStore();
    const user = userEvent.setup();

    const { rerender } = render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness initialSelectedPlacement={selectedPlacement} />
        </div>
      </Provider>,
    );

    await screen.findByText("Selected placement");
    await user.click(screen.getByRole("button", { name: "Collapse inspector" }));

    rerender(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness
            initialSelectedPlacement={selectedPlacement}
            preferCollapsedInspector
          />
        </div>
      </Provider>,
    );

    await screen.findByRole("button", { name: "Expand placement inspector for Volcano 01" });

    rerender(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness initialSelectedPlacement={selectedPlacement} />
        </div>
      </Provider>,
    );

    expect(screen.queryByText("Selected placement")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Expand placement inspector for Volcano 01" }))
      .toBeInTheDocument();
  });

  it("re-collapses the inspector when the compact inspector target changes", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    const store = seedMapStore();
    const user = userEvent.setup();
    const nextPlacement: MapPlacementRecord = {
      ...selectedPlacement,
      index: 13,
      obj_id: 316,
      display_name: "Grass 06",
      asset_name: "nml-bd034.lmo",
      world_x: 23.6,
      world_y: 23.9,
    };

    const { rerender } = render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness
            selectedPlacement={selectedPlacement}
            preferCollapsedInspector
          />
        </div>
      </Provider>,
    );

    await screen.findByRole("button", { name: "Expand placement inspector for Volcano 01" });
    await user.click(screen.getByRole("button", { name: "Expand placement inspector for Volcano 01" }));

    expect(await screen.findByText("Selected placement")).toBeInTheDocument();

    rerender(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness
            selectedPlacement={nextPlacement}
            preferCollapsedInspector
          />
        </div>
      </Provider>,
    );

    expect(await screen.findByRole("button", { name: "Expand placement inspector for Grass 06" }))
      .toBeInTheDocument();
    expect(screen.queryByText("Selected placement")).not.toBeInTheDocument();
  });

  it("duplicates a selected placement into a prefilled new placement draft", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    const store = seedMapStore();
    const user = userEvent.setup();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness initialSelectedPlacement={selectedPlacement} />
        </div>
      </Provider>,
    );

    await screen.findByText("Selected placement");
    await user.click(screen.getByRole("button", { name: "Duplicate placement" }));

    await screen.findByText("New placement");
    expect(screen.queryByText("Selected placement")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Placement object id")).toHaveValue(26);
    expect(screen.getByLabelText("New placement X")).toHaveValue(119.2);
    expect(screen.getByLabelText("New placement Y")).toHaveValue(15.2);
    expect(screen.getByLabelText("New placement yaw")).toHaveValue(-180);

    await user.click(screen.getByRole("button", { name: "Stage new placement" }));
    await screen.findAllByText("1 placement add");
  });

  it("collects selected placements into a group and stages batch deletes", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    const store = seedMapStore();
    const user = userEvent.setup();
    const secondPlacement: MapPlacementRecord = {
      ...selectedPlacement,
      index: 13,
      obj_id: 316,
      world_x: 23.6,
      world_y: 23.9,
      yaw_angle: 75,
      display_name: "Grass 06",
      asset_name: "nml-bd034.lmo",
    };

    const { rerender } = render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench
            selectedPlacement={selectedPlacement}
            onSelectPlacement={() => undefined}
          />
        </div>
      </Provider>,
    );

    await screen.findByText("Selected placement");
    await user.click(screen.getByRole("button", { name: "Add placement to group" }));
    expect(screen.getByTestId("map-placement-selection-group"))
      .toHaveTextContent("1 selected");

    rerender(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench
            selectedPlacement={secondPlacement}
            onSelectPlacement={() => undefined}
          />
        </div>
      </Provider>,
    );

    await screen.findAllByText("Grass 06");
    await user.click(screen.getByRole("button", { name: "Add placement to group" }));
    expect(screen.getByTestId("map-placement-selection-group"))
      .toHaveTextContent("2 selected");

    await user.click(screen.getByRole("button", { name: "Stage deletes for selected placements" }));

    expect(screen.getByRole("button", { name: "Review staged placement delete idx 12" }))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review staged placement delete idx 13" }))
      .toBeInTheDocument();
    expect(screen.getAllByText("2 placement deletes").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("map-placement-selection-group")).not.toBeInTheDocument();
  });

  it("undoes a staged placement add without leaving the temporary placement selected", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    const store = seedMapStore();
    const onSelectPlacement = vi.fn();
    const user = userEvent.setup();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness
            initialSelectedPlacement={selectedPlacement}
            onSelectPlacement={onSelectPlacement}
          />
        </div>
      </Provider>,
    );

    await screen.findByText("Selected placement");
    await user.click(screen.getByRole("button", { name: "Duplicate placement" }));
    await screen.findByText("New placement");
    await user.click(screen.getByRole("button", { name: "Stage new placement" }));

    expect(screen.getByRole("button", { name: "Review staged placement add id 26" }))
      .toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Undo staged edit" }));

    expect(screen.queryByRole("button", { name: "Review staged placement add id 26" }))
      .not.toBeInTheDocument();
    expect(onSelectPlacement).toHaveBeenLastCalledWith(null);

    await user.click(screen.getByRole("button", { name: "Redo staged edit" }));

    expect(screen.getByRole("button", { name: "Review staged placement add id 26" }))
      .toBeInTheDocument();
    expect(onSelectPlacement).toHaveBeenLastCalledWith(null);
  });

  it("nudges selected and new placement drafts by one tile", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    const store = seedMapStore();
    const user = userEvent.setup();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness initialSelectedPlacement={selectedPlacement} />
        </div>
      </Provider>,
    );

    await screen.findByText("Selected placement");
    await user.click(screen.getByRole("button", { name: "Move placement east" }));
    await user.click(screen.getByRole("button", { name: "Move placement north" }));

    expect(screen.getByRole("spinbutton", { name: "X" })).toHaveValue(119.2);
    expect(screen.getByRole("spinbutton", { name: "Y" })).toHaveValue(13.2);
    await user.click(screen.getByRole("button", { name: "Stage placement edit" }));
    expect(screen.getByRole("button", { name: "Review staged placement update idx 12" }))
      .toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Duplicate placement" }));
    await screen.findByText("New placement");
    await user.click(screen.getByRole("button", { name: "Move new placement west" }));
    await user.click(screen.getByRole("button", { name: "Move new placement south" }));

    expect(screen.getByLabelText("New placement X")).toHaveValue(119.2);
    expect(screen.getByLabelText("New placement Y")).toHaveValue(15.2);
  });

  it("stages selected placement object replacement without moving it", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    exportMapEditsMock.mockResolvedValue({
      map_name: "garner",
      map_path: "C:/project/pko-tools/exports/map-edits/garner.map",
      obj_path: "C:/project/pko-tools/exports/map-edits/garner.obj",
      atr_path: "C:/project/pko-tools/exports/map-edits/garner.atr",
      blk_path: "C:/project/pko-tools/exports/map-edits/garner.blk",
      tile_patch_count: 0,
      placement_edit_count: 1,
      map_bytes_written: 100,
      obj_bytes_written: 80,
      atr_bytes_written: 40,
      blk_bytes_written: 20,
    });
    const store = seedMapStore();
    const user = userEvent.setup();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness initialSelectedPlacement={selectedPlacement} />
        </div>
      </Provider>,
    );

    await screen.findByText("Selected placement");
    fireEvent.change(screen.getByLabelText("Selected placement object id"), {
      target: { value: "316" },
    });
    await user.click(screen.getByRole("button", { name: "Stage placement edit" }));

    expect(screen.getByRole("button", { name: "Review staged placement update idx 12" }))
      .toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Export staged edits" }));

    await waitFor(() => expect(exportMapEditsMock).toHaveBeenCalled());
    const placementEdits = exportMapEditsMock.mock.calls[0]?.[3];
    expect(placementEdits).toEqual([
      expect.objectContaining({
        op: "update",
        index: 12,
        obj_id: 316,
      }),
    ]);
    expect(placementEdits[0]).not.toHaveProperty("world_x");
    expect(placementEdits[0]).not.toHaveProperty("world_y");
  });

  it("drags the selected placement marker into the placement draft", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    const store = seedMapStore();
    const onSelectedPlacementViewChange = vi.fn();

    const { container } = render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness
            initialSelectedPlacement={selectedPlacement}
            onSelectedPlacementViewChange={onSelectedPlacementViewChange}
          />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    await screen.findByText("Selected placement");
    expect(screen.getByLabelText("Selected placement can be dragged on the map"))
      .toHaveTextContent("Drag marker on map");
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        centerOnTile: (tileX: number, tileY: number, options?: { scale?: number }) => boolean;
        centerOnPlacement: (index: number, options?: { scale?: number }) => boolean;
        getTransform: () => { scale: number };
        getVisiblePlacements: () => MapPlacementRecord[];
        screenToTile: (screenX: number, screenY: number) => { x: number; y: number };
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    act(() => {
      expect(api!.centerOnPlacement(12, { scale: 10 })).toBe(true);
    });
    await waitFor(() => expect(api!.getTransform().scale).toBe(10));

    const canvas = container.querySelector("canvas");
    if (!canvas) {
      throw new Error("Expected workbench canvas");
    }
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 820,
        bottom: 300,
        width: 820,
        height: 300,
        toJSON: () => ({}),
      }),
    });

    dispatchCanvasPointerEvent(canvas, "pointerdown", {
      button: 0,
      buttons: 1,
      clientX: 410,
      clientY: 150,
      pointerId: 1,
    });
    dispatchCanvasPointerEvent(canvas, "pointermove", {
      button: 0,
      buttons: 1,
      clientX: 430,
      clientY: 160,
      pointerId: 1,
    });
    dispatchCanvasPointerEvent(canvas, "pointerup", {
      button: 0,
      buttons: 0,
      clientX: 430,
      clientY: 160,
      pointerId: 1,
    });

    expect(screen.getByRole("spinbutton", { name: "X" })).toHaveValue(120.2);
    expect(screen.getByRole("spinbutton", { name: "Y" })).toHaveValue(15.2);
    await waitFor(() =>
      expect(onSelectedPlacementViewChange).toHaveBeenLastCalledWith(
        expect.objectContaining({
          index: 12,
          world_x: 120.2,
          world_y: 15.2,
        }),
      )
    );
    await waitFor(() => {
      const marker = api!.getVisiblePlacements().find((placement) => placement.index === 12);
      expect(marker).toEqual(expect.objectContaining({
        world_x: 120.2,
        world_y: 15.2,
      }));
    });
    expect(screen.getByRole("button", { name: "Stage placement edit" })).toBeEnabled();

    inspectMapTileMock.mockClear();
    dispatchCanvasPointerEvent(canvas, "pointerdown", {
      button: 0,
      buttons: 1,
      clientX: 430,
      clientY: 160,
      pointerId: 2,
    });
    dispatchCanvasPointerEvent(canvas, "pointerup", {
      button: 0,
      buttons: 0,
      clientX: 430,
      clientY: 160,
      pointerId: 2,
    });

    await waitFor(() =>
      expect(inspectMapTileMock).toHaveBeenCalledWith("project-1", "garner", 120, 15, expect.any(Object))
    );

    act(() => {
      expect(api!.centerOnTile(0, 0, { scale: 10 })).toBe(true);
    });
    fireEvent.click(screen.getByRole("button", { name: "Center selected placement" }));
    await waitFor(() => {
      const centered = api!.screenToTile(410, 150);
      expect(centered.x).toBeCloseTo(120.2);
      expect(centered.y).toBeCloseTo(15.2);
    });

    act(() => {
      expect(api!.centerOnTile(0, 0, { scale: 10 })).toBe(true);
      expect(api!.centerOnPlacement(12, { scale: 10 })).toBe(true);
    });
    await waitFor(() => {
      const centered = api!.screenToTile(410, 150);
      expect(centered.x).toBeCloseTo(120.2);
      expect(centered.y).toBeCloseTo(15.2);
    });
  });

  it("drags a staged new placement marker into the pending add", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    exportMapEditsMock.mockResolvedValue({
      map_name: "garner",
      map_path: "C:/project/pko-tools/exports/map-edits/garner.map",
      obj_path: "C:/project/pko-tools/exports/map-edits/garner.obj",
      atr_path: "C:/project/pko-tools/exports/map-edits/garner.atr",
      blk_path: "C:/project/pko-tools/exports/map-edits/garner.blk",
      tile_patch_count: 0,
      placement_edit_count: 1,
      map_bytes_written: 40,
      obj_bytes_written: 20,
      atr_bytes_written: 40,
      blk_bytes_written: 20,
    });
    const store = seedMapStore();
    const user = userEvent.setup();

    const { container } = render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness initialSelectedPlacement={selectedPlacement} />
        </div>
      </Provider>,
    );

    await screen.findByText("Selected placement");
    await user.click(screen.getByRole("button", { name: "Duplicate placement" }));
    await screen.findByText("New placement");
    await user.click(screen.getByRole("button", { name: "Stage new placement" }));
    await screen.findByRole("button", { name: "Review staged placement add id 26" });

    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        centerOnPlacement: (index: number, options?: { scale?: number }) => boolean;
        getTransform: () => { scale: number };
        getVisiblePlacements: () => MapPlacementRecord[];
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    act(() => {
      expect(api!.centerOnPlacement(-1, { scale: 10 })).toBe(true);
    });
    await waitFor(() => expect(api!.getTransform().scale).toBe(10));

    const canvas = container.querySelector("canvas");
    if (!canvas) {
      throw new Error("Expected workbench canvas");
    }
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 820,
        bottom: 300,
        width: 820,
        height: 300,
        toJSON: () => ({}),
      }),
    });

    dispatchCanvasPointerEvent(canvas, "pointerdown", {
      button: 0,
      buttons: 1,
      clientX: 410,
      clientY: 150,
      pointerId: 1,
    });
    dispatchCanvasPointerEvent(canvas, "pointermove", {
      button: 0,
      buttons: 1,
      clientX: 430,
      clientY: 160,
      pointerId: 1,
    });
    dispatchCanvasPointerEvent(canvas, "pointerup", {
      button: 0,
      buttons: 0,
      clientX: 430,
      clientY: 160,
      pointerId: 1,
    });

    expect(screen.getByRole("spinbutton", { name: "X" })).toHaveValue(121.2);
    expect(screen.getByRole("spinbutton", { name: "Y" })).toHaveValue(16.2);
    await waitFor(() => {
      const marker = api!.getVisiblePlacements().find((placement) => placement.index === -1);
      expect(marker).toEqual(expect.objectContaining({
        world_x: 121.2,
        world_y: 16.2,
      }));
    });

    await user.click(screen.getByRole("button", { name: "Export staged edits" }));
    await waitFor(() => expect(exportMapEditsMock).toHaveBeenCalled());
    expect(exportMapEditsMock.mock.calls[0]?.[3]).toEqual([
      expect.objectContaining({
        op: "add",
        obj_id: 26,
        world_x: 121.2,
        world_y: 16.2,
      }),
    ]);
  });

  it("undoes a staged new placement drag without leaving stale inspector coordinates", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    const store = seedMapStore();
    const user = userEvent.setup();

    const { container } = render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness initialSelectedPlacement={selectedPlacement} />
        </div>
      </Provider>,
    );

    await screen.findByText("Selected placement");
    await user.click(screen.getByRole("button", { name: "Duplicate placement" }));
    await screen.findByText("New placement");
    await user.click(screen.getByRole("button", { name: "Stage new placement" }));
    await screen.findByRole("button", { name: "Review staged placement add id 26" });

    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        centerOnPlacement: (index: number, options?: { scale?: number }) => boolean;
        getTransform: () => { scale: number };
        getVisiblePlacements: () => MapPlacementRecord[];
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    act(() => {
      expect(api!.centerOnPlacement(-1, { scale: 10 })).toBe(true);
    });
    await waitFor(() => expect(api!.getTransform().scale).toBe(10));

    const canvas = container.querySelector("canvas");
    if (!canvas) {
      throw new Error("Expected workbench canvas");
    }
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 820,
        bottom: 300,
        width: 820,
        height: 300,
        toJSON: () => ({}),
      }),
    });

    dispatchCanvasPointerEvent(canvas, "pointerdown", {
      button: 0,
      buttons: 1,
      clientX: 410,
      clientY: 150,
      pointerId: 1,
    });
    dispatchCanvasPointerEvent(canvas, "pointermove", {
      button: 0,
      buttons: 1,
      clientX: 430,
      clientY: 160,
      pointerId: 1,
    });
    dispatchCanvasPointerEvent(canvas, "pointerup", {
      button: 0,
      buttons: 0,
      clientX: 430,
      clientY: 160,
      pointerId: 1,
    });

    expect(screen.getByRole("spinbutton", { name: "X" })).toHaveValue(121.2);

    await user.click(screen.getByRole("button", { name: "Undo staged edit" }));

    expect(screen.getByRole("spinbutton", { name: "X" })).toHaveValue(119.2);
    expect(screen.getByRole("spinbutton", { name: "Y" })).toHaveValue(15.2);
    await waitFor(() => {
      const marker = api!.getVisiblePlacements().find((placement) => placement.index === -1);
      expect(marker).toEqual(expect.objectContaining({
        world_x: 119.2,
        world_y: 15.2,
      }));
    });
  });

  it("does not add an undo step for a staged placement drag that resolves to the same tile", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    const store = seedMapStore();
    const user = userEvent.setup();

    const { container } = render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness initialSelectedPlacement={selectedPlacement} />
        </div>
      </Provider>,
    );

    await screen.findByText("Selected placement");
    await user.click(screen.getByRole("button", { name: "Duplicate placement" }));
    await screen.findByText("New placement");
    fireEvent.change(screen.getByLabelText("New placement X"), {
      target: { value: String(manifest.width) },
    });
    await user.click(screen.getByRole("button", { name: "Stage new placement" }));
    await screen.findByRole("button", { name: "Review staged placement add id 26" });

    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        centerOnPlacement: (index: number, options?: { scale?: number }) => boolean;
        getTransform: () => { scale: number };
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    act(() => {
      expect(api!.centerOnPlacement(-1, { scale: 10 })).toBe(true);
    });
    await waitFor(() => expect(api!.getTransform().scale).toBe(10));

    const canvas = container.querySelector("canvas");
    if (!canvas) {
      throw new Error("Expected workbench canvas");
    }
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 820,
        bottom: 300,
        width: 820,
        height: 300,
        toJSON: () => ({}),
      }),
    });

    dispatchCanvasPointerEvent(canvas, "pointerdown", {
      button: 0,
      buttons: 1,
      clientX: 410,
      clientY: 150,
      pointerId: 1,
    });
    dispatchCanvasPointerEvent(canvas, "pointermove", {
      button: 0,
      buttons: 1,
      clientX: 430,
      clientY: 150,
      pointerId: 1,
    });
    dispatchCanvasPointerEvent(canvas, "pointerup", {
      button: 0,
      buttons: 0,
      clientX: 430,
      clientY: 150,
      pointerId: 1,
    });

    await user.click(screen.getByRole("button", { name: "Undo staged edit" }));

    expect(screen.queryByRole("button", { name: "Review staged placement add id 26" }))
      .not.toBeInTheDocument();
  });

  it("copies inspected tile and selected placement coordinates", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockResolvedValue(inspectedTile);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench
            selectedPlacement={selectedPlacement}
            onSelectPlacement={() => undefined}
          />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        inspectTile: (tileX: number, tileY: number) => Promise<boolean>;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    await act(async () => {
      await expect(api!.inspectTile(32, 48)).resolves.toBe(true);
    });

    await screen.findByLabelText("Base texture");
    fireEvent.click(screen.getByRole("button", { name: "Copy tile coordinates" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith("32, 48"));

    fireEvent.click(screen.getByRole("button", { name: "Copy placement coordinates" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenLastCalledWith("118.20, 14.20, 0.00")
    );
  });

  it("shows an inline building preview for the selected building placement", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench
            selectedPlacement={selectedPlacement}
            onSelectPlacement={() => undefined}
          />
        </div>
      </Provider>,
    );

    const preview = await screen.findByTestId("placement-building-preview");
    expect(preview).toHaveTextContent("Volcano 01");
    expect(
      preview.compareDocumentPosition(screen.getByLabelText("Search replacement buildings"))
        & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(mapPlacementBuildingPreviewMock).toHaveBeenCalledWith({
      placement: selectedPlacement,
    });
  });

  it("lets a parent panel own the selected building preview", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench
            selectedPlacement={selectedPlacement}
            onSelectPlacement={() => undefined}
            showSelectedPlacementPreview={false}
          />
        </div>
      </Provider>,
    );

    await screen.findByText("Selected placement");

    expect(screen.queryByTestId("placement-building-preview"))
      .not.toBeInTheDocument();
    expect(mapPlacementBuildingPreviewMock).not.toHaveBeenCalled();
  });

  it("does not show a building preview for selected effect placements", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench
            selectedPlacement={effectPlacement}
            onSelectPlacement={() => undefined}
          />
        </div>
      </Provider>,
    );

    await screen.findByText("Selected placement");

    expect(screen.queryByTestId("placement-building-preview"))
      .not.toBeInTheDocument();
    expect(await screen.findByTestId("map-effect-placement-info")).toHaveTextContent("Effect details");
    expect(screen.getByTestId("map-effect-placement-info")).toHaveTextContent("Fire Burst");
    expect(screen.getByTestId("map-effect-placement-info")).toHaveTextContent("fire-burst.par");
    expect(screen.getByTestId("map-effect-placement-info")).toHaveTextContent("2.50s");
    expect(screen.getByTestId("map-effect-placement-info")).toHaveTextContent("120");
  });

  it("keeps the top map toolbar on one accessible horizontal row without visible scrollbar chrome", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapWorkbenchManifestMock).toHaveBeenCalledTimes(1));

    const toolbar = screen.getByTestId("map-workbench-toolbar");
    expect(toolbar).toHaveClass("flex-nowrap");
    expect(toolbar).toHaveClass("overflow-x-auto");
    expect(toolbar).toHaveClass("[scrollbar-width:none]");
    expect(toolbar).toHaveAttribute("aria-label", "Map toolbar");
    expect(toolbar).not.toHaveClass("flex-wrap");

    const layerToolbar = screen.getByRole("toolbar", { name: "Comparison overlays" });
    expect(layerToolbar).toHaveClass("shrink-0");
    expect(layerToolbar).not.toHaveClass("overflow-x-auto");
    expect(layerToolbar).not.toHaveClass("max-w-[24rem]");
  });

  it("shows a compact legend for the active map layer", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("map-layer-legend"))
      .toHaveTextContent("Client texture");
    expect(screen.getByTestId("map-layer-legend"))
      .toHaveTextContent("Real terrain + vertex/sea tint");

    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        setLayer: (layer: string) => boolean;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    await act(async () => {
      expect(api!.setLayer("collision")).toBe(true);
    });

    await waitFor(() =>
      expect(screen.getByTestId("map-layer-legend")).toHaveTextContent("Collision")
    );
    expect(screen.getByTestId("map-layer-legend")).toHaveTextContent("Red = blocked");
  });

  it("falls back to vertex tint and explains when real terrain texture assets are unavailable", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    const unavailableManifest: MapWorkbenchManifest = {
      ...manifest,
      available_layers: [
        "terrain_color",
        "texture_layers",
        "height",
        "collision",
        "object_height",
        "region",
        "island",
      ],
      terrain_texture_status: {
        available: false,
        message: "TerrainInfo.bin was not found",
        referenced_count: 0,
        loaded_count: 0,
        missing_count: 0,
        alpha_atlas_available: false,
      },
    };
    getMapWorkbenchManifestMock.mockResolvedValue(unavailableManifest);
    getMapOverviewMock.mockResolvedValue({
      layer: "terrain_color",
      map_width: 4096,
      map_height: 4096,
      sample_width: 256,
      sample_height: 256,
      image_data_uri: "data:image/png;base64,terrain-color",
    });
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() =>
      expect(getMapOverviewMock).toHaveBeenCalledWith(
        "project-1",
        "garner",
        "terrain_color",
        unavailableManifest.recommended_overview_max_size,
      )
    );

    expect(getMapOverviewMock).not.toHaveBeenCalledWith(
      "project-1",
      "garner",
      "texture_base",
      unavailableManifest.recommended_overview_max_size,
    );
    expect(screen.getByTestId("map-layer-legend")).toHaveTextContent("Vertex tint");
    expect(screen.getByTestId("map-texture-status"))
      .toHaveTextContent("Textures unavailable");
    expect(screen.getByTestId("map-texture-status"))
      .toHaveTextContent("TerrainInfo.bin was not found");
    expect(screen.getByRole("combobox", { name: "Primary map layer" }))
      .toHaveTextContent("Vertex tint");
  });

  it("keeps real terrain textures selected and warns when the texture set is incomplete", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    const partialManifest: MapWorkbenchManifest = {
      ...manifest,
      terrain_texture_status: {
        available: true,
        message: "Loaded 1 of 2 referenced terrain textures; 1 missing",
        referenced_count: 2,
        loaded_count: 1,
        missing_count: 1,
        alpha_atlas_available: false,
      },
    };
    getMapWorkbenchManifestMock.mockResolvedValue(partialManifest);
    getMapOverviewMock.mockResolvedValue({
      layer: "texture_base",
      map_width: 4096,
      map_height: 4096,
      sample_width: 256,
      sample_height: 256,
      image_data_uri: "data:image/png;base64,terrain-texture",
    });
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() =>
      expect(getMapOverviewMock).toHaveBeenCalledWith(
        "project-1",
        "garner",
        "texture_base",
        partialManifest.recommended_overview_max_size,
      )
    );

    expect(screen.getByTestId("map-layer-legend")).toHaveTextContent("Client texture");
    expect(screen.getByTestId("map-texture-status"))
      .toHaveTextContent("Texture set incomplete");
    expect(screen.getByTestId("map-texture-status"))
      .toHaveTextContent("Loaded 1 of 2 referenced terrain textures; 1 missing");
  });

  it("separates missing blend masks from missing terrain textures", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    const alphaOnlyManifest: MapWorkbenchManifest = {
      ...manifest,
      terrain_texture_status: {
        available: true,
        message: "Alpha atlas total.tga is missing, so blend masks use fallback opacity",
        referenced_count: 8,
        loaded_count: 8,
        missing_count: 0,
        alpha_atlas_available: false,
      },
    };
    getMapWorkbenchManifestMock.mockResolvedValue(alphaOnlyManifest);
    getMapOverviewMock.mockResolvedValue({
      layer: "texture_base",
      map_width: 4096,
      map_height: 4096,
      sample_width: 256,
      sample_height: 256,
      image_data_uri: "data:image/png;base64,terrain-texture",
    });
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() =>
      expect(getMapOverviewMock).toHaveBeenCalledWith(
        "project-1",
        "garner",
        "texture_base",
        alphaOnlyManifest.recommended_overview_max_size,
      )
    );

    expect(screen.getByTestId("map-texture-status"))
      .toHaveTextContent("Blend masks unavailable");
    expect(screen.getByTestId("map-texture-status"))
      .not.toHaveTextContent("Texture set incomplete");
    expect(screen.getByTestId("map-texture-status"))
      .toHaveTextContent("Alpha atlas total.tga is missing");
  });

  it("labels primary map layer and comparison overlay controls as separate concepts", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    const store = seedMapStore();
    const user = userEvent.setup();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapWorkbenchManifestMock).toHaveBeenCalledTimes(1));

    expect(screen.getByText("Primary layer")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Primary map layer" })).toBeInTheDocument();
    await user.click(screen.getByRole("combobox", { name: "Primary map layer" }));
    expect(screen.getByRole("option", { name: "Vertex tint" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Terrain tint" })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");

    const overlayToolbar = screen.getByRole("toolbar", { name: "Comparison overlays" });
    expect(within(overlayToolbar).getByText("Overlays")).toBeInTheDocument();

    await user.click(screen.getByRole("button", {
      name: "Collision comparison overlay",
    }));

    expect(screen.getByRole("button", {
      name: "Collision comparison overlay",
    })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Overlay strength")).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Comparison overlay strength" }))
      .toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByText("Object markers")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Object marker density" }))
      .toBeInTheDocument();
  });

  it("returns new map selections to the client texture base layer", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapWorkbenchManifestMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        setLayer: (layer: string) => boolean;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    await act(async () => {
      expect(api!.setLayer("terrain_color")).toBe(true);
    });
    await waitFor(() =>
      expect(screen.getByTestId("map-layer-legend")).toHaveTextContent("Vertex tint")
    );

    act(() => {
      store.set(selectedMapAtom, {
        name: "garner2",
        display_name: "Garner2",
        map_file: "garner2.map",
        has_obj: true,
        has_rbo: true,
        width: 280,
        height: 280,
      });
    });

    await waitFor(() => expect(getMapWorkbenchManifestMock).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByTestId("map-layer-legend")).toHaveTextContent("Client texture")
    );
    expect(getMapOverviewMock).toHaveBeenLastCalledWith(
      "project-1",
      "garner2",
      "texture_base",
      manifest.recommended_overview_max_size,
    );
  });

  it("composes comparison overlays over the selected primary layer", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    getMapOverviewMock.mockImplementation(
      async (_projectId: string, _mapName: string, requestedLayer: string) => ({
        layer: requestedLayer,
        map_width: 4096,
        map_height: 4096,
        sample_width: 256,
        sample_height: 256,
        image_data_uri: `data:image/png;base64,overview-${requestedLayer}`,
      }),
    );
    getMapChunkMock.mockImplementation(
      async (_projectId: string, _mapName: string, args: { chunk_x: number; chunk_y: number; layer: string }) => ({
        chunk_x: args.chunk_x,
        chunk_y: args.chunk_y,
        layer: args.layer,
        tile_x: args.chunk_x * 128,
        tile_y: args.chunk_y * 128,
        tile_width: 128,
        tile_height: 128,
        sample_width: 128,
        sample_height: 128,
        image_data_uri: `data:image/png;base64,chunk-${args.layer}-${args.chunk_x}-${args.chunk_y}`,
        numeric_format: null,
        numeric_payload: null,
      }),
    );
    const store = seedMapStore();
    const user = userEvent.setup();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() =>
      expect(getMapOverviewMock).toHaveBeenCalledWith(
        "project-1",
        "garner",
        "texture_base",
        manifest.recommended_overview_max_size,
      )
    );
    getMapOverviewMock.mockClear();
    getMapChunkMock.mockClear();

    await user.click(screen.getByRole("button", {
      name: "Collision comparison overlay",
    }));

    expect(screen.getByRole("button", {
      name: "Collision comparison overlay",
    }))
      .toHaveAttribute("aria-pressed", "true");
    await waitFor(() =>
      expect(getMapOverviewMock).toHaveBeenCalledWith(
        "project-1",
        "garner",
        "collision",
        manifest.recommended_overview_max_size,
      )
    );
    expect(getMapOverviewMock).not.toHaveBeenCalledWith(
      "project-1",
      "garner",
      "texture_base",
      manifest.recommended_overview_max_size,
    );
    expect(screen.getByTestId("map-layer-legend")).toHaveTextContent("Collision overlay");

    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        centerOnTile: (tileX: number, tileY: number, options?: { scale?: number }) => boolean;
        setLayer: (layer: string) => boolean;
        setLayerOverlay: (layer: string, enabled: boolean) => boolean;
        getState: () => {
          overlayLayers: string[];
          activeRasterLayers: string[];
          overlayOpacity: number;
        };
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();
    expect(api!.getState().overlayLayers).toEqual(["collision"]);
    expect(api!.getState().activeRasterLayers).toEqual(["texture_base", "collision"]);
    expect(api!.getState().overlayOpacity).toBe(1);

    const overlayOpacity = screen.getByLabelText("Comparison overlay strength") as HTMLInputElement;
    expect(overlayOpacity.value).toBe("100");
    act(() => {
      fireEvent.change(overlayOpacity, { target: { value: "60" } });
    });
    expect(api!.getState().overlayOpacity).toBeCloseTo(0.6);
    expect(screen.getByText("60%")).toBeInTheDocument();

    act(() => {
      expect(api!.centerOnTile(512, 512, { scale: 2 })).toBe(true);
    });

    await waitFor(() =>
      expect(getMapChunkMock).toHaveBeenCalledWith(
        "project-1",
        "garner",
        expect.objectContaining({
          layer: "texture_base",
          source_guard: manifest.source,
        }),
      )
    );
    expect(screen.getByTestId("map-detail-status"))
      .toHaveTextContent("Client texture 2 px/tile + overlays");
    expect(getMapChunkMock).toHaveBeenCalledWith(
      "project-1",
      "garner",
      expect.objectContaining({
        layer: "collision",
        source_guard: manifest.source,
      }),
    );

    act(() => {
      expect(api!.setLayerOverlay("collision", false)).toBe(true);
    });
    expect(api!.getState().overlayLayers).toEqual([]);
    expect(api!.getState().activeRasterLayers).toEqual(["texture_base"]);

    act(() => {
      expect(api!.setLayerOverlay("height", true)).toBe(true);
    });
    expect(api!.getState().overlayLayers).toEqual(["height"]);
    expect(api!.getState().activeRasterLayers).toEqual(["texture_base", "height"]);

    act(() => {
      expect(api!.setLayer("height")).toBe(true);
    });
    expect(api!.getState().overlayLayers).toEqual(["height"]);
    expect(api!.getState().activeRasterLayers).toEqual(["height"]);
    await waitFor(() =>
      expect(screen.queryByLabelText("Comparison overlay strength")).not.toBeInTheDocument()
    );
  });

  it("resolves inspected tile texture ids against the terrain texture catalog", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockResolvedValue({
      ...inspectedTile,
      native: {
        ...inspectedTile.native,
        bt_tile_info: 2,
        dw_tile_info: (7 * 2 ** 26) + (8 * 2 ** 22),
      },
      texture_layers: [
        { slot: 0, texture_id: 2, alpha: 15 },
        { slot: 1, texture_id: 7, alpha: 8 },
      ],
    });
    const store = seedMapStore();
    const user = userEvent.setup();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getTerrainTextureCatalogMock).toHaveBeenCalledWith("project-1"));

    fireEvent.change(screen.getByLabelText("Jump to x"), { target: { value: "32" } });
    fireEvent.change(screen.getByLabelText("Jump to y"), { target: { value: "48" } });
    await user.click(screen.getByRole("button", { name: "Go to tile" }));

    const textureSlots = await screen.findByTestId("map-texture-slots");
    expect(textureSlots).toHaveTextContent("terrain_002.tga");
    expect(textureSlots).toHaveTextContent("grass_007.tga");
    await waitFor(() =>
      expect(getTerrainTexturePreviewMock).toHaveBeenCalledWith("project-1", 7)
    );
    const slotPreview = textureSlots.querySelector('[data-texture-slot-preview="7"]');
    expect(slotPreview).toHaveStyle({
      backgroundImage: 'url("data:image/png;base64,grass-preview")',
    });
    expect(screen.getByLabelText("Base texture").closest("[data-texture-field]"))
      .toHaveTextContent("terrain_002.tga");
    expect(screen.getByLabelText("Layer 1 texture").closest("[data-texture-field]"))
      .toHaveTextContent("grass_007.tga");
  });

  it("shows raw and client-tinted texture previews for the selected tile", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockResolvedValue({
      ...inspectedTile,
      texture_layers: [{ slot: 0, texture_id: 2, alpha: 15 }],
    });
    getMapTileTexturePreviewMock.mockResolvedValue({
      tile_x: 32,
      tile_y: 48,
      sample_width: 64,
      sample_height: 64,
      raw_image_data_uri: "data:image/png;base64,raw-tile",
      client_image_data_uri: "data:image/png;base64,client-tile",
    });
    const store = seedMapStore();
    const user = userEvent.setup();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    fireEvent.change(screen.getByLabelText("Jump to x"), { target: { value: "32" } });
    fireEvent.change(screen.getByLabelText("Jump to y"), { target: { value: "48" } });
    await user.click(screen.getByRole("button", { name: "Go to tile" }));

    await waitFor(() =>
      expect(getMapTileTexturePreviewMock).toHaveBeenCalledWith(
        "project-1",
        "garner",
        32,
        48,
        manifest.source,
      )
    );
    const preview = await screen.findByTestId("map-tile-texture-preview");
    expect(preview).toHaveTextContent("Raw texture blend");
    expect(preview).toHaveTextContent("Client texture");
    expect(within(preview).getByAltText("Raw terrain texture blend")).toHaveAttribute(
      "src",
      "data:image/png;base64,raw-tile",
    );
    expect(within(preview).getByAltText("Client-tinted terrain texture blend")).toHaveAttribute(
      "src",
      "data:image/png;base64,client-tile",
    );
  });

  it("lets tile texture fields be picked from the terrain texture catalog", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockResolvedValue(inspectedTile);
    const store = seedMapStore();
    const user = userEvent.setup();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("Jump to x"), { target: { value: "32" } });
    fireEvent.change(screen.getByLabelText("Jump to y"), { target: { value: "48" } });
    await user.click(screen.getByRole("button", { name: "Go to tile" }));

    const layerTexture = await screen.findByLabelText("Layer 1 texture");
    expect(layerTexture).toHaveValue(0);

    fireEvent.change(screen.getByLabelText("Layer 1 texture catalog"), {
      target: { value: "7" },
    });

    expect(layerTexture).toHaveValue(7);
    expect(screen.getByLabelText("Layer 1 texture catalog")).toHaveValue("7");
    expect(screen.queryByRole("option", { name: "Current custom #7" }))
      .not.toBeInTheDocument();
    expect(screen.getByText("grass_007.tga")).toBeInTheDocument();
    await waitFor(() =>
      expect(getTerrainTexturePreviewMock).toHaveBeenCalledWith("project-1", 7)
    );
    const layerTextureField = document.querySelector('[data-texture-field="Layer 1 texture"]');
    const layerTexturePreview = layerTextureField?.querySelector("[data-texture-preview]");
    expect(layerTexturePreview).toHaveStyle({
      backgroundImage: 'url("data:image/png;base64,grass-preview")',
    });
  });

  it("uses one remove action for a staged new placement", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench
            selectedPlacement={temporaryPlacement}
            onSelectPlacement={() => undefined}
          />
        </div>
      </Provider>,
    );

    await screen.findByText("Selected placement");

    expect(screen.getAllByRole("button", { name: "Remove staged placement" }))
      .toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Reset placement edit" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stage placement edit" }))
      .not.toBeInTheDocument();
  });

  it("removes a staged new placement through the real add flow", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockResolvedValue(inspectedTile);
    const store = seedMapStore();
    const onSelectPlacement = vi.fn();

    const { container } = render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness onSelectPlacement={onSelectPlacement} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));

    const canvas = container.querySelector("canvas");
    if (!canvas) {
      throw new Error("Expected workbench canvas");
    }
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 820,
        bottom: 300,
        width: 820,
        height: 300,
        toJSON: () => ({}),
      }),
    });

    dispatchCanvasPointerEvent(canvas, "pointerdown", {
      button: 0,
      buttons: 1,
      clientX: 410,
      clientY: 150,
      pointerId: 1,
    });
    dispatchCanvasPointerEvent(canvas, "pointerup", {
      button: 0,
      clientX: 410,
      clientY: 150,
      pointerId: 1,
    });

    await waitFor(() => expect(inspectMapTileMock).toHaveBeenCalledTimes(1));
    await openPlacementAddAtSelectedTile();
    fireEvent.click(screen.getByRole("button", { name: "Stage new placement" }));

    await screen.findAllByText("1 placement add");
    expect(onSelectPlacement).toHaveBeenLastCalledWith(
      expect.objectContaining({ index: -1 }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove staged placement" }));

    await waitFor(() => expect(onSelectPlacement).toHaveBeenLastCalledWith(null));
    expect(screen.queryByText("1 placement add")).not.toBeInTheDocument();
  });

  it("reviews and clears staged edits", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockResolvedValue(inspectedTile);
    const store = seedMapStore();
    const onSelectPlacement = vi.fn();

    const { container } = render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness onSelectPlacement={onSelectPlacement} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));

    const canvas = container.querySelector("canvas");
    if (!canvas) {
      throw new Error("Expected workbench canvas");
    }
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 820,
        bottom: 300,
        width: 820,
        height: 300,
        toJSON: () => ({}),
      }),
    });

    dispatchCanvasPointerEvent(canvas, "pointerdown", {
      button: 0,
      buttons: 1,
      clientX: 410,
      clientY: 150,
      pointerId: 1,
    });
    dispatchCanvasPointerEvent(canvas, "pointerup", {
      button: 0,
      clientX: 410,
      clientY: 150,
      pointerId: 1,
    });

    await openPlacementAddAtSelectedTile();
    fireEvent.click(screen.getByRole("button", { name: "Stage new placement" }));

    await screen.findByText("Staged edits");
    expect(screen.getByRole("button", { name: "Review staged placement add id 1" }))
      .toHaveTextContent("Review placement add id 1");

    fireEvent.click(screen.getByRole("button", { name: "Clear staged edits" }));

    await waitFor(() => expect(screen.queryByText("Staged edits")).not.toBeInTheDocument());
    expect(screen.queryByText("1 placement add")).not.toBeInTheDocument();
    expect(onSelectPlacement).toHaveBeenLastCalledWith(null);
  });

  it("jumps back to a staged tile edit from the review queue", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockResolvedValue(inspectedTile);
    const store = seedMapStore();
    const user = userEvent.setup();

    const { container } = render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));

    const canvas = container.querySelector("canvas");
    if (!canvas) {
      throw new Error("Expected workbench canvas");
    }
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 820,
        bottom: 300,
        width: 820,
        height: 300,
        toJSON: () => ({}),
      }),
    });

    dispatchCanvasPointerEvent(canvas, "pointerdown", {
      button: 0,
      buttons: 1,
      clientX: 410,
      clientY: 150,
      pointerId: 1,
    });
    dispatchCanvasPointerEvent(canvas, "pointerup", {
      button: 0,
      clientX: 410,
      clientY: 150,
      pointerId: 1,
    });

    const baseTextureInput = await screen.findByLabelText("Base texture");
    expect(screen.getByText("Terrain layers")).toBeInTheDocument();
    expect(baseTextureInput).toHaveValue(2);
    expect(screen.getByLabelText("Tile color")).toHaveValue(-1);
    expect(screen.getByLabelText("Layer 1 texture")).toHaveValue(0);
    expect(screen.getByLabelText("Layer 1 alpha")).toHaveValue(0);
    expect(screen.getByLabelText("Layer 2 texture")).toHaveValue(0);
    expect(screen.getByLabelText("Layer 2 alpha")).toHaveValue(0);
    expect(screen.getByLabelText("Layer 3 texture")).toHaveValue(0);
    expect(screen.getByLabelText("Layer 3 alpha")).toHaveValue(0);
    expect(screen.getByLabelText("Base texture").closest("[data-texture-field]"))
      .toHaveTextContent("terrain_002.tga");
    expect(screen.getByText(/RGB565 0xffff/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Layer 2 alpha"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Height"), { target: { value: "11" } });
    await user.click(screen.getByRole("button", { name: "Stage tile edit" }));

    await screen.findByText("Staged edits");
    inspectMapTileMock.mockClear();
    const reviewButton = screen.getByRole("button", {
      name: "Review staged tile 32, 48: layers, height",
    });
    expect(reviewButton).toHaveTextContent("Review tile 32, 48: layers, height");
    await user.click(reviewButton);

    expect(countInspectMapTileCalls(32, 48)).toBe(0);
    expect(screen.queryByTestId("map-tile-loading-summary")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Height")).toHaveValue(11);
    expect(screen.getByLabelText("Layer 2 alpha")).toHaveValue(4);
  });

  it("explains client-default underwater tiles when inspecting an empty map section", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockResolvedValue({
      ...inspectedTile,
      is_empty_section: true,
      tile_x: 40,
      tile_y: 56,
      section_x: 5,
      section_y: 7,
      native: {
        dw_tile_info: 0,
        bt_tile_info: 22,
        s_color: -1,
        c_height: -20,
        s_region: 0,
        bt_island: 0,
        bt_block: [0, 0, 0, 0],
      },
      color_rgb: [248, 252, 248],
      terrain_height: -2,
      region_flags: [],
      island: 0,
      subtiles: [],
    });
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        selectTile: (tileX: number, tileY: number, options?: { scale?: number }) => Promise<boolean>;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    await act(async () => {
      await expect(api!.selectTile(40, 56)).resolves.toBe(true);
    });

    expect(await screen.findByTestId("map-empty-section-note"))
      .toHaveTextContent("Empty section. Showing the client default underwater tile");
    expect(screen.getByLabelText("Base texture")).toHaveValue(22);
    expect(screen.getByLabelText("Height")).toHaveValue(-20);
  });

  it("removes one staged tile edit from the review queue without clearing the rest", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockImplementation(
      async (_projectId: string, _mapName: string, tileX: number, tileY: number) => ({
        ...inspectedTile,
        tile_x: tileX,
        tile_y: tileY,
        native: {
          ...inspectedTile.native,
          c_height: 10,
        },
      }),
    );
    exportMapEditsMock.mockResolvedValue({
      map_name: "garner",
      map_path: "C:/project/pko-tools/exports/map-edits/garner.map",
      obj_path: "C:/project/pko-tools/exports/map-edits/garner.obj",
      atr_path: "C:/project/pko-tools/exports/map-edits/garner.atr",
      blk_path: "C:/project/pko-tools/exports/map-edits/garner.blk",
      tile_patch_count: 1,
      placement_edit_count: 0,
      map_bytes_written: 100,
      obj_bytes_written: 80,
      atr_bytes_written: 40,
      blk_bytes_written: 20,
    });
    const store = seedMapStore();
    const user = userEvent.setup();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        selectTile: (tileX: number, tileY: number, options?: { scale?: number }) => Promise<boolean>;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    await act(async () => {
      await expect(api!.selectTile(32, 48)).resolves.toBe(true);
    });
    fireEvent.change(await screen.findByLabelText("Height"), { target: { value: "11" } });
    await user.click(screen.getByRole("button", { name: "Stage tile edit" }));

    await act(async () => {
      await expect(api!.selectTile(33, 48)).resolves.toBe(true);
    });
    fireEvent.change(await screen.findByLabelText("Height"), { target: { value: "12" } });
    await user.click(screen.getByRole("button", { name: "Stage tile edit" }));

    expect(screen.getByRole("button", { name: "Review staged tile 32, 48: height" }))
      .toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review staged tile 33, 48: height" }))
      .toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Remove staged tile 32, 48: height" }));

    expect(screen.queryByRole("button", { name: "Review staged tile 32, 48: height" }))
      .not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review staged tile 33, 48: height" }))
      .toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Export staged edits" }));

    await waitFor(() => expect(exportMapEditsMock).toHaveBeenCalled());
    const patches = exportMapEditsMock.mock.calls[0]?.[2];
    expect(patches).toEqual([
      expect.objectContaining({ tile_x: 33, tile_y: 48, c_height: 12 }),
    ]);
  });

  it("undoes and redoes staged tile edits before export", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockImplementation(
      async (_projectId: string, _mapName: string, tileX: number, tileY: number) => ({
        ...inspectedTile,
        tile_x: tileX,
        tile_y: tileY,
        native: {
          ...inspectedTile.native,
          c_height: 10,
        },
      }),
    );
    exportMapEditsMock.mockResolvedValue({
      map_name: "garner",
      map_path: "C:/project/pko-tools/exports/map-edits/garner.map",
      obj_path: "C:/project/pko-tools/exports/map-edits/garner.obj",
      atr_path: "C:/project/pko-tools/exports/map-edits/garner.atr",
      blk_path: "C:/project/pko-tools/exports/map-edits/garner.blk",
      tile_patch_count: 1,
      placement_edit_count: 0,
      map_bytes_written: 100,
      obj_bytes_written: 80,
      atr_bytes_written: 40,
      blk_bytes_written: 20,
    });
    const store = seedMapStore();
    const user = userEvent.setup();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        selectTile: (tileX: number, tileY: number, options?: { scale?: number }) => Promise<boolean>;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    await act(async () => {
      await expect(api!.selectTile(32, 48)).resolves.toBe(true);
    });
    fireEvent.change(await screen.findByLabelText("Height"), { target: { value: "11" } });
    await user.click(screen.getByRole("button", { name: "Stage tile edit" }));

    expect(screen.getByRole("button", { name: "Review staged tile 32, 48: height" }))
      .toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Undo staged edit" }));

    expect(screen.queryByRole("button", { name: "Review staged tile 32, 48: height" }))
      .not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export staged edits" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Redo staged edit" }));

    expect(screen.getByRole("button", { name: "Review staged tile 32, 48: height" }))
      .toBeInTheDocument();

    const canvas = screen.getByLabelText("Map editor canvas");
    canvas.focus();
    fireEvent.keyDown(canvas, { key: "z", ctrlKey: true });

    expect(screen.queryByRole("button", { name: "Review staged tile 32, 48: height" }))
      .not.toBeInTheDocument();

    fireEvent.keyDown(canvas, { key: "y", ctrlKey: true });

    expect(screen.getByRole("button", { name: "Review staged tile 32, 48: height" }))
      .toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Export staged edits" }));

    await waitFor(() => expect(exportMapEditsMock).toHaveBeenCalled());
    const patches = exportMapEditsMock.mock.calls[0]?.[2];
    expect(patches).toEqual([
      expect.objectContaining({ tile_x: 32, tile_y: 48, c_height: 11 }),
    ]);
  });

  it("keeps staged edits when reload is cancelled", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockImplementation(
      async (_projectId: string, _mapName: string, tileX: number, tileY: number) => ({
        ...inspectedTile,
        tile_x: tileX,
        tile_y: tileY,
        native: {
          ...inspectedTile.native,
          c_height: 10,
        },
      }),
    );
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const store = seedMapStore();
    const user = userEvent.setup();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        selectTile: (tileX: number, tileY: number, options?: { scale?: number }) => Promise<boolean>;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    await act(async () => {
      await expect(api!.selectTile(32, 48)).resolves.toBe(true);
    });
    fireEvent.change(await screen.findByLabelText("Height"), { target: { value: "11" } });
    await user.click(screen.getByRole("button", { name: "Stage tile edit" }));

    expect(screen.getByRole("button", { name: "Review staged tile 32, 48: height" }))
      .toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reload map" }));

    expect(confirm).toHaveBeenCalledWith("Discard 1 tile and reload this map?");
    expect(getMapWorkbenchManifestMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Review staged tile 32, 48: height" }))
      .toBeInTheDocument();
  });

  it("publishes staged edit state for map selection guards", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockImplementation(
      async (_projectId: string, _mapName: string, tileX: number, tileY: number) => ({
        ...inspectedTile,
        tile_x: tileX,
        tile_y: tileY,
        native: {
          ...inspectedTile.native,
          c_height: 10,
        },
      }),
    );
    const store = seedMapStore();
    const user = userEvent.setup();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        selectTile: (tileX: number, tileY: number, options?: { scale?: number }) => Promise<boolean>;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    await act(async () => {
      await expect(api!.selectTile(32, 48)).resolves.toBe(true);
    });
    fireEvent.change(await screen.findByLabelText("Height"), { target: { value: "11" } });
    await user.click(screen.getByRole("button", { name: "Stage tile edit" }));

    await waitFor(() =>
      expect(store.get(mapStagedEditStateAtom)).toEqual({
        mapName: "garner",
        count: 1,
        summary: "1 tile",
      })
    );

    fireEvent.click(screen.getByRole("button", { name: "Clear staged edits" }));

    await waitFor(() => expect(store.get(mapStagedEditStateAtom)).toBeNull());
  });

  it("clears staged edit state when the workbench unmounts", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockImplementation(
      async (_projectId: string, _mapName: string, tileX: number, tileY: number) => ({
        ...inspectedTile,
        tile_x: tileX,
        tile_y: tileY,
        native: {
          ...inspectedTile.native,
          c_height: 10,
        },
      }),
    );
    const store = seedMapStore();
    const user = userEvent.setup();

    const { unmount } = render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        selectTile: (tileX: number, tileY: number, options?: { scale?: number }) => Promise<boolean>;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    await act(async () => {
      await expect(api!.selectTile(32, 48)).resolves.toBe(true);
    });
    fireEvent.change(await screen.findByLabelText("Height"), { target: { value: "11" } });
    await user.click(screen.getByRole("button", { name: "Stage tile edit" }));

    await waitFor(() => expect(store.get(mapStagedEditStateAtom)?.count).toBe(1));

    unmount();

    await waitFor(() => expect(store.get(mapStagedEditStateAtom)).toBeNull());
  });

  it("copies and pastes tile edit drafts onto another inspected tile", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockImplementation(
      async (_projectId: string, _mapName: string, tileX: number, tileY: number) => ({
        ...inspectedTile,
        tile_x: tileX,
        tile_y: tileY,
        native: {
          ...inspectedTile.native,
          c_height: 10,
        },
        terrain_height: 1,
      }),
    );
    const store = seedMapStore();
    const user = userEvent.setup();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        selectTile: (tileX: number, tileY: number, options?: { scale?: number }) => Promise<boolean>;
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    await act(async () => {
      await expect(api!.selectTile(32, 48)).resolves.toBe(true);
    });
    await screen.findByLabelText("Height");
    fireEvent.change(screen.getByLabelText("Height"), { target: { value: "42" } });
    fireEvent.change(screen.getByLabelText("Region"), { target: { value: "9" } });
    await user.click(screen.getByRole("button", { name: "Copy tile draft" }));

    await act(async () => {
      await expect(api!.selectTile(33, 48)).resolves.toBe(true);
    });
    await waitFor(() => expect(screen.getByLabelText("Height")).toHaveValue(10));

    await user.click(screen.getByRole("button", { name: "Paste tile draft" }));
    expect(screen.getByLabelText("Height")).toHaveValue(42);
    expect(screen.getByLabelText("Region")).toHaveValue(9);

    await user.click(screen.getByRole("button", { name: "Stage tile edit" }));
    expect(screen.getByRole("button", { name: "Review staged tile 33, 48: height, region" }))
      .toBeInTheDocument();
  });

  it("edits semantic region flags while preserving the raw region value", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockResolvedValue({
      ...inspectedTile,
      native: {
        ...inspectedTile.native,
        s_region: 0x0101,
      },
      region_flags: ["land"],
    });
    const store = seedMapStore();
    const user = userEvent.setup();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    const api = window.__PKO_TOOLS_MAP_WORKBENCH__;
    if (!api) {
      throw new Error("Expected map workbench automation API");
    }

    await act(async () => {
      await expect(api.selectTile(32, 48)).resolves.toBe(true);
    });
    await screen.findByLabelText("Region");

    expect(screen.getByLabelText("Region")).toHaveValue(0x0101);
    expect(screen.getByRole("button", { name: "Set region terrain to Land" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Toggle Safe zone region flag" }))
      .toHaveAttribute("aria-pressed", "false");

    await user.click(screen.getByRole("button", { name: "Toggle Safe zone region flag" }));
    expect(screen.getByLabelText("Region")).toHaveValue(0x0103);
    expect(screen.getByRole("button", { name: "Toggle Safe zone region flag" }))
      .toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Toggle PK zone region flag" }));
    expect(screen.getByLabelText("Region")).toHaveValue(0x0107);
    expect(screen.getByRole("button", { name: "Toggle PK zone region flag" }))
      .toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Toggle PK zone region flag" }));
    expect(screen.getByLabelText("Region")).toHaveValue(0x0103);
    expect(screen.getByRole("button", { name: "Toggle PK zone region flag" }))
      .toHaveAttribute("aria-pressed", "false");

    await user.click(screen.getByRole("button", { name: "Toggle No monsters region flag" }));
    expect(screen.getByLabelText("Region")).toHaveValue(0x0113);
    expect(screen.getByRole("button", { name: "Toggle No monsters region flag" }))
      .toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Toggle Mining region flag" }));
    expect(screen.getByLabelText("Region")).toHaveValue(0x0133);
    expect(screen.getByRole("button", { name: "Toggle Mining region flag" }))
      .toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Toggle PvP invite region flag" }));
    expect(screen.getByLabelText("Region")).toHaveValue(0x0173);
    expect(screen.getByRole("button", { name: "Toggle PvP invite region flag" }))
      .toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Set region terrain to Bridge" }));
    expect(screen.getByLabelText("Region")).toHaveValue(0x017a);
    expect(screen.getByRole("button", { name: "Set region terrain to Land" }))
      .toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Set region terrain to Bridge" }))
      .toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Set region terrain to Sea" }));
    expect(screen.getByLabelText("Region")).toHaveValue(0x0172);
    expect(screen.getByRole("button", { name: "Set region terrain to Sea" }))
      .toHaveAttribute("aria-pressed", "true");
  });

  it("toggles subtile walkability without losing object-height bits", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockResolvedValue({
      ...inspectedTile,
      native: {
        ...inspectedTile.native,
        bt_block: [0x00, 0x80, 0x41, 0xc9],
      },
      subtiles: [
        { index: 0, blocked: false, raw: 0x00, object_height: 0 },
        { index: 1, blocked: true, raw: 0x80, object_height: 0 },
        { index: 2, blocked: false, raw: 0x41, object_height: -0.05 },
        { index: 3, blocked: true, raw: 0xc9, object_height: -0.45 },
      ],
    });
    const store = seedMapStore();
    const user = userEvent.setup();

    const { container } = render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));

    const canvas = container.querySelector("canvas");
    if (!canvas) {
      throw new Error("Expected workbench canvas");
    }
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 820,
        bottom: 300,
        width: 820,
        height: 300,
        toJSON: () => ({}),
      }),
    });

    dispatchCanvasPointerEvent(canvas, "pointerdown", {
      button: 0,
      buttons: 1,
      clientX: 410,
      clientY: 150,
      pointerId: 1,
    });
    dispatchCanvasPointerEvent(canvas, "pointerup", {
      button: 0,
      clientX: 410,
      clientY: 150,
      pointerId: 1,
    });

    await screen.findByText("Walkability");
    expect(screen.getByRole("button", {
      name: "Northwest subtile, currently open; mark blocked",
    })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", {
      name: "Southeast subtile, currently blocked; mark walkable",
    })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", {
      name: "Northwest subtile, currently open; mark blocked",
    }));
    await user.click(screen.getByRole("button", {
      name: "Southeast subtile, currently blocked; mark walkable",
    }));

    expect(screen.getByLabelText("Northwest object height")).toHaveValue(0);
    expect(screen.getByLabelText("Southeast object height")).toHaveValue(-0.45);

    fireEvent.change(screen.getByLabelText("Northwest object height"), {
      target: { value: "0.10" },
    });
    fireEvent.change(screen.getByLabelText("Southeast object height"), {
      target: { value: "-3.20" },
    });

    expect(screen.getByLabelText("B0")).toHaveValue(130);
    expect(screen.getByLabelText("B3")).toHaveValue(127);

    await user.click(screen.getByRole("button", { name: "Stage tile edit" }));
    expect(screen.getByRole("button", { name: "Review staged tile 32, 48: blocks" }))
      .toHaveTextContent("Review tile 32, 48: blocks");
  });

  it("bulk marks every subtile blocked or walkable without losing object-height bits", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockResolvedValue({
      ...inspectedTile,
      native: {
        ...inspectedTile.native,
        bt_block: [0x01, 0x82, 0x43, 0xc4],
      },
      subtiles: [
        { index: 0, blocked: false, raw: 0x01, object_height: 0.05 },
        { index: 1, blocked: true, raw: 0x82, object_height: 0.1 },
        { index: 2, blocked: false, raw: 0x43, object_height: -0.15 },
        { index: 3, blocked: true, raw: 0xc4, object_height: -0.2 },
      ],
    });
    const store = seedMapStore();
    const user = userEvent.setup();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    const api = window.__PKO_TOOLS_MAP_WORKBENCH__;
    if (!api) {
      throw new Error("Expected workbench automation API");
    }

    await act(async () => {
      await expect(api.inspectTile(32, 48)).resolves.toBe(true);
    });

    await screen.findByText("Walkability");

    await user.click(screen.getByRole("button", { name: "Mark all subtiles blocked" }));

    expect(screen.getByLabelText("B0")).toHaveValue(0x81);
    expect(screen.getByLabelText("B1")).toHaveValue(0x82);
    expect(screen.getByLabelText("B2")).toHaveValue(0xc3);
    expect(screen.getByLabelText("B3")).toHaveValue(0xc4);
    expect(screen.getByLabelText("Northwest object height")).toHaveValue(0.05);
    expect(screen.getByLabelText("Southeast object height")).toHaveValue(-0.2);

    await user.click(screen.getByRole("button", { name: "Mark all subtiles walkable" }));

    expect(screen.getByLabelText("B0")).toHaveValue(0x01);
    expect(screen.getByLabelText("B1")).toHaveValue(0x02);
    expect(screen.getByLabelText("B2")).toHaveValue(0x43);
    expect(screen.getByLabelText("B3")).toHaveValue(0x44);
    expect(screen.getByLabelText("Northwest object height")).toHaveValue(0.05);
    expect(screen.getByLabelText("Southeast object height")).toHaveValue(-0.2);
  });

  it("bulk resets object heights without changing walkability", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockResolvedValue({
      ...inspectedTile,
      native: {
        ...inspectedTile.native,
        bt_block: [0x81, 0x82, 0x43, 0xc4],
      },
      subtiles: [
        { index: 0, blocked: true, raw: 0x81, object_height: 0.05 },
        { index: 1, blocked: true, raw: 0x82, object_height: 0.1 },
        { index: 2, blocked: false, raw: 0x43, object_height: -0.15 },
        { index: 3, blocked: true, raw: 0xc4, object_height: -0.2 },
      ],
    });
    const store = seedMapStore();
    const user = userEvent.setup();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    const api = window.__PKO_TOOLS_MAP_WORKBENCH__;
    if (!api) {
      throw new Error("Expected workbench automation API");
    }

    await act(async () => {
      await expect(api.inspectTile(32, 48)).resolves.toBe(true);
    });

    await screen.findByLabelText("Northwest object height");

    await user.click(screen.getByRole("button", { name: "Reset all object heights" }));

    expect(screen.getByLabelText("B0")).toHaveValue(0x80);
    expect(screen.getByLabelText("B1")).toHaveValue(0x80);
    expect(screen.getByLabelText("B2")).toHaveValue(0x00);
    expect(screen.getByLabelText("B3")).toHaveValue(0x80);
    expect(screen.getByLabelText("Northwest object height")).toHaveValue(0);
    expect(screen.getByLabelText("Northeast object height")).toHaveValue(0);
    expect(screen.getByLabelText("Southwest object height")).toHaveValue(0);
    expect(screen.getByLabelText("Southeast object height")).toHaveValue(0);
    expect(screen.getByRole("button", {
      name: "Northwest subtile, currently blocked; mark walkable",
    })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", {
      name: "Southwest subtile, currently open; mark blocked",
    })).toHaveAttribute("aria-pressed", "false");
  });

  it("previews collision edits at subtile resolution on the canvas", async () => {
    setCanvasSize(820, 300);
    const canvasContext = mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockResolvedValue({
      ...inspectedTile,
      native: {
        ...inspectedTile.native,
        bt_block: [0x00, 0x00, 0x00, 0x00],
      },
      subtiles: [
        { index: 0, blocked: false, raw: 0x00, object_height: 0 },
        { index: 1, blocked: false, raw: 0x00, object_height: 0 },
        { index: 2, blocked: false, raw: 0x00, object_height: 0 },
        { index: 3, blocked: false, raw: 0x00, object_height: 0 },
      ],
    });
    const store = seedMapStore();
    const user = userEvent.setup();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    const api = window.__PKO_TOOLS_MAP_WORKBENCH__;
    if (!api) {
      throw new Error("Expected map workbench automation API");
    }

    act(() => {
      expect(api.setLayer("collision")).toBe(true);
    });
    await act(async () => {
      await expect(api.selectTile(32, 48)).resolves.toBe(true);
    });
    await screen.findByText("Walkability");
    canvasContext.fillRect.mockClear();

    await user.click(screen.getByRole("button", {
      name: "Northwest subtile, currently open; mark blocked",
    }));

    await waitFor(() =>
      expect(canvasContext.fillRect).toHaveBeenCalledWith(32, 48, 0.5, 0.5)
    );
  });

  it("does not draw staged tile previews that are outside the visible viewport", async () => {
    setCanvasSize(820, 300);
    const canvasContext = mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockResolvedValue({
      ...inspectedTile,
      native: {
        ...inspectedTile.native,
        bt_block: [0x00, 0x00, 0x00, 0x00],
      },
      subtiles: [
        { index: 0, blocked: false, raw: 0x00, object_height: 0 },
        { index: 1, blocked: false, raw: 0x00, object_height: 0 },
        { index: 2, blocked: false, raw: 0x00, object_height: 0 },
        { index: 3, blocked: false, raw: 0x00, object_height: 0 },
      ],
    });
    const store = seedMapStore();
    const user = userEvent.setup();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    const api = window.__PKO_TOOLS_MAP_WORKBENCH__;
    if (!api) {
      throw new Error("Expected map workbench automation API");
    }

    act(() => {
      expect(api.setLayer("collision")).toBe(true);
    });
    await act(async () => {
      await expect(api.selectTile(32, 48)).resolves.toBe(true);
    });
    await screen.findByText("Walkability");
    await user.click(screen.getByRole("button", {
      name: "Northwest subtile, currently open; mark blocked",
    }));
    await user.click(screen.getByRole("button", { name: "Stage tile edit" }));

    canvasContext.fillRect.mockClear();
    await act(async () => {
      expect(api.centerOnTile(3000, 3000, { scale: 5 })).toBe(true);
    });
    await waitFor(() => expect(api.getTransform().scale).toBe(5));

    expect(canvasContext.fillRect.mock.calls.some(([x, y]) =>
      Number(x) === 32 && Number(y) === 48
    )).toBe(false);
  });

  it("insets the tile editor when a parent overlay uses the right edge", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockResolvedValue(inspectedTile);
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness rightOverlayInset={364} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText("Jump to x"), { target: { value: "32" } });
    fireEvent.change(screen.getByLabelText("Jump to y"), { target: { value: "48" } });
    await userEvent.click(screen.getByRole("button", { name: "Go to tile" }));

    await screen.findByText("Base texture");
    const tileEditor = screen.getByText("Base texture").closest(".absolute");
    expect(tileEditor).toHaveStyle({ right: "376px" });
  });

  it("keeps the editor dock outside a drawer without shrinking the canvas viewport to drawer width", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockResolvedValue(inspectedTile);
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness rightOverlayInset={60} rightDockInset={364} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText("Jump to x"), { target: { value: "32" } });
    fireEvent.change(screen.getByLabelText("Jump to y"), { target: { value: "48" } });
    await userEvent.click(screen.getByRole("button", { name: "Go to tile" }));

    const dock = await screen.findByTestId("map-workbench-right-dock");
    expect(dock).toHaveStyle({ right: "376px" });
  });

  it("stacks the inspector and staged edits in a single right dock", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockResolvedValue(inspectedTile);
    const store = seedMapStore();
    const user = userEvent.setup();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness rightOverlayInset={364} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText("Jump to x"), { target: { value: "32" } });
    fireEvent.change(screen.getByLabelText("Jump to y"), { target: { value: "48" } });
    await user.click(screen.getByRole("button", { name: "Go to tile" }));

    await screen.findByTestId("map-inspector-scroll");
    fireEvent.change(screen.getByLabelText("Height"), { target: { value: "12" } });
    await user.click(screen.getByRole("button", { name: "Stage tile edit" }));

    const dock = screen.getByTestId("map-workbench-right-dock");
    expect(dock).toHaveStyle({ right: "376px" });

    const dockQueries = within(dock);
    const inspector = dockQueries.getByTestId("map-inspector-panel");
    const stagedEdits = dockQueries.getByTestId("map-staged-edits-card");

    expect(inspector).not.toHaveClass("absolute");
    expect(stagedEdits).not.toHaveClass("absolute");
    expect(dockQueries.getByText("Staged edits")).toBeInTheDocument();
    expect(dockQueries.getByText("Base texture")).toBeInTheDocument();
  });

  it("keeps every staged edit reachable in the compact review queue", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockImplementation(
      (_projectId: string, _mapName: string, tileX: number, tileY: number) =>
        Promise.resolve({
          ...inspectedTile,
          tile_x: tileX,
          tile_y: tileY,
          section_x: Math.floor(tileX / 8),
          section_y: Math.floor(tileY / 8),
          native: {
            ...inspectedTile.native,
            c_height: 1,
          },
        }),
    );
    const store = seedMapStore();
    const user = userEvent.setup();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));

    for (let index = 0; index < 6; index += 1) {
      const tileX = 32 + index;
      fireEvent.change(screen.getByLabelText("Jump to x"), { target: { value: String(tileX) } });
      fireEvent.change(screen.getByLabelText("Jump to y"), { target: { value: "48" } });
      await user.click(screen.getByRole("button", { name: "Go to tile" }));
      await waitFor(() =>
        expect(screen.getByTestId("map-inspector-scroll")).toHaveTextContent(`${tileX}, 48`)
      );
      fireEvent.change(screen.getByLabelText("Height"), {
        target: { value: String(10 + index) },
      });
      await user.click(screen.getByRole("button", { name: "Stage tile edit" }));
    }

    expect(screen.getAllByRole("button", { name: /Review staged tile/ })).toHaveLength(6);
    expect(screen.getByRole("button", { name: "Review staged tile 37, 48: height" }))
      .toHaveTextContent("Review tile 37, 48: height");
    expect(screen.queryByText("+1 more")).not.toBeInTheDocument();
  });

  it("reviews staged placement updates from source while centering patched coordinates", async () => {
    setCanvasSize(820, 300);
    const canvasContext = mockCanvasContext();
    mockMapShellData();
    const store = seedMapStore();
    const onSelectPlacement = vi.fn();
    const user = userEvent.setup();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness
            initialSelectedPlacement={selectedPlacement}
            onSelectPlacement={onSelectPlacement}
          />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    await screen.findByText("Selected placement");
    const placementXInput = screen
      .getAllByLabelText("X")
      .find((input) => (input as HTMLInputElement).value === "118.2");
    if (!placementXInput) {
      throw new Error("Expected selected placement X input");
    }
    fireEvent.change(placementXInput, { target: { value: "120" } });
    await user.click(screen.getByRole("button", { name: "Stage placement edit" }));

    const reviewButton = screen.getByRole("button", {
      name: "Review staged placement update idx 12",
    });
    expect(reviewButton).toHaveTextContent("Review placement update idx 12");

    canvasContext.translate.mockClear();
    await user.click(reviewButton);

    await waitFor(() => expect(onSelectPlacement).toHaveBeenLastCalledWith(selectedPlacement));
    await waitFor(() => expectTranslateCall(canvasContext, -70, 93.2));
  });

  it("reselects staged placement deletes from the review queue", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    const store = seedMapStore();
    const onSelectPlacement = vi.fn();
    const user = userEvent.setup();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness
            initialSelectedPlacement={selectedPlacement}
            onSelectPlacement={onSelectPlacement}
          />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    await screen.findByText("Selected placement");
    await user.click(screen.getByRole("button", { name: "Stage placement delete" }));

    await screen.findByText("Staged edits");
    await user.click(screen.getByRole("button", { name: "Review staged placement delete idx 12" }));

    await waitFor(() => expect(onSelectPlacement).toHaveBeenLastCalledWith(selectedPlacement));
  });

  it("exports staged tile and placement edits as one complete package", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    getMapWorkbenchManifestMock.mockResolvedValue({
      ...manifest,
      rbo_source: {
        map_file_len: 2048,
        map_modified_ms: 3000,
        content_sha256: "rbo-hash",
      },
    });
    inspectMapTileMock.mockResolvedValue(inspectedTile);
    exportMapEditsMock.mockResolvedValue({
      map_name: "garner",
      map_path: "C:/project/pko-tools/exports/map-edits/garner.map",
      obj_path: "C:/project/pko-tools/exports/map-edits/garner.obj",
      rbo_path: "C:/project/pko-tools/exports/map-edits/garner.rbo",
      atr_path: "C:/project/pko-tools/exports/map-edits/garner.atr",
      blk_path: "C:/project/pko-tools/exports/map-edits/garner.blk",
      tile_patch_count: 1,
      placement_edit_count: 1,
      map_bytes_written: 100,
      obj_bytes_written: 80,
      rbo_bytes_written: 30,
      atr_bytes_written: 40,
      blk_bytes_written: 20,
      map_sha256: "export-map-hash",
      obj_sha256: "export-obj-hash",
      rbo_sha256: "export-rbo-hash",
      rbo_preserved_from_source: true,
      rbo_may_be_stale: true,
      atr_sha256: "export-atr-hash",
      blk_sha256: "export-blk-hash",
    });
    const store = seedMapStore();
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness initialSelectedPlacement={selectedPlacement} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    await screen.findByText("Selected placement");
    const placementXInput = screen
      .getAllByLabelText("X")
      .find((input) => (input as HTMLInputElement).value === "118.2");
    if (!placementXInput) {
      throw new Error("Expected selected placement X input");
    }
    fireEvent.change(placementXInput, { target: { value: "120" } });
    await user.click(screen.getByRole("button", { name: "Stage placement edit" }));

    fireEvent.change(screen.getByLabelText("Jump to x"), { target: { value: "32" } });
    fireEvent.change(screen.getByLabelText("Jump to y"), { target: { value: "48" } });
    await user.click(screen.getByRole("button", { name: "Go to tile" }));
    await screen.findByText("Base texture");
    fireEvent.change(screen.getByLabelText("Height"), { target: { value: "11" } });
    await user.click(screen.getByRole("button", { name: "Stage tile edit" }));

    const stagedCard = screen.getByTestId("map-staged-edits-card");
    expect(stagedCard).toHaveTextContent("Client MAP");
    expect(stagedCard).toHaveTextContent("Client OBJ");
    expect(stagedCard).toHaveTextContent("Client RBO");
    expect(stagedCard).toHaveTextContent("Server ATR");
    expect(stagedCard).toHaveTextContent("Server BLK");
    expect(stagedCard).toHaveTextContent("Native package");
    expect(stagedCard).toHaveTextContent("Export writes native client and server map files");
    expect(stagedCard).toHaveTextContent("RBO preserved from source");
    expect(stagedCard).toHaveTextContent("placement edits are not reflected");
    expect(stagedCard).not.toHaveTextContent("glTF");

    await user.click(screen.getByRole("button", { name: "Export staged edits" }));

    await waitFor(() =>
      expect(exportMapEditsMock).toHaveBeenCalledWith(
        "project-1",
        "garner",
        [
          expect.objectContaining({
            tile_x: 32,
            tile_y: 48,
            c_height: 11,
          }),
        ],
        [
          expect.objectContaining({
            op: "update",
            index: 12,
            world_x: 120,
          }),
        ],
        {
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
            map_file_len: 2048,
            map_modified_ms: 3000,
            content_sha256: "rbo-hash",
          },
        },
      )
    );
    expect(exportMapTileEditsMock).not.toHaveBeenCalled();
    expect(exportMapPlacementEditsMock).not.toHaveBeenCalled();
    await waitFor(() => expect(getMapWorkbenchManifestMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Last export")).toBeInTheDocument();
    const dock = screen.getByTestId("map-workbench-right-dock");
    const receipt = screen.getByTestId("map-export-receipt");
    expect(dock).toContainElement(receipt);
    expect(receipt).not.toHaveClass("absolute");
    expect(within(receipt).getAllByText("Client")).toHaveLength(3);
    expect(within(receipt).getAllByText("Server")).toHaveLength(2);
    expect(within(receipt).getByTestId("map-server-export-note")).toHaveTextContent(
      "Server ATR/BLK are export-only",
    );
    expect(within(receipt).getByTestId("map-server-export-note")).toHaveTextContent(
      "Install only applies client files",
    );
    expect(within(receipt).getByTestId("map-rbo-preserved-warning")).toHaveTextContent(
      "RBO preserved from source",
    );
    expect(within(receipt).getByTestId("map-rbo-preserved-warning")).toHaveTextContent(
      "placement edits are not reflected",
    );
    expect(screen.getByText("1 tile, 1 placement")).toBeInTheDocument();
    expect(screen.getByText("garner.map")).toBeInTheDocument();
    expect(screen.getByText("garner.obj")).toBeInTheDocument();
    expect(screen.getByText("garner.rbo")).toBeInTheDocument();
    expect(screen.getByText("garner.atr")).toBeInTheDocument();
    expect(screen.getByText("garner.blk")).toBeInTheDocument();
    expect(screen.getByText("100 B")).toBeInTheDocument();
    expect(screen.getByText("80 B")).toBeInTheDocument();
    expect(screen.getByText("30 B")).toBeInTheDocument();
    expect(screen.getByText("40 B")).toBeInTheDocument();
    expect(screen.getByText("20 B")).toBeInTheDocument();
    expect(within(receipt).getByLabelText("ATR sha256 export-atr-hash")).toHaveTextContent(
      "export-atr-hash",
    );
    expect(within(receipt).getByLabelText("BLK sha256 export-blk-hash")).toHaveTextContent(
      "export-blk-hash",
    );

    await user.click(screen.getByRole("button", { name: "Copy export report" }));
    const report = writeText.mock.calls.at(-1)?.[0] as string | undefined;
    expect(report).toContain("garner native map export");
    expect(report).toContain("1 tile, 1 placement");
    expect(report).toContain(
      "Client MAP\t100 B\tsha256 export-map-hash\tC:/project/pko-tools/exports/map-edits/garner.map",
    );
    expect(report).toContain(
      "Server ATR\t40 B\tsha256 export-atr-hash\tC:/project/pko-tools/exports/map-edits/garner.atr",
    );
    expect(report).toContain(
      "server deployment\tATR/BLK are export-only; Install only applies client MAP/OBJ/RBO files",
    );
    expect(report).toContain(
      "rbo sidecar\tpreserved from source; placement edits are not reflected in RBO",
    );
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      description: "Map export report copied",
    }));

    await user.click(screen.getByRole("button", { name: "Copy server output paths" }));
    expect(writeText.mock.calls.at(-1)?.[0]).toBe(
      [
        "C:/project/pko-tools/exports/map-edits/garner.atr",
        "C:/project/pko-tools/exports/map-edits/garner.blk",
      ].join("\n"),
    );
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({
      description: "Server export paths copied",
    }));

    await user.click(screen.getByRole("button", { name: "Show export files" }));

    expect(revealItemInDirMock).toHaveBeenCalledWith(
      "C:/project/pko-tools/exports/map-edits/garner.map",
    );
  });

  it("installs the last exported client map files with source guards and backup feedback", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockResolvedValue(inspectedTile);
    exportMapEditsMock.mockResolvedValue({
      map_name: "garner",
      map_path: "C:/project/pko-tools/exports/map-edits/garner.map",
      obj_path: "C:/project/pko-tools/exports/map-edits/garner.obj",
      rbo_path: null,
      atr_path: "C:/project/pko-tools/exports/map-edits/garner.atr",
      blk_path: "C:/project/pko-tools/exports/map-edits/garner.blk",
      tile_patch_count: 1,
      placement_edit_count: 0,
      map_bytes_written: 100,
      obj_bytes_written: 80,
      rbo_bytes_written: 0,
      atr_bytes_written: 40,
      blk_bytes_written: 20,
      map_sha256: "export-map-hash",
      obj_sha256: "export-obj-hash",
      rbo_sha256: null,
    });
    applyMapEditClientPackageMock.mockResolvedValue({
      map_name: "garner",
      backup_dir: "C:/project/pko-tools/backups/map-edits/garner-1000",
      map_path: "C:/project/map/garner.map",
      obj_path: "C:/project/map/garner.obj",
      rbo_path: null,
      map_bytes_written: 100,
      obj_bytes_written: 80,
      rbo_bytes_written: 0,
      backups: [
        {
          label: "MAP",
          source_path: "C:/project/map/garner.map",
          backup_path: "C:/project/pko-tools/backups/map-edits/garner-1000/garner.map",
          bytes: 100,
        },
        {
          label: "OBJ",
          source_path: "C:/project/map/garner.obj",
          backup_path: "C:/project/pko-tools/backups/map-edits/garner-1000/garner.obj",
          bytes: 80,
        },
      ],
    });
    const store = seedMapStore();
    const user = userEvent.setup();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("Jump to x"), { target: { value: "32" } });
    fireEvent.change(screen.getByLabelText("Jump to y"), { target: { value: "48" } });
    await user.click(screen.getByRole("button", { name: "Go to tile" }));
    await screen.findByText("Base texture");
    fireEvent.change(screen.getByLabelText("Height"), { target: { value: "11" } });
    await user.click(screen.getByRole("button", { name: "Stage tile edit" }));
    await user.click(screen.getByRole("button", { name: "Export staged edits" }));

    await waitFor(() => expect(exportMapEditsMock).toHaveBeenCalled());
    await screen.findByText("Last export");

    await user.click(screen.getByRole("button", { name: "Install client map files" }));

    await waitFor(() =>
      expect(applyMapEditClientPackageMock).toHaveBeenCalledWith(
        "project-1",
        "garner",
        {
          map_path: "C:/project/pko-tools/exports/map-edits/garner.map",
          obj_path: "C:/project/pko-tools/exports/map-edits/garner.obj",
          rbo_path: null,
          map_bytes: 100,
          obj_bytes: 80,
          rbo_bytes: 0,
          map_sha256: "export-map-hash",
          obj_sha256: "export-obj-hash",
          rbo_sha256: null,
        },
        {
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
            map_file_len: 0,
            map_modified_ms: 0,
            content_sha256: "",
          },
        },
      )
    );
    expect(await screen.findByText("Client files installed")).toBeInTheDocument();
    expect(screen.getByText("2 backups")).toBeInTheDocument();
    expect(screen.getByText("garner-1000")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install client map files" })).toBeDisabled();
    await waitFor(() => expect(getMapWorkbenchManifestMock).toHaveBeenCalledTimes(3));
  });

  it("restores the last installed client backup with pre-restore backup feedback", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockResolvedValue(inspectedTile);
    exportMapEditsMock.mockResolvedValue({
      map_name: "garner",
      map_path: "C:/project/pko-tools/exports/map-edits/garner.map",
      obj_path: "C:/project/pko-tools/exports/map-edits/garner.obj",
      rbo_path: null,
      atr_path: "C:/project/pko-tools/exports/map-edits/garner.atr",
      blk_path: "C:/project/pko-tools/exports/map-edits/garner.blk",
      tile_patch_count: 1,
      placement_edit_count: 0,
      map_bytes_written: 100,
      obj_bytes_written: 80,
      rbo_bytes_written: 0,
      atr_bytes_written: 40,
      blk_bytes_written: 20,
      map_sha256: "export-map-hash",
      obj_sha256: "export-obj-hash",
      rbo_sha256: null,
    });
    applyMapEditClientPackageMock.mockResolvedValue({
      map_name: "garner",
      backup_dir: "C:/project/pko-tools/backups/map-edits/garner-1000",
      map_path: "C:/project/map/garner.map",
      obj_path: "C:/project/map/garner.obj",
      rbo_path: null,
      map_bytes_written: 100,
      obj_bytes_written: 80,
      rbo_bytes_written: 0,
      backups: [
        {
          label: "MAP",
          source_path: "C:/project/map/garner.map",
          backup_path: "C:/project/pko-tools/backups/map-edits/garner-1000/garner.map",
          bytes: 100,
        },
      ],
    });
    restoreMapEditClientBackupMock.mockResolvedValue({
      map_name: "garner",
      backup_dir: "C:/project/pko-tools/backups/map-edits/garner-1000",
      restore_backup_dir: "C:/project/pko-tools/backups/map-edits/garner-pre-restore-1001",
      map_path: "C:/project/map/garner.map",
      obj_path: null,
      rbo_path: null,
      map_bytes_restored: 100,
      obj_bytes_restored: 0,
      rbo_bytes_restored: 0,
      current_backups: [
        {
          label: "MAP",
          source_path: "C:/project/map/garner.map",
          backup_path: "C:/project/pko-tools/backups/map-edits/garner-pre-restore-1001/garner.map",
          bytes: 100,
        },
        {
          label: "OBJ",
          source_path: "C:/project/map/garner.obj",
          backup_path: "C:/project/pko-tools/backups/map-edits/garner-pre-restore-1001/garner.obj",
          bytes: 80,
        },
      ],
      removed_paths: ["C:/project/map/garner.obj"],
    });
    const store = seedMapStore();
    const user = userEvent.setup();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("Jump to x"), { target: { value: "32" } });
    fireEvent.change(screen.getByLabelText("Jump to y"), { target: { value: "48" } });
    await user.click(screen.getByRole("button", { name: "Go to tile" }));
    await screen.findByText("Base texture");
    fireEvent.change(screen.getByLabelText("Height"), { target: { value: "11" } });
    await user.click(screen.getByRole("button", { name: "Stage tile edit" }));
    await user.click(screen.getByRole("button", { name: "Export staged edits" }));
    await screen.findByText("Last export");
    await user.click(screen.getByRole("button", { name: "Install client map files" }));
    await screen.findByText("Client files installed");

    await user.click(screen.getByRole("button", { name: "Restore client files from backup" }));

    await waitFor(() =>
      expect(restoreMapEditClientBackupMock).toHaveBeenCalledWith(
        "project-1",
        "garner",
        "C:/project/pko-tools/backups/map-edits/garner-1000",
      )
    );
    expect(await screen.findByText("Client files restored")).toBeInTheDocument();
    expect(screen.getByText("2 pre-restore backups")).toBeInTheDocument();
    expect(screen.getByText("1 generated file removed")).toBeInTheDocument();
    expect(screen.getByText("garner-pre-restore-1001")).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText("Client files installed")).not.toBeInTheDocument()
    );
    expect(screen.getByRole("button", { name: "Install client map files" })).not.toBeDisabled();
    expect(screen.queryByRole("button", {
      name: "Restore client files from backup",
    })).not.toBeInTheDocument();
    await waitFor(() => expect(getMapWorkbenchManifestMock).toHaveBeenCalledTimes(4));
  });

  it("shows source-guarded export preflight before writing the native map package", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    getMapWorkbenchManifestMock.mockResolvedValue({
      ...manifest,
      rbo_source: {
        map_file_len: 2048,
        map_modified_ms: 3000,
        content_sha256: "rbo-hash",
      },
    });
    inspectMapTileMock.mockResolvedValue(inspectedTile);
    const store = seedMapStore();
    const user = userEvent.setup();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness initialSelectedPlacement={selectedPlacement} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    await screen.findByText("Selected placement");
    const placementXInput = screen
      .getAllByLabelText("X")
      .find((input) => (input as HTMLInputElement).value === "118.2");
    if (!placementXInput) {
      throw new Error("Expected selected placement X input");
    }
    fireEvent.change(placementXInput, { target: { value: "120" } });
    await user.click(screen.getByRole("button", { name: "Stage placement edit" }));

    fireEvent.change(screen.getByLabelText("Jump to x"), { target: { value: "32" } });
    fireEvent.change(screen.getByLabelText("Jump to y"), { target: { value: "48" } });
    await user.click(screen.getByRole("button", { name: "Go to tile" }));
    await screen.findByText("Base texture");
    fireEvent.change(screen.getByLabelText("Height"), { target: { value: "11" } });
    await user.click(screen.getByRole("button", { name: "Stage tile edit" }));

    const preflight = screen.getByTestId("map-export-preflight");
    expect(preflight).toHaveTextContent("Native preflight");
    expect(preflight).toHaveTextContent("1 tile");
    expect(preflight).toHaveTextContent("1 placement");
    expect(preflight).toHaveTextContent("MAP source");
    expect(preflight).toHaveTextContent("map-hash");
    expect(preflight).toHaveTextContent("OBJ source");
    expect(preflight).toHaveTextContent("obj-hash");
    expect(preflight).toHaveTextContent("RBO source");
    expect(preflight).toHaveTextContent("rbo-hash");
    expect(preflight).toHaveTextContent("Server ATR");
    expect(preflight).toHaveTextContent("Server BLK");
    expect(preflight).toHaveTextContent("4096 x 4096 / 48 MiB");
    expect(preflight).toHaveTextContent("8192 x 8192 / 8.0 MiB");
    expect(preflight).toHaveTextContent("Regenerated from MAP tile data");
  });

  it("blocks native export when server BLK collision rows are not byte-aligned", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    getMapWorkbenchManifestMock.mockResolvedValue({
      ...manifest,
      width: 130,
      height: 64,
      section_count_x: 17,
      section_count_y: 8,
      chunk_count_x: 2,
      chunk_count_y: 1,
      total_sections: 136,
      non_empty_sections: 136,
    });
    getMapOverviewMock.mockResolvedValue({
      layer: "texture_base",
      map_width: 130,
      map_height: 64,
      sample_width: 130,
      sample_height: 64,
      image_data_uri: "data:image/png;base64,",
    });
    inspectMapTileMock.mockResolvedValue(inspectedTile);
    const store = seedMapStore();
    const user = userEvent.setup();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("Jump to x"), { target: { value: "32" } });
    fireEvent.change(screen.getByLabelText("Jump to y"), { target: { value: "48" } });
    await user.click(screen.getByRole("button", { name: "Go to tile" }));
    await screen.findByText("Base texture");
    fireEvent.change(screen.getByLabelText("Height"), { target: { value: "11" } });
    await user.click(screen.getByRole("button", { name: "Stage tile edit" }));

    const preflight = screen.getByTestId("map-export-preflight");
    expect(preflight).toHaveTextContent("Server BLK");
    expect(preflight).toHaveTextContent("260 x 128 / row width not byte-aligned");
    expect(preflight).toHaveTextContent(
      "Export will fail until the map width is byte-aligned",
    );
    expect(screen.getByRole("button", { name: "Export staged edits" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Export staged edits" }))
      .toHaveAttribute("title", "Cannot export BLK: collision row width must be byte-aligned");
  });

  it("reinspects the selected tile after exporting map edits", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockImplementation(
      async (_projectId: string, _mapName: string, tileX: number, tileY: number) => {
        const exported = exportMapEditsMock.mock.calls.length > 0;
        return {
          ...inspectedTile,
          tile_x: tileX,
          tile_y: tileY,
          native: {
            ...inspectedTile.native,
            c_height: exported ? 11 : inspectedTile.native.c_height,
          },
          terrain_height: exported ? 1.1 : inspectedTile.terrain_height,
        };
      },
    );
    exportMapEditsMock.mockResolvedValue({
      map_name: "garner",
      map_path: "C:/project/pko-tools/exports/map-edits/garner.map",
      obj_path: "C:/project/pko-tools/exports/map-edits/garner.obj",
      atr_path: "C:/project/pko-tools/exports/map-edits/garner.atr",
      blk_path: "C:/project/pko-tools/exports/map-edits/garner.blk",
      tile_patch_count: 1,
      placement_edit_count: 0,
      map_bytes_written: 100,
      obj_bytes_written: 80,
      atr_bytes_written: 40,
      blk_bytes_written: 20,
    });
    const store = seedMapStore();
    const user = userEvent.setup();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("Jump to x"), { target: { value: "32" } });
    fireEvent.change(screen.getByLabelText("Jump to y"), { target: { value: "48" } });
    await user.click(screen.getByRole("button", { name: "Go to tile" }));
    await screen.findByText("Base texture");
    fireEvent.change(screen.getByLabelText("Height"), { target: { value: "11" } });
    await user.click(screen.getByRole("button", { name: "Stage tile edit" }));

    await user.click(screen.getByRole("button", { name: "Export staged edits" }));

    await waitFor(() => expect(getMapWorkbenchManifestMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(countInspectMapTileCalls(32, 48)).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(screen.getByLabelText("Height")).toHaveValue(11));
  });

  it("gives actionable guidance when export source guards reject stale map files", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockResolvedValue(inspectedTile);
    exportMapEditsMock.mockRejectedValue(
      new Error("MAP source changed since this map was loaded"),
    );
    const store = seedMapStore();
    const user = userEvent.setup();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("Jump to x"), { target: { value: "32" } });
    fireEvent.change(screen.getByLabelText("Jump to y"), { target: { value: "48" } });
    await user.click(screen.getByRole("button", { name: "Go to tile" }));
    await screen.findByText("Base texture");
    fireEvent.change(screen.getByLabelText("Height"), { target: { value: "11" } });
    await user.click(screen.getByRole("button", { name: "Stage tile edit" }));

    await user.click(screen.getByRole("button", { name: "Export staged edits" }));

    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith({
        title: "Map source changed",
        description: "Reload this map before exporting so staged edits apply to the latest client files. MAP source changed since this map was loaded",
        variant: "destructive",
      })
    );
  });

  it("preserves unstaged tile draft changes across export refresh", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockImplementation(
      async (_projectId: string, _mapName: string, tileX: number, tileY: number) => {
        const exported = exportMapEditsMock.mock.calls.length > 0;
        return {
          ...inspectedTile,
          tile_x: tileX,
          tile_y: tileY,
          native: {
            ...inspectedTile.native,
            c_height: exported ? 11 : inspectedTile.native.c_height,
          },
          terrain_height: exported ? 1.1 : inspectedTile.terrain_height,
        };
      },
    );
    exportMapEditsMock.mockResolvedValue({
      map_name: "garner",
      map_path: "C:/project/pko-tools/exports/map-edits/garner.map",
      obj_path: "C:/project/pko-tools/exports/map-edits/garner.obj",
      atr_path: "C:/project/pko-tools/exports/map-edits/garner.atr",
      blk_path: "C:/project/pko-tools/exports/map-edits/garner.blk",
      tile_patch_count: 1,
      placement_edit_count: 0,
      map_bytes_written: 100,
      obj_bytes_written: 80,
      atr_bytes_written: 40,
      blk_bytes_written: 20,
    });
    const store = seedMapStore();
    const user = userEvent.setup();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("Jump to x"), { target: { value: "32" } });
    fireEvent.change(screen.getByLabelText("Jump to y"), { target: { value: "48" } });
    await user.click(screen.getByRole("button", { name: "Go to tile" }));
    await screen.findByText("Base texture");
    fireEvent.change(screen.getByLabelText("Height"), { target: { value: "11" } });
    await user.click(screen.getByRole("button", { name: "Stage tile edit" }));
    fireEvent.change(screen.getByLabelText("Height"), { target: { value: "12" } });

    await user.click(screen.getByRole("button", { name: "Export staged edits" }));

    await waitFor(() => expect(countInspectMapTileCalls(32, 48)).toBeGreaterThanOrEqual(2));
    await waitFor(() => expect(screen.getByLabelText("Height")).toHaveValue(12));
    expect(screen.getByRole("button", { name: "Stage tile edit" })).toBeEnabled();
  });

  it("stages current tile edits across a brush radius", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockResolvedValue(inspectedTile);
    exportMapEditsMock.mockResolvedValue({
      map_name: "garner",
      map_path: "C:/project/pko-tools/exports/map-edits/garner.map",
      obj_path: "C:/project/pko-tools/exports/map-edits/garner.obj",
      atr_path: "C:/project/pko-tools/exports/map-edits/garner.atr",
      blk_path: "C:/project/pko-tools/exports/map-edits/garner.blk",
      tile_patch_count: 9,
      placement_edit_count: 0,
      map_bytes_written: 100,
      obj_bytes_written: 80,
      atr_bytes_written: 40,
      blk_bytes_written: 20,
    });
    const store = seedMapStore();
    const user = userEvent.setup();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("Jump to x"), { target: { value: "32" } });
    fireEvent.change(screen.getByLabelText("Jump to y"), { target: { value: "48" } });
    await user.click(screen.getByRole("button", { name: "Go to tile" }));
    await screen.findByText("Base texture");

    fireEvent.change(screen.getByLabelText("Height"), { target: { value: "11" } });
    fireEvent.change(screen.getByLabelText("Brush radius"), { target: { value: "1" } });
    await user.click(screen.getByRole("button", { name: "Stage tile brush" }));
    await user.click(screen.getByRole("button", { name: "Export staged edits" }));

    await waitFor(() => expect(exportMapEditsMock).toHaveBeenCalled());
    const patches = exportMapEditsMock.mock.calls[0]?.[2];
    expect(patches).toHaveLength(9);
    expect(patches).toEqual(expect.arrayContaining([
      expect.objectContaining({ tile_x: 31, tile_y: 47, c_height: 11 }),
      expect.objectContaining({ tile_x: 32, tile_y: 48, c_height: 11 }),
      expect.objectContaining({ tile_x: 33, tile_y: 49, c_height: 11 }),
    ]));
  });

  it("previews the active tile brush footprint on the canvas", async () => {
    setCanvasSize(820, 300);
    const canvasContext = mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockResolvedValue(inspectedTile);
    const store = seedMapStore();
    const user = userEvent.setup();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("Jump to x"), { target: { value: "32" } });
    fireEvent.change(screen.getByLabelText("Jump to y"), { target: { value: "48" } });
    await user.click(screen.getByRole("button", { name: "Go to tile" }));
    await screen.findByText("Base texture");

    canvasContext.fillRect.mockClear();
    canvasContext.strokeRect.mockClear();
    fireEvent.change(screen.getByLabelText("Height"), { target: { value: "11" } });
    fireEvent.change(screen.getByLabelText("Brush radius"), { target: { value: "1" } });

    await waitFor(() =>
      expect(canvasContext.strokeRect).toHaveBeenCalledWith(31, 47, 3, 3)
    );
    expect(canvasContext.fillRect).toHaveBeenCalledWith(31, 47, 3, 3);
  });

  it("stamps the tile brush onto clicked canvas tiles in paint mode", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockImplementation(
      async (_projectId: string, _mapName: string, tileX: number, tileY: number) => ({
        ...inspectedTile,
        tile_x: tileX,
        tile_y: tileY,
      }),
    );
    exportMapEditsMock.mockResolvedValue({
      map_name: "garner",
      map_path: "C:/project/pko-tools/exports/map-edits/garner.map",
      obj_path: "C:/project/pko-tools/exports/map-edits/garner.obj",
      atr_path: "C:/project/pko-tools/exports/map-edits/garner.atr",
      blk_path: "C:/project/pko-tools/exports/map-edits/garner.blk",
      tile_patch_count: 9,
      placement_edit_count: 0,
      map_bytes_written: 100,
      obj_bytes_written: 80,
      atr_bytes_written: 40,
      blk_bytes_written: 20,
    });
    const store = seedMapStore();
    const user = userEvent.setup();

    const { container } = render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        selectTile: (tileX: number, tileY: number, options?: { scale?: number }) => Promise<boolean>;
        centerOnTile: (tileX: number, tileY: number, options?: { scale?: number }) => boolean;
        screenToTile: (screenX: number, screenY: number) => { x: number; y: number };
        tileToScreen: (tileX: number, tileY: number) => { x: number; y: number };
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    await act(async () => {
      await expect(api!.selectTile(32, 48, { scale: 6 })).resolves.toBe(true);
    });
    await screen.findByText("Base texture");
    fireEvent.change(screen.getByLabelText("Height"), { target: { value: "11" } });
    fireEvent.change(screen.getByLabelText("Brush radius"), { target: { value: "1" } });
    await user.click(screen.getByRole("button", { name: "Toggle tile paint mode" }));

    const canvas = container.querySelector("canvas");
    if (!canvas) {
      throw new Error("Expected workbench canvas");
    }
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 820,
        bottom: 300,
        width: 820,
        height: 300,
        toJSON: () => ({}),
      }),
    });

    act(() => {
      expect(api!.centerOnTile(40, 50, { scale: 6 })).toBe(true);
    });
    const stampPoint = api!.tileToScreen(40.5, 50.5);
    dispatchCanvasPointerEvent(canvas, "pointerdown", {
      button: 0,
      buttons: 1,
      clientX: stampPoint.x,
      clientY: stampPoint.y,
      pointerId: 1,
    });
    dispatchCanvasPointerEvent(canvas, "pointerup", {
      button: 0,
      buttons: 0,
      clientX: stampPoint.x,
      clientY: stampPoint.y,
      pointerId: 1,
    });

    await user.click(screen.getByRole("button", { name: "Export staged edits" }));

    await waitFor(() => expect(exportMapEditsMock).toHaveBeenCalled());
    const patches = exportMapEditsMock.mock.calls[0]?.[2];
    expect(patches).toHaveLength(9);
    expect(patches).toEqual(expect.arrayContaining([
      expect.objectContaining({ tile_x: 39, tile_y: 49, c_height: 11 }),
      expect.objectContaining({ tile_x: 40, tile_y: 50, c_height: 11 }),
      expect.objectContaining({ tile_x: 41, tile_y: 51, c_height: 11 }),
    ]));
    expect(inspectMapTileMock).not.toHaveBeenCalledWith("project-1", "garner", 40, 50, expect.any(Object));
  });

  it("paints only newly entered tiles while dragging in paint mode", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockImplementation(
      async (_projectId: string, _mapName: string, tileX: number, tileY: number) => ({
        ...inspectedTile,
        tile_x: tileX,
        tile_y: tileY,
      }),
    );
    exportMapEditsMock.mockResolvedValue({
      map_name: "garner",
      map_path: "C:/project/pko-tools/exports/map-edits/garner.map",
      obj_path: "C:/project/pko-tools/exports/map-edits/garner.obj",
      atr_path: "C:/project/pko-tools/exports/map-edits/garner.atr",
      blk_path: "C:/project/pko-tools/exports/map-edits/garner.blk",
      tile_patch_count: 2,
      placement_edit_count: 0,
      map_bytes_written: 100,
      obj_bytes_written: 80,
      atr_bytes_written: 40,
      blk_bytes_written: 20,
    });
    const store = seedMapStore();
    const user = userEvent.setup();

    const { container } = render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        selectTile: (tileX: number, tileY: number, options?: { scale?: number }) => Promise<boolean>;
        centerOnTile: (tileX: number, tileY: number, options?: { scale?: number }) => boolean;
        screenToTile: (screenX: number, screenY: number) => { x: number; y: number };
        tileToScreen: (tileX: number, tileY: number) => { x: number; y: number };
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    await act(async () => {
      await expect(api!.selectTile(32, 48, { scale: 6 })).resolves.toBe(true);
    });
    await screen.findByText("Base texture");
    fireEvent.change(screen.getByLabelText("Height"), { target: { value: "11" } });
    await user.click(screen.getByRole("button", { name: "Toggle tile paint mode" }));

    const canvas = container.querySelector("canvas");
    if (!canvas) {
      throw new Error("Expected workbench canvas");
    }
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 820,
        bottom: 300,
        width: 820,
        height: 300,
        toJSON: () => ({}),
      }),
    });

    act(() => {
      expect(api!.centerOnTile(40, 50, { scale: 6 })).toBe(true);
    });
    const firstTile = api!.tileToScreen(40.5, 50.5);
    const secondTile = { x: firstTile.x + 80, y: firstTile.y };
    expect(Math.floor(api!.screenToTile(secondTile.x, secondTile.y).x)).toBe(53);
    dispatchCanvasPointerEvent(canvas, "pointerdown", {
      button: 0,
      buttons: 1,
      clientX: firstTile.x,
      clientY: firstTile.y,
      pointerId: 1,
    });
    dispatchCanvasPointerEvent(canvas, "pointermove", {
      button: 0,
      buttons: 1,
      clientX: secondTile.x,
      clientY: secondTile.y,
      pointerId: 1,
    });
    dispatchCanvasPointerEvent(canvas, "pointermove", {
      button: 0,
      buttons: 1,
      clientX: secondTile.x,
      clientY: secondTile.y,
      pointerId: 1,
    });
    dispatchCanvasPointerEvent(canvas, "pointerup", {
      button: 0,
      buttons: 0,
      clientX: secondTile.x,
      clientY: secondTile.y,
      pointerId: 1,
    });

    await user.click(screen.getByRole("button", { name: "Export staged edits" }));

    await waitFor(() => expect(exportMapEditsMock).toHaveBeenCalled());
    const patches = exportMapEditsMock.mock.calls[0]?.[2];
    expect(patches).toEqual([
      expect.objectContaining({ tile_x: 40, tile_y: 50, c_height: 11 }),
      expect.objectContaining({ tile_x: 53, tile_y: 50, c_height: 11 }),
    ]);
  });

  it("exposes tile brush staging through the workbench automation API", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockImplementation(
      async (_projectId: string, _mapName: string, tileX: number, tileY: number) => ({
        ...inspectedTile,
        tile_x: tileX,
        tile_y: tileY,
      }),
    );
    exportMapEditsMock.mockResolvedValue({
      map_name: "garner",
      map_path: "C:/project/pko-tools/exports/map-edits/garner.map",
      obj_path: "C:/project/pko-tools/exports/map-edits/garner.obj",
      atr_path: "C:/project/pko-tools/exports/map-edits/garner.atr",
      blk_path: "C:/project/pko-tools/exports/map-edits/garner.blk",
      tile_patch_count: 1,
      placement_edit_count: 0,
      map_bytes_written: 100,
      obj_bytes_written: 80,
      atr_bytes_written: 40,
      blk_bytes_written: 20,
    });
    const store = seedMapStore();
    const user = userEvent.setup();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));
    const api = (window as Window & {
      __PKO_TOOLS_MAP_WORKBENCH__?: {
        selectTile: (tileX: number, tileY: number, options?: { scale?: number }) => Promise<boolean>;
        setTilePaintMode: (enabled: boolean) => boolean;
        stageTileBrushAt: (tileX: number, tileY: number) => boolean;
        getState: () => { tilePaintMode: boolean };
      };
    }).__PKO_TOOLS_MAP_WORKBENCH__;
    expect(api).toBeDefined();

    await act(async () => {
      await expect(api!.selectTile(32, 48)).resolves.toBe(true);
    });
    fireEvent.change(await screen.findByLabelText("Height"), { target: { value: "11" } });

    act(() => {
      expect(api!.setTilePaintMode(true)).toBe(true);
    });
    expect(api!.getState().tilePaintMode).toBe(true);
    act(() => {
      expect(api!.stageTileBrushAt(40, 50)).toBe(true);
    });

    await user.click(screen.getByRole("button", { name: "Export staged edits" }));

    await waitFor(() => expect(exportMapEditsMock).toHaveBeenCalled());
    const patches = exportMapEditsMock.mock.calls[0]?.[2];
    expect(patches).toEqual([
      expect.objectContaining({ tile_x: 40, tile_y: 50, c_height: 11 }),
    ]);
  });

  it("jumps to entered tile coordinates and inspects the tile", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockResolvedValue(inspectedTile);
    const store = seedMapStore();

    render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench selectedPlacement={null} onSelectPlacement={() => undefined} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapWorkbenchManifestMock).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText("Jump to x"), { target: { value: "123" } });
    fireEvent.change(screen.getByLabelText("Jump to y"), { target: { value: "456" } });
    fireEvent.click(screen.getByRole("button", { name: "Go to tile" }));

    await waitFor(() =>
      expect(inspectMapTileMock).toHaveBeenCalledWith("project-1", "garner", 123, 456, expect.any(Object))
    );
  });

  it("reports the inspected tile so the placement browser can search nearby", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockResolvedValue(inspectedTile);
    const store = seedMapStore();
    const onSelectedTileChange = vi.fn();

    const { container } = render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench
            selectedPlacement={null}
            onSelectPlacement={() => undefined}
            onSelectedTileChange={onSelectedTileChange}
          />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));

    const canvas = container.querySelector("canvas");
    if (!canvas) {
      throw new Error("Expected workbench canvas");
    }
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 820,
        bottom: 300,
        width: 820,
        height: 300,
        toJSON: () => ({}),
      }),
    });

    dispatchCanvasPointerEvent(canvas, "pointerdown", {
      button: 0,
      buttons: 1,
      clientX: 410,
      clientY: 150,
      pointerId: 1,
    });
    dispatchCanvasPointerEvent(canvas, "pointerup", {
      button: 0,
      clientX: 410,
      clientY: 150,
      pointerId: 1,
    });

    await waitFor(() => expect(onSelectedTileChange).toHaveBeenCalledWith({ x: 32, y: 48 }));
  });

  it("keeps the newly selected tile visible while inspection is pending", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    let firstInspection = true;
    inspectMapTileMock.mockImplementation(() => {
      if (firstInspection) {
        firstInspection = false;
        return Promise.resolve(inspectedTile);
      }
      return new Promise(() => undefined);
    });
    const store = seedMapStore();
    const onSelectedTileChange = vi.fn();

    const { container } = render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench
            selectedPlacement={null}
            onSelectPlacement={() => undefined}
            onSelectedTileChange={onSelectedTileChange}
          />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));

    const canvas = container.querySelector("canvas");
    if (!canvas) {
      throw new Error("Expected workbench canvas");
    }
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 820,
        bottom: 300,
        width: 820,
        height: 300,
        toJSON: () => ({}),
      }),
    });

    dispatchCanvasPointerEvent(canvas, "pointerdown", {
      button: 0,
      buttons: 1,
      clientX: 410,
      clientY: 150,
      pointerId: 1,
    });
    dispatchCanvasPointerEvent(canvas, "pointerup", {
      button: 0,
      clientX: 410,
      clientY: 150,
      pointerId: 1,
    });

    await waitFor(() => expect(onSelectedTileChange).toHaveBeenCalledWith({ x: 32, y: 48 }));
    onSelectedTileChange.mockClear();

    dispatchCanvasPointerEvent(canvas, "pointerdown", {
      button: 0,
      buttons: 1,
      clientX: 420,
      clientY: 160,
      pointerId: 2,
    });
    dispatchCanvasPointerEvent(canvas, "pointerup", {
      button: 0,
      clientX: 420,
      clientY: 160,
      pointerId: 2,
    });

    let pendingTile: { x: number; y: number } | null = null;
    await waitFor(() => {
      const lastSelection = onSelectedTileChange.mock.calls.at(-1)?.[0];
      expect(lastSelection).toEqual({
        x: expect.any(Number),
        y: expect.any(Number),
      });
      pendingTile = lastSelection;
    });
    expect(screen.queryByTestId("map-tile-loading-summary")).not.toBeInTheDocument();
    expect(screen.getByTestId("map-inspector-scroll")).toHaveTextContent("32, 48");
    expect(screen.getByTestId("map-pending-tile-inspection")).toHaveTextContent(
      `Loading tile ${pendingTile!.x}, ${pendingTile!.y}`,
    );
  });

  it("rolls back the optimistic selected tile if tile inspection fails", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    let rejectInspection: ((error: Error) => void) | null = null;
    inspectMapTileMock.mockImplementation(
      () => new Promise<MapTileInspection>((_resolve, reject) => {
        rejectInspection = reject;
      }),
    );
    const store = seedMapStore();
    const onSelectedTileChange = vi.fn();

    const { container } = render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <MapChunkedWorkbench
            selectedPlacement={null}
            onSelectPlacement={() => undefined}
            onSelectedTileChange={onSelectedTileChange}
          />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));

    const canvas = container.querySelector("canvas");
    if (!canvas) {
      throw new Error("Expected workbench canvas");
    }
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 820,
        bottom: 300,
        width: 820,
        height: 300,
        toJSON: () => ({}),
      }),
    });

    dispatchCanvasPointerEvent(canvas, "pointerdown", {
      button: 0,
      buttons: 1,
      clientX: 410,
      clientY: 150,
      pointerId: 1,
    });
    dispatchCanvasPointerEvent(canvas, "pointerup", {
      button: 0,
      clientX: 410,
      clientY: 150,
      pointerId: 1,
    });

    await waitFor(() => {
      const lastSelection = onSelectedTileChange.mock.calls.at(-1)?.[0];
      expect(lastSelection).toEqual({
        x: expect.any(Number),
        y: expect.any(Number),
      });
    });

    await act(async () => {
      rejectInspection?.(new Error("empty section"));
    });

    await waitFor(() => expect(onSelectedTileChange).toHaveBeenLastCalledWith(null));
  });

  it("uses building names when adding a placement", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockResolvedValue(inspectedTile);
    const store = seedMapStore();
    const onSelectPlacement = vi.fn();

    const { container } = render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness onSelectPlacement={onSelectPlacement} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));

    const canvas = container.querySelector("canvas");
    if (!canvas) {
      throw new Error("Expected workbench canvas");
    }
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 820,
        bottom: 300,
        width: 820,
        height: 300,
        toJSON: () => ({}),
      }),
    });

    dispatchCanvasPointerEvent(canvas, "pointerdown", {
      button: 0,
      buttons: 1,
      clientX: 410,
      clientY: 150,
      pointerId: 1,
    });
    dispatchCanvasPointerEvent(canvas, "pointerup", {
      button: 0,
      clientX: 410,
      clientY: 150,
      pointerId: 1,
    });

    await openPlacementAddAtSelectedTile();
    await screen.findByText("Volcano 01");
    fireEvent.click(screen.getByRole("button", { name: "Use building Volcano 01" }));

    expect(screen.getByLabelText("Placement object id")).toHaveValue(26);
    expect(screen.getByTestId("placement-building-preview")).toHaveTextContent("Volcano 01");
    expect(mapPlacementBuildingPreviewMock).toHaveBeenLastCalledWith({
      placement: expect.objectContaining({
        index: -1,
        obj_type: 0,
        obj_id: 26,
        kind: "building",
        world_x: 32.5,
        world_y: 48.5,
        display_name: "Volcano 01",
        asset_name: "nml-bd151.lmo",
      }),
    });
  });

  it("uses scene effect names when adding an effect placement", async () => {
    setCanvasSize(820, 300);
    mockCanvasContext();
    mockMapShellData();
    inspectMapTileMock.mockResolvedValue(inspectedTile);
    const store = seedMapStore();
    const onSelectPlacement = vi.fn();

    const { container } = render(
      <Provider store={store}>
        <div style={{ width: 820, height: 300 }}>
          <WorkbenchHarness onSelectPlacement={onSelectPlacement} />
        </div>
      </Provider>,
    );

    await waitFor(() => expect(getMapOverviewMock).toHaveBeenCalledTimes(1));

    const canvas = container.querySelector("canvas");
    if (!canvas) {
      throw new Error("Expected workbench canvas");
    }
    Object.defineProperty(canvas, "getBoundingClientRect", {
      configurable: true,
      value: () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        right: 820,
        bottom: 300,
        width: 820,
        height: 300,
        toJSON: () => ({}),
      }),
    });

    dispatchCanvasPointerEvent(canvas, "pointerdown", {
      button: 0,
      buttons: 1,
      clientX: 410,
      clientY: 150,
      pointerId: 1,
    });
    dispatchCanvasPointerEvent(canvas, "pointerup", {
      button: 0,
      clientX: 410,
      clientY: 150,
      pointerId: 1,
    });

    await openPlacementAddAtSelectedTile();
    const typeSelect = screen
      .getAllByRole("combobox")
      .find((node) => node.textContent?.includes("Building"));
    if (!typeSelect) {
      throw new Error("Expected placement type select");
    }

    await userEvent.click(typeSelect);
    await userEvent.click(await screen.findByRole("option", { name: "Effect" }));

    await screen.findByText("Fire Burst");
    fireEvent.click(screen.getByRole("button", { name: "Use effect Fire Burst" }));

    expect(screen.getByLabelText("Placement object id")).toHaveValue(401);
    expect(screen.getByTestId("map-effect-placement-info")).toHaveTextContent("Fire Burst");
    expect(screen.getByTestId("map-effect-placement-info")).toHaveTextContent("type 3");
    expect(screen.getByTestId("map-effect-placement-info")).toHaveTextContent("2.50s");
    expect(screen.getByTestId("map-effect-placement-info")).toHaveTextContent("fire-burst.par");

    fireEvent.click(screen.getByRole("button", { name: "Stage new placement" }));

    await screen.findAllByText("1 placement add");
    expect(onSelectPlacement).toHaveBeenLastCalledWith(
      expect.objectContaining({
        index: -1,
        obj_type: 1,
        obj_id: 401,
        kind: "effect",
      }),
    );
  });
});
