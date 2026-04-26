import { ParticleSystemProps } from "./types";
import { ParticleVisual } from "./ParticleVisual";
import { useParticleLifecycle, Particle } from "./useParticleLifecycle";
import { ParSystem } from "@/types/effect-v2";

/**
 * Per-particle spawn for dummy.
 * Matches C++ _CreateDummy:
 * - vel = 0. Static invisible particle used as a hit effect anchor.
 */
function initDummyParticle(_p: Particle, _i: number, _system: ParSystem) {
  // No velocity, no acceleration — dummy is a static anchor point
}

/**
 * Per-frame position update for dummy particles.
 * No-op — dummy is static.
 */
function moveDummyParticle(_p: Particle, _i: number, _dt: number) {
  // No movement
}

/** Type 16 — Dummy/placeholder particle system (bound to attachment points). */
export function DummySystem({ system, onComplete, loop }: ParticleSystemProps) {
  const particlesRef = useParticleLifecycle({
    system,
    loop,
    onComplete,
    initParticle: initDummyParticle,
    moveParticle: moveDummyParticle,
  });

  const alive = particlesRef.current.filter((p) => p.alive);

  return (
    <group>
      {alive.map((p) => (
        <group key={p.index} position={p.pos} scale={p.size}>
          <ParticleVisual system={system} particle={p} loop={loop} />
        </group>
      ))}
    </group>
  );
}
