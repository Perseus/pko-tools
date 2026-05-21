import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { computeItemDummyLineSpan } from "../itemParticleDummySpan";

describe("computeItemDummyLineSpan", () => {
  it("derives the item dummy1-to-dummy2 span from runtime dummy matrices", () => {
    const span = computeItemDummyLineSpan([
      { id: 1, name: "dummy1", matrix: new THREE.Matrix4().makeTranslation(10, 0, 0) },
      { id: 2, name: "dummy2", matrix: new THREE.Matrix4().makeTranslation(4, 0, 0) },
    ]);

    expect(span).not.toBeNull();
    if (!span) throw new Error("expected span");
    expect(span.start.toArray()).toEqual([4, 0, 0]);
    expect(span.distance).toBeCloseTo(6);
    expect(span.direction.toArray()).toEqual([1, 0, 0]);
  });

  it("returns null when either required item dummy is missing", () => {
    expect(computeItemDummyLineSpan([
      { id: 1, name: "dummy1", matrix: new THREE.Matrix4().makeTranslation(10, 0, 0) },
    ])).toBeNull();
  });
});
