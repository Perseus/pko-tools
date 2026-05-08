import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import * as THREE from "three";

// Mock the Tauri invoke-based command
vi.mock("@/commands/effect", () => ({
  loadEffectModel: vi.fn(),
}));

// Track the parse callback so we can trigger it manually
let parseOnLoad: ((gltf: { scene: THREE.Group; animations?: THREE.AnimationClip[] }) => void) | null = null;

// Mock GLTFLoader.parse to capture the onLoad callback
vi.mock("three/examples/jsm/loaders/GLTFLoader.js", () => {
  class MockGLTFLoader {
    parse(
      _data: ArrayBuffer,
      _path: string,
      onLoad: (gltf: { scene: THREE.Group; animations?: THREE.AnimationClip[] }) => void,
    ) {
      parseOnLoad = onLoad;
    }
  }
  return { GLTFLoader: MockGLTFLoader };
});

function buildMockScene(dummy?: { id: number; position: [number, number, number] }): THREE.Group {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3)
  );
  const mesh = new THREE.Mesh(geo);
  const scene = new THREE.Group();
  scene.add(mesh);
  if (dummy) {
    const dummyNode = new THREE.Object3D();
    dummyNode.name = `Dummy${dummy.id}`;
    dummyNode.userData = { type: "dummy", id: dummy.id };
    dummyNode.position.set(...dummy.position);
    scene.add(dummyNode);
  }
  return scene;
}

// Import after mocks
const { loadEffectModel } = await import("@/commands/effect");
const mockLoadEffectModel = vi.mocked(loadEffectModel);
const {
  extractEffectModelDummyPoints,
  useEffectModel,
  useEffectModelResource,
  useEffectModelDummies,
} = await import("../useEffectModel");

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadEffectModel.mockReset();
  parseOnLoad = null;
});

describe("useEffectModel", () => {
  it("returns null when modelName is undefined", () => {
    const { result } = renderHook(() => useEffectModel(undefined, "proj-1"));
    expect(result.current).toBeNull();
  });

  it("returns null when projectId is undefined", () => {
    const { result } = renderHook(() => useEffectModel("wind01", undefined));
    expect(result.current).toBeNull();
    expect(mockLoadEffectModel).not.toHaveBeenCalled();
  });

  it("returns BufferGeometry after async load", async () => {
    mockLoadEffectModel.mockResolvedValue("{}");

    const { result } = renderHook(() => useEffectModel("wind01", "proj-1"));
    expect(result.current).toBeNull();

    // Wait for the promise to resolve and GLTFLoader.parse to be called
    await waitFor(() => {
      expect(parseOnLoad).not.toBeNull();
    });

    // Fire the parse callback with a mock scene
    await act(async () => {
      parseOnLoad!({ scene: buildMockScene() });
    });

    expect(result.current).toBeInstanceOf(THREE.BufferGeometry);
    expect(mockLoadEffectModel).toHaveBeenCalledWith("proj-1", "wind01");
  });

  it("returns the parsed scene and animation clips for skinned effect models", async () => {
    mockLoadEffectModel.mockResolvedValue("{}");
    const clip = new THREE.AnimationClip("EffectModelBoneAnimation", 2, []);

    const { result } = renderHook(() => useEffectModelResource("gunwing.lgo", "proj-anim"));

    await waitFor(() => {
      expect(parseOnLoad).not.toBeNull();
    });

    const scene = buildMockScene();
    await act(async () => {
      parseOnLoad!({ scene, animations: [clip] });
    });

    expect(result.current?.scene).toBe(scene);
    expect(result.current?.animations).toEqual([clip]);
    expect(result.current?.geometry).toBeInstanceOf(THREE.BufferGeometry);
  });

  it("returns cached geometry on subsequent renders", async () => {
    // Use a unique model name so module-level cache from prior tests doesn't interfere
    mockLoadEffectModel.mockResolvedValue("{}");

    const { result, rerender } = renderHook(() =>
      useEffectModel("cached_model", "proj-cache")
    );

    await waitFor(() => {
      expect(parseOnLoad).not.toBeNull();
    });

    await act(async () => {
      parseOnLoad!({ scene: buildMockScene() });
    });

    expect(result.current).toBeInstanceOf(THREE.BufferGeometry);
    const first = result.current;

    // Reset mock to verify it doesn't get called again
    mockLoadEffectModel.mockClear();
    rerender();

    // Should be the exact same cached object
    expect(result.current).toBe(first);
    // Not called again — cache hit on rerender
    expect(mockLoadEffectModel).toHaveBeenCalledTimes(0);
  });

  it("clears stale geometry while loading a different uncached model", async () => {
    mockLoadEffectModel.mockResolvedValue("{}");

    const { result, rerender } = renderHook(
      ({ modelName }) => useEffectModel(modelName, "proj-switch"),
      { initialProps: { modelName: "first_model" } },
    );

    await waitFor(() => {
      expect(parseOnLoad).not.toBeNull();
    });

    await act(async () => {
      parseOnLoad!({ scene: buildMockScene() });
    });

    expect(result.current).toBeInstanceOf(THREE.BufferGeometry);

    parseOnLoad = null;
    rerender({ modelName: "second_model" });

    expect(result.current).toBeNull();
    expect(mockLoadEffectModel).toHaveBeenLastCalledWith("proj-switch", "second_model");
  });

  it("clears stale geometry when a changed model fails to load", async () => {
    mockLoadEffectModel.mockResolvedValueOnce("{}");

    const { result, rerender } = renderHook(
      ({ modelName }) => useEffectModel(modelName, "proj-fail"),
      { initialProps: { modelName: "loaded_model" } },
    );

    await waitFor(() => {
      expect(parseOnLoad).not.toBeNull();
    });

    await act(async () => {
      parseOnLoad!({ scene: buildMockScene() });
    });

    expect(result.current).toBeInstanceOf(THREE.BufferGeometry);

    parseOnLoad = null;
    mockLoadEffectModel.mockRejectedValueOnce(new Error("missing model"));
    rerender({ modelName: "missing_model" });

    await waitFor(() => {
      expect(mockLoadEffectModel).toHaveBeenLastCalledWith("proj-fail", "missing_model");
    });

    expect(result.current).toBeNull();
  });

  it("extracts helper dummy nodes in scene-local space", () => {
    const scene = buildMockScene({ id: 3, position: [1, 2, 3] });
    scene.position.set(10, 0, 0);

    const dummies = extractEffectModelDummyPoints(scene);

    expect(dummies).toHaveLength(1);
    expect(dummies[0].id).toBe(3);
    expect(dummies[0].name).toBe("Dummy3");
    expect(dummies[0].position.toArray()).toEqual([1, 2, 3]);
  });

  it("returns dummy points after async load", async () => {
    mockLoadEffectModel.mockResolvedValue("{}");

    const { result } = renderHook(() => useEffectModelDummies("dummy_model", "proj-dummy"));
    expect(result.current).toEqual([]);

    await waitFor(() => {
      expect(parseOnLoad).not.toBeNull();
    });

    await act(async () => {
      parseOnLoad!({ scene: buildMockScene({ id: 5, position: [4, 0, 2] }) });
    });

    expect(result.current).toHaveLength(1);
    expect(result.current[0].id).toBe(5);
    expect(result.current[0].position.toArray()).toEqual([4, 0, 2]);
    expect(mockLoadEffectModel).toHaveBeenCalledWith("proj-dummy", "dummy_model");
  });
});
