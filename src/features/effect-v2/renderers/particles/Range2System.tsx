import { useReducer, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { ParticleSystemProps } from "./types";
import { useTimeSource } from "../../TimeContext";
import {
  createRange2Particles,
  createRange2RuntimeState,
  stepRange2Particles,
} from "./rangeKinematics";
import {
  getParticleTimelineAdvanceSteps,
  isParticlePlayTimeExpired,
  isParticleRenderVisibleAtTime,
} from "./useParticleLifecycle";
import { ParticleVisual } from "./ParticleVisual";

/** Type 15 — Range2 projectile emitter. */
export function Range2System({ system, onComplete, loop, emitterPositionRef, onHitEffect }: ParticleSystemProps) {
  const timeSource = useTimeSource();
  const [, forceRender] = useReducer((n: number) => n + 1, 0);
  const particlesRef = useRef(createRange2Particles(system));
  const runtimeRef = useRef(createRange2RuntimeState());
  const systemElapsedRef = useRef(0);
  const sharedEffectElapsedRef = useRef(0);
  const lastTimelineTimeRef = useRef(0);
  const completedCallbackRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  if (particlesRef.current.length !== system.particleCount) {
    particlesRef.current = createRange2Particles(system);
    runtimeRef.current = createRange2RuntimeState();
    systemElapsedRef.current = 0;
    sharedEffectElapsedRef.current = 0;
    lastTimelineTimeRef.current = 0;
    completedCallbackRef.current = false;
  }

  const resetRange2State = () => {
    particlesRef.current = createRange2Particles(system);
    runtimeRef.current = createRange2RuntimeState();
    systemElapsedRef.current = 0;
    sharedEffectElapsedRef.current = 0;
    completedCallbackRef.current = false;
  };

  useFrame(() => {
    const timeline = getParticleTimelineAdvanceSteps(
      lastTimelineTimeRef.current,
      timeSource.getTime(),
    );

    if (timeline.reset) {
      resetRange2State();
    }

    if (runtimeRef.current.completed) {
      lastTimelineTimeRef.current = timeline.nextLastTime;
      return;
    }

    let shouldRender = false;

    for (const dt of timeline.steps) {
      const previousElapsed = systemElapsedRef.current;
      const nextElapsed = previousElapsed + dt;
      systemElapsedRef.current = nextElapsed;

      if (isParticlePlayTimeExpired(nextElapsed, system.playTime, system.delayTime, loop)) {
        particlesRef.current.forEach((p) => { p.alive = false; });
        runtimeRef.current.completed = true;
        shouldRender = true;
        break;
      }

      const activeDt = previousElapsed < system.delayTime
        ? Math.max(0, nextElapsed - system.delayTime)
        : dt;
      if (activeDt <= 0) continue;
      sharedEffectElapsedRef.current += activeDt;

      const beforeAlive = particlesRef.current.filter((p) => p.alive).length;
      stepRange2Particles(
        particlesRef.current,
        runtimeRef.current,
        system,
        activeDt,
        Math.random,
        emitterPositionRef?.current,
        onHitEffect,
      );

      const afterAlive = particlesRef.current.filter((p) => p.alive).length;
      shouldRender = shouldRender || afterAlive > 0 || beforeAlive !== afterAlive;
      if (runtimeRef.current.completed) break;
    }

    if (shouldRender) {
      forceRender();
    }

    if (runtimeRef.current.completed && !completedCallbackRef.current) {
      completedCallbackRef.current = true;
      onCompleteRef.current?.();
    }

    lastTimelineTimeRef.current = timeline.nextLastTime;
  });

  const visible = isParticleRenderVisibleAtTime(
    systemElapsedRef.current,
    system.playTime,
    system.delayTime,
    loop,
  );
  const alive = visible ? particlesRef.current.filter((p) => p.alive) : [];

  return (
    <group>
      {alive.map((p) => (
        <group key={p.index} position={p.pos} scale={p.size}>
          <ParticleVisual
            system={system}
            particle={p}
            loop={loop}
            sharedEffectElapsedRef={sharedEffectElapsedRef}
          />
        </group>
      ))}
    </group>
  );
}
