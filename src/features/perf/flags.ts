function parsePositiveNumber(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

export const perfPanelEnabled =
  import.meta.env.VITE_PERF_PANEL_ENABLED === "true" || import.meta.env.DEV;

export const perfFrameBudgetMs = parsePositiveNumber(
  import.meta.env.VITE_PERF_FRAME_BUDGET_MS,
  20,
);

export const perfInvokeWarnMs = parsePositiveNumber(
  import.meta.env.VITE_PERF_INVOKE_WARN_MS,
  200,
);

export const perfFrameSampleWindow = parsePositiveNumber(
  import.meta.env.VITE_PERF_FRAME_SAMPLE_WINDOW,
  240,
);

export const perfInvokeSampleWindow = parsePositiveNumber(
  import.meta.env.VITE_PERF_INVOKE_SAMPLE_WINDOW,
  400,
);
