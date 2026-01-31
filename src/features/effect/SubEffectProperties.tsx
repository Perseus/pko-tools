import { Input } from "@/components/ui/input";
import { effectDataAtom, selectedSubEffectIndexAtom } from "@/store/effect";
import { SubEffect } from "@/types/effect";
import { useAtom } from "jotai";
import React from "react";
import { useMemo } from "react";

const EFFECT_TYPE_LABELS: Record<number, string> = {
  0: "None",
  1: "Frame Texture",
  2: "Model UV",
  3: "Model Texture",
  4: "Model",
};

export default function SubEffectProperties() {
  const [effectData, setEffectData] = useAtom(effectDataAtom);
  const [selectedSubEffectIndex] = useAtom(selectedSubEffectIndexAtom);

  const subEffect = useMemo(() => {
    if (!effectData || selectedSubEffectIndex === null) {
      return null;
    }
    return effectData.subEffects[selectedSubEffectIndex] ?? null;
  }, [effectData, selectedSubEffectIndex]);

  function updateSubEffect(patch: Partial<SubEffect>) {
    if (!effectData || selectedSubEffectIndex === null || !subEffect) {
      return;
    }

    const nextSubEffects = effectData.subEffects.map((entry, index) => {
      if (index !== selectedSubEffectIndex) {
        return entry;
      }
      return { ...entry, ...patch };
    });

    setEffectData({
      ...effectData,
      subEffects: nextSubEffects,
    });
  }

  function handleNumberChange(key: keyof SubEffect, value: string) {
    const parsed = Number(value);
    if (Number.isNaN(parsed)) {
      return;
    }
    updateSubEffect({ [key]: parsed } as Partial<SubEffect>);
  }

  if (!subEffect) {
    return (
      <div className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
        Select a sub-effect to edit its settings.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border bg-background/70 p-4">
      <div>
        <div className="text-sm font-semibold">Sub-Effect</div>
        <div className="text-xs text-muted-foreground">
          {EFFECT_TYPE_LABELS[subEffect.effectType] ?? "Unknown"}
        </div>
      </div>
      <div className="space-y-3 text-xs">
        <div className="space-y-1">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Name</div>
          <Input
            aria-label="subeffect-name"
            value={subEffect.effectName}
            onChange={(event) => updateSubEffect({ effectName: event.target.value })}
          />
        </div>
        <div className="space-y-1">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Effect Type</div>
          <Input
            aria-label="subeffect-type"
            type="number"
            value={subEffect.effectType}
            onChange={(event) => handleNumberChange("effectType", event.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Src Blend</div>
            <Input
              aria-label="subeffect-src-blend"
              type="number"
              value={subEffect.srcBlend}
              onChange={(event) => handleNumberChange("srcBlend", event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Dest Blend</div>
            <Input
              aria-label="subeffect-dest-blend"
              type="number"
              value={subEffect.destBlend}
              onChange={(event) => handleNumberChange("destBlend", event.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Duration</div>
          <Input
            aria-label="subeffect-length"
            type="number"
            step="0.01"
            value={subEffect.length}
            onChange={(event) => handleNumberChange("length", event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Texture Name</div>
          <Input
            aria-label="subeffect-texture"
            value={subEffect.texName}
            onChange={(event) => updateSubEffect({ texName: event.target.value })}
          />
        </div>
        <div className="space-y-1">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Model Name</div>
          <Input
            aria-label="subeffect-model"
            value={subEffect.modelName}
            onChange={(event) => updateSubEffect({ modelName: event.target.value })}
          />
        </div>
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          <label className="flex items-center gap-2">
            <input
              aria-label="subeffect-billboard"
              type="checkbox"
              checked={subEffect.billboard}
              onChange={(event) => updateSubEffect({ billboard: event.target.checked })}
            />
            Billboard
          </label>
          <label className="flex items-center gap-2">
            <input
              aria-label="subeffect-alpha"
              type="checkbox"
              checked={subEffect.alpha}
              onChange={(event) => updateSubEffect({ alpha: event.target.checked })}
            />
            Alpha
          </label>
          <label className="flex items-center gap-2">
            <input
              aria-label="subeffect-rotaboard"
              type="checkbox"
              checked={subEffect.rotaBoard}
              onChange={(event) => updateSubEffect({ rotaBoard: event.target.checked })}
            />
            RotaBoard
          </label>
        </div>
      </div>
    </div>
  );
}
