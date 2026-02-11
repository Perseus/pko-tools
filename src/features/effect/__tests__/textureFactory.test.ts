import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { createEffectTexture } from "@/features/effect/rendering";

describe("createEffectTexture", () => {
  function make() {
    const data = new Uint8Array(4 * 2 * 2); // 2x2 RGBA
    return createEffectTexture(data, 2, 2);
  }

  it("sets sRGB color space", () => {
    expect(make().colorSpace).toBe(THREE.SRGBColorSpace);
  });

  it("flips Y axis", () => {
    expect(make().flipY).toBe(true);
  });

  it("uses linear mag filter", () => {
    expect(make().magFilter).toBe(THREE.LinearFilter);
  });

  it("uses linear min filter", () => {
    expect(make().minFilter).toBe(THREE.LinearFilter);
  });

  it("uses repeat wrapping on S", () => {
    expect(make().wrapS).toBe(THREE.RepeatWrapping);
  });

  it("uses repeat wrapping on T", () => {
    expect(make().wrapT).toBe(THREE.RepeatWrapping);
  });

  it("marks needsUpdate (version incremented)", () => {
    // Three.js needsUpdate is a write-only setter that increments version
    expect(make().version).toBeGreaterThan(0);
  });

  it("uses RGBA format", () => {
    expect(make().format).toBe(THREE.RGBAFormat);
  });

  it("stores correct dimensions", () => {
    const tex = createEffectTexture(new Uint8Array(4 * 8 * 4), 8, 4);
    expect(tex.image.width).toBe(8);
    expect(tex.image.height).toBe(4);
  });
});
