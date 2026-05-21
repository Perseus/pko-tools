import * as THREE from "three";
import { ParSystem } from "@/types/effect-v2";
import { Particle } from "./useParticleLifecycle";
import { computeParticleSpawnPosition } from "./particlePlacement";

export interface SnowSpawnState {
  dir: THREE.Vector3;
  accel: THREE.Vector3;
  pos: THREE.Vector3;
}

function randfRange(min: number, max: number, random: () => number): number {
  return min + random() * (max - min);
}

export function computeSnowSpawnState(
  system: ParSystem,
  random: () => number = Math.random,
): SnowSpawnState | null {
  const randomMode = Math.max(system.randomMode, 1);
  const minVelocity = system.velocity / randomMode;

  const pkoDir = randomMode === 1
    ? new THREE.Vector3(system.velocity, system.velocity, system.velocity)
    : new THREE.Vector3(
      randfRange(minVelocity, system.velocity, random),
      randfRange(minVelocity, system.velocity, random),
      randfRange(minVelocity, system.velocity, random),
    );

  pkoDir.x *= random() < 0.5 ? system.direction[0] : -system.direction[0];
  pkoDir.y *= random() < 0.5 ? system.direction[1] : -system.direction[1];
  pkoDir.z *= system.direction[2];

  if (pkoDir.z === 0) return null;

  return {
    dir: pkoDir,
    accel: new THREE.Vector3(system.acceleration[0], system.acceleration[1], system.acceleration[2]),
    pos: computeParticleSpawnPosition(system, random),
  };
}

export function computeSnowMovementDelta(
  dir: THREE.Vector3,
  accel: THREE.Vector3,
  dt: number,
  random: () => number = Math.random,
): THREE.Vector3 {
  const signedAccel = random() < 0.5 ? 1 : -1;
  return dir.clone().multiplyScalar(dt).addScaledVector(accel, signedAccel * dt);
}

export function initSnowParticle(p: Particle, _i: number, system: ParSystem): void {
  const state = computeSnowSpawnState(system);
  if (!state) {
    p.alive = false;
    return;
  }

  p.dir.copy(state.dir);
  p.accel.copy(state.accel);
  p.pos.copy(state.pos);
}

export function moveSnowParticle(p: Particle, _i: number, dt: number): void {
  p.pos.add(computeSnowMovementDelta(p.dir, p.accel, dt));
}
