import { useRef, useMemo, useEffect, useState, useContext } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { SubEffect } from "@/types/effect";
import { currentProjectAtom } from "@/store/project";
import { useAtomValue } from "jotai";
import { useTimeSource } from "../TimeContext";
import { useEffectTexture } from "../useEffectTexture";
import { resolveFrameTextureName } from "../frameTexture";
import { useEffectModel } from "@/features/effect/useEffectModel";
import {
  resolveGeometry,
  createRectGeometry,
  createRectPlaneGeometry,
  createRectZGeometry,
  createTriangleGeometry,
  createTrianglePlaneGeometry,
  createCylinderGeometry,
} from "@/features/effect/rendering";
import { getFrameDurations, interpolateFrame } from "@/features/effect/animation";
import { applySubEffectFrame } from "@/features/effect/applySubEffectFrame";
import { buildEffectMaterialProps } from "@/features/effect/buildEffectMaterialProps";
import {
  applyTextureSampling,
  composePkoRenderState,
} from "@/features/effect/pkoStateEmulation";
import { ParticleOpacityContext } from "./particles/particleOpacityContext";

interface SubEffectRendererProps {
  subEffect: SubEffect;
  idxTech?: number;
  onComplete?: () => void;
}

/**
 * Unified sub-effect renderer using V1's proven rendering pipeline.
 *
 * Uses resolveGeometry() for geometry creation, interpolateFrame() for keyframe
 * interpolation, and applySubEffectFrame() for per-frame transform application.
 * No more per-model-type component routing or drei Billboard component.
 */
export function SubEffectRenderer({ subEffect, idxTech = 0, onComplete }: SubEffectRendererProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const timeSource = useTimeSource();
  const particleOpacityScale = useContext(ParticleOpacityContext);
  const currentProject = useAtomValue(currentProjectAtom);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const firedRef = useRef(false);
  const cylinderCacheRef = useRef(new Map<string, Float32Array>());

  // Resolve geometry from model name using V1's exact function
  const geometryConfig = useMemo(() => {
    return resolveGeometry(subEffect);
  }, [
    subEffect.modelName,
    subEffect.topRadius,
    subEffect.botRadius,
    subEffect.height,
    subEffect.segments,
    subEffect.useParam,
  ]);

  const builtinGeometry = useMemo(() => {
    const config = geometryConfig;
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
          config.bottomUvV,
        );
      case "model":
        return null;
      default:
        return createRectGeometry(); // default to rect like C++
    }
  }, [
    geometryConfig,
  ]);

  const modelGeometry = useEffectModel(
    geometryConfig.type === "model" ? geometryConfig.modelName : undefined,
    currentProject?.id,
  );

  const geometry = builtinGeometry ?? modelGeometry;

  // Compute total duration
  const totalDuration = useMemo(() => {
    return getFrameDurations(subEffect).reduce((total, duration) => total + duration, 0);
  }, [subEffect]);

  const getLocalPlaybackTime = (rawTime: number): number => {
    if (totalDuration <= 0) return rawTime;
    if (timeSource.loop) return rawTime % totalDuration;
    return Math.min(rawTime, totalDuration);
  };

  const [activeTextureName, setActiveTextureName] = useState(() =>
    resolveFrameTextureName(
      subEffect,
      getLocalPlaybackTime(timeSource.getTime()),
      timeSource.loop,
    )
  );

  useEffect(() => {
    setActiveTextureName(resolveFrameTextureName(
      subEffect,
      getLocalPlaybackTime(timeSource.getTime()),
      timeSource.loop,
    ));
  }, [subEffect, timeSource, totalDuration]);

  // Load texture. EFFECT_FRAMETEX uses the currently active frame texture,
  // matching the C++ path that swaps the whole texture through GetLerpFrame.
  const texture = useEffectTexture(activeTextureName);
  const waitingForTexture = Boolean(currentProject && activeTextureName.trim() && !texture);

  const techniqueState = useMemo(() =>
    composePkoRenderState(idxTech, {
      srcBlend: subEffect.srcBlend || undefined,
      destBlend: subEffect.destBlend || undefined,
    }),
  [idxTech, subEffect.srcBlend, subEffect.destBlend]);

  useEffect(() => {
    applyTextureSampling(texture, techniqueState);
  }, [texture, techniqueState]);

  const material = useMemo(() => new THREE.MeshBasicMaterial(
    buildEffectMaterialProps(subEffect, texture, techniqueState),
  ), [subEffect, texture, techniqueState]);

  // Signal completion when no keyframes
  useEffect(() => {
    if (subEffect.frameTimes.length === 0 && !firedRef.current) {
      firedRef.current = true;
      onCompleteRef.current?.();
    }
  }, [subEffect.frameTimes.length]);

  // No geometry for built-in primitives means the sub-effect cannot render.
  // External models may still be loading, so do not mark them complete early.
  useEffect(() => {
    if (geometryConfig.type !== "model" && !geometry && !firedRef.current) {
      firedRef.current = true;
      onCompleteRef.current?.();
    }
  }, [geometry, geometryConfig.type]);

  // Determine if geometry is a cylinder (needed for deformable mesh check)
  const isCylinder = useMemo(() => {
    return resolveGeometry(subEffect).type === "cylinder";
  }, [subEffect.modelName]);

  // Per-frame rendering using V1's interpolateFrame + applySubEffectFrame
  useFrame(({ camera }) => {
    const rawTime = timeSource.getTime();
    const localTime = getLocalPlaybackTime(rawTime);
    const nextTextureName = resolveFrameTextureName(subEffect, localTime, timeSource.loop);
    setActiveTextureName((current) =>
      current === nextTextureName ? current : nextTextureName
    );

    if (!meshRef.current || !geometry || subEffect.frameTimes.length === 0) return;

    const t = localTime;

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
      forgeAlpha: particleOpacityScale,
      isCylinder,
      cylinderCache: cylinderCacheRef.current,
    });
  });

  if (!geometry || waitingForTexture) return null;

  return <mesh ref={meshRef} geometry={geometry} material={material} />;
}
