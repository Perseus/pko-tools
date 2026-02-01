import { describe, expect, it } from "vitest";
import { createStore } from "jotai";
import {
  effectDataAtom,
  selectedFrameIndexAtom,
  selectedSubEffectIndexAtom,
} from "@/store/effect";
import { keyframeClipboardAtom } from "@/store/keyframeClipboard";
import type { KeyframeClipboard } from "@/store/keyframeClipboard";
import { createEffectFixture, createSubEffectFixture } from "./fixtures";

describe("keyframeClipboard", () => {
  it("starts as null", () => {
    const store = createStore();
    expect(store.get(keyframeClipboardAtom)).toBeNull();
  });

  it("stores correct values when set", () => {
    const store = createStore();
    const data: KeyframeClipboard = {
      size: [2, 3, 4],
      angle: [0.1, 0.2, 0.3],
      position: [10, 20, 30],
      color: [1, 0.5, 0.3, 0.8],
    };
    store.set(keyframeClipboardAtom, data);
    expect(store.get(keyframeClipboardAtom)).toEqual(data);
  });

  it("persists across frame selection changes", () => {
    const store = createStore();
    const effect = createEffectFixture({
      subEffects: [
        createSubEffectFixture({ frameCount: 3, frameSizes: [[1,1,1],[2,2,2],[3,3,3]] }),
      ],
    });
    store.set(effectDataAtom, effect);
    store.set(selectedSubEffectIndexAtom, 0);
    store.set(selectedFrameIndexAtom, 0);

    const data: KeyframeClipboard = {
      size: [1, 1, 1],
      angle: [0, 0, 0],
      position: [0, 0, 0],
      color: [1, 0.5, 0.3, 1],
    };
    store.set(keyframeClipboardAtom, data);

    // Change frame selection
    store.set(selectedFrameIndexAtom, 2);

    // Clipboard should still be the same
    expect(store.get(keyframeClipboardAtom)).toEqual(data);
  });

  it("can be cleared by setting null", () => {
    const store = createStore();
    store.set(keyframeClipboardAtom, {
      size: [1, 1, 1],
      angle: [0, 0, 0],
      position: [0, 0, 0],
      color: [1, 1, 1, 1],
    });
    expect(store.get(keyframeClipboardAtom)).not.toBeNull();

    store.set(keyframeClipboardAtom, null);
    expect(store.get(keyframeClipboardAtom)).toBeNull();
  });
});
