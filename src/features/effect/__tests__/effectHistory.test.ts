import { describe, expect, it } from "vitest";
import { createStore } from "jotai";
import "@/store/effect";
import { effectHistoryAtom, pushHistoryAtom, canUndoAtom, canRedoAtom } from "@/store/effectHistory";
import type { EffectFile } from "@/types/effect";

function makeEffect(effNum: number): EffectFile {
  return {
    version: 1,
    idxTech: 0,
    usePath: false,
    pathName: "",
    useSound: false,
    soundName: "",
    rotating: false,
    rotaVec: [0, 0, 0],
    rotaVel: 0,
    effNum,
    subEffects: [],
  };
}

describe("effectHistory atoms", () => {
  it("starts with empty history", () => {
    const store = createStore();
    expect(store.get(canUndoAtom)).toBe(false);
    expect(store.get(canRedoAtom)).toBe(false);
  });

  it("pushHistory adds to past and clears future", () => {
    const store = createStore();
    const snap = makeEffect(1);
    store.set(pushHistoryAtom, snap);
    expect(store.get(canUndoAtom)).toBe(true);
    expect(store.get(effectHistoryAtom).past).toHaveLength(1);
    expect(store.get(effectHistoryAtom).future).toHaveLength(0);
  });

  it("pushHistory caps at 50 entries", () => {
    const store = createStore();
    for (let i = 0; i < 60; i++) {
      store.set(pushHistoryAtom, makeEffect(i));
    }
    expect(store.get(effectHistoryAtom).past).toHaveLength(50);
  });

  it("pushHistory clears future on new push", () => {
    const store = createStore();
    store.set(pushHistoryAtom, makeEffect(1));
    // Manually add future entries
    store.set(effectHistoryAtom, {
      past: [makeEffect(1)],
      future: [makeEffect(2)],
    });
    expect(store.get(canRedoAtom)).toBe(true);
    // Push clears future
    store.set(pushHistoryAtom, makeEffect(3));
    expect(store.get(canRedoAtom)).toBe(false);
  });

  it("past snapshots are independent copies", () => {
    const store = createStore();
    const snap = makeEffect(1);
    store.set(pushHistoryAtom, snap);
    snap.effNum = 999;
    expect(store.get(effectHistoryAtom).past[0].effNum).toBe(1);
  });
});
