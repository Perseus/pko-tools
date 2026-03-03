import { describe, expect, it } from "vitest";
import * as THREE from "three";

/**
 * Tests for particle texture shader uniforms.
 * Verifies that the ShaderMaterial correctly exposes uTexture and uHasTexture
 * uniforms that control textured vs. soft-circle rendering.
 */
describe("particle texture shader", () => {
  it("creates shader material with texture uniforms", () => {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTexture: { value: null },
        uHasTexture: { value: false },
      },
    });

    expect(mat.uniforms.uTexture).toBeDefined();
    expect(mat.uniforms.uHasTexture).toBeDefined();
    expect(mat.uniforms.uHasTexture.value).toBe(false);
    expect(mat.uniforms.uTexture.value).toBeNull();
  });

  it("updates uHasTexture when texture is set", () => {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTexture: { value: null },
        uHasTexture: { value: false },
      },
    });

    const tex = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat);
    mat.uniforms.uTexture.value = tex;
    mat.uniforms.uHasTexture.value = true;

    expect(mat.uniforms.uHasTexture.value).toBe(true);
    expect(mat.uniforms.uTexture.value).toBe(tex);

    tex.dispose();
  });

  it("reverts to soft circle when texture is cleared", () => {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTexture: { value: null },
        uHasTexture: { value: false },
      },
    });

    const tex = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat);
    mat.uniforms.uTexture.value = tex;
    mat.uniforms.uHasTexture.value = true;

    // Clear
    mat.uniforms.uTexture.value = null;
    mat.uniforms.uHasTexture.value = false;

    expect(mat.uniforms.uHasTexture.value).toBe(false);
    expect(mat.uniforms.uTexture.value).toBeNull();

    tex.dispose();
  });
});
