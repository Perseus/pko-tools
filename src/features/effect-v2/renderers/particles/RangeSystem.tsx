import { useEffect, useMemo, useReducer, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { ParticleSystemProps } from "./types";
import { useTimeSource } from "../../TimeContext";
import {
  advanceEffPathRuntimeState,
  computeEffPathRangeDirection,
  createEffPathRuntimeState,
  createRangeParticles,
  updateRangeParticlePositions,
} from "./rangeKinematics";
import {
  getParticleTimelineAdvanceSteps,
  isParticlePlayTimeExpired,
  isParticleRenderVisibleAtTime,
} from "./useParticleLifecycle";
import { ParticleVisual } from "./ParticleVisual";

/** Type 14 — Static range particles. C++ pins size/color to frame 0. */
export function RangeSystem({ system, onComplete, loop, emitterPositionRef }: ParticleSystemProps) {
  const timeSource = useTimeSource();
  const [, forceRender] = useReducer((n: number) => n + 1, 0);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;
  const sharedEffectElapsedRef = useRef(0);
  const pathStateRef = useRef(createEffPathRuntimeState(system.path));
  const lastTimelineTimeRef = useRef(0);
  const pathDeathRef = useRef(0);
  const pathStoppedRef = useRef(false);

  const initialParticles = useMemo(
    () => createRangeParticles(system, Math.random, emitterPositionRef?.current),
    [system],
  );
  const particlesRef = useRef(initialParticles);
  const visibleRef = useRef(isParticleRenderVisibleAtTime(
    timeSource.getTime(),
    system.playTime,
    system.delayTime,
    loop,
  ));
  const completedRef = useRef(false);

  useEffect(() => {
    particlesRef.current = initialParticles;
    pathStateRef.current = createEffPathRuntimeState(system.path);
    lastTimelineTimeRef.current = timeSource.getTime();
    pathDeathRef.current = 0;
    pathStoppedRef.current = false;
  }, [initialParticles, system.path, system.usePath, timeSource]);

  useFrame(() => {
    if (pathStoppedRef.current) return;

    const timeline = getParticleTimelineAdvanceSteps(
      lastTimelineTimeRef.current,
      timeSource.getTime(),
    );
    if (timeline.reset) {
      pathStateRef.current = createEffPathRuntimeState(system.path);
    }
    for (const dt of timeline.steps) {
      advanceEffPathRuntimeState(pathStateRef.current, system.usePath ? system.path : null, dt);
    }
    lastTimelineTimeRef.current = timeline.nextLastTime;

    const hasNestedEffect = system.modelName.trim().toLowerCase().endsWith(".eff");
    if (
      hasNestedEffect
      && system.usePath
      && system.life > 1
      && pathStateRef.current.ended
    ) {
      pathDeathRef.current++;
      if (pathDeathRef.current >= Math.trunc(system.life)) {
        pathStoppedRef.current = true;
        visibleRef.current = false;
        if (!completedRef.current) {
          completedRef.current = true;
          onCompleteRef.current?.();
        }
        forceRender();
        return;
      }
      particlesRef.current = createRangeParticles(system, Math.random, emitterPositionRef?.current);
      pathStateRef.current = createEffPathRuntimeState(system.path);
      forceRender();
      return;
    }

    updateRangeParticlePositions(
      particlesRef.current,
      emitterPositionRef?.current,
      system.usePath ? pathStateRef.current.curPos : null,
      system.usePath ? computeEffPathRangeDirection(pathStateRef.current, system.path) : null,
    );

    const elapsed = timeSource.getTime();
    const visible = isParticleRenderVisibleAtTime(
      elapsed,
      system.playTime,
      system.delayTime,
      loop,
    );
    sharedEffectElapsedRef.current = visible
      ? Math.max(0, elapsed - Math.max(0, system.delayTime))
      : 0;

    if (isParticlePlayTimeExpired(elapsed, system.playTime, system.delayTime, loop) && !completedRef.current) {
      completedRef.current = true;
      onCompleteRef.current?.();
    }

    if (visibleRef.current !== visible || visible) {
      visibleRef.current = visible;
      forceRender();
    }
  });

  if (!visibleRef.current) {
    return <group />;
  }

  return (
    <group>
      {particlesRef.current.map((p) => (
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
