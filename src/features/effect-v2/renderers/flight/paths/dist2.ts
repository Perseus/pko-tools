import { FlightContext } from "../FlightPathController";
import * as THREE from "three";

/**
 * RenderIdx 7 — Distance2
 * Same movement as dist but with linear alpha fade (not implemented in viewer).
 * C++ Part_dist2: alpha fade would need renderer-level support.
 */
export function flightDist2(ctx: FlightContext, group: THREE.Group): void {
  if (!ctx.state.initialized) {
    ctx.state.initialized = true;
    ctx.state.dir = new THREE.Vector3().subVectors(ctx.target, ctx.origin).normalize();
    ctx.state.startDist = ctx.origin.distanceTo(ctx.target);
    ctx.state.curDist = 0;
    group.position.copy(ctx.origin);
  }

  const dir = ctx.state.dir as THREE.Vector3;
  const fDist = ctx.velocity * ctx.delta;
  ctx.state.curDist = (ctx.state.curDist as number) + fDist;
  group.position.addScaledVector(dir, fDist);

  if ((ctx.state.curDist as number) > (ctx.state.startDist as number)) {
    ctx.done = true;
  }
}
