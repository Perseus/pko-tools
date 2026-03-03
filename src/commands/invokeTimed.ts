import { recordInvoke } from "@/features/perf/metrics";
import { invoke } from "@tauri-apps/api/core";

function nowMs(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

export async function invokeTimed<T>(
  command: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const startedAt = nowMs();
  try {
    const result = await invoke<T>(command, args);
    recordInvoke(command, nowMs() - startedAt, true);
    return result;
  } catch (error) {
    recordInvoke(command, nowMs() - startedAt, false);
    throw error;
  }
}
