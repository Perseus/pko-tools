import { useCallback, useRef } from "react";
import type { ParticlePool } from "@/features/effect/particle/particlePool";
import { sampleTraceFrame, type TraceFrame, type TraceSession } from "@/features/effect/traceSnapshot";

const DEFAULT_SAMPLE_INTERVAL = 0.1; // 100ms

export interface TraceRecorder {
  /** Whether recording is in progress. */
  isRecording: boolean;
  /** Start recording trace frames. */
  startRecording: () => void;
  /** Stop recording and return the completed session. */
  stopRecording: () => TraceSession | null;
  /** Call each frame during playback — samples at the configured interval. */
  tick: (pool: ParticlePool, currentTime: number) => void;
}

/**
 * Hook that records particle pool state at regular intervals for deterministic
 * replay comparison. Returns refs so it works inside useFrame without re-renders.
 */
export function useTraceRecorder(
  sampleInterval: number = DEFAULT_SAMPLE_INTERVAL,
): TraceRecorder {
  const recordingRef = useRef(false);
  const framesRef = useRef<TraceFrame[]>([]);
  const lastSampleTimeRef = useRef(-Infinity);

  const startRecording = useCallback(() => {
    recordingRef.current = true;
    framesRef.current = [];
    lastSampleTimeRef.current = -Infinity;
  }, []);

  const stopRecording = useCallback((): TraceSession | null => {
    if (!recordingRef.current) return null;
    recordingRef.current = false;
    const frames = framesRef.current;
    framesRef.current = [];
    return { frames, sampleInterval };
  }, [sampleInterval]);

  const tick = useCallback(
    (pool: ParticlePool, currentTime: number) => {
      if (!recordingRef.current) return;
      if (currentTime - lastSampleTimeRef.current < sampleInterval) return;

      lastSampleTimeRef.current = currentTime;
      framesRef.current.push(sampleTraceFrame(pool, currentTime));
    },
    [sampleInterval],
  );

  return {
    get isRecording() {
      return recordingRef.current;
    },
    startRecording,
    stopRecording,
    tick,
  };
}
