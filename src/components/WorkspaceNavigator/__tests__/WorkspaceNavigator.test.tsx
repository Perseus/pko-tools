import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WorkspaceNavigator from "../WorkspaceNavigator";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { selectedMapAtom } from "@/store/map";
import type { MapEntry } from "@/types/map";

type MockMapNavigatorProps = {
  compact?: boolean;
  overlay?: boolean;
  onExpand?: () => void;
  onCollapse?: () => void;
};

const mapNavigatorMock = vi.hoisted(() =>
  vi.fn((props: MockMapNavigatorProps) => (
    <div
      id={props.overlay ? "map-navigator-panel" : undefined}
      data-testid={props.compact ? "map-navigator-rail" : "map-navigator"}
    >
      <button type="button">Inside maps navigator</button>
    </div>
  )),
);

vi.mock("@/features/character/CharacterNavigator", () => ({
  default: () => <div />,
}));
vi.mock("@/features/effect-v2/EffectV2Navigator", () => ({
  default: () => <div />,
}));
vi.mock("@/features/item/ItemNavigator", () => ({
  default: () => <div />,
}));
vi.mock("@/features/forge-glow/ForgeGlowNavigator", () => ({
  default: () => <div />,
}));
vi.mock("@/features/map/MapNavigator", () => ({
  default: mapNavigatorMock,
}));
vi.mock("@/features/buildings/BuildingsNavigator", () => ({
  default: () => <div />,
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

function renderWorkspaceNavigator({
  selectedMap = true,
  path = "/maps",
}: {
  selectedMap?: boolean;
  path?: string;
} = {}) {
  const store = createStore();
  if (selectedMap) {
    store.set(selectedMapAtom, pkMap);
  }

  const result = render(
    <MemoryRouter initialEntries={[path]}>
      <Provider store={store}>
        <SidebarProvider>
          <WorkspaceNavigator />
        </SidebarProvider>
      </Provider>
    </MemoryRouter>,
  );

  return { ...result, store };
}

describe("WorkspaceNavigator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the full maps navigator open by default when a map is selected", () => {
    renderWorkspaceNavigator({ selectedMap: true });

    expect(screen.getByTestId("workspace-navigator-shell")).toHaveStyle({
      "--sidebar-width": "3rem",
    });
    expect(mapNavigatorMock.mock.lastCall?.[0]).toEqual(
      expect.objectContaining({
        compact: false,
        overlay: true,
      }),
    );
  });

  it("keeps the full map navigator available before the first map is selected", () => {
    renderWorkspaceNavigator({ selectedMap: false });

    expect(screen.getByTestId("workspace-navigator-shell")).not.toHaveStyle({
      "--sidebar-width": "3rem",
    });
    expect(mapNavigatorMock.mock.lastCall?.[0]).toEqual(
      expect.objectContaining({ compact: false }),
    );
  });

  it("does not compact non-map routes with a similar prefix", () => {
    renderWorkspaceNavigator({ path: "/maps-archive", selectedMap: true });

    expect(screen.getByTestId("workspace-navigator-shell")).not.toHaveStyle({
      "--sidebar-width": "3rem",
    });
    expect(mapNavigatorMock).not.toHaveBeenCalled();
  });

  it("keeps the map navigator open after the first map selection", async () => {
    const { store } = renderWorkspaceNavigator({ selectedMap: false });

    await waitFor(() => expect(mapNavigatorMock).toHaveBeenCalled());
    const firstSelectionProps = mapNavigatorMock.mock.lastCall?.[0];
    expect(firstSelectionProps).toEqual(expect.objectContaining({ compact: false }));

    act(() => {
      store.set(selectedMapAtom, pkMap);
    });

    await waitFor(() =>
      expect(screen.getByTestId("workspace-navigator-shell")).toHaveStyle({
        "--sidebar-width": "3rem",
      }),
    );
    expect(mapNavigatorMock.mock.lastCall?.[0]).toEqual(
      expect.objectContaining({
        compact: false,
        overlay: true,
      }),
    );
  });

  it("collapses and reopens the maps navigator while keeping the route rail compact", async () => {
    renderWorkspaceNavigator({ selectedMap: true });

    const expandedProps = mapNavigatorMock.mock.lastCall?.[0];
    expect(expandedProps).toEqual(expect.objectContaining({
      compact: false,
      overlay: true,
    }));

    act(() => {
      expandedProps?.onCollapse?.();
    });

    await waitFor(() =>
      expect(screen.getByTestId("workspace-navigator-shell")).toHaveStyle({
        "--sidebar-width": "3rem",
      }),
    );
    const compactProps = mapNavigatorMock.mock.lastCall?.[0];
    expect(compactProps).toEqual(expect.objectContaining({ compact: true }));

    act(() => {
      compactProps?.onExpand?.();
    });

    await waitFor(() =>
      expect(screen.getByTestId("workspace-navigator-shell")).toHaveStyle({
        "--sidebar-width": "3rem",
      }),
    );
    expect(document.querySelector('[data-sidebar-fixed-layer="true"]')).toHaveClass("z-50");
    expect(mapNavigatorMock.mock.lastCall?.[0]).toEqual(expect.objectContaining({
      compact: false,
      overlay: true,
    }));
  });

  it("collapses the maps overlay after the user interacts with the editor outside it", async () => {
    renderWorkspaceNavigator({ selectedMap: true });

    expect(mapNavigatorMock.mock.lastCall?.[0]).toEqual(expect.objectContaining({
      compact: false,
      overlay: true,
    }));

    act(() => {
      fireEvent.pointerDown(document.body);
    });

    await waitFor(() =>
      expect(mapNavigatorMock.mock.lastCall?.[0]).toEqual(expect.objectContaining({
        compact: true,
      })),
    );
  });

  it("keeps the maps overlay open when the user clicks inside the maps navigator", () => {
    renderWorkspaceNavigator({ selectedMap: true });

    act(() => {
      fireEvent.pointerDown(screen.getByRole("button", { name: "Inside maps navigator" }));
    });

    expect(mapNavigatorMock.mock.lastCall?.[0]).toEqual(expect.objectContaining({
      compact: false,
      overlay: true,
    }));
  });

  it("keeps the workspace navigator open when the app sidebar is toggled", () => {
    const store = createStore();

    render(
      <MemoryRouter initialEntries={["/maps"]}>
        <Provider store={store}>
          <SidebarProvider>
            <SidebarTrigger aria-label="Toggle app sidebar" />
            <WorkspaceNavigator />
          </SidebarProvider>
        </Provider>
      </MemoryRouter>,
    );

    const rightSidebar = document.querySelector('[data-side="right"]');
    expect(rightSidebar).toHaveAttribute("data-state", "expanded");

    act(() => {
      screen.getByRole("button", { name: "Toggle app sidebar" }).click();
    });

    expect(rightSidebar).toHaveAttribute("data-state", "expanded");
  });
});
