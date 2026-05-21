import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { SidebarProvider } from "../ui/sidebar";
import { currentProjectAtom, projectListAtom } from "@/store/project";
import { selectedMapAtom } from "@/store/map";
import SideNav from "./SideNav";

vi.mock("@/commands/invokeTimed", () => ({
  invokeTimed: vi.fn(),
}));

vi.mock("@/features/character/CharacterStatusBar", () => ({
  default: () => <div>Character loading status</div>,
}));

vi.stubGlobal("__APP_VERSION__", "0.1.9");

function renderSideNav(path = "/maps", options: { selectedMap?: boolean } = {}) {
  const store = createStore();
  store.set(currentProjectAtom, {
    id: "project-1",
    name: "MP",
    projectDirectory: "E:/gamedev/mp-client-source/Client/client",
  });
  store.set(projectListAtom, [
    {
      id: "project-1",
      name: "MP",
      projectDirectory: "E:/gamedev/mp-client-source/Client/client",
    },
  ]);
  if (options.selectedMap) {
    store.set(selectedMapAtom, {
      name: "pkmap",
      display_name: "PKmap",
      map_file: "pkmap.map",
      has_obj: true,
      has_rbo: true,
      width: 128,
      height: 128,
    });
  }

  render(
    <MemoryRouter initialEntries={[path]}>
      <Provider store={store}>
        <SidebarProvider>
          <SideNav />
        </SidebarProvider>
      </Provider>
    </MemoryRouter>,
  );
}

describe("SideNav", () => {
  it("exposes an app sidebar toggle so map editors can reclaim workspace", () => {
    renderSideNav();

    const sidebar = document.querySelector('[data-side="left"]');
    expect(sidebar).toHaveAttribute("data-state", "expanded");

    fireEvent.click(screen.getByRole("button", { name: "Toggle app sidebar" }));

    expect(sidebar).toHaveAttribute("data-state", "collapsed");
  });

  it("keeps the app sidebar open after a map is selected on the maps route", async () => {
    renderSideNav("/maps", { selectedMap: true });

    const sidebar = document.querySelector('[data-side="left"]');
    await waitFor(() => expect(sidebar).toHaveAttribute("data-state", "expanded"));

    fireEvent.click(screen.getByRole("button", { name: "Toggle app sidebar" }));

    expect(sidebar).toHaveAttribute("data-state", "collapsed");
  });

  it("keeps the app sidebar expanded on maps until a map is selected", () => {
    renderSideNav("/maps");

    const sidebar = document.querySelector('[data-side="left"]');
    expect(sidebar).toHaveAttribute("data-state", "expanded");
  });

  it("gives each app navigation item an icon for the collapsed rail", () => {
    renderSideNav();

    for (const label of [
      "Characters",
      "Effects",
      "Items",
      "Forge Glows",
      "Maps",
      "Buildings",
    ]) {
      expect(screen.getByRole("link", { name: label }).querySelector("svg")).not.toBeNull();
    }
  });

  it("hides character loading status from the collapsed rail", () => {
    renderSideNav("/characters");

    const statusSlot = screen.getByText("Character loading status").parentElement;
    expect(statusSlot).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Toggle app sidebar" }));

    expect(statusSlot).toHaveClass("group-data-[collapsible=icon]:hidden");
  });
});
