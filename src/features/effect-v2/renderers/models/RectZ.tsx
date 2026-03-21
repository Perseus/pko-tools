import { SubEffect } from "@/types/effect";
import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard } from "@react-three/drei";
import * as THREE from "three";
import { useTimeSource } from "../../TimeContext";
import { useEffectTexture } from "../../useEffectTexture";
import { getMappedUVs, getThreeJSBlendFromD3D, findFrame, lerp, d3dYawPitchRollQuaternion } from "../../helpers";

interface RectZProps {
  subEffect: SubEffect;
  onComplete?: () => void;
}

/**
 * "RectZ" mesh — a vertical quad in the YZ plane.
 *
 * C++ CreateRectZ() vertices (PKO Z-up):
 *   (0, 0, 0), (0, 0, 1), (0, 1, 1), (0, 1, 0)
 *
 * After Y↔Z swap for Three.js (Y-up):
 *   (0, 0, 0), (0, 1, 0), (0, 1, 1), (0, 0, 1)
 *
 * This is a vertical quad in the YZ plane at X=0.
 */
export function RectZ({ subEffect, onComplete }: RectZProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const timeSource = useTimeSource();

  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const firedRef = useRef(false);

  const { frameCount, frameTimes, frameSizes, framePositions, frameColors, texList, verCount, frameAngles } = subEffect;

  const uvAttr = useMemo(() => {
    if (texList.length > 0 && texList[0].length === verCount && verCount >= 4) {
      const uvs = getMappedUVs(texList[0]);
      return new Float32Array(uvs.flat());
    }
    // C++ UVs: (0,1), (0,0), (1,0), (1,1)
    return new Float32Array([0, 1, 0, 0, 1, 0, 1, 1]);
  }, [texList, verCount]);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    // C++ CreateRectZ: YZ plane (PKO Z-up native)
    const positions = new Float32Array([
      0, 0, 0,
      0, 0, 1,
      0, 1, 1,
      0, 1, 0,
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
      d3dYawPitchRollQuaternion(
        lerp(a0[0], a1[0], frac),
        lerp(a0[1], a1[1], frac),
        lerp(a0[2], a1[2], frac),
        meshRef.current.quaternion
      );
    }
  });

  const texture = useEffectTexture(subEffect.texName);
  const blendSrc = getThreeJSBlendFromD3D(subEffect.srcBlend);
  const blendDst = getThreeJSBlendFromD3D(subEffect.destBlend);

  const meshContent = (
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
  );

  if (subEffect.billboard) {
    return (
      <Billboard>
        <group rotation={[Math.PI / 2, 0, 0]}>
          {meshContent}
        </group>
      </Billboard>
    );
  }

  return <group>{meshContent}</group>;
}
