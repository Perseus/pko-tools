import * as THREE from "three";
import type { DummyLineSpan } from "@/features/effect-v2/renderers/particles/dummyLineKinematics";

export interface ItemDummyPoint {
  id: number;
  matrix: THREE.Matrix4;
  name: string;
}

function getMatrixPosition(matrix: THREE.Matrix4): THREE.Vector3 {
  return new THREE.Vector3().setFromMatrixPosition(matrix);
}

export function computeItemDummyLineSpan(
  dummyPoints: ItemDummyPoint[],
  dummy1Id = 1,
  dummy2Id = 2,
): DummyLineSpan | null {
  const dummy1 = dummyPoints.find((d) => d.id === dummy1Id);
  const dummy2 = dummyPoints.find((d) => d.id === dummy2Id);
  if (!dummy1 || !dummy2) return null;

  const p1 = getMatrixPosition(dummy1.matrix);
  const p2 = getMatrixPosition(dummy2.matrix);
  const direction = p1.clone().sub(p2);
  const distance = direction.length();
  if (distance <= 0) return null;

  direction.normalize();
  return {
    start: p2,
    direction,
    distance,
  };
}
