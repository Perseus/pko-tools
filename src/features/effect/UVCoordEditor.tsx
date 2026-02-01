import { Input } from "@/components/ui/input";
import {
  effectDataAtom,
  effectDirtyAtom,
  selectedSubEffectIndexAtom,
} from "@/store/effect";
import type { SubEffect, Vec2 } from "@/types/effect";
import { useAtom, useAtomValue } from "jotai";
import React from "react";
import { useMemo, useState } from "react";
import { FieldLabel, SmallLabel } from "@/features/effect/HelpTip";

export default function UVCoordEditor() {
  const [effectData, setEffectData] = useAtom(effectDataAtom);
  const selectedSubEffectIndex = useAtomValue(selectedSubEffectIndexAtom);
  const [, setDirty] = useAtom(effectDirtyAtom);
  const [selectedCoordFrame, setSelectedCoordFrame] = useState(0);

  const subEffect = useMemo(() => {
    if (!effectData || selectedSubEffectIndex === null) return null;
    return effectData.subEffects[selectedSubEffectIndex] ?? null;
  }, [effectData, selectedSubEffectIndex]);

  if (!subEffect) return null;

  // Show for MODELUV type (2) or when coordList has entries
  if (subEffect.effectType !== 2 && subEffect.coordList.length === 0) {
    return null;
  }

  const coordFrameCount = subEffect.coordList.length;
  const verCount = subEffect.verCount;
  const clampedFrame = Math.min(selectedCoordFrame, Math.max(coordFrameCount - 1, 0));
  const currentCoords: Vec2[] = subEffect.coordList[clampedFrame] ?? [];

  function updateSubEffect(patch: Partial<SubEffect>) {
    if (!effectData || selectedSubEffectIndex === null) return;
    const nextSubEffects = effectData.subEffects.map((entry, i) =>
      i === selectedSubEffectIndex ? { ...entry, ...patch } : entry
    );
    setEffectData({ ...effectData, subEffects: nextSubEffects });
    setDirty(true);
  }

  function updateCoordValue(vertIndex: number, component: 0 | 1, value: string) {
    const parsed = Number(value);
    if (Number.isNaN(parsed)) return;

    const nextCoordList = subEffect!.coordList.map((frame, fi) => {
      if (fi !== clampedFrame) return frame;
      return frame.map((uv, vi) => {
        if (vi !== vertIndex) return uv;
        const next: Vec2 = [...uv];
        next[component] = parsed;
        return next;
      });
    });

    updateSubEffect({ coordList: nextCoordList });
  }

  return (
    <div className="space-y-2">
      <FieldLabel help="Animated texture coordinates. Each vertex has a U (horizontal) and V (vertical) value that controls which part of the texture is shown. Multiple coord frames create UV animation.">
        UV Coordinates
      </FieldLabel>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <SmallLabel>Vertices</SmallLabel>
          <div className="h-7 rounded border border-border bg-muted/40 px-2 py-1 text-xs">
            {verCount}
          </div>
        </div>
        <div className="space-y-1">
          <SmallLabel>Coord Frames</SmallLabel>
          <div className="h-7 rounded border border-border bg-muted/40 px-2 py-1 text-xs">
            {coordFrameCount}
          </div>
        </div>
      </div>
      <div className="space-y-1">
        <SmallLabel help="Seconds between UV frame switches. Controls the speed of the UV animation.">
          Frame Time
        </SmallLabel>
        <Input
          type="number"
          step="0.01"
          min={0}
          value={subEffect.coordFrameTime}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (!Number.isNaN(v)) updateSubEffect({ coordFrameTime: v });
          }}
          className="h-7 text-xs"
        />
      </div>
      {coordFrameCount > 1 && (
        <div className="space-y-1">
          <SmallLabel>Coord Frame</SmallLabel>
          <input
            type="range"
            min={0}
            max={coordFrameCount - 1}
            value={clampedFrame}
            onChange={(e) => setSelectedCoordFrame(Number(e.target.value))}
            className="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-foreground"
          />
          <div className="text-[10px] text-muted-foreground">
            {clampedFrame} / {coordFrameCount - 1}
          </div>
        </div>
      )}
      {currentCoords.length > 0 && (
        <>
          <div className="flex gap-1 text-[9px] text-muted-foreground">
            <span className="w-4" />
            <span className="flex-1 text-center">U</span>
            <span className="flex-1 text-center">V</span>
          </div>
          <div className="max-h-40 space-y-1 overflow-y-auto">
            {currentCoords.map((uv, vi) => (
              <div key={vi} className="flex items-center gap-1">
                <span className="w-4 shrink-0 text-center text-[9px] text-muted-foreground">
                  {vi}
                </span>
                <Input
                  type="number"
                  step="0.01"
                  value={uv[0]}
                  onChange={(e) => updateCoordValue(vi, 0, e.target.value)}
                  className="h-6 text-[10px]"
                  title="U coordinate (horizontal 0-1)"
                />
                <Input
                  type="number"
                  step="0.01"
                  value={uv[1]}
                  onChange={(e) => updateCoordValue(vi, 1, e.target.value)}
                  className="h-6 text-[10px]"
                  title="V coordinate (vertical 0-1)"
                />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
