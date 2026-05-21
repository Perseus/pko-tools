import { useEffect, useRef } from "react";
import { ParticleSystemProps } from "./types";
import { ParticleVisual } from "./ParticleVisual";
import { useParticleLifecycle, Particle } from "./useParticleLifecycle";
import { ParSystem } from "@/types/effect-v2";
import {
  computeDummyMovementDelta,
  computeDummySpawnPosition,
  DummyLineSpan,
} from "./dummyLineKinematics";

/**
 * Per-particle spawn for dummy.
 * Matches C++ _CreateDummy:
 * - requires GetDummyPosList
 * - starts at a discrete bucket along dummy2 -> dummy1
 * - stores normalized _vDir and acceleration for _FrameMoveDummy
 */
function initDummyParticle(p: Particle, _i: number, system: ParSystem, dummyLineSpan?: DummyLineSpan | null) {
  if (!dummyLineSpan) {
    p.alive = false;
    return;
  }

  p.dir.set(system.direction[0], system.direction[1], system.direction[2]);
  if (p.dir.lengthSq() > 0) p.dir.normalize();
  p.accel.set(system.acceleration[0], system.acceleration[1], system.acceleration[2]);
  p.pos.copy(computeDummySpawnPosition(dummyLineSpan, system.particleCount));
}

/**
 * Per-frame position update for dummy particles.
 * Matches C++ _FrameMoveDummy movement from _vDir, _fVecl, and signed acceleration.
 */
function moveDummyParticle(p: Particle, _i: number, dt: number, system: ParSystem) {
  p.pos.add(computeDummyMovementDelta(p.dir, p.accel, system.velocity, dt));
}

/** Type 16 — Dummy/placeholder particle system (bound to attachment points). */
export function DummySystem(props: ParticleSystemProps) {
  const { dummyLineSpan, onComplete } = props;

  useEffect(() => {
    if (!dummyLineSpan) onComplete?.();
  }, [dummyLineSpan, onComplete]);

  if (!dummyLineSpan) return null;

  return <DummyActiveSystem {...props} dummyLineSpan={dummyLineSpan} />;
}

function DummyActiveSystem({
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
    initParticle: (p, i, s) => initDummyParticle(p, i, s, dummyLineSpan),
    moveParticle: moveDummyParticle,
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
