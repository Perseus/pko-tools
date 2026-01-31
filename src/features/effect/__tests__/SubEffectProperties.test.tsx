import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider, createStore } from "jotai";
import React from "react";
import SubEffectProperties from "@/features/effect/SubEffectProperties";
import { effectDataAtom, selectedSubEffectIndexAtom } from "@/store/effect";
import { EffectFile } from "@/types/effect";
import { describe, expect, it } from "vitest";

const createEffectFixture = (): EffectFile => ({
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
      frameCount: 2,
      frameTimes: [0.2, 0.2],
      frameSizes: [
        [1, 1, 1],
        [2, 2, 2],
      ],
      frameAngles: [
        [0, 0, 0],
        [0.3, 0.1, 0],
      ],
      framePositions: [
        [0, 0, 0],
        [1, 2, 3],
      ],
      frameColors: [
        [1, 0.5, 0.3, 1],
        [0.2, 0.3, 0.4, 0.8],
      ],
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
});

describe("SubEffectProperties", () => {
  it("updates the sub-effect name", async () => {
    const store = createStore();
    store.set(effectDataAtom, createEffectFixture());
    store.set(selectedSubEffectIndexAtom, 0);

    render(
      <Provider store={store}>
        <SubEffectProperties />
      </Provider>
    );

    const input = screen.getByLabelText("subeffect-name");
    await userEvent.clear(input);
    await userEvent.type(input, "Glow");

    const updated = store.get(effectDataAtom);
    expect(updated?.subEffects[0].effectName).toBe("Glow");
  });

  it("toggles billboard flag", async () => {
    const store = createStore();
    store.set(effectDataAtom, createEffectFixture());
    store.set(selectedSubEffectIndexAtom, 0);

    render(
      <Provider store={store}>
        <SubEffectProperties />
      </Provider>
    );

    const checkbox = screen.getByLabelText("subeffect-billboard");
    await userEvent.click(checkbox);

    const updated = store.get(effectDataAtom);
    expect(updated?.subEffects[0].billboard).toBe(true);
  });
});
