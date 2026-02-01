import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import * as THREE from "three";

// Mock the Tauri invoke-based command
vi.mock("@/commands/effect", () => ({
  loadEffectModel: vi.fn(),
}));

// Track the parse callback so we can trigger it manually
let parseOnLoad: ((gltf: { scene: THREE.Group }) => void) | null = null;

// Mock GLTFLoader.parse to capture the onLoad callback
vi.mock("three/examples/jsm/loaders/GLTFLoader.js", () => {
  class MockGLTFLoader {
    parse(
      _data: ArrayBuffer,
      _path: string,
      onLoad: (gltf: { scene: THREE.Group }) => void,
    ) {
      parseOnLoad = onLoad;
    }
  }
  return { GLTFLoader: MockGLTFLoader };
});

function buildMockScene(): THREE.Group {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3)
  );
  const mesh = new THREE.Mesh(geo);
  const scene = new THREE.Group();
  scene.add(mesh);
  return scene;
}

// Import after mocks
const { loadEffectModel } = await import("@/commands/effect");
const mockLoadEffectModel = vi.mocked(loadEffectModel);
const { useEffectModel } = await import("../useEffectModel");

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
});
