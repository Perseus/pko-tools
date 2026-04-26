import { ParticleSystemProps } from "./types";
import { ParticleVisual } from "./ParticleVisual";
import { useParticleLifecycle, Particle } from "./useParticleLifecycle";
import { randf } from "../../helpers";
import { ParSystem } from "@/types/effect-v2";

/**
 * Per-particle randomized direction at spawn.
 * Identical to BlastSystem — C++ _CreateBlast3 uses the same logic as _CreateBlast.
 */
function initBlast3Particle(p: Particle, _i: number, system: ParSystem) {
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
 * Per-frame position update for blast3 particles.
 * Identical to BlastSystem — pos += dir * dt, dir += accel * dt.
 */
function moveBlast3Particle(p: Particle, _i: number, dt: number) {
  p.pos.addScaledVector(p.dir, dt);
  p.dir.addScaledVector(p.accel, dt);
}

/** Type 11 — Blast variant 3 (identical behavior to Blast). */
export function Blast3System({ system, onComplete, loop }: ParticleSystemProps) {
  const particlesRef = useParticleLifecycle({
    system,
    loop,
    onComplete,
    initParticle: initBlast3Particle,
    moveParticle: moveBlast3Particle,
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
