import * as THREE from "three";
import { ParSystem } from "@/types/effect-v2";
import { Particle } from "./useParticleLifecycle";
import { computeRangeSpawnPosition } from "./particlePlacement";

export interface ShrinkSpawnState {
  pos: THREE.Vector3;
  target: THREE.Vector3;
  accel: THREE.Vector3;
}

export function computeShrinkTargetPosition(system: ParSystem): THREE.Vector3 {
  return new THREE.Vector3(system.offset[0], system.offset[1], system.offset[2]);
}

export function computeShrinkSpawnState(
  system: ParSystem,
  random: () => number = Math.random,
): ShrinkSpawnState {
  const pos = computeRangeSpawnPosition(system, random);
  const target = computeShrinkTargetPosition(system);
  const accel = target.clone().sub(pos);
  if (accel.lengthSq() > 0) accel.normalize();

  return { pos, target, accel };
}

export function computeShrinkMovementDelta(
  accel: THREE.Vector3,
  system: ParSystem,
  dt: number,
): THREE.Vector3 {
  return accel.clone().multiplyScalar(system.velocity * dt);
}

export function shouldKillShrinkParticle(
  pos: THREE.Vector3,
  target: THREE.Vector3,
): boolean {
  return pos.distanceTo(target) <= 0.5;
}

export function initShrinkParticle(p: Particle, _i: number, system: ParSystem): void {
  const state = computeShrinkSpawnState(system);
  p.dir.copy(state.target);
  p.accel.copy(state.accel);
  p.pos.copy(state.pos);
}

export function moveShrinkParticle(p: Particle, _i: number, dt: number, system: ParSystem): void {
  p.pos.add(computeShrinkMovementDelta(p.accel, system, dt));
  if (shouldKillShrinkParticle(p.pos, p.dir)) {
    p.alive = false;
  }
}
