import { FlightContext } from "../FlightPathController";
import * as THREE from "three";

/**
 * RenderIdx 5 — Directional Light (stationary beam)
 * C++ Part_dirlight: position stays at origin, effect plays its animation
 * and the animation completion system handles signaling done.
 */
export function flightDirlight(_ctx: FlightContext, group: THREE.Group): void {
  // Stationary: keep at origin, let animation drive completion.
  // Do NOT set ctx.done — the animation completion system handles it.
  group.position.copy(_ctx.origin);
}
