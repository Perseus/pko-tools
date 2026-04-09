import { ParticleSystemProps } from "./types";
import { ParticleVisual } from "./ParticleVisual";
import { useParticleLifecycle, Particle } from "./useParticleLifecycle";
import { ParSystem } from "@/types/effect-v2";

/**
 * Per-particle spawn for snow.
 * Matches C++ _CreateSnow:
 * - vel.x = random(±0.2), vel.y = -velocity (downward), vel.z = random(±0.2)
 * - spawn position randomized within system range
 * PKO→Three.js coordinate swap (Y↔Z) applied.
 */
function initSnowParticle(p: Particle, _i: number, system: ParSystem) {
  // PKO: vel.x = random(±0.2), vel.y = -velocity, vel.z = random(±0.2)
  // Three.js: x = PKO x, y = PKO z, z = PKO y
  const lateralX = (Math.random() - 0.5) * 0.4; // random in [-0.2, 0.2)
  const lateralZ = (Math.random() - 0.5) * 0.4; // random in [-0.2, 0.2) (PKO Z → Three.js Z mapped from PKO Y)
  p.dir.set(
    lateralX,
    -system.velocity, // PKO vel.y = -velocity → Three.js Y (via PKO Z swap, but snow falls in PKO Y which is Three.js Y)
    lateralZ,
  );
  // No acceleration for snow — drift is handled in move
  p.accel.set(0, 0, 0);
  p.pos.set(
    (Math.random() - 0.5) * system.range[0] * 2,
    (Math.random() - 0.5) * system.range[2] * 2, // PKO Z → Three.js Y
    (Math.random() - 0.5) * system.range[1] * 2, // PKO Y → Three.js Z
  );
}

/**
 * Per-frame position update for snow particles.
 * Matches C++ _FrameMoveSnow:
 * - pos.x += sin(age*3 + seed*10) * 0.01 (lateral sinusoidal drift)
 * - pos += dir * dt (constant downward velocity, no acceleration integration)
 */
function moveSnowParticle(p: Particle, _i: number, dt: number) {
  p.pos.addScaledVector(p.dir, dt);
  // Lateral sinusoidal drift using elapsed time and deterministic seed from index
  p.pos.x += Math.sin(p.elapsed * 3 + p.index * 10) * 0.01;
}

/** Type 1 — Snow particles falling downward. */
export function SnowSystem({ system, onComplete, loop }: ParticleSystemProps) {
  const particlesRef = useParticleLifecycle({
    system,
    loop,
    onComplete,
    initParticle: initSnowParticle,
    moveParticle: moveSnowParticle,
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
