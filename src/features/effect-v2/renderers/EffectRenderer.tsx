import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useAtomValue } from "jotai";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { EffectFile, Vec3 } from "@/types/effect";
import { effectV2HiddenSubEffectsAtom } from "@/store/effect-v2";
import { currentProjectAtom } from "@/store/project";
import { loadPathFile } from "@/commands/effect";
import { getPathPosition } from "@/features/effect/animation";
import { SubEffectRenderer } from "./SubEffectRenderer";
import { useTimeSource } from "../TimeContext";
import { computeEffectGroupRotation } from "./effectGroupKinematics";

/**
 * When non-null, overrides the global effectV2HiddenSubEffectsAtom.
 * Used by ParticleEffectRenderer to provide per-particle-system sub-effect visibility.
 */
export const EffectSubEffectVisibilityContext = createContext<Set<number> | null>(null);

const DEFAULT_EFFECT_PATH_VELOCITY = 1.0;

interface EffectRendererProps {
  effect: EffectFile;
  onComplete?: () => void;
}

/** Renders all sub-effects within a single .eff file. */
export function EffectRenderer({ effect, onComplete }: EffectRendererProps) {
  const groupRef = useRef<THREE.Group>(null);
  const timeSource = useTimeSource();
  const currentProject = useAtomValue(currentProjectAtom);
  const [pathPoints, setPathPoints] = useState<Vec3[] | null>(null);
  // Always point to the latest onComplete without recreating callbacks
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const globalHidden = useAtomValue(effectV2HiddenSubEffectsAtom);
  const scopedHidden = useContext(EffectSubEffectVisibilityContext);
  const hiddenSubEffects = scopedHidden ?? globalHidden;

  // Tracks which sub-effect indices have fired onComplete
  const completedRef = useRef(new Set<number>());

  // Reset completion state when the effect changes
  useEffect(() => {
    completedRef.current = new Set();
  }, [effect]);

  // Stable callback — reads from refs so it never goes stale
  const handleSubComplete = useCallback((idx: number) => {
    completedRef.current.add(idx);
    if (completedRef.current.size >= effect.subEffects.length) {
      onCompleteRef.current?.();
    }
  }, [effect.subEffects.length]);

  // Edge case: no sub-effects at all
  useEffect(() => {
    if (effect.subEffects.length === 0) {
      onCompleteRef.current?.();
    }
  }, [effect.subEffects.length]);

  useEffect(() => {
    if (!effect.usePath || !effect.pathName.trim() || !currentProject) {
      setPathPoints(null);
      return;
    }

    let cancelled = false;
    loadPathFile(currentProject.id, effect.pathName)
      .then((points) => {
        if (cancelled) return;
        setPathPoints(points.map(([x, y, z]) => [x, y, z]));
      })
      .catch(() => {
        if (!cancelled) setPathPoints(null);
      });

    return () => {
      cancelled = true;
    };
  }, [currentProject, effect.pathName, effect.usePath]);

  useFrame(() => {
    if (!groupRef.current) return;
    groupRef.current.quaternion.copy(
      computeEffectGroupRotation(effect, timeSource.getTime()),
    );
    if (effect.usePath && pathPoints && pathPoints.length >= 2) {
      const pos = getPathPosition(
        pathPoints,
        timeSource.getTime(),
        DEFAULT_EFFECT_PATH_VELOCITY,
        timeSource.loop,
      );
      groupRef.current.position.set(pos[0], pos[1], pos[2]);
    } else {
      groupRef.current.position.set(0, 0, 0);
    }
  });

  return (
    <group ref={groupRef}>
      {effect.subEffects.map((sub, i) => {
        if (hiddenSubEffects.has(i)) return null;
        return (
          <SubEffectRenderer
            key={i}
            subEffect={sub}
            idxTech={effect.idxTech}
            onComplete={() => handleSubComplete(i)}
          />
        );
      })}
    </group>
  );
}
