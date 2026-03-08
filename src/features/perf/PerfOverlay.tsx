import { perfPanelEnabled } from "@/features/perf/flags";
import { evaluatePerfSnapshot } from "@/features/perf/health";
import {
  getPerfMetricsSnapshot,
  subscribePerfMetrics,
  type PerfSurface,
} from "@/features/perf/metrics";
import { cn } from "@/lib/utils";
import React, { useEffect, useState } from "react";

function formatMs(value: number): string {
  return `${value.toFixed(1)}ms`;
}

function formatFps(value: number): string {
  return `${value.toFixed(1)} fps`;
}

export function PerfOverlay({
  surface,
  className,
}: {
  surface: PerfSurface;
  className?: string;
}) {
  const [snapshot, setSnapshot] = useState(() => getPerfMetricsSnapshot());

  useEffect(() => {
    return subscribePerfMetrics(() => {
      setSnapshot(getPerfMetricsSnapshot());
    });
  }, []);

  if (!perfPanelEnabled) {
    return null;
  }

  const surfaceMetrics = snapshot.surfaces[surface];
  const health = evaluatePerfSnapshot(snapshot, {
    requiredSurfaces: [surface],
    minFrameSamples: 60,
    strictSamples: false,
    maxP95FrameMs: snapshot.thresholds.frameBudgetMs,
  });
  const hasFrameData = surfaceMetrics.samples > 0;

  return (
    <div
      className={cn(
        "pointer-events-none absolute z-20 min-w-[220px] rounded-md border border-border bg-background/85 p-2 font-mono text-[10px] text-foreground shadow-lg backdrop-blur",
        className,
      )}
      data-testid={`perf-overlay-${surface}`}
    >
      <div className="flex items-center justify-between">
        <span className="font-semibold uppercase tracking-wide">{surface}</span>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "text-[9px]",
              surfaceMetrics.overBudget ? "text-destructive" : "text-emerald-500",
            )}
          >
            p95 {snapshot.thresholds.frameBudgetMs.toFixed(0)}ms budget
          </span>
          <span className={cn("text-[9px]", health.ok ? "text-emerald-500" : "text-destructive")}>
            {health.ok ? "PASS" : "FAIL"}
          </span>
        </div>
      </div>

      <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 text-muted-foreground">
        <span>FPS</span>
        <span className="text-right text-foreground">
          {hasFrameData ? formatFps(surfaceMetrics.fps) : "--"}
        </span>
        <span>Frame avg</span>
        <span className="text-right text-foreground">
          {hasFrameData ? formatMs(surfaceMetrics.avgFrameMs) : "--"}
        </span>
        <span>Frame p95</span>
        <span
          className={cn(
            "text-right",
            surfaceMetrics.overBudget ? "text-destructive" : "text-foreground",
          )}
        >
          {hasFrameData ? formatMs(surfaceMetrics.p95FrameMs) : "--"}
        </span>
        <span>Invokes</span>
        <span className="text-right text-foreground">
          {snapshot.invokes.totalCount}
        </span>
        <span>Invoke errors</span>
        <span
          className={cn(
            "text-right",
            snapshot.invokes.errorCount > 0 ? "text-destructive" : "text-foreground",
          )}
        >
          {snapshot.invokes.errorCount}
        </span>
      </div>

      {snapshot.invokes.topCommands.length > 0 && (
        <div className="mt-2 border-t border-border pt-1">
          <div className="text-[9px] uppercase tracking-wide text-muted-foreground">
            Slow Commands
          </div>
          <div className="space-y-0.5">
            {snapshot.invokes.topCommands.slice(0, 3).map((entry) => (
              <div key={entry.command} className="flex items-center justify-between gap-2">
                <span className="truncate text-muted-foreground">{entry.command}</span>
                <span className="text-foreground">{formatMs(entry.p95Ms)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
