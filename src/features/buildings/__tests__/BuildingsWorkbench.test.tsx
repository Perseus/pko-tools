import { render, screen } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import BuildingsWorkbench from "@/features/buildings/BuildingsWorkbench";
import {
  activeBuildingWorkbenchAtom,
  buildingGltfJsonAtom,
  buildingLoadingAtom,
  selectedBuildingAtom,
} from "@/store/buildings";
import { currentProjectAtom } from "@/store/project";
import type { BuildingWorkbenchState } from "@/types/buildings";

// Mock Three.js / R3F
vi.mock("@react-three/fiber", () => ({
  Canvas: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="canvas">{children}</div>
  ),
  useFrame: () => {},
}));

vi.mock("@react-three/drei", () => ({
  OrbitControls: () => <div data-testid="orbit-controls" />,
  GizmoHelper: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="gizmo-helper">{children}</div>
  ),
  GizmoViewport: () => <div data-testid="gizmo-viewport" />,
  useGLTF: () => ({ scene: null }),
}));

vi.mock("@/features/buildings/BuildingsModelViewer", () => ({
  default: () => <div data-testid="model-viewer" />,
}));

vi.mock("@/commands/buildings", () => ({
  rescaleBuilding: vi.fn().mockResolvedValue("{}"),
  rotateBuilding: vi.fn().mockResolvedValue("{}"),
}));

const minimalGltfJson = JSON.stringify({
  asset: { version: "2.0" },
  nodes: [],
  meshes: [],
});

describe("BuildingsWorkbench", () => {
  it("shows placeholder when no model selected", () => {
    const store = createStore();
    store.set(buildingGltfJsonAtom, null);
    store.set(buildingLoadingAtom, false);

    render(
      <Provider store={store}>
        <BuildingsWorkbench />
      </Provider>
    );

    expect(
      screen.getByText(/Select a building from the navigator/)
    ).toBeInTheDocument();
  });

  it("shows loading state during model load", () => {
    const store = createStore();
    store.set(buildingGltfJsonAtom, null);
    store.set(buildingLoadingAtom, true);

    render(
      <Provider store={store}>
        <BuildingsWorkbench />
      </Provider>
    );

    expect(screen.getByText(/Loading building model/)).toBeInTheDocument();
  });

  it("renders canvas when glTF loaded", () => {
    const store = createStore();
    store.set(buildingGltfJsonAtom, minimalGltfJson);
    store.set(buildingLoadingAtom, false);
    store.set(selectedBuildingAtom, {
      id: 1,
      filename: "test.lmo",
      display_name: "test",
    });

    render(
      <Provider store={store}>
        <BuildingsWorkbench />
      </Provider>
    );

    expect(screen.getByTestId("canvas")).toBeInTheDocument();
  });

  it("shows building info panel when building selected", () => {
    const store = createStore();
    store.set(buildingGltfJsonAtom, minimalGltfJson);
    store.set(buildingLoadingAtom, false);
    store.set(selectedBuildingAtom, {
      id: 42,
      filename: "by-tree01.lmo",
      display_name: "by-tree01",
    });

    render(
      <Provider store={store}>
        <BuildingsWorkbench />
      </Provider>
    );

    expect(screen.getByText("by-tree01")).toBeInTheDocument();
    expect(screen.getByText("ID: 42")).toBeInTheDocument();
  });

  it("renders workbench toolbar when workbench is active", () => {
    const store = createStore();
    store.set(buildingGltfJsonAtom, minimalGltfJson);
    store.set(buildingLoadingAtom, false);
    store.set(selectedBuildingAtom, {
      id: 1,
      filename: "test.lmo",
      display_name: "test",
    });
    store.set(currentProjectAtom, {
      id: "proj-1",
      name: "Test",
      projectDirectory: "/test",
    } as any);

    const workbenchState: BuildingWorkbenchState = {
      building_id: "1",
      source_file: "/source.gltf",
      scale_factor: 1.0,
      lmo_path: "/output.lmo",
      created_at: "123456",
    };
    store.set(activeBuildingWorkbenchAtom, workbenchState);

    render(
      <Provider store={store}>
        <BuildingsWorkbench />
      </Provider>
    );

    // Toolbar should have Scale and Rotate buttons
    expect(screen.getByText("Scale")).toBeInTheDocument();
    expect(screen.getByText("Rotate")).toBeInTheDocument();
  });

  it("does not render toolbar when workbench is not active", () => {
    const store = createStore();
    store.set(buildingGltfJsonAtom, minimalGltfJson);
    store.set(buildingLoadingAtom, false);
    store.set(activeBuildingWorkbenchAtom, null);

    render(
      <Provider store={store}>
        <BuildingsWorkbench />
      </Provider>
    );

    expect(screen.queryByText("Scale")).not.toBeInTheDocument();
    expect(screen.queryByText("Rotate")).not.toBeInTheDocument();
  });
});
