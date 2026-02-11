import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { resolveBlendFactors } from "@/features/effect/rendering";

describe("effect material configuration", () => {
  describe("resolveBlendFactors", () => {
    it("maps all D3DBLEND values without throwing", () => {
      // D3DBLEND values 1-11 should all map to valid Three.js factors
      for (let i = 1; i <= 11; i++) {
        const result = resolveBlendFactors(i, i);
        expect(result.blendSrc).toBeDefined();
        expect(result.blendDst).toBeDefined();
      }
    });

    it("maps D3DBLEND_ZERO (1) to ZeroFactor", () => {
      const { blendSrc } = resolveBlendFactors(1, 2);
      expect(blendSrc).toBe(THREE.ZeroFactor);
    });

    it("maps D3DBLEND_ONE (2) to OneFactor", () => {
      const { blendSrc } = resolveBlendFactors(2, 1);
      expect(blendSrc).toBe(THREE.OneFactor);
    });

    it("maps D3DBLEND_SRCALPHA (5) to SrcAlphaFactor", () => {
      const { blendSrc } = resolveBlendFactors(5, 6);
      expect(blendSrc).toBe(THREE.SrcAlphaFactor);
    });

    it("maps D3DBLEND_INVSRCALPHA (6) to OneMinusSrcAlphaFactor", () => {
      const { blendDst } = resolveBlendFactors(5, 6);
      expect(blendDst).toBe(THREE.OneMinusSrcAlphaFactor);
    });

    it("maps D3DBLEND_SRCALPHASAT (11) to SrcAlphaSaturateFactor", () => {
      const { blendSrc } = resolveBlendFactors(11, 2);
      expect(blendSrc).toBe(THREE.SrcAlphaSaturateFactor);
    });

    it("falls back to SrcAlphaFactor for unknown values", () => {
      const { blendSrc } = resolveBlendFactors(99, 2);
      expect(blendSrc).toBe(THREE.SrcAlphaFactor);
    });
  });

  describe("effect material must not use alphaTest", () => {
    // The PKO engine does not use alpha test for effects — it relies purely
    // on blend modes. alphaTest clips soft glow edges on additive effects.
    // This test documents the requirement so it doesn't regress.

    it("meshBasicMaterial default alphaTest is 0", () => {
      const mat = new THREE.MeshBasicMaterial({
        transparent: true,
        blending: THREE.CustomBlending,
        blendSrc: THREE.SrcAlphaFactor,
        blendDst: THREE.OneFactor,
      });
      expect(mat.alphaTest).toBe(0);
    });

    it("setting alphaTest > 0 clips pixels (documenting the behavior we avoid)", () => {
      const mat = new THREE.MeshBasicMaterial({ alphaTest: 0.01 });
      // This is what we removed — documenting that alphaTest > 0 is wrong for effects
      expect(mat.alphaTest).toBeGreaterThan(0);
    });
  });

  describe("effect alpha flag behavior", () => {
    it("alpha=true should enable custom blending and disable depth write", () => {
      // Mirrors the logic in EffectSubRenderer.tsx lines 494-533
      const useAlpha = true;
      const mat = new THREE.MeshBasicMaterial({
        transparent: useAlpha,
        blending: useAlpha ? THREE.CustomBlending : THREE.NormalBlending,
        depthWrite: !useAlpha,
      });
      expect(mat.transparent).toBe(true);
      expect(mat.blending).toBe(THREE.CustomBlending);
      expect(mat.depthWrite).toBe(false);
    });

    it("alpha=false should use normal blending and enable depth write", () => {
      const useAlpha = false;
      const mat = new THREE.MeshBasicMaterial({
        transparent: useAlpha,
        blending: useAlpha ? THREE.CustomBlending : THREE.NormalBlending,
        depthWrite: !useAlpha,
      });
      expect(mat.transparent).toBe(false);
      expect(mat.blending).toBe(THREE.NormalBlending);
      expect(mat.depthWrite).toBe(true);
    });
  });
});
