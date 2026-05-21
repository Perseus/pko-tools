import { render, screen } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { describe, expect, it, vi } from "vitest";
import MapsPage from "../index";
import { currentProjectAtom } from "@/store/project";

vi.mock("@/features/map/MapWorkbench", () => ({
  default: () => <div data-testid="map-workbench" />,
}));

describe("MapsPage", () => {
  it("constrains the map workbench to the route viewport", () => {
    const store = createStore();
    store.set(currentProjectAtom, {
      id: "project-1",
      name: "Project",
      projectDirectory: "C:/project",
    });

    render(
      <Provider store={store}>
        <MapsPage />
      </Provider>,
    );

    expect(screen.getByTestId("maps-page-shell")).toHaveClass(
      "min-h-0",
      "min-w-0",
      "overflow-hidden",
    );
  });
});
