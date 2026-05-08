/**
 * Geometry Parity Tests — C++ Truth Table
 *
 * Tests every built-in geometry against exact C++ vertex positions from I_Effect.cpp.
 * These should FAIL against the current (incorrect) code, then PASS after Phase 2 fixes.
 */
import { describe, expect, it } from "vitest";
import {
  createCylinderGeometry,
  createRectPlaneGeometry,
  createRectGeometry,
  createRectZGeometry,
  createTrianglePlaneGeometry,
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

    it("matches exact C++ vertex positions", () => {
      const geo = createRectPlaneGeometry();
      const positions = getPositions(geo);
      expect(positions).toEqual([
        [-0.5, -0.5, 0],
        [-0.5, 0.5, 0],
        [0.5, 0.5, 0],
        [0.5, -0.5, 0],
      ]);
    });

    it("matches exact C++ UV coordinates", () => {
      const geo = createRectPlaneGeometry();
      const uvs = getUVs(geo);
      expect(uvs).toEqual([
        [0, 1],
        [0, 0],
        [1, 0],
        [1, 1],
      ]);
    });
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

    it("matches exact C++ vertex positions", () => {
      const geo = createTrianglePlaneGeometry();
      const positions = getPositions(geo);
      expect(positions).toEqual([
        [0, 0.5, 0],
        [-0.5, -0.5, 0],
        [0.5, -0.5, 0],
      ]);
    });

    it("matches exact C++ UV coordinates", () => {
      const geo = createTrianglePlaneGeometry();
      const uvs = getUVs(geo);
      expect(uvs).toEqual([
        [0.5, 0],
        [0, 1],
        [1, 1],
      ]);
    });
  });

  describe("Sphere", () => {
    it("does not resolve to a procedural built-in because the C++ client never creates a Sphere mesh", () => {
      const geo = resolveGeometry({ ...baseSubEffect, modelName: "Sphere" });

      expect(geo).toEqual({ type: "model", modelName: "Sphere" });
    });
  });

  describe("Cylinder (CreateCylinder) — Z-axis, base at Z=0", () => {
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

    it("creates cylinder geometry along Z with base at 0 and top at height", () => {
      const geo = createCylinderGeometry(0.5, 0.5, 2, 8);
      const positions = getPositions(geo);
      const zValues = positions.map(([, , z]) => z);

      expect(Math.min(...zValues)).toBeCloseTo(0);
      expect(Math.max(...zValues)).toBeCloseTo(2);
    });

    it("matches C++ top/bottom triangle-strip vertex order and UVs", () => {
      const geo = createCylinderGeometry(0.5, 1, 2, 4);
      const positions = getPositions(geo);
      const uvs = getUVs(geo);

      expect(positions).toHaveLength(10);
      expect(positions).toEqual([
        [0, 0.5, 2],
        [0, 1, 0],
        [0.5, 0, 2],
        [1, 0, 0],
        [0, -0.5, 2],
        [0, -1, 0],
        [-0.5, 0, 2],
        [-1, 0, 0],
        [0, 0.5, 2],
        [0, 1, 0],
      ]);
      expect(uvs).toEqual([
        [1, 0],
        [1, 1],
        [0.75, 0],
        [0.75, 1],
        [0.5, 0],
        [0.5, 1],
        [0.25, 0],
        [0.25, 1],
        [0, 0],
        [0, 1],
      ]);
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

    it("preserves Cone topRadius=0 instead of replacing it with a cylinder default", () => {
      const geo = resolveGeometry({
        ...baseSubEffect,
        modelName: "Cone",
        topRadius: 0,
        botRadius: 1.0,
        height: 3.0,
        segments: 12,
      });

      expect(geo.type).toBe("cylinder");
      expect(geo.topRadius).toBe(0);
      expect(geo.botRadius).toBe(1.0);
    });

    it("defaults Cone topRadius to 0 when runtime effect data omits the field", () => {
      const coneWithoutTopRadius = {
        ...baseSubEffect,
        modelName: "Cone",
        topRadius: undefined,
        botRadius: 1.0,
        height: 3.0,
        segments: 12,
      } as unknown as SubEffect;

      const geo = resolveGeometry(coneWithoutTopRadius);

      expect(geo.type).toBe("cylinder");
      expect(geo.topRadius).toBe(0);
      expect(geo.botRadius).toBe(1.0);
    });

    it("defaults per-frame Cone topRadius to 0 when runtime param data omits the field", () => {
      const coneWithoutPerFrameTopRadius = {
        ...baseSubEffect,
        modelName: "Cone",
        useParam: 1,
        perFrameCylinder: [
          { segments: 8, height: 3.0, botRadius: 2.0 },
        ],
      } as unknown as SubEffect;

      const geo = resolveGeometry(coneWithoutPerFrameTopRadius, 0);

      expect(geo.type).toBe("cylinder");
      expect(geo.topRadius).toBe(0);
      expect(geo.botRadius).toBe(2.0);
    });

    it("preserves per-frame topRadius=0 for deformable cone frames", () => {
      const geo = resolveGeometry({
        ...baseSubEffect,
        modelName: "Cone",
        useParam: 1,
        perFrameCylinder: [
          { segments: 8, height: 3.0, topRadius: 0, botRadius: 2.0 },
        ],
      }, 0);

      expect(geo.type).toBe("cylinder");
      expect(geo.topRadius).toBe(0);
      expect(geo.botRadius).toBe(2.0);
    });

    it("uses C++ cone UVs with bottom V=1.5 instead of cylinder V=1.0", () => {
      const config = resolveGeometry({
        ...baseSubEffect,
        modelName: "Cone",
        topRadius: 0,
        botRadius: 1,
        height: 2,
        segments: 4,
      });
      expect(config.type).toBe("cylinder");

      const geo = createCylinderGeometry(
        config.topRadius,
        config.botRadius,
        config.height,
        config.segments,
        config.bottomUvV,
      );
      const uvs = getUVs(geo);

      expect(uvs).toEqual([
        [1, 0],
        [1, 1.5],
        [0.75, 0],
        [0.75, 1.5],
        [0.5, 0],
        [0.5, 1.5],
        [0.25, 0],
        [0.25, 1.5],
        [0, 0],
        [0, 1.5],
      ]);
    });
  });
});
