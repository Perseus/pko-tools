import { ReactNode, useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useAtom } from "jotai";
import * as THREE from "three";
import { MagicSingleEntry } from "@/types/effect-v2";
import { effectV2PlaybackAtom } from "@/store/effect-v2";
import { useTimeSource } from "../../TimeContext";
import { flightDrop } from "./paths/drop";
import { flightFly } from "./paths/fly";
import { flightTrace } from "./paths/trace";
import { flightFshade } from "./paths/fshade";
import { flightArc } from "./paths/arc";
import { flightDirlight } from "./paths/dirlight";
import { flightDist } from "./paths/dist";
import { flightDist2 } from "./paths/dist2";

export interface FlightContext {
  /** World position of the effect origin (caster). */
  origin: THREE.Vector3;
  /** World position of the target. */
  target: THREE.Vector3;
  /** Effect velocity from MagicSingleinfo. */
  velocity: number;
  /** Elapsed time since emission (seconds). */
  elapsed: number;
  /** Time step this frame (seconds). */
  delta: number;
  /** Persistent state bag for the flight path — survives across frames, reset on effect change. */
  state: Record<string, unknown>;
  /** Set to true by a flight path to signal it has finished. */
  done: boolean;
}

export type FlightPathFn = (
  ctx: FlightContext,
  groupRef: THREE.Group,
) => void;

/**
 * Render index → flight path function.
 * Matches the C++ MagicList[] array in EffectObj.cpp.
 */
const FLIGHT_PATHS: FlightPathFn[] = [
  flightDrop,     // 0
  flightFly,      // 1
  flightTrace,    // 2
  flightFshade,   // 3
  flightArc,      // 4
  flightDirlight, // 5
  flightDist,     // 6
  flightDist2,    // 7
];

/** Data captured at the moment the flight path completes. */
export interface ArrivalInfo {
  /** World position where the effect arrived. */
  position: THREE.Vector3;
  /** Normalized travel direction at moment of arrival. */
  direction: THREE.Vector3;
}

interface FlightPathControllerProps {
  magicEntry: MagicSingleEntry | null;
  origin: THREE.Vector3;
  target: THREE.Vector3;
  children: ReactNode;
  /** Called when the flight path signals done. Receives position + direction at impact. */
  onArrival?: (info: ArrivalInfo) => void;
  /** When true, the flight effect is hidden and loop/reset is deferred until resumeLoop() is called. */
  awaitingHitEffect: boolean;
  hasHitEffect: boolean;
}

/**
 * Wraps effect renderers and drives their group position
 * according to the selected flight path algorithm.
 */
export function FlightPathController({
  magicEntry,
  origin,
  target,
  children,
  onArrival,
  awaitingHitEffect,
  hasHitEffect,
}: FlightPathControllerProps) {
  const groupRef = useRef<THREE.Group>(null);
  const flightState = useRef<Record<string, unknown>>({});
  const prevEntry = useRef(magicEntry);
  // useTimeSource for reads, useAtom solely for write (loop restart / stop).
  // Both are needed because TimeSource is a read-only interface.
  const timeSource = useTimeSource();
  const [, setPlayback] = useAtom(effectV2PlaybackAtom);
  const arrived = useRef(false);
  const prevAwaiting = useRef(awaitingHitEffect);

  // Reset state when magic entry changes
  if (magicEntry !== prevEntry.current) {
    flightState.current = {};
    arrived.current = false;
    prevEntry.current = magicEntry;
  }

  // Reset state and position when playback resets to 0
  const prevTime = useRef(timeSource.getTime());
  if (timeSource.getTime() < prevTime.current) {
    flightState.current = {};
    arrived.current = false;
    if (groupRef.current) {
      groupRef.current.position.set(0, 0, 0);
      groupRef.current.quaternion.identity();
      groupRef.current.visible = true;
    }
  }
  prevTime.current = timeSource.getTime();

  const restartEffect = () => {
    arrived.current = false;
    if (groupRef.current) {
      groupRef.current.position.set(0, 0, 0);
      groupRef.current.quaternion.identity();
      groupRef.current.visible = true;
    }
    flightState.current = {};

    if (timeSource.loop) {
      setPlayback((p) => ({ ...p, time: 0 }));
    } else {
      setPlayback((p) => ({ ...p, playing: false }));
    }
  };

  // When awaitingHitEffect transitions from true → false, the hit effect just finished.
  // Now we can do the actual loop restart. Must be in useEffect to avoid render-phase setState.
  useEffect(() => {
    const hasHitEffectFinished = prevAwaiting.current && !awaitingHitEffect && arrived.current;
    if (hasHitEffectFinished) {
      restartEffect();
    }
    prevAwaiting.current = awaitingHitEffect;
  }, [awaitingHitEffect]);

  const renderIdx = magicEntry?.render_idx ?? -1;
  const velocity = magicEntry?.velocity ?? 0;

  useFrame((_, delta) => {
    if (!groupRef.current || renderIdx < 0 || renderIdx >= FLIGHT_PATHS.length) return;
    if (!timeSource.playing || arrived.current) return;

    const ctx: FlightContext = {
      origin,
      target,
      velocity,
      elapsed: timeSource.getTime(),
      delta,
      state: flightState.current,
      done: false,
    };

    const targetDirection = target.clone().sub(target).normalize();
    groupRef.current.lookAt(targetDirection);
    FLIGHT_PATHS[renderIdx](ctx, groupRef.current);

    if (ctx.done) {
      arrived.current = true;

      // Capture position + direction before hiding
      const arrivalPos = groupRef.current.position.clone();
      const arrivalDir = target.clone().sub(origin).normalize();

      // Hide flight effect while hit effect plays
      groupRef.current.visible = false;

      onArrival?.({ position: arrivalPos, direction: arrivalDir });
      if (!hasHitEffect) {
        restartEffect();
      }
    }
  });

  return <group ref={groupRef}>{children}</group>;
}
