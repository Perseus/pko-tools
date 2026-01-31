import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider, createStore } from "jotai";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import EffectNavigator from "@/features/effect/EffectNavigator";
import { currentProjectAtom } from "@/store/project";
import {
  effectDataAtom,
  effectDirtyAtom,
  selectedEffectAtom,
  selectedFrameIndexAtom,
  selectedSubEffectIndexAtom,
} from "@/store/effect";
import { EffectFile } from "@/types/effect";

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

const listEffectsMock = vi.fn().mockResolvedValue(["first.eff", "second.eff"]);
const loadEffectMock = vi.fn().mockResolvedValue(effectFixture);

vi.mock("@/commands/effect", () => ({
  listEffects: (...args: unknown[]) => listEffectsMock(...args),
  loadEffect: (...args: unknown[]) => loadEffectMock(...args),
}));

describe("EffectNavigator", () => {
  it("prompts to discard when dirty", async () => {
    const store = createStore();
    store.set(currentProjectAtom, {
      id: "project-1",
      name: "Test",
      projectDirectory: "/tmp",
    });
    store.set(effectDirtyAtom, true);

    render(
      <Provider store={store}>
        <EffectNavigator />
      </Provider>
    );

    const button = await screen.findByRole("button", { name: "second.eff" });
    await userEvent.click(button);

    expect(await screen.findByText(/discard changes/i)).toBeInTheDocument();
  });

  it("loads effect after discard", async () => {
    const store = createStore();
    store.set(currentProjectAtom, {
      id: "project-1",
      name: "Test",
      projectDirectory: "/tmp",
    });
    store.set(effectDirtyAtom, true);

    render(
      <Provider store={store}>
        <EffectNavigator />
      </Provider>
    );

    const button = await screen.findByRole("button", { name: "first.eff" });
    await userEvent.click(button);

    const discard = await screen.findByRole("button", { name: "Discard" });
    await userEvent.click(discard);

    await waitFor(() => {
      expect(loadEffectMock).toHaveBeenCalledWith("project-1", "first.eff");
    });

    expect(store.get(selectedEffectAtom)).toBe("first.eff");
    expect(store.get(effectDataAtom)).toEqual(effectFixture);
    expect(store.get(selectedSubEffectIndexAtom)).toBe(0);
    expect(store.get(selectedFrameIndexAtom)).toBe(0);
    expect(store.get(effectDirtyAtom)).toBe(false);
  });
});
