import { useReducer, useRef } from "react";
import type { MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ParticleSystemProps } from "./types";
import { ParticleVisual } from "./ParticleVisual";
import { Particle, useParticleLifecycle } from "./useParticleLifecycle";
import { initSnowParticle, moveSnowParticle } from "./snowKinematics";

/** Type 1 — Snow particles falling downward. */
export function SnowSystem({ system, onComplete, loop, emitterPositionRef }: ParticleSystemProps) {
  const sharedEffectElapsedRef = useRef(0);
  const [, forceRender] = useReducer((n: number) => n + 1, 0);
  const lastAliveSignatureRef = useRef("");
  const particlesRef = useParticleLifecycle({
    system,
    loop,
    onComplete,
    emitterPositionRef,
    sharedEffectElapsedRef,
    spawnOnCreate: false,
    respawnDeadParticles: true,
    finitePlayTimeStopBehavior: "drain",
    initParticle: initSnowParticle,
    moveParticle: moveSnowParticle,
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

  const alive = particlesRef.current.filter((p) => p.alive);

  return (
    <group>
      {alive.map((p) => (
        <SnowParticleInstance
          key={p.index}
          particle={p}
          system={system}
          loop={loop}
          sharedEffectElapsedRef={sharedEffectElapsedRef}
        />
      ))}
    </group>
  );
}

function SnowParticleInstance({
  particle,
  system,
  loop,
  sharedEffectElapsedRef,
}: {
  particle: Particle;
  system: ParticleSystemProps["system"];
  loop?: boolean;
  sharedEffectElapsedRef: MutableRefObject<number>;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const particleRef = useRef(particle);
  particleRef.current = particle;

  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;
    const current = particleRef.current;
    group.visible = current.alive;
    group.position.copy(current.pos);
    group.scale.setScalar(current.size);
  });

  return (
    <group ref={groupRef} position={particle.pos.clone()} scale={particle.size}>
      <ParticleVisual
        system={system}
        particle={particle}
        loop={loop}
        sharedEffectElapsedRef={sharedEffectElapsedRef}
      />
    </group>
  );
}
