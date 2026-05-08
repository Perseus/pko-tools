import { useEffect, useRef } from "react";
import { ParticleSystemProps } from "./types";
import { ParticleVisual } from "./ParticleVisual";
import { useParticleLifecycle, Particle } from "./useParticleLifecycle";
import { ParSystem } from "@/types/effect-v2";
import {
  computeLineSingleDelta,
  computeLineSingleVelocity,
  DummyLineSpan,
} from "./dummyLineKinematics";

/**
 * Per-particle spawn for line-single.
 * Matches C++ _CreateLineSingle:
 * - requires GetDummyPosList() to provide the dummy span
 * - vel = dummy distance / particle life along dummy1 - dummy2
 */
function initLineSingleParticle(p: Particle, _i: number, _system: ParSystem, dummyLineSpan: DummyLineSpan) {
  p.pos.copy(dummyLineSpan.start);
  p.dir.copy(computeLineSingleVelocity(dummyLineSpan, p.life));
  p.accel.set(0, 0, 0);
}

/**
 * Per-frame position update for line-single particles.
 * C++ applies velocity plus the particle acceleration term; acceleration is zero at spawn.
 */
function moveLineSingleParticle(p: Particle, _i: number, dt: number) {
  p.pos.add(computeLineSingleDelta(p.dir, p.accel, dt));
}

/** Type 17 — Single line particle emission. */
export function LineSingleSystem(props: ParticleSystemProps) {
  const { dummyLineSpan, onComplete } = props;

  useEffect(() => {
    if (!dummyLineSpan) onComplete?.();
  }, [dummyLineSpan, onComplete]);

  if (!dummyLineSpan) return null;

  return <LineSingleActiveSystem {...props} dummyLineSpan={dummyLineSpan} />;
}

function LineSingleActiveSystem({
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
    initParticle: (p, i, s) => initLineSingleParticle(p, i, s, dummyLineSpan),
    moveParticle: moveLineSingleParticle,
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
