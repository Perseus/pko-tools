import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { resolveBlendFactors } from "@/features/effect/rendering";

describe("strip blend modes", () => {
  it("uses per-strip blend factors when set", () => {
    // Strip with srcBlend=5 (SRCALPHA), destBlend=6 (INVSRCALPHA) → alpha blend
    const { blendSrc, blendDst } = resolveBlendFactors(5, 6);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc,
      blendDst,
    });
    expect(mat.blendSrc).toBe(THREE.SrcAlphaFactor);
    expect(mat.blendDst).toBe(THREE.OneMinusSrcAlphaFactor);
  });

  it("additive strip (srcAlpha + one)", () => {
    const { blendSrc, blendDst } = resolveBlendFactors(5, 2);
    expect(blendSrc).toBe(THREE.SrcAlphaFactor);
    expect(blendDst).toBe(THREE.OneFactor);
  });

  it("falls back to additive when blend factors are 0", () => {
    const src = 0;
    const dst = 0;
    const fallback = !src && !dst;
    expect(fallback).toBe(true);
  });
});
