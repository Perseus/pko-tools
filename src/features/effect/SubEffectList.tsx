import { Button } from "@/components/ui/button";
import {
  effectDataAtom,
  effectDirtyAtom,
  selectedFrameIndexAtom,
  selectedSubEffectIndexAtom,
} from "@/store/effect";
import { useAtom } from "jotai";
import { ChevronDown, ChevronUp, Copy, Trash2 } from "lucide-react";
import React from "react";
import { useEffectHistory } from "@/features/effect/useEffectHistory";

const EFFECT_TYPE_LABELS: Record<number, string> = {
  0: "None",
  1: "FrameTex",
  2: "ModelUV",
  3: "ModelTex",
  4: "Model",
};

export default function SubEffectList() {
  const [effectData, setEffectData] = useAtom(effectDataAtom);
  const [selectedIndex, setSelectedIndex] = useAtom(selectedSubEffectIndexAtom);
  const [, setSelectedFrame] = useAtom(selectedFrameIndexAtom);
  const [, setDirty] = useAtom(effectDirtyAtom);
  const { pushSnapshot } = useEffectHistory();

  function duplicateSubEffect(index: number) {
    if (!effectData) return;
    pushSnapshot();
    const clone = structuredClone(effectData.subEffects[index]);
    clone.effectName = clone.effectName ? `${clone.effectName} copy` : "copy";
    const next = [...effectData.subEffects];
    next.splice(index + 1, 0, clone);
    setEffectData({ ...effectData, subEffects: next, effNum: next.length });
    setSelectedIndex(index + 1);
    setSelectedFrame(0);
    setDirty(true);
  }

  function deleteSubEffect(index: number) {
    if (!effectData) return;
    pushSnapshot();
    const next = effectData.subEffects.filter((_, i) => i !== index);
    setEffectData({ ...effectData, subEffects: next, effNum: next.length });
    if (selectedIndex === index) {
      setSelectedIndex(next.length > 0 ? Math.min(index, next.length - 1) : null);
    } else if (selectedIndex !== null && selectedIndex > index) {
      setSelectedIndex(selectedIndex - 1);
    }
    setSelectedFrame(0);
    setDirty(true);
  }

  function moveSubEffect(index: number, direction: -1 | 1) {
    if (!effectData) return;
    const target = index + direction;
    if (target < 0 || target >= effectData.subEffects.length) return;
    pushSnapshot();
    const next = [...effectData.subEffects];
    [next[index], next[target]] = [next[target], next[index]];
    setEffectData({ ...effectData, subEffects: next });
    setSelectedIndex(target);
    setDirty(true);
  }

  return (
    <div className="flex h-full flex-col gap-3 rounded-xl border border-border bg-background/70 p-4">
      <div>
        <div className="text-sm font-semibold text-foreground">Sub-Effects</div>
        <div className="text-xs text-muted-foreground">
          {effectData ? `${effectData.subEffects.length} layers` : "No effect loaded"}
        </div>
      </div>
      <div className="flex-1 space-y-2 overflow-auto">
        {effectData?.subEffects.map((subEffect, index) => {
          const label = EFFECT_TYPE_LABELS[subEffect.effectType] ?? "Unknown";
          const isActive = selectedIndex === index;
          return (
            <div
              key={`${subEffect.effectName}-${index}`}
              className="flex items-center gap-1"
            >
              <Button
                variant={isActive ? "default" : "outline"}
                className="h-auto flex-1 flex-row items-center gap-2 px-2 py-1.5"
                onClick={() => {
                  setSelectedIndex(index);
                  setSelectedFrame(0);
                }}
              >
                <span className="text-xs font-medium truncate">
                  {subEffect.effectName || `Effect ${index + 1}`}
                </span>
                <span className="text-[10px] text-muted-foreground">{label}</span>
              </Button>
              <div className="flex shrink-0 gap-0.5">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  title="Duplicate"
                  aria-label={`duplicate-${index}`}
                  onClick={() => duplicateSubEffect(index)}
                >
                  <Copy className="h-3 w-3" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  title="Delete"
                  aria-label={`delete-${index}`}
                  onClick={() => deleteSubEffect(index)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  title="Move up"
                  aria-label={`move-up-${index}`}
                  disabled={index === 0}
                  onClick={() => moveSubEffect(index, -1)}
                >
                  <ChevronUp className="h-3 w-3" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  title="Move down"
                  aria-label={`move-down-${index}`}
                  disabled={index === (effectData?.subEffects.length ?? 0) - 1}
                  onClick={() => moveSubEffect(index, 1)}
                >
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </div>
            </div>
          );
        })}
        {!effectData && (
          <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
            <div>No effect loaded</div>
            <div className="mt-1 text-[10px]">
              Select a .eff file from the navigator to begin editing.
              Each layer is a visual component of the effect.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
