import { Button } from "@/components/ui/button";
import {
  effectDataAtom,
  selectedFrameIndexAtom,
  selectedSubEffectIndexAtom,
} from "@/store/effect";
import { useAtom, useAtomValue } from "jotai";

const EFFECT_TYPE_LABELS: Record<number, string> = {
  0: "None",
  1: "FrameTex",
  2: "ModelUV",
  3: "ModelTex",
  4: "Model",
};

export default function SubEffectList() {
  const effectData = useAtomValue(effectDataAtom);
  const [selectedIndex, setSelectedIndex] = useAtom(selectedSubEffectIndexAtom);
  const [, setSelectedFrame] = useAtom(selectedFrameIndexAtom);

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
            <Button
              key={`${subEffect.effectName}-${index}`}
              variant={isActive ? "default" : "outline"}
              className="h-auto w-full flex-col items-start gap-1 px-3 py-2"
              onClick={() => {
                setSelectedIndex(index);
                setSelectedFrame(0);
              }}
            >
              <span className="text-sm font-semibold">
                {subEffect.effectName || `Effect ${index + 1}`}
              </span>
              <span className="text-xs text-muted-foreground">{label}</span>
            </Button>
          );
        })}
        {!effectData && (
          <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
            Import a .eff file to list its sub-effects.
          </div>
        )}
      </div>
    </div>
  );
}
