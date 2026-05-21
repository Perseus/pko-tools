import * as THREE from "three";
import { ParSystem } from "@/types/effect-v2";
import { Particle } from "./useParticleLifecycle";

export function computeArrowSpawnPosition(system: ParSystem): THREE.Vector3 {
  return new THREE.Vector3(system.offset[0], system.offset[1], system.offset[2]);
}

export function initArrowParticle(p: Particle, _i: number, system: ParSystem): void {
  p.life = system.life;
  p.frameTime = system.frameCount > 0 ? system.life / system.frameCount : system.life;
  p.dir.set(0, 0, 0);
  p.accel.set(0, 0, 0);
  p.pos.copy(computeArrowSpawnPosition(system));
}

export function moveArrowParticle(
  p: Pick<Particle, "pos">,
  _i: number,
  _dt: number,
  system: ParSystem,
  emitterPosition?: THREE.Vector3 | null,
  pathOffset?: THREE.Vector3 | null,
): void {
  p.pos.copy(computeArrowSpawnPosition(system));
  if (emitterPosition) p.pos.add(emitterPosition);
  if (pathOffset) p.pos.add(pathOffset);
}
