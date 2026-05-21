import { useRef } from "react";
import { ParticleSystemProps } from "./types";
import { ParticleVisual } from "./ParticleVisual";
import { useParticleLifecycle } from "./useParticleLifecycle";
import {
  advanceBlast2ParticleFrame,
  initBlast2Particle,
  moveBlast2Particle,
} from "./blastKinematics";

/** Type 10 — Blast variant 2. */
export function Blast2System({ system, onComplete, loop, emitterPositionRef }: ParticleSystemProps) {
  const sharedEffectElapsedRef = useRef(0);
  const particlesRef = useParticleLifecycle({
    system,
    loop,
    onComplete,
    emitterPositionRef,
    sharedEffectElapsedRef,
    restartOnLoop: false,
    initParticle: initBlast2Particle,
    advanceFrame: advanceBlast2ParticleFrame,
    moveParticle: moveBlast2Particle,
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
