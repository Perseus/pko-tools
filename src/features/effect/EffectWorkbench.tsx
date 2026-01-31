import { saveEffect } from "@/commands/effect";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { effectDataAtom, selectedEffectAtom } from "@/store/effect";
import { currentProjectAtom } from "@/store/project";
import { useAtomValue } from "jotai";
import { Save } from "lucide-react";
import { useState } from "react";
import EffectViewport from "@/features/effect/EffectViewport";
import SubEffectList from "@/features/effect/SubEffectList";
import KeyframeTimeline from "@/features/effect/KeyframeTimeline";
import KeyframeProperties from "@/features/effect/KeyframeProperties";
import PlaybackControls from "@/features/effect/PlaybackControls";
import SubEffectProperties from "@/features/effect/SubEffectProperties";

export default function EffectWorkbench() {
  const effectData = useAtomValue(effectDataAtom);
  const selectedEffect = useAtomValue(selectedEffectAtom);
  const currentProject = useAtomValue(currentProjectAtom);
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  async function handleSave() {
    if (!effectData || !currentProject || !selectedEffect) {
      return;
    }

    setIsSaving(true);
    try {
      await saveEffect(currentProject.id, selectedEffect, effectData);
      toast({
        title: "Effect saved",
        description: selectedEffect,
      });
    } catch (error) {
      toast({
        title: "Failed to save effect",
        description: String(error),
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex h-full w-full flex-col gap-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-lg font-semibold">Effect Editor</div>
          <div className="text-sm text-muted-foreground">
            {effectData
              ? `${effectData.subEffects.length} sub-effects loaded`
              : "Select an effect file to begin."}
          </div>
        </div>
        <Button
          size="sm"
          variant="secondary"
          disabled={!effectData || !selectedEffect || !currentProject || isSaving}
          onClick={handleSave}
        >
          <Save />
          {isSaving ? "Saving" : "Save"}
        </Button>
      </div>
      <div className="grid flex-1 grid-cols-1 gap-4 xl:grid-cols-[280px_minmax(0,1fr)_320px]">
        <SubEffectList />
        <div className="flex min-h-[400px] flex-col gap-4">
          <EffectViewport />
          <KeyframeTimeline />
        </div>
        <div className="flex flex-col gap-4">
          <SubEffectProperties />
          <KeyframeProperties />
          <PlaybackControls />
        </div>
      </div>
    </div>
  );
}
