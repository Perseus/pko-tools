import { Input } from "@/components/ui/input";
import {
  particleDataAtom,
  particleDirtyAtom,
  selectedParticleSystemIndexAtom,
} from "@/store/particle";
import type { ParticleSystem } from "@/types/particle";
import type { Vec3 } from "@/types/effect";
import { CheckboxWithHelp, FieldLabel, SmallLabel } from "@/features/effect/HelpTip";
import { useAtom, useAtomValue } from "jotai";
import React from "react";
import { useMemo } from "react";

export default function ParticlePhysicsParams() {
  const [particleData, setParticleData] = useAtom(particleDataAtom);
  const selectedIndex = useAtomValue(selectedParticleSystemIndexAtom);
  const [, setDirty] = useAtom(particleDirtyAtom);

  const system = useMemo(() => {
    if (!particleData || selectedIndex === null) return null;
    return particleData.systems[selectedIndex] ?? null;
  }, [particleData, selectedIndex]);

  if (!system) return null;

  function update(patch: Partial<ParticleSystem>) {
    if (!particleData || selectedIndex === null) return;
    const next = particleData.systems.map((s, i) =>
      i === selectedIndex ? { ...s, ...patch } : s,
    );
    setParticleData({ ...particleData, systems: next });
    setDirty(true);
  }

  function handleNumber(key: keyof ParticleSystem, value: string) {
    const v = Number(value);
    if (!Number.isNaN(v)) update({ [key]: v } as Partial<ParticleSystem>);
  }

  function handleVec3(key: "direction" | "acceleration" | "offset", index: 0 | 1 | 2, value: string) {
    const v = Number(value);
    if (Number.isNaN(v)) return;
    const next: Vec3 = [...system![key]];
    next[index] = v;
    update({ [key]: next });
  }

  function Vec3Row({ label, field, help }: { label: string; field: "direction" | "acceleration" | "offset"; help?: string }) {
    return (
      <div className="space-y-1">
        <SmallLabel help={help}>{label}</SmallLabel>
        <div className="flex gap-1">
          {([0, 1, 2] as const).map((i) => (
            <Input
              key={i}
              type="number"
              step="0.1"
              value={system![field][i]}
              onChange={(e) => handleVec3(field, i, e.target.value)}
              className="h-7 text-xs"
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <FieldLabel help="Movement and force settings that control how particles travel through space.">Physics</FieldLabel>
      <Vec3Row label="Direction" field="direction" help="Initial velocity direction (X, Y, Z). Combined with Velocity for particle movement vector." />
      <Vec3Row label="Acceleration" field="acceleration" help="Constant force applied per frame (X, Y, Z). Use negative Y for gravity (e.g. 0, -9.8, 0)." />
      <Vec3Row label="Offset" field="offset" help="Spawn position offset from the effect origin. Moves the emission point." />
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <SmallLabel help="Seconds to wait before starting particle emission. Useful for sequencing multiple systems.">Delay</SmallLabel>
          <Input
            type="number"
            step="0.1"
            min={0}
            value={system.delayTime}
            onChange={(e) => handleNumber("delayTime", e.target.value)}
            className="h-7 text-xs"
          />
        </div>
        <div className="space-y-1">
          <SmallLabel help="Total emission duration in seconds. 0 = emit indefinitely.">Play Time</SmallLabel>
          <Input
            type="number"
            step="0.1"
            min={0}
            value={system.playTime}
            onChange={(e) => handleNumber("playTime", e.target.value)}
            className="h-7 text-xs"
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-3">
        <CheckboxWithHelp
          label="Model Range"
          help="Spawn particles within the attached model's bounding box instead of the Range XYZ box."
          checked={system.modelRange}
          onChange={(checked) => update({ modelRange: checked })}
        />
        <CheckboxWithHelp
          label="Model Dir"
          help="Orient particles along the model's facing direction."
          checked={system.modelDir}
          onChange={(checked) => update({ modelDir: checked })}
        />
        <CheckboxWithHelp
          label="Shade"
          help="Apply basic shading to particles based on scene lighting."
          checked={system.shade}
          onChange={(checked) => update({ shade: checked })}
        />
      </div>
    </div>
  );
}
