import { useRef } from "react";
import * as THREE from "three";
import { ParticleSystemProps } from "./types";
import { ParticleVisual } from "./ParticleVisual";
import { useParticleLifecycle } from "./useParticleLifecycle";
import { initWindParticle, moveWindParticle } from "./windKinematics";
import { withEmitterPosition } from "./particlePlacement";

/**
 * Wind system stores spawn positions per particle for spiral rotation reference.
 * This factory returns init/move closures that share a spawn position map.
 */
/** Type 7 — Wind-driven spiral tornado particles. */
export function WindSystem({ system, onComplete, loop, emitterPositionRef }: ParticleSystemProps) {
  const sharedEffectElapsedRef = useRef(0);
  const spawnPositions = useRef<Map<number, THREE.Vector3>>(new Map());

  const particlesRef = useParticleLifecycle({
    system,
    loop,
    onComplete,
    emitterPositionRef,
    sharedEffectElapsedRef,
    spawnOnCreate: false,
    respawnDeadParticles: true,
    initParticle: (p, i, s) => {
      const state = initWindParticle(p, i, s);
      spawnPositions.current.set(
        p.index,
        withEmitterPosition(state.origin, emitterPositionRef?.current),
      );
    },
    moveParticle: (p, i, dt, s) => {
      const origin = spawnPositions.current.get(p.index);
      if (origin) moveWindParticle(p, i, dt, s, origin);
    },
  });

  const alive = particlesRef.current.filter((p) => p.alive);

  return (
    <group>
      {alive.map((p) => (
        <group key={p.index} position={p.pos} scale={p.size}>
          <ParticleVisual system={system} particle={p} loop={loop} sharedEffectElapsedRef={sharedEffectElapsedRef} />
        </group>
      ))}
    </group>
  );
}
