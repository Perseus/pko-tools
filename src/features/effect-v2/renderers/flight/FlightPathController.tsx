import { ReactNode, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { useAtom } from "jotai";
import * as THREE from "three";
import { MagicSingleEntry } from "@/types/effect-v2";
import { effectV2PlaybackAtom } from "@/store/effect-v2";
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

interface FlightPathControllerProps {
  magicEntry: MagicSingleEntry | null;
  origin: THREE.Vector3;
  target: THREE.Vector3;
  children: ReactNode;
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
}: FlightPathControllerProps) {
  const groupRef = useRef<THREE.Group>(null);
  const flightState = useRef<Record<string, unknown>>({});
  const prevEntry = useRef(magicEntry);
  const [playback, setPlayback] = useAtom(effectV2PlaybackAtom);

  // Reset state when magic entry changes
  if (magicEntry !== prevEntry.current) {
    flightState.current = {};
    prevEntry.current = magicEntry;
  }

  // Reset state and position when playback resets to 0
  const prevTime = useRef(playback.time);
  if (playback.time < prevTime.current) {
    flightState.current = {};
    if (groupRef.current) {
      groupRef.current.position.set(0, 0, 0);
      groupRef.current.quaternion.identity();
    }
  }
  prevTime.current = playback.time;

  const renderIdx = magicEntry?.render_idx ?? -1;
  const velocity = magicEntry?.velocity ?? 0;

  useFrame((_, delta) => {
    if (!groupRef.current || renderIdx < 0 || renderIdx >= FLIGHT_PATHS.length) return;
    if (!playback.playing) return;

    const ctx: FlightContext = {
      origin,
      target,
      velocity,
      elapsed: playback.time,
      delta,
      state: flightState.current,
      done: false,
    };

    FLIGHT_PATHS[renderIdx](ctx, groupRef.current);

    if (ctx.done) {
      // Reset group transform
      groupRef.current.position.set(0, 0, 0);
      groupRef.current.quaternion.identity();

      if (playback.loop) {
        flightState.current = {};
        setPlayback((p) => ({ ...p, time: 0 }));
      } else {
        setPlayback((p) => ({ ...p, playing: false }));
      }
    }
  });

  return <group ref={groupRef}>{children}</group>;
}
