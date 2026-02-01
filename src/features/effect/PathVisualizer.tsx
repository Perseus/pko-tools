/// <reference types="@react-three/fiber" />
import { pathPointsAtom } from "@/store/path";
import { effectDataAtom, effectPlaybackAtom } from "@/store/effect";
import { useAtomValue } from "jotai";
import { Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import React from "react";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { getPathPosition } from "@/features/effect/animation";

/** Default path velocity — must match the value used in EffectViewport PathFollower. */
const DEFAULT_PATH_VELOCITY = 2.0;

export default function PathVisualizer() {
  const pathPoints = useAtomValue(pathPointsAtom);
  const effectData = useAtomValue(effectDataAtom);
  const playback = useAtomValue(effectPlaybackAtom);
  const markerRef = useRef<THREE.Mesh>(null);

  const visible = effectData?.usePath === true && pathPoints && pathPoints.length > 1;

  const linePoints = useMemo(() => {
    if (!visible || !pathPoints) return [];
    return pathPoints.map(([x, y, z]) => [x, y, z] as [number, number, number]);
  }, [visible, pathPoints]);

  // Animate the marker along the path during playback
  useFrame(() => {
    if (!markerRef.current || !pathPoints || pathPoints.length < 2) return;

    if (playback.isPlaying) {
      const pos = getPathPosition(
        pathPoints,
        playback.currentTime,
        DEFAULT_PATH_VELOCITY,
        playback.isLooping,
      );
      markerRef.current.position.set(pos[0], pos[1], pos[2]);
      markerRef.current.visible = true;
    } else {
      markerRef.current.visible = false;
    }
  });

  if (!visible || !pathPoints || linePoints.length < 2) {
    return null;
  }

  return (
    <group>
      <Line
        points={linePoints}
        color="#22d3ee"
        lineWidth={1.5}
        transparent
        opacity={0.6}
      />
      {pathPoints.map(([x, y, z], i) => (
        <mesh key={i} position={[x, y, z]}>
          <sphereGeometry args={[0.08, 8, 8]} />
          <meshBasicMaterial color="#22d3ee" transparent opacity={0.8} />
        </mesh>
      ))}
      {/* Animated marker showing current position along path during playback */}
      <mesh ref={markerRef} visible={false}>
        <sphereGeometry args={[0.12, 12, 12]} />
        <meshBasicMaterial color="#f59e0b" transparent opacity={0.9} />
      </mesh>
    </group>
  );
}
