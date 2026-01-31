import { effectDataAtom, selectedFrameIndexAtom, selectedSubEffectIndexAtom } from "@/store/effect";
import { useAtomValue } from "jotai";
import { useMemo } from "react";
import * as THREE from "three";

const DEFAULT_COLOR = new THREE.Color("#f4f0e6");

export default function EffectMeshRenderer() {
  const effectData = useAtomValue(effectDataAtom);
  const selectedSubEffectIndex = useAtomValue(selectedSubEffectIndexAtom);
  const selectedFrameIndex = useAtomValue(selectedFrameIndexAtom);

  const frameData = useMemo(() => {
    if (!effectData || selectedSubEffectIndex === null) {
      return null;
    }

    const subEffect = effectData.subEffects[selectedSubEffectIndex];
    if (!subEffect) {
      return null;
    }

    const frameIndex = Math.min(
      Math.max(selectedFrameIndex, 0),
      Math.max(subEffect.frameCount - 1, 0)
    );

    return {
      subEffect,
      size: subEffect.frameSizes[frameIndex] ?? [1, 1, 1],
      angle: subEffect.frameAngles[frameIndex] ?? [0, 0, 0],
      position: subEffect.framePositions[frameIndex] ?? [0, 0, 0],
      color: subEffect.frameColors[frameIndex] ?? [1, 1, 1, 1],
    };
  }, [effectData, selectedSubEffectIndex, selectedFrameIndex]);

  if (!frameData) {
    return null;
  }

  const { subEffect, size, angle, position, color } = frameData;
  const materialColor = new THREE.Color(color[0], color[1], color[2]);
  const opacity = color[3];

  const geometryType = (() => {
    switch (subEffect.effectType) {
      case 1:
        return "plane";
      case 2:
        return "ring";
      case 3:
        return "box";
      case 4:
        return "model";
      default:
        return "spark";
    }
  })();

  return (
    <group>
      <mesh
        position={position}
        rotation={[angle[0], angle[1], angle[2]]}
        scale={[size[0] || 1, size[1] || 1, size[2] || 1]}
      >
        {geometryType === "plane" && <planeGeometry args={[1.4, 1.4]} />}
        {geometryType === "ring" && <ringGeometry args={[0.3, 0.8, 32]} />}
        {geometryType === "box" && <boxGeometry args={[1, 1, 1]} />}
        {geometryType === "model" && <cylinderGeometry args={[0.6, 0.3, 1.4, 24]} />}
        {geometryType === "spark" && <icosahedronGeometry args={[0.6, 0]} />}
        <meshStandardMaterial
          color={materialColor}
          emissive={DEFAULT_COLOR}
          emissiveIntensity={0.2}
          transparent
          opacity={opacity}
          metalness={0.1}
          roughness={0.4}
        />
      </mesh>
    </group>
  );
}
