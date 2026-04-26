import * as THREE from "three";
import { ParticleSystemProps } from "./types";
import { useParticleLifecycle, Particle } from "./useParticleLifecycle";
import { randf, getThreeJSBlendFromD3D } from "../../helpers";
import { ParSystem } from "@/types/effect-v2";
import { useEffectTexture } from "../../useEffectTexture";

/**
 * Shade particles are static ground-plane decals (noTranslation type).
 * Spawn at an offset position with zero velocity; no movement.
 * PKO→Three.js coordinate swap: [0]→X, [2]→Y, [1]→Z.
 */
function initShadeParticle(p: Particle, _i: number, system: ParSystem) {
  p.dir.set(0, 0, 0);
  p.accel.set(0, 0, 0);
  p.pos.set(
    randf(system.range[0]),
    randf(system.range[2]),
    randf(system.range[1]),
  );
}

/** No-op — shade particles don't move. */
function moveShadeParticle() {}

/** Type 13 — Ground-plane decal quad projected at y=0. */
export function ShadeSystem({ system, onComplete, loop }: ParticleSystemProps) {
  const texture = useEffectTexture(system.textureName);

  const particlesRef = useParticleLifecycle({
    system,
    loop,
    onComplete,
    initParticle: initShadeParticle,
    moveParticle: moveShadeParticle,
  });

  const alive = particlesRef.current.filter((p) => p.alive);

  return (
    <group>
      {alive.map((p) => (
        <mesh
          key={p.index}
          position={[p.pos.x, 0, p.pos.z]}
          rotation={[-Math.PI / 2, 0, 0]}
          scale={p.size}
        >
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial
            map={texture}
            transparent
            opacity={p.alpha}
            color={p.color}
            depthWrite={false}
            blending={THREE.CustomBlending}
            blendSrc={getThreeJSBlendFromD3D(system.srcBlend)}
            blendDst={getThreeJSBlendFromD3D(system.destBlend)}
          />
        </mesh>
      ))}
    </group>
  );
}
