import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildViewDependentRibbon, buildRibbonGeometry } from "@/features/effect/StripEffectRenderer";

describe("buildViewDependentRibbon", () => {
  const segments = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(0, 0, -2),
    new THREE.Vector3(0, 0, -3),
    new THREE.Vector3(0, 0, -4),
    new THREE.Vector3(0, 0, -5),
    new THREE.Vector3(0, 0, -6),
    new THREE.Vector3(0, 0, -7),
    new THREE.Vector3(0, 0, -8),
    new THREE.Vector3(0, 0, -9),
  ];
  const halfWidth = 0.5;
  const cameraPos = new THREE.Vector3(0, 5, 0);

  it("generates correct vertex count (2 per segment)", () => {
    const result = buildViewDependentRibbon(segments, halfWidth, cameraPos, 1.0);
    expect(result.vertexCount).toBe(segments.length * 2);
  });

  it("vertices are perpendicular to both tangent and view direction", () => {
    const result = buildViewDependentRibbon(segments, halfWidth, cameraPos, 1.0);
    // For a straight trail along -Z with camera above at Y+5,
    // side direction should be along X axis
    for (let i = 0; i < segments.length; i++) {
      const li = i * 2;
      const ri = i * 2 + 1;
      const leftX = result.positions[li * 3];
      const rightX = result.positions[ri * 3];
      // Left and right should differ in X by ~halfWidth*2
      expect(Math.abs(rightX - leftX)).toBeCloseTo(halfWidth * 2, 1);
    }
  });

  it("UV coordinates: V alternates 0/1, U increases monotonically", () => {
    const result = buildViewDependentRibbon(segments, halfWidth, cameraPos, 1.0);
    let prevU = -1;
    for (let i = 0; i < segments.length; i++) {
      const li = i * 2;
      const ri = i * 2 + 1;

      // V: left=0, right=1
      expect(result.uvs[li * 2 + 1]).toBe(0);
      expect(result.uvs[ri * 2 + 1]).toBe(1);

      // U: left and right should match, and increase
      const u = result.uvs[li * 2];
      expect(result.uvs[ri * 2]).toBe(u);
      expect(u).toBeGreaterThanOrEqual(prevU);
      prevU = u;
    }
  });

  it("alpha decreases linearly along trail age", () => {
    const result = buildViewDependentRibbon(segments, halfWidth, cameraPos, 1.0);
    // First segment: alpha = 1.0
    expect(result.alphas[0]).toBeCloseTo(1.0, 2);
    expect(result.alphas[1]).toBeCloseTo(1.0, 2);
    // Last segment: alpha = 0.0
    const lastLeft = (segments.length - 1) * 2;
    expect(result.alphas[lastLeft]).toBeCloseTo(0.0, 2);
    expect(result.alphas[lastLeft + 1]).toBeCloseTo(0.0, 2);
    // Middle: intermediate alpha
    const midIdx = Math.floor(segments.length / 2) * 2;
    expect(result.alphas[midIdx]).toBeGreaterThan(0);
    expect(result.alphas[midIdx]).toBeLessThan(1);
  });

  it("returns empty for less than 2 segments", () => {
    const one = buildViewDependentRibbon([new THREE.Vector3(0, 0, 0)], halfWidth, cameraPos, 1.0);
    expect(one.vertexCount).toBe(0);
    expect(one.positions.length).toBe(0);

    const zero = buildViewDependentRibbon([], halfWidth, cameraPos, 1.0);
    expect(zero.vertexCount).toBe(0);
  });

  it("generates correct index count", () => {
    const result = buildViewDependentRibbon(segments, halfWidth, cameraPos, 1.0);
    const expectedQuads = segments.length - 1;
    expect(result.indices.length).toBe(expectedQuads * 6);
  });

  it("alpha is 1.0 everywhere when life is 0 (no fade)", () => {
    const result = buildViewDependentRibbon(segments, halfWidth, cameraPos, 0);
    for (let i = 0; i < result.alphas.length; i++) {
      expect(result.alphas[i]).toBe(1.0);
    }
  });
});

describe("buildRibbonGeometry (static fallback)", () => {
  it("produces correct vertex and index counts", () => {
    const pointA = new THREE.Vector3(0, 0.5, 0);
    const pointB = new THREE.Vector3(0, -0.5, 0);
    const { positions, indices, vertexCount } = buildRibbonGeometry(pointA, pointB, 10);
    expect(vertexCount).toBe(22); // (10+1)*2
    expect(positions.length).toBe(vertexCount * 3);
    expect(indices.length).toBe(10 * 2 * 3); // 10 segments * 2 triangles * 3 indices
  });
});
