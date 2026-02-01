/// <reference types="@react-three/fiber" />
import { PARTICLE_TYPE } from "@/types/particle";
import { effectPlaybackAtom } from "@/store/effect";
import { particleDataAtom, selectedParticleSystemIndexAtom } from "@/store/particle";
import { useAtomValue } from "jotai";
import React from "react";
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  MAX_PARTICLES,
  createPool,
  resetPool,
  tickPool,
  type ParticlePool,
} from "@/features/effect/particle/particlePool";

// Billboard particle shaders
const vertexShader = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
varying float vAlpha;
varying vec3 vColor;

void main() {
  vColor = color;
  vAlpha = aAlpha;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (200.0 / -mvPosition.z);
  gl_PointSize = max(gl_PointSize, 1.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const fragmentShader = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;

void main() {
  // Soft circle falloff
  float dist = length(gl_PointCoord - vec2(0.5));
  if (dist > 0.5) discard;
  float alpha = vAlpha * smoothstep(0.5, 0.2, dist);
  gl_FragColor = vec4(vColor, alpha);
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
    return <ModelParticles pool={poolRef} />;
  }

  return <BillboardParticles pool={poolRef} />;
}

/** Billboard particles rendered with THREE.Points + ShaderMaterial. */
function BillboardParticles({ pool: poolRef }: { pool: React.RefObject<ParticlePool> }) {
  const pointsRef = useRef<THREE.Points>(null);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(MAX_PARTICLES * 3);
    const col = new Float32Array(MAX_PARTICLES * 3);
    const sizes = new Float32Array(MAX_PARTICLES);
    const alphas = new Float32Array(MAX_PARTICLES);

    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(alphas, 1));

    return geo;
  }, []);

  useFrame(() => {
    const pool = poolRef.current;
    if (!pool) return;

    const posAttr = geometry.getAttribute("position") as THREE.BufferAttribute;
    const colAttr = geometry.getAttribute("color") as THREE.BufferAttribute;
    const sizeAttr = geometry.getAttribute("aSize") as THREE.BufferAttribute;
    const alphaAttr = geometry.getAttribute("aAlpha") as THREE.BufferAttribute;

    (posAttr.array as Float32Array).set(pool.positions);
    (colAttr.array as Float32Array).set(pool.colors);
    (sizeAttr.array as Float32Array).set(pool.sizes);
    (alphaAttr.array as Float32Array).set(pool.alphas);

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    sizeAttr.needsUpdate = true;
    alphaAttr.needsUpdate = true;
  });

  return <points ref={pointsRef} geometry={geometry} material={material} />;
}

/** Model-type particles rendered with THREE.InstancedMesh. */
function ModelParticles({ pool: poolRef }: { pool: React.RefObject<ParticlePool> }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  const baseGeometry = useMemo(() => new THREE.SphereGeometry(0.5, 8, 8), []);
  const baseMaterial = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );

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
