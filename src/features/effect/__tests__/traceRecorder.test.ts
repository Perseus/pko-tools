import { describe, expect, it } from "vitest";
import { createPool, tickPool } from "@/features/effect/particle/particlePool";
import { sampleTraceFrame, type TraceSession } from "@/features/effect/traceSnapshot";
import { createDefaultParticleSystem } from "@/types/particle";

describe("traceRecorder", () => {
  it("captures frames at configurable interval during simulation", () => {
    const pool = createPool();
    const sys = createDefaultParticleSystem();
    const sampleInterval = 0.1;
    const frames: ReturnType<typeof sampleTraceFrame>[] = [];
    let lastSampleTime = -Infinity;

    // Run 60 ticks at 60fps (1 second of simulation)
    const dt = 1 / 60;
    let elapsed = 0;
    for (let i = 0; i < 60; i++) {
      tickPool(pool, sys, dt);
      elapsed += dt;

      // Sample at interval
      if (elapsed - lastSampleTime >= sampleInterval) {
        frames.push(sampleTraceFrame(pool, elapsed));
        lastSampleTime = elapsed;
      }
    }

    // ~1 second / 0.1 interval = ~10 frames
    expect(frames.length).toBeGreaterThanOrEqual(9);
    expect(frames.length).toBeLessThanOrEqual(11);
  });

  it("records alive particles when they should be alive", () => {
    const pool = createPool();
    const sys = createDefaultParticleSystem();
    sys.life = 0.5;
    sys.step = 0.01;
    sys.particleCount = 20;

    const frames: ReturnType<typeof sampleTraceFrame>[] = [];
    const dt = 1 / 60;
    let elapsed = 0;
    let lastSampleTime = -Infinity;
    const sampleInterval = 0.1;

    for (let i = 0; i < 60; i++) {
      tickPool(pool, sys, dt);
      elapsed += dt;
      if (elapsed - lastSampleTime >= sampleInterval) {
        frames.push(sampleTraceFrame(pool, elapsed));
        lastSampleTime = elapsed;
      }
    }

    // After some frames, particles should be alive (within life window)
    const hasAlive = frames.some((f) => f.aliveCount > 0);
    expect(hasAlive).toBe(true);
  });

  it("produces a valid TraceSession structure", () => {
    const pool = createPool();
    const sys = createDefaultParticleSystem();
    const frames: ReturnType<typeof sampleTraceFrame>[] = [];
    const sampleInterval = 0.1;
    let lastSampleTime = -Infinity;

    const dt = 0.016;
    let elapsed = 0;
    for (let i = 0; i < 60; i++) {
      tickPool(pool, sys, dt);
      elapsed += dt;
      if (elapsed - lastSampleTime >= sampleInterval) {
        frames.push(sampleTraceFrame(pool, elapsed));
        lastSampleTime = elapsed;
      }
    }

    const session: TraceSession = { frames, sampleInterval };

    expect(session.sampleInterval).toBe(0.1);
    expect(session.frames.length).toBeGreaterThan(0);
    for (const frame of session.frames) {
      expect(frame).toHaveProperty("time");
      expect(frame).toHaveProperty("aliveCount");
      expect(frame).toHaveProperty("samplePositions");
      expect(frame).toHaveProperty("sampleColors");
      expect(frame).toHaveProperty("sampleSizes");
    }
  });
});
