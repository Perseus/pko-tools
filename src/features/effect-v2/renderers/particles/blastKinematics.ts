import * as THREE from "three";
import { ParSystem } from "@/types/effect-v2";
import { advanceParticleFrame } from "./useParticleLifecycle";
import type { FrameEndBehavior, Particle, ParticleFrameAdvanceResult } from "./useParticleLifecycle";
import { computeParticleSpawnPosition, computeRangeBasePosition } from "./particlePlacement";

export interface BlastSpawnState {
  dir: THREE.Vector3;
  accel: THREE.Vector3;
  pos: THREE.Vector3;
}

export function computeBlastSpawnState(
  system: ParSystem,
  random: () => number = Math.random,
): BlastSpawnState {
  const pkoDir = new THREE.Vector3(
    random() * system.velocity,
    -random() * system.velocity,
    random() * system.velocity,
  );

  pkoDir.x *= random() < 0.5 ? system.direction[0] : -system.direction[0];
  pkoDir.y *= random() < 0.5 ? system.direction[1] : -system.direction[1];
  pkoDir.z *= system.direction[2];

  return {
    dir: pkoDir,
    accel: new THREE.Vector3(system.acceleration[0], system.acceleration[1], system.acceleration[2]),
    pos: computeParticleSpawnPosition(system, random),
  };
}

export function initBlastParticle(p: Particle, _i: number, system: ParSystem): void {
  const state = computeBlastSpawnState(system);
  p.dir.copy(state.dir);
  p.accel.copy(state.accel);
  p.pos.copy(state.pos);
}

export function moveBlastParticle(p: Particle, _i: number, dt: number): void {
  p.pos.addScaledVector(p.dir, dt);
  p.dir.addScaledVector(p.accel, dt);
}

export function computeBlast2SpawnState(system: ParSystem): BlastSpawnState {
  return {
    // C++ _CreateBlast2 uses CMPPartSys::_vFontDir, whose default is (0, 1, 0).
    dir: new THREE.Vector3(0, 1, 0),
    // _FrameMoveBlast2 reuses particle accel as state: x phase flag, y lateral offset, z cycle.
    accel: new THREE.Vector3(0, system.frameAngles[0]?.[0] ?? 0, 0),
    pos: computeRangeBasePosition(system),
  };
}

export function initBlast2Particle(p: Particle, _i: number, system: ParSystem): void {
  const state = computeBlast2SpawnState(system);
  p.dir.copy(state.dir);
  p.accel.copy(state.accel);
  p.pos.copy(state.pos);
  p.custom = {};
}

export function advanceBlast2ParticleFrame(
  p: Particle,
  dt: number,
  frameCount: number,
  frameEndBehavior: FrameEndBehavior,
): ParticleFrameAdvanceResult {
  if (p.accel.x === 0) {
    advanceParticleFrame(p, dt, frameCount, frameEndBehavior, p.frameTime / 3);
    if (p.alive && p.curFrame === 1) {
      p.accel.x += 1;
      p.custom = { ...p.custom, blast2Anchor: p.pos.clone() };
    }
  } else {
    advanceParticleFrame(p, dt, frameCount, frameEndBehavior);
  }

  if (!p.alive || p.curFrame !== 1) return {};

  const anchor = p.custom?.blast2Anchor ?? p.pos;
  if (p.accel.z === 0) {
    p.pos.x = anchor.x + p.accel.y;
    p.accel.z = 1;
  } else if (p.accel.z === 1) {
    p.pos.x = anchor.x - p.accel.y;
    p.accel.z = 2;
  } else if (p.accel.z === 2) {
    p.pos.x = anchor.x;
    p.accel.z = 3;
  }

  return { skipFrameOutputs: true, skipMove: true };
}

export function moveBlast2Particle(p: Particle, _i: number, dt: number, system: ParSystem): void {
  const velocityScale = p.accel.x === 0 ? 3 : 1;
  p.pos.addScaledVector(p.dir, system.velocity * dt * velocityScale);
  p.dir.addScaledVector(
    new THREE.Vector3(system.acceleration[0], system.acceleration[1], system.acceleration[2]),
    dt,
  );
}

export function computeBlast3SpawnState(system: ParSystem, index: number): BlastSpawnState {
  const count = Math.max(system.particleCount, 1);
  const angle = (Math.PI * 2 * index) / count;
  const dir = new THREE.Vector3(1, 1, -1).applyAxisAngle(new THREE.Vector3(0, 0, 1), angle);
  dir.add(new THREE.Vector3(system.direction[0], system.direction[1], system.direction[2]));

  return {
    dir,
    accel: new THREE.Vector3(system.acceleration[0], system.acceleration[1], system.acceleration[2]),
    pos: computeRangeBasePosition(system),
  };
}

export function initBlast3Particle(p: Particle, index: number, system: ParSystem): void {
  const state = computeBlast3SpawnState(system, index);
  p.dir.copy(state.dir);
  p.accel.copy(state.accel);
  p.pos.copy(state.pos);
  p.life = system.life;
  p.frameTime = system.frameCount > 0 ? system.life / system.frameCount : system.life;
}

export function moveBlast3Particle(p: Particle, _i: number, dt: number, system: ParSystem): void {
  p.pos.addScaledVector(p.dir, system.velocity * dt);
  p.dir.addScaledVector(p.accel, dt);
}
