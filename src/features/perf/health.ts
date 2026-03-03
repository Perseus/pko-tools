import {
  getPerfMetricsSnapshot,
  type PerfMetricsSnapshot,
  type PerfSurface,
  perfSurfaces,
} from "@/features/perf/metrics";

export type PerfHealthOptions = {
  minFrameSamples?: number;
  maxP95FrameMs?: number;
  maxInvokeErrorRate?: number;
  maxSlowInvokeRate?: number;
  strictSamples?: boolean;
  requiredSurfaces?: PerfSurface[];
};

export type PerfHealthReport = {
  ok: boolean;
  violations: string[];
  diagnostics: {
    invokeErrorRate: number;
    slowInvokeRate: number;
  };
};

const DEFAULT_HEALTH_OPTIONS: Required<PerfHealthOptions> = {
  minFrameSamples: 120,
  maxP95FrameMs: 20,
  maxInvokeErrorRate: 0.05,
  maxSlowInvokeRate: 0.25,
  strictSamples: false,
  requiredSurfaces: [...perfSurfaces],
};

function toRate(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }
  return numerator / denominator;
}

export function evaluatePerfSnapshot(
  snapshot: PerfMetricsSnapshot,
  options: PerfHealthOptions = {},
): PerfHealthReport {
  const config: Required<PerfHealthOptions> = {
    ...DEFAULT_HEALTH_OPTIONS,
    ...options,
    requiredSurfaces: options.requiredSurfaces ?? DEFAULT_HEALTH_OPTIONS.requiredSurfaces,
  };

  const violations: string[] = [];

  for (const surface of config.requiredSurfaces) {
    const metrics = snapshot.surfaces[surface];
    if (metrics.samples < config.minFrameSamples) {
      if (config.strictSamples) {
        violations.push(
          `${surface}: insufficient frame samples (${metrics.samples}/${config.minFrameSamples})`,
        );
      }
      continue;
    }
    if (metrics.p95FrameMs > config.maxP95FrameMs) {
      violations.push(
        `${surface}: frame p95 ${metrics.p95FrameMs.toFixed(1)}ms exceeds ${config.maxP95FrameMs.toFixed(1)}ms`,
      );
    }
  }

  const invokeErrorRate = toRate(
    snapshot.invokes.errorCount,
    snapshot.invokes.totalCount,
  );
  if (invokeErrorRate > config.maxInvokeErrorRate) {
    violations.push(
      `invoke error rate ${(invokeErrorRate * 100).toFixed(1)}% exceeds ${(config.maxInvokeErrorRate * 100).toFixed(1)}%`,
    );
  }

  const slowInvokeRate = toRate(
    snapshot.invokes.slowCount,
    snapshot.invokes.totalCount,
  );
  if (slowInvokeRate > config.maxSlowInvokeRate) {
    violations.push(
      `slow invoke rate ${(slowInvokeRate * 100).toFixed(1)}% exceeds ${(config.maxSlowInvokeRate * 100).toFixed(1)}%`,
    );
  }

  return {
    ok: violations.length === 0,
    violations,
    diagnostics: {
      invokeErrorRate,
      slowInvokeRate,
    },
  };
}

export function evaluateCurrentPerfHealth(
  options: PerfHealthOptions = {},
): PerfHealthReport {
  return evaluatePerfSnapshot(getPerfMetricsSnapshot(), options);
}
