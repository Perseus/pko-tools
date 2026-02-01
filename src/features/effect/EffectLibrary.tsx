import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { effectDataAtom, effectDirtyAtom } from "@/store/effect";
import { particleDataAtom } from "@/store/particle";
import type { EffectFile } from "@/types/effect";
import type { ParticleController } from "@/types/particle";
import { useAtom } from "jotai";
import { SmallLabel } from "@/features/effect/HelpTip";
import { ChevronDown, ChevronRight, Download, Upload } from "lucide-react";
import React from "react";
import { useCallback, useRef, useState } from "react";

/** Composition: combined effect + particle data for save/load. */
interface EffectComposition {
  effect: EffectFile | null;
  particles: ParticleController | null;
}

export default function EffectLibrary() {
  const [effectData, setEffectData] = useAtom(effectDataAtom);
  const [particleData, setParticleData] = useAtom(particleDataAtom);
  const [, setDirty] = useAtom(effectDirtyAtom);
  const [isExpanded, setIsExpanded] = useState(false);
  const [exportName, setExportName] = useState("composition");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = useCallback(() => {
    const composition: EffectComposition = {
      effect: effectData,
      particles: particleData,
    };
    const json = JSON.stringify(composition, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${exportName.trim() || "composition"}.efflib.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [effectData, particleData, exportName]);

  const handleImport = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const composition = JSON.parse(
            reader.result as string,
          ) as EffectComposition;
          if (composition.effect) {
            setEffectData(composition.effect);
            setDirty(true);
          }
          if (composition.particles) {
            setParticleData(composition.particles);
          }
        } catch {
          // Invalid JSON - silently ignore
        }
      };
      reader.readAsText(file);
      // Reset input so same file can be re-selected
      event.target.value = "";
    },
    [setEffectData, setParticleData, setDirty],
  );

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
        Library
      </button>
      {isExpanded && (
        <div className="space-y-2 px-3 pb-3">
          <div className="space-y-1">
            <SmallLabel help="Filename for the exported .efflib.json file. The file contains the full effect and particle configuration for sharing or backup.">
              Export Name
            </SmallLabel>
            <Input
              value={exportName}
              onChange={(e) => setExportName(e.target.value)}
              placeholder="composition"
              className="h-7 text-xs"
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 w-full text-xs"
            onClick={handleExport}
            disabled={!effectData && !particleData}
          >
            <Download className="mr-1 h-3 w-3" />
            Export Composition
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 w-full text-xs"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="mr-1 h-3 w-3" />
            Import Composition
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.efflib.json"
            className="hidden"
            onChange={handleImport}
          />
          <div className="text-[9px] text-muted-foreground">
            Save/load effect + particle data as .efflib.json for sharing or backup. The exported file contains the full effect and particle configuration.
          </div>
        </div>
      )}
    </div>
  );
}
