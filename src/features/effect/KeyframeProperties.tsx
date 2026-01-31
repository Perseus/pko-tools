import { effectDataAtom, selectedFrameIndexAtom, selectedSubEffectIndexAtom } from "@/store/effect";
import { useAtomValue } from "jotai";
import { useMemo } from "react";

function formatVector(values: number[], precision = 2) {
  return values.map((value) => value.toFixed(precision)).join(", ");
}

export default function KeyframeProperties() {
  const effectData = useAtomValue(effectDataAtom);
  const selectedSubEffectIndex = useAtomValue(selectedSubEffectIndexAtom);
  const selectedFrameIndex = useAtomValue(selectedFrameIndexAtom);

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
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Position</div>
            <div className="text-sm text-foreground">{formatVector(frameData.position)}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Rotation</div>
            <div className="text-sm text-foreground">{formatVector(frameData.angle)}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Scale</div>
            <div className="text-sm text-foreground">{formatVector(frameData.size)}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Color</div>
            <div className="text-sm text-foreground">{formatVector(frameData.color)}</div>
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
