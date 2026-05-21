import { useRef } from "react";
import { ParticleSystemProps } from "./types";
import { ParticleVisual } from "./ParticleVisual";
import { useParticleLifecycle } from "./useParticleLifecycle";
import { computeShrinkSpawnState, moveShrinkParticle } from "./shrinkKinematics";
import { withEmitterPosition } from "./particlePlacement";

/** Type 12 — Particles shrinking inward. */
export function ShrinkSystem({ system, onComplete, loop, emitterPositionRef }: ParticleSystemProps) {
  const sharedEffectElapsedRef = useRef(0);
  const particlesRef = useParticleLifecycle({
    system,
    loop,
    onComplete,
    sharedEffectElapsedRef,
    finitePlayTimeStopBehavior: "drain",
    initParticle: (p, _i, s) => {
      const state = computeShrinkSpawnState(s);
      p.pos.copy(withEmitterPosition(state.pos, emitterPositionRef?.current));
      p.dir.copy(withEmitterPosition(state.target, emitterPositionRef?.current));
      p.accel.copy(p.dir).sub(p.pos);
      if (p.accel.lengthSq() > 0) p.accel.normalize();
    },
    moveParticle: moveShrinkParticle,
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
