import * as THREE from "three";
import type { MutableRefObject } from "react";
import { ParSystem } from "@/types/effect-v2";

export function computeRangeBasePosition(system: ParSystem): THREE.Vector3 {
  return new THREE.Vector3(
    system.offset[0] - system.range[0] / 2,
    system.offset[1] - system.range[1] / 2,
    system.offset[2] - system.range[2] / 2,
  );
}

export function computeRangeSpawnPosition(
  system: ParSystem,
  random: () => number = Math.random,
): THREE.Vector3 {
  return new THREE.Vector3(
    system.offset[0] - system.range[0] / 2 + random() * system.range[0],
    system.offset[1] - system.range[1] / 2 + random() * system.range[1],
    system.offset[2] - system.range[2] / 2 + random() * system.range[2],
  );
}

export function computeModelRangeSpawnPosition(
  system: ParSystem,
  random: () => number = Math.random,
): THREE.Vector3 | null {
  if (system.pointRanges.length === 0) return null;

  const index = Math.floor(random() * system.pointRanges.length);
  const point = system.pointRanges[Math.min(index, system.pointRanges.length - 1)];
  return new THREE.Vector3(
    system.offset[0] - system.range[0] / 2 + point[0],
    system.offset[1] - system.range[1] / 2 + point[1],
    system.offset[2] - system.range[2] / 2 + point[2],
  );
}

export function computeParticleSpawnPosition(
  system: ParSystem,
  random: () => number = Math.random,
): THREE.Vector3 {
  return computeModelRangeSpawnPosition(system, random) ?? computeRangeSpawnPosition(system, random);
}

export function getEmitterPosition(
  emitterPositionRef?: MutableRefObject<THREE.Vector3 | null>,
): THREE.Vector3 | null {
  return emitterPositionRef?.current ?? null;
}

export function withEmitterPosition(
  position: THREE.Vector3,
  emitterPosition?: THREE.Vector3 | null,
): THREE.Vector3 {
  if (!emitterPosition) return position;
  return position.add(emitterPosition);
}
