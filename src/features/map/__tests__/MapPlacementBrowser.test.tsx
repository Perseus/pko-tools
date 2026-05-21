import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider, createStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MapPlacementBrowser from "../MapPlacementBrowser";
import { currentProjectAtom } from "@/store/project";
import { selectedMapAtom } from "@/store/map";
import type { MapPlacementRecord } from "@/types/map";
import type { MapTileBounds } from "../mapWorkbenchView";

const getMapPlacementSummaryMock = vi.fn();
const queryMapPlacementsMock = vi.fn();
const mapPlacementBuildingPreviewMock = vi.hoisted(() =>
  vi.fn(({ placement }: { placement: MapPlacementRecord | null }) => (
    <div data-testid="placement-browser-building-preview">
      {placement?.display_name ?? "No placement"}
    </div>
  )),
);

vi.mock("@/commands/map", () => ({
  getMapPlacementSummary: (...args: unknown[]) => getMapPlacementSummaryMock(...args),
  queryMapPlacements: (...args: unknown[]) => queryMapPlacementsMock(...args),
}));

vi.mock("../MapPlacementBuildingPreview", () => ({
  default: (props: { placement: MapPlacementRecord | null }) =>
    mapPlacementBuildingPreviewMock(props),
}));

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

function createBrowserStore() {
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

function renderBrowser(
  selectedTile: { x: number; y: number } | null,
  options: {
    onCollapse?: () => void;
    collapsed?: boolean;
    onSelectPlacement?: () => void;
    onPlacementFilterChange?: Parameters<typeof MapPlacementBrowser>[0]["onPlacementFilterChange"];
    selectedPlacement?: MapPlacementRecord | null;
    visibleBounds?: MapTileBounds | null;
  } = {},
) {
  const store = createBrowserStore();

  return render(
    <Provider store={store}>
      <MapPlacementBrowser
        onSelectPlacement={options.onSelectPlacement ?? (() => undefined)}
        selectedPlacement={options.selectedPlacement ?? null}
        selectedTile={selectedTile}
        visibleBounds={options.visibleBounds ?? null}
        onPlacementFilterChange={options.onPlacementFilterChange}
        onCollapse={options.onCollapse}
        collapsed={options.collapsed}
      />
    </Provider>,
  );
}

describe("MapPlacementBrowser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMapPlacementSummaryMock.mockResolvedValue({
      total: 0,
      building_count: 0,
      effect_count: 0,
    });
    queryMapPlacementsMock.mockResolvedValue({
      total: 0,
      offset: 0,
      limit: 200,
      items: [],
    });
  });

  it("uses the selected map tile as a near-search anchor", async () => {
    const user = userEvent.setup();
    renderBrowser({ x: 32, y: 48 });

    await waitFor(() => expect(queryMapPlacementsMock).toHaveBeenCalled());
    queryMapPlacementsMock.mockClear();

    await user.click(screen.getByRole("button", { name: "Use selected tile 32, 48" }));

    expect(screen.getByLabelText("Point X")).toHaveValue("32");
    expect(screen.getByLabelText("Point Y")).toHaveValue("48");
    expect(screen.getByRole("button", { name: "Search point radius" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Search point radius" }))
      .toBeInTheDocument();
    await waitFor(() =>
      expect(queryMapPlacementsMock).toHaveBeenCalledWith(
        "project-1",
        "garner",
        undefined,
        "all",
        32,
        48,
        50,
        0,
        200,
      )
    );
  });

  it("uses the visible map view as the near-search scope", async () => {
    const user = userEvent.setup();
    renderBrowser(null, {
      visibleBounds: { minX: 10.2, minY: 20.8, maxX: 42.1, maxY: 52.9 },
    });

    await waitFor(() => expect(queryMapPlacementsMock).toHaveBeenCalled());
    queryMapPlacementsMock.mockClear();

    await user.click(screen.getByRole("button", { name: "Search visible map view" }));

    expect(screen.getByRole("button", { name: "Search visible map view" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Search visible map view" }))
      .toBeInTheDocument();
    expect(screen.getByText("Visible view 10, 20 to 43, 53")).toBeInTheDocument();
    await waitFor(() =>
      expect(queryMapPlacementsMock).toHaveBeenCalledWith(
        "project-1",
        "garner",
        undefined,
        "all",
        undefined,
        undefined,
        undefined,
        0,
        200,
        10,
        20,
        43,
        53,
      )
    );
  });

  it("debounces visible-view placement reloads while the viewport is changing", async () => {
    const user = userEvent.setup();
    const store = createBrowserStore();
    const renderWithBounds = (visibleBounds: MapTileBounds) => (
      <Provider store={store}>
        <MapPlacementBrowser
          onSelectPlacement={() => undefined}
          selectedPlacement={null}
          selectedTile={null}
          visibleBounds={visibleBounds}
        />
      </Provider>
    );
    const { rerender } = render(renderWithBounds({
      minX: 10,
      minY: 20,
      maxX: 43,
      maxY: 53,
    }));

    await waitFor(() => expect(queryMapPlacementsMock).toHaveBeenCalled());
    queryMapPlacementsMock.mockClear();

    await user.click(screen.getByRole("button", { name: "Search visible map view" }));
    await waitFor(() => expect(queryMapPlacementsMock).toHaveBeenCalled());
    queryMapPlacementsMock.mockClear();

    rerender(renderWithBounds({ minX: 100.1, minY: 120.1, maxX: 140.1, maxY: 160.1 }));
    rerender(renderWithBounds({ minX: 101.1, minY: 121.1, maxX: 141.1, maxY: 161.1 }));
    rerender(renderWithBounds({ minX: 102.1, minY: 122.1, maxX: 142.1, maxY: 162.1 }));

    await new Promise((resolve) => window.setTimeout(resolve, 60));
    expect(queryMapPlacementsMock).not.toHaveBeenCalled();

    await waitFor(() => expect(queryMapPlacementsMock).toHaveBeenCalledTimes(1));
    expect(queryMapPlacementsMock).toHaveBeenLastCalledWith(
      "project-1",
      "garner",
      undefined,
      "all",
      undefined,
      undefined,
      undefined,
      0,
      200,
      102,
      122,
      143,
      163,
    );
  });

  it("makes visible-view and point placement scopes explicit", async () => {
    const user = userEvent.setup();
    renderBrowser({ x: 32, y: 48 }, {
      visibleBounds: { minX: 10.2, minY: 20.8, maxX: 42.1, maxY: 52.9 },
    });

    await waitFor(() => expect(queryMapPlacementsMock).toHaveBeenCalled());
    queryMapPlacementsMock.mockClear();

    expect(screen.getByRole("button", { name: "Search whole map" }))
      .toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "Search visible map view" }));

    expect(screen.getByRole("button", { name: "Search visible map view" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Point radius")).toBeEnabled();
    expect(screen.getByText("Visible view 10, 20 to 43, 53")).toBeInTheDocument();
    await waitFor(() =>
      expect(queryMapPlacementsMock).toHaveBeenCalledWith(
        "project-1",
        "garner",
        undefined,
        "all",
        undefined,
        undefined,
        undefined,
        0,
        200,
        10,
        20,
        43,
        53,
      )
    );

    queryMapPlacementsMock.mockClear();
    await user.click(screen.getByRole("button", { name: "Use selected tile 32, 48" }));

    expect(screen.getByRole("button", { name: "Search visible map view" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Point radius")).toBeEnabled();
    await waitFor(() =>
      expect(queryMapPlacementsMock).toHaveBeenCalledWith(
        "project-1",
        "garner",
        undefined,
        "all",
        32,
        48,
        50,
        0,
        200,
        10,
        20,
        43,
        53,
      )
    );
  });

  it("publishes the active filter so canvas markers can mirror the browser", async () => {
    const user = userEvent.setup();
    const onPlacementFilterChange = vi.fn();
    renderBrowser(null, {
      onPlacementFilterChange,
      visibleBounds: { minX: 10.2, minY: 20.8, maxX: 42.1, maxY: 52.9 },
    });

    await waitFor(() => expect(queryMapPlacementsMock).toHaveBeenCalled());
    onPlacementFilterChange.mockClear();

    await user.type(screen.getByPlaceholderText("Search by id, name, file..."), "grass");
    await user.click(screen.getByRole("button", { name: "Search visible map view" }));

    await waitFor(() =>
      expect(onPlacementFilterChange).toHaveBeenLastCalledWith({
        query: "grass",
        placementType: "all",
        nearEnabled: true,
        nearX: undefined,
        nearY: undefined,
        nearRadius: undefined,
        useVisibleBounds: true,
        valid: true,
      })
    );
  });

  it("keeps publishing marker filters while collapsed without fetching hidden list pages", async () => {
    const onPlacementFilterChange = vi.fn();
    const store = createBrowserStore();
    const renderWithCollapsed = (collapsed: boolean) => (
      <Provider store={store}>
        <MapPlacementBrowser
          onSelectPlacement={() => undefined}
          selectedPlacement={null}
          selectedTile={null}
          visibleBounds={{ minX: 10.2, minY: 20.8, maxX: 42.1, maxY: 52.9 }}
          onPlacementFilterChange={onPlacementFilterChange}
          collapsed={collapsed}
        />
      </Provider>
    );
    const { rerender } = render(renderWithCollapsed(true));

    await waitFor(() =>
      expect(onPlacementFilterChange).toHaveBeenLastCalledWith({
        query: "",
        placementType: "all",
        nearEnabled: false,
        nearX: undefined,
        nearY: undefined,
        nearRadius: undefined,
        useVisibleBounds: false,
        valid: true,
      })
    );
    await new Promise((resolve) => window.setTimeout(resolve, 25));

    expect(queryMapPlacementsMock).not.toHaveBeenCalled();

    rerender(renderWithCollapsed(false));

    await waitFor(() => expect(queryMapPlacementsMock).toHaveBeenCalledWith(
      "project-1",
      "garner",
      undefined,
      "all",
      undefined,
      undefined,
      undefined,
      0,
      200,
    ));
  });

  it("uses manual coordinates as an optional refinement of the visible view", async () => {
    const user = userEvent.setup();
    const onPlacementFilterChange = vi.fn();
    renderBrowser(null, {
      onPlacementFilterChange,
      visibleBounds: { minX: 10, minY: 20, maxX: 43, maxY: 53 },
    });

    await waitFor(() => expect(queryMapPlacementsMock).toHaveBeenCalled());
    queryMapPlacementsMock.mockClear();
    onPlacementFilterChange.mockClear();

    await user.click(screen.getByRole("button", { name: "Search visible map view" }));

    expect(screen.getByLabelText("Point X")).toBeEnabled();
    expect(screen.getByLabelText("Point Y")).toBeEnabled();
    expect(screen.getByLabelText("Point radius")).toBeEnabled();

    await user.type(screen.getByLabelText("Point X"), "32");
    await user.type(screen.getByLabelText("Point Y"), "48");
    await user.clear(screen.getByLabelText("Point radius"));
    await user.type(screen.getByLabelText("Point radius"), "75");

    await waitFor(() =>
      expect(queryMapPlacementsMock).toHaveBeenLastCalledWith(
        "project-1",
        "garner",
        undefined,
        "all",
        32,
        48,
        75,
        0,
        200,
        10,
        20,
        43,
        53,
      )
    );
    await waitFor(() =>
      expect(onPlacementFilterChange).toHaveBeenLastCalledWith({
        query: "",
        placementType: "all",
        nearEnabled: true,
        nearX: 32,
        nearY: 48,
        nearRadius: 75,
        useVisibleBounds: true,
        valid: true,
      })
    );
  });

  it("keeps selected-tile refinement in visible-view scope when bounds exist", async () => {
    const user = userEvent.setup();
    const onPlacementFilterChange = vi.fn();
    renderBrowser({ x: 32, y: 48 }, {
      onPlacementFilterChange,
      visibleBounds: { minX: 10, minY: 20, maxX: 43, maxY: 53 },
    });

    await waitFor(() => expect(queryMapPlacementsMock).toHaveBeenCalled());
    queryMapPlacementsMock.mockClear();
    onPlacementFilterChange.mockClear();

    await user.click(screen.getByRole("button", { name: "Search visible map view" }));
    await user.click(screen.getByRole("button", { name: "Use selected tile 32, 48" }));

    expect(screen.getByRole("button", { name: "Search visible map view" }))
      .toHaveAttribute("aria-pressed", "true");

    await waitFor(() =>
      expect(queryMapPlacementsMock).toHaveBeenLastCalledWith(
        "project-1",
        "garner",
        undefined,
        "all",
        32,
        48,
        50,
        0,
        200,
        10,
        20,
        43,
        53,
      )
    );
    await waitFor(() =>
      expect(onPlacementFilterChange).toHaveBeenLastCalledWith({
        query: "",
        placementType: "all",
        nearEnabled: true,
        nearX: 32,
        nearY: 48,
        nearRadius: 50,
        useVisibleBounds: true,
        valid: true,
      })
    );
  });

  it("does not refetch or reset from visible bounds changes while near search is off", async () => {
    const store = createBrowserStore();
    const { rerender } = render(
      <Provider store={store}>
        <MapPlacementBrowser
          onSelectPlacement={() => undefined}
          selectedPlacement={null}
          selectedTile={null}
          visibleBounds={{ minX: 10, minY: 20, maxX: 30, maxY: 40 }}
        />
      </Provider>,
    );

    await waitFor(() => expect(queryMapPlacementsMock).toHaveBeenCalled());
    queryMapPlacementsMock.mockClear();

    rerender(
      <Provider store={store}>
        <MapPlacementBrowser
          onSelectPlacement={() => undefined}
          selectedPlacement={null}
          selectedTile={null}
          visibleBounds={{ minX: 100, minY: 120, maxX: 130, maxY: 140 }}
        />
      </Provider>,
    );

    await new Promise((resolve) => window.setTimeout(resolve, 25));

    expect(queryMapPlacementsMock).not.toHaveBeenCalled();
  });

  it("keeps manual near coordinates as a refinement inside the visible view", async () => {
    const user = userEvent.setup();
    renderBrowser({ x: 32, y: 48 }, {
      visibleBounds: { minX: 10, minY: 20, maxX: 43, maxY: 53 },
    });

    await waitFor(() => expect(queryMapPlacementsMock).toHaveBeenCalled());
    queryMapPlacementsMock.mockClear();

    await user.click(screen.getByRole("button", { name: "Use selected tile 32, 48" }));

    await waitFor(() =>
      expect(queryMapPlacementsMock).toHaveBeenCalledWith(
        "project-1",
        "garner",
        undefined,
        "all",
        32,
        48,
        50,
        0,
        200,
        10,
        20,
        43,
        53,
      )
    );
  });

  it("clears loading when near search becomes invalid while a query is pending", async () => {
    const user = userEvent.setup();
    queryMapPlacementsMock.mockReturnValue(new Promise(() => undefined));
    const { container } = renderBrowser(null);

    await waitFor(() => expect(queryMapPlacementsMock).toHaveBeenCalled());
    expect(container.querySelector(".animate-spin")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Search point radius" }));

    expect(screen.getByText("Enter numeric x, y, and radius values to search around a point."))
      .toBeInTheDocument();
    await waitFor(() => expect(container.querySelector(".animate-spin")).toBeNull());
  });

  it("keeps visible-view scope discoverable before visible bounds are ready", async () => {
    const user = userEvent.setup();
    renderBrowser(null);

    await waitFor(() => expect(queryMapPlacementsMock).toHaveBeenCalled());

    const viewScope = screen.getByRole("button", { name: "Search visible map view" });
    expect(viewScope).not.toBeDisabled();
    expect(viewScope).toHaveAttribute("aria-disabled", "true");

    await user.click(viewScope);

    expect(viewScope).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Pan or zoom the map to establish a visible view."))
      .toBeInTheDocument();
  });

  it("waits for debounced visible bounds before the first view-scoped reload", async () => {
    const user = userEvent.setup();
    const store = createBrowserStore();
    const renderWithBounds = (visibleBounds: MapTileBounds | null) => (
      <Provider store={store}>
        <MapPlacementBrowser
          onSelectPlacement={() => undefined}
          selectedPlacement={null}
          selectedTile={null}
          visibleBounds={visibleBounds}
        />
      </Provider>
    );
    const { rerender } = render(renderWithBounds(null));

    await waitFor(() => expect(queryMapPlacementsMock).toHaveBeenCalled());
    queryMapPlacementsMock.mockClear();

    await user.click(screen.getByRole("button", { name: "Search visible map view" }));
    expect(queryMapPlacementsMock).not.toHaveBeenCalled();

    rerender(renderWithBounds({ minX: 75.1, minY: 80.1, maxX: 90.1, maxY: 100.1 }));

    await new Promise((resolve) => window.setTimeout(resolve, 60));
    expect(queryMapPlacementsMock).not.toHaveBeenCalled();

    await waitFor(() => expect(queryMapPlacementsMock).toHaveBeenCalledTimes(1));
    expect(queryMapPlacementsMock).toHaveBeenLastCalledWith(
      "project-1",
      "garner",
      undefined,
      "all",
      undefined,
      undefined,
      undefined,
      0,
      200,
      75,
      80,
      91,
      101,
    );
  });

  it("keeps map-tile near search disabled until the canvas has a selected tile", async () => {
    renderBrowser(null);

    await waitFor(() => expect(queryMapPlacementsMock).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Use selected tile" })).toBeDisabled();
  });

  it("uses plain search-area labels and pressed state for placement filtering", async () => {
    renderBrowser({ x: 32, y: 48 });

    await waitFor(() => expect(queryMapPlacementsMock).toHaveBeenCalled());

    expect(screen.getByRole("group", { name: "Placement search area" })).toBeInTheDocument();
    expect(screen.queryByText("Placement scope")).not.toBeInTheDocument();
    expect(screen.getAllByText("Whole map").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Visible view")).toBeInTheDocument();
    expect(screen.getAllByText("Point radius").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId("placement-search-area-tabs")).toHaveClass("w-full");
    expect(screen.getByRole("button", { name: "Search whole map" }))
      .toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Search visible map view" }))
      .toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Search point radius" }))
      .toHaveAttribute("aria-pressed", "false");
    expect(screen.getByLabelText("Point X")).toBeInTheDocument();
    expect(screen.getByText("Point X")).toBeInTheDocument();
    expect(screen.getByText("Point Y")).toBeInTheDocument();
    expect(screen.getAllByText("Point radius").length).toBeGreaterThanOrEqual(2);
  });

  it("shows a stable empty result range", async () => {
    renderBrowser(null);

    await waitFor(() => expect(queryMapPlacementsMock).toHaveBeenCalled());

    expect(screen.getByText("0 of 0")).toBeInTheDocument();
    expect(screen.queryByText("1-0 of 0")).not.toBeInTheDocument();
  });

  it("renders an accessible collapse control when the placement panel is docked", async () => {
    const onCollapse = vi.fn();
    renderBrowser({ x: 32, y: 48 }, { onCollapse });

    await waitFor(() => expect(queryMapPlacementsMock).toHaveBeenCalled());

    const collapse = screen.getByRole("button", { name: "Collapse placements panel" });
    expect(collapse).toHaveAttribute("aria-controls", "map-placement-browser-pane");
    expect(collapse).toHaveAttribute("aria-expanded", "true");
    expect(collapse).toHaveTextContent("Collapse");

    await userEvent.click(collapse);

    expect(onCollapse).toHaveBeenCalledTimes(1);
  });

  it("does not clear the current placement selection when the browser first mounts", async () => {
    const onSelectPlacement = vi.fn();
    renderBrowser({ x: 32, y: 48 }, { onSelectPlacement });

    await waitFor(() => expect(queryMapPlacementsMock).toHaveBeenCalled());

    expect(onSelectPlacement).not.toHaveBeenCalled();
  });

  it("labels placement rows with the selection action and coordinates", async () => {
    const user = userEvent.setup();
    const onSelectPlacement = vi.fn();
    queryMapPlacementsMock.mockResolvedValue({
      total: 1,
      offset: 0,
      limit: 200,
      items: [buildingPlacement],
    });

    renderBrowser(null, { onSelectPlacement });

    const placementRow = await screen.findByRole("button", {
      name: "Select placement Volcano 01, building 26 at x 118.20 y 14.20",
    });
    expect(placementRow).toHaveAttribute(
      "title",
      "Select placement Volcano 01, building 26 at x 118.20 y 14.20",
    );

    await user.click(placementRow);

    expect(onSelectPlacement).toHaveBeenCalledWith(buildingPlacement);
  });

  it("shows the selected building preview inside the placement workflow", async () => {
    renderBrowser(null, { selectedPlacement: buildingPlacement });

    await waitFor(() => expect(queryMapPlacementsMock).toHaveBeenCalled());

    expect(screen.getByTestId("placement-browser-building-preview"))
      .toHaveTextContent("Volcano 01");
    expect(mapPlacementBuildingPreviewMock).toHaveBeenCalledWith({
      placement: buildingPlacement,
    });
  });
});
