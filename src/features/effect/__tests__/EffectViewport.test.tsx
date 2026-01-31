import { act, render, screen } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import EffectViewport from "@/features/effect/EffectViewport";
import EffectMeshRenderer from "@/features/effect/EffectMeshRenderer";
import {
  effectDataAtom,
  selectedFrameIndexAtom,
  selectedSubEffectIndexAtom,
} from "@/store/effect";
import { EffectFile } from "@/types/effect";

vi.mock("@react-three/fiber", () => ({
  Canvas: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="canvas">{children}</div>
  ),
  useFrame: () => {},
}));

vi.mock("@react-three/drei", () => ({
  OrbitControls: () => <div data-testid="orbit-controls" />,
}));

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => path,
  isTauri: () => false,
}));

const effectFixture: EffectFile = {
  version: 7,
  idxTech: 0,
  usePath: false,
  pathName: "",
  useSound: false,
  soundName: "",
  rotating: false,
  rotaVec: [0, 0, 0],
  rotaVel: 0,
  effNum: 1,
  subEffects: [
    {
      effectName: "Spark",
      effectType: 0,
      srcBlend: 2,
      destBlend: 5,
      length: 1,
      frameCount: 1,
      frameTimes: [0.2],
      frameSizes: [[1, 1, 1]],
      frameAngles: [[0, 0, 0]],
      framePositions: [[0, 0, 0]],
      frameColors: [[1, 1, 1, 1]],
      verCount: 0,
      coordCount: 0,
      coordFrameTime: 0,
      coordList: [],
      texCount: 0,
      texFrameTime: 0,
      texName: "",
      texList: [],
      modelName: "",
      billboard: false,
      vsIndex: 0,
      segments: 0,
      height: 0,
      topRadius: 0,
      botRadius: 0,
      frameTexCount: 0,
      frameTexTime: 0,
      frameTexNames: [],
      frameTexTime2: 0,
      useParam: 0,
      perFrameCylinder: [],
      rotaLoop: false,
      rotaLoopVec: [0, 0, 0, 0],
      alpha: false,
      rotaBoard: false,
    },
  ],
};

describe("EffectViewport", () => {
  it("shows empty overlay when no effect loaded", () => {
    const store = createStore();
    store.set(effectDataAtom, null);

    render(
      <Provider store={store}>
        <EffectViewport />
      </Provider>
    );

    expect(screen.getByText(/load an effect/i)).toBeInTheDocument();
  });

  it("handles switching effect data without crashing", () => {
    const store = createStore();
    store.set(effectDataAtom, null);
    store.set(selectedSubEffectIndexAtom, null);
    store.set(selectedFrameIndexAtom, 0);

    render(
      <Provider store={store}>
        <EffectMeshRenderer />
      </Provider>
    );

    act(() => {
      store.set(effectDataAtom, effectFixture);
      store.set(selectedSubEffectIndexAtom, 0);
    });

    act(() => {
      store.set(effectDataAtom, null);
      store.set(selectedSubEffectIndexAtom, null);
    });

    expect(true).toBe(true);
  });
});
