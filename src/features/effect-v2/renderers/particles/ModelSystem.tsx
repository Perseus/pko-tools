import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { ParticleSystemProps } from "./types";
import { ParticleVisual } from "./ParticleVisual";
import { useParticleLifecycle } from "./useParticleLifecycle";
import { initModelParticle, moveModelParticle } from "./modelKinematics";

/** Type 5 — 3D model used as particle (e.g., debris chunks). ParticleVisual loads .eff models. */
export function ModelSystem({
  system,
  onComplete,
  loop,
  emitterPositionRef,
  sourceDirectionRef,
}: ParticleSystemProps) {
  const sharedEffectElapsedRef = useRef(0);
  const [, forceRender] = useReducer((n: number) => n + 1, 0);
  const lastAliveCountRef = useRef(0);
  const isNestedEffect = system.modelName.trim().toLowerCase().endsWith(".eff");
  const [nestedEffectComplete, setNestedEffectComplete] = useState(false);
  const singleParticleSystem = useMemo(
    () => ({ ...system, particleCount: 1 }),
    [system],
  );
  const completionSentRef = useRef(false);

  useEffect(() => {
    setNestedEffectComplete(false);
    completionSentRef.current = false;
  }, [system.modelName, loop]);

  const handleNestedEffectComplete = () => {
    if (!isNestedEffect || loop || completionSentRef.current) return;
    completionSentRef.current = true;
    setNestedEffectComplete(true);
    onComplete?.();
  };

  const particlesRef = useParticleLifecycle({
    system: singleParticleSystem,
    loop,
    onComplete,
    emitterPositionRef,
    sharedEffectElapsedRef,
    frameEndBehavior: "reset",
    initParticle: initModelParticle,
    moveParticle: (p, i, dt, sys, pathOffset) =>
      moveModelParticle(p, i, dt, sys, emitterPositionRef?.current, pathOffset),
  });

  useFrame(() => {
    const aliveCount = particlesRef.current.filter((p) => p.alive).length;
    if (aliveCount !== lastAliveCountRef.current || aliveCount > 0) {
      lastAliveCountRef.current = aliveCount;
      forceRender();
    }
  });

  const alive = nestedEffectComplete ? [] : particlesRef.current.filter((p) => p.alive);

  return (
    <group>
      {alive.map((p) => (
        <group key={p.index} position={p.pos} scale={p.size}>
          <ParticleVisual
            system={system}
            particle={p}
            loop={loop}
            sourceDirectionRef={sourceDirectionRef}
            sharedEffectElapsedRef={sharedEffectElapsedRef}
            onNestedEffectComplete={handleNestedEffectComplete}
          />
        </group>
      ))}
    </group>
  );
}
