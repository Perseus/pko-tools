/// <reference types="@react-three/fiber" />
import {
  effectDataAtom,
  effectTextureReloadAtom,
  effectTextureStatusAtom,
  selectedFrameIndexAtom,
  selectedSubEffectIndexAtom,
} from "@/store/effect";
import { currentProjectAtom } from "@/store/project";
import { useAtom, useAtomValue } from "jotai";
import React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { convertFileSrc } from "@tauri-apps/api/core";
import * as THREE from "three";
import {
  resolveBlendMode,
  resolveFrameData,
  resolveGeometryType,
  resolveTextureCandidates,
  resolveTextureName,
} from "@/features/effect/rendering";

const DEFAULT_COLOR = new THREE.Color("#f4f0e6");

export default function EffectMeshRenderer() {
  const effectData = useAtomValue(effectDataAtom);
  const currentProject = useAtomValue(currentProjectAtom);
  const [, setTextureStatus] = useAtom(effectTextureStatusAtom);
  const [reloadToken] = useAtom(effectTextureReloadAtom);
  const selectedSubEffectIndex = useAtomValue(selectedSubEffectIndexAtom);
  const selectedFrameIndex = useAtomValue(selectedFrameIndexAtom);

  const frameData = useMemo(
    () => resolveFrameData(effectData, selectedSubEffectIndex, selectedFrameIndex),
    [effectData, selectedSubEffectIndex, selectedFrameIndex]
  );

  if (!frameData) {
    return null;
  }

  const { subEffect, size, angle, position, color } = frameData;
  const materialColor = new THREE.Color(color[0], color[1], color[2]);
  const opacity = Math.min(Math.max(color[3], 0), 1);
  const meshRef = useRef<THREE.Mesh>(null);
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const textureRef = useRef<THREE.Texture | null>(null);

  const geometryType = resolveGeometryType(subEffect.effectType);

  const blendingMode = useMemo(() => {
    return resolveBlendMode(subEffect.srcBlend, subEffect.destBlend) === "additive"
      ? THREE.AdditiveBlending
      : THREE.NormalBlending;
  }, [subEffect.srcBlend, subEffect.destBlend]);

  const textureName = useMemo(
    () => resolveTextureName(subEffect, selectedFrameIndex),
    [selectedFrameIndex, subEffect]
  );

  useEffect(() => {
    if (!textureName || !currentProject) {
      setTexture(null);
      setTextureStatus({ status: "idle", textureName: null });
      return;
    }

    const sanitized = textureName.trim();
    if (!sanitized) {
      setTexture(null);
      setTextureStatus({ status: "idle", textureName: null });
      return;
    }

    const candidates = resolveTextureCandidates(sanitized, currentProject.projectDirectory);

    let isActive = true;
    const loader = new THREE.TextureLoader();
    setTextureStatus({ status: "loading", textureName: sanitized });

    const tryLoad = (index: number) => {
      if (index >= candidates.length) {
        setTexture(null);
        setTextureStatus({ status: "error", textureName: sanitized });
        return;
      }

      const url = convertFileSrc(candidates[index]);
      loader.load(
        url,
        (loaded) => {
          if (!isActive) {
            loaded.dispose();
            return;
          }
          textureRef.current?.dispose();
          loaded.wrapS = THREE.RepeatWrapping;
          loaded.wrapT = THREE.RepeatWrapping;
          loaded.needsUpdate = true;
          textureRef.current = loaded;
          setTexture(loaded);
          setTextureStatus({ status: "loaded", textureName: sanitized });
        },
        undefined,
        () => {
          tryLoad(index + 1);
        }
      );
    };

    tryLoad(0);

    return () => {
      isActive = false;
      textureRef.current?.dispose();
    };
  }, [textureName, currentProject, reloadToken, setTextureStatus]);

  useFrame((state: { camera: THREE.Camera }) => {
    if (subEffect.billboard || subEffect.rotaBoard) {
      meshRef.current?.lookAt(state.camera.position);
    }
  });

  return (
    <group>
      <mesh
        ref={meshRef}
        position={position}
        rotation={[angle[0], angle[1], angle[2]]}
        scale={[size[0] || 1, size[1] || 1, size[2] || 1]}
      >
        {(geometryType === "plane" || subEffect.billboard || subEffect.rotaBoard) && (
          <planeGeometry args={[1.4, 1.4]} />
        )}
        {geometryType === "ring" && <ringGeometry args={[0.3, 0.8, 32]} />}
        {geometryType === "box" && <boxGeometry args={[1, 1, 1]} />}
        {geometryType === "model" && <cylinderGeometry args={[0.6, 0.3, 1.4, 24]} />}
        {geometryType === "spark" && <icosahedronGeometry args={[0.6, 0]} />}
        <meshStandardMaterial
          color={materialColor}
          emissive={DEFAULT_COLOR}
          emissiveIntensity={0.3}
          transparent
          opacity={opacity}
          metalness={0.05}
          roughness={0.35}
          blending={blendingMode}
          depthWrite={false}
          map={texture ?? undefined}
          alphaTest={0.1}
        />
      </mesh>
    </group>
  );
}
