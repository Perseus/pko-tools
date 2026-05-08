import { useRef } from "react";
import { ParticleSystemProps } from "./types";
import { ParticleVisual } from "./ParticleVisual";
import { useParticleLifecycle } from "./useParticleLifecycle";
import { initRoundParticle, moveRoundParticle } from "./roundKinematics";

/** Type 9 — Particles emitted in a circular/round pattern. */
export function RoundSystem({ system, onComplete, loop, emitterPositionRef }: ParticleSystemProps) {
  const sharedEffectElapsedRef = useRef(0);
  const particlesRef = useParticleLifecycle({
    system,
    loop,
    frameEndBehavior: "reset",
    lastFrameNext: "wrap",
    onComplete,
    emitterPositionRef,
    sharedEffectElapsedRef,
    initParticle: initRoundParticle,
    moveParticle: (p, i, dt, s, pathOffset) =>
      moveRoundParticle(p, i, dt, s, emitterPositionRef?.current, pathOffset),
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
