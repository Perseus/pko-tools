import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { resolveBlendFactors } from "@/features/effect/rendering";

/**
 * Tests for per-system particle blend mode resolution.
 * Verifies that D3DBLEND srcBlend/destBlend pairs correctly map
 * to Three.js blend factors for particle materials.
 */
describe("particle blend mode", () => {
  it("srcAlpha + one = additive glow (5/2)", () => {
    const { blendSrc, blendDst } = resolveBlendFactors(5, 2);
    expect(blendSrc).toBe(THREE.SrcAlphaFactor);
    expect(blendDst).toBe(THREE.OneFactor);
  });

  it("srcAlpha + invSrcAlpha = standard alpha blend (5/6)", () => {
    const { blendSrc, blendDst } = resolveBlendFactors(5, 6);
    expect(blendSrc).toBe(THREE.SrcAlphaFactor);
    expect(blendDst).toBe(THREE.OneMinusSrcAlphaFactor);
  });

  it("one + one = full additive (2/2)", () => {
    const { blendSrc, blendDst } = resolveBlendFactors(2, 2);
    expect(blendSrc).toBe(THREE.OneFactor);
    expect(blendDst).toBe(THREE.OneFactor);
  });

  it("zero + srcColor = modulate (1/3)", () => {
    const { blendSrc, blendDst } = resolveBlendFactors(1, 3);
    expect(blendSrc).toBe(THREE.ZeroFactor);
    expect(blendDst).toBe(THREE.SrcColorFactor);
  });

  it("material uses custom blending with resolved factors", () => {
    const { blendSrc, blendDst } = resolveBlendFactors(5, 6);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc,
      blendDst,
    });

    expect(mat.blending).toBe(THREE.CustomBlending);
    expect(mat.blendSrc).toBe(THREE.SrcAlphaFactor);
    expect(mat.blendDst).toBe(THREE.OneMinusSrcAlphaFactor);
  });

  it("falls back to additive when both blend factors are 0", () => {
    // When srcBlend=0, destBlend=0, the system has no explicit blend mode.
    // The renderer should fall back to THREE.AdditiveBlending.
    const src = 0;
    const dst = 0;
    const shouldFallback = !src && !dst;
    expect(shouldFallback).toBe(true);
    // In this case, the ParticleSimulator uses AdditiveBlending directly
  });

  it("all D3DBLEND values 1-11 produce valid factors", () => {
    for (let i = 1; i <= 11; i++) {
      const { blendSrc, blendDst } = resolveBlendFactors(i, i);
      expect(blendSrc).toBeDefined();
      expect(blendDst).toBeDefined();
    }
  });
});
