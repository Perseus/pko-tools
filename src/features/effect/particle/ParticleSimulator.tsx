/// <reference types="@react-three/fiber" />
import { PARTICLE_TYPE } from "@/types/particle";
import { effectPlaybackAtom } from "@/store/effect";
import { particleDataAtom, selectedParticleSystemIndexAtom } from "@/store/particle";
import { currentProjectAtom } from "@/store/project";
import { invokeTimed as invoke } from "@/commands/invokeTimed";
import { useAtomValue } from "jotai";
import React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  MAX_PARTICLES,
  createPool,
  resetPool,
  tickPool,
  type ParticlePool,
} from "@/features/effect/particle/particlePool";
import {
  createEffectTexture,
  resolveBlendFactors,
  resolveTextureCandidates,
} from "@/features/effect/rendering";

type DecodedTexture = {
  width: number;
  height: number;
  data: string; // base64-encoded RGBA pixels
};

// Billboard particle shaders — with texture + rotation support
const vertexShader = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aRotation;
varying float vAlpha;
varying vec3 vColor;
varying float vRotation;

void main() {
  vColor = color;
  vAlpha = aAlpha;
  vRotation = aRotation.z; // Roll rotation for billboard sprites
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (200.0 / -mvPosition.z);
  gl_PointSize = max(gl_PointSize, 1.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const fragmentShader = /* glsl */ `
uniform sampler2D uTexture;
uniform bool uHasTexture;
varying float vAlpha;
varying vec3 vColor;
varying float vRotation;

void main() {
  // Rotate gl_PointCoord around center by roll angle
  vec2 uv = gl_PointCoord - vec2(0.5);
  float s = sin(vRotation);
  float c = cos(vRotation);
  uv = vec2(uv.x * c - uv.y * s, uv.x * s + uv.y * c) + vec2(0.5);

  if (uHasTexture) {
    // D3D8 COLOROP=MODULATE(TEXTURE, DIFFUSE), ALPHAOP=MODULATE(TEXTURE, DIFFUSE)
    vec4 texColor = texture2D(uTexture, uv);
    gl_FragColor = vec4(vColor * texColor.rgb, vAlpha * texColor.a);
  } else {
    // Soft circle fallback when no texture is loaded
    float dist = length(uv - vec2(0.5));
    if (dist > 0.5) discard;
    float alpha = vAlpha * smoothstep(0.5, 0.2, dist);
    gl_FragColor = vec4(vColor, alpha);
  }
}
`;

const _dummy = new THREE.Object3D();
const _color = new THREE.Color();

export default function ParticleSimulator() {
  const particleData = useAtomValue(particleDataAtom);
  const selectedIndex = useAtomValue(selectedParticleSystemIndexAtom);
  const playback = useAtomValue(effectPlaybackAtom);

  const system = useMemo(() => {
    if (!particleData || selectedIndex === null) return null;
    return particleData.systems[selectedIndex] ?? null;
  }, [particleData, selectedIndex]);

  const isModelType = system?.type === PARTICLE_TYPE.MODEL;

  const poolRef = useRef<ParticlePool>(createPool());

  // Reset pool when system changes
  useEffect(() => {
    resetPool(poolRef.current);
  }, [system]);

  // Simulation loop (shared between both render modes)
  useFrame((_state, delta) => {
    if (!system || !playback.isPlaying) return;
    const clampedDelta = Math.min(delta, 0.05);
    tickPool(poolRef.current, system, clampedDelta);
  });

  if (!system) return null;

  if (isModelType) {
    return <ModelParticles pool={poolRef} system={system} />;
  }

  return <BillboardParticles pool={poolRef} system={system} />;
}

/** Billboard particles rendered with THREE.Points + ShaderMaterial. */
function BillboardParticles({
  pool: poolRef,
  system,
}: {
  pool: React.RefObject<ParticlePool>;
  system: { textureName: string; srcBlend: number; destBlend: number };
}) {
  const pointsRef = useRef<THREE.Points>(null);
  const currentProject = useAtomValue(currentProjectAtom);
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const textureRef = useRef<THREE.Texture | null>(null);

  // Load particle texture from system data
  useEffect(() => {
    const texName = system.textureName?.trim();
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
  }, [system.textureName, currentProject]);

  // Resolve blend mode from per-system srcBlend/destBlend
  const blendState = useMemo(() => {
    const src = system.srcBlend;
    const dst = system.destBlend;
    // If both are 0, fall back to additive
    if (!src && !dst) {
      return {
        blending: THREE.AdditiveBlending as THREE.Blending,
        blendSrc: undefined as THREE.BlendingSrcFactor | undefined,
        blendDst: undefined as THREE.BlendingDstFactor | undefined,
      };
    }
    const { blendSrc, blendDst } = resolveBlendFactors(src, dst);
    return {
      blending: THREE.CustomBlending as THREE.Blending,
      blendSrc,
      blendDst,
    };
  }, [system.srcBlend, system.destBlend]);

  const material = useMemo(() => {
    const mat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: blendState.blending,
      uniforms: {
        uTexture: { value: null },
        uHasTexture: { value: false },
      },
    });
    if (blendState.blending === THREE.CustomBlending) {
      mat.blendSrc = blendState.blendSrc!;
      mat.blendDst = blendState.blendDst!;
    }
    return mat;
  }, [blendState]);

  // Update texture uniform when texture changes
  useEffect(() => {
    material.uniforms.uTexture.value = texture;
    material.uniforms.uHasTexture.value = texture !== null;
  }, [texture, material]);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(MAX_PARTICLES * 3);
    const col = new Float32Array(MAX_PARTICLES * 3);
    const sizes = new Float32Array(MAX_PARTICLES);
    const alphas = new Float32Array(MAX_PARTICLES);
    const rotations = new Float32Array(MAX_PARTICLES * 3);

    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(alphas, 1));
    geo.setAttribute("aRotation", new THREE.BufferAttribute(rotations, 3));

    return geo;
  }, []);

  useFrame(() => {
    const pool = poolRef.current;
    if (!pool) return;

    const posAttr = geometry.getAttribute("position") as THREE.BufferAttribute;
    const colAttr = geometry.getAttribute("color") as THREE.BufferAttribute;
    const sizeAttr = geometry.getAttribute("aSize") as THREE.BufferAttribute;
    const alphaAttr = geometry.getAttribute("aAlpha") as THREE.BufferAttribute;
    const rotAttr = geometry.getAttribute("aRotation") as THREE.BufferAttribute;

    (posAttr.array as Float32Array).set(pool.positions);
    (colAttr.array as Float32Array).set(pool.colors);
    (sizeAttr.array as Float32Array).set(pool.sizes);
    (alphaAttr.array as Float32Array).set(pool.alphas);
    (rotAttr.array as Float32Array).set(pool.rotations);

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    sizeAttr.needsUpdate = true;
    alphaAttr.needsUpdate = true;
    rotAttr.needsUpdate = true;
  });

  return <points ref={pointsRef} geometry={geometry} material={material} />;
}

/** Model-type particles rendered with THREE.InstancedMesh. */
function ModelParticles({
  pool: poolRef,
  system,
}: {
  pool: React.RefObject<ParticlePool>;
  system: { srcBlend: number; destBlend: number };
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const blendState = useMemo(() => {
    const src = system.srcBlend;
    const dst = system.destBlend;
    if (!src && !dst) {
      return { blending: THREE.AdditiveBlending as THREE.Blending };
    }
    const { blendSrc, blendDst } = resolveBlendFactors(src, dst);
    return {
      blending: THREE.CustomBlending as THREE.Blending,
      blendSrc,
      blendDst,
    };
  }, [system.srcBlend, system.destBlend]);

  const baseGeometry = useMemo(() => new THREE.SphereGeometry(0.5, 8, 8), []);
  const baseMaterial = useMemo(() => {
    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      blending: blendState.blending,
    });
    if (blendState.blending === THREE.CustomBlending && "blendSrc" in blendState) {
      mat.blendSrc = blendState.blendSrc!;
      mat.blendDst = blendState.blendDst!;
    }
    return mat;
  }, [blendState]);

  useFrame(() => {
    const pool = poolRef.current;
    const mesh = meshRef.current;
    if (!pool || !mesh) return;

    let visibleCount = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (!pool.alive[i]) continue;

      const i3 = i * 3;
      const size = pool.sizes[i];

      _dummy.position.set(
        pool.positions[i3],
        pool.positions[i3 + 1],
        pool.positions[i3 + 2],
      );
      _dummy.scale.setScalar(size);
      _dummy.updateMatrix();

      mesh.setMatrixAt(visibleCount, _dummy.matrix);
      _color.setRGB(pool.colors[i3], pool.colors[i3 + 1], pool.colors[i3 + 2]);
      mesh.setColorAt(visibleCount, _color);

      visibleCount++;
    }

    mesh.count = visibleCount;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[baseGeometry, baseMaterial, MAX_PARTICLES]}
    />
  );
}
