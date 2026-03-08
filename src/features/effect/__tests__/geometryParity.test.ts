/**
 * Geometry Parity Tests — C++ Truth Table
 *
 * Tests every built-in geometry against exact C++ vertex positions from I_Effect.cpp.
 * These should FAIL against the current (incorrect) code, then PASS after Phase 2 fixes.
 */
import { describe, expect, it } from "vitest";
import {
  createRectGeometry,
  createRectZGeometry,
  createTriangleGeometry,
  resolveGeometry,
} from "@/features/effect/rendering";
import type { SubEffect } from "@/types/effect";

// Helper: extract all positions as [x,y,z][] from a BufferGeometry
function getPositions(geo: THREE.BufferGeometry): [number, number, number][] {
  const attr = geo.getAttribute("position");
  const result: [number, number, number][] = [];
  for (let i = 0; i < attr.count; i++) {
    result.push([attr.getX(i), attr.getY(i), attr.getZ(i)]);
  }
  return result;
}

// Helper: extract all UVs as [u,v][] from a BufferGeometry
function getUVs(geo: THREE.BufferGeometry): [number, number][] {
  const attr = geo.getAttribute("uv");
  const result: [number, number][] = [];
  for (let i = 0; i < attr.count; i++) {
    result.push([attr.getX(i), attr.getY(i)]);
  }
  return result;
}

import * as THREE from "three";

const baseSubEffect: SubEffect = {
  effectName: "test",
  effectType: 0,
  srcBlend: 5,
  destBlend: 6,
  length: 1,
  frameCount: 1,
  frameTimes: [],
  frameSizes: [[1, 1, 1]],
  frameAngles: [[0, 0, 0]],
  framePositions: [[0, 0, 0]],
  frameColors: [[1, 1, 1, 1]],
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
};

/**
 * C++ Reference from I_Effect.cpp:
 *
 * CreateRect()          XZ (Y=0)  (-0.5,0,0), (-0.5,0,1), (0.5,0,1), (0.5,0,0)     UVs: (0,1),(0,0),(1,0),(1,1)
 * CreatePlaneRect()     XY (Z=0)  (-0.5,-0.5,0), (-0.5,0.5,0), (0.5,0.5,0), (0.5,-0.5,0) UVs: (0,1),(0,0),(1,0),(1,1)
 * CreateRectZ()         YZ (X=0)  (0,0,0), (0,0,1), (0,1,1), (0,1,0)               UVs: (0,1),(0,0),(1,0),(1,1)
 * CreateTriangle()      XZ (Y=0)  (0,0,0.5), (-0.5,0,0), (0.5,0,0)                 UVs: (0.5,0),(0,1),(1,1)
 * CreatePlaneTriangle() XY (Z=0)  (0,0.5,0), (-0.5,-0.5,0), (0.5,-0.5,0)           UVs: (0.5,0),(0,1),(1,1)
 */

describe("Geometry Parity — C++ truth table", () => {
  describe("Rect (CreateRect) — XZ plane, Y=0, Z range [0,1]", () => {
    it("has 4 vertices on the XZ plane (all Y=0)", () => {
      const geo = createRectGeometry();
      const positions = getPositions(geo);
      expect(positions).toHaveLength(4);
      for (const [, y] of positions) {
        expect(y).toBe(0);
      }
    });

    it("has Z range [0,1] not centered", () => {
      const geo = createRectGeometry();
      const positions = getPositions(geo);
      const zValues = positions.map(([, , z]) => z);
      expect(Math.min(...zValues)).toBe(0);
      expect(Math.max(...zValues)).toBe(1);
    });

    it("matches exact C++ vertex positions", () => {
      const geo = createRectGeometry();
      const positions = getPositions(geo);
      expect(positions).toEqual([
        [-0.5, 0, 0],
        [-0.5, 0, 1],
        [0.5, 0, 1],
        [0.5, 0, 0],
      ]);
    });

    it("matches exact C++ UV coordinates", () => {
      const geo = createRectGeometry();
      const uvs = getUVs(geo);
      expect(uvs).toEqual([
        [0, 1],
        [0, 0],
        [1, 0],
        [1, 1],
      ]);
    });
  });

  describe("RectPlane (CreatePlaneRect) — XY plane, Z=0, centered", () => {
    it("resolveGeometry maps 'RectPlane' to 'rectPlane' (not 'rectZ')", () => {
      const geo = resolveGeometry({ ...baseSubEffect, modelName: "RectPlane" });
      expect(geo.type).toBe("rectPlane");
    });

    // NOTE: createRectPlaneGeometry doesn't exist yet — this test validates the target behavior.
    // After Phase 2, this will import and test the new function.
  });

  describe("RectZ (CreateRectZ) — YZ plane, X=0, Y/Z range [0,1]", () => {
    it("has 4 vertices on the YZ plane (all X=0)", () => {
      const geo = createRectZGeometry();
      const positions = getPositions(geo);
      expect(positions).toHaveLength(4);
      for (const [x] of positions) {
        expect(x).toBe(0);
      }
    });

    it("has Y range [0,1] and Z range [0,1]", () => {
      const geo = createRectZGeometry();
      const positions = getPositions(geo);
      const yValues = positions.map(([, y]) => y);
      const zValues = positions.map(([, , z]) => z);
      expect(Math.min(...yValues)).toBe(0);
      expect(Math.max(...yValues)).toBe(1);
      expect(Math.min(...zValues)).toBe(0);
      expect(Math.max(...zValues)).toBe(1);
    });

    it("matches exact C++ vertex positions", () => {
      const geo = createRectZGeometry();
      const positions = getPositions(geo);
      expect(positions).toEqual([
        [0, 0, 0],
        [0, 0, 1],
        [0, 1, 1],
        [0, 1, 0],
      ]);
    });

    it("matches exact C++ UV coordinates", () => {
      const geo = createRectZGeometry();
      const uvs = getUVs(geo);
      expect(uvs).toEqual([
        [0, 1],
        [0, 0],
        [1, 0],
        [1, 1],
      ]);
    });
  });

  describe("Triangle (CreateTriangle) — XZ plane, Y=0, tip at Z=0.5", () => {
    it("has 3 vertices on the XZ plane (all Y=0)", () => {
      const geo = createTriangleGeometry();
      const positions = getPositions(geo);
      expect(positions).toHaveLength(3);
      for (const [, y] of positions) {
        expect(y).toBe(0);
      }
    });

    it("has tip vertex at Z=0.5", () => {
      const geo = createTriangleGeometry();
      const positions = getPositions(geo);
      // Tip is the first vertex
      expect(positions[0][2]).toBe(0.5);
    });

    it("matches exact C++ vertex positions", () => {
      const geo = createTriangleGeometry();
      const positions = getPositions(geo);
      expect(positions).toEqual([
        [0, 0, 0.5],
        [-0.5, 0, 0],
        [0.5, 0, 0],
      ]);
    });

    it("matches exact C++ UV coordinates", () => {
      const geo = createTriangleGeometry();
      const uvs = getUVs(geo);
      expect(uvs).toEqual([
        [0.5, 0],
        [0, 1],
        [1, 1],
      ]);
    });
  });

  describe("TrianglePlane (CreatePlaneTriangle) — XY plane, Z=0, tip at Y=0.5", () => {
    it("resolveGeometry maps 'TrianglePlane' to 'trianglePlane' (not 'triangleZ')", () => {
      const geo = resolveGeometry({ ...baseSubEffect, modelName: "TrianglePlane" });
      expect(geo.type).toBe("trianglePlane");
    });

    // NOTE: createTrianglePlaneGeometry will be tested after it's created in Phase 2.
  });

  describe("Cylinder (CreateCylinder) — Z-axis, base at Z=0", () => {
    // These tests will use createCylinderGeometry() once it exists.
    // For now, test that resolveGeometry returns type "cylinder" with correct params.
    it("resolveGeometry returns cylinder type", () => {
      const geo = resolveGeometry({
        ...baseSubEffect,
        modelName: "Cylinder",
        topRadius: 0.5,
        botRadius: 0.5,
        height: 2.0,
        segments: 16,
      });
      expect(geo.type).toBe("cylinder");
      expect(geo.height).toBe(2.0);
    });
  });

  describe("Cone (CreateCone) — Z-axis, base at Z=0", () => {
    it("resolveGeometry returns cylinder type for Cone", () => {
      const geo = resolveGeometry({
        ...baseSubEffect,
        modelName: "Cone",
        topRadius: 0,
        botRadius: 1.0,
        height: 3.0,
        segments: 12,
      });
      expect(geo.type).toBe("cylinder");
      expect(geo.height).toBe(3.0);
    });
  });
});
