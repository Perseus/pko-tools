import { ParticleSystemProps } from "./types";
import { ParticleVisual } from "./ParticleVisual";
import { useParticleLifecycle, Particle } from "./useParticleLifecycle";
import { randf } from "../../helpers";
import { ParSystem } from "@/types/effect-v2";

/**
 * Per-particle randomized direction at spawn.
 * Matches C++ _CreateBlast in MPParticleSys.cpp:
 * - velocity magnitude randomized per-particle per-axis
 * - direction sign randomized per-particle for X/Z, always positive for Y
 * - spawn position randomized within system range
 * PKO→Three.js coordinate swap (Y↔Z) applied same as existing code.
 */
function initBlastParticle(p: Particle, _i: number, system: ParSystem) {
  p.dir.set(
    randf(system.velocity) * (Math.random() < 0.5 ? system.direction[0] : -system.direction[0]),
    randf(system.velocity) * system.direction[2],
    randf(system.velocity) * (Math.random() < 0.5 ? system.direction[1] : -system.direction[1]),
  );
  p.accel.set(system.acceleration[0], system.acceleration[2], system.acceleration[1]);
  p.pos.set(
    randf(system.range[0]),
    randf(system.range[2]),
    randf(system.range[1]),
  );
}

/**
 * Per-frame position update for blast particles.
 * Matches C++ _FrameMoveBlast:
 *   pos += dir * dt
 *   dir += accel * dt  (acceleration curves trajectory over time)
 */
function moveBlastParticle(p: Particle, _i: number, dt: number) {
  p.pos.addScaledVector(p.dir, dt);
  p.dir.addScaledVector(p.accel, dt);
}

/** Type 3 — Blast particles exploding outward. */
export function BlastSystem({ system, onComplete, loop }: ParticleSystemProps) {
  const particlesRef = useParticleLifecycle({
    system,
    loop,
    onComplete,
    initParticle: initBlastParticle,
    moveParticle: moveBlastParticle,
  });

  // particlesRef is mutated by useFrame without triggering re-renders.
  // This filter may be stale between renders — acceptable for blast (fast transient).
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
