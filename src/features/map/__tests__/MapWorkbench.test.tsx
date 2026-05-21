import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import MapWorkbench from "../MapWorkbench";
import { currentProjectAtom } from "@/store/project";
import { selectedMapAtom } from "@/store/map";
import type { MapPlacementRecord } from "@/types/map";
import type { MapTileBounds } from "../mapWorkbenchView";

const mapChunkedWorkbenchMock = vi.hoisted(() =>
  vi.fn(({
    onSelectedTileChange,
    onSelectedPlacementViewChange,
    onViewportBoundsChange,
    rightOverlayInset,
    rightDockInset,
    showSelectedPlacementPreview,
  }) => (
    <button
      type="button"
      data-testid="chunked-map"
      data-right-overlay-inset={rightOverlayInset}
      data-right-dock-inset={rightDockInset ?? ""}
      onClick={() => {
        onSelectedTileChange({ x: 32, y: 48 });
        onSelectedPlacementViewChange?.({
          ...browserPlacement,
          world_x: 120.2,
          world_y: 15.2,
        });
        onViewportBoundsChange?.({ minX: 10, minY: 20, maxX: 30, maxY: 40 }, "garner");
      }}
    >
      Select tile {rightOverlayInset} preview {String(showSelectedPlacementPreview)}
    </button>
  ))
);
const browserPlacement = vi.hoisted<MapPlacementRecord>(() => ({
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
}));
const mapPlacementBrowserMock = vi.hoisted(() =>
  vi.fn(({
    selectedPlacement,
    selectedTile,
    visibleBounds,
    onCollapse,
    onSelectPlacement,
    onPlacementFilterChange,
  }) => (
    <div data-testid="placement-browser">
      <input aria-label="Placement browser filter" />
      <button
        type="button"
        aria-label="Select browser placement"
        onClick={() => onSelectPlacement(browserPlacement)}
      >
        Select placement
      </button>
      <button
        type="button"
        aria-label="Apply placement filter"
        onClick={() => onPlacementFilterChange({
          query: "grass",
          placementType: "building",
          nearEnabled: true,
          nearX: undefined,
          nearY: undefined,
          nearRadius: undefined,
          useVisibleBounds: true,
          valid: true,
        })}
      >
        Apply filter
      </button>
      <button
        type="button"
        aria-label="Collapse placements panel"
        onClick={onCollapse}
      >
        Collapse
      </button>
      {selectedTile ? `${selectedTile.x},${selectedTile.y}` : "no tile"}
      {visibleBounds
        ? ` bounds ${visibleBounds.minX},${visibleBounds.minY},${visibleBounds.maxX},${visibleBounds.maxY}`
        : " no bounds"}
      {selectedPlacement
        ? ` selected ${selectedPlacement.world_x},${selectedPlacement.world_y}`
        : " no selected"}
    </div>
  ))
);

vi.mock("../MapChunkedWorkbench", () => ({
  default: mapChunkedWorkbenchMock,
}));

vi.mock("../MapPlacementBrowser", () => ({
  default: mapPlacementBrowserMock,
}));

describe("MapWorkbench", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("keeps the 2D workbench and side browser inside a non-scrolling viewport shell", () => {
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

    render(
      <Provider store={store}>
        <MapWorkbench />
      </Provider>,
    );

    expect(screen.getByTestId("map-workbench-shell")).toHaveClass(
      "min-h-0",
      "min-w-0",
      "overflow-hidden",
    );
    expect(screen.getByTestId("map-workbench-stage")).toHaveClass(
      "relative",
      "min-h-0",
      "min-w-0",
      "overflow-hidden",
    );
    expect(screen.getByTestId("map-workbench-canvas-pane")).toHaveClass(
      "h-full",
      "w-full",
      "min-h-0",
      "min-w-0",
      "overflow-hidden",
    );
  });

  it("starts with a compact placement rail so the editor keeps most of the width", () => {
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

    render(
      <Provider store={store}>
        <MapWorkbench />
      </Provider>,
    );

    expect(screen.getByTestId("map-placement-browser-rail")).toHaveClass(
      "absolute",
      "right-3",
      "w-12",
    );
    expect(screen.getByRole("button", { name: "Open placements panel" }))
      .toBeInTheDocument();
    const rail = screen.getByTestId("map-placement-browser-rail");
    expect(within(rail).getByTestId("map-placement-rail-open-label"))
      .toHaveTextContent("Panel");
    expect(within(rail).getByTestId("map-placement-rail-focus-label"))
      .toHaveTextContent("Focus");
    expect(screen.getByTestId("map-placement-browser-pane")).toHaveClass(
      "w-0",
      "opacity-0",
      "pointer-events-none",
    );
    expect(screen.queryByTestId("placement-browser")).not.toBeInTheDocument();
    expect(screen.getByTestId("chunked-map")).toHaveTextContent("Select tile 60 preview true");
  });

  it("can hide placement tools to give the map canvas the full workbench width", () => {
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

    render(
      <Provider store={store}>
        <MapWorkbench />
      </Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Maximize map editor" }));

    expect(screen.queryByTestId("map-placement-browser-rail")).not.toBeInTheDocument();
    expect(screen.getByTestId("chunked-map")).toHaveAttribute("data-right-overlay-inset", "0");
    expect(screen.getByTestId("chunked-map")).toHaveAttribute("data-right-dock-inset", "0");

    const restorePlacementTools = screen.getByRole("button", {
      name: "Placements, restore placement tools",
    });
    expect(restorePlacementTools).toHaveTextContent("Placements");

    fireEvent.click(restorePlacementTools);

    expect(screen.getByTestId("map-placement-browser-rail")).toBeInTheDocument();
    expect(screen.getByTestId("chunked-map")).toHaveAttribute("data-right-overlay-inset", "60");
  });

  it("passes the placement browser filter into the canvas workbench", async () => {
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

    render(
      <Provider store={store}>
        <MapWorkbench />
      </Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open placements panel" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply placement filter" }));

    await waitFor(() =>
      expect(mapChunkedWorkbenchMock.mock.lastCall?.[0]).toEqual(
        expect.objectContaining({
          placementFilter: {
            query: "grass",
            placementType: "building",
            nearEnabled: true,
            nearX: undefined,
            nearY: undefined,
            nearRadius: undefined,
            useVisibleBounds: true,
            valid: true,
          },
        }),
      )
    );
  });

  it("asks the canvas inspector to compact while the placement drawer is open", async () => {
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

    render(
      <Provider store={store}>
        <MapWorkbench />
      </Provider>,
    );

    expect(mapChunkedWorkbenchMock.mock.lastCall?.[0]).toEqual(
      expect.objectContaining({ preferCollapsedInspector: false }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Open placements panel" }));

    await waitFor(() =>
      expect(mapChunkedWorkbenchMock.mock.lastCall?.[0]).toEqual(
        expect.objectContaining({ preferCollapsedInspector: true }),
      )
    );
  });

  it("marks the compact placement rail when a hidden placement filter is active", async () => {
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

    render(
      <Provider store={store}>
        <MapWorkbench />
      </Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open placements panel" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply placement filter" }));
    fireEvent.click(screen.getByRole("button", { name: "Collapse placements panel" }));

    expect(screen.getByTestId("map-placement-filter-indicator")).toHaveTextContent("View");
    expect(screen.getByTestId("map-placement-filter-indicator"))
      .toHaveAttribute("title", "Placement browser filter follows the visible map view");
    expect(screen.getByRole("button", { name: "Open placements panel, view filter active" }))
      .toBeInTheDocument();
  });

  it("clears placement filters when switching maps", async () => {
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

    render(
      <Provider store={store}>
        <MapWorkbench />
      </Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open placements panel" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply placement filter" }));

    await waitFor(() =>
      expect(mapChunkedWorkbenchMock.mock.lastCall?.[0]).toEqual(
        expect.objectContaining({
          placementFilter: expect.objectContaining({
            query: "grass",
            useVisibleBounds: true,
          }),
        }),
      )
    );

    const beforeSwitchCallCount = mapChunkedWorkbenchMock.mock.calls.length;

    act(() => {
      store.set(selectedMapAtom, {
        name: "pkmap",
        display_name: "PKmap",
        map_file: "pkmap.map",
        has_obj: true,
        has_rbo: false,
        width: 128,
        height: 128,
      });
    });

    await waitFor(() =>
      expect(mapChunkedWorkbenchMock.mock.calls.length).toBeGreaterThan(beforeSwitchCallCount)
    );
    const callsAfterMapSwitch = mapChunkedWorkbenchMock.mock.calls
      .slice(beforeSwitchCallCount)
      .map(([props]) => props);
    expect(callsAfterMapSwitch).not.toHaveLength(0);
    expect(callsAfterMapSwitch.every((props) => props.placementFilter === null))
      .toBe(true);
    await waitFor(() =>
      expect(mapChunkedWorkbenchMock.mock.lastCall?.[0]).toEqual(
        expect.objectContaining({
          placementFilter: null,
        }),
      )
    );
    expect(screen.queryByTestId("map-placement-filter-indicator")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open placements panel" }))
      .toBeInTheDocument();
    expect(screen.queryByTestId("placement-browser")).not.toBeInTheDocument();
  });

  it("clears selected placements and focus requests when switching maps", async () => {
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

    render(
      <Provider store={store}>
        <MapWorkbench />
      </Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open placements panel" }));
    fireEvent.click(screen.getByRole("button", { name: "Select browser placement" }));

    await waitFor(() =>
      expect(mapChunkedWorkbenchMock.mock.lastCall?.[0]).toEqual(
        expect.objectContaining({
          selectedPlacement: browserPlacement,
          placementFocusRequest: expect.objectContaining({
            placement: browserPlacement,
          }),
        }),
      )
    );

    const beforeSwitchCallCount = mapChunkedWorkbenchMock.mock.calls.length;

    act(() => {
      store.set(selectedMapAtom, {
        name: "pkmap",
        display_name: "PKmap",
        map_file: "pkmap.map",
        has_obj: true,
        has_rbo: false,
        width: 128,
        height: 128,
      });
    });

    await waitFor(() =>
      expect(mapChunkedWorkbenchMock.mock.calls.length).toBeGreaterThan(beforeSwitchCallCount)
    );
    const callsAfterMapSwitch = mapChunkedWorkbenchMock.mock.calls
      .slice(beforeSwitchCallCount)
      .map(([props]) => props);
    expect(callsAfterMapSwitch).not.toHaveLength(0);
    expect(callsAfterMapSwitch.every((props) =>
      props.selectedPlacement === null && props.placementFocusRequest === null
    )).toBe(true);
    expect(screen.getByRole("button", { name: "Open placements panel" }))
      .toBeInTheDocument();
  });

  it("clears selected tiles and visible bounds when switching maps", async () => {
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

    render(
      <Provider store={store}>
        <MapWorkbench />
      </Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open placements panel" }));
    fireEvent.click(screen.getByTestId("chunked-map"));

    expect(screen.getByTestId("placement-browser")).toHaveTextContent("32,48");
    expect(screen.getByTestId("placement-browser")).toHaveTextContent("bounds 10,20,30,40");

    const beforeSwitchCallCount = mapPlacementBrowserMock.mock.calls.length;

    act(() => {
      store.set(selectedMapAtom, {
        name: "pkmap",
        display_name: "PKmap",
        map_file: "pkmap.map",
        has_obj: true,
        has_rbo: false,
        width: 128,
        height: 128,
      });
    });

    await waitFor(() =>
      expect(screen.queryByTestId("placement-browser")).not.toBeInTheDocument()
    );
    expect(mapPlacementBrowserMock.mock.calls.length).toBe(beforeSwitchCallCount);

    fireEvent.click(screen.getByRole("button", { name: "Open placements panel" }));

    await waitFor(() =>
      expect(mapPlacementBrowserMock.mock.calls.length).toBeGreaterThan(beforeSwitchCallCount)
    );
    const browserCallsAfterMapSwitch = mapPlacementBrowserMock.mock.calls
      .slice(beforeSwitchCallCount)
      .map(([props]) => props);
    expect(browserCallsAfterMapSwitch).not.toHaveLength(0);
    expect(browserCallsAfterMapSwitch.every((props) =>
      props.selectedTile === null && props.visibleBounds === null
    )).toBe(true);
    expect(screen.getByTestId("placement-browser")).toHaveTextContent("no tile");
    expect(screen.getByTestId("placement-browser")).toHaveTextContent("no bounds");
  });

  it("ignores viewport bounds reported for a different map", async () => {
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

    render(
      <Provider store={store}>
        <MapWorkbench />
      </Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open placements panel" }));
    expect(screen.getByTestId("placement-browser")).toHaveTextContent("no bounds");

    const beforeStaleBoundsCallCount = mapPlacementBrowserMock.mock.calls.length;
    const onViewportBoundsChange = mapChunkedWorkbenchMock.mock.lastCall?.[0]
      .onViewportBoundsChange as (
        bounds: MapTileBounds | null,
        sourceMapName?: string | null,
      ) => void;

    act(() => {
      onViewportBoundsChange({ minX: 100, minY: 200, maxX: 300, maxY: 400 }, "oldmap");
    });

    expect(mapPlacementBrowserMock.mock.calls.length).toBe(beforeStaleBoundsCallCount);
    expect(screen.getByTestId("placement-browser")).toHaveTextContent("no bounds");
  });

  it("does not render the previous map placement panel after switching maps", async () => {
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

    render(
      <Provider store={store}>
        <MapWorkbench />
      </Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open placements panel" }));
    expect(screen.getByTestId("placement-browser")).toBeInTheDocument();
    const beforeSwitchCallCount = mapPlacementBrowserMock.mock.calls.length;

    act(() => {
      store.set(selectedMapAtom, {
        name: "pkmap",
        display_name: "PKmap",
        map_file: "pkmap.map",
        has_obj: true,
        has_rbo: false,
        width: 128,
        height: 128,
      });
    });

    await waitFor(() =>
      expect(mapChunkedWorkbenchMock.mock.calls.length).toBeGreaterThan(1)
    );
    expect(mapPlacementBrowserMock.mock.calls.length).toBe(beforeSwitchCallCount);
    expect(screen.queryByTestId("placement-browser")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open placements panel" }))
      .toBeInTheDocument();
  });

  it("keeps maps on the native 2D workbench instead of exposing map glTF terrain mode", () => {
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

    render(
      <Provider store={store}>
        <MapWorkbench />
      </Provider>,
    );

    expect(screen.queryByRole("button", { name: "3D Terrain" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load 3D Terrain" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("map-terrain-canvas")).not.toBeInTheDocument();
  });

  it("opens and collapses the full placement browser without leaving the workbench shell", () => {
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

    render(
      <Provider store={store}>
        <MapWorkbench />
      </Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open placements panel" }));

    expect(screen.getByTestId("map-placement-browser-pane")).toHaveClass(
      "absolute",
      "right-3",
      "top-3",
      "bottom-3",
      "overflow-hidden",
      "w-80",
    );
    expect(screen.getByTestId("map-workbench-canvas-pane")).toHaveClass(
      "h-full",
      "w-full",
    );
    expect(screen.getByTestId("chunked-map")).toHaveTextContent("Select tile 332 preview false");
    expect(screen.getByTestId("map-placement-browser-pane")).not.toHaveClass("w-0");
    expect(screen.getByTestId("placement-browser")).toBeInTheDocument();
    expect(screen.getByTestId("chunked-map")).toHaveAttribute(
      "data-right-overlay-inset",
      "332",
    );
    expect(screen.getByTestId("chunked-map")).toHaveAttribute(
      "data-right-dock-inset",
      "332",
    );

    fireEvent.click(screen.getByRole("button", { name: "Collapse placements panel" }));

    expect(screen.getByTestId("map-placement-browser-rail")).toBeInTheDocument();
    expect(screen.getByTestId("map-placement-browser-pane")).toHaveClass(
      "w-0",
      "opacity-0",
      "pointer-events-none",
    );
    expect(screen.getByTestId("chunked-map")).toHaveTextContent("Select tile 60 preview true");
  });

  it("caps the placement panel dock inset to the available workbench width", async () => {
    vi.stubGlobal("ResizeObserver", class {
      private readonly callback: ResizeObserverCallback;

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }

      observe() {
        this.callback([{
          contentRect: { width: 260 },
        } as ResizeObserverEntry], this as unknown as ResizeObserver);
      }

      unobserve() {}

      disconnect() {}
    });
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

    render(
      <Provider store={store}>
        <MapWorkbench />
      </Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open placements panel" }));

    await waitFor(() =>
      expect(screen.getByTestId("chunked-map")).toHaveAttribute(
        "data-right-dock-inset",
        "248",
      )
    );
    expect(screen.getByTestId("chunked-map")).toHaveAttribute(
      "data-right-overlay-inset",
      "248",
    );
  });

  it("collapses the placement browser with Escape from inside the panel", () => {
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

    render(
      <Provider store={store}>
        <MapWorkbench />
      </Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open placements panel" }));
    fireEvent.keyDown(screen.getByLabelText("Placement browser filter"), { key: "Escape" });

    expect(screen.getByTestId("map-placement-browser-rail")).toBeInTheDocument();
    expect(screen.getByTestId("map-placement-browser-pane")).toHaveClass(
      "w-0",
      "opacity-0",
      "pointer-events-none",
    );
    expect(screen.getByTestId("chunked-map")).toHaveTextContent("Select tile 60 preview true");
  });

  it("keeps placement browser state mounted while the panel is collapsed", () => {
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

    render(
      <Provider store={store}>
        <MapWorkbench />
      </Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open placements panel" }));
    fireEvent.change(screen.getByLabelText("Placement browser filter"), {
      target: { value: "volcano" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Collapse placements panel" }));
    fireEvent.click(screen.getByRole("button", { name: "Open placements panel" }));

    expect(screen.getByLabelText("Placement browser filter")).toHaveValue("volcano");
  });

  it("shares the inspected map tile with the placement browser", () => {
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

    render(
      <Provider store={store}>
        <MapWorkbench />
      </Provider>,
    );

    fireEvent.click(screen.getByTestId("chunked-map"));
    fireEvent.click(screen.getByRole("button", { name: "Open placements panel" }));

    expect(screen.getByTestId("placement-browser")).toHaveTextContent("32,48");
    expect(screen.getByTestId("placement-browser")).toHaveTextContent("bounds 10,20,30,40");
  });

  it("shares the draft-applied selected placement view with the placement browser", () => {
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

    render(
      <Provider store={store}>
        <MapWorkbench />
      </Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open placements panel" }));
    fireEvent.click(screen.getByTestId("chunked-map"));

    expect(mapPlacementBrowserMock.mock.lastCall?.[0]).toEqual(
      expect.objectContaining({
        selectedPlacement: expect.objectContaining({
          index: 12,
          world_x: 120.2,
          world_y: 15.2,
        }),
      }),
    );
    expect(screen.getByTestId("placement-browser")).toHaveTextContent("selected 120.2,15.2");
  });

  it("asks the workbench to frame placements selected from the browser", () => {
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

    render(
      <Provider store={store}>
        <MapWorkbench />
      </Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open placements panel" }));
    fireEvent.click(screen.getByRole("button", { name: "Select browser placement" }));

    expect(mapChunkedWorkbenchMock.mock.lastCall?.[0]).toEqual(
      expect.objectContaining({
        selectedPlacement: browserPlacement,
        placementFocusRequest: expect.objectContaining({
          placement: browserPlacement,
          nonce: expect.any(Number),
        }),
      }),
    );
  });
});
