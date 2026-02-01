import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildRibbonGeometry } from "@/features/effect/StripEffectRenderer";

describe("buildRibbonGeometry", () => {
  it("produces correct vertex count", () => {
    const pointA = new THREE.Vector3(0, 0.5, 0);
    const pointB = new THREE.Vector3(0, -0.5, 0);
    const { positions, vertexCount } = buildRibbonGeometry(pointA, pointB, 5);

    // 5 segments → 6 rows × 2 vertices = 12 vertices
    expect(vertexCount).toBe(12);
    expect(positions.length).toBe(12 * 3);
  });

  it("produces correct index count for triangle strip", () => {
    const pointA = new THREE.Vector3(0, 0.5, 0);
    const pointB = new THREE.Vector3(0, -0.5, 0);
    const { indices } = buildRibbonGeometry(pointA, pointB, 4);

    // 4 segments → 8 triangles → 24 indices
    expect(indices.length).toBe(24);
  });

  it("handles maxLen of 2 (minimum)", () => {
    const pointA = new THREE.Vector3(1, 0, 0);
    const pointB = new THREE.Vector3(-1, 0, 0);
    const { vertexCount, indices } = buildRibbonGeometry(pointA, pointB, 2);

    // 2 segments → 3 rows × 2 = 6 vertices
    expect(vertexCount).toBe(6);
    // 2 segments → 4 triangles → 12 indices
    expect(indices.length).toBe(12);
  });

  it("vertex positions span the ribbon width", () => {
    const pointA = new THREE.Vector3(0, 1, 0);
    const pointB = new THREE.Vector3(0, -1, 0);
    const { positions } = buildRibbonGeometry(pointA, pointB, 3);

    // First two vertices should be at y=-1 and y=1 (or close)
    // Left vertex: mid + side * -halfWidth, Right: mid + side * halfWidth
    const y0 = positions[1]; // first vertex Y
    const y1 = positions[4]; // second vertex Y
    // The width between A and B is 2, so halfWidth=1
    expect(Math.abs(y0 - y1)).toBeCloseTo(2, 1);
  });

  it("indices reference valid vertex range", () => {
    const pointA = new THREE.Vector3(0, 0, 0);
    const pointB = new THREE.Vector3(1, 0, 0);
    const { indices, vertexCount } = buildRibbonGeometry(pointA, pointB, 6);

    for (let i = 0; i < indices.length; i++) {
      expect(indices[i]).toBeLessThan(vertexCount);
      expect(indices[i]).toBeGreaterThanOrEqual(0);
    }
  });
});
