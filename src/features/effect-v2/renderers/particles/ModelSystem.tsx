import { ParticleSystemProps } from "./types";
import { ParticleVisual } from "./ParticleVisual";
import { useParticleLifecycle, Particle } from "./useParticleLifecycle";
import { randf } from "../../helpers";
import { ParSystem } from "@/types/effect-v2";

/**
 * Model particles use the same spherical random velocity as Blast.
 * The modelName field references a .eff (or .lgo) which ParticleVisual handles.
 * PKO→Three.js coordinate swap: [0]→X, [2]→Y, [1]→Z.
 */
function initModelParticle(p: Particle, _i: number, system: ParSystem) {
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
 * Default physics: pos += dir*dt, dir += accel*dt.
 * Same as BlastSystem movement.
 */
function moveModelParticle(p: Particle, _i: number, dt: number) {
  p.pos.addScaledVector(p.dir, dt);
  p.dir.addScaledVector(p.accel, dt);
}

/** Type 5 — 3D model used as particle (e.g., debris chunks). ParticleVisual loads .eff models. */
export function ModelSystem({ system, onComplete, loop }: ParticleSystemProps) {
  const particlesRef = useParticleLifecycle({
    system,
    loop,
    onComplete,
    initParticle: initModelParticle,
    moveParticle: moveModelParticle,
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
