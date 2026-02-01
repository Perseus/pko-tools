/// <reference types="@react-three/fiber" />
import { stripEffectDataAtom } from "@/store/strip";
import { useAtomValue } from "jotai";
import React from "react";
import { useMemo } from "react";
import * as THREE from "three";

/**
 * Build a flat ribbon geometry between two points, extending backward.
 * This is a static preview since we can't simulate character movement in the editor.
 */
export function buildRibbonGeometry(
  pointA: THREE.Vector3,
  pointB: THREE.Vector3,
  maxLen: number,
): { positions: Float32Array; indices: Uint16Array; vertexCount: number } {
  const segmentCount = Math.max(Math.round(maxLen), 2);
  const vertexCount = (segmentCount + 1) * 2;

  // Direction from A to B defines the ribbon width
  const width = pointA.distanceTo(pointB);
  const halfWidth = width / 2;

  // The ribbon extends in the -Z direction from the midpoint of A/B
  const mid = new THREE.Vector3().addVectors(pointA, pointB).multiplyScalar(0.5);
  const trailDir = new THREE.Vector3(0, 0, -1);
  const sideDir = new THREE.Vector3().subVectors(pointB, pointA);
  if (sideDir.lengthSq() > 0.0001) {
    sideDir.normalize();
  } else {
    sideDir.set(1, 0, 0);
  }

  const positions = new Float32Array(vertexCount * 3);

  for (let i = 0; i <= segmentCount; i++) {
    const t = i / segmentCount;
    const z = t * maxLen;
    const base = new THREE.Vector3()
      .copy(mid)
      .addScaledVector(trailDir, z);

    // Two vertices per segment: left and right
    const idx = i * 2;
    const left = new THREE.Vector3().copy(base).addScaledVector(sideDir, -halfWidth);
    const right = new THREE.Vector3().copy(base).addScaledVector(sideDir, halfWidth);

    positions[idx * 3] = left.x;
    positions[idx * 3 + 1] = left.y;
    positions[idx * 3 + 2] = left.z;
    positions[(idx + 1) * 3] = right.x;
    positions[(idx + 1) * 3 + 1] = right.y;
    positions[(idx + 1) * 3 + 2] = right.z;
  }

  // Triangle strip indices
  const triangleCount = segmentCount * 2;
  const indices = new Uint16Array(triangleCount * 3);
  let idx = 0;
  for (let i = 0; i < segmentCount; i++) {
    const base = i * 2;
    // First triangle
    indices[idx++] = base;
    indices[idx++] = base + 1;
    indices[idx++] = base + 2;
    // Second triangle
    indices[idx++] = base + 1;
    indices[idx++] = base + 3;
    indices[idx++] = base + 2;
  }

  return { positions, indices, vertexCount };
}

export default function StripEffectRenderer() {
  const stripData = useAtomValue(stripEffectDataAtom);

  const geometry = useMemo(() => {
    if (!stripData) return null;

    const pointA = new THREE.Vector3(0, 0.5, 0);
    const pointB = new THREE.Vector3(0, -0.5, 0);
    const { positions, indices } = buildRibbonGeometry(pointA, pointB, stripData.maxLen);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.computeVertexNormals();
    return geo;
  }, [stripData]);

  if (!stripData || !geometry) {
    return null;
  }

  const color = new THREE.Color(
    stripData.color[0],
    stripData.color[1],
    stripData.color[2],
  );

  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial
        color={color}
        transparent
        opacity={stripData.color[3] * 0.5}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
}
