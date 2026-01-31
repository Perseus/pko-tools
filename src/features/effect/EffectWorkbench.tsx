import { saveEffect } from "@/commands/effect";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  effectDataAtom,
  effectDirtyAtom,
  effectOriginalAtom,
  selectedEffectAtom,
} from "@/store/effect";
import { currentProjectAtom } from "@/store/project";
import { useAtom, useAtomValue } from "jotai";
import { Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import EffectViewport from "@/features/effect/EffectViewport";
import SubEffectList from "@/features/effect/SubEffectList";
import KeyframeTimeline from "@/features/effect/KeyframeTimeline";
import KeyframeProperties from "@/features/effect/KeyframeProperties";
import PlaybackControls from "@/features/effect/PlaybackControls";
import SubEffectProperties from "@/features/effect/SubEffectProperties";

export default function EffectWorkbench() {
  const [effectData, setEffectData] = useAtom(effectDataAtom);
  const selectedEffect = useAtomValue(selectedEffectAtom);
  const currentProject = useAtomValue(currentProjectAtom);
  const [isDirty, setDirty] = useAtom(effectDirtyAtom);
  const [originalEffect] = useAtom(effectOriginalAtom);
  const [isSaving, setIsSaving] = useState(false);
  const { toast } = useToast();

  const handleSave = useCallback(async () => {
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
      setDirty(false);
    } catch (error) {
      toast({
        title: "Failed to save effect",
        description: String(error),
      });
    } finally {
      setIsSaving(false);
    }
  }, [currentProject, effectData, selectedEffect, setDirty, toast]);

  const handleDiscard = useCallback(() => {
    if (!originalEffect) {
      return;
    }

    setEffectData(structuredClone(originalEffect));
    setDirty(false);
    toast({
      title: "Changes discarded",
      description: selectedEffect ?? "",
    });
  }, [originalEffect, selectedEffect, setDirty, setEffectData, toast]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (!isDirty) {
          toast({
            title: "No changes to save",
            description: selectedEffect ?? "",
          });
          return;
        }
        if (!isSaving) {
          handleSave();
        }
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSave, isDirty, isSaving, selectedEffect, toast]);

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
          {isDirty && (
            <div className="mt-1 text-xs text-amber-500">Unsaved changes</div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={!isDirty || !originalEffect || isSaving}
            onClick={handleDiscard}
          >
            Discard
          </Button>
          <Button
            size="sm"
            variant={isDirty ? "default" : "secondary"}
            disabled={!effectData || !selectedEffect || !currentProject || isSaving}
            onClick={handleSave}
          >
            <Save />
            {isSaving ? "Saving" : isDirty ? "Save Changes" : "Save"}
          </Button>
        </div>
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
