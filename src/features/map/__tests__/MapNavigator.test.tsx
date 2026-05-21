import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MapNavigator from "../MapNavigator";
import { currentProjectAtom } from "@/store/project";
import { mapStagedEditStateAtom, selectedMapAtom } from "@/store/map";
import type { MapEntry } from "@/types/map";

const getMapListMock = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 48,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        size: 48,
        start: index * 48,
      })),
  }),
}));

vi.mock("@/commands/map", () => ({
  getMapList: getMapListMock,
}));

const pkMap: MapEntry = {
  name: "pkmap",
  display_name: "PKmap",
  map_file: "pkmap.map",
  has_obj: true,
  has_rbo: true,
  width: 128,
  height: 128,
};

const garnerMap: MapEntry = {
  name: "garner",
  display_name: "Garner",
  map_file: "garner.map",
  has_obj: true,
  has_rbo: true,
  width: 4096,
  height: 4096,
};

function renderNavigator(
  props: Partial<Parameters<typeof MapNavigator>[0]> = {},
  options: {
    selectedMap?: boolean;
    stagedEdits?: boolean;
  } = {},
) {
  const { selectedMap = true, stagedEdits = false } = options;
  const store = createStore();
  store.set(currentProjectAtom, {
    id: "project-1",
    name: "Project",
    projectDirectory: "C:/project",
  });
  if (selectedMap) {
    store.set(selectedMapAtom, pkMap);
  }
  if (stagedEdits) {
    store.set(mapStagedEditStateAtom, {
      mapName: pkMap.name,
      count: 3,
      summary: "2 tiles, 1 placement",
    });
  }

  const result = render(
    <Provider store={store}>
      <MapNavigator {...props} />
    </Provider>,
  );

  return { ...result, store };
}

describe("MapNavigator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMapListMock.mockResolvedValue([pkMap]);
  });

  it("renders a compact map rail that can reopen the full navigator", async () => {
    const onExpand = vi.fn();

    renderNavigator({ compact: true, onExpand });

    expect(screen.getByTestId("map-navigator-rail")).toHaveClass("w-12");
    expect(screen.getByRole("navigation", { name: /Selected map PKmap/ }))
      .toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Search maps...")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Open maps navigator/ }))
      .toHaveAttribute("aria-controls", "map-navigator-panel");
    expect(screen.getByRole("button", { name: /^Open maps navigator/ }))
      .toHaveAttribute("aria-expanded", "false");
    expect(within(screen.getByTestId("map-navigator-rail"))
      .getByTestId("map-navigator-rail-open-label"))
      .toHaveTextContent("Open");
    expect(screen.getByText("PKmap")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("1")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /^Open maps navigator/ }));

    expect(onExpand).toHaveBeenCalledTimes(1);
  });

  it("surfaces staged edit state on the compact map rail", async () => {
    renderNavigator({ compact: true }, { stagedEdits: true });

    expect(await screen.findByRole("navigation", {
      name: "Maps navigator. Selected map PKmap. 1 maps loaded. 2 tiles, 1 placement staged.",
    })).toBeInTheDocument();

    const openButton = screen.getByRole("button", { name: /^Open maps navigator/ });
    expect(openButton).toHaveAccessibleName(
      "Open maps navigator, selected map PKmap, 2 tiles, 1 placement staged",
    );

    const badge = await screen.findByTestId("map-navigator-staged-edit-badge");
    expect(badge).toHaveTextContent("3");
    expect(badge).toHaveAttribute("title", "2 tiles, 1 placement staged");
    expect(badge).toHaveAccessibleName("2 tiles, 1 placement staged");
  });

  it("does not expose map-to-glTF export controls", async () => {
    const { unmount } = renderNavigator({ compact: true });

    await waitFor(() => expect(screen.getByText("1")).toBeInTheDocument());

    expect(screen.queryByRole("button", { name: "Export selected map to glTF" }))
      .not.toBeInTheDocument();

    unmount();
    renderNavigator();

    await waitFor(() => expect(screen.getByText("1 maps")).toBeInTheDocument());

    expect(screen.queryByRole("button", { name: "Export to glTF" }))
      .not.toBeInTheDocument();
  });

  it("exposes an explicit collapse control in the full navigator", async () => {
    const onCollapse = vi.fn();

    renderNavigator({ onCollapse });

    await waitFor(() => expect(screen.getByText("1 maps")).toBeInTheDocument());
    const collapse = screen.getByRole("button", { name: "Collapse maps navigator" });
    expect(collapse).toHaveTextContent("Collapse");
    fireEvent.click(collapse);

    expect(onCollapse).toHaveBeenCalledTimes(1);
  });

  it("renders the full navigator as an overlay drawer when opened from the compact rail", async () => {
    const onCollapse = vi.fn();

    renderNavigator({ overlay: true, onCollapse });

    await waitFor(() => expect(screen.getByText("1 maps")).toBeInTheDocument());
    expect(screen.getByRole("navigation", { name: "Maps navigator" })).toHaveAttribute(
      "id",
      "map-navigator-panel",
    );
    expect(screen.getByTestId("map-navigator-panel")).toHaveClass(
      "fixed",
      "right-0",
      "w-72",
      "shadow-xl",
    );
    fireEvent.click(screen.getByRole("button", { name: "Collapse maps navigator" }));

    expect(onCollapse).toHaveBeenCalledTimes(1);
  });

  it("collapses the overlay navigator with Escape", async () => {
    const onCollapse = vi.fn();

    renderNavigator({ overlay: true, onCollapse });

    await waitFor(() => expect(screen.getByText("1 maps")).toBeInTheDocument());

    fireEvent.keyDown(screen.getByPlaceholderText("Search maps..."), { key: "Escape" });

    expect(onCollapse).toHaveBeenCalledTimes(1);
  });

  it("keeps the map list open after choosing a map so browsing stays fast", async () => {
    const onCollapse = vi.fn();

    const { store } = renderNavigator({ onCollapse }, { selectedMap: false });

    await waitFor(() => expect(screen.getByRole("button", { name: /PKmap/ }))
      .toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Collapse maps navigator" }))
      .not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /PKmap/ }));

    expect(onCollapse).not.toHaveBeenCalled();
    expect(store.get(selectedMapAtom)).toEqual(pkMap);
  });

  it("labels map rows with the action and available sidecars", async () => {
    getMapListMock.mockResolvedValue([
      pkMap,
      {
        ...garnerMap,
        has_rbo: false,
      },
    ]);

    renderNavigator({}, { selectedMap: false });

    const pkMapButton = await screen.findByRole("button", {
      name: "Open map PKmap, 128 by 128, OBJ and RBO available",
    });
    expect(pkMapButton).toHaveAttribute(
      "title",
      "Open map PKmap, 128 by 128, OBJ and RBO available",
    );

    expect(screen.getByRole("button", {
      name: "Open map Garner, 4096 by 4096, OBJ available",
    })).toBeInTheDocument();
  });

  it("keeps the current map selected when a staged-edit map switch is cancelled", async () => {
    getMapListMock.mockResolvedValue([pkMap, garnerMap]);
    const { store } = renderNavigator({}, { stagedEdits: true });

    await waitFor(() => expect(screen.getByRole("button", { name: /Garner/ }))
      .toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Garner/ }));

    expect(await screen.findByText("Discard staged edits?")).toBeInTheDocument();
    expect(screen.getByText("You have 2 tiles, 1 placement staged for PKmap."))
      .toBeInTheDocument();
    expect(store.get(selectedMapAtom)).toEqual(pkMap);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText("Discard staged edits?")).not.toBeInTheDocument();
    expect(store.get(selectedMapAtom)).toEqual(pkMap);
    expect(store.get(mapStagedEditStateAtom)).toEqual({
      mapName: pkMap.name,
      count: 3,
      summary: "2 tiles, 1 placement",
    });
  });

  it("selects the next map after staged edits are explicitly discarded", async () => {
    getMapListMock.mockResolvedValue([pkMap, garnerMap]);
    const { store } = renderNavigator({}, { stagedEdits: true });

    await waitFor(() => expect(screen.getByRole("button", { name: /Garner/ }))
      .toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /Garner/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Discard" }));

    expect(store.get(selectedMapAtom)).toEqual(garnerMap);
    expect(store.get(mapStagedEditStateAtom)).toBeNull();
  });
});
