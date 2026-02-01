import { Input } from "@/components/ui/input";
import { effectDataAtom, effectDirtyAtom, selectedSubEffectIndexAtom } from "@/store/effect";
import { SubEffect } from "@/types/effect";
import { useAtom } from "jotai";
import React from "react";
import { useMemo } from "react";
import BlendModeEditor from "@/features/effect/BlendModeEditor";
import CylinderMeshEditor from "@/features/effect/CylinderMeshEditor";
import FrameTexEditor from "@/features/effect/FrameTexEditor";
import UVCoordEditor from "@/features/effect/UVCoordEditor";
import { CheckboxWithHelp, FieldLabel } from "@/features/effect/HelpTip";

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
  const [, setDirty] = useAtom(effectDirtyAtom);

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
    setDirty(true);
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
        <div className="text-[9px] text-muted-foreground">Properties for the selected sub-effect layer.</div>
      </div>
      <div className="space-y-3 text-xs">
        <div className="space-y-1">
          <FieldLabel help="Internal name for this sub-effect layer. Used for identification in the sub-effect list.">Name</FieldLabel>
          <Input
            aria-label="subeffect-name"
            value={subEffect.effectName}
            onChange={(event) => updateSubEffect({ effectName: event.target.value })}
          />
        </div>
        <div className="space-y-1">
          <FieldLabel help="Determines how this sub-effect renders. Each type enables different editing options below.">Effect Type</FieldLabel>
          <select
            aria-label="subeffect-type"
            value={subEffect.effectType}
            onChange={(event) => handleNumberChange("effectType", event.target.value)}
            className="h-7 w-full rounded border border-input bg-background px-2 text-xs"
          >
            <option value={0}>0 - None</option>
            <option value={1}>1 - Frame Texture (flipbook animation)</option>
            <option value={2}>2 - Model UV (animated UV coordinates)</option>
            <option value={3}>3 - Model Texture (3D model with texture)</option>
            <option value={4}>4 - Model (3D model only)</option>
          </select>
        </div>
        <BlendModeEditor
          srcBlend={subEffect.srcBlend}
          destBlend={subEffect.destBlend}
          onChange={(src, dest) => updateSubEffect({ srcBlend: src, destBlend: dest })}
        />
        <div className="space-y-1">
          <FieldLabel help="Total playback length of this sub-effect in seconds. All keyframes play within this duration.">Duration</FieldLabel>
          <Input
            aria-label="subeffect-length"
            type="number"
            step="0.01"
            value={subEffect.length}
            onChange={(event) => handleNumberChange("length", event.target.value)}
          />
        </div>
        <div className="space-y-1">
          <FieldLabel help="Texture filename without path. Loaded from texture/effect/ directory. Example: jb06y, fire01. Extension (.tga/.dds) is auto-detected.">Texture Name</FieldLabel>
          <Input
            aria-label="subeffect-texture"
            value={subEffect.texName}
            placeholder="e.g. jb06y"
            onChange={(event) => updateSubEffect({ texName: event.target.value })}
          />
        </div>
        <div className="space-y-1">
          <FieldLabel help="Use 'Cylinder', 'Cone', or 'Sphere' for built-in primitives (shows mesh params below). Or enter a .lgo model filename.">Model Name</FieldLabel>
          <Input
            aria-label="subeffect-model"
            value={subEffect.modelName}
            placeholder="Cylinder, Cone, Sphere, or filename"
            onChange={(event) => updateSubEffect({ modelName: event.target.value })}
          />
        </div>
        <div className="flex flex-wrap gap-3">
          <CheckboxWithHelp
            label="Billboard"
            help="Always face the camera regardless of rotation."
            checked={subEffect.billboard}
            onChange={(checked) => updateSubEffect({ billboard: checked })}
            ariaLabel="subeffect-billboard"
          />
          <CheckboxWithHelp
            label="Alpha"
            help="Enable alpha testing. Pixels below threshold become invisible."
            checked={subEffect.alpha}
            onChange={(checked) => updateSubEffect({ alpha: checked })}
            ariaLabel="subeffect-alpha"
          />
          <CheckboxWithHelp
            label="RotaBoard"
            help="Billboard + continuous rotation. Effect faces camera while spinning."
            checked={subEffect.rotaBoard}
            onChange={(checked) => updateSubEffect({ rotaBoard: checked })}
            ariaLabel="subeffect-rotaboard"
          />
        </div>
        <CylinderMeshEditor />
        <FrameTexEditor />
        <UVCoordEditor />
      </div>
    </div>
  );
}
