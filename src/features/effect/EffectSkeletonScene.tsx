/// <reference types="@react-three/fiber" />
import React, { useEffect, useMemo, useRef } from "react";
import { Line } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  effectDataAtom,
  effectPlaybackAtom,
  selectedEffectAtom,
  selectedFrameIndexAtom,
  selectedEffectSkeletonNodeAtom,
} from "@/store/effect";
import { buildEffectSkeletonGraph } from "@/features/effect/effectSkeleton";
import { currentProjectAtom } from "@/store/project";
import { useEffectModel } from "@/features/effect/useEffectModel";
import { applySubEffectFrame } from "@/features/effect/applySubEffectFrame";
import { interpolateFrame } from "@/features/effect/animation";
import { usePlaybackClock } from "@/features/effect/playbackClock";
import {
  createCylinderGeometry,
  createRectGeometry,
  createRectPlaneGeometry,
  createRectZGeometry,
  createTriangleGeometry,
  createTrianglePlaneGeometry,
  resolveFrameData,
  resolveGeometry,
} from "@/features/effect/rendering";
import * as THREE from "three";

const _effectAxis = new THREE.Vector3();

function OrientationArrows() {
  const length = 0.9;
  const tip = 0.08;

  return (
    <group>
      <Line points={[[0, 0, 0], [length, 0, 0]]} color="#ef4444" lineWidth={2} />
      <mesh position={[length, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
        <coneGeometry args={[tip, 0.2, 10]} />
        <meshBasicMaterial color="#ef4444" />
      </mesh>

      <Line points={[[0, 0, 0], [0, length, 0]]} color="#22c55e" lineWidth={2} />
      <mesh position={[0, length, 0]}>
        <coneGeometry args={[tip, 0.2, 10]} />
        <meshBasicMaterial color="#22c55e" />
      </mesh>

      <Line points={[[0, 0, 0], [0, 0, length]]} color="#3b82f6" lineWidth={2} />
      <mesh position={[0, 0, length]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[tip, 0.2, 10]} />
        <meshBasicMaterial color="#3b82f6" />
      </mesh>
    </group>
  );
}

function colorForDepth(depth: number): string {
  const palette = ["#7dd3fc", "#fbbf24", "#86efac", "#f9a8d4", "#c4b5fd"];
  return palette[depth % palette.length];
}

function SkeletonNodeMarker({
  node,
  isSelected,
  onSelect,
}: {
  node: ReturnType<typeof buildEffectSkeletonGraph>["nodes"][string];
  isSelected: boolean;
  onSelect: (id: string) => void;
}) {
  const color = node.kind === "effect" ? "#7dd3fc" : colorForDepth(node.depth);
  const radius = node.kind === "effect" ? 0.18 : isSelected ? 0.14 : 0.11;
  const [qx, qy, qz, qw] = node.worldQuaternion;

  return (
    <group
      position={node.worldPosition}
      quaternion={[qx, qy, qz, qw]}
    >
      <mesh onClick={(event) => {
        event.stopPropagation();
        onSelect(node.id);
      }}>
        {node.kind === "effect" ? (
          <boxGeometry args={[radius * 1.6, radius * 1.6, radius * 1.6]} />
        ) : (
          <sphereGeometry args={[radius, 18, 18]} />
        )}
        <meshBasicMaterial color={color} transparent opacity={isSelected ? 1 : 0.8} />
      </mesh>
      {isSelected && (
        <mesh>
          <sphereGeometry args={[radius * 1.8, 18, 18]} />
          <meshBasicMaterial color="#ffffff" wireframe transparent opacity={0.65} />
        </mesh>
      )}
      {isSelected ? <OrientationArrows /> : <axesHelper args={[0.35]} />}
    </group>
  );
}

function EffectSkeletonProxy({
  subEffectIndex,
}: {
  subEffectIndex: number;
}) {
  const effectData = useAtomValue(effectDataAtom);
  const playback = useAtomValue(effectPlaybackAtom);
  const selectedFrameIndex = useAtomValue(selectedFrameIndexAtom);
  const currentProject = useAtomValue(currentProjectAtom);
  const selectedNodeId = useAtomValue(selectedEffectSkeletonNodeAtom);
  const setSelectedNodeId = useSetAtom(selectedEffectSkeletonNodeAtom);
  const playbackTime = usePlaybackClock();
  const meshRef = useRef<THREE.Mesh>(null);
  const effectGroupRef = useRef<THREE.Group>(null);

  const frameData = useMemo(
    () => resolveFrameData(effectData, subEffectIndex, selectedFrameIndex),
    [effectData, selectedFrameIndex, subEffectIndex],
  );
  const subEffect = frameData?.subEffect ?? null;
  const nodeId = `effect:root/sub:${subEffectIndex}`;
  const isSelected = selectedNodeId === nodeId;
  const interpolated = useMemo(() => {
    if (!subEffect || !playback.isPlaying) {
      return null;
    }
    return interpolateFrame(subEffect, playbackTime, playback.isLooping);
  }, [playback.isLooping, playback.isPlaying, playbackTime, subEffect]);

  const geometry = useMemo(
    () => {
      const frameIndex = interpolated?.frameIndex ?? frameData?.frameIndex ?? 0;
      return subEffect ? resolveGeometry(subEffect, frameIndex) : { type: "plane" as const };
    },
    [frameData?.frameIndex, interpolated?.frameIndex, subEffect],
  );

  const builtinGeometry = useMemo(() => {
    switch (geometry.type) {
      case "rect": return createRectGeometry();
      case "rectPlane": return createRectPlaneGeometry();
      case "rectZ": return createRectZGeometry();
      case "triangle": return createTriangleGeometry();
      case "trianglePlane": return createTrianglePlaneGeometry();
      case "triangleZ": {
        const tri = createTrianglePlaneGeometry();
        tri.rotateY(Math.PI / 2);
        return tri;
      }
      case "cylinder": return createCylinderGeometry(
        geometry.topRadius ?? 0.5,
        geometry.botRadius ?? 0.5,
        geometry.height ?? 1,
        geometry.segments ?? 16,
      );
      case "sphere": return new THREE.SphereGeometry(0.7, 16, 16);
      default: return null;
    }
  }, [geometry.botRadius, geometry.height, geometry.segments, geometry.topRadius, geometry.type]);

  const modelGeometry = useEffectModel(
    geometry.type === "model" ? geometry.modelName : undefined,
    currentProject?.id,
  );

  useFrame((state) => {
    if (!subEffect || !meshRef.current) {
      return;
    }

    if (effectGroupRef.current) {
      effectGroupRef.current.quaternion.identity();
      if (effectData?.rotating) {
        _effectAxis.set(
          effectData.rotaVec[0],
          effectData.rotaVec[1],
          effectData.rotaVec[2],
        );
        if (_effectAxis.lengthSq() > 0.0001) {
          _effectAxis.normalize();
          effectGroupRef.current.quaternion.setFromAxisAngle(
            _effectAxis,
            playbackTime * effectData.rotaVel,
          );
        }
      }
    }

    const position = interpolated?.position ?? frameData?.position ?? [0, 0, 0];
    const angle = interpolated?.angle ?? frameData?.angle ?? [0, 0, 0];
    const scale = interpolated?.size ?? frameData?.size ?? [1, 1, 1];
    const color = interpolated?.color ?? frameData?.color ?? [1, 1, 1, 1];

    applySubEffectFrame(meshRef.current, state.camera, {
      sub: subEffect,
      position,
      scale,
      angle,
      color,
      playbackTime,
      frameIndex: interpolated?.frameIndex ?? frameData?.frameIndex ?? 0,
      nextFrameIndex: interpolated?.nextFrameIndex ?? frameData?.frameIndex ?? 0,
      lerp: interpolated?.lerp ?? 0,
      editorMinOpacity: isSelected ? 0.45 : 0.18,
      isCylinder: geometry.type === "cylinder",
    });
  });

  useEffect(() => {
    return () => {
      if (builtinGeometry) {
        builtinGeometry.dispose();
      }
    };
  }, [builtinGeometry]);

  if (!subEffect || !frameData) {
    return null;
  }

  if (!isSelected) {
    return null;
  }

  return (
    <group ref={effectGroupRef}>
      <mesh
        ref={meshRef}
        onClick={(event) => {
          event.stopPropagation();
          setSelectedNodeId(nodeId);
        }}
      >
        {builtinGeometry && <primitive object={builtinGeometry} attach="geometry" />}
        {geometry.type === "plane" && !builtinGeometry && <planeGeometry args={[1, 1]} />}
        {geometry.type === "model" && modelGeometry && (
          <primitive object={modelGeometry} attach="geometry" />
        )}
        {geometry.type === "model" && !modelGeometry && (
          <boxGeometry args={[1, 1, 1]} />
        )}
        <meshBasicMaterial
          color={isSelected ? "#d8f3ff" : "#8ad4ff"}
          transparent
          opacity={isSelected ? 0.35 : 0.14}
          wireframe
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

export default function EffectSkeletonScene() {
  const effectData = useAtomValue(effectDataAtom);
  const selectedEffect = useAtomValue(selectedEffectAtom);
  const playback = useAtomValue(effectPlaybackAtom);
  const [selectedNodeId, setSelectedNodeId] = useAtom(selectedEffectSkeletonNodeAtom);
  const playbackTime = usePlaybackClock();

  const graph = useMemo(() => {
    if (!effectData) {
      return null;
    }

    return buildEffectSkeletonGraph({
      effectFile: effectData,
      effectName: selectedEffect ?? "Current effect",
      currentTime: playbackTime,
      isLooping: playback.isLooping,
    });
  }, [effectData, playback.isLooping, playbackTime, selectedEffect]);

  useEffect(() => {
    if (!graph) {
      return;
    }
    if (!selectedNodeId || !graph.nodes[selectedNodeId]) {
      setSelectedNodeId(graph.rootId);
    }
  }, [graph, selectedNodeId, setSelectedNodeId]);

  if (!graph) {
    return null;
  }

  const subEffects = effectData?.subEffects ?? [];

  return (
    <group>
      {subEffects.map((_, index) => (
        <EffectSkeletonProxy
          key={`proxy:${index}`}
          subEffectIndex={index}
        />
      ))}

      {graph.renderableNodeIds.map((nodeId) => {
        const node = graph.nodes[nodeId];
        const parentRenderableId = node.parentRenderableId;
        if (!parentRenderableId) {
          return null;
        }
        const parentNode = graph.nodes[parentRenderableId];
        return (
          <Line
            key={`edge:${parentRenderableId}:${nodeId}`}
            points={[parentNode.worldPosition, node.worldPosition]}
            color="#4b5563"
            lineWidth={1}
            transparent
            opacity={0.75}
          />
        );
      })}

      {graph.renderableNodeIds.map((nodeId) => {
        const node = graph.nodes[nodeId];
        return (
          <SkeletonNodeMarker
            key={nodeId}
            node={node}
            isSelected={selectedNodeId === node.id}
            onSelect={setSelectedNodeId}
          />
        );
      })}
    </group>
  );
}
