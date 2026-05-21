import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearGltfResourceCache } from "@/lib/gltfResource";
import { useGltfResource } from "../use-gltf-resource";

describe("useGltfResource", () => {
  beforeEach(() => {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: () => "",
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: () => {},
    });
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:gltf-test");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  });

  afterEach(() => {
    clearGltfResourceCache();
    vi.restoreAllMocks();
  });

  it("returns null immediately when the active glTF is cleared", async () => {
    const { result, rerender } = renderHook<string | null, { gltfJson: string | null }>(
      ({ gltfJson }: { gltfJson: string | null }) => useGltfResource(gltfJson),
      { initialProps: { gltfJson: "{\"asset\":{\"version\":\"2.0\"}}" } },
    );

    await waitFor(() => expect(result.current).toBe("blob:gltf-test"));

    rerender({ gltfJson: null });

    expect(result.current).toBeNull();
  });
});
