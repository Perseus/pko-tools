import { ParticleSystemProps } from "./types";
import { ParticleVisual } from "./ParticleVisual";
import { useParticleLifecycle, Particle } from "./useParticleLifecycle";
import { ParSystem } from "@/types/effect-v2";

/**
 * Per-particle spawn for arrow.
 * Matches C++ _CreateArrow:
 * - vel = 0 on all axes. Static at offset position.
 * - Only frame-based animation (size/color/angle interpolation via lifecycle).
 */
function initArrowParticle(_p: Particle, _i: number, _system: ParSystem) {
  // No velocity, no acceleration — arrow is static, only animated via keyframes
}

/**
 * Per-frame position update for arrow particles.
 * No-op — arrow is static, only frame-based animation.
 */
function moveArrowParticle(_p: Particle, _i: number, _dt: number) {
  // No movement
}

/** Type 8 — Arrow/projectile particles. */
export function ArrowSystem({ system, onComplete, loop }: ParticleSystemProps) {
  const particlesRef = useParticleLifecycle({
    system,
    loop,
    onComplete,
    initParticle: initArrowParticle,
    moveParticle: moveArrowParticle,
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
