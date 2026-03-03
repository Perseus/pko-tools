/// <reference types="@react-three/fiber" />
import { stripEffectDataAtom, parStripDataAtom, type StripEffectData } from "@/store/strip";
import { currentProjectAtom } from "@/store/project";
import { useAtomValue } from "jotai";
import React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { invoke } from "@tauri-apps/api/core";
import * as THREE from "three";
import {
  createEffectTexture,
  resolveBlendFactors,
  resolveTextureCandidates,
} from "@/features/effect/rendering";

type DecodedTexture = {
  width: number;
  height: number;
  data: string;
};

/**
 * Build a view-dependent ribbon geometry.
 * For each segment, vertex pairs are computed perpendicular to both the
 * tangent direction and the view direction (camera → segment center).
 *
 * C++ reference: CMPStrip::FrameMove computes view-dependent quads.
 *
 * @param segments - Array of trail segment positions
 * @param halfWidth - Half-width of the ribbon
 * @param cameraPos - Camera world position for view-dependent billboarding
 * @param life - Total life for alpha fade (0 = no fade)
 */
export function buildViewDependentRibbon(
  segments: THREE.Vector3[],
  halfWidth: number,
  cameraPos: THREE.Vector3,
  life: number,
): {
  positions: Float32Array;
  uvs: Float32Array;
  alphas: Float32Array;
  indices: Uint16Array;
  vertexCount: number;
} {
  const n = segments.length;
  if (n < 2) {
    return {
      positions: new Float32Array(0),
      uvs: new Float32Array(0),
      alphas: new Float32Array(0),
      indices: new Uint16Array(0),
      vertexCount: 0,
    };
  }

  const vertexCount = n * 2;
  const positions = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const alphas = new Float32Array(vertexCount);

  const _tangent = new THREE.Vector3();
  const _toCamera = new THREE.Vector3();
  const _side = new THREE.Vector3();

  for (let i = 0; i < n; i++) {
    // Compute tangent direction
    if (i < n - 1) {
      _tangent.subVectors(segments[i + 1], segments[i]);
    } else {
      _tangent.subVectors(segments[i], segments[i - 1]);
    }
    _tangent.normalize();

    // View direction: camera → segment position
    _toCamera.subVectors(cameraPos, segments[i]).normalize();

    // Side = cross(tangent, toCamera) — perpendicular to both
    _side.crossVectors(_tangent, _toCamera).normalize();

    // If side is zero (tangent parallel to view), use a fallback
    if (_side.lengthSq() < 0.0001) {
      _side.set(1, 0, 0);
    }

    const vi = i * 2;
    // Left vertex
    positions[vi * 3] = segments[i].x - _side.x * halfWidth;
    positions[vi * 3 + 1] = segments[i].y - _side.y * halfWidth;
    positions[vi * 3 + 2] = segments[i].z - _side.z * halfWidth;
    // Right vertex
    positions[(vi + 1) * 3] = segments[i].x + _side.x * halfWidth;
    positions[(vi + 1) * 3 + 1] = segments[i].y + _side.y * halfWidth;
    positions[(vi + 1) * 3 + 2] = segments[i].z + _side.z * halfWidth;

    // UV: U increases along trail, V = 0 (left) or 1 (right)
    const u = i / (n - 1);
    uvs[vi * 2] = u;
    uvs[vi * 2 + 1] = 0;
    uvs[(vi + 1) * 2] = u;
    uvs[(vi + 1) * 2 + 1] = 1;

    // Per-segment alpha fade: C++ dwColor.a = 1.0 - (curTime / life)
    // Older segments (higher index in static preview) fade more
    const segAge = i / (n - 1);
    const alpha = life > 0 ? Math.max(1.0 - segAge, 0) : 1.0;
    alphas[vi] = alpha;
    alphas[vi + 1] = alpha;
  }

  // Triangle indices (quad strip)
  const quadCount = n - 1;
  const indices = new Uint16Array(quadCount * 6);
  let idx = 0;
  for (let i = 0; i < quadCount; i++) {
    const base = i * 2;
    indices[idx++] = base;
    indices[idx++] = base + 1;
    indices[idx++] = base + 2;
    indices[idx++] = base + 1;
    indices[idx++] = base + 3;
    indices[idx++] = base + 2;
  }

  return { positions, uvs, alphas, indices, vertexCount };
}

/**
 * Build a static preview ribbon (non-view-dependent fallback).
 * Used when no camera is available or for non-interactive preview.
 */
export function buildRibbonGeometry(
  pointA: THREE.Vector3,
  pointB: THREE.Vector3,
  maxLen: number,
): { positions: Float32Array; indices: Uint16Array; vertexCount: number } {
  const segmentCount = Math.max(Math.round(maxLen), 2);
  const vertexCount = (segmentCount + 1) * 2;

  const width = pointA.distanceTo(pointB);
  const halfWidth = width / 2;

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
    const base = new THREE.Vector3().copy(mid).addScaledVector(trailDir, z);

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

  const triangleCount = segmentCount * 2;
  const indices = new Uint16Array(triangleCount * 3);
  let idx = 0;
  for (let i = 0; i < segmentCount; i++) {
    const base = i * 2;
    indices[idx++] = base;
    indices[idx++] = base + 1;
    indices[idx++] = base + 2;
    indices[idx++] = base + 1;
    indices[idx++] = base + 3;
    indices[idx++] = base + 2;
  }

  return { positions, indices, vertexCount };
}

// Strip vertex shader with per-vertex alpha
const stripVertexShader = /* glsl */ `
attribute float aAlpha;
varying float vAlpha;
varying vec2 vUv;

void main() {
  vAlpha = aAlpha;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const stripFragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform sampler2D uTexture;
uniform bool uHasTexture;
varying float vAlpha;
varying vec2 vUv;

void main() {
  float alpha = vAlpha * uOpacity;
  if (uHasTexture) {
    vec4 texColor = texture2D(uTexture, vUv);
    gl_FragColor = vec4(uColor * texColor.rgb, alpha * texColor.a);
  } else {
    gl_FragColor = vec4(uColor, alpha);
  }
}
`;

/** Render a single strip ribbon. Extracted so multiple strips can be rendered. */
function StripRibbon({ stripData }: { stripData: StripEffectData }) {
  const currentProject = useAtomValue(currentProjectAtom);
  const meshRef = useRef<THREE.Mesh>(null);
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const textureRef = useRef<THREE.Texture | null>(null);

  // Load strip texture
  useEffect(() => {
    const texName = stripData?.texName?.trim();
    if (!texName || !currentProject) {
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

    const candidates = resolveTextureCandidates(texName, currentProject.projectDirectory);
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

        const binary = Uint8Array.from(atob(decoded.data), (char) =>
          char.charCodeAt(0),
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
  }, [stripData?.texName, currentProject]);

  // Resolve blend mode
  const blendState = useMemo(() => {
    if (!stripData) return { blending: THREE.AdditiveBlending as THREE.Blending };
    const src = stripData.srcBlend;
    const dst = stripData.destBlend;
    if (!src && !dst) {
      return { blending: THREE.AdditiveBlending as THREE.Blending };
    }
    const { blendSrc, blendDst } = resolveBlendFactors(src, dst);
    return {
      blending: THREE.CustomBlending as THREE.Blending,
      blendSrc,
      blendDst,
    };
  }, [stripData?.srcBlend, stripData?.destBlend]);

  // Build geometry with view-dependent ribbon (updated per frame)
  const geometryRef = useRef<THREE.BufferGeometry | null>(null);

  const material = useMemo(() => {
    if (!stripData) return null;
    const mat = new THREE.ShaderMaterial({
      vertexShader: stripVertexShader,
      fragmentShader: stripFragmentShader,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: blendState.blending,
      uniforms: {
        uColor: { value: new THREE.Color(stripData.color[0], stripData.color[1], stripData.color[2]) },
        uOpacity: { value: stripData.color[3] },
        uTexture: { value: null },
        uHasTexture: { value: false },
      },
    });
    if (blendState.blending === THREE.CustomBlending && "blendSrc" in blendState) {
      mat.blendSrc = blendState.blendSrc!;
      mat.blendDst = blendState.blendDst!;
    }
    return mat;
  }, [stripData, blendState]);

  // Update texture uniform
  useEffect(() => {
    if (!material) return;
    material.uniforms.uTexture.value = texture;
    material.uniforms.uHasTexture.value = texture !== null;
  }, [texture, material]);

  // Build and update view-dependent geometry per frame
  useFrame((state) => {
    if (!stripData || !meshRef.current) return;

    const pointA = new THREE.Vector3(0, 0.5, 0);
    const pointB = new THREE.Vector3(0, -0.5, 0);
    const halfWidth = pointA.distanceTo(pointB) / 2;

    // Build trail segments extending in -Z from midpoint
    const segmentCount = Math.max(Math.round(stripData.maxLen), 2);
    const mid = new THREE.Vector3().addVectors(pointA, pointB).multiplyScalar(0.5);
    const segments: THREE.Vector3[] = [];
    for (let i = 0; i <= segmentCount; i++) {
      const t = i / segmentCount;
      segments.push(
        new THREE.Vector3(mid.x, mid.y, mid.z - t * stripData.maxLen),
      );
    }

    const { positions, uvs, alphas, indices, vertexCount } =
      buildViewDependentRibbon(segments, halfWidth, state.camera.position, stripData.life);

    if (vertexCount === 0) return;

    // Reuse or create geometry
    let geo = geometryRef.current;
    if (!geo) {
      geo = new THREE.BufferGeometry();
      geometryRef.current = geo;
      meshRef.current.geometry = geo;
    }

    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(alphas, 1));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
  });

  if (!material) {
    return null;
  }

  return <mesh ref={meshRef} material={material} />;
}

export default function StripEffectRenderer() {
  const editorStrip = useAtomValue(stripEffectDataAtom);
  const parStrips = useAtomValue(parStripDataAtom);

  // Par strips take priority when available; fall back to editor strip
  if (parStrips && parStrips.length > 0) {
    return (
      <>
        {parStrips.map((strip, i) => (
          <StripRibbon key={`par-${i}`} stripData={strip} />
        ))}
      </>
    );
  }

  if (editorStrip) {
    return <StripRibbon stripData={editorStrip} />;
  }

  return null;
}
