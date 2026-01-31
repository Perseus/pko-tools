import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider, createStore } from "jotai";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import EffectWorkbench from "@/features/effect/EffectWorkbench";
import { currentProjectAtom } from "@/store/project";
import {
  effectDataAtom,
  effectDirtyAtom,
  effectOriginalAtom,
  selectedEffectAtom,
} from "@/store/effect";
import { EffectFile } from "@/types/effect";

const saveEffectMock = vi.fn().mockResolvedValue(undefined);

vi.mock("@/commands/effect", () => ({
  saveEffect: (...args: unknown[]) => saveEffectMock(...args),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/features/effect/EffectViewport", () => ({
  default: () => <div data-testid="effect-viewport" />,
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

describe("EffectWorkbench", () => {
  it("saves as a new filename", async () => {
    const store = createStore();
    store.set(currentProjectAtom, {
      id: "project-1",
      name: "Test",
      projectDirectory: "/tmp",
    });
    store.set(effectDataAtom, effectFixture);
    store.set(effectOriginalAtom, effectFixture);
    store.set(effectDirtyAtom, true);
    store.set(selectedEffectAtom, "spark.eff");

    render(
      <Provider store={store}>
        <EffectWorkbench />
      </Provider>
    );

    await userEvent.click(screen.getByRole("button", { name: "Save As" }));

    const input = screen.getByPlaceholderText("new-effect-name");
    await userEvent.clear(input);
    await userEvent.type(input, "spark_copy");

    await userEvent.click(screen.getByRole("button", { name: "Save As" }));

    expect(saveEffectMock).toHaveBeenCalledWith(
      "project-1",
      "spark_copy.eff",
      effectFixture
    );
    expect(store.get(selectedEffectAtom)).toBe("spark_copy.eff");
  });
});
