import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { applySubEffectFrame } from "../applySubEffectFrame";
import { createCylinderGeometry } from "../rendering";
import { baseSubEffect } from "@/features/effect-v2/__tests__/fixtures";

describe("applySubEffectFrame D3D matrix parity", () => {
  it("composes the Three local matrix as the transpose of PKO's D3D row-vector matrix", () => {
    const mesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial(),
    );
    const camera = new THREE.PerspectiveCamera();
    const position: [number, number, number] = [1.25, -2.5, 3.75];
    const scale: [number, number, number] = [2, 3, 4];
    const angle: [number, number, number] = [0.4, 0.2, 0.6];

    applySubEffectFrame(mesh, camera, {
      sub: {
        ...baseSubEffect,
        billboard: false,
        effectType: 0,
      },
      position,
      scale,
      angle,
      color: [1, 1, 1, 1],
      playbackTime: 0,
      frameIndex: 0,
      nextFrameIndex: 0,
      lerp: 0,
    });
    mesh.updateMatrix();

    const threeRows = matrixRows(mesh.matrix);
    const expectedRows = transpose(d3dLocalMatrixRows(scale, angle, position));

    expectMatrixCloseTo(threeRows, expectedRows);
  });

  it("applies billboard orientation even when effectType is 4", () => {
    const mesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial(),
    );
    const camera = new THREE.PerspectiveCamera();
    camera.quaternion.setFromEuler(new THREE.Euler(0.1, 0.2, 0.3, "YXZ"));
    const position: [number, number, number] = [0, 0, 0];
    const scale: [number, number, number] = [1, 1, 1];
    const angle: [number, number, number] = [0.35, -0.2, 0.75];

    applySubEffectFrame(mesh, camera, {
      sub: {
        ...baseSubEffect,
        billboard: true,
        effectType: 4,
      },
      position,
      scale,
      angle,
      color: [1, 1, 1, 1],
      playbackTime: 0,
      frameIndex: 0,
      nextFrameIndex: 0,
      lerp: 0,
    });

    expect(mesh.quaternion.x).toBeCloseTo(camera.quaternion.x);
    expect(mesh.quaternion.y).toBeCloseTo(camera.quaternion.y);
    expect(mesh.quaternion.z).toBeCloseTo(camera.quaternion.z);
    expect(mesh.quaternion.w).toBeCloseTo(camera.quaternion.w);
  });

  it("computes billboard orientation in parent-local space", () => {
    const parent = new THREE.Group();
    parent.quaternion.setFromEuler(new THREE.Euler(0.7, -0.1, 0.4, "YXZ"));
    const mesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial(),
    );
    parent.add(mesh);
    parent.updateMatrixWorld(true);

    const camera = new THREE.PerspectiveCamera();
    camera.quaternion.setFromEuler(new THREE.Euler(-0.2, 0.5, -0.3, "YXZ"));
    const position: [number, number, number] = [0, 0, 0];
    const scale: [number, number, number] = [1, 1, 1];
    const angle: [number, number, number] = [0.35, -0.2, 0.75];

    applySubEffectFrame(mesh, camera, {
      sub: {
        ...baseSubEffect,
        billboard: true,
        effectType: 4,
      },
      position,
      scale,
      angle,
      color: [1, 1, 1, 1],
      playbackTime: 0,
      frameIndex: 0,
      nextFrameIndex: 0,
      lerp: 0,
    });
    parent.updateMatrixWorld(true);

    const world = new THREE.Quaternion();
    mesh.getWorldQuaternion(world);
    expect(world.x).toBeCloseTo(camera.quaternion.x);
    expect(world.y).toBeCloseTo(camera.quaternion.y);
    expect(world.z).toBeCloseTo(camera.quaternion.z);
    expect(world.w).toBeCloseTo(camera.quaternion.w);
  });

  it("does not double-apply a parent particle billboard for rotaBoard sub-effects", () => {
    const parent = new THREE.Group();
    parent.quaternion.setFromEuler(new THREE.Euler(0.6, -0.35, 0.25, "YXZ"));
    const mesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial(),
    );
    parent.add(mesh);
    parent.updateMatrixWorld(true);

    const camera = new THREE.PerspectiveCamera();
    camera.quaternion.setFromEuler(new THREE.Euler(-0.15, 0.45, -0.2, "YXZ"));

    applySubEffectFrame(mesh, camera, {
      sub: {
        ...baseSubEffect,
        billboard: true,
        rotaBoard: true,
        effectType: 4,
      },
      position: [0, 0, 0],
      scale: [1, 1, 1],
      angle: [0, 0, 0],
      color: [1, 1, 1, 1],
      playbackTime: 0,
      frameIndex: 0,
      nextFrameIndex: 0,
      lerp: 0,
    });
    parent.updateMatrixWorld(true);

    const world = new THREE.Quaternion();
    mesh.getWorldQuaternion(world);
    expect(world.x).toBeCloseTo(camera.quaternion.x);
    expect(world.y).toBeCloseTo(camera.quaternion.y);
    expect(world.z).toBeCloseTo(camera.quaternion.z);
    expect(world.w).toBeCloseTo(camera.quaternion.w);
  });

  it("composes rotaLoop after authored frame rotation like GetTransformMatrix(..., pRota)", () => {
    const mesh = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial(),
    );
    const camera = new THREE.PerspectiveCamera();
    const position: [number, number, number] = [1, 2, 3];
    const scale: [number, number, number] = [1.25, 0.75, 2];
    const angle: [number, number, number] = [0.2, 0.4, -0.3];
    const rotaAxis: [number, number, number] = [0, 0, 1];
    const rotaAngle = 0.5;

    applySubEffectFrame(mesh, camera, {
      sub: {
        ...baseSubEffect,
        billboard: false,
        rotaLoop: true,
        rotaLoopVec: [rotaAxis[0], rotaAxis[1], rotaAxis[2], 2],
      },
      position,
      scale,
      angle,
      color: [1, 1, 1, 1],
      playbackTime: 0.25,
      frameIndex: 0,
      nextFrameIndex: 0,
      lerp: 0,
    });
    mesh.updateMatrix();

    const authoredRotation = d3dRotationYawPitchRollRows(angle);
    const rotaLoop = d3dRotationAxisRows(rotaAxis, rotaAngle);
    const expectedRows = transpose(d3dMatrixWithRotationRows(
      scale,
      multiplyMatrix4(authoredRotation, rotaLoop),
      position,
    ));

    expectMatrixCloseTo(matrixRows(mesh.matrix), expectedRows);
  });

  it("interpolates deformable cylinder vertices in PKO's Z-axis cylinder space", () => {
    const geometry = createCylinderGeometry(0.5, 0.5, 2, 8);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    const camera = new THREE.PerspectiveCamera();
    const cache = new Map<string, Float32Array>();

    applySubEffectFrame(mesh, camera, {
      sub: {
        ...baseSubEffect,
        modelName: "Cylinder",
        useParam: 1,
        perFrameCylinder: [
          { topRadius: 0.5, botRadius: 0.5, height: 2, segments: 8 },
          { topRadius: 0.5, botRadius: 0.5, height: 4, segments: 8 },
        ],
      },
      position: [0, 0, 0],
      scale: [1, 1, 1],
      angle: [0, 0, 0],
      color: [1, 1, 1, 1],
      playbackTime: 0,
      frameIndex: 0,
      nextFrameIndex: 1,
      lerp: 0.5,
      isCylinder: true,
      cylinderCache: cache,
    });

    const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
    const zValues = Array.from({ length: positions.count }, (_, i) => positions.getZ(i));
    const yValues = Array.from({ length: positions.count }, (_, i) => positions.getY(i));

    expect(Math.min(...zValues)).toBeCloseTo(0);
    expect(Math.max(...zValues)).toBeCloseTo(3);
    expect(Math.max(...yValues)).toBeCloseTo(0.5);
    expect(Math.min(...yValues)).toBeCloseTo(-0.5);
  });

  it("applies deformable cylinder current-frame vertices even when lerp is zero", () => {
    const geometry = createCylinderGeometry(0.5, 0.5, 2, 8);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
    const camera = new THREE.PerspectiveCamera();
    const cache = new Map<string, Float32Array>();

    applySubEffectFrame(mesh, camera, {
      sub: {
        ...baseSubEffect,
        modelName: "Cylinder",
        useParam: 1,
        perFrameCylinder: [
          { topRadius: 1, botRadius: 1, height: 4, segments: 8 },
          { topRadius: 0.5, botRadius: 0.5, height: 2, segments: 8 },
        ],
      },
      position: [0, 0, 0],
      scale: [1, 1, 1],
      angle: [0, 0, 0],
      color: [1, 1, 1, 1],
      playbackTime: 0,
      frameIndex: 0,
      nextFrameIndex: 1,
      lerp: 0,
      isCylinder: true,
      cylinderCache: cache,
    });

    const positions = geometry.getAttribute("position") as THREE.BufferAttribute;
    const zValues = Array.from({ length: positions.count }, (_, i) => positions.getZ(i));
    const yValues = Array.from({ length: positions.count }, (_, i) => positions.getY(i));

    expect(Math.min(...zValues)).toBeCloseTo(0);
    expect(Math.max(...zValues)).toBeCloseTo(4);
    expect(Math.max(...yValues)).toBeCloseTo(1);
    expect(Math.min(...yValues)).toBeCloseTo(-1);
  });
});

function expectMatrixCloseTo(actual: number[][], expected: number[][]): void {
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      expect(actual[row][col]).toBeCloseTo(expected[row][col], 6);
    }
  }
}

function matrixRows(matrix: THREE.Matrix4): number[][] {
  const elements = matrix.elements;
  return [0, 1, 2, 3].map((row) =>
    [0, 1, 2, 3].map((col) => elements[col * 4 + row])
  );
}

function transpose(matrix: number[][]): number[][] {
  return [0, 1, 2, 3].map((row) => [0, 1, 2, 3].map((col) => matrix[col][row]));
}

function d3dLocalMatrixRows(
  scale: [number, number, number],
  angle: [number, number, number],
  position: [number, number, number],
): number[][] {
  return d3dMatrixWithRotationRows(scale, d3dRotationYawPitchRollRows(angle), position);
}

function d3dMatrixWithRotationRows(
  scale: [number, number, number],
  rotation: number[][],
  position: [number, number, number],
): number[][] {
  return [
    [
      scale[0] * rotation[0][0],
      scale[0] * rotation[0][1],
      scale[0] * rotation[0][2],
      0,
    ],
    [
      scale[1] * rotation[1][0],
      scale[1] * rotation[1][1],
      scale[1] * rotation[1][2],
      0,
    ],
    [
      scale[2] * rotation[2][0],
      scale[2] * rotation[2][1],
      scale[2] * rotation[2][2],
      0,
    ],
    [position[0], position[1], position[2], 1],
  ];
}

function d3dRotationYawPitchRollRows(angle: [number, number, number]): number[][] {
  const [pitch, yaw, roll] = angle;
  return multiplyMatrix4(
    multiplyMatrix4(rotationZ(roll), rotationX(pitch)),
    rotationY(yaw),
  );
}

function d3dRotationAxisRows(
  axis: [number, number, number],
  angle: number,
): number[][] {
  const length = Math.hypot(axis[0], axis[1], axis[2]);
  const x = axis[0] / length;
  const y = axis[1] / length;
  const z = axis[2] / length;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const t = 1 - c;

  return [
    [t * x * x + c, t * x * y + s * z, t * x * z - s * y, 0],
    [t * x * y - s * z, t * y * y + c, t * y * z + s * x, 0],
    [t * x * z + s * y, t * y * z - s * x, t * z * z + c, 0],
    [0, 0, 0, 1],
  ];
}

function rotationX(angle: number): number[][] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [
    [1, 0, 0, 0],
    [0, c, s, 0],
    [0, -s, c, 0],
    [0, 0, 0, 1],
  ];
}

function rotationY(angle: number): number[][] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [
    [c, 0, -s, 0],
    [0, 1, 0, 0],
    [s, 0, c, 0],
    [0, 0, 0, 1],
  ];
}

function rotationZ(angle: number): number[][] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [
    [c, s, 0, 0],
    [-s, c, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ];
}

function multiplyMatrix4(a: number[][], b: number[][]): number[][] {
  return a.map((row) =>
    row.map((_, col) =>
      row[0] * b[0][col] +
      row[1] * b[1][col] +
      row[2] * b[2][col] +
      row[3] * b[3][col]
    )
  );
}
