import { FlightContext } from "../FlightPathController";
import * as THREE from "three";

/**
 * RenderIdx 5 — Directional Light (stationary beam)
 * C++ Part_dirlight: position stays at origin, effect plays its animation
 * and the animation completion system handles signaling done.
 */
export function flightDirlight(ctx: FlightContext, group: THREE.Group): void {
  if (!ctx.state.initialized) {
    ctx.state.initialized = true;
    const target = ctx.target.clone();
    target.z = ctx.origin.z;
    ctx.state.dir = target.sub(ctx.origin).normalize();
  }

  // Stationary: keep at origin, let animation drive completion.
  // Do NOT set ctx.done — the animation completion system handles it.
  group.position.copy(ctx.origin);
  ctx.sourceDirection = ctx.state.dir as THREE.Vector3;
  ctx.orientationTarget = ctx.target.clone();
  ctx.orientationTarget.z = ctx.origin.z;

  if (ctx.effectDuration !== undefined && ctx.elapsed >= ctx.effectDuration) {
    ctx.done = true;
  }
}
