import { createContext, ReactNode, useContext, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useAtomValue } from "jotai";
import { effectV2PlaybackAtom } from "@/store/effect-v2";

/**
 * A time source for effect animation. Consumed by leaf renderers (RectPlane, Cylinder)
 * via useTimeSource(). Can be nested — each TriggeredClock creates a child time scope.
 */
export interface TimeSource {
  /** Current animation time in seconds (relative to this clock's zero point). */
  getTime(): number;
  /** Whether playback is active. Inherited from root — pausing pauses everything. */
  playing: boolean;
  /**
   * Whether this clock's scope should loop.
   * This is a SIGNAL read by leaf consumers — it does NOT affect getTime() behavior.
   * Leaves (RectPlane, Cylinder) are responsible for their own t % totalDuration modulo.
   */
  loop: boolean;
}

const TimeContext = createContext<TimeSource | null>(null);

export const TimeProvider = TimeContext.Provider;

/** Read the nearest TimeSource from context. Throws if no provider is found. */
export function useTimeSource(): TimeSource {
  const ctx = useContext(TimeContext);
  if (!ctx) {
    throw new Error("useTimeSource must be used within a TimeProvider");
  }
  return ctx;
}

/**
 * Bridges effectV2PlaybackAtom → TimeSource.
 * Place once at the workbench root, inside the Canvas, wrapping all effect renderers.
 * Uses ref-based getters so the context value identity never changes across re-renders.
 */
export function GlobalTimeProvider({ children }: { children: ReactNode }) {
  const playback = useAtomValue(effectV2PlaybackAtom);
  const playbackRef = useRef(playback);
  playbackRef.current = playback;

  // Stable object — created once, getters read from ref
  const timeSource = useRef<TimeSource>({
    getTime: () => playbackRef.current.time,
    get playing() { return playbackRef.current.playing; },
    get loop() { return playbackRef.current.loop; },
  }).current;

  return <TimeProvider value={timeSource}>{children}</TimeProvider>;
}

interface TriggeredClockProps {
  /** Whether the triggered scope should loop. Captured at mount time. */
  loop?: boolean;
  children: ReactNode;
}

/**
 * Creates a new clock boundary that starts at t=0 when this component mounts.
 * Accumulates elapsed time via useFrame delta, gated by parent's playing state.
 * Unmounting and remounting (e.g. loop restart) naturally resets elapsed to 0.
 *
 * NOTE: The `get playing()` getter relies on the parent TimeSource being a stable
 * ref-based object with its own getters. Every layer in the TimeContext chain must
 * follow the same ref-based pattern for the getter chain to read current values.
 */
export function TriggeredClock({ loop = false, children }: TriggeredClockProps) {
  const parent = useTimeSource();
  const elapsedRef = useRef(0);

  // R3F useFrame ordering: callbacks execute in mount order (FIFO).
  // This useFrame runs before any child useFrame callbacks, so children
  // always see the updated time for the current frame.
  useFrame((_, delta) => {
    if (!parent.playing) return;
    elapsedRef.current += Math.min(delta, 0.05); // clamp first-frame spike
  });

  // Stable object — identity never changes, getTime reads ref.
  // The `loop` prop is captured at mount time and does not update after.
  const timeSource = useRef<TimeSource>({
    getTime: () => elapsedRef.current,
    get playing() { return parent.playing; },
    loop,
  }).current;

  return <TimeProvider value={timeSource}>{children}</TimeProvider>;
}
