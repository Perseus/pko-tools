import * as THREE from "three";
import { ParSystem } from "@/types/effect-v2";
import { Particle } from "./useParticleLifecycle";
import { computeRangeBasePosition, withEmitterPosition } from "./particlePlacement";

export function computeStripSpawnPosition(system: ParSystem): THREE.Vector3 {
  return computeRangeBasePosition(system);
}

export function initStripParticle(p: Particle, _i: number, system: ParSystem): void {
  p.dir.set(0, 0, 0);
  p.accel.set(0, 0, 0);
  p.pos.copy(computeStripSpawnPosition(system));
  p.size = system.frameSizes[0] ?? 1;
  const color = system.frameColors[0] ?? [1, 1, 1, 1];
  p.color.setRGB(color[0], color[1], color[2]);
  p.alpha = color[3];
  p.life = 0;
  p.frameTime = 0;
}

export function moveStripParticle(
  p: Pick<Particle, "pos">,
  _i: number,
  _dt: number,
  system: ParSystem,
  emitterPosition?: THREE.Vector3 | null,
  pathOffset?: THREE.Vector3 | null,
): void {
  p.pos.copy(withEmitterPosition(computeStripSpawnPosition(system), emitterPosition));
  if (pathOffset) p.pos.add(pathOffset);
}
