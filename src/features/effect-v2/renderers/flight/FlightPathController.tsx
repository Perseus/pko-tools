import { ReactNode, useEffect, useRef, useState } from "react";
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
import { ParticleOpacityProvider } from "../particles/particleOpacityContext";

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
  /** Optional path-specific target point retained for trace/debug output. */
  orientationTarget?: THREE.Vector3;
  /** Direction used when the C++ path calls RotatingXZ/ResetDir for model effects. */
  orientationDirection?: THREE.Vector3;
  /** Current C++ _vDir equivalent, also passed into result particles on Stop(). */
  sourceDirection?: THREE.Vector3;
  /** Composite one-shot animation duration for path types whose completion is animation-driven. */
  effectDuration?: number;
  /** Optional additional faded render samples emitted by paths such as C++ Part_fshade. */
  trailSamples?: FlightTrailSample[];
}

export interface FlightTrailSample {
  position: THREE.Vector3;
  opacity: number;
  quaternion?: THREE.Quaternion;
}

export type FlightPathFn = (
  ctx: FlightContext,
  groupRef: THREE.Group,
) => void;

/**
 * Render index → flight path function.
 * Matches the C++ MagicList[] array in EffectObj.cpp. Part_dist2 exists in
 * the source but is not present in that array for this client.
 */
const FLIGHT_PATHS: FlightPathFn[] = [
  flightDrop,     // 0
  flightFly,      // 1
  flightTrace,    // 2
  flightFshade,   // 3
  flightArc,      // 4
  flightDirlight, // 5
  flightDist,     // 6
];

export function getMagicFlightPathForTest(renderIdx: number): FlightPathFn | null {
  if (renderIdx < 0 || renderIdx >= FLIGHT_PATHS.length) return null;
  return FLIGHT_PATHS[renderIdx];
}

export function orientFlightGroupToTarget(
  group: THREE.Group,
  target: THREE.Vector3,
): void {
  const direction = target.clone().sub(group.position);
  if (direction.lengthSq() < 0.000001) return;

  applyMagicRotatingXZ(group, direction);
}

export function getMagicEmissionDirection(
  origin: THREE.Vector3,
  target: THREE.Vector3,
  renderIdx: number,
): THREE.Vector3 {
  const sourceTarget = target.clone();
  if (renderIdx === 5) {
    sourceTarget.z = origin.z;
  }
  return sourceTarget.sub(origin);
}

export function applySourceStyleMagicOrientation(
  group: THREE.Group,
  ctx: FlightContext,
  renderIdx: number,
  wasInitialized: boolean,
): void {
  if (!wasInitialized) {
    applyMagicRotatingXZ(group, getMagicEmissionDirection(ctx.origin, ctx.target, renderIdx));
    return;
  }

  if (ctx.orientationDirection) {
    applyMagicRotatingXZ(group, ctx.orientationDirection);
  }
}

const _rotX = new THREE.Matrix4();
const _rotZ = new THREE.Matrix4();
const _rotatingXZ = new THREE.Matrix4();

export function applyMagicRotatingXZ(
  group: THREE.Group,
  direction: THREE.Vector3,
): void {
  if (direction.lengthSq() < 0.000001) return;

  const dir = direction.clone().normalize();
  const pitch = dir.z === 0 ? 0 : Math.asin(dir.z);
  let yaw = 0;

  if (dir.x !== 0 || dir.y !== 0) {
    const horizontal = Math.sqrt(dir.x * dir.x + dir.y * dir.y);
    yaw = Math.acos(dir.y / horizontal);
    if (dir.x >= 0) yaw = -yaw;
  }

  // C++ builds a D3D row-vector matrix as RotationX(pitch) * RotationZ(yaw).
  // Three applies column-vector transforms, so use the transposed order.
  _rotX.makeRotationX(pitch);
  _rotZ.makeRotationZ(yaw);
  _rotatingXZ.copy(_rotZ).multiply(_rotX);
  group.setRotationFromMatrix(_rotatingXZ);
}

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
  /** Optional model-only children for path-generated afterimages such as Part_fshade. */
  trailChildren?: ReactNode;
  /** Particle controllers moved by CMagicCtrl::MoveTo but not rotated by model RotatingXZ. */
  worldAlignedChildren?: ReactNode;
  /** Called when the flight path signals done. Receives position + direction at impact. */
  onArrival?: (info: ArrivalInfo) => void;
  /** When true, the flight effect is hidden and loop/reset is deferred until resumeLoop() is called. */
  awaitingHitEffect: boolean;
  hasHitEffect: boolean;
  effectDuration?: number;
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
  trailChildren,
  worldAlignedChildren,
  onArrival,
  awaitingHitEffect,
  hasHitEffect,
  effectDuration,
}: FlightPathControllerProps) {
  const groupRef = useRef<THREE.Group>(null);
  const worldAlignedGroupRef = useRef<THREE.Group>(null);
  const flightState = useRef<Record<string, unknown>>({});
  const prevEntry = useRef(magicEntry);
  // useTimeSource for reads, useAtom solely for write (loop restart / stop).
  // Both are needed because TimeSource is a read-only interface.
  const timeSource = useTimeSource();
  const [, setPlayback] = useAtom(effectV2PlaybackAtom);
  const arrived = useRef(false);
  const prevAwaiting = useRef(awaitingHitEffect);
  const [trailSamples, setTrailSamples] = useState<FlightTrailSample[]>([]);

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
      if (worldAlignedGroupRef.current) {
        worldAlignedGroupRef.current.position.set(0, 0, 0);
        worldAlignedGroupRef.current.quaternion.identity();
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
    if (worldAlignedGroupRef.current) {
      worldAlignedGroupRef.current.position.set(0, 0, 0);
      worldAlignedGroupRef.current.quaternion.identity();
    }
    setTrailSamples([]);
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
    const flightPath = getMagicFlightPathForTest(renderIdx);
    if (!groupRef.current || !flightPath) return;
    if (!timeSource.playing || arrived.current) return;

    const pendingPosition = flightState.current.__nextRenderPosition as THREE.Vector3 | undefined;
    const pendingQuaternion = flightState.current.__nextRenderQuaternion as THREE.Quaternion | undefined;
    if (pendingPosition) groupRef.current.position.copy(pendingPosition);
    if (pendingQuaternion) groupRef.current.quaternion.copy(pendingQuaternion);

    const ctx: FlightContext = {
      origin,
      target,
      velocity,
      elapsed: timeSource.getTime(),
      delta,
      state: flightState.current,
      done: false,
      effectDuration,
    };

    const wasInitialized = Boolean(flightState.current.initialized);
    if (!wasInitialized) {
      applyMagicRotatingXZ(groupRef.current, getMagicEmissionDirection(origin, target, renderIdx));
    }
    const renderPosition = groupRef.current.position.clone();
    const renderQuaternion = groupRef.current.quaternion.clone();

    flightPath(ctx, groupRef.current);
    applySourceStyleMagicOrientation(groupRef.current, ctx, renderIdx, wasInitialized);

    const nextPosition = groupRef.current.position.clone();
    const nextQuaternion = groupRef.current.quaternion.clone();
    flightState.current.__nextRenderPosition = nextPosition;
    flightState.current.__nextRenderQuaternion = nextQuaternion;
    groupRef.current.position.copy(renderPosition);
    groupRef.current.quaternion.copy(renderQuaternion);
    if (worldAlignedGroupRef.current) {
      worldAlignedGroupRef.current.position.copy(renderPosition);
      worldAlignedGroupRef.current.quaternion.identity();
    }

    const nextTrailSamples = ctx.trailSamples?.map((sample) => ({
      position: sample.position.clone(),
      opacity: sample.opacity,
      quaternion: nextQuaternion.clone(),
    }));
    setTrailSamples((current) => {
      if (!nextTrailSamples) return current.length > 0 ? [] : current;
      return nextTrailSamples;
    });

    if (ctx.done) {
      arrived.current = true;

      // Capture position + direction before hiding
      const arrivalPos = nextPosition.clone();
      const arrivalDir = (ctx.sourceDirection ?? getMagicEmissionDirection(origin, target, renderIdx)).clone().normalize();

      // Hide flight effect while hit effect plays
      groupRef.current.visible = false;

      onArrival?.({ position: arrivalPos, direction: arrivalDir });
      if (!hasHitEffect) {
        restartEffect();
      }
    }
  });

  return (
    <>
      <group ref={groupRef}>{children}</group>
      <group ref={worldAlignedGroupRef}>{worldAlignedChildren}</group>
      {trailSamples.map((sample, index) => (
        <group
          key={`trail-${index}`}
          position={sample.position}
          quaternion={sample.quaternion}
        >
          <ParticleOpacityProvider value={sample.opacity}>
            {trailChildren ?? children}
          </ParticleOpacityProvider>
        </group>
      ))}
    </>
  );
}
