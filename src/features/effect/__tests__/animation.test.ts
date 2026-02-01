import { describe, expect, it } from "vitest";
import {
  interpolateFrame,
  getFrameDurations,
  interpolateUVCoords,
  getTexListFrameIndex,
  getPathPosition,
} from "@/features/effect/animation";
import type { SubEffect, Vec3 } from "@/types/effect";

const baseSubEffect: SubEffect = {
  effectName: "Test",
  effectType: 0,
  srcBlend: 2,
  destBlend: 5,
  length: 1,
  frameCount: 2,
  frameTimes: [1.0, 1.0],
  frameSizes: [
    [1, 1, 1],
    [3, 3, 3],
  ],
  frameAngles: [
    [0, 0, 0],
    [0.6, 0.4, 0.2],
  ],
  framePositions: [
    [0, 0, 0],
    [10, 0, 0],
  ],
  frameColors: [
    [1, 1, 1, 1],
    [1, 1, 1, 0],
  ],
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

describe("getFrameDurations", () => {
  it("uses frameTimes when available", () => {
    const durations = getFrameDurations(baseSubEffect);
    expect(durations).toEqual([1.0, 1.0]);
  });

  it("enforces minimum frame duration", () => {
    const sub = { ...baseSubEffect, frameTimes: [0, 0.001] };
    const durations = getFrameDurations(sub);
    expect(durations[0]).toBeCloseTo(1 / 30);
    expect(durations[1]).toBeCloseTo(1 / 30);
  });

  it("uses default durations when frameTimes is empty", () => {
    const sub = { ...baseSubEffect, frameTimes: [], frameCount: 3 };
    const durations = getFrameDurations(sub);
    expect(durations).toHaveLength(3);
    expect(durations[0]).toBeCloseTo(1 / 30);
  });
});

describe("interpolateFrame", () => {
  it("returns first frame values at t=0", () => {
    const result = interpolateFrame(baseSubEffect, 0, false);
    expect(result.frameIndex).toBe(0);
    expect(result.lerp).toBeCloseTo(0);
    expect(result.size).toEqual([1, 1, 1]);
    expect(result.position).toEqual([0, 0, 0]);
    expect(result.color[3]).toBeCloseTo(1);
  });

  it("interpolates linearly at midpoint of first frame", () => {
    const result = interpolateFrame(baseSubEffect, 0.5, false);
    expect(result.frameIndex).toBe(0);
    expect(result.lerp).toBeCloseTo(0.5);
    expect(result.size[0]).toBeCloseTo(2.0);
    expect(result.position[0]).toBeCloseTo(5.0);
    expect(result.angle[0]).toBeCloseTo(0.3);
  });

  it("reaches second frame at t = first frame duration", () => {
    const result = interpolateFrame(baseSubEffect, 1.0, false);
    expect(result.frameIndex).toBe(1);
    expect(result.lerp).toBeCloseTo(0);
  });

  it("interpolates color alpha for fade out", () => {
    const result = interpolateFrame(baseSubEffect, 0.5, false);
    // Frame 0: alpha=1, Frame 1: alpha=0, lerp=0.5 → alpha=0.5
    expect(result.color[3]).toBeCloseTo(0.5);
  });

  it("clamps to last frame when not looping and past total duration", () => {
    const result = interpolateFrame(baseSubEffect, 5.0, false);
    expect(result.frameIndex).toBe(1);
    // At total duration, should be at the last frame
    expect(result.size[0]).toBeCloseTo(3.0);
  });

  it("wraps around when looping past total duration", () => {
    // totalDuration = 2.0, t=2.5 → wraps to t=0.5 (50% of frame 0)
    const result = interpolateFrame(baseSubEffect, 2.5, true);
    expect(result.frameIndex).toBe(0);
    expect(result.lerp).toBeCloseTo(0.5);
    expect(result.size[0]).toBeCloseTo(2.0);
  });

  it("loops nextFrameIndex back to 0 on last frame", () => {
    // At t=1.5 (frame 1, lerp=0.5), looping should interpolate toward frame 0
    const result = interpolateFrame(baseSubEffect, 1.5, true);
    expect(result.frameIndex).toBe(1);
    expect(result.nextFrameIndex).toBe(0);
    expect(result.lerp).toBeCloseTo(0.5);
    // Size: lerp(3, 1, 0.5) = 2
    expect(result.size[0]).toBeCloseTo(2.0);
  });

  it("does not wrap nextFrameIndex when not looping", () => {
    // At t=1.5 (frame 1, lerp=0.5), not looping: next stays at frame 1
    const result = interpolateFrame(baseSubEffect, 1.5, false);
    expect(result.frameIndex).toBe(1);
    expect(result.nextFrameIndex).toBe(1);
    // No interpolation beyond last frame: stays at frame 1 values
    expect(result.size[0]).toBeCloseTo(3.0);
  });

  it("handles single-frame effect with no interpolation", () => {
    const singleFrame: SubEffect = {
      ...baseSubEffect,
      frameCount: 1,
      frameTimes: [1.0],
      frameSizes: [[5, 5, 5]],
      frameAngles: [[0, 0, 0]],
      framePositions: [[2, 3, 4]],
      frameColors: [[0.5, 0.5, 0.5, 0.8]],
    };
    const result = interpolateFrame(singleFrame, 0.5, false);
    expect(result.frameIndex).toBe(0);
    // Single frame: nextFrameIndex clamped to 0 (same frame), so no interpolation
    expect(result.size).toEqual([5, 5, 5]);
    expect(result.position).toEqual([2, 3, 4]);
    expect(result.color[3]).toBeCloseTo(0.8);
  });

  it("returns defaults for zero-frame effect", () => {
    const empty: SubEffect = {
      ...baseSubEffect,
      frameCount: 0,
      frameTimes: [],
      frameSizes: [],
      frameAngles: [],
      framePositions: [],
      frameColors: [],
    };
    const result = interpolateFrame(empty, 0, false);
    expect(result.size).toEqual([1, 1, 1]);
    expect(result.color).toEqual([1, 1, 1, 1]);
  });

  it("includes texFrameIndex=0 when no frameTexNames", () => {
    const result = interpolateFrame(baseSubEffect, 0.5, false);
    expect(result.texFrameIndex).toBe(0);
  });

  it("computes texFrameIndex from independent frameTexTime", () => {
    const sub: SubEffect = {
      ...baseSubEffect,
      frameTexTime: 0.25,
      frameTexNames: ["tex0", "tex1", "tex2", "tex3"],
    };
    // t=0.0 → tex index 0
    expect(interpolateFrame(sub, 0.0, false).texFrameIndex).toBe(0);
    // t=0.25 → tex index 1
    expect(interpolateFrame(sub, 0.25, false).texFrameIndex).toBe(1);
    // t=0.5 → tex index 2
    expect(interpolateFrame(sub, 0.5, false).texFrameIndex).toBe(2);
    // t=0.75 → tex index 3
    expect(interpolateFrame(sub, 0.75, false).texFrameIndex).toBe(3);
  });

  it("wraps texFrameIndex when looping", () => {
    const sub: SubEffect = {
      ...baseSubEffect,
      frameTexTime: 0.5,
      frameTexNames: ["a", "b"],
    };
    // cycle=1.0, t=1.5 → wraps to 0.5 → index 1
    expect(interpolateFrame(sub, 1.5, true).texFrameIndex).toBe(1);
    // t=2.0 → wraps to 0.0 → index 0
    expect(interpolateFrame(sub, 2.0, true).texFrameIndex).toBe(0);
  });

  it("handles three frames with varying durations", () => {
    const threeFrames: SubEffect = {
      ...baseSubEffect,
      frameCount: 3,
      frameTimes: [0.5, 0.3, 0.2],
      frameSizes: [
        [1, 1, 1],
        [2, 2, 2],
        [4, 4, 4],
      ],
      frameAngles: [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ],
      framePositions: [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ],
      frameColors: [
        [1, 1, 1, 1],
        [1, 1, 1, 1],
        [1, 1, 1, 1],
      ],
    };
    // t=0.25 → frame 0 (50% through 0.5s), lerp toward frame 1
    const r1 = interpolateFrame(threeFrames, 0.25, false);
    expect(r1.frameIndex).toBe(0);
    expect(r1.lerp).toBeCloseTo(0.5);
    expect(r1.size[0]).toBeCloseTo(1.5);

    // t=0.65 → frame 1 (50% through 0.3s), lerp toward frame 2
    const r2 = interpolateFrame(threeFrames, 0.65, false);
    expect(r2.frameIndex).toBe(1);
    expect(r2.lerp).toBeCloseTo(0.5);
    expect(r2.size[0]).toBeCloseTo(3.0);
  });
});

describe("interpolateUVCoords", () => {
  const uvSubEffect: SubEffect = {
    ...baseSubEffect,
    effectType: 2,
    coordFrameTime: 1.0,
    coordList: [
      [[0, 0], [1, 0], [1, 1], [0, 1]], // frame 0
      [[0.5, 0.5], [1, 0.5], [1, 1], [0.5, 1]], // frame 1
    ],
  };

  it("returns null for non-type-2 effects", () => {
    expect(interpolateUVCoords(baseSubEffect, 0, false)).toBeNull();
  });

  it("returns frame 0 UVs at t=0", () => {
    const result = interpolateUVCoords(uvSubEffect, 0, false);
    expect(result).not.toBeNull();
    expect(result!.uvFrameIndex).toBe(0);
    expect(result!.uvLerp).toBeCloseTo(0);
    expect(result!.uvs[0]).toEqual([0, 0]);
    expect(result!.uvs[1]).toEqual([1, 0]);
  });

  it("interpolates UVs at midpoint", () => {
    const result = interpolateUVCoords(uvSubEffect, 0.5, false);
    expect(result).not.toBeNull();
    expect(result!.uvFrameIndex).toBe(0);
    expect(result!.uvLerp).toBeCloseTo(0.5);
    // lerp([0,0], [0.5,0.5], 0.5) = [0.25, 0.25]
    expect(result!.uvs[0][0]).toBeCloseTo(0.25);
    expect(result!.uvs[0][1]).toBeCloseTo(0.25);
  });

  it("wraps UVs when looping", () => {
    // cycleDuration = 2.0, t=2.5 → wraps to 0.5
    const result = interpolateUVCoords(uvSubEffect, 2.5, true);
    expect(result).not.toBeNull();
    expect(result!.uvFrameIndex).toBe(0);
    expect(result!.uvLerp).toBeCloseTo(0.5);
  });
});

describe("getTexListFrameIndex", () => {
  const texSubEffect: SubEffect = {
    ...baseSubEffect,
    effectType: 3,
    texFrameTime: 0.5,
    texList: [
      [[0, 0], [1, 0], [1, 1], [0, 1]], // frame 0
      [[0.5, 0], [1, 0], [1, 0.5], [0.5, 0.5]], // frame 1
      [[0, 0.5], [0.5, 0.5], [0.5, 1], [0, 1]], // frame 2
    ],
  };

  it("returns null for non-type-3 effects", () => {
    expect(getTexListFrameIndex(baseSubEffect, 0, false)).toBeNull();
  });

  it("returns frame 0 at t=0", () => {
    expect(getTexListFrameIndex(texSubEffect, 0, false)).toBe(0);
  });

  it("snaps to frame index without interpolation", () => {
    expect(getTexListFrameIndex(texSubEffect, 0.4, false)).toBe(0);
    expect(getTexListFrameIndex(texSubEffect, 0.5, false)).toBe(1);
    expect(getTexListFrameIndex(texSubEffect, 1.0, false)).toBe(2);
  });

  it("wraps when looping", () => {
    // cycleDuration = 1.5, t=1.6 → wraps to 0.1 → frame 0
    expect(getTexListFrameIndex(texSubEffect, 1.6, true)).toBe(0);
  });

  it("clamps to last frame when not looping past end", () => {
    expect(getTexListFrameIndex(texSubEffect, 5.0, false)).toBe(2);
  });
});

describe("getPathPosition", () => {
  const points: Vec3[] = [
    [0, 0, 0],
    [10, 0, 0],
    [10, 10, 0],
  ];

  it("returns start point at t=0", () => {
    const pos = getPathPosition(points, 0, 5, false);
    expect(pos).toEqual([0, 0, 0]);
  });

  it("interpolates along first segment", () => {
    // velocity=5, t=1 → distance=5, first segment length=10 → 50% along
    const pos = getPathPosition(points, 1, 5, false);
    expect(pos[0]).toBeCloseTo(5);
    expect(pos[1]).toBeCloseTo(0);
    expect(pos[2]).toBeCloseTo(0);
  });

  it("transitions to second segment", () => {
    // velocity=5, t=2 → distance=10 → end of first segment
    const pos = getPathPosition(points, 2, 5, false);
    expect(pos[0]).toBeCloseTo(10);
    expect(pos[1]).toBeCloseTo(0);
  });

  it("moves along second segment", () => {
    // velocity=5, t=3 → distance=15 → 5 into second segment (length 10)
    const pos = getPathPosition(points, 3, 5, false);
    expect(pos[0]).toBeCloseTo(10);
    expect(pos[1]).toBeCloseTo(5);
  });

  it("clamps to end when not looping", () => {
    const pos = getPathPosition(points, 100, 5, false);
    expect(pos).toEqual([10, 10, 0]);
  });

  it("loops back to start", () => {
    // totalLength = 10 + 10 = 20, velocity=5, t=4 → dist=20 wraps to 0
    const pos = getPathPosition(points, 4, 5, true);
    expect(pos[0]).toBeCloseTo(0);
    expect(pos[1]).toBeCloseTo(0);
  });

  it("returns start point for single-point path", () => {
    const pos = getPathPosition([[5, 5, 5]], 10, 5, false);
    expect(pos).toEqual([5, 5, 5]);
  });
});
