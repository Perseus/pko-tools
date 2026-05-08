import * as THREE from "three";
import type { ParEffPath, ParSystem } from "@/types/effect-v2";
import type { Particle } from "./useParticleLifecycle";
import {
  computeRangeSpawnPosition as computeGenericRangeSpawnPosition,
  withEmitterPosition,
} from "./particlePlacement";

export interface Range2SpawnState {
  dir: THREE.Vector3;
  pos: THREE.Vector3;
}

export interface Range2RuntimeState {
  curTime: number;
  stopped: boolean;
  completed: boolean;
}

export interface EffPathRuntimeState {
  curFrame: number;
  curDist: number;
  curPos: THREE.Vector3;
  ended: boolean;
}

export function computeRangeSpawnPosition(
  system: ParSystem,
  random: () => number = Math.random,
): THREE.Vector3 {
  return computeGenericRangeSpawnPosition(system, random);
}

export function computeRange2SpawnState(
  system: ParSystem,
  random: () => number = Math.random,
): Range2SpawnState {
  const pkoDir = new THREE.Vector3(
    system.direction[0],
    system.direction[1],
    system.direction[2],
  );
  if (pkoDir.lengthSq() > 0) pkoDir.normalize();

  const pkoPos = new THREE.Vector3(
    system.offset[0] - system.range[0] / 2 + random() * system.range[0],
    system.offset[1] - system.range[1] / 2 + random() * system.range[1],
    system.offset[2] - system.range[2] / 2 + system.range[2],
  );

  return {
    dir: pkoDir,
    pos: pkoPos,
  };
}

export function computeRange2MovementDelta(
  system: ParSystem,
  dir: THREE.Vector3,
  dt: number,
): THREE.Vector3 {
  return dir.clone().multiplyScalar(system.velocity * dt);
}

export function initRangeParticle(p: Particle, _i: number, system: ParSystem): void {
  p.dir.set(0, 0, 0);
  p.accel.set(0, 0, 0);
  p.pos.copy(computeRangeSpawnPosition(system));
}

export function moveRangeParticle(_p: Particle, _i: number, _dt: number): void {
  // C++ _FrameMoveRange pins each particle to oldPos + pPart->_vPos.
}

export function createRangeParticles(
  system: ParSystem,
  random: () => number = Math.random,
  emitterPosition?: THREE.Vector3 | null,
): Particle[] {
  const particles: Particle[] = [];
  for (let i = 0; i < system.particleCount; i++) {
    const rangeLocalPos = computeRangeSpawnPosition(system, random);
    const pos = withEmitterPosition(rangeLocalPos, emitterPosition?.clone());
    particles.push({
      alive: true,
      pos,
      dir: new THREE.Vector3(),
      accel: new THREE.Vector3(),
      size: system.frameSizes[0] ?? 1,
      color: new THREE.Color(1, 1, 1),
      alpha: 1,
      angle: new THREE.Vector3(),
      index: i,
      curFrame: 0,
      curTime: 0,
      frameTime: 0,
      life: 0,
      elapsed: 0,
      custom: { rangeLocalPos: rangeLocalPos.clone() },
    });
  }
  return particles;
}

export function updateRangeParticlePositions(
  particles: Particle[],
  emitterPosition?: THREE.Vector3 | null,
  pathOffset?: THREE.Vector3 | null,
  pathDirection?: THREE.Vector3 | null,
): void {
  for (const p of particles) {
    const rangeLocalPos = p.custom?.rangeLocalPos;
    if (!rangeLocalPos) continue;
    p.pos.copy(withEmitterPosition(rangeLocalPos, emitterPosition?.clone()));
    if (pathOffset) p.pos.add(pathOffset);
    if (pathDirection) p.dir.copy(pathDirection);
  }
}

export function createEffPathRuntimeState(path?: ParEffPath | null): EffPathRuntimeState {
  return {
    curFrame: 0,
    curDist: 0,
    curPos: pathVector(path?.points[0]),
    ended: false,
  };
}

export function advanceEffPathRuntimeState(
  state: EffPathRuntimeState,
  path: ParEffPath | null | undefined,
  dt: number,
): void {
  if (!path || path.points.length <= 0) return;
  if (path.points.length === 1 || path.distances.length === 0) {
    state.curFrame = 0;
    state.curDist = 0;
    state.curPos.copy(pathVector(path.points[0]));
    state.ended = false;
    return;
  }

  state.ended = false;
  state.curDist += path.velocity * dt;

  let guard = 0;
  while (state.curDist >= safePathDistance(path, state.curFrame) && guard < path.distances.length + 1) {
    state.curDist -= safePathDistance(path, state.curFrame);
    state.curFrame++;
    if (state.curFrame >= path.points.length - 1) {
      state.curFrame = 0;
      state.ended = true;
    }
    guard++;
  }

  const point = pathVector(path.points[state.curFrame]);
  const direction = pathVector(path.directions[state.curFrame] ?? [0, 0, 0]);
  state.curPos.copy(point.addScaledVector(direction, state.curDist));
}

export function computeEffPathRangeDirection(
  state: EffPathRuntimeState,
  path: ParEffPath | null | undefined,
): THREE.Vector3 | null {
  if (!path || path.points.length <= 1) return null;

  const previousPoint = state.curFrame > 0
    ? pathVector(path.points[state.curFrame - 1])
    : pathVector(path.points[state.curFrame]);
  const direction = state.curPos.clone().sub(previousPoint);
  if (direction.lengthSq() <= 0.000001) {
    const fallback = pathVector(path.directions[state.curFrame] ?? path.directions[0]);
    return fallback.lengthSq() > 0.000001 ? fallback : null;
  }
  return direction;
}

function pathVector(value: [number, number, number] | undefined): THREE.Vector3 {
  return new THREE.Vector3(value?.[0] ?? 0, value?.[1] ?? 0, value?.[2] ?? 0);
}

function safePathDistance(path: ParEffPath, frame: number): number {
  const value = path.distances[frame] ?? Number.POSITIVE_INFINITY;
  return value > 0 ? value : Number.POSITIVE_INFINITY;
}

export function createRange2RuntimeState(): Range2RuntimeState {
  return {
    curTime: 0,
    stopped: false,
    completed: false,
  };
}

export function createRange2Particles(system: ParSystem): Particle[] {
  const particles: Particle[] = [];
  for (let i = 0; i < system.particleCount; i++) {
    particles.push({
      alive: false,
      pos: new THREE.Vector3(),
      dir: new THREE.Vector3(),
      accel: new THREE.Vector3(),
      size: 0,
      color: new THREE.Color(0, 0, 0),
      alpha: 0,
      angle: new THREE.Vector3(),
      index: i,
      curFrame: 0,
      curTime: 0,
      frameTime: 0,
      life: 0,
      elapsed: 0,
      custom: {},
    });
  }
  return particles;
}

export function initRange2Particle(
  p: Particle,
  _i: number,
  system: ParSystem,
  random: () => number = Math.random,
  emitterPosition?: THREE.Vector3 | null,
): void {
  const state = computeRange2SpawnState(system, random);
  const pos = emitterPosition ? state.pos.clone().add(emitterPosition) : state.pos;
  p.dir.copy(state.dir);
  p.accel.set(0, 0, 0);
  p.pos.copy(pos);
  p.alive = true;
  p.size = system.frameSizes[0] ?? 1;
  p.color.setRGB(1, 1, 1);
  p.alpha = 1;
  p.curFrame = 0;
  p.curTime = 0;
  p.elapsed = 0;
}

export function moveRange2Particle(p: Particle, _i: number, dt: number, system: ParSystem): void {
  p.pos.add(computeRange2MovementDelta(system, p.dir, dt));
  if (p.pos.z < 0 || p.pos.z > 50) {
    p.alive = false;
  }
}

export function stepRange2Particles(
  particles: Particle[],
  runtime: Range2RuntimeState,
  system: ParSystem,
  dt: number,
  random: () => number = Math.random,
  emitterPosition?: THREE.Vector3 | null,
  onHitEffect?: (particleEffectName: string, position: THREE.Vector3, sourceDirection?: THREE.Vector3) => void,
): void {
  if (runtime.completed || particles.length === 0) return;

  particles[0].life += dt;
  if (particles[0].life > system.life) {
    runtime.stopped = true;
  }

  let hadLiveAtFrameStart = false;

  for (const p of particles) {
    if (p.alive) {
      hadLiveAtFrameStart = true;
      const wasAlive = p.alive;
      p.elapsed += dt;
      moveRange2Particle(p, p.index, dt, system);
      if (wasAlive && !p.alive && system.hitEffect.trim()) {
        onHitEffect?.(system.hitEffect, p.pos, p.dir);
      }
      p.size = system.frameSizes[0] ?? 1;
      p.color.setRGB(1, 1, 1);
      p.alpha = 1;
    } else if (!runtime.stopped) {
      runtime.curTime += dt;
      if (runtime.curTime >= system.step) {
        runtime.curTime = 0;
        initRange2Particle(p, p.index, system, random, emitterPosition);
      }
    }
  }

  if (runtime.stopped && !hadLiveAtFrameStart) {
    runtime.completed = true;
  }
}
