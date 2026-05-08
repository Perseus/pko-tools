import { FlightContext } from "../FlightPathController";
import * as THREE from "three";
import { isPointInstrPointRange } from "./pathMath";

export interface FshadeTrailSample {
  position: THREE.Vector3;
  opacity: number;
}

export function getFshadeTrailCount(elapsed: number): number {
  if (!Number.isFinite(elapsed) || elapsed <= 0.6) return 1;
  return 1 + Math.floor((elapsed - 0.000001) / 0.6);
}

export function computeFshadeTrailSamples({
  position,
  direction,
  count,
}: {
  position: THREE.Vector3;
  direction: THREE.Vector3;
  count: number;
}): FshadeTrailSample[] {
  const sampleCount = Math.max(0, Math.floor(count));
  if (sampleCount <= 0) return [];

  const dir = direction.clone();
  if (dir.lengthSq() <= 0.000001) return [];
  dir.normalize();

  const samples: FshadeTrailSample[] = [];
  const tvPos = position.clone();
  let opacity = 1;

  for (let n = 0; n < sampleCount; n++) {
    opacity -= 1 / sampleCount;
    tvPos.addScaledVector(dir, -0.5);
    samples.push({
      position: tvPos.clone(),
      opacity: Math.max(0, opacity),
    });
  }

  return samples;
}

/**
 * RenderIdx 3 — Fade/Shade
 * Projectile moves toward target, stops when within 0.5 units.
 * C++ Part_fshade: movement plus fading multi-pass samples behind the projectile.
 */
export function flightFshade(ctx: FlightContext, group: THREE.Group): void {
  if (!ctx.state.initialized) {
    ctx.state.initialized = true;
    ctx.state.dir = new THREE.Vector3().subVectors(ctx.target, ctx.origin).normalize();
    group.position.copy(ctx.origin);
  }

  if (isPointInstrPointRange(group.position, ctx.target, 0.5)) {
    ctx.done = true;
    return;
  }

  const dir = ctx.state.dir as THREE.Vector3;
  ctx.sourceDirection = dir;
  const fDist = ctx.velocity * ctx.delta;
  group.position.addScaledVector(dir, fDist);

  const trailCount = getFshadeTrailCount(ctx.elapsed);
  ctx.trailSamples = computeFshadeTrailSamples({
    position: group.position,
    direction: dir,
    count: trailCount,
  });
}
