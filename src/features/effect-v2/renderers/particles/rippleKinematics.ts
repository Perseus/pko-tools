import * as THREE from "three";
import { ParSystem } from "@/types/effect-v2";
import { Particle } from "./useParticleLifecycle";
import { computeParticleSpawnPosition } from "./particlePlacement";

export function computeRippleSpawnPosition(
  system: ParSystem,
  random: () => number = Math.random,
): THREE.Vector3 {
  return computeParticleSpawnPosition(system, random);
}

export function initRippleParticle(p: Particle, _i: number, system: ParSystem): void {
  p.pos.copy(computeRippleSpawnPosition(system));
}

export function moveRippleParticle(_p: Particle, _i: number, _dt: number): void {
  // Ripple particles only animate size/color/alpha via the shared lifecycle.
}
