import { useEffect, useRef } from "react";
import { ParticleSystemProps } from "./types";
import { ParticleVisual } from "./ParticleVisual";
import { useParticleLifecycle, Particle } from "./useParticleLifecycle";
import { ParSystem } from "@/types/effect-v2";
import {
  computeLineRoundVelocity,
  DummyLineSpan,
} from "./dummyLineKinematics";

/**
 * Per-particle spawn for line-round.
 * Matches C++ _CreateLineRound in MPParticleSys.cpp:
 * - requires GetDummyPosList() to provide the dummy span
 * - starts at dummy2 and travels toward dummy1 at double-speed, then reverses halfway
 */
function initLineRoundParticle(p: Particle, _i: number, _system: ParSystem, dummyLineSpan: DummyLineSpan) {
  p.pos.copy(dummyLineSpan.start);
  p.dir.copy(computeLineRoundVelocity(dummyLineSpan, p.life));
  p.accel.set(0, 0, 0);
}

/**
 * Per-frame position update for line round particles.
 * C++ reverses velocity when the particle crosses half its lifetime.
 */
function moveLineRoundParticle(p: Particle, _i: number, dt: number) {
  if (p.elapsed > p.life / 2 && p.elapsed - dt <= p.life / 2) {
    p.dir.negate();
  }
  p.pos.addScaledVector(p.dir, dt);
}

/** Type 18 — Round/circular line particle emission. */
export function LineRoundSystem(props: ParticleSystemProps) {
  const { dummyLineSpan, onComplete } = props;

  useEffect(() => {
    if (!dummyLineSpan) onComplete?.();
  }, [dummyLineSpan, onComplete]);

  if (!dummyLineSpan) return null;

  return <LineRoundActiveSystem {...props} dummyLineSpan={dummyLineSpan} />;
}

function LineRoundActiveSystem({
  system,
  onComplete,
  loop,
  dummyLineSpan,
  emitterPositionRef,
}: ParticleSystemProps & { dummyLineSpan: DummyLineSpan }) {
  const sharedEffectElapsedRef = useRef(0);
  const particlesRef = useParticleLifecycle({
    system,
    loop,
    onComplete,
    emitterPositionRef,
    sharedEffectElapsedRef,
    initParticle: (p, i, s) => initLineRoundParticle(p, i, s, dummyLineSpan),
    moveParticle: moveLineRoundParticle,
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
