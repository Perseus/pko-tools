import * as THREE from "three";
import { ParSystem } from "@/types/effect-v2";
import { Particle } from "./useParticleLifecycle";

function cleanZero(value: number): number {
  return Math.abs(value) < 1e-10 ? 0 : value;
}

export function computeRoundInitialOffset(
  system: ParSystem,
  index: number,
  particleCount: number,
): THREE.Vector3 {
  const angle = particleCount > 0 ? (Math.PI * 2 * index) / particleCount : 0;
  const pkoX = cleanZero(-Math.sin(angle) * system.range[1]);
  const pkoY = cleanZero(Math.cos(angle) * system.range[1]);

  return new THREE.Vector3(pkoX, pkoY, 0);
}

export function computeRoundPosition(
  system: ParSystem,
  index: number,
  particleCount: number,
  elapsedTime: number,
): THREE.Vector3 {
  const angle = (particleCount > 0 ? (Math.PI * 2 * index) / particleCount : 0)
    + system.velocity * elapsedTime;
  const pkoX = cleanZero(-Math.sin(angle) * system.range[1] + system.offset[0]);
  const pkoY = cleanZero(Math.cos(angle) * system.range[1] + system.offset[1]);
  const pkoZ = system.offset[2];

  return new THREE.Vector3(pkoX, pkoY, pkoZ);
}

export function initRoundParticle(p: Particle, index: number, system: ParSystem): void {
  p.dir.copy(computeRoundInitialOffset(system, index, system.particleCount));
  p.accel.set(0, 0, 0);
  p.pos.copy(computeRoundPosition(system, index, system.particleCount, 0));
}

export function moveRoundParticle(
  p: Particle,
  index: number,
  _dt: number,
  system: ParSystem,
  emitterPosition?: THREE.Vector3 | null,
  pathOffset?: THREE.Vector3 | null,
): void {
  p.pos.copy(computeRoundPosition(system, index, system.particleCount, p.elapsed));
  if (emitterPosition) p.pos.add(emitterPosition);
  if (pathOffset) p.pos.add(pathOffset);
}
