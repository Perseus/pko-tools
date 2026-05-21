import { FlightContext } from "../FlightPathController";
import * as THREE from "three";
import { isPointInstrPointRange } from "./pathMath";

/**
 * RenderIdx 4 — Arc
 * Parabolic arc trajectory using a circular projection.
 * C++ Part_arc: arc center is placed below the midpoint of start/target,
 * then each frame the projectile is projected onto the circle surface.
 */
export function flightArc(ctx: FlightContext, group: THREE.Group): void {
  if (!ctx.state.initialized) {
    ctx.state.initialized = true;
    const dir = new THREE.Vector3().subVectors(ctx.target, ctx.origin).normalize();
    const horizontalDist = ctx.origin.distanceTo(ctx.target);

    // Arc center: midpoint between origin and target, dropped below by half the distance.
    // PKO runtime is z-up, so the C++ `arcOrg.z -= halfDistance` stays on Z.
    const arcOrg = new THREE.Vector3().addVectors(ctx.origin, ctx.target).multiplyScalar(0.5);
    arcOrg.z -= horizontalDist / 2;

    const radius = ctx.origin.distanceTo(arcOrg);

    ctx.state.dir = dir;
    ctx.state.arcOrg = arcOrg;
    ctx.state.radius = radius;
    ctx.state.curArc = 0;
    ctx.state.oldPos = ctx.origin.clone();
    group.position.copy(ctx.origin);
  }

  const dir = ctx.state.dir as THREE.Vector3;
  ctx.sourceDirection = dir;
  const arcOrg = ctx.state.arcOrg as THREE.Vector3;
  const radius = ctx.state.radius as number;

  ctx.state.curArc = (ctx.state.curArc as number) + ctx.velocity * ctx.delta;

  // Compute the base point along the straight-line path at current arc distance
  const oldPos = ctx.state.oldPos as THREE.Vector3;
  const basePoint = oldPos.clone().addScaledVector(dir, ctx.state.curArc as number);

  // Project from arc center through basePoint onto the circle surface
  const dirToBase = new THREE.Vector3().subVectors(basePoint, arcOrg).normalize();
  group.position.copy(arcOrg).addScaledVector(dirToBase, radius);

  if (isPointInstrPointRange(group.position, ctx.target, 0.5)) {
    ctx.done = true;
  }
}
