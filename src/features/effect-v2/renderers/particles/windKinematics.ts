import * as THREE from "three";
import { ParSystem } from "@/types/effect-v2";
import { Particle } from "./useParticleLifecycle";
import { computeRangeSpawnPosition } from "./particlePlacement";

export interface WindState {
  pos: THREE.Vector3;
  origin: THREE.Vector3;
  accel: THREE.Vector3;
  angle: number;
  angularVelocity: number;
}

function cleanAngle(angle: number): number {
  return angle >= Math.PI * 2 ? angle - Math.PI * 2 : angle;
}

export function computeWindSpawnState(
  system: ParSystem,
  random: () => number = Math.random,
): WindState {
  const pos = computeRangeSpawnPosition(system, random);
  return {
    pos,
    origin: pos.clone(),
    accel: new THREE.Vector3(0, 0, 0),
    angle: 0,
    angularVelocity: system.velocity,
  };
}

export function computeWindMovementState(
  system: ParSystem,
  state: WindState,
  dt: number,
): WindState {
  const accel = state.accel.clone();
  accel.y += system.direction[1] * dt;
  accel.z += system.direction[2] * dt;

  const angle = cleanAngle(state.angle + state.angularVelocity * dt);
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const rotated = new THREE.Vector3(
    accel.x * cosA - accel.y * sinA,
    accel.x * sinA + accel.y * cosA,
    accel.z,
  );

  return {
    pos: state.origin.clone().add(rotated),
    origin: state.origin.clone(),
    accel,
    angle,
    angularVelocity: state.angularVelocity,
  };
}

export function initWindParticle(p: Particle, _i: number, system: ParSystem): WindState {
  const state = computeWindSpawnState(system);
  p.life = system.life;
  p.frameTime = system.frameCount > 0 ? system.life / system.frameCount : system.life;
  p.pos.copy(state.pos);
  p.accel.copy(state.accel);
  p.dir.set(state.angle, state.angularVelocity, 0);
  return state;
}

export function moveWindParticle(
  p: Particle,
  _i: number,
  dt: number,
  system: ParSystem,
  origin: THREE.Vector3,
): void {
  const next = computeWindMovementState(
    system,
    {
      pos: p.pos,
      origin,
      accel: p.accel,
      angle: p.dir.x,
      angularVelocity: p.dir.y,
    },
    dt,
  );
  p.pos.copy(next.pos);
  p.accel.copy(next.accel);
  p.dir.x = next.angle;
  p.dir.y = next.angularVelocity;
}
