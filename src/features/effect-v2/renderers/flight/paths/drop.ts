import { FlightContext } from "../FlightPathController";
import * as THREE from "three";

/**
 * RenderIdx 0 — Drop
 * Projectile moves in a straight line from origin to target.
 * C++ Part_drop: identical to fly in our viewer (terrain collision skipped).
 */
export function flightDrop(ctx: FlightContext, group: THREE.Group): void {
  if (!ctx.state.initialized) {
    ctx.state.initialized = true;
    const dir = new THREE.Vector3().subVectors(ctx.target, ctx.origin).normalize();
    ctx.state.dir = dir;
    ctx.state.startDist = ctx.origin.distanceTo(ctx.target);
    ctx.state.curDist = 0;
    group.position.copy(ctx.origin);
  }

  const dir = ctx.state.dir as THREE.Vector3;
  const fDist = ctx.velocity * ctx.delta;
  ctx.state.curDist = (ctx.state.curDist as number) + fDist;

  if ((ctx.state.curDist as number) > (ctx.state.startDist as number)) {
    group.position.copy(ctx.target);
    ctx.done = true;
    return;
  }

  group.position.addScaledVector(dir, fDist);
}
