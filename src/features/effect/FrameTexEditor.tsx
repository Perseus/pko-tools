import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  effectDataAtom,
  effectDirtyAtom,
  selectedSubEffectIndexAtom,
} from "@/store/effect";
import type { SubEffect } from "@/types/effect";
import { useAtom, useAtomValue } from "jotai";
import { Plus, Trash2 } from "lucide-react";
import React from "react";
import { useMemo } from "react";
import { FieldLabel, SmallLabel } from "@/features/effect/HelpTip";

export default function FrameTexEditor() {
  const [effectData, setEffectData] = useAtom(effectDataAtom);
  const selectedSubEffectIndex = useAtomValue(selectedSubEffectIndexAtom);
  const [, setDirty] = useAtom(effectDirtyAtom);

  const subEffect = useMemo(() => {
    if (!effectData || selectedSubEffectIndex === null) return null;
    return effectData.subEffects[selectedSubEffectIndex] ?? null;
  }, [effectData, selectedSubEffectIndex]);

  if (!subEffect) return null;

  // Show for FRAMETEX type (1) or when frameTexNames has entries
  if (subEffect.effectType !== 1 && subEffect.frameTexNames.length === 0) {
    return null;
  }

  function updateSubEffect(patch: Partial<SubEffect>) {
    if (!effectData || selectedSubEffectIndex === null) return;
    const nextSubEffects = effectData.subEffects.map((entry, i) =>
      i === selectedSubEffectIndex ? { ...entry, ...patch } : entry
    );
    setEffectData({ ...effectData, subEffects: nextSubEffects });
    setDirty(true);
  }

  function updateTexName(index: number, value: string) {
    const next = [...subEffect!.frameTexNames];
    next[index] = value;
    updateSubEffect({ frameTexNames: next, frameTexCount: next.length });
  }

  function addTexName() {
    const next = [...subEffect!.frameTexNames, ""];
    updateSubEffect({ frameTexNames: next, frameTexCount: next.length });
  }

  function removeTexName(index: number) {
    const next = subEffect!.frameTexNames.filter((_, i) => i !== index);
    updateSubEffect({ frameTexNames: next, frameTexCount: next.length });
  }

  return (
    <div className="space-y-2">
      <FieldLabel help="Flipbook-style texture animation. Each frame displays a different texture in sequence. The effect cycles through these textures at the specified frame time.">
        Frame Textures
      </FieldLabel>
      <div className="space-y-1">
        <SmallLabel help="Seconds between texture switches. Lower = faster animation. E.g. 0.1 = 10 fps.">
          Frame Time
        </SmallLabel>
        <Input
          type="number"
          step="0.01"
          min={0}
          value={subEffect.frameTexTime}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (!Number.isNaN(v)) updateSubEffect({ frameTexTime: v });
          }}
          className="h-7 text-xs"
        />
      </div>
      <div className="space-y-1">
        {subEffect.frameTexNames.map((name, i) => (
          <div key={i} className="flex items-center gap-1">
            <span className="w-5 shrink-0 text-center text-[10px] text-muted-foreground">
              {i}
            </span>
            <Input
              value={name}
              onChange={(e) => updateTexName(i, e.target.value)}
              placeholder="e.g. fire01"
              className="h-7 text-xs"
            />
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 shrink-0 p-0"
              onClick={() => removeTexName(i)}
              title="Remove this texture frame"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        ))}
      </div>
      <div className="text-[9px] text-muted-foreground">
        Enter texture filenames without path or extension. Loaded from texture/effect/.
      </div>
      <Button size="sm" variant="outline" className="h-7 w-full text-xs" onClick={addTexName}>
        <Plus className="mr-1 h-3 w-3" />
        Add Texture Frame
      </Button>
    </div>
  );
}
