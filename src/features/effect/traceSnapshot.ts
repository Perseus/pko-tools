/**
 * State trace recording for deterministic replay comparison.
 * Captures material state, particle count, positions, colors at regular intervals.
 * Modeled after pko-map-lab's parityHarness.js.
 */
import type { ParticlePool } from "@/features/effect/particle/particlePool";
import { countAlive } from "@/features/effect/particle/particlePool";

export interface TraceFrame {
  /** Elapsed time in seconds. */
  time: number;
  /** Number of alive particles. */
  aliveCount: number;
  /** First 3 alive particle positions (for deterministic comparison). */
  samplePositions: [number, number, number][];
  /** First 3 alive particle colors. */
  sampleColors: [number, number, number][];
  /** First 3 alive particle sizes. */
  sampleSizes: number[];
}

export interface TraceSession {
  /** Ordered frames sampled during playback. */
  frames: TraceFrame[];
  /** Interval between samples (seconds). */
  sampleInterval: number;
}

/** Sample a snapshot from a particle pool at the current moment. */
export function sampleTraceFrame(pool: ParticlePool, time: number): TraceFrame {
  const alive = countAlive(pool);
  const positions: [number, number, number][] = [];
  const colors: [number, number, number][] = [];
  const sizes: number[] = [];

  for (let i = 0; i < pool.alive.length && positions.length < 3; i++) {
    if (!pool.alive[i]) continue;
    const i3 = i * 3;
    positions.push([pool.positions[i3], pool.positions[i3 + 1], pool.positions[i3 + 2]]);
    colors.push([pool.colors[i3], pool.colors[i3 + 1], pool.colors[i3 + 2]]);
    sizes.push(pool.sizes[i]);
  }

  return {
    time,
    aliveCount: alive,
    samplePositions: positions,
    sampleColors: colors,
    sampleSizes: sizes,
  };
}

/** Compare two trace sessions and return frame-by-frame differences. */
export function diffTraceSessions(
  a: TraceSession,
  b: TraceSession,
): { frameIndex: number; field: string; aValue: unknown; bValue: unknown }[] {
  const diffs: { frameIndex: number; field: string; aValue: unknown; bValue: unknown }[] = [];
  const len = Math.min(a.frames.length, b.frames.length);

  for (let i = 0; i < len; i++) {
    const fa = a.frames[i];
    const fb = b.frames[i];

    if (fa.aliveCount !== fb.aliveCount) {
      diffs.push({ frameIndex: i, field: "aliveCount", aValue: fa.aliveCount, bValue: fb.aliveCount });
    }

    // Compare sample positions with tolerance
    for (let j = 0; j < Math.min(fa.samplePositions.length, fb.samplePositions.length); j++) {
      for (let c = 0; c < 3; c++) {
        const diff = Math.abs(fa.samplePositions[j][c] - fb.samplePositions[j][c]);
        if (diff > 0.01) {
          diffs.push({
            frameIndex: i,
            field: `position[${j}][${c}]`,
            aValue: fa.samplePositions[j][c],
            bValue: fb.samplePositions[j][c],
          });
        }
      }
    }
  }

  if (a.frames.length !== b.frames.length) {
    diffs.push({
      frameIndex: len,
      field: "frameCount",
      aValue: a.frames.length,
      bValue: b.frames.length,
    });
  }

  return diffs;
}
