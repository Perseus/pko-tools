import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { applySubEffectFrame } from "../applySubEffectFrame";

describe("applySubEffectFrame color", () => {
  it("interprets PKO texture factor RGB as sRGB before Three linear modulation", () => {
    const material = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(), material);
    const camera = new THREE.PerspectiveCamera();
    const sourceColor = [128 / 255, 1, 128 / 255, 0.43529415130615234] as const;
    const expected = new THREE.Color().setRGB(
      sourceColor[0],
      sourceColor[1],
      sourceColor[2],
      THREE.SRGBColorSpace,
    );

    applySubEffectFrame(mesh, camera, {
      sub: {
        billboard: false,
        rotaBoard: false,
        rotaLoop: false,
        rotaLoopVec: [0, 0, 0, 0],
        effectType: 4,
        coordList: [],
        texList: [],
        useParam: 0,
        perFrameCylinder: [],
      } as never,
      position: [0, 0, 0],
      scale: [1, 1, 1],
      angle: [0, 0, 0],
      color: [...sourceColor],
      playbackTime: 0,
      frameIndex: 0,
      nextFrameIndex: 0,
      lerp: 0,
    });

    expect(material.color.r).toBeCloseTo(expected.r);
    expect(material.color.g).toBeCloseTo(expected.g);
    expect(material.color.b).toBeCloseTo(expected.b);
    expect(material.color.r).toBeLessThan(sourceColor[0]);
    expect(material.opacity).toBeCloseTo(sourceColor[3]);
  });
});
