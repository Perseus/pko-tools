import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BuildingImportResult, BuildingWorkbenchState } from "@/types/buildings";

// Mock Tauri invoke at the module level
const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

describe("Building types", () => {
  it("BuildingImportResult has expected fields", () => {
    const result: BuildingImportResult = {
      lmo_path: "/path/to/output.lmo",
      texture_paths: ["/path/to/tex1.bmp", "/path/to/tex2.bmp"],
      import_dir: "/path/to/imports/building/100",
      building_id: "100",
    };

    expect(result.lmo_path).toBe("/path/to/output.lmo");
    expect(result.texture_paths).toHaveLength(2);
    expect(result.import_dir).toContain("building");
    expect(result.building_id).toBe("100");
  });

  it("BuildingWorkbenchState has expected fields", () => {
    const state: BuildingWorkbenchState = {
      building_id: "100",
      source_file: "/path/to/source.gltf",
      scale_factor: 1.5,
      lmo_path: "/path/to/output.lmo",
      created_at: "1707739200",
    };

    expect(state.building_id).toBe("100");
    expect(state.scale_factor).toBe(1.5);
    expect(state.lmo_path).toContain(".lmo");
    expect(state.created_at).toBeTruthy();
  });
});

describe("Building command wrappers", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("exportBuildingForEditing invokes correct command", async () => {
    invokeMock.mockResolvedValue("/exports/buildings/editing/test.gltf");
    const { exportBuildingForEditing } = await import("@/commands/buildings");

    const result = await exportBuildingForEditing("proj-1", 42);

    expect(invokeMock).toHaveBeenCalledWith("export_building_for_editing", {
      projectId: "proj-1",
      buildingId: 42,
    });
    expect(result).toContain("editing");
  });

  it("importBuildingFromGltf invokes with correct args", async () => {
    const mockResult: BuildingImportResult = {
      lmo_path: "/imports/building/100/100.lmo",
      texture_paths: [],
      import_dir: "/imports/building/100",
      building_id: "100",
    };
    invokeMock.mockResolvedValue(mockResult);
    const { importBuildingFromGltf } = await import("@/commands/buildings");

    const result = await importBuildingFromGltf(
      "proj-1",
      "100",
      "/path/to/model.gltf",
      1.0
    );

    expect(invokeMock).toHaveBeenCalledWith("import_building_from_gltf", {
      projectId: "proj-1",
      buildingId: "100",
      filePath: "/path/to/model.gltf",
      scaleFactor: 1.0,
    });
    expect(result.lmo_path).toContain("100.lmo");
  });

  it("rescaleBuilding invokes with correct args", async () => {
    invokeMock.mockResolvedValue('{"asset":{"version":"2.0"}}');
    const { rescaleBuilding } = await import("@/commands/buildings");

    await rescaleBuilding("proj-1", "/path/to/model.lmo", 2.0);

    expect(invokeMock).toHaveBeenCalledWith("rescale_building", {
      projectId: "proj-1",
      lmoPath: "/path/to/model.lmo",
      factor: 2.0,
    });
  });

  it("rotateBuilding invokes with correct args", async () => {
    invokeMock.mockResolvedValue('{"asset":{"version":"2.0"}}');
    const { rotateBuilding } = await import("@/commands/buildings");

    await rotateBuilding("proj-1", "/path/to/model.lmo", 90, 0, 0);

    expect(invokeMock).toHaveBeenCalledWith("rotate_building", {
      projectId: "proj-1",
      lmoPath: "/path/to/model.lmo",
      xDeg: 90,
      yDeg: 0,
      zDeg: 0,
    });
  });

  it("saveBuildingWorkbench invokes with state object", async () => {
    invokeMock.mockResolvedValue(undefined);
    const { saveBuildingWorkbench } = await import("@/commands/buildings");

    const state: BuildingWorkbenchState = {
      building_id: "100",
      source_file: "/source.gltf",
      scale_factor: 1.0,
      lmo_path: "/output.lmo",
      created_at: "123456",
    };

    await saveBuildingWorkbench("proj-1", state);

    expect(invokeMock).toHaveBeenCalledWith("save_building_workbench", {
      projectId: "proj-1",
      state,
    });
  });

  it("loadBuildingWorkbench returns state or null", async () => {
    invokeMock.mockResolvedValue(null);
    const { loadBuildingWorkbench } = await import("@/commands/buildings");

    const result = await loadBuildingWorkbench("proj-1", "100");

    expect(invokeMock).toHaveBeenCalledWith("load_building_workbench", {
      projectId: "proj-1",
      buildingId: "100",
    });
    expect(result).toBeNull();
  });
});
