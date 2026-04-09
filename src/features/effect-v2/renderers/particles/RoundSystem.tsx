import { ParticleSystemProps } from "./types";
import { ParticleVisual } from "./ParticleVisual";
import { useParticleLifecycle, Particle } from "./useParticleLifecycle";
import { ParSystem } from "@/types/effect-v2";

/**
 * Per-particle spawn on a circular ring with tangential + vertical velocity.
 * Matches C++ _CreateRound in MPParticleSys.cpp:
 * - random angle on XZ circle, radius 0.5–1.0
 * - tangential velocity in XZ, slight vertical from direction[2] (PKO Z → Three.js Y)
 */
function initRoundParticle(p: Particle, _i: number, system: ParSystem) {
  const angle = Math.random() * Math.PI * 2;
  const radius = 0.5 + Math.random() * 0.5;
  const vel = system.velocity;

  p.pos.x += Math.cos(angle) * radius;
  p.pos.z += Math.sin(angle) * radius;

  p.dir.set(
    -Math.sin(angle) * vel,
    system.direction[2] * vel * 0.1,
    Math.cos(angle) * vel,
  );
  p.accel.set(system.acceleration[0], system.acceleration[2], system.acceleration[1]);
}

/**
 * Per-frame position update for round particles.
 * Default physics: pos += dir * dt, dir += accel * dt.
 */
function moveRoundParticle(p: Particle, _i: number, dt: number) {
  p.pos.addScaledVector(p.dir, dt);
  p.dir.addScaledVector(p.accel, dt);
}

/** Type 9 — Particles emitted in a circular/round pattern. */
export function RoundSystem({ system, onComplete, loop }: ParticleSystemProps) {
  const particlesRef = useParticleLifecycle({
    system,
    loop,
    onComplete,
    initParticle: initRoundParticle,
    moveParticle: moveRoundParticle,
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
