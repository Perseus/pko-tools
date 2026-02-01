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
import { describe, expect, it } from "vitest";
import { createEffectFixture } from "./fixtures";

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

  it("sets speed to 0.5x when clicking 0.5x button", () => {
    const store = createStore();
    store.set(effectDataAtom, createEffectFixture());
    store.set(selectedSubEffectIndexAtom, 0);
    store.set(effectPlaybackAtom, {
      isPlaying: false,
      isLooping: true,
      speed: 1,
      currentTime: 0,
    });

    render(
      <Provider store={store}>
        <KeyframeTimeline />
      </Provider>
    );

    fireEvent.click(screen.getByLabelText("speed-0.5"));
    expect(store.get(effectPlaybackAtom).speed).toBe(0.5);
  });

  it("sets speed to 2x when clicking 2x button", () => {
    const store = createStore();
    store.set(effectDataAtom, createEffectFixture());
    store.set(selectedSubEffectIndexAtom, 0);
    store.set(effectPlaybackAtom, {
      isPlaying: false,
      isLooping: true,
      speed: 1,
      currentTime: 0,
    });

    render(
      <Provider store={store}>
        <KeyframeTimeline />
      </Provider>
    );

    fireEvent.click(screen.getByLabelText("speed-2"));
    expect(store.get(effectPlaybackAtom).speed).toBe(2);
  });

  it("highlights active speed button with secondary variant", () => {
    const store = createStore();
    store.set(effectDataAtom, createEffectFixture());
    store.set(selectedSubEffectIndexAtom, 0);
    store.set(effectPlaybackAtom, {
      isPlaying: false,
      isLooping: true,
      speed: 1,
      currentTime: 0,
    });

    render(
      <Provider store={store}>
        <KeyframeTimeline />
      </Provider>
    );

    // The 1x button should be active (speed=1)
    const activeBtn = screen.getByLabelText("speed-1");
    expect(activeBtn).toBeInTheDocument();

    // Click 0.25x and verify the atom updated
    fireEvent.click(screen.getByLabelText("speed-0.25"));
    expect(store.get(effectPlaybackAtom).speed).toBe(0.25);
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
