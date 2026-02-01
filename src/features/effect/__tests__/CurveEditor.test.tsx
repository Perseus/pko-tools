import { render, screen, fireEvent } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import React from "react";
import CurveEditor from "@/features/effect/CurveEditor";
import {
  effectDataAtom,
  selectedFrameIndexAtom,
  selectedSubEffectIndexAtom,
} from "@/store/effect";
import { describe, expect, it } from "vitest";
import { createEffectWithFrames } from "./fixtures";

function setup(frameCount = 4) {
  const store = createStore();
  store.set(effectDataAtom, createEffectWithFrames(frameCount));
  store.set(selectedSubEffectIndexAtom, 0);
  store.set(selectedFrameIndexAtom, 0);

  const result = render(
    <Provider store={store}>
      <CurveEditor />
    </Provider>,
  );

  return { store, ...result };
}

describe("CurveEditor component", () => {
  it("renders keyframe dots for default channels", () => {
    const { container } = setup(4);

    // Default channels: position.x, position.y, position.z → 3 channels × 4 frames = 12 dots
    const dots = container.querySelectorAll("[data-testid^='dot-']");
    expect(dots.length).toBe(12);
  });

  it("renders polylines for active channels", () => {
    const { container } = setup(4);

    const lines = container.querySelectorAll("[data-testid^='line-']");
    expect(lines.length).toBe(3); // 3 default channels
  });

  it("clicking a dot updates selectedFrameIndexAtom", () => {
    const { store, container } = setup(4);

    const dot = container.querySelector("[data-testid='dot-position.x-2']");
    expect(dot).not.toBeNull();
    fireEvent.click(dot!);

    expect(store.get(selectedFrameIndexAtom)).toBe(2);
  });

  it("toggling a channel hides its polyline", () => {
    const { container } = setup(4);

    // Initially 3 lines
    expect(container.querySelectorAll("[data-testid^='line-']").length).toBe(3);

    // Toggle off position.x
    fireEvent.click(screen.getByLabelText("toggle-position.x"));
    expect(container.querySelectorAll("[data-testid^='line-']").length).toBe(2);

    // Toggle it back on
    fireEvent.click(screen.getByLabelText("toggle-position.x"));
    expect(container.querySelectorAll("[data-testid^='line-']").length).toBe(3);
  });

  it("renders nothing when no sub-effect selected", () => {
    const store = createStore();
    store.set(effectDataAtom, null);
    store.set(selectedSubEffectIndexAtom, null);

    const { container } = render(
      <Provider store={store}>
        <CurveEditor />
      </Provider>,
    );

    expect(container.querySelector("svg")).toBeNull();
  });
});
