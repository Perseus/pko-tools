import {
  __resetPerfMetricsForTests,
  getPerfMetricsSnapshot,
  recordFrame,
  recordInvoke,
} from "@/features/perf/metrics";
import { evaluatePerfSnapshot } from "@/features/perf/health";
import { beforeEach, describe, expect, it } from "vitest";

describe("perf health evaluation", () => {
  beforeEach(() => {
    __resetPerfMetricsForTests();
  });

  it("passes when thresholds are satisfied", () => {
    for (let i = 0; i < 130; i++) {
      recordFrame("effects", 16 + (i % 2));
      recordFrame("maps", 15 + (i % 3));
    }
    for (let i = 0; i < 50; i++) {
      recordInvoke("load_effect", 40, true);
    }

    const snapshot = getPerfMetricsSnapshot();
    const report = evaluatePerfSnapshot(snapshot, {
      requiredSurfaces: ["effects", "maps"],
      strictSamples: true,
      minFrameSamples: 120,
      maxP95FrameMs: 20,
      maxInvokeErrorRate: 0.1,
      maxSlowInvokeRate: 0.2,
    });

    expect(report.ok).toBe(true);
    expect(report.violations).toHaveLength(0);
  });

  it("fails on frame, error-rate, and slow-invoke violations", () => {
    for (let i = 0; i < 130; i++) {
      recordFrame("effects", 28);
    }

    for (let i = 0; i < 10; i++) {
      recordInvoke("load_effect", 300, i % 3 !== 0);
    }

    const snapshot = getPerfMetricsSnapshot();
    const report = evaluatePerfSnapshot(snapshot, {
      requiredSurfaces: ["effects"],
      strictSamples: true,
      minFrameSamples: 120,
      maxP95FrameMs: 20,
      maxInvokeErrorRate: 0.1,
      maxSlowInvokeRate: 0.2,
    });

    expect(report.ok).toBe(false);
    expect(report.violations.some((msg) => msg.includes("frame p95"))).toBe(true);
    expect(report.violations.some((msg) => msg.includes("invoke error rate"))).toBe(true);
    expect(report.violations.some((msg) => msg.includes("slow invoke rate"))).toBe(true);
  });
});
