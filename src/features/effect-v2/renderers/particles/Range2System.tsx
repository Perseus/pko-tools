import * as THREE from "three";
import { ParticleSystemProps } from "./types";
import { useParticleLifecycle, Particle } from "./useParticleLifecycle";
import { randf, getThreeJSBlendFromD3D } from "../../helpers";
import { ParSystem } from "@/types/effect-v2";

/**
 * Range2 is identical to Range — both use spawnRipple + stepRipple in the V1 code.
 * Static expanding ring at ground level (noTranslation type).
 * PKO→Three.js coordinate swap: [0]→X, [2]→Y, [1]→Z.
 */
function initRange2Particle(p: Particle, _i: number, system: ParSystem) {
  p.dir.set(0, 0, 0);
  p.accel.set(0, 0, 0);
  p.pos.set(
    randf(system.range[0]),
    randf(system.range[2]),
    randf(system.range[1]),
  );
}

/** No-op — range2 particles don't move. */
function moveRange2Particle() {}

/** Type 15 — Ring variant, identical to RangeSystem. */
export function Range2System({ system, onComplete, loop }: ParticleSystemProps) {
  const particlesRef = useParticleLifecycle({
    system,
    loop,
    onComplete,
    initParticle: initRange2Particle,
    moveParticle: moveRange2Particle,
  });

  const alive = particlesRef.current.filter((p) => p.alive);

  return (
    <group>
      {alive.map((p) => (
        <mesh
          key={p.index}
          position={[p.pos.x, 0, p.pos.z]}
          rotation={[-Math.PI / 2, 0, 0]}
        >
          <ringGeometry args={[p.size * 0.8, p.size, 32]} />
          <meshBasicMaterial
            transparent
            opacity={p.alpha}
            color={p.color}
            depthWrite={false}
            side={THREE.DoubleSide}
            blending={THREE.CustomBlending}
            blendSrc={getThreeJSBlendFromD3D(system.srcBlend)}
            blendDst={getThreeJSBlendFromD3D(system.destBlend)}
          />
        </mesh>
      ))}
    </group>
  );
}
