import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  GLTF_Y_UP_TO_PKO_Z_UP_ROTATION,
  PKO_Z_UP,
  PKO_Z_UP_GRID_ROTATION,
  applyPkoZUpCamera,
} from "../zUpScene";

describe("effect v2 z-up scene boundary", () => {
  it("configures the Three camera to orbit PKO's Z-up runtime space", () => {
    const camera = new THREE.PerspectiveCamera();
    camera.up.set(0, 1, 0);

    applyPkoZUpCamera(camera);

    expect(camera.up.toArray()).toEqual(PKO_Z_UP.toArray());
  });

  it("rotates Three's default XZ grid onto the PKO XY ground plane", () => {
    expect(PKO_Z_UP_GRID_ROTATION).toEqual([Math.PI / 2, 0, 0]);
  });

  it("rotates glTF Y-up character assets upright into PKO z-up effect space", () => {
    const up = new THREE.Vector3(0, 1, 0).applyEuler(
      new THREE.Euler(...GLTF_Y_UP_TO_PKO_Z_UP_ROTATION, "XYZ"),
    );

    expect(up.x).toBeCloseTo(0);
    expect(up.y).toBeCloseTo(0);
    expect(up.z).toBeCloseTo(1);
  });
});
