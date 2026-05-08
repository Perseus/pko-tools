import * as THREE from "three";
import { ParSystem } from "@/types/effect-v2";
import { Particle } from "./useParticleLifecycle";
import { computeParticleSpawnPosition } from "./particlePlacement";

export interface FireSpawnState {
  dir: THREE.Vector3;
  accel: THREE.Vector3;
  pos: THREE.Vector3;
}

export function computeFireSpawnState(
  system: ParSystem,
  random: () => number = Math.random,
): FireSpawnState {
  const pkoDir = new THREE.Vector3(
    system.direction[0],
    system.direction[1],
    system.direction[2],
  );
  if (pkoDir.lengthSq() > 0) pkoDir.normalize();

  return {
    dir: pkoDir,
    accel: new THREE.Vector3(system.acceleration[0], system.acceleration[1], system.acceleration[2]),
    pos: computeParticleSpawnPosition(system, random),
  };
}

export function computeFireMovementDelta(
  dir: THREE.Vector3,
  accel: THREE.Vector3,
  velocity: number,
  dt: number,
  random: () => number = Math.random,
): THREE.Vector3 {
  const signedAccel = random() < 0.5 ? 1 : -1;
  return dir.clone()
    .multiplyScalar(velocity * dt)
    .addScaledVector(accel, signedAccel * dt);
}

export function computeFireModelDirMovementDirection(direction: THREE.Vector3): THREE.Vector3 {
  if (direction.lengthSq() <= 0.000001) return new THREE.Vector3();

  const normalized = direction.clone().normalize();
  const pitch = direction.z === 0 ? 0 : Math.asin(direction.z / direction.length());
  let yaw = 0;

  if (direction.x !== 0 || direction.y !== 0) {
    const horizontal = Math.sqrt(direction.x * direction.x + direction.y * direction.y);
    yaw = Math.acos(direction.y / horizontal);
    if (direction.x >= 0) yaw = -yaw;
  }

  return new THREE.Vector3(pitch, yaw, normalized.z);
}

export function initFireParticle(p: Particle, _i: number, system: ParSystem): void {
  const state = computeFireSpawnState(system);
  p.dir.copy(state.dir);
  p.accel.copy(state.accel);
  p.pos.copy(state.pos);
}

export function moveFireParticle(p: Particle, _i: number, dt: number, system: ParSystem): void {
  p.pos.add(computeFireMovementDelta(p.dir, p.accel, system.velocity, dt));
}
