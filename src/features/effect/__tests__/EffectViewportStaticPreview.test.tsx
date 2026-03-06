import { render, screen } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import EffectViewport from "@/features/effect/EffectViewport";
import {
  effectDataAtom,
  effectPlaybackAtom,
  effectViewModeAtom,
  effectViewportModeAtom,
  selectedSubEffectIndexAtom,
} from "@/store/effect";
import {
  createEffectFixture,
  createSubEffectFixture,
} from "@/features/effect/__tests__/fixtures";

vi.mock("@react-three/fiber", () => ({
  Canvas: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="canvas">{children}</div>
  ),
  useFrame: () => {},
}));

vi.mock("@react-three/drei", () => ({
  OrbitControls: () => <div data-testid="orbit-controls" />,
}));

vi.mock("@/features/effect/EffectSubRenderer", () => ({
  default: ({
    subEffectIndex,
    frozenFrameIndex,
    frozenPlaybackTime,
  }: {
    subEffectIndex: number;
    frozenFrameIndex?: number;
    frozenPlaybackTime?: number;
  }) => (
    <div
      data-testid="sub-renderer"
      data-index={subEffectIndex}
      data-frame={frozenFrameIndex ?? "selected"}
      data-time={frozenPlaybackTime ?? "live"}
    />
  ),
}));

vi.mock("@/features/effect/EffectPlaybackDriver", () => ({
  default: () => null,
}));

vi.mock("@/features/effect/EffectSkeletonScene", () => ({
  default: () => <div data-testid="skeleton-scene" />,
}));

vi.mock("@/features/effect/particle/ParticleSimulator", () => ({
  default: () => null,
}));

vi.mock("@/features/effect/StripEffectRenderer", () => ({
  default: () => null,
}));

vi.mock("@/features/effect/PathVisualizer", () => ({
  default: () => null,
}));

vi.mock("@/features/effect/CharacterPreview", () => ({
  default: () => null,
}));

vi.mock("@/components/CanvasErrorBoundary", () => ({
  CanvasErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/features/actions/ContextualActionMenu", () => ({
  ContextualActionMenu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/features/perf", () => ({
  PerfFrameProbe: () => null,
  PerfOverlay: () => null,
}));

function renderViewport(store = createStore()) {
  return render(
    <Provider store={store}>
      <EffectViewport />
    </Provider>,
  );
}

describe("EffectViewport static viewer preview", () => {
  it("renders the full effect frozen at frame 0 when viewer render mode is stopped", () => {
    const store = createStore();
    store.set(effectDataAtom, createEffectFixture({
      subEffects: [
        createSubEffectFixture({ effectName: "Sub0" }),
        createSubEffectFixture({ effectName: "Sub1" }),
        createSubEffectFixture({ effectName: "Sub2" }),
      ],
    }));
    store.set(selectedSubEffectIndexAtom, 1);
    store.set(effectViewModeAtom, "viewer");
    store.set(effectViewportModeAtom, "render");
    store.set(effectPlaybackAtom, {
      isPlaying: false,
      isLooping: true,
      speed: 1,
      currentTime: 0,
    });

    renderViewport(store);

    const renderers = screen.getAllByTestId("sub-renderer");
    expect(renderers).toHaveLength(3);
    expect(renderers.map((node) => node.getAttribute("data-index"))).toEqual(["0", "1", "2"]);
    expect(renderers.every((node) => node.getAttribute("data-frame") === "0")).toBe(true);
    expect(renderers.every((node) => node.getAttribute("data-time") === "0")).toBe(true);
  });

  it("keeps editor mode on the selected sub-effect when stopped", () => {
    const store = createStore();
    store.set(effectDataAtom, createEffectFixture({
      subEffects: [
        createSubEffectFixture({ effectName: "Sub0" }),
        createSubEffectFixture({ effectName: "Sub1" }),
      ],
    }));
    store.set(selectedSubEffectIndexAtom, 1);
    store.set(effectViewModeAtom, "editor");
    store.set(effectViewportModeAtom, "render");
    store.set(effectPlaybackAtom, {
      isPlaying: false,
      isLooping: true,
      speed: 1,
      currentTime: 0,
    });

    renderViewport(store);

    const renderers = screen.getAllByTestId("sub-renderer");
    expect(renderers).toHaveLength(1);
    expect(renderers[0]).toHaveAttribute("data-index", "1");
    expect(renderers[0]).toHaveAttribute("data-frame", "selected");
    expect(renderers[0]).toHaveAttribute("data-time", "live");
  });
});
