import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import React from "react";
import TextureBrowser from "@/features/effect/TextureBrowser";
import {
  effectDataAtom,
  selectedSubEffectIndexAtom,
} from "@/store/effect";
import { currentProjectAtom } from "@/store/project";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { createEffectFixture } from "./fixtures";

const mockInvoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

function setup() {
  const store = createStore();
  store.set(effectDataAtom, createEffectFixture());
  store.set(selectedSubEffectIndexAtom, 0);
  store.set(currentProjectAtom, {
    id: "proj-1",
    name: "Test Project",
    projectDirectory: "/test",
    clientDirectory: "/test",
  } as any);

  const result = render(
    <Provider store={store}>
      <TextureBrowser />
    </Provider>,
  );

  return { store, ...result };
}

describe("TextureBrowser", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue([
      "texture/effect/fire01.tga",
      "texture/effect/fire02.tga",
      "texture/skill/heal01.dds",
      "texture/lit/glow.png",
    ]);
  });

  it("renders correct number of items after expanding", async () => {
    setup();

    // Click to expand
    fireEvent.click(screen.getByText("Texture Browser"));

    await waitFor(() => {
      const options = screen.getAllByRole("option");
      expect(options).toHaveLength(4);
    });
  });

  it("filters by search query", async () => {
    setup();

    fireEvent.click(screen.getByText("Texture Browser"));

    await waitFor(() => {
      expect(screen.getAllByRole("option")).toHaveLength(4);
    });

    const searchInput = screen.getByLabelText("texture-search");
    fireEvent.change(searchInput, { target: { value: "fire" } });

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
  });

  it("clicking a texture updates effectDataAtom", async () => {
    const { store } = setup();

    fireEvent.click(screen.getByText("Texture Browser"));

    await waitFor(() => {
      expect(screen.getAllByRole("option")).toHaveLength(4);
    });

    // Click the first texture
    fireEvent.click(screen.getAllByRole("option")[0]);

    const data = store.get(effectDataAtom)!;
    expect(data.subEffects[0].texName).toBe("fire01");
  });
});
