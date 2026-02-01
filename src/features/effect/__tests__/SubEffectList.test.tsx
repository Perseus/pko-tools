import { fireEvent, render, screen } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import React from "react";
import SubEffectList from "@/features/effect/SubEffectList";
import {
  effectDataAtom,
  selectedFrameIndexAtom,
  selectedSubEffectIndexAtom,
} from "@/store/effect";
import { effectHistoryAtom } from "@/store/effectHistory";
import { describe, expect, it } from "vitest";
import { createEffectFixture, createSubEffectFixture } from "./fixtures";

function setupStore(subEffectCount = 3) {
  const store = createStore();
  const subEffects = Array.from({ length: subEffectCount }, (_, i) =>
    createSubEffectFixture({ effectName: `Effect_${i}` }),
  );
  store.set(effectDataAtom, createEffectFixture({ subEffects, effNum: subEffectCount }));
  store.set(selectedSubEffectIndexAtom, 0);
  store.set(selectedFrameIndexAtom, 0);
  return store;
}

describe("SubEffectList", () => {
  it("duplicates a sub-effect", () => {
    const store = setupStore(3);

    render(
      <Provider store={store}>
        <SubEffectList />
      </Provider>,
    );

    fireEvent.click(screen.getByLabelText("duplicate-0"));

    const data = store.get(effectDataAtom)!;
    expect(data.subEffects).toHaveLength(4);
    expect(data.subEffects[1].effectName).toBe("Effect_0 copy");
    expect(store.get(selectedSubEffectIndexAtom)).toBe(1);
  });

  it("deletes a sub-effect and adjusts selection", () => {
    const store = setupStore(3);
    store.set(selectedSubEffectIndexAtom, 1);

    render(
      <Provider store={store}>
        <SubEffectList />
      </Provider>,
    );

    fireEvent.click(screen.getByLabelText("delete-1"));

    const data = store.get(effectDataAtom)!;
    expect(data.subEffects).toHaveLength(2);
    // Selection should stay at index 1 (clamped to new length - 1)
    expect(store.get(selectedSubEffectIndexAtom)).toBe(1);
  });

  it("moves sub-effect down", () => {
    const store = setupStore(3);

    render(
      <Provider store={store}>
        <SubEffectList />
      </Provider>,
    );

    fireEvent.click(screen.getByLabelText("move-down-0"));

    const data = store.get(effectDataAtom)!;
    expect(data.subEffects[0].effectName).toBe("Effect_1");
    expect(data.subEffects[1].effectName).toBe("Effect_0");
    expect(store.get(selectedSubEffectIndexAtom)).toBe(1);
  });

  it("moves sub-effect up", () => {
    const store = setupStore(3);
    store.set(selectedSubEffectIndexAtom, 1);

    render(
      <Provider store={store}>
        <SubEffectList />
      </Provider>,
    );

    fireEvent.click(screen.getByLabelText("move-up-1"));

    const data = store.get(effectDataAtom)!;
    expect(data.subEffects[0].effectName).toBe("Effect_1");
    expect(data.subEffects[1].effectName).toBe("Effect_0");
    expect(store.get(selectedSubEffectIndexAtom)).toBe(0);
  });

  it("pushes undo snapshot before each operation", () => {
    const store = setupStore(3);

    render(
      <Provider store={store}>
        <SubEffectList />
      </Provider>,
    );

    // Initial history should be empty
    expect(store.get(effectHistoryAtom).past).toHaveLength(0);

    fireEvent.click(screen.getByLabelText("duplicate-0"));
    expect(store.get(effectHistoryAtom).past).toHaveLength(1);

    fireEvent.click(screen.getByLabelText("delete-0"));
    expect(store.get(effectHistoryAtom).past).toHaveLength(2);

    fireEvent.click(screen.getByLabelText("move-down-0"));
    expect(store.get(effectHistoryAtom).past).toHaveLength(3);
  });
});
