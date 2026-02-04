import { describe, expect, it } from "vitest";
import { createStore } from "jotai";
import {
  compositePreviewAtom,
  effectPlaybackAtom,
} from "@/store/effect";
import {
  dummyEditModeAtom,
  dummyEditsAtom,
  type DummyTransformEdit,
} from "@/store/character";

describe("compositePreviewAtom", () => {
  it("defaults to false", () => {
    const store = createStore();
    expect(store.get(compositePreviewAtom)).toBe(false);
  });

  it("toggles on", () => {
    const store = createStore();
    store.set(compositePreviewAtom, true);
    expect(store.get(compositePreviewAtom)).toBe(true);
  });

  it("is independent of playback state", () => {
    const store = createStore();
    store.set(compositePreviewAtom, true);
    store.set(effectPlaybackAtom, {
      isPlaying: true,
      isLooping: true,
      speed: 1,
      currentTime: 0.5,
    });
    expect(store.get(compositePreviewAtom)).toBe(true);
  });
});

describe("dummyEditModeAtom", () => {
  it("defaults to false", () => {
    const store = createStore();
    expect(store.get(dummyEditModeAtom)).toBe(false);
  });

  it("can be set to true", () => {
    const store = createStore();
    store.set(dummyEditModeAtom, true);
    expect(store.get(dummyEditModeAtom)).toBe(true);
  });

  it("can be reset to false (simulating model switch cleanup)", () => {
    const store = createStore();
    store.set(dummyEditModeAtom, true);
    store.set(dummyEditModeAtom, false);
    expect(store.get(dummyEditModeAtom)).toBe(false);
  });
});

describe("dummyEditsAtom", () => {
  it("defaults to empty map", () => {
    const store = createStore();
    expect(store.get(dummyEditsAtom).size).toBe(0);
  });

  it("accumulates edits by dummy name", () => {
    const store = createStore();
    const edit1: DummyTransformEdit = {
      position: [1, 2, 3],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    };
    const edit2: DummyTransformEdit = {
      position: [4, 5, 6],
      rotation: [0.1, 0.2, 0.3],
      scale: [1, 1, 1],
    };

    const map = new Map<string, DummyTransformEdit>();
    map.set("Dummy0", edit1);
    map.set("Dummy1", edit2);
    store.set(dummyEditsAtom, map);

    const result = store.get(dummyEditsAtom);
    expect(result.size).toBe(2);
    expect(result.get("Dummy0")?.position).toEqual([1, 2, 3]);
    expect(result.get("Dummy1")?.position).toEqual([4, 5, 6]);
  });

  it("overwrites previous edit for the same dummy", () => {
    const store = createStore();
    const map1 = new Map<string, DummyTransformEdit>();
    map1.set("Dummy0", { position: [1, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
    store.set(dummyEditsAtom, map1);

    const map2 = new Map(store.get(dummyEditsAtom));
    map2.set("Dummy0", { position: [9, 9, 9], rotation: [0, 0, 0], scale: [1, 1, 1] });
    store.set(dummyEditsAtom, map2);

    expect(store.get(dummyEditsAtom).get("Dummy0")?.position).toEqual([9, 9, 9]);
  });
});
