import { useMemo, useRef } from "react";
import { ParticleSystemProps } from "./types";
import { ParticleVisual } from "./ParticleVisual";
import { useParticleLifecycle } from "./useParticleLifecycle";
import { initArrowParticle, moveArrowParticle } from "./arrowKinematics";

/** Type 8 — Arrow/projectile particles. */
export function ArrowSystem({ system, onComplete, loop, emitterPositionRef }: ParticleSystemProps) {
  const sharedEffectElapsedRef = useRef(0);
  const singleParticleSystem = useMemo(
    () => ({ ...system, particleCount: 1 }),
    [system],
  );

  const particlesRef = useParticleLifecycle({
    system: singleParticleSystem,
    loop,
    onComplete,
    emitterPositionRef,
    sharedEffectElapsedRef,
    frameEndBehavior: "reset",
    initParticle: initArrowParticle,
    moveParticle: (p, i, dt, s, pathOffset) =>
      moveArrowParticle(p, i, dt, s, emitterPositionRef?.current, pathOffset),
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
