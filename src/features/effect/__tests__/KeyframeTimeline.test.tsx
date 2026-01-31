import { fireEvent, render, screen } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import React from "react";
import KeyframeTimeline from "@/features/effect/KeyframeTimeline";
import {
  effectDataAtom,
  effectPlaybackAtom,
  selectedFrameIndexAtom,
  selectedSubEffectIndexAtom,
} from "@/store/effect";
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
      frameTimes: [0.2, 0.3],
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

describe("KeyframeTimeline", () => {
  it("updates playback when scrubbing", () => {
    const store = createStore();
    store.set(effectDataAtom, createEffectFixture());
    store.set(selectedSubEffectIndexAtom, 0);
    store.set(selectedFrameIndexAtom, 0);
    store.set(effectPlaybackAtom, {
      isPlaying: true,
      isLooping: true,
      speed: 1,
      currentTime: 0,
    });

    render(
      <Provider store={store}>
        <KeyframeTimeline />
      </Provider>
    );

    const scrubber = screen.getByLabelText("timeline-scrubber");
    fireEvent.change(scrubber, { target: { value: "1" } });

    const playback = store.get(effectPlaybackAtom);
    expect(playback.isPlaying).toBe(false);
    expect(playback.currentTime).toBeCloseTo(0.2, 2);
    expect(store.get(selectedFrameIndexAtom)).toBe(1);
  });

  it("renders frame texture labels", () => {
    const store = createStore();
    store.set(effectDataAtom, {
      ...createEffectFixture(),
      subEffects: [
        {
          ...createEffectFixture().subEffects[0],
          frameTexNames: ["fx_a.png", "fx_b.png"],
        },
      ],
    });
    store.set(selectedSubEffectIndexAtom, 0);
    store.set(selectedFrameIndexAtom, 0);

    render(
      <Provider store={store}>
        <KeyframeTimeline />
      </Provider>
    );

    expect(screen.getByText(/1: fx_a.png/i)).toBeInTheDocument();
    expect(screen.getByText(/2: fx_b.png/i)).toBeInTheDocument();
  });
});
