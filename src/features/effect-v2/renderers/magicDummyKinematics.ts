import * as THREE from "three";
import type { EffectFile, SubEffect } from "@/types/effect";
import { interpolateFrame } from "@/features/effect/animation";
import { resolveGeometry } from "@/features/effect/rendering";

export interface MagicDummyPoint {
  id: number;
  position: THREE.Vector3;
}

const _position = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _euler = new THREE.Euler(0, 0, 0, "YXZ");
const _rotation = new THREE.Quaternion();
const _rotaAxis = new THREE.Vector3();
const _rotaLoop = new THREE.Quaternion();
const _matrix = new THREE.Matrix4();

export function getMagicParticleBaseName(particleName: string): string {
  return particleName.trim().replace(/\.par$/i, "");
}

export function getMagicParticleDummyModelName(effFiles: EffectFile[]): string | undefined {
  const firstSubEffect = getMagicParticleDummySubEffect(effFiles);
  if (!firstSubEffect) return undefined;
  const geometry = resolveGeometry(firstSubEffect);
  return geometry.type === "model" ? geometry.modelName : undefined;
}

export function getMagicParticleDummySubEffect(effFiles: EffectFile[]): SubEffect | null {
  return effFiles[0]?.subEffects[0] ?? null;
}

export function getMagicParticleDummyPosition(
  dummies: MagicDummyPoint[],
  dummyId: number | undefined,
): THREE.Vector3 | null {
  if (dummyId === undefined || dummyId < 0) return null;
  return dummies.find((dummy) => dummy.id === dummyId)?.position ?? null;
}

/**
 * Source-derived CMagicCtrl dummy anchor.
 *
 * The C++ path renders the first CMPModelEff, then asks its first item-backed
 * model for GetRunningDummyMatrix and moves the particle controller to mat._41.
 * We cannot yet evaluate skeletal item animation, but this composes the same
 * animated sub-effect frame transform with the static .lgo helper position.
 */
export function computeMagicParticleDummyAnchor(
  subEffect: SubEffect | null,
  dummies: MagicDummyPoint[],
  dummyId: number | undefined,
  elapsedTime: number,
  loop: boolean,
): THREE.Vector3 | null {
  const dummyPosition = getMagicParticleDummyPosition(dummies, dummyId);
  if (!dummyPosition || !subEffect) return dummyPosition;

  const frame = interpolateFrame(subEffect, elapsedTime, loop);
  _position.set(frame.position[0], frame.position[1], frame.position[2]);
  _scale.set(frame.size[0], frame.size[1], frame.size[2]);
  _euler.set(frame.angle[0], frame.angle[1], frame.angle[2], "YXZ");
  _rotation.setFromEuler(_euler);

  if (subEffect.rotaLoop) {
    const [x, y, z, speed] = subEffect.rotaLoopVec;
    _rotaAxis.set(x, y, z);
    if (_rotaAxis.lengthSq() > 0.0001) {
      _rotaAxis.normalize();
      _rotaLoop.setFromAxisAngle(_rotaAxis, elapsedTime * speed);
      _rotation.premultiply(_rotaLoop);
    }
  }

  _matrix.compose(_position, _rotation, _scale);
  return dummyPosition.clone().applyMatrix4(_matrix);
}
