import { describe, expect, it } from "vitest";

type Rgba = [number, number, number, number];

describe("effect pixel blend regressions", () => {
  it("keeps transparent black texels invisible for additive effect blending", () => {
    const background: Rgba = [0.2, 0.4, 0.6, 1];
    const transparentBlack: Rgba = [0, 0, 0, 0];

    expect(blendD3d(transparentBlack, background, 5, 2)).toEqual(background);
  });

  it("keeps transparent black texels invisible for normal alpha effect blending", () => {
    const background: Rgba = [0.2, 0.4, 0.6, 1];
    const transparentBlack: Rgba = [0, 0, 0, 0];

    expect(blendD3d(transparentBlack, background, 5, 6)).toEqual(background);
  });

  it("documents the visible black-square failure mode when alpha blending is disabled", () => {
    const background: Rgba = [0.2, 0.4, 0.6, 1];
    const transparentBlack: Rgba = [0, 0, 0, 0];

    expect(noBlend(transparentBlack, background)).toEqual([0, 0, 0, 0]);
    expect(noBlend(transparentBlack, background)).not.toEqual(background);
  });
});

function blendD3d(src: Rgba, dst: Rgba, srcBlend: number, destBlend: number): Rgba {
  const sf = blendFactor(srcBlend, src, dst);
  const df = blendFactor(destBlend, src, dst);
  return [
    clamp01(src[0] * sf[0] + dst[0] * df[0]),
    clamp01(src[1] * sf[1] + dst[1] * df[1]),
    clamp01(src[2] * sf[2] + dst[2] * df[2]),
    clamp01(src[3] * sf[3] + dst[3] * df[3]),
  ];
}

function noBlend(src: Rgba, _dst: Rgba): Rgba {
  return [...src];
}

function blendFactor(value: number, src: Rgba, dst: Rgba): Rgba {
  switch (value) {
    case 1: return [0, 0, 0, 0];
    case 2: return [1, 1, 1, 1];
    case 3: return [src[0], src[1], src[2], src[3]];
    case 4: return [1 - src[0], 1 - src[1], 1 - src[2], 1 - src[3]];
    case 5: return [src[3], src[3], src[3], src[3]];
    case 6: return [1 - src[3], 1 - src[3], 1 - src[3], 1 - src[3]];
    case 7: return [dst[3], dst[3], dst[3], dst[3]];
    case 8: return [1 - dst[3], 1 - dst[3], 1 - dst[3], 1 - dst[3]];
    case 9: return [dst[0], dst[1], dst[2], dst[3]];
    case 10: return [1 - dst[0], 1 - dst[1], 1 - dst[2], 1 - dst[3]];
    case 11: {
      const f = Math.min(src[3], 1 - dst[3]);
      return [f, f, f, 1];
    }
    default: return [src[3], src[3], src[3], src[3]];
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
