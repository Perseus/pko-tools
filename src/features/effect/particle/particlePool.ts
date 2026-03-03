import type { ParticleSystem } from "@/types/particle";
import { PARTICLE_TYPE } from "@/types/particle";
import type { Vec3, Vec4 } from "@/types/effect";

export const MAX_PARTICLES = 100;

/** Per-particle runtime state stored in typed arrays. */
export type ParticlePool = {
  positions: Float32Array;
  velocities: Float32Array;
  colors: Float32Array;
  sizes: Float32Array;
  alphas: Float32Array;
  /** Per-particle rotation (x, y, z) interpolated from frameAngles. */
  rotations: Float32Array;
  ages: Float32Array;
  lifetimes: Float32Array;
  alive: Uint8Array;
  /** Per-particle random seed for deterministic variation. */
  seeds: Float32Array;
  /** Per-particle spawn position (for types like WIND that need it). */
  spawnPositions: Float32Array;
  count: number;
  /** Accumulator for emission timing. */
  emitAccum: number;
  /** Global elapsed time. */
  elapsed: number;
};

export function createPool(): ParticlePool {
  return {
    positions: new Float32Array(MAX_PARTICLES * 3),
    velocities: new Float32Array(MAX_PARTICLES * 3),
    colors: new Float32Array(MAX_PARTICLES * 3),
    sizes: new Float32Array(MAX_PARTICLES),
    alphas: new Float32Array(MAX_PARTICLES),
    rotations: new Float32Array(MAX_PARTICLES * 3),
    ages: new Float32Array(MAX_PARTICLES),
    lifetimes: new Float32Array(MAX_PARTICLES),
    alive: new Uint8Array(MAX_PARTICLES),
    seeds: new Float32Array(MAX_PARTICLES),
    spawnPositions: new Float32Array(MAX_PARTICLES * 3),
    count: 0,
    emitAccum: 0,
    elapsed: 0,
  };
}

export function resetPool(pool: ParticlePool) {
  pool.positions.fill(0);
  pool.velocities.fill(0);
  pool.colors.fill(1);
  pool.sizes.fill(0);
  pool.alphas.fill(0);
  pool.rotations.fill(0);
  pool.ages.fill(0);
  pool.lifetimes.fill(0);
  pool.alive.fill(0);
  pool.seeds.fill(0);
  pool.spawnPositions.fill(0);
  pool.count = 0;
  pool.emitAccum = 0;
  pool.elapsed = 0;
}

/** Count alive particles in the pool. */
export function countAlive(pool: ParticlePool): number {
  let n = 0;
  for (let i = 0; i < MAX_PARTICLES; i++) {
    if (pool.alive[i]) n++;
  }
  return n;
}

/** Get the velocity of particle at index. */
export function getVelocity(pool: ParticlePool, index: number): Vec3 {
  const i3 = index * 3;
  return [pool.velocities[i3], pool.velocities[i3 + 1], pool.velocities[i3 + 2]];
}

/** Interpolate frame animation arrays by normalized progress t in [0,1]. */
export function lerpFrameValue<T extends number | Vec3 | Vec4>(
  frames: T[],
  t: number,
): T {
  if (frames.length === 0) return (typeof frames[0] === "number" ? 0 : [0, 0, 0]) as T;
  if (frames.length === 1) return frames[0];
  const scaled = t * (frames.length - 1);
  const lo = Math.floor(scaled);
  const hi = Math.min(lo + 1, frames.length - 1);
  const frac = scaled - lo;
  const a = frames[lo];
  const b = frames[hi];
  if (typeof a === "number" && typeof b === "number") {
    return (a + (b - a) * frac) as T;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.map((v, i) => v + ((b as number[])[i] - v) * frac) as T;
  }
  return a;
}

/** Find the first dead particle slot, or -1 if full. */
export function findDeadSlot(pool: ParticlePool): number {
  for (let i = 0; i < MAX_PARTICLES; i++) {
    if (!pool.alive[i]) return i;
  }
  return -1;
}

// ─── Per-type spawn functions ────────────────────────────────────────────

type SpawnFn = (pool: ParticlePool, slot: number, sys: ParticleSystem) => void;

function spawnDefault(pool: ParticlePool, slot: number, sys: ParticleSystem) {
  const i3 = slot * 3;
  const vel = sys.velocity;
  const dir = sys.direction;
  pool.velocities[i3] = dir[0] * vel + (Math.random() - 0.5) * 0.1;
  pool.velocities[i3 + 1] = dir[1] * vel + (Math.random() - 0.5) * 0.1;
  pool.velocities[i3 + 2] = dir[2] * vel + (Math.random() - 0.5) * 0.1;
}

function spawnFire(pool: ParticlePool, slot: number, sys: ParticleSystem) {
  const i3 = slot * 3;
  const vel = sys.velocity;
  const dir = sys.direction;
  const spread = 0.3;
  pool.velocities[i3] = dir[0] * vel + (Math.random() - 0.5) * spread * vel;
  pool.velocities[i3 + 1] = dir[1] * vel + Math.random() * 0.2 * vel;
  pool.velocities[i3 + 2] = dir[2] * vel + (Math.random() - 0.5) * spread * vel;
}

function spawnBlast(pool: ParticlePool, slot: number, sys: ParticleSystem) {
  const i3 = slot * 3;
  const vel = sys.velocity;
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  pool.velocities[i3] = Math.sin(phi) * Math.cos(theta) * vel;
  pool.velocities[i3 + 1] = Math.sin(phi) * Math.sin(theta) * vel;
  pool.velocities[i3 + 2] = Math.cos(phi) * vel;
}

function spawnSnow(pool: ParticlePool, slot: number, sys: ParticleSystem) {
  const i3 = slot * 3;
  const vel = sys.velocity;
  pool.velocities[i3] = (Math.random() - 0.5) * 0.2;
  pool.velocities[i3 + 1] = -vel;
  pool.velocities[i3 + 2] = (Math.random() - 0.5) * 0.2;
}

function spawnRipple(pool: ParticlePool, slot: number, _sys: ParticleSystem) {
  // RIPPLE: no initial velocity, particles stay at origin. Pure scale animation.
  const i3 = slot * 3;
  pool.velocities[i3] = 0;
  pool.velocities[i3 + 1] = 0;
  pool.velocities[i3 + 2] = 0;
}

function spawnRound(pool: ParticlePool, slot: number, sys: ParticleSystem) {
  const i3 = slot * 3;
  const vel = sys.velocity;
  const dir = sys.direction;
  const angle = Math.random() * Math.PI * 2;
  const radius = 0.5 + Math.random() * 0.5;
  pool.positions[i3] += Math.cos(angle) * radius;
  pool.positions[i3 + 2] += Math.sin(angle) * radius;
  pool.velocities[i3] = -Math.sin(angle) * vel;
  pool.velocities[i3 + 1] = dir[1] * vel * 0.1;
  pool.velocities[i3 + 2] = Math.cos(angle) * vel;
}

function spawnWind(pool: ParticlePool, slot: number, sys: ParticleSystem) {
  // WIND: randomized position in range, stores vertical velocity.
  // Position already randomized in common spawn. Store spawn pos for spiral.
  const i3 = slot * 3;
  const vel = sys.velocity;
  pool.velocities[i3] = 0;
  pool.velocities[i3 + 1] = vel; // upward
  pool.velocities[i3 + 2] = 0;
  // Store spawn position for rotation reference
  pool.spawnPositions[i3] = pool.positions[i3];
  pool.spawnPositions[i3 + 1] = pool.positions[i3 + 1];
  pool.spawnPositions[i3 + 2] = pool.positions[i3 + 2];
}

function spawnArrow(pool: ParticlePool, slot: number, _sys: ParticleSystem) {
  // ARROW: single particle, fixed at offset position. No movement.
  const i3 = slot * 3;
  pool.velocities[i3] = 0;
  pool.velocities[i3 + 1] = 0;
  pool.velocities[i3 + 2] = 0;
}

function spawnShrink(pool: ParticlePool, slot: number, sys: ParticleSystem) {
  // SHRINK: like BLAST but can have directed or zero velocity
  const i3 = slot * 3;
  const vel = sys.velocity;
  const dir = sys.direction;
  const dirLen = Math.sqrt(dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]);
  if (dirLen > 0.001) {
    pool.velocities[i3] = dir[0] * vel;
    pool.velocities[i3 + 1] = dir[1] * vel;
    pool.velocities[i3 + 2] = dir[2] * vel;
  } else {
    // Spherical random like BLAST
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    pool.velocities[i3] = Math.sin(phi) * Math.cos(theta) * vel;
    pool.velocities[i3 + 1] = Math.sin(phi) * Math.sin(theta) * vel;
    pool.velocities[i3 + 2] = Math.cos(phi) * vel;
  }
}

function spawnLineSingle(pool: ParticlePool, slot: number, sys: ParticleSystem) {
  const i3 = slot * 3;
  const vel = sys.velocity;
  const dir = sys.direction;
  pool.velocities[i3] = dir[0] * vel;
  pool.velocities[i3 + 1] = dir[1] * vel;
  pool.velocities[i3 + 2] = dir[2] * vel;
}

function spawnLineRound(pool: ParticlePool, slot: number, sys: ParticleSystem) {
  // LINE_ROUND: circular layout, velocity tangential to circle
  const i3 = slot * 3;
  const vel = sys.velocity;
  const angle = Math.random() * Math.PI * 2;
  const radius = sys.range[0] > 0 ? sys.range[0] : 1.0;
  pool.positions[i3] += Math.cos(angle) * radius;
  pool.positions[i3 + 2] += Math.sin(angle) * radius;
  // Tangential velocity
  pool.velocities[i3] = -Math.sin(angle) * vel;
  pool.velocities[i3 + 1] = 0;
  pool.velocities[i3 + 2] = Math.cos(angle) * vel;
}

/** Per-type spawn dispatch table. */
const SPAWN_FN: Record<number, SpawnFn> = {
  [PARTICLE_TYPE.SNOW]: spawnSnow,
  [PARTICLE_TYPE.FIRE]: spawnFire,
  [PARTICLE_TYPE.BLAST]: spawnBlast,
  [PARTICLE_TYPE.RIPPLE]: spawnRipple,
  [PARTICLE_TYPE.MODEL]: spawnDefault,
  [PARTICLE_TYPE.STRIP]: spawnDefault,
  [PARTICLE_TYPE.WIND]: spawnWind,
  [PARTICLE_TYPE.ARROW]: spawnArrow,
  [PARTICLE_TYPE.ROUND]: spawnRound,
  [PARTICLE_TYPE.BLAST2]: spawnBlast,
  [PARTICLE_TYPE.BLAST3]: spawnBlast,
  [PARTICLE_TYPE.SHRINK]: spawnShrink,
  [PARTICLE_TYPE.SHADE]: spawnRipple, // SHADE spawns at center, no velocity
  [PARTICLE_TYPE.RANGE]: spawnRipple, // RANGE: scale-based, no velocity
  [PARTICLE_TYPE.RANGE2]: spawnRipple, // RANGE2: scale-based, no velocity
  [PARTICLE_TYPE.DUMMY]: spawnArrow, // DUMMY: static position
  [PARTICLE_TYPE.LINE_SINGLE]: spawnLineSingle,
  [PARTICLE_TYPE.LINE_ROUND]: spawnLineRound,
};

// ─── Per-type step functions ────────────────────────────────────────────

type StepFn = (pool: ParticlePool, i: number, sys: ParticleSystem, delta: number, t: number) => void;

function stepDefault(_pool: ParticlePool, _i: number, _sys: ParticleSystem, _delta: number, _t: number) {
  // Default: no additional per-frame behavior beyond acceleration + integration
}

function stepSnow(pool: ParticlePool, i: number, _sys: ParticleSystem, _delta: number, _t: number) {
  const i3 = i * 3;
  const seed = pool.seeds[i];
  pool.positions[i3] += Math.sin(pool.ages[i] * 3 + seed * 10) * 0.01;
}

function stepWind(pool: ParticlePool, i: number, sys: ParticleSystem, _delta: number, _t: number) {
  // WIND: accumulates angle.z rotation, swirling tornado motion around spawn pos
  const i3 = i * 3;
  const age = pool.ages[i];
  const vel = sys.velocity;
  const angleZ = vel * age; // accumulated rotation angle

  // Rotate acceleration offset around Z axis by accumulated angle
  const accelX = sys.acceleration[0];
  const accelZ = sys.acceleration[2];
  const cosA = Math.cos(angleZ);
  const sinA = Math.sin(angleZ);
  const rotX = accelX * cosA - accelZ * sinA;
  const rotZ = accelX * sinA + accelZ * cosA;

  // Position = spawn position + rotated offset scaled by time
  const scale = age * age; // quadratic growth
  pool.positions[i3] = pool.spawnPositions[i3] + rotX * scale;
  pool.positions[i3 + 2] = pool.spawnPositions[i3 + 2] + rotZ * scale;
  // Y position still integrates normally (upward motion)
}

function stepRipple(_pool: ParticlePool, _i: number, _sys: ParticleSystem, _delta: number, _t: number) {
  // RIPPLE: pure scale animation, no translation. Size handled by lerpFrameValue.
}

function stepArrow(_pool: ParticlePool, _i: number, _sys: ParticleSystem, _delta: number, _t: number) {
  // ARROW: static position, only frame-based animation (size/color).
}

/** Per-type step dispatch table. */
const STEP_FN: Record<number, StepFn> = {
  [PARTICLE_TYPE.SNOW]: stepSnow,
  [PARTICLE_TYPE.FIRE]: stepDefault,
  [PARTICLE_TYPE.BLAST]: stepDefault,
  [PARTICLE_TYPE.RIPPLE]: stepRipple,
  [PARTICLE_TYPE.MODEL]: stepDefault,
  [PARTICLE_TYPE.STRIP]: stepDefault,
  [PARTICLE_TYPE.WIND]: stepWind,
  [PARTICLE_TYPE.ARROW]: stepArrow,
  [PARTICLE_TYPE.ROUND]: stepDefault,
  [PARTICLE_TYPE.BLAST2]: stepDefault,
  [PARTICLE_TYPE.BLAST3]: stepDefault,
  [PARTICLE_TYPE.SHRINK]: stepDefault,
  [PARTICLE_TYPE.SHADE]: stepRipple, // SHADE: scale-based ground projection
  [PARTICLE_TYPE.RANGE]: stepRipple, // RANGE: scale-based radius
  [PARTICLE_TYPE.RANGE2]: stepRipple, // RANGE2: scale-based radius
  [PARTICLE_TYPE.DUMMY]: stepArrow, // DUMMY: static
  [PARTICLE_TYPE.LINE_SINGLE]: stepDefault,
  [PARTICLE_TYPE.LINE_ROUND]: stepDefault,
};

// ─── Public API ──────────────────────────────────────────────────────────

/** Spawn a single particle with type-specific initial conditions. */
export function spawnParticle(pool: ParticlePool, sys: ParticleSystem) {
  const slot = findDeadSlot(pool);
  if (slot === -1) return;

  const i3 = slot * 3;
  const seed = Math.random();
  pool.seeds[slot] = seed;
  pool.alive[slot] = 1;
  pool.ages[slot] = 0;
  pool.lifetimes[slot] = sys.life;

  // Random spawn position within range
  pool.positions[i3] = sys.offset[0] + (Math.random() - 0.5) * sys.range[0] * 2;
  pool.positions[i3 + 1] = sys.offset[1] + (Math.random() - 0.5) * sys.range[1] * 2;
  pool.positions[i3 + 2] = sys.offset[2] + (Math.random() - 0.5) * sys.range[2] * 2;

  // Type-specific spawn velocity/position
  const spawnFn = SPAWN_FN[sys.type] ?? spawnDefault;
  spawnFn(pool, slot, sys);

  // Initial color/size from first keyframe
  const c = lerpFrameValue(sys.frameColors, 0) as Vec4;
  pool.colors[i3] = c[0];
  pool.colors[i3 + 1] = c[1];
  pool.colors[i3 + 2] = c[2];
  pool.alphas[slot] = c[3];
  pool.sizes[slot] = lerpFrameValue(sys.frameSizes, 0) as number;
  pool.count++;
}

/** Optional callback when a particle dies and has a hitEffect set. */
export type OnParticleDeath = (position: Vec3, hitEffect: string) => void;

/** Advance all alive particles by delta seconds. */
export function stepParticles(
  pool: ParticlePool,
  sys: ParticleSystem,
  delta: number,
  onParticleDeath?: OnParticleDeath,
) {
  const stepFn = STEP_FN[sys.type] ?? stepDefault;
  const noTranslation =
    sys.type === PARTICLE_TYPE.RIPPLE ||
    sys.type === PARTICLE_TYPE.ARROW ||
    sys.type === PARTICLE_TYPE.SHADE ||
    sys.type === PARTICLE_TYPE.RANGE ||
    sys.type === PARTICLE_TYPE.RANGE2 ||
    sys.type === PARTICLE_TYPE.DUMMY;

  for (let i = 0; i < MAX_PARTICLES; i++) {
    if (!pool.alive[i]) continue;

    pool.ages[i] += delta;

    // Kill expired
    if (pool.ages[i] >= pool.lifetimes[i]) {
      // Hit effect callback: fire before killing the particle
      if (onParticleDeath && sys.hitEffect) {
        const i3d = i * 3;
        onParticleDeath(
          [pool.positions[i3d], pool.positions[i3d + 1], pool.positions[i3d + 2]],
          sys.hitEffect,
        );
      }
      pool.alive[i] = 0;
      pool.sizes[i] = 0;
      pool.alphas[i] = 0;
      pool.count--;
      continue;
    }

    const i3 = i * 3;
    const t = pool.ages[i] / pool.lifetimes[i];

    if (!noTranslation) {
      // Apply acceleration
      pool.velocities[i3] += sys.acceleration[0] * delta;
      pool.velocities[i3 + 1] += sys.acceleration[1] * delta;
      pool.velocities[i3 + 2] += sys.acceleration[2] * delta;
    }

    // Type-specific per-frame behavior
    stepFn(pool, i, sys, delta, t);

    if (!noTranslation) {
      // Integrate position
      pool.positions[i3] += pool.velocities[i3] * delta;
      pool.positions[i3 + 1] += pool.velocities[i3 + 1] * delta;
      pool.positions[i3 + 2] += pool.velocities[i3 + 2] * delta;
    }

    // Interpolate frame animation
    const c = lerpFrameValue(sys.frameColors, t) as Vec4;
    pool.colors[i3] = c[0];
    pool.colors[i3 + 1] = c[1];
    pool.colors[i3 + 2] = c[2];
    pool.alphas[i] = c[3];
    pool.sizes[i] = lerpFrameValue(sys.frameSizes, t) as number;

    // Interpolate rotation keyframes
    if (sys.frameAngles.length > 0) {
      const rot = lerpFrameValue(sys.frameAngles, t) as Vec3;
      pool.rotations[i3] = rot[0];
      pool.rotations[i3 + 1] = rot[1];
      pool.rotations[i3 + 2] = rot[2];
    }
  }
}

/**
 * Run one full tick of the particle system: emit + step.
 * Returns the number of particles spawned.
 */
export function tickPool(
  pool: ParticlePool,
  sys: ParticleSystem,
  delta: number,
  onParticleDeath?: OnParticleDeath,
): number {
  pool.elapsed += delta;

  if (pool.elapsed < sys.delayTime) return 0;

  // Phase 8: playTime emission cutoff
  const effectiveTime = pool.elapsed - sys.delayTime;
  const pastPlayTime = sys.playTime > 0 && effectiveTime > sys.playTime;

  let spawned = 0;
  if (!pastPlayTime) {
    pool.emitAccum += delta;
    const step = Math.max(sys.step, 0.001);
    while (pool.emitAccum >= step && pool.count < sys.particleCount) {
      spawnParticle(pool, sys);
      pool.emitAccum -= step;
      spawned++;
    }
    pool.emitAccum = Math.min(pool.emitAccum, step);
  }

  stepParticles(pool, sys, delta, onParticleDeath);
  return spawned;
}

// Export dispatch tables for test coverage verification
export { SPAWN_FN, STEP_FN };
