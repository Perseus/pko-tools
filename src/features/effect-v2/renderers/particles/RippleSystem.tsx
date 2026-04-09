import { ParticleSystemProps } from "./types";
import { ParticleVisual } from "./ParticleVisual";
import { useParticleLifecycle, Particle } from "./useParticleLifecycle";
import { ParSystem } from "@/types/effect-v2";

/**
 * Per-particle spawn for ripple.
 * Matches C++ _CreateRipple:
 * - vel = 0 on all axes. Pure scale animation, no movement.
 * - Position stays at origin (offset handled by parent group).
 */
function initRippleParticle(_p: Particle, _i: number, _system: ParSystem) {
  // No velocity, no acceleration, no position offset — ripple is pure scale/color animation
}

/**
 * Per-frame position update for ripple particles.
 * No-op — ripple only animates size/color/alpha via lifecycle interpolation.
 */
function moveRippleParticle(_p: Particle, _i: number, _dt: number) {
  // No movement
}

/** Type 4 — Ripple/wave effect expanding on a plane. */
export function RippleSystem({ system, onComplete, loop }: ParticleSystemProps) {
  const particlesRef = useParticleLifecycle({
    system,
    loop,
    onComplete,
    initParticle: initRippleParticle,
    moveParticle: moveRippleParticle,
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
