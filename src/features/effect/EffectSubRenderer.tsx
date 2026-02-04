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
import { invoke } from "@tauri-apps/api/core";
import * as THREE from "three";
import {
  createEffectTexture,
  createRectGeometry,
  createRectZGeometry,
  createTriangleGeometry,
  createTriangleZGeometry,
  resolveBlendFactors,
  resolveFrameData,
  resolveGeometry,
  resolveTextureCandidates,
  resolveTextureName,
} from "@/features/effect/rendering";
import { interpolateFrame, interpolateUVCoords, getTexListFrameIndex } from "@/features/effect/animation";
import { useEffectHistory } from "@/features/effect/useEffectHistory";
import { useEffectModel } from "@/features/effect/useEffectModel";

type DecodedTexture = {
  width: number;
  height: number;
  data: string; // base64-encoded RGBA pixels
};

/** Minimum opacity in the editor so fully-transparent keyframes remain visible. */
const EDITOR_MIN_OPACITY = 0.15;

// Reusable objects for per-frame computation (avoids GC per frame)
const _rotaAxis = new THREE.Vector3();
const _rotaQuat = new THREE.Quaternion();
// PKO uses D3DXMatrixRotationYawPitchRoll(yaw=y, pitch=x, roll=z) → Euler 'YXZ'
const _baseEuler = new THREE.Euler(0, 0, 0, "YXZ");
const _effRotaAxis = new THREE.Vector3();

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

  const subEffect = frameData?.subEffect ?? null;

  const geometry = useMemo(
    () => subEffect ? resolveGeometry(subEffect, selectedFrameIndex) : { type: "plane" as const },
    [subEffect, selectedFrameIndex]
  );

  // Build PKO-correct BufferGeometry for rect/rectZ/triangle/triangleZ types
  const builtinGeometry = useMemo(() => {
    switch (geometry.type) {
      case "rect": return createRectGeometry();
      case "rectZ": return createRectZGeometry();
      case "triangle": return createTriangleGeometry();
      case "triangleZ": return createTriangleZGeometry();
      default: return null;
    }
  }, [geometry.type]);

  const modelGeometry = useEffectModel(
    geometry.type === "model" ? geometry.modelName : undefined,
    currentProject?.id,
  );

  const blendFactors = useMemo(() => {
    if (!subEffect) {
      return resolveBlendFactors(5, 6); // default: standard alpha blend
    }
    return resolveBlendFactors(subEffect.srcBlend, subEffect.destBlend);
  }, [subEffect]);

  // Smooth interpolation between keyframes during playback
  const interpolated = useMemo(() => {
    if (!subEffect || !playback.isPlaying) return null;
    return interpolateFrame(subEffect, playback.currentTime, playback.isLooping);
  }, [subEffect, playback.isPlaying, playback.currentTime, playback.isLooping]);

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
  }, [textureName, currentProject, reloadToken, isSelected]);

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
        const effAngle = playback.currentTime * effectData.rotaVel;
        effectGroupRef.current.quaternion.setFromAxisAngle(_effRotaAxis, effAngle);
      }
    } else if (effectGroupRef.current) {
      effectGroupRef.current.quaternion.identity();
    }

    if (!meshRef.current) return;

    // PKO billboard logic (MPModelEff.cpp RenderVS):
    // - Billboard is triggered ONLY by the billboard flag, NOT rotaBoard alone.
    // - effectType=4 (Model) uses VS index 1 which overrides billboard VS index 2.
    // - When billboard=true && rotaBoard=false: rotation is discarded (identity),
    //   then billboard matrix applied. rotaLoop is also discarded.
    // - When billboard=true && rotaBoard=true: frame rotation (and rotaLoop)
    //   is preserved and composed with billboard matrix.
    const isModelEffect = subEffect?.effectType === 4 && geometry.type === "model";
    const isBillboard = !!subEffect?.billboard && !isModelEffect;
    const isRotaBoard = !!subEffect?.rotaBoard;

    // Step 1: Build base rotation (frame rotation + optional rotaLoop)
    // PKO: GetTransformMatrix builds Scale * Rotation (with optional RotaLoop)
    if (subEffect?.rotaLoop && !(isBillboard && !isRotaBoard)) {
      // Apply rotaLoop UNLESS billboard is on with rotaBoard off
      // (PKO discards everything including rotaLoop for billboard+!rotaBoard)
      const [ax, ay, az, speed] = subEffect.rotaLoopVec;
      _rotaAxis.set(ax, ay, az);
      if (_rotaAxis.lengthSq() > 0.0001) {
        _rotaAxis.normalize();
        const rotaAngle = playback.currentTime * speed;
        // Compose: RotaLoop * FrameRotation
        _baseEuler.set(angle[0], angle[1], angle[2], "YXZ");
        meshRef.current.quaternion.setFromEuler(_baseEuler);
        _rotaQuat.setFromAxisAngle(_rotaAxis, rotaAngle);
        meshRef.current.quaternion.premultiply(_rotaQuat);
      }
    }

    // Step 2: Apply billboard
    // PKO: if billboard, multiply (or replace) result with inverse view matrix
    if (isBillboard) {
      if (!isRotaBoard) {
        // billboard + !rotaBoard: discard all rotation, just face camera
        meshRef.current.lookAt(state.camera.position);
      } else {
        // billboard + rotaBoard: compose current rotation with billboard
        // Save current quaternion (frame rotation + rotaLoop), apply billboard, then compose
        _rotaQuat.copy(meshRef.current.quaternion);
        meshRef.current.lookAt(state.camera.position);
        meshRef.current.quaternion.multiply(_rotaQuat);
      }
    }

    // UV animation for effectType 2 (EFFECT_MODELUV) — interpolated UV coords
    if (subEffect && playback.isPlaying && subEffect.effectType === 2 && subEffect.coordList.length > 0) {
      const uvResult = interpolateUVCoords(subEffect, playback.currentTime, playback.isLooping);
      if (uvResult && meshRef.current.geometry) {
        const uvAttr = meshRef.current.geometry.getAttribute("uv");
        if (uvAttr && uvAttr.count === uvResult.uvs.length) {
          for (let v = 0; v < uvResult.uvs.length; v++) {
            uvAttr.setXY(v, uvResult.uvs[v][0], uvResult.uvs[v][1]);
          }
          uvAttr.needsUpdate = true;
        }
      }
    }

    // UV animation for effectType 3 (EFFECT_MODELTEXTURE) — snapped UV sets
    if (subEffect && playback.isPlaying && subEffect.effectType === 3 && subEffect.texList.length > 0) {
      const texIdx = getTexListFrameIndex(subEffect, playback.currentTime, playback.isLooping);
      if (texIdx !== null && subEffect.texList[texIdx] && meshRef.current.geometry) {
        const uvAttr = meshRef.current.geometry.getAttribute("uv");
        const texUVs = subEffect.texList[texIdx];
        if (uvAttr && uvAttr.count === texUVs.length) {
          for (let v = 0; v < texUVs.length; v++) {
            uvAttr.setXY(v, texUVs[v][0], texUVs[v][1]);
          }
          uvAttr.needsUpdate = true;
        }
      }
    }

    // Deformable mesh interpolation: when useParam > 0 and geometry is cylinder/cone,
    // interpolate vertex positions between frames (PKO RenderTob D3DXVec3Lerp)
    if (
      subEffect &&
      playback.isPlaying &&
      interpolated &&
      subEffect.useParam > 0 &&
      subEffect.perFrameCylinder.length > 1 &&
      geometry.type === "cylinder" &&
      meshRef.current.geometry
    ) {
      const curParams = subEffect.perFrameCylinder[interpolated.frameIndex];
      const nxtParams = subEffect.perFrameCylinder[interpolated.nextFrameIndex];
      if (curParams && nxtParams && interpolated.lerp > 0.001) {
        // Build two temporary cylinder geometries and lerp their vertices
        const segs = Math.max(curParams.segments || 16, 3);
        const curGeo = new THREE.CylinderGeometry(
          curParams.topRadius || 0.5, curParams.botRadius || 0.5,
          curParams.height || 1.0, segs,
        );
        const nxtGeo = new THREE.CylinderGeometry(
          nxtParams.topRadius || 0.5, nxtParams.botRadius || 0.5,
          nxtParams.height || 1.0, segs,
        );

        const curPos = curGeo.getAttribute("position");
        const nxtPos = nxtGeo.getAttribute("position");
        const targetPos = meshRef.current.geometry.getAttribute("position");

        if (curPos && nxtPos && targetPos && curPos.count === nxtPos.count && curPos.count === targetPos.count) {
          const t = interpolated.lerp;
          for (let v = 0; v < curPos.count; v++) {
            targetPos.setXYZ(
              v,
              curPos.getX(v) + (nxtPos.getX(v) - curPos.getX(v)) * t,
              curPos.getY(v) + (nxtPos.getY(v) - curPos.getY(v)) * t,
              curPos.getZ(v) + (nxtPos.getZ(v) - curPos.getZ(v)) * t,
            );
          }
          targetPos.needsUpdate = true;
        }

        curGeo.dispose();
        nxtGeo.dispose();
      }
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

      const pos = new THREE.Vector3();
      const rot = new THREE.Euler();
      const scl = new THREE.Vector3();
      const quat = new THREE.Quaternion();

      local.decompose(pos, quat, scl);
      rot.setFromQuaternion(quat);

      const nextSubEffects = effectData.subEffects.map((se, i) => {
        if (i !== selectedSubEffectIndex) return se;

        const nextPositions = [...se.framePositions];
        const nextAngles = [...se.frameAngles];
        const nextSizes = [...se.frameSizes];

        if (gizmoMode === "translate" || gizmoMode === "rotate" || gizmoMode === "scale") {
          nextPositions[frameData.frameIndex] = [pos.x, pos.y, pos.z];
          nextAngles[frameData.frameIndex] = [rot.x, rot.y, rot.z];
          nextSizes[frameData.frameIndex] = [scl.x, scl.y, scl.z];
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

  if (!frameData || !subEffect) {
    return null;
  }

  const materialColor = new THREE.Color(color[0], color[1], color[2]);
  const opacity = Math.min(Math.max(color[3], 0), 1);
  const previewOpacity = Math.max(opacity, EDITOR_MIN_OPACITY);
  // PKO: when alpha=false, disables alpha blending and enables depth write
  const useAlpha = subEffect.alpha !== false;

  const showGizmo = isSelected && gizmoMode !== "off" && !playback.isPlaying;

  const meshElement = (
    <mesh
      ref={meshRef}
      position={position}
      rotation={new THREE.Euler(angle[0], angle[1], angle[2], "YXZ")}
      scale={[size[0] || 1, size[1] || 1, size[2] || 1]}
    >
      {builtinGeometry && <primitive object={builtinGeometry} attach="geometry" />}
      {geometry.type === "plane" && !builtinGeometry && <planeGeometry args={[1, 1]} />}
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
      {geometry.type === "model" && modelGeometry && (
        <primitive object={modelGeometry} attach="geometry" />
      )}
      {geometry.type === "model" && !modelGeometry && (
        <boxGeometry args={[0.5, 0.5, 0.5]} />
      )}
      <meshBasicMaterial
        key={texture?.id ?? "no-tex"}
        color={materialColor}
        transparent={useAlpha}
        opacity={useAlpha ? previewOpacity : 1}
        toneMapped={false}
        blending={useAlpha ? THREE.CustomBlending : THREE.NormalBlending}
        blendSrc={blendFactors.blendSrc}
        blendDst={blendFactors.blendDst}
        depthWrite={!useAlpha}
        map={texture}
        side={THREE.DoubleSide}
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
            scale={size[0] || 1}
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
