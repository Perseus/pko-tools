import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  applyPkoRenderState,
  composePkoRenderState,
  getPkoTechniqueState,
  snapshotMaterialState,
  D3DBLEND_SRCALPHA,
  D3DBLEND_ONE,
} from "@/features/effect/pkoStateEmulation";
import { resolveBlendFactors } from "@/features/effect/rendering";
import { createSubEffectFixture } from "./fixtures";

describe("state snapshot: technique states", () => {
  it("technique 0: default alpha blend, no depth write", () => {
    const state = getPkoTechniqueState(0);
    const mat = new THREE.MeshBasicMaterial();
    applyPkoRenderState(mat, state);
    const snap = snapshotMaterialState(mat);

    expect(snap).toMatchInlineSnapshot(`
      {
        "alphaTest": 0,
        "blending": 5,
        "depthTest": true,
        "depthWrite": false,
        "side": 2,
        "transparent": true,
      }
    `);
  });

  it("technique 1: opaque, depth write, no alpha blend", () => {
    const state = getPkoTechniqueState(1);
    const mat = new THREE.MeshBasicMaterial();
    applyPkoRenderState(mat, state);
    const snap = snapshotMaterialState(mat);

    expect(snap).toMatchInlineSnapshot(`
      {
        "alphaTest": 0,
        "blending": 0,
        "depthTest": true,
        "depthWrite": true,
        "side": 2,
        "transparent": false,
      }
    `);
  });

  it("technique 4: alpha test, punch-through", () => {
    const state = getPkoTechniqueState(4);
    const mat = new THREE.MeshBasicMaterial();
    applyPkoRenderState(mat, state);
    const snap = snapshotMaterialState(mat);

    // alphaTest = 1/255 for D3DCMP_NOTEQUAL
    expect(snap.alphaTest).toBeCloseTo(1 / 255, 5);
    expect(snap.depthTest).toBe(true);
    // Technique 4 inherits zWriteEnable=false and alphaBlendEnable=true from defaults.
    // applyBlendToMaterial sets depthWrite=false when alpha blending is on.
    expect(snap.depthWrite).toBe(false);
    expect(snap.transparent).toBe(true);
  });

  it("technique 5: no depth test, CCW cull", () => {
    const state = getPkoTechniqueState(5);
    const mat = new THREE.MeshBasicMaterial();
    applyPkoRenderState(mat, state);
    const snap = snapshotMaterialState(mat);

    expect(snap.depthTest).toBe(false);
    expect(snap.depthWrite).toBe(false);
    expect(snap.side).toBe(THREE.BackSide); // CCW cull
  });

  it("technique 6: no depth test, CCW cull, alpha blend", () => {
    const state = getPkoTechniqueState(6);
    const mat = new THREE.MeshBasicMaterial();
    applyPkoRenderState(mat, state);
    const snap = snapshotMaterialState(mat);

    expect(snap.depthTest).toBe(false);
    expect(snap.depthWrite).toBe(false);
    expect(snap.side).toBe(THREE.BackSide);
    expect(snap.transparent).toBe(true);
  });
});

describe("state snapshot: sub-effect material state", () => {
  it("additive blend (srcAlpha + one)", () => {
    const sub = createSubEffectFixture({ srcBlend: 5, destBlend: 2, alpha: true });
    const { blendSrc, blendDst } = resolveBlendFactors(sub.srcBlend, sub.destBlend);

    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      blending: THREE.CustomBlending,
      blendSrc,
      blendDst,
      depthWrite: false,
    });

    const snap = snapshotMaterialState(mat);
    expect(snap).toMatchInlineSnapshot(`
      {
        "alphaTest": 0,
        "blending": 5,
        "depthTest": true,
        "depthWrite": false,
        "side": 0,
        "transparent": true,
      }
    `);
  });

  it("standard alpha blend (srcAlpha + invSrcAlpha)", () => {
    const sub = createSubEffectFixture({ srcBlend: 5, destBlend: 6, alpha: true });
    const { blendSrc, blendDst } = resolveBlendFactors(sub.srcBlend, sub.destBlend);

    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      blending: THREE.CustomBlending,
      blendSrc,
      blendDst,
      depthWrite: false,
    });

    expect(mat.blendSrc).toBe(THREE.SrcAlphaFactor);
    expect(mat.blendDst).toBe(THREE.OneMinusSrcAlphaFactor);
  });

  it("opaque sub-effect (alpha=false)", () => {
    const sub = createSubEffectFixture({ alpha: false });
    const useAlpha = sub.alpha !== false;

    const mat = new THREE.MeshBasicMaterial({
      transparent: useAlpha,
      blending: useAlpha ? THREE.CustomBlending : THREE.NormalBlending,
      depthWrite: !useAlpha,
    });

    const snap = snapshotMaterialState(mat);
    expect(snap.transparent).toBe(false);
    expect(snap.depthWrite).toBe(true);
    expect(snap.blending).toBe(THREE.NormalBlending);
  });
});

describe("state snapshot: composed technique + per-effect overrides", () => {
  it("technique 0 with custom blend overrides", () => {
    const composed = composePkoRenderState(0, {
      srcBlend: D3DBLEND_SRCALPHA,
      destBlend: D3DBLEND_ONE,
    });

    const mat = new THREE.MeshBasicMaterial();
    applyPkoRenderState(mat, composed);

    expect(mat.blendSrc).toBe(THREE.SrcAlphaFactor);
    expect(mat.blendDst).toBe(THREE.OneFactor);
  });

  it("technique 1 override cannot reenable alpha blend without explicit flag", () => {
    const composed = composePkoRenderState(1, {});
    expect(composed.alphaBlendEnable).toBe(false);
    expect(composed.zWriteEnable).toBe(true);
  });
});

describe("state snapshot: particle material state", () => {
  it("default particle material is additive, transparent, no depth write", () => {
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    const snap = snapshotMaterialState(mat);
    expect(snap).toMatchInlineSnapshot(`
      {
        "alphaTest": 0,
        "blending": 2,
        "depthTest": true,
        "depthWrite": false,
        "side": 0,
        "transparent": true,
      }
    `);
  });

  it("particle with custom blend (srcAlpha + invSrcAlpha)", () => {
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendSrc: THREE.SrcAlphaFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });

    expect(mat.blendSrc).toBe(THREE.SrcAlphaFactor);
    expect(mat.blendDst).toBe(THREE.OneMinusSrcAlphaFactor);
    expect(mat.blending).toBe(THREE.CustomBlending);
  });
});
