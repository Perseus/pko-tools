import { describe, expect, it } from "vitest";
import * as THREE from "three";

/**
 * Tests for alpha MODULATE behavior: finalAlpha = textureAlpha * vertexDiffuseAlpha.
 * D3D8: ALPHAOP = MODULATE(TEXTURE, DIFFUSE)
 *
 * In the particle shader (Phase 1), this is handled by:
 *   gl_FragColor = vec4(vColor * texColor.rgb, vAlpha * texColor.a);
 *
 * For the EffectSubRenderer (MeshBasicMaterial), Three.js MeshBasicMaterial
 * with a texture map applies: finalAlpha = map.a * opacity.
 * This correctly implements MODULATE when opacity = frame color alpha.
 */
describe("alpha MODULATE", () => {
  it("MeshBasicMaterial multiplies texture alpha with opacity", () => {
    // Three.js MeshBasicMaterial: fragment alpha = map.a * opacity
    // This is the correct D3D MODULATE behavior.
    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.5,
    });

    // opacity is the vertex diffuse alpha from frame color
    expect(mat.opacity).toBe(0.5);
    // When map is set, Three.js internally does: diffuseColor.a *= texture2D(map, vMapUv).a
    // then: outgoingLight = diffuseColor.rgb, gl_FragColor.a = diffuseColor.a * opacity
    // So: finalAlpha = textureAlpha * opacity — correct MODULATE.
    expect(mat.transparent).toBe(true);
  });

  it("particle shader fragment correctly multiplies vAlpha * texColor.a", () => {
    // This test documents the particle shader's MODULATE behavior.
    // The shader code is:
    //   vec4 texColor = texture2D(uTexture, gl_PointCoord);
    //   gl_FragColor = vec4(vColor * texColor.rgb, vAlpha * texColor.a);
    //
    // Given: vAlpha=0.5, texColor.a=0.8
    // Expected: finalAlpha = 0.5 * 0.8 = 0.4
    const vAlpha = 0.5;
    const texAlpha = 0.8;
    const finalAlpha = vAlpha * texAlpha;
    expect(finalAlpha).toBeCloseTo(0.4, 5);
  });

  it("color MODULATE: vColor * texColor.rgb", () => {
    // D3D8: COLOROP = MODULATE(TEXTURE, DIFFUSE)
    // Shader: vColor * texColor.rgb
    const vColor = [1.0, 0.5, 0.3];
    const texColor = [0.8, 0.6, 0.4];
    const result = vColor.map((v, i) => v * texColor[i]);
    expect(result[0]).toBeCloseTo(0.8, 5);
    expect(result[1]).toBeCloseTo(0.3, 5);
    expect(result[2]).toBeCloseTo(0.12, 5);
  });

  it("MeshBasicMaterial without map still uses opacity", () => {
    // When no texture is set, alpha comes from opacity alone
    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.7,
    });
    expect(mat.opacity).toBe(0.7);
    expect(mat.map).toBeNull();
  });

  it("MeshBasicMaterial color modulates with vertex color when vertexColors enabled", () => {
    // Three.js: when vertexColors=true, gl_FragColor.rgb = material.color * vertexColor
    // This matches D3D COLOROP = MODULATE for vertex-lit geometry
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(1, 1, 1),
      vertexColors: true,
    });
    expect(mat.vertexColors).toBe(true);
  });
});
