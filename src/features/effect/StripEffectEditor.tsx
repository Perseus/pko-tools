import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { StripEffect } from "@/types/effect";
import { createDefaultStrip } from "@/types/effect";
import BlendModeEditor from "@/features/effect/BlendModeEditor";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import React from "react";
import { useEffect, useState } from "react";
import { useAtom } from "jotai";
import { stripEffectDataAtom } from "@/store/strip";
import { SmallLabel } from "@/features/effect/HelpTip";

/**
 * Editor for strip effects (ribbon trails between two dummy points).
 * Strips are stored as a standalone list, separate from sub-effects.
 * State is managed locally until integrated with a persistent store.
 */
export default function StripEffectEditor() {
  const [strips, setStrips] = useState<StripEffect[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [, setStripAtom] = useAtom(stripEffectDataAtom);

  const strip = selectedIndex !== null ? strips[selectedIndex] ?? null : null;

  // Sync selected strip data to atom for 3D rendering
  useEffect(() => {
    setStripAtom(strip);
  }, [strip, setStripAtom]);

  function addStrip() {
    const next = [...strips, createDefaultStrip()];
    setStrips(next);
    setSelectedIndex(next.length - 1);
  }

  function removeStrip(index: number) {
    const next = strips.filter((_, i) => i !== index);
    setStrips(next);
    if (selectedIndex === index) {
      setSelectedIndex(next.length > 0 ? Math.min(index, next.length - 1) : null);
    } else if (selectedIndex !== null && selectedIndex > index) {
      setSelectedIndex(selectedIndex - 1);
    }
  }

  function update(patch: Partial<StripEffect>) {
    if (selectedIndex === null) return;
    setStrips((prev) =>
      prev.map((s, i) => (i === selectedIndex ? { ...s, ...patch } : s)),
    );
  }

  function handleNumber(key: keyof StripEffect, value: string) {
    const v = Number(value);
    if (!Number.isNaN(v)) update({ [key]: v } as Partial<StripEffect>);
  }

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
        Strip Effects
        {strips.length > 0 && (
          <span className="text-[10px] font-normal text-muted-foreground">
            ({strips.length})
          </span>
        )}
      </button>
      {isExpanded && (
        <div className="space-y-2 px-3 pb-3">
          <div className="text-[9px] text-muted-foreground">
            Ribbon trails that stretch between two bone attachment points (dummy nodes). Used for sword trails, motion streaks, etc.
          </div>
          {strips.length > 0 && (
            <div className="space-y-1">
              {strips.map((s, i) => (
                <div
                  key={i}
                  className={`flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-xs ${
                    selectedIndex === i
                      ? "bg-accent text-accent-foreground"
                      : "hover:bg-muted/50"
                  }`}
                  onClick={() => setSelectedIndex(i)}
                >
                  <span className="flex-1 truncate">
                    {s.texName || `Strip ${i}`}
                  </span>
                  <span className="text-[9px] text-muted-foreground">
                    d{s.dummy[0]}-d{s.dummy[1]}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-5 w-5 shrink-0 p-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeStrip(i);
                    }}
                    title="Remove this strip"
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
            onClick={addStrip}
          >
            <Plus className="mr-1 h-3 w-3" />
            Add Strip
          </Button>
          {strip && (
            <div className="space-y-2 border-t border-border pt-2">
              <div className="space-y-1">
                <SmallLabel help="Texture for the ribbon trail. Loaded from texture/effect/. Enter filename without path or extension.">
                  Texture
                </SmallLabel>
                <Input
                  value={strip.texName}
                  onChange={(e) => update({ texName: e.target.value })}
                  placeholder="e.g. trail01"
                  className="h-7 text-xs"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <SmallLabel help="Maximum number of segments in the trail. Higher = longer trail that takes more time to fade out.">
                    Max Length
                  </SmallLabel>
                  <Input
                    type="number"
                    min={1}
                    value={strip.maxLen}
                    onChange={(e) => handleNumber("maxLen", e.target.value)}
                    className="h-7 text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <SmallLabel help="How long each trail segment persists before fading (seconds). Shorter = trail disappears faster.">
                    Life
                  </SmallLabel>
                  <Input
                    type="number"
                    step="0.1"
                    min={0.01}
                    value={strip.life}
                    onChange={(e) => handleNumber("life", e.target.value)}
                    className="h-7 text-xs"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <SmallLabel help="Time between trail segment captures (seconds). Smaller = smoother trail but more geometry. 0.01-0.1 typical.">
                  Step
                </SmallLabel>
                <Input
                  type="number"
                  step="0.01"
                  min={0.001}
                  value={strip.step}
                  onChange={(e) => handleNumber("step", e.target.value)}
                  className="h-7 text-xs"
                />
              </div>
              <div className="space-y-1">
                <SmallLabel help="Two bone dummy point indices. The ribbon stretches between dummy_N and dummy_M on the character skeleton. Common: 12/13 (right hand top/bottom).">
                  Dummy Points (from, to)
                </SmallLabel>
                <div className="flex gap-1">
                  <Input
                    type="number"
                    min={0}
                    value={strip.dummy[0]}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (!Number.isNaN(v)) update({ dummy: [v, strip.dummy[1]] });
                    }}
                    className="h-7 text-xs"
                    placeholder="from"
                  />
                  <Input
                    type="number"
                    min={0}
                    value={strip.dummy[1]}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (!Number.isNaN(v)) update({ dummy: [strip.dummy[0], v] });
                    }}
                    className="h-7 text-xs"
                    placeholder="to"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <SmallLabel help="RGBA color tint. Each channel 0.0-1.0. Alpha controls trail opacity.">
                  Color (R, G, B, A)
                </SmallLabel>
                <div className="flex gap-1">
                  {([0, 1, 2, 3] as const).map((ci) => (
                    <Input
                      key={ci}
                      type="number"
                      step="0.01"
                      min={0}
                      max={1}
                      value={strip.color[ci]}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isNaN(v)) return;
                        const next: [number, number, number, number] = [...strip.color];
                        next[ci] = v;
                        update({ color: next });
                      }}
                      className="h-7 text-xs"
                    />
                  ))}
                </div>
                <div
                  className="h-3 w-full rounded border border-border"
                  style={{
                    backgroundColor: `rgba(${Math.round(strip.color[0] * 255)}, ${Math.round(strip.color[1] * 255)}, ${Math.round(strip.color[2] * 255)}, ${strip.color[3]})`,
                  }}
                />
              </div>
              <BlendModeEditor
                srcBlend={strip.srcBlend}
                destBlend={strip.destBlend}
                onChange={(src, dest) => update({ srcBlend: src, destBlend: dest })}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
