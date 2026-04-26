import { useCallback, useEffect, useRef } from "react";
import { useAtomValue } from "jotai";
import { EffectFile } from "@/types/effect";
import { effectV2HiddenSubEffectsAtom } from "@/store/effect-v2";
import { SubEffectRenderer } from "./SubEffectRenderer";

interface EffectRendererProps {
  effect: EffectFile;
  onComplete?: () => void;
}

/** Renders all sub-effects within a single .eff file. */
export function EffectRenderer({ effect, onComplete }: EffectRendererProps) {
  // Always point to the latest onComplete without recreating callbacks
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const hiddenSubEffects = useAtomValue(effectV2HiddenSubEffectsAtom);

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

  return (
    <group>
      {effect.subEffects.map((sub, i) => {
        if (hiddenSubEffects.has(i)) return null;
        return (
          <SubEffectRenderer key={i} subEffect={sub} onComplete={() => handleSubComplete(i)} />
        );
      })}
    </group>
  );
}
