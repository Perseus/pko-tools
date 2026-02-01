import { Input } from "@/components/ui/input";
import {
  particleDataAtom,
  particleDirtyAtom,
  selectedParticleSystemIndexAtom,
} from "@/store/particle";
import type { ParticleSystem } from "@/types/particle";
import { PARTICLE_TYPE_LABELS } from "@/types/particle";
import { FieldLabel, SmallLabel } from "@/features/effect/HelpTip";
import { useAtom, useAtomValue } from "jotai";
import React from "react";
import { useMemo } from "react";

export default function ParticleBasicParams() {
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

  return (
    <div className="space-y-2">
      <FieldLabel help="Core settings for this particle emitter.">Basic</FieldLabel>
      <div className="space-y-1">
        <SmallLabel help="Identifier for this particle system.">Name</SmallLabel>
        <Input
          value={system.name}
          onChange={(e) => update({ name: e.target.value })}
          className="h-7 text-xs"
        />
      </div>
      <div className="space-y-1">
        <SmallLabel help="Particle behavior pattern. Each type has different movement and rendering characteristics.">Type</SmallLabel>
        <select
          value={system.type}
          onChange={(e) => handleNumber("type", e.target.value)}
          className="h-7 w-full rounded border border-input bg-background px-2 text-xs"
        >
          {Object.entries(PARTICLE_TYPE_LABELS).map(([val, label]) => (
            <option key={val} value={val}>{val} - {label}</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <SmallLabel help="Max active particles at once. Higher = denser effect but more GPU work. Range: 1-100.">Count</SmallLabel>
          <Input
            type="number"
            min={1}
            max={100}
            value={system.particleCount}
            onChange={(e) => handleNumber("particleCount", e.target.value)}
            className="h-7 text-xs"
          />
        </div>
        <div className="space-y-1">
          <SmallLabel help="How long each particle lives (seconds) before fading and being recycled.">Lifetime</SmallLabel>
          <Input
            type="number"
            step="0.1"
            min={0.01}
            value={system.life}
            onChange={(e) => handleNumber("life", e.target.value)}
            className="h-7 text-xs"
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <SmallLabel help="Initial speed of emitted particles. Combined with Direction vector.">Velocity</SmallLabel>
          <Input
            type="number"
            step="0.1"
            value={system.velocity}
            onChange={(e) => handleNumber("velocity", e.target.value)}
            className="h-7 text-xs"
          />
        </div>
        <div className="space-y-1">
          <SmallLabel help="Time between particle emissions (seconds). Smaller = more particles spawned per second.">Step</SmallLabel>
          <Input
            type="number"
            step="0.01"
            min={0.001}
            value={system.step}
            onChange={(e) => handleNumber("step", e.target.value)}
            className="h-7 text-xs"
          />
        </div>
      </div>
      <div className="space-y-1">
        <SmallLabel help="Random spawn area dimensions. Particles appear at random positions within this XYZ box centered on the origin.">Range (X, Y, Z)</SmallLabel>
        <div className="flex gap-1">
          {([0, 1, 2] as const).map((i) => (
            <Input
              key={i}
              type="number"
              step="0.1"
              value={system.range[i]}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isNaN(v)) return;
                const next: [number, number, number] = [...system.range];
                next[i] = v;
                update({ range: next });
              }}
              className="h-7 text-xs"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
