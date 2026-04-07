import { SubEffect } from '@/types/effect';
import { useMemo, useRef, useEffect } from 'react';
import * as THREE from 'three';
import { getThreeJSBlendFromD3D, findFrame, lerp } from '../../helpers';
import { useEffectTexture } from '../../useEffectTexture';
import { useFrame } from '@react-three/fiber';
import { useTimeSource } from '../../TimeContext';

interface CylinderProps {
  subEffect: SubEffect;
  onComplete?: () => void;
}

export function Cylinder({ subEffect, onComplete }: CylinderProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const groupRef = useRef<THREE.Group>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const timeSource = useTimeSource();

  // Always point to the latest onComplete without re-subscribing useFrame
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  // Guard: fire onComplete only once per mount
  const firedRef = useRef(false);

  const {
    segments,
    height,
    topRadius,
    botRadius,
    frameTimes,
    frameAngles,
    frameColors,
    frameCount,
    framePositions,
    frameSizes,
    alpha
  } = subEffect;

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const vertices = [];
    const uvAttr = [];
    const indicesArr = [];

    for (let i = 0; i <= segments; i++) {
      const xTop = topRadius * Math.sin(i * (2 * Math.PI) / segments);
      const zTop = topRadius * Math.cos(i * (2 * Math.PI) / segments);

      const xBot = botRadius * Math.sin(i * (2 * Math.PI) / segments);
      const zBot = botRadius * Math.cos(i * (2 * Math.PI) / segments);

      vertices.push(xTop, height, zTop);
      vertices.push(xBot, 0.0, zBot);

      uvAttr.push(1 - (i / segments), 0.0);
      uvAttr.push(1 - (i / segments), 1.0);
    }

    for (let i = 0; i < segments; i++) {
      const top = i * 2;
      const bottom = top + 1;
      const nextTop = top + 2;
      const nextBot = top + 3;
      indicesArr.push(top, bottom, nextTop);
      indicesArr.push(bottom, nextTop, nextBot);
    }

    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
    geo.setIndex(new THREE.BufferAttribute(new Uint16Array(indicesArr), 1));
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uvAttr), 2));

    return geo;
  }, []);

  const texture = useEffectTexture(subEffect.texName);
  if (texture) {
    texture.flipY = false;
  }
  const blendSrc = getThreeJSBlendFromD3D(subEffect.srcBlend);
  const blendDst = getThreeJSBlendFromD3D(subEffect.destBlend);

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

  useFrame(() => {
    if (!meshRef.current || !matRef.current || frameTimes.length === 0) {
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

    // Signal completion once when the non-looping animation reaches its end
    if (!timeSource.loop && !firedRef.current && timeSource.getTime() >= totalAnimationDurationSeconds && totalAnimationDurationSeconds > 0) {
      firedRef.current = true;
      onCompleteRef.current?.();
    }

    const { frameIdx, localT } = findFrame(frameTimes, t);
    const nextFrameIdx = Math.min(frameIdx + 1, frameTimes.length - 1);
    const frac = frameTimes[frameIdx] > 0 ? localT / frameTimes[frameIdx] : 0;

    // Interpolate position
    if (framePositions.length > frameIdx) {
      const p0 = framePositions[frameIdx];
      const p1 = framePositions[nextFrameIdx] ?? p0;
      meshRef.current.position.set(
        lerp(p0[0], p1[0], frac),
        lerp(p0[1], p1[1], frac),
        lerp(p0[2], p1[2], frac),
      );
    }
    // Interpolate scale
    if (frameSizes.length > frameIdx) {
      const s0 = frameSizes[frameIdx];
      const s1 = frameSizes[nextFrameIdx] ?? s0;
      meshRef.current.scale.set(
        lerp(s0[0], s1[0], frac),
        lerp(s0[1], s1[1], frac),
        lerp(s0[2], s1[2], frac),
      );
    }
    // Interpolate color + alpha
    if (frameColors.length > frameIdx) {
      const c0 = frameColors[frameIdx];
      const c1 = frameColors[nextFrameIdx] ?? c0;
      matRef.current.color.setRGB(
        lerp(c0[0], c1[0], frac),
        lerp(c0[1], c1[1], frac),
        lerp(c0[2], c1[2], frac),
      );
      matRef.current.opacity = lerp(c0[3], c1[3], frac);
    }

    // Interpolate angles
    if (frameAngles.length > frameIdx) {
      const a0 = frameAngles[frameIdx];
      const a1 = frameAngles[nextFrameIdx] ?? a0;
      meshRef.current.rotation.set(
        lerp(a0[0], a1[0], frac),
        lerp(a0[1], a1[1], frac),
        lerp(a0[2], a1[2], frac),
        "YXZ",
      );
    }
  });

  return (
    <group ref={groupRef}>
      <mesh
        ref={meshRef}
        geometry={geometry}
      >
        <meshBasicMaterial
          ref={matRef}
          map={texture}
          transparent={alpha}
          color="#ffffff"
          blending={THREE.CustomBlending}
          side={THREE.DoubleSide}
          depthWrite={false}
          blendSrc={blendSrc}
          blendDst={blendDst}
        />
      </mesh>
    </group>
  );
}
