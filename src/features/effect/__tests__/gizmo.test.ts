import { describe, expect, it } from "vitest";
import { createStore } from "jotai";
import { gizmoModeAtom } from "@/store/gizmo";

describe("gizmoModeAtom", () => {
  it("defaults to translate", () => {
    const store = createStore();
    expect(store.get(gizmoModeAtom)).toBe("translate");
  });

  it("can be set to rotate", () => {
    const store = createStore();
    store.set(gizmoModeAtom, "rotate");
    expect(store.get(gizmoModeAtom)).toBe("rotate");
  });

  it("can be set to scale", () => {
    const store = createStore();
    store.set(gizmoModeAtom, "scale");
    expect(store.get(gizmoModeAtom)).toBe("scale");
  });

  it("can be set to off", () => {
    const store = createStore();
    store.set(gizmoModeAtom, "off");
    expect(store.get(gizmoModeAtom)).toBe("off");
  });
});
