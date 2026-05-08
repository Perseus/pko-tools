import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { computeEffectGroupRotation } from "../renderers/effectGroupKinematics";
import { EffectFile } from "@/types/effect";

function effect(overrides: Partial<EffectFile> = {}): EffectFile {
  return {
    version: 7,
    idxTech: 0,
    usePath: false,
    pathName: "",
    useSound: false,
    soundName: "",
    rotating: false,
    rotaVec: [0, 0, 0],
    rotaVel: 0,
    effNum: 0,
    subEffects: [],
    ...overrides,
  };
}

function expectQuatClose(actual: THREE.Quaternion, expected: THREE.Quaternion) {
  expect(actual.x).toBeCloseTo(expected.x);
  expect(actual.y).toBeCloseTo(expected.y);
  expect(actual.z).toBeCloseTo(expected.z);
  expect(actual.w).toBeCloseTo(expected.w);
}

describe("computeEffectGroupRotation", () => {
  it("returns identity when file-level rotating is disabled", () => {
    expectQuatClose(
      computeEffectGroupRotation(effect({ rotating: false, rotaVec: [0, 1, 0], rotaVel: 4 }), 3),
      new THREE.Quaternion(),
    );
  });

  it("matches C++ CMPModelEff axis rotation angle from rotaVel * elapsed time", () => {
    const result = computeEffectGroupRotation(
      effect({ rotating: true, rotaVec: [0, 2, 0], rotaVel: 0.5 }),
      4,
    );

    expectQuatClose(
      result,
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 2),
    );
  });

  it("wraps accumulated rotation at 2pi like the client", () => {
    const result = computeEffectGroupRotation(
      effect({ rotating: true, rotaVec: [0, 0, 1], rotaVel: Math.PI }),
      3,
    );

    expectQuatClose(
      result,
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI),
    );
  });
});
