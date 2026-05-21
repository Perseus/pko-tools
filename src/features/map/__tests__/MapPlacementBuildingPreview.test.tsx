import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentProjectAtom } from "@/store/project";
import { getBuildingSceneInfo, loadBuildingModel } from "@/commands/buildings";
import type { MapPlacementRecord } from "@/types/map";
import MapPlacementBuildingPreview, {
  clearMapPlacementBuildingPreviewCache,
  getPlacementPreviewTransform,
} from "../MapPlacementBuildingPreview";

vi.mock("@react-three/fiber", () => ({
  Canvas: ({
    children,
    frameloop,
  }: {
    children: React.ReactNode;
    frameloop?: string;
  }) => (
    <div data-testid="placement-preview-canvas" data-frameloop={frameloop ?? ""}>
      {children}
    </div>
  ),
}));

vi.mock("@react-three/drei", () => ({
  Bounds: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="placement-preview-bounds">{children}</div>
  ),
  Center: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="placement-preview-center">{children}</div>
  ),
  OrbitControls: () => <div data-testid="placement-preview-controls" />,
}));

vi.mock("@/components/CanvasErrorBoundary", () => ({
  CanvasErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/features/buildings/BuildingsModelViewer", () => ({
  default: ({ gltfJson }: { gltfJson: string }) => (
    <div data-testid="building-model-viewer">{gltfJson}</div>
  ),
}));

vi.mock("@/commands/buildings", () => ({
  getBuildingSceneInfo: vi.fn(),
  loadBuildingModel: vi.fn(),
}));

const getBuildingSceneInfoMock = vi.mocked(getBuildingSceneInfo);
const loadBuildingModelMock = vi.mocked(loadBuildingModel);

const buildingPlacement: MapPlacementRecord = {
  index: 12,
  obj_type: 0,
  obj_id: 26,
  kind: "building",
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

const effectPlacement: MapPlacementRecord = {
  ...buildingPlacement,
  obj_type: 1,
  obj_id: 401,
  kind: "effect",
  display_name: "Fire Burst",
  asset_name: "fire-burst.par",
};

function renderPreview(placement: MapPlacementRecord | null = buildingPlacement) {
  const store = createStore();
  store.set(currentProjectAtom, {
    id: "project-1",
    name: "Project",
    projectDirectory: "C:/project",
  });

  const result = render(
    <Provider store={store}>
      <MapPlacementBuildingPreview placement={placement} />
    </Provider>,
  );

  return { ...result, store };
}

async function advancePreviewDelay(ms = 250) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function resolveLoad(resolve: (value: string) => void, value: string) {
  await act(async () => {
    resolve(value);
    await Promise.resolve();
  });
}

describe("MapPlacementBuildingPreview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearMapPlacementBuildingPreviewCache();
    getBuildingSceneInfoMock.mockResolvedValue(null);
    loadBuildingModelMock.mockResolvedValue("{\"asset\":{\"version\":\"2.0\"}}");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("derives the preview transform from placement yaw and scale", () => {
    expect(getPlacementPreviewTransform({
      ...buildingPlacement,
      yaw_angle: 90,
      scale: 150,
    })).toEqual({
      yawDegrees: 90,
      yawRadians: Math.PI / 2,
      scaleFactor: 1.5,
      scalePercent: 150,
    });

    expect(getPlacementPreviewTransform({
      ...buildingPlacement,
      scale: 0,
    }).scaleFactor).toBe(1);
  });

  it("loads and renders a compact preview for building placements", async () => {
    vi.useFakeTimers();
    let resolvePreview: (value: string) => void = () => undefined;
    loadBuildingModelMock.mockReturnValueOnce(new Promise((resolve) => {
      resolvePreview = resolve;
    }));
    renderPreview();

    expect(screen.getByRole("region", { name: /Selected building preview Volcano 01/ }))
      .toHaveAttribute("aria-busy", "false");
    expect(screen.getByText("Yaw -180")).toBeInTheDocument();
    expect(screen.getByText("Scale 100%")).toBeInTheDocument();
    expect(screen.getByText("Preview pending")).toBeInTheDocument();
    expect(loadBuildingModelMock).not.toHaveBeenCalled();

    await advancePreviewDelay();

    expect(screen.getByRole("region", { name: /Selected building preview Volcano 01/ }))
      .toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent("Loading preview...");

    expect(loadBuildingModelMock).toHaveBeenCalledWith("project-1", 26);
    await resolveLoad(resolvePreview, "{\"asset\":{\"version\":\"2.0\"}}");

    expect(screen.getByTestId("placement-preview-canvas")).toBeInTheDocument();
    expect(screen.getByTestId("placement-preview-canvas")).toHaveAttribute(
      "data-frameloop",
      "demand",
    );
    expect(screen.getByRole("region", { name: /Selected building preview Volcano 01/ }))
      .toHaveAttribute("aria-busy", "false");
    expect(screen.getByTestId("placement-preview-bounds")).toBeInTheDocument();
    expect(screen.getByTestId("placement-preview-center")).toBeInTheDocument();
    expect(screen.getByTestId("building-model-viewer")).toHaveTextContent("2.0");
    expect(screen.getByTestId("placement-preview-controls")).toBeInTheDocument();
  });

  it("applies placement yaw and scale to the rendered preview model group", async () => {
    vi.useFakeTimers();
    renderPreview({
      ...buildingPlacement,
      yaw_angle: 90,
      scale: 150,
    });

    await advancePreviewDelay();

    const transformGroup = screen
      .getByTestId("placement-preview-center")
      .querySelector("group");
    expect(transformGroup).not.toBeNull();
    expect(transformGroup).toHaveAttribute("rotation", `0,${Math.PI / 2},0`);
    expect(transformGroup).toHaveAttribute("scale", "1.5");
  });

  it("does not load a model for effect placements", () => {
    renderPreview(effectPlacement);

    expect(getBuildingSceneInfoMock).not.toHaveBeenCalled();
    expect(loadBuildingModelMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId("placement-preview-canvas")).not.toBeInTheDocument();
  });

  it("shows scene-object metadata for selected building placements", async () => {
    getBuildingSceneInfoMock.mockResolvedValueOnce({
      building_id: 26,
      filename: "nml-bd151.lmo",
      display_name: "Volcano 01",
      scene_obj_type: 3,
      shade_flag: true,
      enable_point_light: true,
      enable_env_light: true,
      attach_effect_id: 88,
      style: 0,
      flag: 0,
      size_flag: 1,
      anim_ctrl_id: 0,
      is_really_big: true,
      point_color: [255, 128, 64],
      env_color: [16, 32, 48],
      point_range: 1200,
      point_attenuation: 0.5,
      fade_obj_num: 2,
      fade_obj_seq: [4, 5],
      fade_coefficient: 0.35,
    });

    renderPreview(buildingPlacement);

    expect(await screen.findByText("Point light 255, 128, 64")).toBeInTheDocument();
    expect(screen.getByText("Range 1200")).toBeInTheDocument();
    expect(screen.getByText("Env light 16, 32, 48")).toBeInTheDocument();
    expect(screen.getByText("Fade 2 at 35%")).toBeInTheDocument();
    expect(screen.getByText("Tile shade")).toBeInTheDocument();
    expect(screen.getByText("Large object")).toBeInTheDocument();
    expect(screen.getByText("Effect 88")).toBeInTheDocument();
    expect(getBuildingSceneInfoMock).toHaveBeenCalledWith("project-1", 26);
  });

  it("does not cache scene metadata load failures", async () => {
    getBuildingSceneInfoMock
      .mockRejectedValueOnce(new Error("sceneobjinfo read failed"))
      .mockResolvedValueOnce({
        building_id: 26,
        filename: "nml-bd151.lmo",
        display_name: "Volcano 01",
        scene_obj_type: 3,
        shade_flag: false,
        enable_point_light: true,
        enable_env_light: false,
        attach_effect_id: 0,
        style: 0,
        flag: 0,
        size_flag: 0,
        anim_ctrl_id: 0,
        is_really_big: false,
        point_color: [8, 16, 24],
        env_color: [0, 0, 0],
        point_range: 700,
        point_attenuation: 0.25,
        fade_obj_num: 0,
        fade_obj_seq: [],
        fade_coefficient: 0,
      });

    const { rerender, store } = renderPreview(buildingPlacement);

    await waitFor(() => expect(getBuildingSceneInfoMock).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("Point light 8, 16, 24")).not.toBeInTheDocument();

    rerender(
      <Provider store={store}>
        <MapPlacementBuildingPreview placement={null} />
      </Provider>,
    );
    rerender(
      <Provider store={store}>
        <MapPlacementBuildingPreview placement={buildingPlacement} />
      </Provider>,
    );

    expect(await screen.findByText("Point light 8, 16, 24")).toBeInTheDocument();
    expect(getBuildingSceneInfoMock).toHaveBeenCalledTimes(2);
  });

  it("shows a retryable error when the preview load fails", async () => {
    vi.useFakeTimers();
    loadBuildingModelMock
      .mockRejectedValueOnce(new Error("LMO file not found"))
      .mockResolvedValueOnce("{\"asset\":{\"version\":\"2.0\"},\"scene\":0}");

    renderPreview();

    await advancePreviewDelay();

    expect(screen.getByText("Preview unavailable")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Preview unavailable");
    expect(screen.getByText("LMO file not found")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry building preview" }));
    await advancePreviewDelay();

    expect(screen.getByTestId("placement-preview-canvas")).toBeInTheDocument();
    expect(loadBuildingModelMock).toHaveBeenCalledTimes(2);
  });

  it("reuses a cached building preview when the same building is selected again", async () => {
    vi.useFakeTimers();
    const { rerender, store } = renderPreview(buildingPlacement);

    await advancePreviewDelay();

    expect(screen.getByTestId("placement-preview-canvas")).toBeInTheDocument();
    expect(loadBuildingModelMock).toHaveBeenCalledTimes(1);

    rerender(
      <Provider store={store}>
        <MapPlacementBuildingPreview placement={null} />
      </Provider>,
    );
    rerender(
      <Provider store={store}>
        <MapPlacementBuildingPreview placement={buildingPlacement} />
      </Provider>,
    );

    expect(screen.getByTestId("placement-preview-canvas")).toBeInTheDocument();
    expect(loadBuildingModelMock).toHaveBeenCalledTimes(1);
  });

  it("ignores stale load results after switching to a different building", async () => {
    vi.useFakeTimers();
    let resolveFirst: (value: string) => void = () => undefined;
    let resolveSecond: (value: string) => void = () => undefined;
    loadBuildingModelMock
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveFirst = resolve;
      }))
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveSecond = resolve;
      }));

    const nextPlacement = {
      ...buildingPlacement,
      obj_id: 316,
      display_name: "Grass 06",
      asset_name: "nml-bd034.lmo",
    };
    const { rerender, store } = renderPreview(buildingPlacement);

    await advancePreviewDelay();

    rerender(
      <Provider store={store}>
        <MapPlacementBuildingPreview placement={nextPlacement} />
      </Provider>,
    );

    await advancePreviewDelay();

    await resolveLoad(resolveSecond, "{\"asset\":{\"version\":\"second\"}}");
    expect(screen.getByText(/second/)).toBeInTheDocument();

    await resolveLoad(resolveFirst, "{\"asset\":{\"version\":\"first\"}}");

    expect(screen.queryByText(/first/)).not.toBeInTheDocument();
  });

  it("caches stale successful loads so switching back does not reload the building", async () => {
    vi.useFakeTimers();
    let resolveFirst: (value: string) => void = () => undefined;
    let resolveSecond: (value: string) => void = () => undefined;
    loadBuildingModelMock
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveFirst = resolve;
      }))
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveSecond = resolve;
      }));

    const nextPlacement = {
      ...buildingPlacement,
      obj_id: 316,
      display_name: "Grass 06",
      asset_name: "nml-bd034.lmo",
    };
    const { rerender, store } = renderPreview(buildingPlacement);

    await advancePreviewDelay();
    rerender(
      <Provider store={store}>
        <MapPlacementBuildingPreview placement={nextPlacement} />
      </Provider>,
    );
    await advancePreviewDelay();

    await resolveLoad(resolveFirst, "{\"asset\":{\"version\":\"stale-cached\"}}");
    await resolveLoad(resolveSecond, "{\"asset\":{\"version\":\"second\"}}");
    expect(screen.getByText(/second/)).toBeInTheDocument();

    rerender(
      <Provider store={store}>
        <MapPlacementBuildingPreview placement={buildingPlacement} />
      </Provider>,
    );

    expect(screen.getByText(/stale-cached/)).toBeInTheDocument();
    expect(loadBuildingModelMock).toHaveBeenCalledTimes(2);
  });

  it("does not start loading if selection changes before the preview delay elapses", async () => {
    vi.useFakeTimers();
    const nextPlacement = {
      ...buildingPlacement,
      obj_id: 316,
      display_name: "Grass 06",
      asset_name: "nml-bd034.lmo",
    };
    const { rerender, store } = renderPreview(buildingPlacement);

    await advancePreviewDelay(100);
    rerender(
      <Provider store={store}>
        <MapPlacementBuildingPreview placement={nextPlacement} />
      </Provider>,
    );
    await advancePreviewDelay();

    expect(loadBuildingModelMock).toHaveBeenCalledTimes(1);
    expect(loadBuildingModelMock).toHaveBeenCalledWith("project-1", 316);
  });

  it("shares one in-flight load for duplicate selected buildings", async () => {
    vi.useFakeTimers();
    let resolvePreview: (value: string) => void = () => undefined;
    loadBuildingModelMock.mockReturnValueOnce(new Promise((resolve) => {
      resolvePreview = resolve;
    }));

    const { store } = renderPreview(buildingPlacement);
    render(
      <Provider store={store}>
        <MapPlacementBuildingPreview placement={buildingPlacement} />
      </Provider>,
    );

    await advancePreviewDelay();
    expect(loadBuildingModelMock).toHaveBeenCalledTimes(1);

    await resolveLoad(resolvePreview, "{\"asset\":{\"version\":\"shared\"}}");
    expect(screen.getAllByText(/shared/)).toHaveLength(2);
  });

  it("evicts old preview cache entries instead of retaining every building", async () => {
    vi.useFakeTimers();
    const { rerender, store } = renderPreview(buildingPlacement);

    for (let id = 1; id <= 7; id += 1) {
      loadBuildingModelMock.mockResolvedValueOnce(`{\"asset\":{\"version\":\"${id}\"}}`);
      rerender(
        <Provider store={store}>
          <MapPlacementBuildingPreview
            placement={{
              ...buildingPlacement,
              obj_id: id,
              display_name: `Building ${id}`,
            }}
          />
        </Provider>,
      );
      await advancePreviewDelay();
      expect(screen.getByText(new RegExp(`\"${id}\"`))).toBeInTheDocument();
    }

    loadBuildingModelMock.mockResolvedValueOnce("{\"asset\":{\"version\":\"reload-1\"}}");
    rerender(
      <Provider store={store}>
        <MapPlacementBuildingPreview
          placement={{
            ...buildingPlacement,
            obj_id: 1,
            display_name: "Building 1",
          }}
        />
      </Provider>,
    );
    await advancePreviewDelay();

    expect(loadBuildingModelMock).toHaveBeenCalledWith("project-1", 1);
    expect(screen.getByText(/reload-1/)).toBeInTheDocument();
  });
});
