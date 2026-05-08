import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  appendStripTrackSample,
  buildStripGeometryFromTrack,
  computeStripPairAlpha,
  StripTrackVertex,
} from "../renderers/stripTrailKinematics";
import { DummyLineSpan } from "../renderers/particles/dummyLineKinematics";

function span(): DummyLineSpan {
  return {
    start: new THREE.Vector3(1, 2, 3),
    direction: new THREE.Vector3(0, 0, 1),
    distance: 4,
  };
}

describe("appendStripTrackSample", () => {
  it("matches C++ CMPStrip::GetTrack dummy1/dummy2 vertex order and UVs", () => {
    const first = appendStripTrackSample([], span(), 6);
    const second = appendStripTrackSample(first.vertices, span(), 6);

    expect(first.playing).toBe(true);
    expect(first.vertices.map((v) => v.position.toArray())).toEqual([
      [1, 2, 7],
      [1, 2, 3],
    ]);
    expect(first.vertices.map((v) => v.uv.toArray())).toEqual([
      [0, 1],
      [0, 0],
    ]);

    expect(second.vertices.map((v) => v.uv.toArray())).toEqual([
      [0, 1],
      [0, 0],
      [1, 1],
      [1, 0],
    ]);
  });

  it("stops appending when maxLen is reached for non-looping strips", () => {
    const initial = appendStripTrackSample([], span(), 2).vertices;
    const next = appendStripTrackSample(initial, span(), 2);

    expect(next.playing).toBe(false);
    expect(next.vertices).toHaveLength(2);
  });
});

describe("computeStripPairAlpha", () => {
  it("matches C++ track fade before age increment", () => {
    expect(computeStripPairAlpha(0, 2)).toBe(1);
    expect(computeStripPairAlpha(0.5, 2)).toBe(0.75);
    expect(computeStripPairAlpha(2, 2)).toBe(0);
    expect(computeStripPairAlpha(3, 2)).toBe(0);
  });
});

describe("buildStripGeometryFromTrack", () => {
  it("emits triangle-list indices equivalent to D3D triangle-strip pairs", () => {
    const vertices: StripTrackVertex[] = appendStripTrackSample(
      appendStripTrackSample([], span(), 6).vertices,
      span(),
      6,
    ).vertices;

    const geometry = buildStripGeometryFromTrack(vertices);

    expect(Array.from(geometry.indices)).toEqual([0, 1, 2, 1, 3, 2]);
    expect(Array.from(geometry.alphas)).toEqual([1, 1, 1, 1]);
    expect(Array.from(geometry.uvs)).toEqual([0, 1, 0, 0, 1, 1, 1, 0]);
  });
});
