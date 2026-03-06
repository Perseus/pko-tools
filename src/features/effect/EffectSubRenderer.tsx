/// <reference types="@react-three/fiber" />
import {
  boundBoneMatrixAtom,
  effectDataAtom,
  effectDirtyAtom,
  effectPlaybackAtom,
  effectTextureReloadAtom,
  effectTextureStatusAtom,
  selectedFrameIndexAtom,
  selectedSubEffectIndexAtom,
} from "@/store/effect";
import { gizmoModeAtom } from "@/store/gizmo";
import { currentProjectAtom } from "@/store/project";
import { useAtom, useAtomValue } from "jotai";
import React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { PivotControls } from "@react-three/drei";
import { invokeTimed as invoke } from "@/commands/invokeTimed";
import * as THREE from "three";
import {
  createEffectTexture,
  createRectGeometry,
  createRectPlaneGeometry,
  createRectZGeometry,
  createTriangleGeometry,
  createTrianglePlaneGeometry,
  createCylinderGeometry,
  resolveFrameData,
  resolveGeometry,
  resolveTextureCandidates,
  resolveTextureName,
} from "@/features/effect/rendering";
import {
  composePkoRenderState,
  applyTextureSampling,
  type PkoTechniqueState,
} from "@/features/effect/pkoStateEmulation";
import { interpolateFrame } from "@/features/effect/animation";
import { applySubEffectFrame } from "@/features/effect/applySubEffectFrame";
import { buildEffectMaterialProps } from "@/features/effect/buildEffectMaterialProps";
import { useEffectHistory } from "@/features/effect/useEffectHistory";
import { useEffectModel } from "@/features/effect/useEffectModel";
import { usePlaybackClock } from "@/features/effect/playbackClock";

type DecodedTexture = {
  width: number;
  height: number;
  data: string; // base64-encoded RGBA pixels
};

/** Minimum opacity in the editor so fully-transparent keyframes remain visible. */
const EDITOR_MIN_OPACITY = 0.15;

// Reusable objects for editor-specific per-frame computation
const _effRotaAxis = new THREE.Vector3();
const _gizmoPos = new THREE.Vector3();
const _gizmoScale = new THREE.Vector3();
const _gizmoQuat = new THREE.Quaternion();
const _gizmoEuler = new THREE.Euler();

type EffectSubRendererProps = {
  subEffectIndex: number;
};

export default function EffectSubRenderer({ subEffectIndex }: EffectSubRendererProps) {
  const effectData = useAtomValue(effectDataAtom);
  const [, setEffectData] = useAtom(effectDataAtom);
  const [, setDirty] = useAtom(effectDirtyAtom);
  const currentProject = useAtomValue(currentProjectAtom);
  const playback = useAtomValue(effectPlaybackAtom);
  const [, setTextureStatus] = useAtom(effectTextureStatusAtom);
  const [reloadToken] = useAtom(effectTextureReloadAtom);
  const selectedSubEffectIndex = useAtomValue(selectedSubEffectIndexAtom);
  const selectedFrameIndex = useAtomValue(selectedFrameIndexAtom);
  const gizmoMode = useAtomValue(gizmoModeAtom);
  const playbackTime = usePlaybackClock();
  const { pushSnapshot } = useEffectHistory();

  const isSelected = subEffectIndex === selectedSubEffectIndex;

  const frameData = useMemo(
    () => resolveFrameData(effectData, subEffectIndex, selectedFrameIndex),
    [effectData, subEffectIndex, selectedFrameIndex]
  );
  const meshRef = useRef<THREE.Mesh>(null);
  const groupRef = useRef<THREE.Group>(null);
  const effectGroupRef = useRef<THREE.Group>(null);
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const textureRef = useRef<THREE.Texture | null>(null);
  const boneMatrix = useAtomValue(boundBoneMatrixAtom);
  const snapshotPushed = useRef(false);
  const cylinderPositionCache = useRef<Map<string, Float32Array>>(new Map());

  const subEffect = frameData?.subEffect ?? null;

  const geometry = useMemo(
    () => subEffect ? resolveGeometry(subEffect, selectedFrameIndex) : { type: "plane" as const },
    [subEffect, selectedFrameIndex]
  );

  // Build PKO-correct BufferGeometry for builtin geometry types
  const builtinGeometry = useMemo(() => {
    switch (geometry.type) {
      case "rect": return createRectGeometry();
      case "rectPlane": return createRectPlaneGeometry();
      case "rectZ": return createRectZGeometry();
      case "triangle": return createTriangleGeometry();
      case "trianglePlane": return createTrianglePlaneGeometry();
      case "cylinder": return createCylinderGeometry(
        geometry.topRadius ?? 0.5,
        geometry.botRadius ?? 0.5,
        geometry.height ?? 1.0,
        geometry.segments ?? 16,
      );
      default: return null;
    }
  }, [geometry.type, geometry.topRadius, geometry.botRadius, geometry.height, geometry.segments]);

  const modelGeometry = useEffectModel(
    geometry.type === "model" ? geometry.modelName : undefined,
    currentProject?.id,
  );

  // Compose technique state from idxTech + per-sub-effect blend overrides
  const techniqueState = useMemo((): PkoTechniqueState | null => {
    if (!effectData || !subEffect) return null;
    const overrides: Partial<PkoTechniqueState> = {};
    // Per-sub-effect blend mode overrides technique defaults
    if (subEffect.srcBlend) overrides.srcBlend = subEffect.srcBlend;
    if (subEffect.destBlend) overrides.destBlend = subEffect.destBlend;
    return composePkoRenderState(effectData.idxTech, overrides);
  }, [effectData, subEffect]);

  // Smooth interpolation between keyframes during playback
  const interpolated = useMemo(() => {
    if (!subEffect || !playback.isPlaying) return null;
    return interpolateFrame(subEffect, playbackTime, true);
  }, [subEffect, playback.isPlaying, playbackTime]);

  const textureName = useMemo(() => {
    if (!subEffect) {
      return "";
    }

    // During playback, use the independently-timed texture frame index
    const texIdx = interpolated ? interpolated.texFrameIndex : selectedFrameIndex;
    return resolveTextureName(subEffect, texIdx);
  }, [selectedFrameIndex, subEffect, interpolated]);

  // Use interpolated values when playing, frame-exact values when scrubbing
  const size = interpolated?.size ?? frameData?.size ?? [1, 1, 1] as [number, number, number];
  const angle = interpolated?.angle ?? frameData?.angle ?? [0, 0, 0] as [number, number, number];
  const position = interpolated?.position ?? frameData?.position ?? [0, 0, 0] as [number, number, number];
  const color = interpolated?.color ?? frameData?.color ?? [1, 1, 1, 1] as [number, number, number, number];

  useEffect(() => {
    // Only the selected sub-effect manages global texture status
    if (!isSelected) return;

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

    const isTauriRuntime =
      typeof window !== "undefined" &&
      ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);
    if (!isTauriRuntime) {
      setTexture(null);
      setTextureStatus({ status: "idle", textureName: null });
      return;
    }

    const candidates = resolveTextureCandidates(sanitized, currentProject.projectDirectory);

    let isActive = true;
    setTextureStatus({ status: "loading", textureName: sanitized });

    const tryLoad = async (index: number) => {
      if (index >= candidates.length) {
        setTexture(null);
        setTextureStatus({ status: "error", textureName: sanitized });
        return;
      }

      const candidate = candidates[index];
      try {
        const decoded = await invoke<DecodedTexture>("decode_texture", { path: candidate });
        if (!isActive) {
          return;
        }

        const binary = Uint8Array.from(atob(decoded.data), (char) => char.charCodeAt(0));
        const loaded = createEffectTexture(binary, decoded.width, decoded.height);

        // Apply technique-aware texture sampling (filter + address modes)
        if (techniqueState) {
          applyTextureSampling(loaded, techniqueState);
        }

        textureRef.current?.dispose();
        textureRef.current = loaded;
        setTexture(loaded);
        setTextureStatus({ status: "loaded", textureName: sanitized });
      } catch {
        void tryLoad(index + 1);
      }
    };

    void tryLoad(0);

    return () => {
      isActive = false;
      textureRef.current?.dispose();
    };
  }, [textureName, currentProject, reloadToken, setTextureStatus, isSelected]);

  // Non-selected sub-effects load their own textures independently (no global status)
  useEffect(() => {
    if (isSelected) return; // handled above

    if (!textureName || !currentProject) {
      setTexture(null);
      return;
    }

    const sanitized = textureName.trim();
    if (!sanitized) {
      setTexture(null);
      return;
    }

    const isTauriRuntime =
      typeof window !== "undefined" &&
      ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);
    if (!isTauriRuntime) {
      setTexture(null);
      return;
    }

    const candidates = resolveTextureCandidates(sanitized, currentProject.projectDirectory);

    let isActive = true;

    const tryLoad = async (index: number) => {
      if (index >= candidates.length) {
        setTexture(null);
        return;
      }

      const candidate = candidates[index];
      try {
        const decoded = await invoke<DecodedTexture>("decode_texture", { path: candidate });
        if (!isActive) return;

        const binary = Uint8Array.from(atob(decoded.data), (char) => char.charCodeAt(0));
        const loaded = createEffectTexture(binary, decoded.width, decoded.height);

        if (techniqueState) {
          applyTextureSampling(loaded, techniqueState);
        }

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
  }, [textureName, currentProject, reloadToken, isSelected, techniqueState]);

  useFrame((state: { camera: THREE.Camera }) => {
    // Apply bone binding transform to the outer group (only for selected sub-effect)
    if (groupRef.current && isSelected) {
      if (boneMatrix) {
        groupRef.current.matrix.fromArray(boneMatrix);
        groupRef.current.matrixAutoUpdate = false;
      } else {
        groupRef.current.matrixAutoUpdate = true;
        groupRef.current.matrix.identity();
        groupRef.current.position.set(0, 0, 0);
        groupRef.current.rotation.set(0, 0, 0);
        groupRef.current.scale.set(1, 1, 1);
      }
    }

    // Effect-level rotation (EffectFile.rotating + rotaVec + rotaVel)
    // PKO: GetTransMatrix() applies effect-level rotation to all sub-effects
    if (effectGroupRef.current && effectData?.rotating) {
      const [rx, ry, rz] = effectData.rotaVec;
      _effRotaAxis.set(rx, ry, rz);
      if (_effRotaAxis.lengthSq() > 0.0001) {
        _effRotaAxis.normalize();
        const effAngle = playbackTime * effectData.rotaVel;
        effectGroupRef.current.quaternion.setFromAxisAngle(_effRotaAxis, effAngle);
      }
    } else if (effectGroupRef.current) {
      effectGroupRef.current.quaternion.identity();
    }

    if (!meshRef.current || !subEffect) return;

    // Delegate all per-frame rendering (position, scale, rotation, billboard,
    // color, UV animation, deformable mesh) to the shared function.
    if (playback.isPlaying && interpolated) {
      applySubEffectFrame(meshRef.current, state.camera, {
        sub: subEffect,
        position,
        scale: size,
        angle,
        color,
        playbackTime,
        frameIndex: interpolated.frameIndex,
        nextFrameIndex: interpolated.nextFrameIndex,
        lerp: interpolated.lerp,
        editorMinOpacity: EDITOR_MIN_OPACITY,
        cylinderCache: cylinderPositionCache.current,
        isCylinder: geometry.type === "cylinder",
      });
    }
  });

  // Gizmo drag handler — only for the selected sub-effect
  const handleGizmoDrag = useMemo(() => {
    return (local: THREE.Matrix4) => {
      if (!effectData || selectedSubEffectIndex === null || !frameData || !isSelected) return;

      // Push undo snapshot once at drag start
      if (!snapshotPushed.current) {
        pushSnapshot();
        snapshotPushed.current = true;
      }

      local.decompose(_gizmoPos, _gizmoQuat, _gizmoScale);
      _gizmoEuler.setFromQuaternion(_gizmoQuat);

      const nextSubEffects = effectData.subEffects.map((se, i) => {
        if (i !== selectedSubEffectIndex) return se;

        const nextPositions = [...se.framePositions];
        const nextAngles = [...se.frameAngles];
        const nextSizes = [...se.frameSizes];

        if (gizmoMode === "translate" || gizmoMode === "rotate" || gizmoMode === "scale") {
          nextPositions[frameData.frameIndex] = [_gizmoPos.x, _gizmoPos.y, _gizmoPos.z];
          nextAngles[frameData.frameIndex] = [_gizmoEuler.x, _gizmoEuler.y, _gizmoEuler.z];
          nextSizes[frameData.frameIndex] = [_gizmoScale.x, _gizmoScale.y, _gizmoScale.z];
        }

        return {
          ...se,
          framePositions: nextPositions,
          frameAngles: nextAngles,
          frameSizes: nextSizes,
        };
      });

      setEffectData({ ...effectData, subEffects: nextSubEffects });
      setDirty(true);
    };
  }, [effectData, selectedSubEffectIndex, frameData, gizmoMode, pushSnapshot, setEffectData, setDirty, isSelected]);

  const handleGizmoDragEnd = useMemo(() => {
    return () => {
      snapshotPushed.current = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      cylinderPositionCache.current.clear();
    };
  }, []);

  if (!frameData || !subEffect) {
    return null;
  }

  // Per-sub-effect duration cutoff: hide when elapsed time exceeds layer length.
  // Only applies during playback in non-looping mode.
  if (
    playback.isPlaying &&
    !playback.isLooping &&
    subEffect.length > 0 &&
    playback.currentTime > subEffect.length
  ) {
    return null;
  }

  const materialColor = new THREE.Color(color[0], color[1], color[2]);
  const opacity = Math.min(Math.max(color[3], 0), 1);
  const previewOpacity = Math.max(opacity, EDITOR_MIN_OPACITY);
  const useAlpha = subEffect.alpha !== false;

  const matProps = buildEffectMaterialProps(subEffect, texture, techniqueState);

  const showGizmo = isSelected && gizmoMode !== "off" && !playback.isPlaying;

  const meshElement = (
    <mesh
      ref={meshRef}
      position={position}
      rotation={new THREE.Euler(angle[0], angle[1], angle[2], "YXZ")}
      scale={size}
    >
      {builtinGeometry && <primitive object={builtinGeometry} attach="geometry" />}
      {geometry.type === "plane" && !builtinGeometry && <planeGeometry args={[1, 1]} />}
      {geometry.type === "sphere" && <sphereGeometry args={[0.7, 24, 24]} />}
      {geometry.type === "model" && modelGeometry && (
        <primitive object={modelGeometry} attach="geometry" />
      )}
      {geometry.type === "model" && !modelGeometry && (
        <boxGeometry args={[0.5, 0.5, 0.5]} />
      )}
      <meshBasicMaterial
        key={texture?.id ?? "no-tex"}
        {...matProps}
        color={materialColor}
        opacity={useAlpha ? previewOpacity : 1}
      />
    </mesh>
  );

  return (
    <group ref={groupRef}>
      <group ref={effectGroupRef}>
        {showGizmo ? (
          <PivotControls
            offset={position}
            rotation={[angle[0], angle[1], angle[2]]}
            scale={Math.max(size[0], 0.01)}
            visible={showGizmo}
            onDrag={handleGizmoDrag}
            onDragEnd={handleGizmoDragEnd}
            activeAxes={[true, true, true]}
            depthTest={false}
            autoTransform={false}
          >
            {meshElement}
          </PivotControls>
        ) : (
          meshElement
        )}
      </group>
    </group>
  );
}
