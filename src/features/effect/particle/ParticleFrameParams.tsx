import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  particleDataAtom,
  particleDirtyAtom,
  selectedParticleSystemIndexAtom,
} from "@/store/particle";
import type { ParticleSystem } from "@/types/particle";
import type { Vec3, Vec4 } from "@/types/effect";
import { FieldLabel, SmallLabel } from "@/features/effect/HelpTip";
import { useAtom, useAtomValue } from "jotai";
import { Plus, Trash2 } from "lucide-react";
import React from "react";
import { useMemo, useState } from "react";

export default function ParticleFrameParams() {
  const [particleData, setParticleData] = useAtom(particleDataAtom);
  const selectedIndex = useAtomValue(selectedParticleSystemIndexAtom);
  const [, setDirty] = useAtom(particleDirtyAtom);
  const [selectedFrame, setSelectedFrame] = useState(0);

  const system = useMemo(() => {
    if (!particleData || selectedIndex === null) return null;
    return particleData.systems[selectedIndex] ?? null;
  }, [particleData, selectedIndex]);

  if (!system) return null;

  const frameCount = system.frameCount;
  const clampedFrame = Math.min(selectedFrame, Math.max(frameCount - 1, 0));

  function update(patch: Partial<ParticleSystem>) {
    if (!particleData || selectedIndex === null) return;
    const next = particleData.systems.map((s, i) =>
      i === selectedIndex ? { ...s, ...patch } : s,
    );
    setParticleData({ ...particleData, systems: next });
    setDirty(true);
  }

  function addFrame() {
    const sizes = [...system!.frameSizes, system!.frameSizes[system!.frameSizes.length - 1] ?? 1];
    const angles: Vec3[] = [...system!.frameAngles, system!.frameAngles[system!.frameAngles.length - 1] ?? [0, 0, 0]];
    const colors: Vec4[] = [...system!.frameColors, system!.frameColors[system!.frameColors.length - 1] ?? [1, 1, 1, 1]];
    update({
      frameCount: frameCount + 1,
      frameSizes: sizes,
      frameAngles: angles,
      frameColors: colors,
    });
  }

  function removeFrame(index: number) {
    if (frameCount <= 1) return;
    update({
      frameCount: frameCount - 1,
      frameSizes: system!.frameSizes.filter((_, i) => i !== index),
      frameAngles: system!.frameAngles.filter((_, i) => i !== index),
      frameColors: system!.frameColors.filter((_, i) => i !== index),
    });
    if (selectedFrame >= frameCount - 1) {
      setSelectedFrame(Math.max(0, frameCount - 2));
    }
  }

  function updateSize(value: string) {
    const v = Number(value);
    if (Number.isNaN(v)) return;
    const next = [...system!.frameSizes];
    next[clampedFrame] = v;
    update({ frameSizes: next });
  }

  function updateAngle(component: 0 | 1 | 2, value: string) {
    const v = Number(value);
    if (Number.isNaN(v)) return;
    const next = system!.frameAngles.map((a, i) => {
      if (i !== clampedFrame) return a;
      const copy: Vec3 = [...a];
      copy[component] = v;
      return copy;
    });
    update({ frameAngles: next });
  }

  function updateColor(component: 0 | 1 | 2 | 3, value: string) {
    const v = Number(value);
    if (Number.isNaN(v)) return;
    const next = system!.frameColors.map((c, i) => {
      if (i !== clampedFrame) return c;
      const copy: Vec4 = [...c];
      copy[component] = v;
      return copy;
    });
    update({ frameColors: next });
  }

  const currentSize = system.frameSizes[clampedFrame] ?? 1;
  const currentAngle = system.frameAngles[clampedFrame] ?? [0, 0, 0];
  const currentColor = system.frameColors[clampedFrame] ?? [1, 1, 1, 1];

  return (
    <div className="space-y-2">
      <FieldLabel help="Animate particle properties over their lifetime. Each frame represents a state the particle transitions through.">Frame Animation ({frameCount} frames)</FieldLabel>
      {frameCount > 1 && (
        <div className="space-y-1">
          <input
            type="range"
            min={0}
            max={frameCount - 1}
            value={clampedFrame}
            onChange={(e) => setSelectedFrame(Number(e.target.value))}
            className="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-foreground"
          />
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>Frame {clampedFrame}</span>
            <Button
              size="sm"
              variant="ghost"
              className="h-5 w-5 p-0"
              onClick={() => removeFrame(clampedFrame)}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}
      <div className="space-y-1">
        <SmallLabel help="Particle scale multiplier at this frame. Particles interpolate between frame values over their lifetime.">Size</SmallLabel>
        <Input
          type="number"
          step="0.1"
          value={currentSize}
          onChange={(e) => updateSize(e.target.value)}
          className="h-7 text-xs"
        />
      </div>
      <div className="space-y-1">
        <SmallLabel help="Particle rotation in radians (X, Y, Z) at this frame.">Angle (X, Y, Z)</SmallLabel>
        <div className="flex gap-1">
          {([0, 1, 2] as const).map((i) => (
            <Input
              key={i}
              type="number"
              step="0.1"
              placeholder={["X", "Y", "Z"][i]}
              value={currentAngle[i]}
              onChange={(e) => updateAngle(i, e.target.value)}
              className="h-7 text-xs"
            />
          ))}
        </div>
      </div>
      <div className="space-y-1">
        <SmallLabel help="RGBA color at this frame. Each channel 0.0-1.0. Alpha controls opacity.">Color (R, G, B, A)</SmallLabel>
        <div className="flex gap-1">
          {([0, 1, 2, 3] as const).map((i) => (
            <Input
              key={i}
              type="number"
              step="0.01"
              min={0}
              max={1}
              placeholder={["R", "G", "B", "A"][i]}
              value={currentColor[i]}
              onChange={(e) => updateColor(i, e.target.value)}
              className="h-7 text-xs"
            />
          ))}
        </div>
      </div>
      <div
        className="h-4 w-full rounded border border-border"
        style={{
          backgroundColor: `rgba(${Math.round(currentColor[0] * 255)}, ${Math.round(currentColor[1] * 255)}, ${Math.round(currentColor[2] * 255)}, ${currentColor[3]})`,
        }}
      />
      <Button
        size="sm"
        variant="outline"
        className="h-7 w-full text-xs"
        onClick={addFrame}
      >
        <Plus className="mr-1 h-3 w-3" />
        Add Frame
      </Button>
    </div>
  );
}
