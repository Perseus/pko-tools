import * as THREE from "three";
import { MagicGroupEntry, MagicSingleEntry } from "@/types/effect-v2";

export const DEFAULT_FAN_ANGLE = 0.75;
export const SEQUENCE_DELAY = 0.2;

export function expandMagicGroupPhases(
  group: MagicGroupEntry,
  magicMap: Map<number, MagicSingleEntry>,
): MagicSingleEntry[] {
  const entries: MagicSingleEntry[] = [];
  for (let i = 0; i < group.type_ids.length; i++) {
    if (group.type_ids[i] < 0) continue;
    const entry = magicMap.get(group.type_ids[i]);
    if (!entry) continue;
    for (let j = 0; j < group.counts[i]; j++) {
      entries.push(entry);
    }
  }
  return entries;
}

export function computeFanPhaseTarget(
  origin: THREE.Vector3,
  target: THREE.Vector3,
  index: number,
  count: number,
  fanAngle = DEFAULT_FAN_ANGLE,
): THREE.Vector3 {
  const flattenedTarget = target.clone();
  flattenedTarget.z = origin.z;
  if (count <= 1) return flattenedTarget;

  const angle = -(fanAngle / 2) + (fanAngle / (count - 1)) * index;
  const dir = flattenedTarget.clone().sub(origin);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  return new THREE.Vector3(
    origin.x + dir.x * cos - dir.y * sin,
    origin.y + dir.x * sin + dir.y * cos,
    origin.z,
  );
}

export function computeSequenceDelay(index: number): number {
  return index * SEQUENCE_DELAY;
}
