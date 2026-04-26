import { ParticleSystemProps } from "./types";
import { ParticleVisual } from "./ParticleVisual";
import { useParticleLifecycle, Particle } from "./useParticleLifecycle";
import { randf } from "../../helpers";
import { ParSystem } from "@/types/effect-v2";

/**
 * Per-particle spawn for fire.
 * Matches C++ _CreateFire:
 * - vel = dir * velocity + spread * random, where spread = 0.3
 * - vel.y += random() * 0.2 * velocity (extra upward boost)
 * - spawn position randomized within system range
 * PKO→Three.js coordinate swap (Y↔Z) applied.
 */
function initFireParticle(p: Particle, _i: number, system: ParSystem) {
  const spread = 0.3;
  // V1: vel = dir*velocity + spread*random per axis, vel.y += random()*0.2*velocity (upward boost)
  // PKO→Three.js swap: [0]→X, [2]→Y (up), [1]→Z
  p.dir.set(
    system.direction[0] * system.velocity + (Math.random() - 0.5) * 2 * spread,
    system.direction[2] * system.velocity + (Math.random() - 0.5) * 2 * spread + Math.random() * 0.2 * system.velocity,
    system.direction[1] * system.velocity + (Math.random() - 0.5) * 2 * spread,
  );
  p.accel.set(system.acceleration[0], system.acceleration[2], system.acceleration[1]);
  p.pos.set(
    randf(system.range[0]),
    randf(system.range[2]),
    randf(system.range[1]),
  );
}

/**
 * Per-frame position update for fire particles.
 * Default physics: pos += dir*dt; dir += accel*dt
 */
function moveFireParticle(p: Particle, _i: number, dt: number) {
  p.pos.addScaledVector(p.dir, dt);
  p.dir.addScaledVector(p.accel, dt);
}

/** Type 2 — Fire particles rising upward. */
export function FireSystem({ system, onComplete, loop }: ParticleSystemProps) {
  const particlesRef = useParticleLifecycle({
    system,
    loop,
    onComplete,
    initParticle: initFireParticle,
    moveParticle: moveFireParticle,
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
