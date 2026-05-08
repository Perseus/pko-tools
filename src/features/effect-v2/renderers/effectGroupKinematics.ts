import * as THREE from "three";
import type { EffectFile } from "@/types/effect";

const TWO_PI = Math.PI * 2;

export function computeEffectGroupRotation(
  effect: EffectFile,
  elapsedSeconds: number,
): THREE.Quaternion {
  if (!effect.rotating) return new THREE.Quaternion();

  const axis = new THREE.Vector3(effect.rotaVec[0], effect.rotaVec[1], effect.rotaVec[2]);
  if (axis.lengthSq() <= 0.000001) return new THREE.Quaternion();

  axis.normalize();
  const angle = (elapsedSeconds * effect.rotaVel) % TWO_PI;
  return new THREE.Quaternion().setFromAxisAngle(axis, angle);
}
