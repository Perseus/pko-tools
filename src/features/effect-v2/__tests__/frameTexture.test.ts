import { describe, expect, it } from "vitest";
import { baseSubEffect } from "./fixtures";
import { resolveFrameTextureName } from "../frameTexture";

describe("resolveFrameTextureName", () => {
  it("uses frame texture names for EFFECT_FRAMETEX instead of texName", () => {
    const sub = {
      ...baseSubEffect,
      effectType: 1,
      texName: "fallback.tga",
      frameTexCount: 3,
      frameTexTime: 0.25,
      frameTexNames: ["blast_00.tga", "blast_01.tga", "blast_02.tga"],
    };

    expect(resolveFrameTextureName(sub, 0.0, true)).toBe("blast_00.tga");
    expect(resolveFrameTextureName(sub, 0.24, true)).toBe("blast_00.tga");
    expect(resolveFrameTextureName(sub, 0.26, true)).toBe("blast_01.tga");
    expect(resolveFrameTextureName(sub, 0.51, true)).toBe("blast_02.tga");
  });

  it("keeps the previous frame texture at exact frame-time boundaries", () => {
    const sub = {
      ...baseSubEffect,
      effectType: 1,
      texName: "fallback.tga",
      frameTexCount: 3,
      frameTexTime: 0.25,
      frameTexNames: ["blast_00.tga", "blast_01.tga", "blast_02.tga"],
    };

    expect(resolveFrameTextureName(sub, 0.25, true)).toBe("blast_00.tga");
    expect(resolveFrameTextureName(sub, 0.5, true)).toBe("blast_01.tga");
  });

  it("loops frame textures over their total duration", () => {
    const sub = {
      ...baseSubEffect,
      effectType: 1,
      texName: "fallback.tga",
      frameTexCount: 2,
      frameTexTime: 0.2,
      frameTexNames: ["pulse_a.tga", "pulse_b.tga"],
    };

    expect(resolveFrameTextureName(sub, 0.39, true)).toBe("pulse_b.tga");
    expect(resolveFrameTextureName(sub, 0.4, true)).toBe("pulse_b.tga");
    expect(resolveFrameTextureName(sub, 0.61, true)).toBe("pulse_b.tga");
  });

  it("holds the last frame texture when playback does not loop", () => {
    const sub = {
      ...baseSubEffect,
      effectType: 1,
      texName: "fallback.tga",
      frameTexCount: 2,
      frameTexTime: 0.2,
      frameTexNames: ["charge_a.tga", "charge_b.tga"],
    };

    expect(resolveFrameTextureName(sub, 10, false)).toBe("charge_b.tga");
  });

  it("uses the only frame texture even when frameTexTime is zero", () => {
    const sub = {
      ...baseSubEffect,
      effectType: 1,
      texName: "fallback.tga",
      frameTexCount: 1,
      frameTexTime: 0,
      frameTexNames: ["static_glow.tga"],
    };

    expect(resolveFrameTextureName(sub, 10, true)).toBe("static_glow.tga");
  });

  it("falls back to texName for non-frame-texture effects or invalid timing", () => {
    expect(resolveFrameTextureName(baseSubEffect, 0.5, true)).toBe("spark.tga");
    expect(
      resolveFrameTextureName(
        {
          ...baseSubEffect,
          effectType: 1,
          texName: "fallback.tga",
          frameTexCount: 2,
          frameTexTime: 0,
          frameTexNames: ["bad_a.tga", "bad_b.tga"],
        },
        0.5,
        true,
      ),
    ).toBe("fallback.tga");
  });
});
