import { describe, expect, it } from "vitest";
import { sampleTraceFrame, diffTraceSessions, type TraceSession } from "@/features/effect/traceSnapshot";
import { createPool, spawnParticle, stepParticles } from "@/features/effect/particle/particlePool";
import { createDefaultParticleSystem } from "@/types/particle";

describe("traceSnapshot", () => {
  it("samples alive count and positions from pool", () => {
    const pool = createPool();
    const sys = createDefaultParticleSystem();
    spawnParticle(pool, sys);
    spawnParticle(pool, sys);

    const frame = sampleTraceFrame(pool, 0);
    expect(frame.aliveCount).toBe(2);
    expect(frame.samplePositions).toHaveLength(2);
    expect(frame.sampleColors).toHaveLength(2);
    expect(frame.sampleSizes).toHaveLength(2);
  });

  it("caps samples at 3 even with more alive particles", () => {
    const pool = createPool();
    const sys = createDefaultParticleSystem();
    for (let i = 0; i < 10; i++) spawnParticle(pool, sys);

    const frame = sampleTraceFrame(pool, 0.5);
    expect(frame.aliveCount).toBe(10);
    expect(frame.samplePositions).toHaveLength(3);
  });

  it("returns empty samples when pool is empty", () => {
    const pool = createPool();
    const frame = sampleTraceFrame(pool, 0);
    expect(frame.aliveCount).toBe(0);
    expect(frame.samplePositions).toHaveLength(0);
  });
});

describe("diffTraceSessions", () => {
  it("reports no diffs for identical sessions", () => {
    const session: TraceSession = {
      sampleInterval: 0.1,
      frames: [
        { time: 0, aliveCount: 5, samplePositions: [[1, 2, 3]], sampleColors: [[1, 0, 0]], sampleSizes: [1] },
        { time: 0.1, aliveCount: 5, samplePositions: [[1, 2, 3]], sampleColors: [[1, 0, 0]], sampleSizes: [1] },
      ],
    };
    const diffs = diffTraceSessions(session, session);
    expect(diffs).toHaveLength(0);
  });

  it("detects alive count differences", () => {
    const a: TraceSession = {
      sampleInterval: 0.1,
      frames: [{ time: 0, aliveCount: 5, samplePositions: [], sampleColors: [], sampleSizes: [] }],
    };
    const b: TraceSession = {
      sampleInterval: 0.1,
      frames: [{ time: 0, aliveCount: 3, samplePositions: [], sampleColors: [], sampleSizes: [] }],
    };
    const diffs = diffTraceSessions(a, b);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].field).toBe("aliveCount");
  });

  it("detects frame count mismatch", () => {
    const a: TraceSession = {
      sampleInterval: 0.1,
      frames: [
        { time: 0, aliveCount: 1, samplePositions: [], sampleColors: [], sampleSizes: [] },
        { time: 0.1, aliveCount: 1, samplePositions: [], sampleColors: [], sampleSizes: [] },
      ],
    };
    const b: TraceSession = {
      sampleInterval: 0.1,
      frames: [
        { time: 0, aliveCount: 1, samplePositions: [], sampleColors: [], sampleSizes: [] },
      ],
    };
    const diffs = diffTraceSessions(a, b);
    expect(diffs.some(d => d.field === "frameCount")).toBe(true);
  });
});
