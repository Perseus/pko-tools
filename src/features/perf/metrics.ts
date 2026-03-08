import {
  perfFrameBudgetMs,
  perfFrameSampleWindow,
  perfInvokeSampleWindow,
  perfInvokeWarnMs,
} from "@/features/perf/flags";

export const perfSurfaces = [
  "characters",
  "effects",
  "items",
  "maps",
  "buildings",
] as const;

export type PerfSurface = (typeof perfSurfaces)[number];

type InvokeSample = {
  command: string;
  durationMs: number;
  ok: boolean;
  timestamp: number;
};

export type SurfaceMetrics = {
  samples: number;
  fps: number;
  avgFrameMs: number;
  p95FrameMs: number;
  overBudget: boolean;
};

export type InvokeCommandMetrics = {
  command: string;
  count: number;
  errorCount: number;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
  slowCount: number;
};

export type PerfMetricsSnapshot = {
  generatedAt: number;
  surfaces: Record<PerfSurface, SurfaceMetrics>;
  invokes: {
    totalCount: number;
    errorCount: number;
    slowCount: number;
    topCommands: InvokeCommandMetrics[];
    recent: InvokeSample[];
  };
  thresholds: {
    frameBudgetMs: number;
    invokeWarnMs: number;
  };
};

const frameSamplesBySurface: Record<PerfSurface, number[]> = {
  characters: [],
  effects: [],
  items: [],
  maps: [],
  buildings: [],
};

const invokeSamples: InvokeSample[] = [];
const listeners = new Set<() => void>();

let notifyTimer: ReturnType<typeof setTimeout> | null = null;

function nowMs(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

function percentile(values: number[], ratio: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((sorted.length - 1) * ratio)),
  );
  return sorted[index];
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sum = values.reduce((acc, value) => acc + value, 0);
  return sum / values.length;
}

function ringPush<T>(values: T[], nextValue: T, maxSize: number): void {
  values.push(nextValue);
  if (values.length > maxSize) {
    values.splice(0, values.length - maxSize);
  }
}

function queueNotify(): void {
  if (notifyTimer !== null) {
    return;
  }

  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    listeners.forEach((listener) => listener());
  }, 200);
}

export function recordFrame(surface: PerfSurface, frameMs: number): void {
  if (!Number.isFinite(frameMs) || frameMs <= 0) {
    return;
  }
  ringPush(frameSamplesBySurface[surface], frameMs, perfFrameSampleWindow);
  queueNotify();
}

export function recordInvoke(
  command: string,
  durationMs: number,
  ok: boolean,
): void {
  if (!command) {
    return;
  }
  const normalizedDuration = Number.isFinite(durationMs) ? durationMs : 0;
  ringPush(
    invokeSamples,
    {
      command,
      durationMs: normalizedDuration,
      ok,
      timestamp: Date.now(),
    },
    perfInvokeSampleWindow,
  );
  queueNotify();
}

function buildSurfaceMetrics(surface: PerfSurface): SurfaceMetrics {
  const samples = frameSamplesBySurface[surface];
  const avgFrameMs = average(samples);
  const p95FrameMs = percentile(samples, 0.95);
  const fps = avgFrameMs > 0 ? 1000 / avgFrameMs : 0;

  return {
    samples: samples.length,
    fps,
    avgFrameMs,
    p95FrameMs,
    overBudget: p95FrameMs > perfFrameBudgetMs,
  };
}

export function getPerfMetricsSnapshot(): PerfMetricsSnapshot {
  const groupedByCommand = new Map<string, InvokeSample[]>();
  for (const sample of invokeSamples) {
    const list = groupedByCommand.get(sample.command) ?? [];
    list.push(sample);
    groupedByCommand.set(sample.command, list);
  }

  const topCommands = Array.from(groupedByCommand.entries())
    .map(([command, samples]) => {
      const durations = samples.map((sample) => sample.durationMs);
      const errorCount = samples.filter((sample) => !sample.ok).length;
      const slowCount = samples.filter(
        (sample) => sample.durationMs >= perfInvokeWarnMs,
      ).length;
      return {
        command,
        count: samples.length,
        errorCount,
        avgMs: average(durations),
        p95Ms: percentile(durations, 0.95),
        maxMs: durations.length > 0 ? Math.max(...durations) : 0,
        slowCount,
      } satisfies InvokeCommandMetrics;
    })
    .sort((a, b) => b.p95Ms - a.p95Ms || b.count - a.count)
    .slice(0, 5);

  const errorCount = invokeSamples.filter((sample) => !sample.ok).length;
  const slowCount = invokeSamples.filter(
    (sample) => sample.durationMs >= perfInvokeWarnMs,
  ).length;

  const surfaces = perfSurfaces.reduce((acc, surface) => {
    acc[surface] = buildSurfaceMetrics(surface);
    return acc;
  }, {} as Record<PerfSurface, SurfaceMetrics>);

  return {
    generatedAt: nowMs(),
    surfaces,
    invokes: {
      totalCount: invokeSamples.length,
      errorCount,
      slowCount,
      topCommands,
      recent: invokeSamples.slice(-5).reverse(),
    },
    thresholds: {
      frameBudgetMs: perfFrameBudgetMs,
      invokeWarnMs: perfInvokeWarnMs,
    },
  };
}

export function subscribePerfMetrics(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function __resetPerfMetricsForTests(): void {
  perfSurfaces.forEach((surface) => {
    frameSamplesBySurface[surface] = [];
  });
  invokeSamples.splice(0, invokeSamples.length);
  if (notifyTimer !== null) {
    clearTimeout(notifyTimer);
    notifyTimer = null;
  }
  listeners.clear();
}
