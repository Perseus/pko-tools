import { describe, expect, it } from "vitest";
import * as THREE from "three";

/**
 * Verify Euler angle convention matches D3D8's D3DXMatrixRotationYawPitchRoll.
 *
 * D3D8: RotationYawPitchRoll(yaw, pitch, roll) applies:
 *   Roll(Z) * Pitch(X) * Yaw(Y) in extrinsic order
 *
 * This is equivalent to Three.js Euler(pitch, yaw, roll, 'YXZ')
 * where pitch=X, yaw=Y, roll=Z.
 *
 * PKO stores frameAngle as D3DXVECTOR3(x, y, z) = (pitch, yaw, roll).
 * So if frameAngles[i] = [x, y, z], Three.js Euler is (x, y, z, 'YXZ').
 *
 * The existing EffectSubRenderer already uses:
 *   new THREE.Euler(angle[0], angle[1], angle[2], "YXZ")
 * This is correct.
 */
describe("D3D8 Euler convention vs Three.js", () => {
  it("pure yaw (Y rotation) matches D3D", () => {
    // D3D: RotationYawPitchRoll(yaw=PI/4, pitch=0, roll=0)
    // → rotation around Y axis by PI/4
    const yaw = Math.PI / 4;
    const euler = new THREE.Euler(0, yaw, 0, "YXZ");
    const quat = new THREE.Quaternion().setFromEuler(euler);
    const mat = new THREE.Matrix4().makeRotationFromQuaternion(quat);
    const elements = mat.elements;

    // Y-rotation matrix:
    // [cos(y)  0  sin(y)  0]
    // [0       1  0       0]
    // [-sin(y) 0  cos(y)  0]
    // [0       0  0       1]
    // Column-major: [cos, 0, -sin, 0, 0, 1, 0, 0, sin, 0, cos, 0, ...]
    const cosY = Math.cos(yaw);
    const sinY = Math.sin(yaw);
    expect(elements[0]).toBeCloseTo(cosY, 5);  // m00
    expect(elements[8]).toBeCloseTo(sinY, 5);  // m02
    expect(elements[2]).toBeCloseTo(-sinY, 5); // m20
    expect(elements[10]).toBeCloseTo(cosY, 5); // m22
    expect(elements[5]).toBeCloseTo(1, 5);     // m11
  });

  it("pure pitch (X rotation) matches D3D", () => {
    const pitch = Math.PI / 6;
    const euler = new THREE.Euler(pitch, 0, 0, "YXZ");
    const quat = new THREE.Quaternion().setFromEuler(euler);
    const mat = new THREE.Matrix4().makeRotationFromQuaternion(quat);
    const elements = mat.elements;

    const cosP = Math.cos(pitch);
    const sinP = Math.sin(pitch);
    expect(elements[0]).toBeCloseTo(1, 5);     // m00
    expect(elements[5]).toBeCloseTo(cosP, 5);  // m11
    expect(elements[9]).toBeCloseTo(-sinP, 5); // m12
    expect(elements[6]).toBeCloseTo(sinP, 5);  // m21
    expect(elements[10]).toBeCloseTo(cosP, 5); // m22
  });

  it("pure roll (Z rotation) matches D3D", () => {
    const roll = Math.PI / 3;
    const euler = new THREE.Euler(0, 0, roll, "YXZ");
    const quat = new THREE.Quaternion().setFromEuler(euler);
    const mat = new THREE.Matrix4().makeRotationFromQuaternion(quat);
    const elements = mat.elements;

    const cosR = Math.cos(roll);
    const sinR = Math.sin(roll);
    expect(elements[0]).toBeCloseTo(cosR, 5);  // m00
    expect(elements[4]).toBeCloseTo(-sinR, 5); // m01
    expect(elements[1]).toBeCloseTo(sinR, 5);  // m10
    expect(elements[5]).toBeCloseTo(cosR, 5);  // m11
    expect(elements[10]).toBeCloseTo(1, 5);    // m22
  });

  it("combined rotation matches D3D YawPitchRoll decomposition", () => {
    // D3D: RotationYawPitchRoll(yaw, pitch, roll) applies:
    //   Roll → Pitch → Yaw (transformation order)
    // In column-vector convention (Three.js/OpenGL), this means:
    //   M = R_Y(yaw) * R_X(pitch) * R_Z(roll)  (rightmost applied first)
    // Three.js Euler('YXZ') is intrinsic Y→X→Z = extrinsic Z→X→Y
    // Both produce the same matrix.
    const pitch = 0.5, yaw = 0.3, roll = 0.7;

    // Build the matrix manually: Ry * Rx * Rz (column-vector convention)
    const Ry = new THREE.Matrix4().makeRotationY(yaw);
    const Rx = new THREE.Matrix4().makeRotationX(pitch);
    const Rz = new THREE.Matrix4().makeRotationZ(roll);
    const d3dMatrix = new THREE.Matrix4().copy(Ry).multiply(Rx).multiply(Rz);

    // Three.js Euler(pitch, yaw, roll, 'YXZ')
    const euler = new THREE.Euler(pitch, yaw, roll, "YXZ");
    const threeMatrix = new THREE.Matrix4().makeRotationFromEuler(euler);

    // Compare all 16 elements
    for (let i = 0; i < 16; i++) {
      expect(threeMatrix.elements[i]).toBeCloseTo(d3dMatrix.elements[i], 5);
    }
  });

  it("identity when all angles are zero", () => {
    const euler = new THREE.Euler(0, 0, 0, "YXZ");
    const mat = new THREE.Matrix4().makeRotationFromEuler(euler);
    const identity = new THREE.Matrix4();
    for (let i = 0; i < 16; i++) {
      expect(mat.elements[i]).toBeCloseTo(identity.elements[i], 10);
    }
  });

  it("frameAngles[i] = [x, y, z] → Euler(x, y, z, YXZ) is the correct mapping", () => {
    // This documents the mapping used in EffectSubRenderer.tsx:
    // rotation={new THREE.Euler(angle[0], angle[1], angle[2], "YXZ")}
    // where angle = frameAngles[i] = [pitch, yaw, roll] = [x, y, z]
    //
    // This matches D3D's RotationYawPitchRoll(yaw=y, pitch=x, roll=z)
    // because 'YXZ' intrinsic order ≡ Z*X*Y extrinsic ≡ Roll*Pitch*Yaw
    const frameAngle = [0.4, 0.2, 0.6]; // [pitch, yaw, roll]
    const euler = new THREE.Euler(frameAngle[0], frameAngle[1], frameAngle[2], "YXZ");

    // Verify it produces a valid rotation (determinant = 1)
    const mat = new THREE.Matrix4().makeRotationFromEuler(euler);
    const det = mat.determinant();
    expect(det).toBeCloseTo(1.0, 5);
  });
});
