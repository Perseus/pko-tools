import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { getTextureName, getThreeJSBlendFromD3D, getMappedUVs, findFrame, lerp, pkoVec } from "../helpers";

describe("getTextureName", () => {
  it("strips .tga extension", () => {
    expect(getTextureName("spark.tga")).toBe("spark");
  });

  it("strips .dds extension", () => {
    expect(getTextureName("fire01.dds")).toBe("fire01");
  });

  it("strips extension case-insensitively", () => {
    expect(getTextureName("Boom.TGA")).toBe("Boom");
    expect(getTextureName("glow.DDS")).toBe("glow");
  });

  it("returns as-is when no recognized extension", () => {
    expect(getTextureName("spark")).toBe("spark");
    expect(getTextureName("fire01.png")).toBe("fire01.png");
  });

  it("returns null for empty string", () => {
    expect(getTextureName("")).toBeNull();
  });

  it("returns null for whitespace-only string", () => {
    expect(getTextureName("   ")).toBeNull();
  });
});

describe("getThreeJSBlendFromD3D", () => {
  it("maps all D3D blend values", () => {
    expect(getThreeJSBlendFromD3D(1)).toBe(THREE.ZeroFactor);
    expect(getThreeJSBlendFromD3D(2)).toBe(THREE.OneFactor);
    expect(getThreeJSBlendFromD3D(3)).toBe(THREE.SrcColorFactor);
    expect(getThreeJSBlendFromD3D(4)).toBe(THREE.OneMinusSrcColorFactor);
    expect(getThreeJSBlendFromD3D(5)).toBe(THREE.SrcAlphaFactor);
    expect(getThreeJSBlendFromD3D(6)).toBe(THREE.OneMinusSrcAlphaFactor);
    expect(getThreeJSBlendFromD3D(7)).toBe(THREE.DstAlphaFactor);
    expect(getThreeJSBlendFromD3D(8)).toBe(THREE.OneMinusDstAlphaFactor);
    expect(getThreeJSBlendFromD3D(9)).toBe(THREE.DstColorFactor);
    expect(getThreeJSBlendFromD3D(10)).toBe(THREE.OneMinusDstColorFactor);
  });

  it("falls back to ZeroFactor for unknown values", () => {
    expect(getThreeJSBlendFromD3D(0)).toBe(THREE.ZeroFactor);
    expect(getThreeJSBlendFromD3D(99)).toBe(THREE.ZeroFactor);
  });
});

describe("getMappedUVs", () => {
  it("mirrors U axis (1 - u)", () => {
    const input: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const result = getMappedUVs(input);
    expect(result).toEqual([[1, 0], [0, 0], [0, 1], [1, 1]]);
  });

  it("handles empty array", () => {
    expect(getMappedUVs([])).toEqual([]);
  });

  it("preserves V values unchanged", () => {
    const input: [number, number][] = [[0.5, 0.3]];
    const result = getMappedUVs(input);
    expect(result[0][1]).toBe(0.3);
  });
});

describe("findFrame", () => {
  // frameTimes = [0.2, 0.3, 0.1] means frame 0 lasts 0.2s, frame 1 lasts 0.3s, frame 2 lasts 0.1s

  it("returns frame 0 and localT at start", () => {
    expect(findFrame([0.2, 0.3, 0.1], 0)).toEqual({ frameIdx: 0, localT: 0 });
  });

  it("returns correct frame and localT mid-frame", () => {
    expect(findFrame([0.2, 0.3, 0.1], 0.1)).toEqual({ frameIdx: 0, localT: 0.1 });
  });

  it("advances to next frame after first duration", () => {
    expect(findFrame([0.2, 0.3, 0.1], 0.2)).toEqual({ frameIdx: 1, localT: 0 });
  });

  it("returns correct localT within middle frame", () => {
    const result = findFrame([0.2, 0.3, 0.1], 0.35);
    expect(result.frameIdx).toBe(1);
    expect(result.localT).toBeCloseTo(0.15);
  });

  it("clamps to last frame when t exceeds total duration", () => {
    const result = findFrame([0.2, 0.3, 0.1], 5.0);
    expect(result.frameIdx).toBe(2);
    expect(result.localT).toBe(0.1); // last frame's own duration
  });

  it("returns 0 for an empty array", () => {
    expect(findFrame([], 0.5)).toEqual({ frameIdx: 0, localT: 0 });
  });

  it("works with a single keyframe, clamps immediately", () => {
    const result = findFrame([0.5], 99);
    expect(result.frameIdx).toBe(0);
    expect(result.localT).toBe(0.5);
  });

  it("frac derived from localT stays within 0..1", () => {
    const frameTimes = [0.2, 0.3, 0.1];
    for (const t of [0, 0.1, 0.2, 0.35, 0.5, 0.6, 99]) {
      const { frameIdx, localT } = findFrame(frameTimes, t);
      const dur = frameTimes[frameIdx];
      const frac = dur > 0 ? localT / dur : 0;
      expect(frac).toBeGreaterThanOrEqual(0);
      expect(frac).toBeLessThanOrEqual(1);
    }
  });
});

describe("lerp", () => {
  it("returns a at t=0", () => {
    expect(lerp(10, 20, 0)).toBe(10);
  });

  it("returns b at t=1", () => {
    expect(lerp(10, 20, 1)).toBe(20);
  });

  it("returns midpoint at t=0.5", () => {
    expect(lerp(0, 100, 0.5)).toBe(50);
  });

  it("works with negative values", () => {
    expect(lerp(-10, 10, 0.5)).toBe(0);
  });

  it("extrapolates beyond [0,1]", () => {
    expect(lerp(0, 10, 2)).toBe(20);
  });
});

describe("pkoVec", () => {
  it("swaps Y and Z, leaves X unchanged", () => {
    expect(pkoVec([1, 2, 3])).toEqual([1, 3, 2]);
  });

  it("identity when Y and Z are equal", () => {
    expect(pkoVec([5, 7, 7])).toEqual([5, 7, 7]);
  });

  it("handles zeros", () => {
    expect(pkoVec([0, 0, 0])).toEqual([0, 0, 0]);
  });

  it("handles negative values", () => {
    expect(pkoVec([-1, -2, -3])).toEqual([-1, -3, -2]);
  });
});
