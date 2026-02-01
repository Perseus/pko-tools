import { Button } from "@/components/ui/button";
import {
  particleDataAtom,
  particleDirtyAtom,
  selectedParticleSystemIndexAtom,
} from "@/store/particle";
import {
  createDefaultParticleController,
  createDefaultParticleSystem,
  PARTICLE_TYPE_LABELS,
} from "@/types/particle";
import { useAtom } from "jotai";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import React from "react";
import { useState } from "react";
import ParticleBasicParams from "@/features/effect/particle/ParticleBasicParams";
import ParticlePhysicsParams from "@/features/effect/particle/ParticlePhysicsParams";
import ParticleFrameParams from "@/features/effect/particle/ParticleFrameParams";
import ParticleRenderParams from "@/features/effect/particle/ParticleRenderParams";

export default function ParticleSystemEditor() {
  const [particleData, setParticleData] = useAtom(particleDataAtom);
  const [selectedIndex, setSelectedIndex] = useAtom(selectedParticleSystemIndexAtom);
  const [, setDirty] = useAtom(particleDirtyAtom);
  const [isExpanded, setIsExpanded] = useState(true);

  function ensureData() {
    if (!particleData) {
      const ctrl = createDefaultParticleController();
      setParticleData(ctrl);
      return ctrl;
    }
    return particleData;
  }

  function addSystem() {
    const data = ensureData();
    const system = createDefaultParticleSystem();
    system.name = `particle_${data.systems.length}`;
    const next = { ...data, systems: [...data.systems, system] };
    setParticleData(next);
    setSelectedIndex(next.systems.length - 1);
    setDirty(true);
  }

  function removeSystem(index: number) {
    if (!particleData) return;
    const next = {
      ...particleData,
      systems: particleData.systems.filter((_, i) => i !== index),
    };
    setParticleData(next);
    if (selectedIndex === index) {
      setSelectedIndex(next.systems.length > 0 ? Math.min(index, next.systems.length - 1) : null);
    } else if (selectedIndex !== null && selectedIndex > index) {
      setSelectedIndex(selectedIndex - 1);
    }
    setDirty(true);
  }

  const systems = particleData?.systems ?? [];

  return (
    <div className="rounded-xl border border-border bg-background/70">
      <button
        className="flex w-full items-center gap-2 p-3 text-left text-sm font-semibold"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        {isExpanded ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        Particle Systems
        {systems.length > 0 && (
          <span className="text-[10px] font-normal text-muted-foreground">
            ({systems.length})
          </span>
        )}
      </button>
      {isExpanded && (
        <div className="space-y-3 px-3 pb-3">
          <div className="text-[9px] text-muted-foreground">
            Point-based particle emitters. Each system spawns independent particles with their own physics, textures, and lifetime.
          </div>
          {systems.length > 0 && (
            <div className="space-y-1">
              {systems.map((sys, i) => (
                <div
                  key={i}
                  className={`flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-xs ${
                    selectedIndex === i
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-muted/50"
                  }`}
                  onClick={() => setSelectedIndex(i)}
                >
                  <span className="w-4 shrink-0 text-center text-[9px] text-muted-foreground">
                    {i}
                  </span>
                  <span className="flex-1 truncate">
                    {sys.name || PARTICLE_TYPE_LABELS[sys.type] || `System ${i}`}
                  </span>
                  <span className="shrink-0 text-[9px] text-muted-foreground">
                    {PARTICLE_TYPE_LABELS[sys.type] ?? sys.type}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-5 w-5 shrink-0 p-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeSystem(i);
                    }}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-7 w-full text-xs"
            onClick={addSystem}
          >
            <Plus className="mr-1 h-3 w-3" />
            Add Particle System
          </Button>
          {selectedIndex !== null && systems[selectedIndex] && (
            <div className="space-y-3 border-t border-border pt-3">
              <ParticleBasicParams />
              <ParticlePhysicsParams />
              <ParticleFrameParams />
              <ParticleRenderParams />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
