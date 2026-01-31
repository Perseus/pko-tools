import { Input } from "@/components/ui/input";
import {
  effectDataAtom,
  effectDirtyAtom,
  selectedFrameIndexAtom,
  selectedSubEffectIndexAtom,
} from "@/store/effect";
import { useAtom } from "jotai";
import React from "react";
import { useMemo } from "react";

function formatVector(values: number[], precision = 2) {
  return values.map((value) => value.toFixed(precision)).join(", ");
}

export default function KeyframeProperties() {
  const [effectData, setEffectData] = useAtom(effectDataAtom);
  const [, setDirty] = useAtom(effectDirtyAtom);
  const [selectedSubEffectIndex] = useAtom(selectedSubEffectIndexAtom);
  const [selectedFrameIndex] = useAtom(selectedFrameIndexAtom);

  const frameData = useMemo(() => {
    if (!effectData || selectedSubEffectIndex === null) {
      return null;
    }

    const subEffect = effectData.subEffects[selectedSubEffectIndex];
    if (!subEffect) {
      return null;
    }

    const frameIndex = Math.min(
      Math.max(selectedFrameIndex, 0),
      Math.max(subEffect.frameCount - 1, 0)
    );

    return {
      frameIndex,
      subEffect,
      size: subEffect.frameSizes[frameIndex] ?? [1, 1, 1],
      angle: subEffect.frameAngles[frameIndex] ?? [0, 0, 0],
      position: subEffect.framePositions[frameIndex] ?? [0, 0, 0],
      color: subEffect.frameColors[frameIndex] ?? [1, 1, 1, 1],
    };
  }, [effectData, selectedSubEffectIndex, selectedFrameIndex]);

  function updateFrameVector(
    key: "frameSizes" | "frameAngles" | "framePositions" | "frameColors",
    values: number[]
  ) {
    if (!effectData || selectedSubEffectIndex === null || !frameData) {
      return;
    }

    const nextSubEffects = effectData.subEffects.map((subEffect, index) => {
      if (index !== selectedSubEffectIndex) {
        return subEffect;
      }

      const nextFrames = [...subEffect[key]];
      nextFrames[frameData.frameIndex] = values as typeof nextFrames[number];

      return {
        ...subEffect,
        [key]: nextFrames,
      };
    });

    setEffectData({
      ...effectData,
      subEffects: nextSubEffects,
    });
    setDirty(true);
  }

  function handleVectorChange(
    key: "frameSizes" | "frameAngles" | "framePositions" | "frameColors",
    values: number[],
    index: number,
    nextValue: string
  ) {
    const parsed = Number(nextValue);
    if (Number.isNaN(parsed)) {
      return;
    }

    const nextValues = [...values];
    nextValues[index] = key === "frameColors" ? Math.min(Math.max(parsed, 0), 1) : parsed;
    updateFrameVector(key, nextValues);
  }

  return (
    <div className="flex h-full flex-col gap-4 rounded-xl border border-border bg-background/70 p-4">
      <div>
        <div className="text-sm font-semibold">Keyframe</div>
        <div className="text-xs text-muted-foreground">
          {frameData ? `Frame ${frameData.frameIndex + 1}` : "No keyframe selected"}
        </div>
      </div>
      {frameData ? (
        <div className="space-y-3 text-xs text-muted-foreground">
          <div className="space-y-2">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Position</div>
            <div className="grid grid-cols-3 gap-2">
              {frameData.position.map((value, index) => (
                <Input
                  key={`pos-${index}`}
                  type="number"
                  step="0.01"
                  aria-label={`position-${index}`}
                  value={value}
                  onChange={(event) =>
                    handleVectorChange("framePositions", frameData.position, index, event.target.value)
                  }
                />
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Rotation</div>
            <div className="grid grid-cols-3 gap-2">
              {frameData.angle.map((value, index) => (
                <Input
                  key={`rot-${index}`}
                  type="number"
                  step="0.01"
                  aria-label={`rotation-${index}`}
                  value={value}
                  onChange={(event) =>
                    handleVectorChange("frameAngles", frameData.angle, index, event.target.value)
                  }
                />
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Scale</div>
            <div className="grid grid-cols-3 gap-2">
              {frameData.size.map((value, index) => (
                <Input
                  key={`scale-${index}`}
                  type="number"
                  step="0.01"
                  aria-label={`scale-${index}`}
                  value={value}
                  onChange={(event) =>
                    handleVectorChange("frameSizes", frameData.size, index, event.target.value)
                  }
                />
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Color (RGBA)</div>
            <div className="grid grid-cols-4 gap-2">
              {frameData.color.map((value, index) => (
                <Input
                  key={`color-${index}`}
                  type="number"
                  step="0.01"
                  min={0}
                  max={1}
                  aria-label={`color-${index}`}
                  value={value}
                  onChange={(event) =>
                    handleVectorChange("frameColors", frameData.color, index, event.target.value)
                  }
                />
              ))}
            </div>
            <div className="text-xs text-muted-foreground">
              {formatVector(frameData.color)}
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
          Select a sub-effect to inspect its keyframes.
        </div>
      )}
    </div>
  );
}
