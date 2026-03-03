/// <reference types="@react-three/fiber" />
import { PARTICLE_TYPE, type ParticleSystem } from "@/types/particle";
import { effectPlaybackAtom, traceRecorderTickAtom } from "@/store/effect";
import { particleDataAtom, selectedParticleSystemIndexAtom } from "@/store/particle";
import { currentProjectAtom } from "@/store/project";
import { useAtomValue } from "jotai";
import React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { invoke } from "@tauri-apps/api/core";
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
import { useEffectModel } from "@/features/effect/useEffectModel";
import { useHitEffectManager } from "@/features/effect/HitEffectManager";
import { parModelDataAtom } from "@/store/strip";

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

/** Types that render as ground-plane decals (flat quads at y=0). */
const SHADE_TYPES = new Set<number>([PARTICLE_TYPE.SHADE]);

/** Types that render as expanding rings. */
const RANGE_TYPES = new Set<number>([PARTICLE_TYPE.RANGE, PARTICLE_TYPE.RANGE2]);

/** Types that are invisible (position tracking only). */
const DUMMY_TYPES = new Set<number>([PARTICLE_TYPE.DUMMY]);

/**
 * Top-level particle simulator.
 * During playback: renders ALL systems simultaneously (matching C++ CMPPartCtrl::Render).
 * When stopped: renders only the selected system for editing.
 */
export default function ParticleSimulator() {
  const particleData = useAtomValue(particleDataAtom);
  const selectedIndex = useAtomValue(selectedParticleSystemIndexAtom);
  const playback = useAtomValue(effectPlaybackAtom);

  if (!particleData || particleData.systems.length === 0) return null;

  // During playback: render ALL systems simultaneously
  if (playback.isPlaying) {
    return (
      <group>
        {particleData.systems.map((sys, i) => (
          <SingleSystemRenderer key={i} system={sys} index={i} />
        ))}
      </group>
    );
  }

  // When stopped: render only the selected system for editing
  if (selectedIndex === null) return null;
  const system = particleData.systems[selectedIndex];
  if (!system) return null;

  return <SingleSystemRenderer system={system} index={selectedIndex} />;
}

/** Renders a single particle system with its own pool, tick loop, and hit effects. */
function SingleSystemRenderer({
  system,
  index,
}: {
  system: ParticleSystem;
  index: number;
}) {
  const playback = useAtomValue(effectPlaybackAtom);
  const currentProject = useAtomValue(currentProjectAtom);
  const poolRef = useRef<ParticlePool>(createPool());
  const { onParticleDeath, HitEffects } = useHitEffectManager(
    currentProject?.id,
    currentProject?.projectDirectory,
  );
  const selectedIndex = useAtomValue(selectedParticleSystemIndexAtom);
  const traceRecorderTick = useAtomValue(traceRecorderTickAtom);

  // Reset pool when system changes
  useEffect(() => {
    resetPool(poolRef.current);
  }, [system]);

  // Simulation loop
  useFrame((_state, delta) => {
    if (!playback.isPlaying) return;
    const clampedDelta = Math.min(delta, 0.05);
    tickPool(poolRef.current, system, clampedDelta, system.hitEffect ? onParticleDeath : undefined);

    // Record trace for the selected system during playback
    if (traceRecorderTick && index === selectedIndex) {
      traceRecorderTick(poolRef.current, playback.currentTime);
    }
  });

  // DUMMY particles are invisible — only render hit effects
  if (DUMMY_TYPES.has(system.type as number)) return <HitEffects />;

  if (system.type === PARTICLE_TYPE.MODEL) {
    return <><ModelParticles pool={poolRef} system={system} index={index} /><HitEffects /></>;
  }

  if (SHADE_TYPES.has(system.type as number)) {
    return <><ShadeParticles pool={poolRef} system={system} /><HitEffects /></>;
  }

  if (RANGE_TYPES.has(system.type as number)) {
    return <><RangeParticles pool={poolRef} system={system} /><HitEffects /></>;
  }

  return <><BillboardParticles pool={poolRef} system={system} /><HitEffects /></>;
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

/** Model-type particles rendered with THREE.InstancedMesh.
 *  Loads actual .lgo geometry when modelName is set; falls back to sphere. */
function ModelParticles({
  pool: poolRef,
  system,
  index,
}: {
  pool: React.RefObject<ParticlePool>;
  system: { modelName: string; srcBlend: number; destBlend: number };
  index: number;
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const currentProject = useAtomValue(currentProjectAtom);
  const parModels = useAtomValue(parModelDataAtom);

  // Try loading actual .lgo model geometry
  const loadedGeometry = useEffectModel(
    system.modelName?.trim() || undefined,
    currentProject?.id,
  );

  const particleData = useAtomValue(particleDataAtom);

  // Compute model data index by counting MODEL-type systems before this index.
  // The parModels array maps 1:1 to MODEL-type systems in order of appearance.
  const modelData = useMemo(() => {
    if (!parModels || !particleData) return null;
    let modelIdx = 0;
    for (let i = 0; i < index; i++) {
      if (particleData.systems[i]?.type === PARTICLE_TYPE.MODEL) {
        modelIdx++;
      }
    }
    return parModels[modelIdx] ?? null;
  }, [parModels, particleData, index]);

  const blendState = useMemo(() => {
    // Model data blend overrides system-level blend
    const src = modelData?.srcBlend || system.srcBlend;
    const dst = modelData?.destBlend || system.destBlend;
    if (!src && !dst) {
      return { blending: THREE.AdditiveBlending as THREE.Blending };
    }
    const { blendSrc, blendDst } = resolveBlendFactors(src, dst);
    return {
      blending: THREE.CustomBlending as THREE.Blending,
      blendSrc,
      blendDst,
    };
  }, [system.srcBlend, system.destBlend, modelData]);

  // Use loaded model geometry or fall back to sphere
  const baseGeometry = useMemo(
    () => loadedGeometry ?? new THREE.SphereGeometry(0.5, 8, 8),
    [loadedGeometry],
  );
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
    // Apply color tint from ParModelData
    if (modelData) {
      mat.color = new THREE.Color(modelData.color[0], modelData.color[1], modelData.color[2]);
      mat.opacity = modelData.color[3];
    }
    return mat;
  }, [blendState, modelData]);

  // Log warning for skeletal animation
  useEffect(() => {
    if (modelData && modelData.curPose > 0) {
      console.warn(
        `[ModelParticles] System index ${index}: curPose=${modelData.curPose} — skeletal animation not yet supported`,
      );
    }
  }, [modelData, index]);

  // playType-based continuous rotation
  const rotationRef = useRef(0);

  useFrame((_state, delta) => {
    const pool = poolRef.current;
    const mesh = meshRef.current;
    if (!pool || !mesh) return;

    // playType=1: continuous Y rotation at velocity rad/s
    if (modelData?.playType === 1) {
      rotationRef.current += delta * (modelData.velocity || 1);
    }

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
      // Apply per-particle rotation (Euler YXZ matching PKO convention)
      _dummy.rotation.set(
        pool.rotations[i3],
        pool.rotations[i3 + 1],
        pool.rotations[i3 + 2],
      );
      // playType=1: add continuous Y rotation
      if (modelData?.playType === 1) {
        _dummy.rotation.y += rotationRef.current;
      }
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

/** SHADE (type 13): Ground-plane decal quads at y=0.
 *  Each particle renders as a flat quad scaled by frame size, textured. */
function ShadeParticles({
  pool: poolRef,
  system,
}: {
  pool: React.RefObject<ParticlePool>;
  system: { textureName: string; srcBlend: number; destBlend: number };
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const currentProject = useAtomValue(currentProjectAtom);
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  const textureRef = useRef<THREE.Texture | null>(null);

  // Load texture
  useEffect(() => {
    const texName = system.textureName?.trim();
    if (!texName || !currentProject) { setTexture(null); return; }
    const isTauri = typeof window !== "undefined" && ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);
    if (!isTauri) { setTexture(null); return; }

    const candidates = resolveTextureCandidates(texName, currentProject.projectDirectory);
    let isActive = true;
    const tryLoad = async (index: number) => {
      if (index >= candidates.length) { setTexture(null); return; }
      try {
        const decoded = await invoke<{ width: number; height: number; data: string }>("decode_texture", { path: candidates[index] });
        if (!isActive) return;
        const binary = Uint8Array.from(atob(decoded.data), (c) => c.charCodeAt(0));
        const loaded = createEffectTexture(binary, decoded.width, decoded.height);
        textureRef.current?.dispose();
        textureRef.current = loaded;
        setTexture(loaded);
      } catch { void tryLoad(index + 1); }
    };
    void tryLoad(0);
    return () => { isActive = false; textureRef.current?.dispose(); };
  }, [system.textureName, currentProject]);

  const blendState = useMemo(() => {
    const src = system.srcBlend;
    const dst = system.destBlend;
    if (!src && !dst) return { blending: THREE.AdditiveBlending as THREE.Blending };
    const { blendSrc, blendDst } = resolveBlendFactors(src, dst);
    return { blending: THREE.CustomBlending as THREE.Blending, blendSrc, blendDst };
  }, [system.srcBlend, system.destBlend]);

  // Flat quad geometry lying on XZ plane (y=0)
  const baseGeometry = useMemo(() => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), []);
  const baseMaterial = useMemo(() => {
    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      blending: blendState.blending,
      map: texture,
      side: THREE.DoubleSide,
    });
    if (blendState.blending === THREE.CustomBlending && "blendSrc" in blendState) {
      mat.blendSrc = blendState.blendSrc!;
      mat.blendDst = blendState.blendDst!;
    }
    return mat;
  }, [blendState, texture]);

  useFrame(() => {
    const pool = poolRef.current;
    const mesh = meshRef.current;
    if (!pool || !mesh) return;

    let visibleCount = 0;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (!pool.alive[i]) continue;
      const i3 = i * 3;
      const size = pool.sizes[i];

      // Position on ground plane (y=0), scale by particle size
      _dummy.position.set(pool.positions[i3], 0, pool.positions[i3 + 2]);
      _dummy.rotation.set(0, 0, 0);
      _dummy.scale.set(size, 1, size);
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
    <instancedMesh ref={meshRef} args={[baseGeometry, baseMaterial, MAX_PARTICLES]} />
  );
}

/** RANGE/RANGE2 (types 14, 15): Expanding ring (annulus) at y=0. */
function RangeParticles({
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
    if (!src && !dst) return { blending: THREE.AdditiveBlending as THREE.Blending };
    const { blendSrc, blendDst } = resolveBlendFactors(src, dst);
    return { blending: THREE.CustomBlending as THREE.Blending, blendSrc, blendDst };
  }, [system.srcBlend, system.destBlend]);

  // Ring geometry: torus with small tube radius (flat ring appearance)
  const baseGeometry = useMemo(() => new THREE.RingGeometry(0.8, 1.0, 32).rotateX(-Math.PI / 2), []);
  const baseMaterial = useMemo(() => {
    const mat = new THREE.MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      blending: blendState.blending,
      side: THREE.DoubleSide,
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

      _dummy.position.set(pool.positions[i3], 0, pool.positions[i3 + 2]);
      _dummy.rotation.set(0, 0, 0);
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
    <instancedMesh ref={meshRef} args={[baseGeometry, baseMaterial, MAX_PARTICLES]} />
  );
}
