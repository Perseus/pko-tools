/// <reference types="@react-three/fiber" />
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { invoke } from "@tauri-apps/api/core";
import * as THREE from "three";
import type { SubEffect, Vec3 } from "@/types/effect";
import {
  createEffectTexture,
  resolveBlendFactors,
  resolveGeometry,
  resolveTextureCandidates,
  resolveTextureName,
  subEffectVertexShader,
  subEffectFragmentShader,
} from "@/features/effect/rendering";
import { interpolateFrame } from "@/features/effect/animation";
import { composePkoRenderState } from "@/features/effect/pkoStateEmulation";

type DecodedTexture = {
  width: number;
  height: number;
  data: string;
};

interface HitSubEffectProps {
  subEffect: SubEffect;
  position: Vec3;
  elapsed: number;
  projectDir: string;
  idxTech: number;
}

/**
 * Lightweight props-driven R3F component for rendering a single sub-effect
 * at a hit effect position. No global atom dependencies.
 */
export default function HitSubEffect({
  subEffect,
  position,
  elapsed,
  projectDir,
  idxTech,
}: HitSubEffectProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const textureRef = useRef<THREE.Texture | null>(null);

  const geometry = useMemo(
    () => resolveGeometry(subEffect),
    [subEffect],
  );

  // Load texture once per sub-effect
  useEffect(() => {
    const texName = resolveTextureName(subEffect, 0)?.trim();
    if (!texName || !projectDir) {
      setTexture(null);
      return;
    }

    const isTauri =
      typeof window !== "undefined" &&
      ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);
    if (!isTauri) {
      setTexture(null);
      return;
    }

    const candidates = resolveTextureCandidates(texName, projectDir);
    let isActive = true;

    const tryLoad = async (index: number) => {
      if (index >= candidates.length) {
        setTexture(null);
        return;
      }
      try {
        const decoded = await invoke<DecodedTexture>("decode_texture", {
          path: candidates[index],
        });
        if (!isActive) return;
        const binary = Uint8Array.from(atob(decoded.data), (c) =>
          c.charCodeAt(0),
        );
        const loaded = createEffectTexture(binary, decoded.width, decoded.height);
        textureRef.current?.dispose();
        textureRef.current = loaded;
        setTexture(loaded);
      } catch {
        void tryLoad(index + 1);
      }
    };

    void tryLoad(0);
    return () => {
      isActive = false;
      textureRef.current?.dispose();
    };
  }, [subEffect, projectDir]);

  // Interpolate animation
  const interpolated = useMemo(
    () => interpolateFrame(subEffect, elapsed, false),
    [subEffect, elapsed],
  );

  const techniqueState = useMemo(
    () => composePkoRenderState(idxTech, {
      srcBlend: subEffect.srcBlend || undefined,
      destBlend: subEffect.destBlend || undefined,
    }),
    [idxTech, subEffect.srcBlend, subEffect.destBlend],
  );

  const blendFactors = useMemo(
    () => resolveBlendFactors(subEffect.srcBlend || 5, subEffect.destBlend || 6),
    [subEffect.srcBlend, subEffect.destBlend],
  );

  const useAlpha = subEffect.alpha !== false;
  const techAlphaTest = techniqueState.alphaTestEnable
    ? (techniqueState.alphaFunc === 6 ? 1 / 255 : 0)
    : 0;

  // Update uniforms per frame
  useFrame(() => {
    if (!meshRef.current) return;
    const mat = meshRef.current.material as THREE.ShaderMaterial;
    if (!mat.uniforms) return;

    const color = interpolated.color;
    mat.uniforms.uColor.value.setRGB(color[0], color[1], color[2]);
    mat.uniforms.uOpacity.value = useAlpha ? Math.max(color[3], 0) : 1;
    mat.uniforms.uTexture.value = texture;
    mat.uniforms.uHasTexture.value = texture !== null;
  });

  // Per-sub-effect duration cutoff
  if (subEffect.length > 0 && elapsed > subEffect.length) {
    return null;
  }

  const materialColor = new THREE.Color(
    interpolated.color[0],
    interpolated.color[1],
    interpolated.color[2],
  );
  const opacity = Math.max(Math.min(interpolated.color[3], 1), 0);

  return (
    <mesh
      ref={meshRef}
      position={[
        position[0] + interpolated.position[0],
        position[1] + interpolated.position[1],
        position[2] + interpolated.position[2],
      ]}
      rotation={new THREE.Euler(
        interpolated.angle[0],
        interpolated.angle[1],
        interpolated.angle[2],
        "YXZ",
      )}
      scale={[
        interpolated.size[0] || 1,
        interpolated.size[1] || 1,
        interpolated.size[2] || 1,
      ]}
    >
      {geometry.type === "plane" && <planeGeometry args={[1, 1]} />}
      {geometry.type === "cylinder" && (
        <cylinderGeometry
          args={[
            geometry.topRadius ?? 0.5,
            geometry.botRadius ?? 0.5,
            geometry.height ?? 1.0,
            geometry.segments ?? 16,
          ]}
        />
      )}
      {geometry.type === "sphere" && <sphereGeometry args={[0.7, 24, 24]} />}
      {(geometry.type === "rect" || geometry.type === "rectZ" ||
        geometry.type === "triangle" || geometry.type === "triangleZ") && (
        <planeGeometry args={[1, 1]} />
      )}
      {geometry.type === "model" && <boxGeometry args={[0.5, 0.5, 0.5]} />}
      <shaderMaterial
        vertexShader={subEffectVertexShader}
        fragmentShader={subEffectFragmentShader}
        transparent={useAlpha || techAlphaTest > 0}
        toneMapped={false}
        fog={false}
        blending={useAlpha ? THREE.CustomBlending : THREE.NormalBlending}
        blendSrc={blendFactors.blendSrc}
        blendDst={blendFactors.blendDst}
        depthTest={techniqueState.zEnable}
        depthWrite={techniqueState.zWriteEnable || !useAlpha}
        side={THREE.DoubleSide}
        uniforms={{
          uColor: { value: materialColor },
          uOpacity: { value: useAlpha ? opacity : 1 },
          uTexture: { value: texture },
          uHasTexture: { value: texture !== null },
          uAlphaTest: { value: techAlphaTest },
        }}
      />
    </mesh>
  );
}
