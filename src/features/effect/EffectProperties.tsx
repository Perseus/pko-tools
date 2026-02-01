import { Input } from "@/components/ui/input";
import { effectDataAtom, effectDirtyAtom } from "@/store/effect";
import type { EffectFile } from "@/types/effect";
import { useAtom } from "jotai";
import React from "react";
import { CheckboxWithHelp, FieldLabel, SmallLabel } from "@/features/effect/HelpTip";

export default function EffectProperties() {
  const [effectData, setEffectData] = useAtom(effectDataAtom);
  const [, setDirty] = useAtom(effectDirtyAtom);

  if (!effectData) {
    return null;
  }

  function update(patch: Partial<EffectFile>) {
    if (!effectData) return;
    setEffectData({ ...effectData, ...patch });
    setDirty(true);
  }

  function handleNumber(key: keyof EffectFile, value: string) {
    const parsed = Number(value);
    if (!Number.isNaN(parsed)) {
      update({ [key]: parsed } as Partial<EffectFile>);
    }
  }

  function handleVec3(index: number, value: string) {
    const parsed = Number(value);
    if (Number.isNaN(parsed)) return;
    const next = [...effectData!.rotaVec] as [number, number, number];
    next[index] = parsed;
    update({ rotaVec: next });
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-background/70 p-4">
      <div className="text-sm font-semibold">Effect Properties</div>
      <div className="text-[10px] text-muted-foreground">
        Global settings that apply to the entire .eff file.
      </div>
      <div className="space-y-3 text-xs">
        <div className="space-y-1">
          <FieldLabel help="D3D rendering technique index. Usually 0. Higher values select alternative shader passes.">
            Technique Index
          </FieldLabel>
          <Input
            type="number"
            value={effectData.idxTech}
            onChange={(e) => handleNumber("idxTech", e.target.value)}
            className="h-7 text-xs"
          />
        </div>

        <div className="space-y-1">
          <CheckboxWithHelp
            label="Use Path"
            help="Attach effect to a .csf curve path. The effect follows the path during playback."
            checked={effectData.usePath}
            onChange={(checked) => update({ usePath: checked })}
          />
          {effectData.usePath && (
            <Input
              placeholder="path.csf"
              value={effectData.pathName}
              onChange={(e) => update({ pathName: e.target.value })}
              className="h-7 text-xs"
            />
          )}
        </div>

        <div className="space-y-1">
          <CheckboxWithHelp
            label="Use Sound"
            help="Sound file to play when this effect activates."
            checked={effectData.useSound}
            onChange={(checked) => update({ useSound: checked })}
          />
          {effectData.useSound && (
            <>
              <Input
                placeholder="sound_name"
                value={effectData.soundName}
                onChange={(e) => update({ soundName: e.target.value })}
                className="h-7 text-xs"
              />
            </>
          )}
        </div>

        <div className="space-y-1">
          <CheckboxWithHelp
            label="Rotating"
            help="Continuously spin the entire effect around the given axis vector."
            checked={effectData.rotating}
            onChange={(checked) => update({ rotating: checked })}
          />
          {effectData.rotating && (
            <>
              <SmallLabel help="Direction vector the effect rotates around. E.g. (0, 1, 0) = spin around Y axis.">
                Axis (X, Y, Z)
              </SmallLabel>
              <div className="grid grid-cols-3 gap-1">
                {["X", "Y", "Z"].map((axis, i) => (
                  <Input
                    key={axis}
                    type="number"
                    step="0.1"
                    value={effectData!.rotaVec[i]}
                    onChange={(e) => handleVec3(i, e.target.value)}
                    className="h-7 text-xs"
                    placeholder={axis}
                  />
                ))}
              </div>
              <div className="space-y-0.5">
                <SmallLabel help="Rotation speed in radians per second. Higher = faster spin.">
                  Velocity
                </SmallLabel>
                <Input
                  type="number"
                  step="0.1"
                  value={effectData.rotaVel}
                  onChange={(e) => handleNumber("rotaVel", e.target.value)}
                  className="h-7 text-xs"
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
