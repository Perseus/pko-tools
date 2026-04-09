import { SubEffect } from "@/types/effect";
import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useTimeSource } from "../../TimeContext";
import { useEffectTexture } from "../../useEffectTexture";
import { getThreeJSBlendFromD3D, findFrame, lerp } from "../../helpers";

interface SphereProps {
  subEffect: SubEffect;
  onComplete?: () => void;
}

/**
 * "Sphere" mesh -- a standard sphere with radius 0.5.
 *
 * Uses THREE.SphereGeometry for vertex/UV generation.
 * No billboard support (sphere looks the same from all angles).
 */
export function Sphere({ subEffect, onComplete }: SphereProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const timeSource = useTimeSource();

  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const firedRef = useRef(false);

  const { frameCount, frameTimes, frameSizes, framePositions, frameColors, frameAngles } = subEffect;

  const geometry = useMemo(() => {
    return new THREE.SphereGeometry(0.5, 24, 24);
  }, []);

  let totalAnimationDurationSeconds = 0;
  for (let i = 0; i < frameCount; i++) {
    totalAnimationDurationSeconds += frameTimes[i];
  }

  useEffect(() => {
    if (frameTimes.length === 0 && !firedRef.current) {
      firedRef.current = true;
      onCompleteRef.current?.();
    }
  }, [frameTimes.length]);

  useFrame(() => {
    if (!meshRef.current || !matRef.current || frameTimes.length === 0) return;

    if (!timeSource.playing) {
      return;
    }

    let t = timeSource.getTime();
    if (totalAnimationDurationSeconds > 0) {
      if (timeSource.loop) {
        t = t % totalAnimationDurationSeconds;
      } else {
        t = Math.min(t, totalAnimationDurationSeconds);
      }
    }

    if (!timeSource.loop && !firedRef.current && timeSource.getTime() >= totalAnimationDurationSeconds && totalAnimationDurationSeconds > 0) {
      firedRef.current = true;
      onCompleteRef.current?.();
    }

    const { frameIdx, localT } = findFrame(frameTimes, t);
    const nextIdx = Math.min(frameIdx + 1, frameTimes.length - 1);
    const frac = frameTimes[frameIdx] > 0 ? localT / frameTimes[frameIdx] : 0;

    if (framePositions.length > frameIdx) {
      const p0 = framePositions[frameIdx];
      const p1 = framePositions[nextIdx] ?? p0;
      meshRef.current.position.set(
        lerp(p0[0], p1[0], frac),
        lerp(p0[1], p1[1], frac),
        lerp(p0[2], p1[2], frac),
      );
    }

    if (frameSizes.length > frameIdx) {
      const s0 = frameSizes[frameIdx];
      const s1 = frameSizes[nextIdx] ?? s0;
      meshRef.current.scale.set(
        lerp(s0[0], s1[0], frac),
        lerp(s0[1], s1[1], frac),
        lerp(s0[2], s1[2], frac),
      );
    }

    if (frameColors.length > frameIdx) {
      const c0 = frameColors[frameIdx];
      const c1 = frameColors[nextIdx] ?? c0;
      matRef.current.color.setRGB(
        lerp(c0[0], c1[0], frac),
        lerp(c0[1], c1[1], frac),
        lerp(c0[2], c1[2], frac),
      );
      matRef.current.opacity = lerp(c0[3], c1[3], frac);
    }

    if (frameAngles.length > frameIdx) {
      const a0 = frameAngles[frameIdx];
      const a1 = frameAngles[nextIdx] ?? a0;
      meshRef.current.rotation.set(
        lerp(a0[0], a1[0], frac),
        lerp(a0[1], a1[1], frac),
        lerp(a0[2], a1[2], frac),
        "YXZ",
      );
    }
  });

  const texture = useEffectTexture(subEffect.texName);
  const blendSrc = getThreeJSBlendFromD3D(subEffect.srcBlend);
  const blendDst = getThreeJSBlendFromD3D(subEffect.destBlend);

  return (
    <group>
      <mesh ref={meshRef} geometry={geometry}>
        <meshBasicMaterial
          ref={matRef}
          color="#ffffff"
          transparent
          depthWrite={false}
          side={THREE.DoubleSide}
          map={texture}
          blending={THREE.CustomBlending}
          blendSrc={blendSrc}
          blendDst={blendDst}
        />
      </mesh>
    </group>
  );
}
