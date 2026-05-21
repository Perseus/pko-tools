import * as THREE from "three";
import { ParSystem } from "@/types/effect-v2";
import { Particle } from "./useParticleLifecycle";
import { computeRangeBasePosition, withEmitterPosition } from "./particlePlacement";

export function computeShadeSpawnPosition(system: ParSystem): THREE.Vector3 {
  return computeRangeBasePosition(system);
}

export function initShadeParticle(p: Particle, _i: number, system: ParSystem): void {
  p.dir.set(0, 0, 0);
  p.accel.set(0, 0, 0);
  p.pos.copy(computeShadeSpawnPosition(system));
  p.life = system.life * Math.max(system.frameCount, 1);
  p.frameTime = system.life;
  p.size = system.frameSizes[0] ?? 1;
}

export function moveShadeParticle(
  p: Pick<Particle, "pos" | "size">,
  _i: number,
  _dt: number,
  system?: ParSystem,
  emitterPosition?: THREE.Vector3 | null,
  pathOffset?: THREE.Vector3 | null,
): void {
  if (!system) return;
  p.pos.copy(withEmitterPosition(computeShadeSpawnPosition(system), emitterPosition));
  if (pathOffset) p.pos.add(pathOffset);
  p.size = system.frameSizes[0] ?? 1;
}
