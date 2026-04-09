import { ParticleSystemProps } from "./types";
import { ParticleVisual } from "./ParticleVisual";
import { useParticleLifecycle, Particle } from "./useParticleLifecycle";
import { ParSystem } from "@/types/effect-v2";

/**
 * Per-particle spawn on a circular ring with tangential velocity.
 * Matches C++ _CreateLineRound in MPParticleSys.cpp:
 * - random angle on XZ circle, radius from range[0] (or 1.0 if zero)
 * - tangential velocity in XZ, no vertical component
 */
function initLineRoundParticle(p: Particle, _i: number, system: ParSystem) {
  const angle = Math.random() * Math.PI * 2;
  const radius = system.range[0] > 0 ? system.range[0] : 1.0;
  const vel = system.velocity;

  p.pos.x += Math.cos(angle) * radius;
  p.pos.z += Math.sin(angle) * radius;

  p.dir.set(
    -Math.sin(angle) * vel,
    0,
    Math.cos(angle) * vel,
  );
  p.accel.set(system.acceleration[0], system.acceleration[2], system.acceleration[1]);
}

/**
 * Per-frame position update for line round particles.
 * Default physics: pos += dir * dt, dir += accel * dt.
 */
function moveLineRoundParticle(p: Particle, _i: number, dt: number) {
  p.pos.addScaledVector(p.dir, dt);
  p.dir.addScaledVector(p.accel, dt);
}

/** Type 18 — Round/circular line particle emission. */
export function LineRoundSystem({ system, onComplete, loop }: ParticleSystemProps) {
  const particlesRef = useParticleLifecycle({
    system,
    loop,
    onComplete,
    initParticle: initLineRoundParticle,
    moveParticle: moveLineRoundParticle,
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
