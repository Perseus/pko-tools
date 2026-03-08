import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  getPkoTechniqueState,
  composePkoRenderState,
  applyPkoRenderState,
  applyTextureSampling,
  mapBlendFactor,
  mapTextureFilter,
  mapTextureAddress,
  mapCullMode,
  DEFAULT_PKO_TECHNIQUE,
  D3DBLEND_ZERO,
  D3DBLEND_ONE,
  D3DBLEND_SRCALPHA,
  D3DBLEND_INVSRCALPHA,
  D3DBLEND_SRCCOLOR,
  D3DBLEND_DESTCOLOR,
  D3DBLEND_SRCALPHA_SAT,
  D3DTEXF_POINT,
  D3DTEXF_LINEAR,
  D3DTADDRESS_WRAP,
  D3DTADDRESS_MIRROR,
  D3DTADDRESS_CLAMP,
  D3DCULL_NONE,
  D3DCULL_CW,
  D3DCULL_CCW,
} from "@/features/effect/pkoStateEmulation";

describe("mapBlendFactor", () => {
  it("maps all D3DBLEND values", () => {
    expect(mapBlendFactor(D3DBLEND_ZERO)).toBe(THREE.ZeroFactor);
    expect(mapBlendFactor(D3DBLEND_ONE)).toBe(THREE.OneFactor);
    expect(mapBlendFactor(D3DBLEND_SRCCOLOR)).toBe(THREE.SrcColorFactor);
    expect(mapBlendFactor(D3DBLEND_SRCALPHA)).toBe(THREE.SrcAlphaFactor);
    expect(mapBlendFactor(D3DBLEND_INVSRCALPHA)).toBe(THREE.OneMinusSrcAlphaFactor);
    expect(mapBlendFactor(D3DBLEND_DESTCOLOR)).toBe(THREE.DstColorFactor);
    expect(mapBlendFactor(D3DBLEND_SRCALPHA_SAT)).toBe(THREE.SrcAlphaSaturateFactor);
  });

  it("returns null for unknown values", () => {
    expect(mapBlendFactor(99)).toBeNull();
    expect(mapBlendFactor(0)).toBeNull();
  });
});

describe("mapTextureFilter", () => {
  it("maps point filter", () => {
    expect(mapTextureFilter(D3DTEXF_POINT, false)).toBe(THREE.NearestFilter);
    expect(mapTextureFilter(D3DTEXF_POINT, true)).toBe(THREE.NearestMipmapNearestFilter);
  });

  it("maps linear filter", () => {
    expect(mapTextureFilter(D3DTEXF_LINEAR, false)).toBe(THREE.LinearFilter);
    expect(mapTextureFilter(D3DTEXF_LINEAR, true)).toBe(THREE.LinearMipmapLinearFilter);
  });
});

describe("mapTextureAddress", () => {
  it("maps addressing modes", () => {
    expect(mapTextureAddress(D3DTADDRESS_WRAP)).toBe(THREE.RepeatWrapping);
    expect(mapTextureAddress(D3DTADDRESS_MIRROR)).toBe(THREE.MirroredRepeatWrapping);
    expect(mapTextureAddress(D3DTADDRESS_CLAMP)).toBe(THREE.ClampToEdgeWrapping);
  });

  it("defaults to clamp for unknown values", () => {
    expect(mapTextureAddress(99)).toBe(THREE.ClampToEdgeWrapping);
  });
});

describe("mapCullMode", () => {
  it("maps cull modes", () => {
    expect(mapCullMode(D3DCULL_NONE)).toBe(THREE.DoubleSide);
    expect(mapCullMode(D3DCULL_CW)).toBe(THREE.FrontSide);
    expect(mapCullMode(D3DCULL_CCW)).toBe(THREE.BackSide);
  });
});

describe("getPkoTechniqueState", () => {
  it("returns defaults for technique 0", () => {
    const state = getPkoTechniqueState(0);
    expect(state).toEqual(DEFAULT_PKO_TECHNIQUE);
  });

  it("technique 1: opaque with z-write", () => {
    const state = getPkoTechniqueState(1);
    expect(state.zWriteEnable).toBe(true);
    expect(state.alphaBlendEnable).toBe(false);
    expect(state.addressU).toBe(D3DTADDRESS_WRAP);
    expect(state.addressV).toBe(D3DTADDRESS_WRAP);
  });

  it("techniques 2 and 3 use CLAMP addressing", () => {
    const state2 = getPkoTechniqueState(2);
    expect(state2.addressU).toBe(D3DTADDRESS_CLAMP);
    expect(state2.addressV).toBe(D3DTADDRESS_CLAMP);
    // Other fields match defaults
    expect(state2.zEnable).toBe(true);
    expect(state2.alphaBlendEnable).toBe(true);

    const state3 = getPkoTechniqueState(3);
    expect(state3.addressU).toBe(D3DTADDRESS_CLAMP);
    expect(state3.addressV).toBe(D3DTADDRESS_CLAMP);
  });

  it("technique 4: alpha test with NOTEQUAL", () => {
    const state = getPkoTechniqueState(4);
    expect(state.alphaTestEnable).toBe(true);
    expect(state.alphaRef).toBe(0xff000000);
    expect(state.addressU).toBe(D3DTADDRESS_WRAP);
  });

  it("technique 5: no z-test, point filter, CCW cull", () => {
    const state = getPkoTechniqueState(5);
    expect(state.zEnable).toBe(false);
    expect(state.zWriteEnable).toBe(false);
    expect(state.cullMode).toBe(D3DCULL_CCW);
    expect(state.minFilter).toBe(D3DTEXF_POINT);
    expect(state.magFilter).toBe(D3DTEXF_POINT);
    expect(state.srcBlend).toBe(D3DBLEND_SRCALPHA);
    expect(state.destBlend).toBe(D3DBLEND_INVSRCALPHA);
  });

  it("technique 6: no z-test, CCW cull, wrap addressing", () => {
    const state = getPkoTechniqueState(6);
    expect(state.zEnable).toBe(false);
    expect(state.cullMode).toBe(D3DCULL_CCW);
    expect(state.addressU).toBe(D3DTADDRESS_WRAP);
    expect(state.addressV).toBe(D3DTADDRESS_WRAP);
  });

  it("unknown technique falls back to defaults", () => {
    const state = getPkoTechniqueState(99);
    expect(state).toEqual(DEFAULT_PKO_TECHNIQUE);
  });
});

describe("composePkoRenderState", () => {
  it("merges technique with per-effect overrides", () => {
    const composed = composePkoRenderState(0, {
      srcBlend: D3DBLEND_ONE,
      destBlend: D3DBLEND_ONE,
    });
    expect(composed.srcBlend).toBe(D3DBLEND_ONE);
    expect(composed.destBlend).toBe(D3DBLEND_ONE);
    // Other fields from technique 0 default
    expect(composed.zEnable).toBe(true);
    expect(composed.alphaBlendEnable).toBe(true);
  });
});

describe("applyPkoRenderState", () => {
  it("sets depth, blend, and cull on material", () => {
    const mat = new THREE.MeshBasicMaterial();
    const state = getPkoTechniqueState(0);
    applyPkoRenderState(mat, state);

    expect(mat.depthTest).toBe(true);
    expect(mat.depthWrite).toBe(false);
    expect(mat.transparent).toBe(true);
    expect(mat.side).toBe(THREE.DoubleSide);
    expect(mat.fog).toBe(false);
    expect(mat.toneMapped).toBe(false);
  });

  it("technique 1: disables alpha blend, enables depth write", () => {
    const mat = new THREE.MeshBasicMaterial();
    applyPkoRenderState(mat, getPkoTechniqueState(1));

    expect(mat.transparent).toBe(false);
    expect(mat.blending).toBe(THREE.NoBlending);
    expect(mat.depthWrite).toBe(true);
  });

  it("technique 4: alpha test threshold is 1/255", () => {
    const mat = new THREE.MeshBasicMaterial();
    applyPkoRenderState(mat, getPkoTechniqueState(4));

    expect(mat.alphaTest).toBeCloseTo(1 / 255, 5);
  });

  it("technique 5: disables depth test", () => {
    const mat = new THREE.MeshBasicMaterial();
    applyPkoRenderState(mat, getPkoTechniqueState(5));

    expect(mat.depthTest).toBe(false);
    expect(mat.depthWrite).toBe(false);
    expect(mat.side).toBe(THREE.BackSide);
  });
});

describe("Technique Address Mode Parity — eff.fx truth table", () => {
  // From eff.fx shader source:
  // Tech 0: WRAP, WRAP
  // Tech 1: WRAP, WRAP
  // Tech 2: CLAMP, CLAMP
  // Tech 3: CLAMP, CLAMP
  // Tech 4: WRAP, WRAP
  // Tech 5: CLAMP, CLAMP
  // Tech 6: WRAP, WRAP

  const addressTable: [number, number, number][] = [
    // [technique, expectedAddressU, expectedAddressV]
    [0, D3DTADDRESS_WRAP, D3DTADDRESS_WRAP],
    [1, D3DTADDRESS_WRAP, D3DTADDRESS_WRAP],
    [2, D3DTADDRESS_CLAMP, D3DTADDRESS_CLAMP],
    [3, D3DTADDRESS_CLAMP, D3DTADDRESS_CLAMP],
    [4, D3DTADDRESS_WRAP, D3DTADDRESS_WRAP],
    [5, D3DTADDRESS_CLAMP, D3DTADDRESS_CLAMP],
    [6, D3DTADDRESS_WRAP, D3DTADDRESS_WRAP],
  ];

  for (const [tech, expectedU, expectedV] of addressTable) {
    it(`technique ${tech}: addressU=${expectedU === D3DTADDRESS_WRAP ? "WRAP" : "CLAMP"}, addressV=${expectedV === D3DTADDRESS_WRAP ? "WRAP" : "CLAMP"}`, () => {
      const state = getPkoTechniqueState(tech);
      expect(state.addressU).toBe(expectedU);
      expect(state.addressV).toBe(expectedV);
    });
  }
});

describe("applyTextureSampling", () => {
  it("applies filter and address modes to texture", () => {
    const tex = new THREE.DataTexture(new Uint8Array(4), 1, 1);
    applyTextureSampling(tex, {
      minFilter: D3DTEXF_POINT,
      magFilter: D3DTEXF_LINEAR,
      addressU: D3DTADDRESS_WRAP,
      addressV: D3DTADDRESS_MIRROR,
    });

    expect(tex.minFilter).toBe(THREE.NearestMipmapNearestFilter);
    expect(tex.magFilter).toBe(THREE.LinearFilter);
    expect(tex.wrapS).toBe(THREE.RepeatWrapping);
    expect(tex.wrapT).toBe(THREE.MirroredRepeatWrapping);
  });

  it("handles null texture gracefully", () => {
    expect(() => applyTextureSampling(null)).not.toThrow();
  });
});
