import * as THREE from "three";

/** C++ PointInstrPointRange: compares only horizontal X/Y deltas, not vertical Z. */
export function isPointInstrPointRange(
  a: THREE.Vector3,
  b: THREE.Vector3,
  range: number,
): boolean {
  return Math.abs(a.x - b.x) < range && Math.abs(a.y - b.y) < range;
}
