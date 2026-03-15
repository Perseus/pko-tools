import { FlightContext } from "../FlightPathController";
import * as THREE from "three";

/**
 * RenderIdx 2 — Trace
 * Effect traces/follows a path toward the target.
 */
export function flightTrace(ctx: FlightContext, group: THREE.Group): void {
  if (!ctx.state.initialized) {
    ctx.state.initialized = true;
    ctx.state.oldTarget = ctx.target.clone();

    if (ctx.target.distanceTo(ctx.origin) < 1) {
      group.position.copy(ctx.target);
    }
  }

  // Check against the aim point, not the feet
  const aimPoint = ctx.target.clone();
  aimPoint.y += 1;

  if (group.position.distanceTo(aimPoint) < 1.5) {
    ctx.done = true;
    return;
  }

  // Step distance (clamped to 1.5 per frame, matching original engine)
  const fDist = Math.min(ctx.velocity * ctx.delta, 1.5);

  // Target-motion compensation: nudge projectile proportionally
  // when the target moves between frames
  const oldTarget = ctx.state.oldTarget as THREE.Vector3;
  const targDir = new THREE.Vector3().subVectors(ctx.target, oldTarget);
  const targDistSq = targDir.lengthSq();

  if (targDistSq > 0.0001) {
    targDir.normalize();
    const totalDistSq = group.position.distanceToSquared(ctx.target);
    if (totalDistSq > 0.0001) {
      const flerp = (targDistSq / totalDistSq) * fDist;
      group.position.addScaledVector(targDir, flerp);
    }
  }

  oldTarget.copy(ctx.target);

  // Move toward aim point
  const direction = new THREE.Vector3().subVectors(aimPoint, group.position).normalize();
  group.position.addScaledVector(direction, fDist);
}
