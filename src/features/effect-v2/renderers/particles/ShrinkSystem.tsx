import { ParticleSystemProps } from "./types";
import { ParticleVisual } from "./ParticleVisual";
import { useParticleLifecycle, Particle } from "./useParticleLifecycle";
import { randf } from "../../helpers";
import { ParSystem } from "@/types/effect-v2";

/**
 * Per-particle spawn for shrink.
 * Matches C++ _CreateShrink:
 * - If direction vector length > 0.001: vel = dir * velocity (directed)
 * - Else: spherical random velocity (same as Blast — random magnitude per axis, random sign for X/Z)
 * - Spawn position randomized within system range
 * PKO→Three.js coordinate swap (Y↔Z) applied.
 */
function initShrinkParticle(p: Particle, _i: number, system: ParSystem) {
  const dirLen = Math.sqrt(
    system.direction[0] ** 2 +
    system.direction[1] ** 2 +
    system.direction[2] ** 2,
  );

  if (dirLen > 0.001) {
    // Directed mode: vel = dir * velocity
    p.dir.set(
      system.direction[0] * system.velocity,
      system.direction[2] * system.velocity, // PKO Z → Three.js Y
      system.direction[1] * system.velocity, // PKO Y → Three.js Z
    );
  } else {
    // Spherical random (same as Blast)
    p.dir.set(
      randf(system.velocity) * (Math.random() < 0.5 ? system.direction[0] : -system.direction[0]),
      randf(system.velocity) * system.direction[2],
      randf(system.velocity) * (Math.random() < 0.5 ? system.direction[1] : -system.direction[1]),
    );
  }

  p.accel.set(system.acceleration[0], system.acceleration[2], system.acceleration[1]);
  p.pos.set(
    randf(system.range[0]),
    randf(system.range[2]),
    randf(system.range[1]),
  );
}

/**
 * Per-frame position update for shrink particles.
 * Default physics: pos += dir*dt; dir += accel*dt
 */
function moveShrinkParticle(p: Particle, _i: number, dt: number) {
  p.pos.addScaledVector(p.dir, dt);
  p.dir.addScaledVector(p.accel, dt);
}

/** Type 12 — Particles shrinking inward. */
export function ShrinkSystem({ system, onComplete, loop }: ParticleSystemProps) {
  const particlesRef = useParticleLifecycle({
    system,
    loop,
    onComplete,
    initParticle: initShrinkParticle,
    moveParticle: moveShrinkParticle,
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
