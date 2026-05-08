import { useEffect, useReducer } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ParticleSystemProps } from "./types";
import { useParticleLifecycle } from "./useParticleLifecycle";
import { getThreeJSBlendFromD3D } from "../../helpers";
import { useEffectTexture } from "../../useEffectTexture";
import { initShadeParticle, moveShadeParticle } from "./shadeKinematics";
import {
  applyTextureSampling,
  composePkoRenderState,
} from "@/features/effect/pkoStateEmulation";

/** Type 13 — Ground-plane decal quad projected in the PKO X/Y plane. */
export function ShadeSystem({ system, onComplete, loop, emitterPositionRef }: ParticleSystemProps) {
  const texture = useEffectTexture(system.textureName);
  const [, forceRender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    applyTextureSampling(texture, composePkoRenderState(3, {
      minFilter: system.minFilter,
      magFilter: system.magFilter,
    }));
  }, [texture, system.minFilter, system.magFilter]);

  const particlesRef = useParticleLifecycle({
    system: { ...system, particleCount: 1, randomMode: 1 },
    loop,
    onComplete,
    emitterPositionRef,
    initParticle: initShadeParticle,
    moveParticle: (p, i, dt, s, pathOffset) =>
      moveShadeParticle(p, i, dt, s, emitterPositionRef?.current, pathOffset),
  });

  useFrame(() => {
    if (particlesRef.current.length > 0) forceRender();
  });

  const alive = particlesRef.current.filter((p) => p.alive);

  return (
    <group>
      {alive.map((p) => (
        <mesh
          key={p.index}
          position={p.pos}
          scale={p.size}
        >
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial
            map={texture}
            transparent
            opacity={p.alpha}
            color={p.color}
            depthWrite={false}
            fog={false}
            toneMapped={false}
            blending={THREE.CustomBlending}
            blendSrc={getThreeJSBlendFromD3D(system.srcBlend)}
            blendDst={getThreeJSBlendFromD3D(system.destBlend)}
          />
        </mesh>
      ))}
    </group>
  );
}
