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
  ages: Float32Array;
  lifetimes: Float32Array;
  alive: Uint8Array;
  /** Per-particle random seed for deterministic variation. */
  seeds: Float32Array;
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
    ages: new Float32Array(MAX_PARTICLES),
    lifetimes: new Float32Array(MAX_PARTICLES),
    alive: new Uint8Array(MAX_PARTICLES),
    seeds: new Float32Array(MAX_PARTICLES),
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
  pool.ages.fill(0);
  pool.lifetimes.fill(0);
  pool.alive.fill(0);
  pool.seeds.fill(0);
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

  // Type-specific velocity
  const vel = sys.velocity;
  const dir = sys.direction;

  switch (sys.type) {
    case PARTICLE_TYPE.FIRE: {
      const spread = 0.3;
      pool.velocities[i3] = dir[0] * vel + (Math.random() - 0.5) * spread * vel;
      pool.velocities[i3 + 1] = dir[1] * vel + Math.random() * 0.2 * vel;
      pool.velocities[i3 + 2] = dir[2] * vel + (Math.random() - 0.5) * spread * vel;
      break;
    }
    case PARTICLE_TYPE.BLAST:
    case PARTICLE_TYPE.BLAST2:
    case PARTICLE_TYPE.BLAST3: {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      pool.velocities[i3] = Math.sin(phi) * Math.cos(theta) * vel;
      pool.velocities[i3 + 1] = Math.sin(phi) * Math.sin(theta) * vel;
      pool.velocities[i3 + 2] = Math.cos(phi) * vel;
      break;
    }
    case PARTICLE_TYPE.SNOW: {
      pool.velocities[i3] = (Math.random() - 0.5) * 0.2;
      pool.velocities[i3 + 1] = -vel;
      pool.velocities[i3 + 2] = (Math.random() - 0.5) * 0.2;
      break;
    }
    case PARTICLE_TYPE.ROUND: {
      const angle = Math.random() * Math.PI * 2;
      const radius = 0.5 + Math.random() * 0.5;
      pool.positions[i3] += Math.cos(angle) * radius;
      pool.positions[i3 + 2] += Math.sin(angle) * radius;
      pool.velocities[i3] = -Math.sin(angle) * vel;
      pool.velocities[i3 + 1] = dir[1] * vel * 0.1;
      pool.velocities[i3 + 2] = Math.cos(angle) * vel;
      break;
    }
    case PARTICLE_TYPE.LINE_SINGLE: {
      pool.velocities[i3] = dir[0] * vel;
      pool.velocities[i3 + 1] = dir[1] * vel;
      pool.velocities[i3 + 2] = dir[2] * vel;
      break;
    }
    default: {
      pool.velocities[i3] = dir[0] * vel + (Math.random() - 0.5) * 0.1;
      pool.velocities[i3 + 1] = dir[1] * vel + (Math.random() - 0.5) * 0.1;
      pool.velocities[i3 + 2] = dir[2] * vel + (Math.random() - 0.5) * 0.1;
      break;
    }
  }

  // Initial color/size from first keyframe
  const c = lerpFrameValue(sys.frameColors, 0) as Vec4;
  pool.colors[i3] = c[0];
  pool.colors[i3 + 1] = c[1];
  pool.colors[i3 + 2] = c[2];
  pool.alphas[slot] = c[3];
  pool.sizes[slot] = lerpFrameValue(sys.frameSizes, 0) as number;
  pool.count++;
}

/** Advance all alive particles by delta seconds. */
export function stepParticles(pool: ParticlePool, sys: ParticleSystem, delta: number) {
  for (let i = 0; i < MAX_PARTICLES; i++) {
    if (!pool.alive[i]) continue;

    pool.ages[i] += delta;

    // Kill expired
    if (pool.ages[i] >= pool.lifetimes[i]) {
      pool.alive[i] = 0;
      pool.sizes[i] = 0;
      pool.alphas[i] = 0;
      pool.count--;
      continue;
    }

    const i3 = i * 3;
    const t = pool.ages[i] / pool.lifetimes[i];

    // Apply acceleration
    pool.velocities[i3] += sys.acceleration[0] * delta;
    pool.velocities[i3 + 1] += sys.acceleration[1] * delta;
    pool.velocities[i3 + 2] += sys.acceleration[2] * delta;

    // Type-specific per-frame behavior
    if (sys.type === PARTICLE_TYPE.SNOW) {
      const seed = pool.seeds[i];
      pool.positions[i3] += Math.sin(pool.ages[i] * 3 + seed * 10) * 0.01;
    }

    // Integrate position
    pool.positions[i3] += pool.velocities[i3] * delta;
    pool.positions[i3 + 1] += pool.velocities[i3 + 1] * delta;
    pool.positions[i3 + 2] += pool.velocities[i3 + 2] * delta;

    // Interpolate frame animation
    const c = lerpFrameValue(sys.frameColors, t) as Vec4;
    pool.colors[i3] = c[0];
    pool.colors[i3 + 1] = c[1];
    pool.colors[i3 + 2] = c[2];
    pool.alphas[i] = c[3];
    pool.sizes[i] = lerpFrameValue(sys.frameSizes, t) as number;
  }
}

/**
 * Run one full tick of the particle system: emit + step.
 * Returns the number of particles spawned.
 */
export function tickPool(pool: ParticlePool, sys: ParticleSystem, delta: number): number {
  pool.elapsed += delta;

  if (pool.elapsed < sys.delayTime) return 0;

  let spawned = 0;
  pool.emitAccum += delta;
  const step = Math.max(sys.step, 0.001);
  while (pool.emitAccum >= step && pool.count < sys.particleCount) {
    spawnParticle(pool, sys);
    pool.emitAccum -= step;
    spawned++;
  }
  pool.emitAccum = Math.min(pool.emitAccum, step);

  stepParticles(pool, sys, delta);
  return spawned;
}
