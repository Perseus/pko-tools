import { Input } from "@/components/ui/input";
import {
  particleDataAtom,
  particleDirtyAtom,
  selectedParticleSystemIndexAtom,
} from "@/store/particle";
import type { ParticleSystem } from "@/types/particle";
import BlendModeEditor from "@/features/effect/BlendModeEditor";
import { CheckboxWithHelp, FieldLabel, SmallLabel } from "@/features/effect/HelpTip";
import { useAtom, useAtomValue } from "jotai";
import React from "react";
import { useMemo } from "react";

export default function ParticleRenderParams() {
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

  return (
    <div className="space-y-2">
      <FieldLabel help="Visual rendering settings for particle appearance.">Rendering</FieldLabel>
      <div className="space-y-1">
        <SmallLabel help="Sprite texture for each particle. Loaded from texture/effect/. Enter filename without path or extension.">Texture</SmallLabel>
        <Input
          value={system.textureName}
          onChange={(e) => update({ textureName: e.target.value })}
          placeholder="e.g. spark01"
          className="h-7 text-xs"
        />
      </div>
      <div className="space-y-1">
        <SmallLabel help="3D model used for each particle instead of a flat sprite. Leave empty for sprite particles.">Model</SmallLabel>
        <Input
          value={system.modelName}
          onChange={(e) => update({ modelName: e.target.value })}
          placeholder="e.g. particle.lgo"
          className="h-7 text-xs"
        />
      </div>
      <BlendModeEditor
        srcBlend={system.srcBlend}
        destBlend={system.destBlend}
        onChange={(src, dest) => update({ srcBlend: src, destBlend: dest })}
      />
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <SmallLabel help="Texture shrink filter. Controls how textures look when smaller than native resolution.">Min Filter</SmallLabel>
          <select
            value={system.minFilter}
            onChange={(e) => { const v = Number(e.target.value); if (!Number.isNaN(v)) update({ minFilter: v }); }}
            className="h-7 w-full rounded border border-input bg-background px-2 text-xs"
          >
            <option value={0}>None</option>
            <option value={1}>Point (sharp/pixelated)</option>
            <option value={2}>Linear (smooth/blurred)</option>
            <option value={3}>Anisotropic (high quality)</option>
          </select>
        </div>
        <div className="space-y-1">
          <SmallLabel help="Texture enlarge filter. Controls how textures look when stretched larger than native resolution.">Mag Filter</SmallLabel>
          <select
            value={system.magFilter}
            onChange={(e) => { const v = Number(e.target.value); if (!Number.isNaN(v)) update({ magFilter: v }); }}
            className="h-7 w-full rounded border border-input bg-background px-2 text-xs"
          >
            <option value={0}>None</option>
            <option value={1}>Point (sharp/pixelated)</option>
            <option value={2}>Linear (smooth/blurred)</option>
            <option value={3}>Anisotropic (high quality)</option>
          </select>
        </div>
      </div>
      <CheckboxWithHelp
        label="Billboard"
        help="Always face particles toward the camera. Disable for 3D model particles that should rotate freely."
        checked={system.billboard}
        onChange={(checked) => update({ billboard: checked })}
      />
    </div>
  );
}
