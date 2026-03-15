import { SubEffect } from "@/types/effect";
import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { useAtomValue } from "jotai";
import * as THREE from "three";
import { effectV2PlaybackAtom } from "@/store/effect-v2";
import { useEffectTexture } from "../../useEffectTexture";
import { getMappedUVs, getThreeJSBlendFromD3D } from "../../helpers";

interface RectPlaneProps {
  subEffect: SubEffect;
}

/** A textured quad driven by a sub-effect's keyframe data. */
export function RectPlane({ subEffect }: RectPlaneProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const groupRef = useRef<THREE.Group>(null);
  const playback = useAtomValue(effectV2PlaybackAtom);

  const { frameTimes, frameSizes, framePositions, frameColors, texList, verCount } = subEffect;
  const totalLength = subEffect.length;

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
      -0.5, -0.5, 0,
      0.5, -0.5, 0,
      0.5, 0.5, 0,
      -0.5, 0.5, 0,
    ]);
    const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uvAttr, 2));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    return geo;
  }, [uvAttr]);

  useFrame(({ camera }) => {
    if (!meshRef.current || !matRef.current || frameTimes.length === 0) return;

    if (groupRef.current && subEffect.billboard) {
      groupRef.current.quaternion.copy(camera.quaternion);
    }

    // Use shared playback time, loop if enabled
    let t = playback.time;
    if (totalLength > 0 && playback.loop) {
      t = t % totalLength;
    } else if (totalLength > 0) {
      t = Math.min(t, totalLength);
    }
    const frameIdx = findFrame(frameTimes, t);
    const nextIdx = Math.min(frameIdx + 1, frameTimes.length - 1);
    const frac = frameTimes[nextIdx] !== frameTimes[frameIdx]
      ? (t - frameTimes[frameIdx]) / (frameTimes[nextIdx] - frameTimes[frameIdx])
      : 0;

    // Interpolate position
    if (framePositions.length > frameIdx) {
      const p0 = framePositions[frameIdx];
      const p1 = framePositions[nextIdx] ?? p0;
      meshRef.current.position.set(
        lerp(p0[0], p1[0], frac),
        lerp(p0[1], p1[1], frac),
        lerp(p0[2], p1[2], frac),
      );
    }

    // Interpolate scale
    if (frameSizes.length > frameIdx) {
      const s0 = frameSizes[frameIdx];
      const s1 = frameSizes[nextIdx] ?? s0;
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

/** Find the keyframe index for time t (last frame where frameTimes[i] <= t). */
function findFrame(frameTimes: number[], t: number): number {
  for (let i = frameTimes.length - 1; i >= 0; i--) {
    if (frameTimes[i] <= t) return i;
  }
  return 0;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
