import { useEffect, useReducer, useRef } from "react";
import type { MutableRefObject } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { ParticleSystemProps } from "./types";
import { ParticleVisual } from "./ParticleVisual";
import { useTimeSource } from "../../TimeContext";
import { getParticleTimelineAdvanceSteps, Particle, useParticleLifecycle } from "./useParticleLifecycle";
import {
  computeFireModelDirMovementDirection,
  initFireParticle,
  moveFireParticle,
} from "./fireKinematics";
import {
  advanceEffPathRuntimeState,
  createEffPathRuntimeState,
} from "./rangeKinematics";

/** Type 2 — Fire particles rising upward. */
export function FireSystem({
  system,
  onComplete,
  loop,
  emitterPositionRef,
  sourceDirectionRef,
  onHitEffect,
}: ParticleSystemProps) {
  const timeSource = useTimeSource();
  const sharedEffectElapsedRef = useRef(0);
  const hitPathStateRef = useRef(createEffPathRuntimeState(system.path));
  const hitLastTimelineTimeRef = useRef(0);
  const hitSentRef = useRef(false);
  const [, forceRender] = useReducer((n: number) => n + 1, 0);
  const lastAliveSignatureRef = useRef("");

  useEffect(() => {
    hitPathStateRef.current = createEffPathRuntimeState(system.path);
    hitLastTimelineTimeRef.current = timeSource.getTime();
    hitSentRef.current = false;
  }, [system.hitEffect, system.path, system.usePath, timeSource]);

  useFrame(() => {
    const hitEffectName = system.hitEffect.trim();
    if (!hitEffectName || !system.usePath || !system.path || hitSentRef.current) return;

    const timeline = getParticleTimelineAdvanceSteps(
      hitLastTimelineTimeRef.current,
      timeSource.getTime(),
    );

    if (timeline.reset) {
      hitPathStateRef.current = createEffPathRuntimeState(system.path);
      hitSentRef.current = false;
    }

    for (const dt of timeline.steps) {
      advanceEffPathRuntimeState(hitPathStateRef.current, system.path, dt);
      const curPos = hitPathStateRef.current.curPos;
      if (hitPathStateRef.current.ended || curPos.z <= 0.1 || curPos.z > 50) {
        hitSentRef.current = true;
        onHitEffect?.(
          hitEffectName,
          getEffPathEndPosition(system.path) ?? curPos,
          sourceDirectionRef?.current ?? undefined,
        );
        break;
      }
    }

    hitLastTimelineTimeRef.current = timeline.nextLastTime;
  });

  const particlesRef = useParticleLifecycle({
    system,
    loop,
    onComplete,
    emitterPositionRef,
    sharedEffectElapsedRef,
    spawnOnCreate: false,
    respawnDeadParticles: true,
    finitePlayTimeStopBehavior: "drain",
    initParticle: (p, i, sys) => {
      initFireParticle(p, i, sys);
      if (sys.modelDir && sourceDirectionRef?.current && sourceDirectionRef.current.lengthSq() > 0.000001) {
        p.dir.copy(computeFireModelDirMovementDirection(sourceDirectionRef.current));
      }
    },
    moveParticle: moveFireParticle,
  });

  useFrame(() => {
    const aliveSignature = particlesRef.current
      .filter((p) => p.alive)
      .map((p) => p.index)
      .join(",");
    if (aliveSignature !== lastAliveSignatureRef.current) {
      lastAliveSignatureRef.current = aliveSignature;
      forceRender();
    }
  });

  const alive = particlesRef.current.filter((p) => p.alive);

  return (
    <group>
      {alive.map((p) => (
        <FireParticleInstance
          key={p.index}
          particle={p}
          system={system}
          loop={loop}
          sourceDirectionRef={sourceDirectionRef}
          sharedEffectElapsedRef={sharedEffectElapsedRef}
        />
      ))}
    </group>
  );
}

function FireParticleInstance({
  particle,
  system,
  loop,
  sourceDirectionRef,
  sharedEffectElapsedRef,
}: {
  particle: Particle;
  system: ParticleSystemProps["system"];
  loop?: boolean;
  sourceDirectionRef?: ParticleSystemProps["sourceDirectionRef"];
  sharedEffectElapsedRef: MutableRefObject<number>;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const particleRef = useRef(particle);
  particleRef.current = particle;

  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;
    const current = particleRef.current;
    group.position.copy(current.pos);
    group.scale.setScalar(current.size);
  });

  return (
    <group ref={groupRef} position={particle.pos.clone()} scale={particle.size}>
      <ParticleVisual
        system={system}
        particle={particle}
        loop={loop}
        sourceDirectionRef={sourceDirectionRef}
        sharedEffectElapsedRef={sharedEffectElapsedRef}
      />
    </group>
  );
}

function getEffPathEndPosition(path: NonNullable<ParticleSystemProps["system"]["path"]>): THREE.Vector3 | null {
  const end = path.points[path.points.length - 1];
  return end ? new THREE.Vector3(end[0], end[1], end[2]) : null;
}
