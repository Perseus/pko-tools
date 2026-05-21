import { FlightContext } from "../FlightPathController";
import * as THREE from "three";
import { isPointInstrPointRange } from "./pathMath";

/**
 * RenderIdx 2 — Trace
 * Effect traces/follows a path toward the target.
 */
export function flightTrace(ctx: FlightContext, group: THREE.Group): void {
  if (!ctx.state.initialized) {
    ctx.state.initialized = true;
    ctx.state.oldTarget = ctx.target.clone();
    ctx.state.dir = new THREE.Vector3().subVectors(ctx.target, ctx.origin).normalize();
    ctx.state.startDist = ctx.origin.distanceTo(ctx.target);
    ctx.state.distSq = ctx.origin.distanceToSquared(ctx.target);
    group.position.copy(ctx.origin);

    if ((ctx.state.startDist as number) < 1) {
      group.position.copy(ctx.target);
    }
  }

  const oldTarget = ctx.state.oldTarget as THREE.Vector3;
  const dir = ctx.state.dir as THREE.Vector3;
  ctx.sourceDirection = dir;
  ctx.orientationTarget = oldTarget;

  if ((ctx.state.startDist as number) < 1) {
    ctx.done = true;
    return;
  }

  // Step distance (clamped to 1.5 per frame, matching original engine)
  let fDist = ctx.velocity * ctx.delta;
  if (fDist * fDist > (ctx.state.distSq as number)) {
    group.position.copy(oldTarget);
    ctx.done = true;
    return;
  }
  if (fDist > 1.5) fDist = 1.5;

  group.position.addScaledVector(dir, fDist);

  if (isPointInstrPointRange(group.position, oldTarget, 1.0)) {
    ctx.done = true;
    return;
  }

  // Target-motion compensation: nudge projectile proportionally
  // when the target moves between frames
  const nextTarget = ctx.target.clone();

  if (isPointInstrPointRange(nextTarget, oldTarget, 1.0)) {
    return;
  }

  ctx.orientationTarget = nextTarget;
  const resetDir = nextTarget.clone().sub(group.position);
  if (resetDir.lengthSq() > 0.000001) {
    resetDir.normalize();
    ctx.orientationDirection = resetDir.clone();
  }

  const targDir = new THREE.Vector3().subVectors(nextTarget, oldTarget);
  const targDistSq = targDir.lengthSq();

  if (targDistSq > 0.0001) {
    targDir.normalize();
    const currentDistSq = ctx.state.distSq as number;
    if (currentDistSq > 0.0001) {
      const flerp = (targDistSq / currentDistSq) * fDist;
      group.position.addScaledVector(targDir, flerp);
    }
  }

  oldTarget.copy(nextTarget);

  const nextDir = new THREE.Vector3().subVectors(nextTarget, group.position);
  ctx.state.distSq = nextDir.lengthSq();
  if ((ctx.state.distSq as number) > 0.000001) {
    nextDir.normalize();
  }
  ctx.state.dir = nextDir;
  ctx.sourceDirection = nextDir;
}
