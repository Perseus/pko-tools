import { SubEffect } from "@/types/effect";
import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import { useAtomValue } from "jotai";
import * as THREE from "three";
import { effectV2PlaybackAtom } from "@/store/effect-v2";
import { useEffectTexture } from "../../useEffectTexture";
import { getMappedUVs, getThreeJSBlendFromD3D, findFrame, lerp, pkoVec } from "../../helpers";

interface RectPlaneProps {
  subEffect: SubEffect;
  onComplete?: () => void;
}

/** A textured quad driven by a sub-effect's keyframe data. */
export function RectPlane({ subEffect, onComplete }: RectPlaneProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const groupRef = useRef<THREE.Group>(null);
  const playback = useAtomValue(effectV2PlaybackAtom);

  // Always point to the latest onComplete without re-subscribing useFrame
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  // Guard: fire onComplete only once per mount
  const firedRef = useRef(false);

  const { frameCount, frameTimes, frameSizes, framePositions, frameColors, texList, verCount } = subEffect;

  // Build UV attribute from first texList frame (or full-quad default)
  const uvAttr = useMemo(() => {
    if (texList.length > 0 && texList[0].length === verCount && verCount >= 4) {
      const uvs = getMappedUVs(texList[0]);
      return new Float32Array(uvs.flat());
    }
    return new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]);
  }, [texList, verCount]);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array([
      -0.5, 0, -0.5,
      0.5, 0, -0.5,
      0.5, 0, 0.5,
      -0.5, 0, 0.5,
    ]);
    const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uvAttr, 2));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    return geo;
  }, [uvAttr]);

  let totalAnimationDurationSeconds = 0;
  for (let i = 0; i < frameCount; i++) {
    totalAnimationDurationSeconds += frameTimes[i];
  }

  // No keyframes — signal immediately
  useEffect(() => {
    if (frameTimes.length === 0 && !firedRef.current) {
      firedRef.current = true;
      onCompleteRef.current?.();
    }
  }, [frameTimes.length]);

  useFrame(({ camera }) => {
    if (!meshRef.current || !matRef.current || frameTimes.length === 0) return;

    if (groupRef.current) {
      if (subEffect.billboard) {
        const correction = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(1, 0, 0), Math.PI / 2
        );
        groupRef.current.quaternion.copy(camera.quaternion).multiply(correction);
      } else {
        groupRef.current.quaternion.identity();
      }
    }

    // Use shared playback time, loop if enabled
    let t = playback.time;
    if (totalAnimationDurationSeconds > 0) {
      if (playback.loop) {
        t = t % totalAnimationDurationSeconds;
      } else {
        t = Math.min(t, totalAnimationDurationSeconds);
      }
    }

    // Signal completion once when the non-looping animation reaches its end
    if (!playback.loop && !firedRef.current && playback.time >= totalAnimationDurationSeconds && totalAnimationDurationSeconds > 0) {
      firedRef.current = true;
      onCompleteRef.current?.();
    }

    const { frameIdx, localT } = findFrame(frameTimes, t);
    const nextIdx = Math.min(frameIdx + 1, frameTimes.length - 1);
    const frac = frameTimes[frameIdx] > 0 ? localT / frameTimes[frameIdx] : 0;

    // Interpolate position
    if (framePositions.length > frameIdx) {
      const p0 = pkoVec(framePositions[frameIdx]);
      const p1 = pkoVec(framePositions[nextIdx] ?? p0);
      meshRef.current.position.set(
        lerp(p0[0], p1[0], frac),
        lerp(p0[1], p1[1], frac),
        lerp(p0[2], p1[2], frac),
      );
    }

    // Interpolate scale
    if (frameSizes.length > frameIdx) {
      const s0 = pkoVec(frameSizes[frameIdx]);
      const s1 = pkoVec(frameSizes[nextIdx] ?? s0);
      meshRef.current.scale.set(
        lerp(s0[0], s1[0], frac),
        lerp(s0[1], s1[1], frac),
        lerp(s0[2], s1[2], frac),
      );
    }

    // Interpolate color + alpha
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
  });

  const texture = useEffectTexture(subEffect.texName);
  const blendSrc = getThreeJSBlendFromD3D(subEffect.srcBlend);
  const blendDst = getThreeJSBlendFromD3D(subEffect.destBlend);

  return (
    <group ref={groupRef}>
      <mesh
        ref={meshRef}
        geometry={geometry}
      >
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
