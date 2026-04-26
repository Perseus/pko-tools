import { ParticleSystemProps } from "./types";
import { ParticleVisual } from "./ParticleVisual";
import { useParticleLifecycle, Particle } from "./useParticleLifecycle";
import { randf } from "../../helpers";
import { ParSystem } from "@/types/effect-v2";

/**
 * Per-particle spawn for line-single.
 * Matches C++ _CreateLineSingle:
 * - vel = direction * velocity (straight line in fixed direction)
 * - Spawn position randomized within system range
 * PKO→Three.js coordinate swap (Y↔Z) applied.
 */
function initLineSingleParticle(p: Particle, _i: number, system: ParSystem) {
  p.dir.set(
    system.direction[0] * system.velocity,
    system.direction[2] * system.velocity, // PKO Z → Three.js Y
    system.direction[1] * system.velocity, // PKO Y → Three.js Z
  );
  p.accel.set(system.acceleration[0], system.acceleration[2], system.acceleration[1]);
  p.pos.set(
    randf(system.range[0]),
    randf(system.range[2]),
    randf(system.range[1]),
  );
}

/**
 * Per-frame position update for line-single particles.
 * Default physics: pos += dir*dt; dir += accel*dt
 */
function moveLineSingleParticle(p: Particle, _i: number, dt: number) {
  p.pos.addScaledVector(p.dir, dt);
  p.dir.addScaledVector(p.accel, dt);
}

/** Type 17 — Single line particle emission. */
export function LineSingleSystem({ system, onComplete, loop }: ParticleSystemProps) {
  const particlesRef = useParticleLifecycle({
    system,
    loop,
    onComplete,
    initParticle: initLineSingleParticle,
    moveParticle: moveLineSingleParticle,
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
