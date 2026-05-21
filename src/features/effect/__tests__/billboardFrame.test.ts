import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { applySubEffectFrame } from "../applySubEffectFrame";
import { createSubEffectFixture } from "./fixtures";

function expectQuaternionClose(actual: THREE.Quaternion, expected: THREE.Quaternion) {
  expect(actual.x).toBeCloseTo(expected.x);
  expect(actual.y).toBeCloseTo(expected.y);
  expect(actual.z).toBeCloseTo(expected.z);
  expect(actual.w).toBeCloseTo(expected.w);
}

describe("applySubEffectFrame billboard orientation", () => {
  it("uses the camera orientation matrix like C++ inverse-view billboard, independent of mesh position", () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(10, 5, 7);
    camera.lookAt(new THREE.Vector3(2, 1, 0));
    camera.updateMatrixWorld(true);

    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial(),
    );

    applySubEffectFrame(mesh, camera, {
      sub: createSubEffectFixture({
        billboard: true,
        rotaBoard: false,
      }),
      position: [4, -2, 3],
      scale: [1, 1, 1],
      angle: [0.6, 0.3, 0.2],
      color: [1, 1, 1, 1],
      playbackTime: 0,
      frameIndex: 0,
      nextFrameIndex: 0,
      lerp: 0,
    });

    expectQuaternionClose(mesh.quaternion, camera.quaternion);
  });

  it("preserves authored frame rotation for billboard rotaBoard before camera billboard", () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(5, 4, 9);
    camera.lookAt(new THREE.Vector3(0, 1, 0));
    camera.updateMatrixWorld(true);

    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial(),
    );
    const angle: [number, number, number] = [0.6, 0.3, 0.2];

    applySubEffectFrame(mesh, camera, {
      sub: createSubEffectFixture({
        billboard: true,
        rotaBoard: true,
      }),
      position: [0, 0, 0],
      scale: [1, 1, 1],
      angle,
      color: [1, 1, 1, 1],
      playbackTime: 0,
      frameIndex: 0,
      nextFrameIndex: 0,
      lerp: 0,
    });

    const expected = camera.quaternion.clone().multiply(
      new THREE.Quaternion().setFromEuler(new THREE.Euler(angle[0], angle[1], angle[2], "YXZ")),
    );
    expectQuaternionClose(mesh.quaternion, expected);
  });

  it("does not retain stale rotation when rotaLoop has a zero axis", () => {
    const camera = new THREE.PerspectiveCamera();
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial(),
    );
    mesh.quaternion.setFromEuler(new THREE.Euler(1.2, -0.4, 0.7, "YXZ"));

    const angle: [number, number, number] = [0.25, 0.5, -0.75];
    applySubEffectFrame(mesh, camera, {
      sub: createSubEffectFixture({
        rotaLoop: true,
        rotaLoopVec: [0, 0, 0, 4],
      }),
      position: [0, 0, 0],
      scale: [1, 1, 1],
      angle,
      color: [1, 1, 1, 1],
      playbackTime: 2,
      frameIndex: 0,
      nextFrameIndex: 0,
      lerp: 0,
    });

    expectQuaternionClose(
      mesh.quaternion,
      new THREE.Quaternion().setFromEuler(new THREE.Euler(angle[0], angle[1], angle[2], "YXZ")),
    );
  });

  it("does not retain stale rotation for billboard rotaBoard with a zero-axis rotaLoop", () => {
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(5, 4, 9);
    camera.lookAt(new THREE.Vector3(0, 1, 0));
    camera.updateMatrixWorld(true);

    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial(),
    );
    mesh.quaternion.setFromEuler(new THREE.Euler(1.2, -0.4, 0.7, "YXZ"));

    applySubEffectFrame(mesh, camera, {
      sub: createSubEffectFixture({
        billboard: true,
        rotaBoard: true,
        rotaLoop: true,
        rotaLoopVec: [0, 0, 0, 4],
      }),
      position: [0, 0, 0],
      scale: [1, 1, 1],
      angle: [0.25, 0.5, -0.75],
      color: [1, 1, 1, 1],
      playbackTime: 2,
      frameIndex: 0,
      nextFrameIndex: 0,
      lerp: 0,
    });

    const authored = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.25, 0.5, -0.75, "YXZ"));
    const expected = camera.quaternion.clone().multiply(authored);
    expectQuaternionClose(mesh.quaternion, expected);
  });
});
