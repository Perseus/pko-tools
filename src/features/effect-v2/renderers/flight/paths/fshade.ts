import { FlightContext } from "../FlightPathController";
import * as THREE from "three";

/**
 * RenderIdx 3 — Fade/Shade
 * Projectile moves toward target, stops when within 0.5 units.
 * C++ Part_fshade: movement only (fade trail requires multi-pass rendering,
 * not implemented in the viewer).
 */
export function flightFshade(ctx: FlightContext, group: THREE.Group): void {
  if (!ctx.state.initialized) {
    ctx.state.initialized = true;
    ctx.state.dir = new THREE.Vector3().subVectors(ctx.target, ctx.origin).normalize();
    group.position.copy(ctx.origin);
  }

  if (group.position.distanceTo(ctx.target) < 0.5) {
    ctx.done = true;
    return;
  }

  const dir = ctx.state.dir as THREE.Vector3;
  const fDist = ctx.velocity * ctx.delta;
  group.position.addScaledVector(dir, fDist);
}
