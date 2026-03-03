/// <reference types="@react-three/fiber" />
import React, { useCallback, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Vec3, EffectFile } from "@/types/effect";
import type { OnParticleDeath } from "@/features/effect/particle/particlePool";
import { loadEffect } from "@/commands/effect";
import HitSubEffect from "@/features/effect/HitSubEffect";

/** Maximum simultaneous hit effect instances to prevent runaway. */
const MAX_HIT_INSTANCES = 10;

interface HitInstance {
  id: number;
  position: Vec3;
  effectName: string;
  startTime: number;
  duration: number;
  effectFile: EffectFile | null;
  /** True while the .eff file is being loaded. */
  loading: boolean;
}

/**
 * Manages temporary hit effect instances spawned when particles die.
 *
 * Loads actual .eff files and renders sub-effects at death positions.
 * Falls back to placeholder spheres while loading or if no project context.
 */
export function useHitEffectManager(
  projectId?: string,
  projectDir?: string,
): {
  onParticleDeath: OnParticleDeath;
  HitEffects: React.FC;
} {
  const instancesRef = useRef<HitInstance[]>([]);
  const nextIdRef = useRef(0);
  const elapsedRef = useRef(0);
  const effectCacheRef = useRef<Map<string, EffectFile>>(new Map());

  const onParticleDeath: OnParticleDeath = useCallback(
    (position: Vec3, hitEffect: string) => {
      if (!hitEffect || instancesRef.current.length >= MAX_HIT_INSTANCES) return;

      const id = nextIdRef.current++;
      const cached = effectCacheRef.current.get(hitEffect);

      const instance: HitInstance = {
        id,
        position,
        effectName: hitEffect,
        startTime: elapsedRef.current,
        duration: cached ? computeEffectDuration(cached) : 2.0,
        effectFile: cached ?? null,
        loading: !cached && !!projectId,
      };

      instancesRef.current.push(instance);

      // Load .eff file async if not cached and project available
      if (!cached && projectId) {
        loadEffect(projectId, hitEffect)
          .then((file) => {
            effectCacheRef.current.set(hitEffect, file);
            // Update all pending instances with this effect name
            for (const inst of instancesRef.current) {
              if (inst.effectName === hitEffect && inst.loading) {
                inst.effectFile = file;
                inst.loading = false;
                inst.duration = computeEffectDuration(file);
              }
            }
          })
          .catch(() => {
            // Failed to load — keep placeholder behavior
            for (const inst of instancesRef.current) {
              if (inst.effectName === hitEffect && inst.loading) {
                inst.loading = false;
              }
            }
          });
      }
    },
    [projectId],
  );

  // Stable component reference — defined once via useMemo so React doesn't
  // unmount/remount every render. Uses closured refs for state access.
  const HitEffects: React.FC = useMemo(() => {
    const Component: React.FC = () => {
      const groupRef = useRef<THREE.Group>(null);
      const meshesRef = useRef<Map<number, THREE.Mesh>>(new Map());

      useFrame((_state, delta) => {
        elapsedRef.current += delta;

        // Remove expired instances
        instancesRef.current = instancesRef.current.filter((inst) => {
          const age = elapsedRef.current - inst.startTime;
          if (age >= inst.duration) {
            // Clean up placeholder mesh if it exists
            const mesh = meshesRef.current.get(inst.id);
            if (mesh && groupRef.current) {
              groupRef.current.remove(mesh);
              mesh.geometry.dispose();
              (mesh.material as THREE.Material).dispose();
            }
            meshesRef.current.delete(inst.id);
            return false;
          }
          return true;
        });

        // Update placeholder meshes for instances without loaded effects
        for (const inst of instancesRef.current) {
          if (inst.effectFile) continue; // rendered via HitSubEffect

          let mesh = meshesRef.current.get(inst.id);
          if (!mesh) {
            // Create placeholder hit effect sphere
            const geo = new THREE.SphereGeometry(0.3, 8, 8);
            const mat = new THREE.MeshBasicMaterial({
              color: 0xff8800,
              transparent: true,
              opacity: 1,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
            });
            mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(inst.position[0], inst.position[1], inst.position[2]);
            meshesRef.current.set(inst.id, mesh);
            groupRef.current?.add(mesh);
          }

          // Fade out over duration
          const age = elapsedRef.current - inst.startTime;
          const t = age / inst.duration;
          const mat = mesh.material as THREE.MeshBasicMaterial;
          mat.opacity = Math.max(1 - t, 0);
          mesh.scale.setScalar(1 + t * 2); // Expand while fading
        }
      });

      // Render loaded sub-effects via R3F components
      const subEffectElements: React.ReactNode[] = [];
      for (const inst of instancesRef.current) {
        if (!inst.effectFile) continue;
        const age = elapsedRef.current - inst.startTime;
        for (let si = 0; si < inst.effectFile.subEffects.length; si++) {
          subEffectElements.push(
            <HitSubEffect
              key={`${inst.id}-${si}`}
              subEffect={inst.effectFile.subEffects[si]}
              position={inst.position}
              elapsed={age}
              projectDir={projectDir ?? ""}
              idxTech={inst.effectFile.idxTech}
            />,
          );
        }
      }

      return (
        <group ref={groupRef}>
          {subEffectElements}
        </group>
      );
    };
    return Component;
  }, [projectDir]);

  return { onParticleDeath, HitEffects };
}

/** Compute hit effect duration from the max sub-effect length. */
function computeEffectDuration(file: EffectFile): number {
  let maxLen = 0;
  for (const se of file.subEffects) {
    if (se.length > maxLen) maxLen = se.length;
  }
  return maxLen > 0 ? maxLen : 2.0;
}
