import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { SubEffect } from "@/types/effect";
import { useTimeSource } from "../TimeContext";
import { useEffectTexture } from "../useEffectTexture";
import { getThreeJSBlendFromD3D } from "../helpers";
import {
  resolveGeometry,
  createRectGeometry,
  createRectPlaneGeometry,
  createRectZGeometry,
  createTriangleGeometry,
  createTrianglePlaneGeometry,
  createCylinderGeometry,
} from "@/features/effect/rendering";
import { interpolateFrame } from "@/features/effect/animation";
import { applySubEffectFrame } from "@/features/effect/applySubEffectFrame";

interface SubEffectRendererProps {
  subEffect: SubEffect;
  onComplete?: () => void;
}

/**
 * Unified sub-effect renderer using V1's proven rendering pipeline.
 *
 * Uses resolveGeometry() for geometry creation, interpolateFrame() for keyframe
 * interpolation, and applySubEffectFrame() for per-frame transform application.
 * No more per-model-type component routing or drei Billboard component.
 */
export function SubEffectRenderer({ subEffect, onComplete }: SubEffectRendererProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const timeSource = useTimeSource();
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const firedRef = useRef(false);
  const cylinderCacheRef = useRef(new Map<string, Float32Array>());

  // Resolve geometry from model name using V1's exact function
  const geometry = useMemo(() => {
    const config = resolveGeometry(subEffect);
    switch (config.type) {
      case "rect":
        return createRectGeometry();
      case "rectPlane":
        return createRectPlaneGeometry();
      case "rectZ":
        return createRectZGeometry();
      case "triangle":
        return createTriangleGeometry();
      case "trianglePlane":
        return createTrianglePlaneGeometry();
      case "cylinder":
        return createCylinderGeometry(
          config.topRadius,
          config.botRadius,
          config.height,
          config.segments,
        );
      case "sphere": {
        return new THREE.SphereGeometry(0.5, 24, 24);
      }
      case "model":
        return null; // external .lgo, not supported yet
      default:
        return createRectGeometry(); // default to rect like C++
    }
  }, [
    subEffect.modelName,
    subEffect.topRadius,
    subEffect.botRadius,
    subEffect.height,
    subEffect.segments,
    subEffect.useParam,
  ]);

  // Load texture
  const texture = useEffectTexture(subEffect.texName);

  // Compute total duration
  const totalDuration = useMemo(() => {
    let total = 0;
    for (let i = 0; i < subEffect.frameCount; i++) {
      total += subEffect.frameTimes[i] || 1 / 30;
    }
    return total;
  }, [subEffect.frameCount, subEffect.frameTimes]);

  // Material setup
  const material = useMemo(() => {
    const blendSrc = getThreeJSBlendFromD3D(subEffect.srcBlend);
    const blendDst = getThreeJSBlendFromD3D(subEffect.destBlend);
    return new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendSrc,
      blendDst,
    });
  }, [subEffect.srcBlend, subEffect.destBlend]);

  // Update texture on material
  useEffect(() => {
    material.map = texture;
    material.needsUpdate = true;
  }, [texture, material]);

  // Signal completion when no keyframes
  useEffect(() => {
    if (subEffect.frameTimes.length === 0 && !firedRef.current) {
      firedRef.current = true;
      onCompleteRef.current?.();
    }
  }, [subEffect.frameTimes.length]);

  // No geometry = external model, can't render
  useEffect(() => {
    if (!geometry && !firedRef.current) {
      firedRef.current = true;
      onCompleteRef.current?.();
    }
  }, [geometry]);

  // Determine if geometry is a cylinder (needed for deformable mesh check)
  const isCylinder = useMemo(() => {
    return resolveGeometry(subEffect).type === "cylinder";
  }, [subEffect.modelName]);

  // Per-frame rendering using V1's interpolateFrame + applySubEffectFrame
  useFrame(({ camera }) => {
    if (!meshRef.current || !geometry || subEffect.frameTimes.length === 0) return;

    let t = timeSource.getTime();
    if (totalDuration > 0) {
      if (timeSource.loop) {
        t = t % totalDuration;
      } else {
        t = Math.min(t, totalDuration);
      }
    }

    // Completion check
    if (
      !timeSource.loop &&
      !firedRef.current &&
      timeSource.getTime() >= totalDuration &&
      totalDuration > 0
    ) {
      firedRef.current = true;
      onCompleteRef.current?.();
    }

    // Use V1's interpolateFrame for accurate keyframe interpolation
    const frame = interpolateFrame(subEffect, t, timeSource.loop);

    // Use V1's applySubEffectFrame for accurate transform application
    // This handles: position, scale, rotation, rotaLoop, billboard, color, UV animation
    applySubEffectFrame(meshRef.current, camera, {
      sub: subEffect,
      position: frame.position,
      scale: frame.size,
      angle: frame.angle,
      color: frame.color,
      playbackTime: t,
      frameIndex: frame.frameIndex,
      nextFrameIndex: frame.nextFrameIndex,
      lerp: frame.lerp,
      isCylinder,
      cylinderCache: cylinderCacheRef.current,
    });
  });

  if (!geometry) return null;

  return <mesh ref={meshRef} geometry={geometry} material={material} />;
}
