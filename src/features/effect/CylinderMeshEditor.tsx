import { Input } from "@/components/ui/input";
import { FieldLabel, SmallLabel } from "@/features/effect/HelpTip";
import {
  effectDataAtom,
  effectDirtyAtom,
  selectedFrameIndexAtom,
  selectedSubEffectIndexAtom,
} from "@/store/effect";
import type { CylinderParams, SubEffect } from "@/types/effect";
import { useAtom, useAtomValue } from "jotai";
import React from "react";
import { useMemo } from "react";

export default function CylinderMeshEditor() {
  const [effectData, setEffectData] = useAtom(effectDataAtom);
  const selectedSubEffectIndex = useAtomValue(selectedSubEffectIndexAtom);
  const selectedFrameIndex = useAtomValue(selectedFrameIndexAtom);
  const [, setDirty] = useAtom(effectDirtyAtom);

  const subEffect = useMemo(() => {
    if (!effectData || selectedSubEffectIndex === null) return null;
    return effectData.subEffects[selectedSubEffectIndex] ?? null;
  }, [effectData, selectedSubEffectIndex]);

  if (!subEffect) return null;

  const modelName = subEffect.modelName.trim();
  if (modelName !== "Cylinder" && modelName !== "Cone" && modelName !== "Sphere") {
    return null;
  }

  const hasPerFrame = subEffect.useParam > 0 && subEffect.perFrameCylinder.length > 0;
  const currentParams: CylinderParams = hasPerFrame
    ? subEffect.perFrameCylinder[selectedFrameIndex] ?? {
        segments: subEffect.segments,
        height: subEffect.height,
        topRadius: subEffect.topRadius,
        botRadius: subEffect.botRadius,
      }
    : {
        segments: subEffect.segments,
        height: subEffect.height,
        topRadius: subEffect.topRadius,
        botRadius: subEffect.botRadius,
      };

  function updateSubEffect(patch: Partial<SubEffect>) {
    if (!effectData || selectedSubEffectIndex === null) return;
    const nextSubEffects = effectData.subEffects.map((entry, i) =>
      i === selectedSubEffectIndex ? { ...entry, ...patch } : entry
    );
    setEffectData({ ...effectData, subEffects: nextSubEffects });
    setDirty(true);
  }

  function updateParam(key: keyof CylinderParams, value: string) {
    const parsed = Number(value);
    if (Number.isNaN(parsed)) return;

    if (hasPerFrame) {
      const nextCylinder = [...subEffect!.perFrameCylinder];
      nextCylinder[selectedFrameIndex] = {
        ...(nextCylinder[selectedFrameIndex] ?? currentParams),
        [key]: parsed,
      };
      updateSubEffect({ perFrameCylinder: nextCylinder });
    } else {
      updateSubEffect({ [key]: parsed });
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <FieldLabel help="Geometry parameters for the built-in primitive shape. These control the 3D mesh used for this sub-effect.">
          Mesh Params {hasPerFrame ? `(Frame ${selectedFrameIndex})` : ""}
        </FieldLabel>
        {!hasPerFrame && subEffect!.frameCount > 1 && (
          <button
            className="text-[10px] text-muted-foreground underline hover:text-foreground"
            title="Create separate mesh params for each keyframe, allowing geometry to animate over time"
            onClick={() => {
              const base: CylinderParams = {
                segments: subEffect!.segments || 16,
                height: subEffect!.height || 1,
                topRadius: subEffect!.topRadius || 0.5,
                botRadius: subEffect!.botRadius || 0.5,
              };
              updateSubEffect({
                useParam: 1,
                perFrameCylinder: Array.from({ length: subEffect!.frameCount }, () => ({ ...base })),
              });
            }}
          >
            Per-frame
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <SmallLabel help="Number of sides around the cylinder. 3=triangle, 4=square, 16+=smooth circle. Range: 3-64.">Segments</SmallLabel>
          <Input
            type="number"
            min={3}
            max={64}
            value={currentParams.segments}
            onChange={(e) => updateParam("segments", e.target.value)}
            className="h-7 text-xs"
          />
        </div>
        <div className="space-y-1">
          <SmallLabel help="Vertical extent in world units.">Height</SmallLabel>
          <Input
            type="number"
            step="0.1"
            value={currentParams.height}
            onChange={(e) => updateParam("height", e.target.value)}
            className="h-7 text-xs"
          />
        </div>
        <div className="space-y-1">
          <SmallLabel help="Radius at the top of the shape. Set to 0 to create a cone point.">Top Radius</SmallLabel>
          <Input
            type="number"
            step="0.05"
            min={0}
            value={currentParams.topRadius}
            onChange={(e) => updateParam("topRadius", e.target.value)}
            className="h-7 text-xs"
          />
        </div>
        <div className="space-y-1">
          <SmallLabel help="Radius at the bottom of the shape.">Bot Radius</SmallLabel>
          <Input
            type="number"
            step="0.05"
            min={0}
            value={currentParams.botRadius}
            onChange={(e) => updateParam("botRadius", e.target.value)}
            className="h-7 text-xs"
          />
        </div>
      </div>
    </div>
  );
}
