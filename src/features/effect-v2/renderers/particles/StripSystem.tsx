import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ParticleSystemProps } from "./types";
import { ParticleVisual } from "./ParticleVisual";
import { Particle, useParticleLifecycle } from "./useParticleLifecycle";
import { initStripParticle, moveStripParticle } from "./stripKinematics";

/**
 * Type 6 — Ribbon/strip trail between points.
 * Currently renders as standard particles via ParticleVisual.
 * True strip/ribbon geometry (view-dependent) will be added in Phase 5.
 */
export function StripSystem({
  system,
  onComplete,
  loop,
  emitterPositionRef,
  sourceDirectionRef,
}: ParticleSystemProps) {
  const sharedEffectElapsedRef = useRef(0);
  const [, forceRender] = useReducer((n: number) => n + 1, 0);
  const lastAliveSignatureRef = useRef("");
  const isNestedEffect = system.modelName.trim().toLowerCase().endsWith(".eff");
  const [nestedEffectComplete, setNestedEffectComplete] = useState(false);
  const singleParticleSystem = useMemo(
    () => ({ ...system, particleCount: 1 }),
    [system],
  );
  const completionSentRef = useRef(false);

  useEffect(() => {
    setNestedEffectComplete(false);
    completionSentRef.current = false;
  }, [system.modelName, loop]);

  const handleNestedEffectComplete = () => {
    if (!isNestedEffect || loop || completionSentRef.current) return;
    completionSentRef.current = true;
    setNestedEffectComplete(true);
    onComplete?.();
  };

  const particlesRef = useParticleLifecycle({
    system: singleParticleSystem,
    loop,
    onComplete,
    emitterPositionRef,
    sharedEffectElapsedRef,
    initParticle: initStripParticle,
    moveParticle: (p, i, dt, s, pathOffset) =>
      moveStripParticle(p, i, dt, s, emitterPositionRef?.current, pathOffset),
  });

  useFrame(() => {
    const aliveSignature = particlesRef.current
      .filter((p) => p.alive)
      .map((p) => p.index)
      .join(",");
    if (aliveSignature !== lastAliveSignatureRef.current) {
      lastAliveSignatureRef.current = aliveSignature;
      forceRender();
    }
  });

  const alive = nestedEffectComplete ? [] : particlesRef.current.filter((p) => p.alive);

  return (
    <group>
      {alive.map((p) => (
        <StripParticleInstance
          key={p.index}
          particle={p}
          system={system}
          loop={loop}
          sourceDirectionRef={sourceDirectionRef}
          sharedEffectElapsedRef={sharedEffectElapsedRef}
          onNestedEffectComplete={handleNestedEffectComplete}
        />
      ))}
    </group>
  );
}

function StripParticleInstance({
  particle,
  system,
  loop,
  sourceDirectionRef,
  sharedEffectElapsedRef,
  onNestedEffectComplete,
}: {
  particle: Particle;
  system: ParticleSystemProps["system"];
  loop?: boolean;
  sourceDirectionRef?: ParticleSystemProps["sourceDirectionRef"];
  sharedEffectElapsedRef: MutableRefObject<number>;
  onNestedEffectComplete?: () => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const particleRef = useRef(particle);
  particleRef.current = particle;

  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;
    const current = particleRef.current;
    group.position.copy(current.pos);
    group.scale.setScalar(current.size);
  });

  return (
    <group ref={groupRef} position={particle.pos.clone()} scale={particle.size}>
      <ParticleVisual
        system={system}
        particle={particle}
        loop={loop}
        sourceDirectionRef={sourceDirectionRef}
        sharedEffectElapsedRef={sharedEffectElapsedRef}
        onNestedEffectComplete={onNestedEffectComplete}
      />
    </group>
  );
}
