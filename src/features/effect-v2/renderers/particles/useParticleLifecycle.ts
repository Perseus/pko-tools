import { useRef } from "react";
import type { MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ParSystem } from "@/types/effect-v2";
import { useTimeSource } from "../../TimeContext";
import { lerp, randfRange } from "../../helpers";
import { withEmitterPosition } from "./particlePlacement";
import { useParticleSystemPathOffset } from "./useParticleSystemPathOffset";

/**
 * Per-particle mutable state.
 * Fields like size, color, alpha, angle are interpolated outputs from system keyframes —
 * they are written by the lifecycle hook each frame, not set by the system type.
 */
export interface Particle {
  alive: boolean;
  pos: THREE.Vector3;
  /** Velocity/direction vector — per-particle, mutable (acceleration modifies it). */
  dir: THREE.Vector3;
  accel: THREE.Vector3;
  /** Interpolated size output from frameSizes keyframes. */
  size: number;
  color: THREE.Color;
  alpha: number;
  /** Interpolated Euler rotation output from frameAngles keyframes. */
  angle: THREE.Vector3;
  /** Particle index within the system (immutable after spawn). */
  index: number;
  curFrame: number;
  /** Time elapsed within current frame segment (0 to frameTime). */
  curTime: number;
  /** Seconds per frame segment = life / frameCount. */
  frameTime: number;
  /** This particle's total lifetime in seconds (randomized at spawn). */
  life: number;
  /** Total time this particle has been alive. Drives nested TimeProvider for sub-effects. */
  elapsed: number;
  /** Type-specific parity state for particle paths that reuse C++ fields as scratch storage. */
  custom?: {
    blast2Anchor?: THREE.Vector3;
    rangeLocalPos?: THREE.Vector3;
  };
}

export type FrameEndBehavior = "kill" | "reset";
export type LastFrameNextMode = "hold" | "wrap";
export type FinitePlayTimeStopBehavior = "clear" | "drain";
const MAX_PARTICLE_TIMELINE_STEP = 0.05;

interface ParticleFrameState {
  alive: boolean;
  curFrame: number;
  curTime: number;
  frameTime: number;
}

export interface ParticleFrameAdvanceResult {
  skipFrameOutputs?: boolean;
  skipMove?: boolean;
}

export interface ParticleTimelineAdvanceSteps {
  reset: boolean;
  steps: number[];
  nextLastTime: number;
}

export interface UseParticleLifecycleOptions {
  system: ParSystem;
  loop?: boolean;
  frameEndBehavior?: FrameEndBehavior;
  lastFrameNext?: LastFrameNextMode;
  /** When false, particles start dormant and must be emitted by respawnDeadParticles. */
  spawnOnCreate?: boolean;
  /** C++ _Create* dead-slot emitter mode. Adds dt to a shared _fCurTime for each dead slot. */
  respawnDeadParticles?: boolean;
  /** Initial value for the shared step accumulator. Ripple starts with _fCurTime = _fStep. */
  initialSpawnAccumulator?: number;
  /** C++ Stop() behavior when finite playTime expires. Snow/Fire/Shrink drain live particles. */
  finitePlayTimeStopBehavior?: FinitePlayTimeStopBehavior;
  /** Some source frame movers ignore _bLoop and clear _bPlay at end-of-life. */
  restartOnLoop?: boolean;
  /** Called once per particle at spawn. Set pos/dir/accel here. */
  initParticle: (p: Particle, index: number, system: ParSystem) => void;
  /** Optional source-specific frame advancement override. */
  advanceFrame?: (
    p: Particle,
    dt: number,
    frameCount: number,
    frameEndBehavior: FrameEndBehavior,
  ) => ParticleFrameAdvanceResult;
  /** Called per-particle per-frame AFTER frame interpolation. Update pos here. */
  moveParticle: (
    p: Particle,
    index: number,
    dt: number,
    system: ParSystem,
    pathOffset?: THREE.Vector3 | null,
  ) => void;
  /** Runtime CMPPartCtrl::MoveTo emitter position. Applied to newly spawned particles. */
  emitterPositionRef?: MutableRefObject<THREE.Vector3 | null>;
  /** Shared CMPModelEff clock for non-mediaY nested .eff visuals. */
  sharedEffectElapsedRef?: MutableRefObject<number>;
  onComplete?: () => void;
}

export function advanceSteppedSpawnAccumulator(
  current: number,
  dt: number,
  step: number,
): { next: number; shouldSpawn: boolean } {
  const next = current + dt;
  if (next < step) return { next, shouldSpawn: false };
  return { next: 0, shouldSpawn: true };
}

function roundTimelineStep(value: number): number {
  return Math.round(value * 1_000_000_000_000) / 1_000_000_000_000;
}

export function getParticleTimelineAdvanceSteps(
  previousTime: number,
  currentTime: number,
  maxStep = MAX_PARTICLE_TIMELINE_STEP,
): ParticleTimelineAdvanceSteps {
  const safePrevious = Number.isFinite(previousTime) ? Math.max(0, previousTime) : 0;
  const safeCurrent = Number.isFinite(currentTime) ? Math.max(0, currentTime) : safePrevious;
  const reset = safeCurrent < safePrevious;
  const startTime = reset ? 0 : safePrevious;
  let remaining = roundTimelineStep(safeCurrent - startTime);

  if (remaining <= 0) {
    return { reset, steps: [], nextLastTime: safeCurrent };
  }

  if (maxStep <= 0) {
    return { reset, steps: [remaining], nextLastTime: safeCurrent };
  }

  const steps: number[] = [];
  while (remaining > 0) {
    const step = roundTimelineStep(Math.min(maxStep, remaining));
    steps.push(step);
    remaining = roundTimelineStep(remaining - step);
  }

  return { reset, steps, nextLastTime: safeCurrent };
}

export function isParticlePlayTimeExpired(
  elapsed: number,
  playTime: number,
  delayTime: number,
  loop?: boolean,
): boolean {
  if (loop || playTime <= 0) return false;
  if (delayTime > 0 && elapsed < delayTime) return false;
  return elapsed >= playTime;
}

export function isParticleRenderVisibleAtTime(
  elapsed: number,
  playTime: number,
  delayTime: number,
  loop?: boolean,
): boolean {
  if (elapsed < delayTime) return false;
  return !isParticlePlayTimeExpired(elapsed, playTime, delayTime, loop);
}

export function advanceParticleFrame(
  p: ParticleFrameState,
  dt: number,
  frameCount: number,
  frameEndBehavior: FrameEndBehavior,
  frameTime = p.frameTime,
): void {
  p.curTime += dt;
  if (frameTime <= 0 || p.curTime < frameTime) return;

  p.curFrame++;
  p.curTime = 0;
  if (p.curFrame < frameCount) return;

  if (frameEndBehavior === "reset") {
    p.alive = true;
    p.curFrame = 0;
  } else {
    p.alive = false;
  }
}

export function getParticleFramePair(
  curFrame: number,
  frameCount: number,
  lastFrameNext: LastFrameNextMode,
): { cur: number; next: number } {
  if (frameCount <= 0) return { cur: 0, next: 0 };
  if (curFrame >= frameCount - 1) {
    return { cur: curFrame, next: lastFrameNext === "wrap" ? 0 : curFrame };
  }
  return { cur: curFrame, next: curFrame + 1 };
}

function resetParticleTiming(p: Particle, system: ParSystem): void {
  const minLife = system.life / Math.max(system.randomMode, 1);
  const life = randfRange(minLife, system.life);

  p.alive = true;
  p.size = system.frameSizes[0] ?? 1;
  p.color.setRGB(1, 1, 1);
  p.alpha = 1;
  p.angle.set(0, 0, 0);
  p.curFrame = 0;
  p.curTime = 0;
  p.frameTime = system.frameCount > 0 ? life / system.frameCount : life;
  p.life = life;
  p.elapsed = 0;
  p.custom = {};
}

function createDormantParticle(index: number, system: ParSystem): Particle {
  const minLife = system.life / Math.max(system.randomMode, 1);
  const life = randfRange(minLife, system.life);

  return {
    alive: false,
    pos: new THREE.Vector3(),
    dir: new THREE.Vector3(),
    accel: new THREE.Vector3(),
    size: system.frameSizes[0] ?? 1,
    color: new THREE.Color(1, 1, 1),
    alpha: 1,
    angle: new THREE.Vector3(),
    index,
    curFrame: 0,
    curTime: 0,
    frameTime: system.frameCount > 0 ? life / system.frameCount : life,
    life,
    elapsed: 0,
    custom: {},
  };
}

function spawnParticle(
  p: Particle,
  system: ParSystem,
  initParticle: UseParticleLifecycleOptions["initParticle"],
  emitterPositionRef?: UseParticleLifecycleOptions["emitterPositionRef"],
  pathOffset?: THREE.Vector3 | null,
): void {
  resetParticleTiming(p, system);
  p.pos.set(0, 0, 0);
  p.dir.set(0, 0, 0);
  p.accel.set(0, 0, 0);
  initParticle(p, p.index, system);
  p.pos.copy(withEmitterPosition(p.pos, emitterPositionRef?.current));
  if (pathOffset) p.pos.add(pathOffset);
}

function createParticles(
  count: number,
  system: ParSystem,
  initParticle: UseParticleLifecycleOptions["initParticle"],
  emitterPositionRef?: UseParticleLifecycleOptions["emitterPositionRef"],
  spawnOnCreate = true,
  pathOffset?: THREE.Vector3 | null,
): Particle[] {
  const particles: Particle[] = [];

  for (let i = 0; i < count; i++) {
    const p = createDormantParticle(i, system);
    if (spawnOnCreate) {
      spawnParticle(p, system, initParticle, emitterPositionRef, pathOffset);
    }
    particles.push(p);
  }
  return particles;
}

/**
 * Shared particle lifecycle engine.
 *
 * Handles the common GetCurFrame-style particle loop: frame advancement,
 * size/color/angle interpolation, death detection, delayTime gating, and loop restart.
 * Systems with source-specific emission/lifetime loops, such as Range2, use their own driver.
 *
 * Matches the C++ GetCurFrame/GetLerpValue/frameSize interpolation pattern from MPParticleSys.cpp.
 *
 * NOTE: The returned ref is mutated imperatively by useFrame without triggering React re-renders.
 * Consumers that render JSX based on particle state (e.g., mapping alive particles to components)
 * see updates on the next parent/workbench render.
 */
export function useParticleLifecycle({
  system,
  loop,
  frameEndBehavior = "kill",
  lastFrameNext = "hold",
  spawnOnCreate = true,
  respawnDeadParticles = false,
  initialSpawnAccumulator = 0,
  finitePlayTimeStopBehavior = "clear",
  restartOnLoop = true,
  initParticle,
  advanceFrame,
  moveParticle,
  emitterPositionRef,
  sharedEffectElapsedRef,
  onComplete,
}: UseParticleLifecycleOptions): React.MutableRefObject<Particle[]> {
  const timeSource = useTimeSource();
  const getPathOffset = useParticleSystemPathOffset(system);

  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const particlesRef = useRef<Particle[]>([]);
  const completedRef = useRef(false);
  const spawnAccumulatorRef = useRef(initialSpawnAccumulator);
  const lastTimelineTimeRef = useRef(0);
  const finiteStopReachedRef = useRef(false);

  // System-level delay tracking.
  // Spawn happens inside useFrame (not render phase) to avoid running
  // Math.random() during render and to behave correctly under Strict Mode.
  const systemElapsedRef = useRef(0);
  const spawnedRef = useRef(false);

  const resetLifecycleState = () => {
    particlesRef.current = [];
    completedRef.current = false;
    spawnAccumulatorRef.current = initialSpawnAccumulator;
    systemElapsedRef.current = 0;
    spawnedRef.current = false;
    finiteStopReachedRef.current = false;
    if (sharedEffectElapsedRef) sharedEffectElapsedRef.current = 0;
  };

  const advanceLifecycleStep = (dt: number) => {
    const previousSystemElapsed = systemElapsedRef.current;
    systemElapsedRef.current += dt;
    let activeDt = dt;

    if (!finiteStopReachedRef.current && isParticlePlayTimeExpired(
      systemElapsedRef.current,
      system.playTime,
      system.delayTime,
      loop,
    )) {
      if (finitePlayTimeStopBehavior === "drain") {
        finiteStopReachedRef.current = true;
        if (particlesRef.current.length === 0) {
          if (!completedRef.current) {
            completedRef.current = true;
            onCompleteRef.current?.();
          }
          return;
        }
      } else {
        particlesRef.current = [];
        if (!completedRef.current) {
          completedRef.current = true;
          onCompleteRef.current?.();
        }
        return;
      }
    }

    let pathOffset: THREE.Vector3 | null = null;

    // Spawn gate: wait for delayTime (or spawn immediately on first tick if no delay)
    if (!spawnedRef.current) {
      if (system.delayTime > 0 && systemElapsedRef.current < system.delayTime) {
        return;
      }
      if (system.delayTime > 0 && previousSystemElapsed < system.delayTime) {
        activeDt = Math.max(0, systemElapsedRef.current - system.delayTime);
        if (activeDt <= 0) {
          return;
        }
      }

      pathOffset = getPathOffset(activeDt);
      particlesRef.current = createParticles(
        system.particleCount,
        system,
        initParticle,
        emitterPositionRef,
        spawnOnCreate,
        pathOffset,
      );
      if (sharedEffectElapsedRef) sharedEffectElapsedRef.current = 0;
      spawnedRef.current = true;
    } else {
      pathOffset = getPathOffset(activeDt);
    }

    if (sharedEffectElapsedRef) {
      sharedEffectElapsedRef.current += activeDt;
    }

    let deadCount = 0;

    for (const p of particlesRef.current) {
      if (!p.alive) {
        if (respawnDeadParticles && !finiteStopReachedRef.current) {
          const stepped = advanceSteppedSpawnAccumulator(spawnAccumulatorRef.current, activeDt, system.step);
          spawnAccumulatorRef.current = stepped.next;
          if (stepped.shouldSpawn) {
            spawnParticle(p, system, initParticle, emitterPositionRef, pathOffset);
            continue;
          }
        }

        deadCount++;
        continue;
      }

      // Track total time alive (for nested TimeProvider)
      p.elapsed += activeDt;

      // --- Frame advancement (matches C++ GetCurFrame) ---
      // Sub-frame remainder is intentionally discarded on frame advance (reset to 0),
      // matching the original C++ behavior where GetCurFrame resets m_fCurTime = 0.
      const frameAdvance = advanceFrame?.(p, activeDt, system.frameCount, frameEndBehavior) ?? {};
      if (!advanceFrame) {
        advanceParticleFrame(p, activeDt, system.frameCount, frameEndBehavior);
      }
      if (!p.alive) {
        deadCount++;
        continue;
      }

      // --- Interpolation (matches C++ _FrameMoveBlast pattern) ---
      if (!frameAdvance.skipFrameOutputs) {
        const { cur, next } = getParticleFramePair(p.curFrame, system.frameCount, lastFrameNext);
        const fLerp = p.frameTime > 0 ? p.curTime / p.frameTime : 0;

        // Size
        if (system.frameSizes.length > cur) {
          const s0 = system.frameSizes[cur];
          const s1 = system.frameSizes[next] ?? s0;
          p.size = lerp(s0, s1, fLerp);
        }

        // Color + alpha
        if (system.frameColors.length > cur) {
          const cc = system.frameColors[cur];
          const nc = system.frameColors[next] ?? cc;
          p.color.setRGB(
            lerp(cc[0], nc[0], fLerp),
            lerp(cc[1], nc[1], fLerp),
            lerp(cc[2], nc[2], fLerp),
          );
          p.alpha = lerp(cc[3], nc[3], fLerp);
        }

        // Angle
        if (system.frameAngles.length > cur) {
          const ca = system.frameAngles[cur];
          const na = system.frameAngles[next] ?? ca;
          p.angle.set(
            lerp(ca[0], na[0], fLerp),
            lerp(ca[1], na[1], fLerp),
            lerp(ca[2], na[2], fLerp),
          );
        }
      }

      // --- Type-specific position update ---
      if (!frameAdvance.skipMove) {
        moveParticle(p, p.index, activeDt, system, pathOffset);
      }
    }

    // All dead?
    if (deadCount >= particlesRef.current.length && particlesRef.current.length > 0) {
      if (loop && restartOnLoop && !finiteStopReachedRef.current) {
        particlesRef.current = createParticles(
          system.particleCount,
          system,
          initParticle,
          emitterPositionRef,
          spawnOnCreate,
          pathOffset,
        );
        spawnAccumulatorRef.current = initialSpawnAccumulator;
      } else if (respawnDeadParticles && !finiteStopReachedRef.current) {
        // Continuous C++ dead-slot emitters keep waiting for the next _fStep spawn until Stop() is called.
      } else if (!completedRef.current) {
        completedRef.current = true;
        onCompleteRef.current?.();
      }
    }
  };

  useFrame(() => {
    const timeline = getParticleTimelineAdvanceSteps(
      lastTimelineTimeRef.current,
      timeSource.getTime(),
    );

    if (timeline.reset) {
      resetLifecycleState();
    }

    if (timeline.steps.length === 0) {
      if (!spawnedRef.current && timeline.nextLastTime === 0) {
        advanceLifecycleStep(0);
      }
      lastTimelineTimeRef.current = timeline.nextLastTime;
      return;
    }

    for (const dt of timeline.steps) {
      advanceLifecycleStep(dt);
    }
    lastTimelineTimeRef.current = timeline.nextLastTime;
  });

  return particlesRef;
}
