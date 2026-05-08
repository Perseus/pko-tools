import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  advanceLinkTextureFrame,
  buildLinkBeamGeometry,
  computeLinkArcRadius,
} from "../renderers/linkBeamKinematics";

function closeArray(actual: ArrayLike<number>, expected: number[], digits = 5) {
  expect(Array.from(actual).map((n) => Number(n.toFixed(digits)))).toEqual(expected);
}

describe("computeLinkArcRadius", () => {
  it("matches CMPLink::GetPhysique radius compression/expansion", () => {
    expect(computeLinkArcRadius(10)).toBeCloseTo(2.3);
    expect(computeLinkArcRadius(4)).toBeCloseTo(2.9);
    expect(computeLinkArcRadius(6)).toBeCloseTo(2.7);
  });
});

describe("advanceLinkTextureFrame", () => {
  it("advances only when accumulated time is strictly greater than 0.15s", () => {
    let state = { index: 0, time: 0 };

    state = advanceLinkTextureFrame(state, 0.15, 4);
    expect(state).toEqual({ index: 0, time: 0.15 });

    state = advanceLinkTextureFrame(state, 0.001, 4);
    expect(state).toEqual({ index: 1, time: 0 });
  });

  it("drops overshoot like CMPLink::FrameMove instead of carrying remainder", () => {
    const state = advanceLinkTextureFrame({ index: 3, time: 0.1 }, 0.2, 4);

    expect(state).toEqual({ index: 0, time: 0 });
  });
});

describe("buildLinkBeamGeometry", () => {
  it("matches CMPLink::ColArc pair count, UVs, and D3D triangle-strip expansion", () => {
    const geometry = buildLinkBeamGeometry({
      startPko: new THREE.Vector3(0, 0, 0),
      endPko: new THREE.Vector3(10, 0, 0),
      eyePko: new THREE.Vector3(0, 10, 0),
    });

    expect(geometry.vertexCount).toBe(22);
    expect(geometry.positions).toHaveLength(66);
    expect(geometry.uvs).toHaveLength(44);
    expect(geometry.indices).toHaveLength(60);
    closeArray(geometry.uvs.slice(0, 6), [0, 1, 0, 0, 0.00283, 1]);
    expect(Array.from(geometry.indices.slice(0, 6))).toEqual([0, 1, 2, 1, 3, 2]);
  });

  it("keeps CMPLink geometry in raw runtime axes after C++ arc placement", () => {
    const geometry = buildLinkBeamGeometry({
      startPko: new THREE.Vector3(0, 0, 0),
      endPko: new THREE.Vector3(10, 0, 0),
      eyePko: new THREE.Vector3(0, 10, 0),
    });

    closeArray(geometry.positions.slice(0, 6), [0, 0, -1, 0, 0, 1]);
    closeArray(geometry.positions.slice(-6), [10, 0, -1, 10, 0, 1]);
  });
});
