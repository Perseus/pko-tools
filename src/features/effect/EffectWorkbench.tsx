import { saveEffect } from "@/commands/effect";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
import React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import EffectViewport from "@/features/effect/EffectViewport";
import SubEffectList from "@/features/effect/SubEffectList";
import KeyframeTimeline from "@/features/effect/KeyframeTimeline";
import KeyframeProperties from "@/features/effect/KeyframeProperties";
import PlaybackControls from "@/features/effect/PlaybackControls";
import SubEffectProperties from "@/features/effect/SubEffectProperties";

export default function EffectWorkbench() {
  const [effectData, setEffectData] = useAtom(effectDataAtom);
  const [selectedEffect, setSelectedEffect] = useAtom(selectedEffectAtom);
  const currentProject = useAtomValue(currentProjectAtom);
  const [isDirty, setDirty] = useAtom(effectDirtyAtom);
  const [originalEffect, setOriginalEffect] = useAtom(effectOriginalAtom);
  const [isSaving, setIsSaving] = useState(false);
  const [isSaveAsOpen, setIsSaveAsOpen] = useState(false);
  const [saveAsName, setSaveAsName] = useState("");
  const { toast } = useToast();

  const normalizedSelectedName = useMemo(() => {
    if (!selectedEffect) {
      return "";
    }
    return selectedEffect.replace(/\.eff$/i, "");
  }, [selectedEffect]);

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
      setOriginalEffect(structuredClone(effectData));
    } catch (error) {
      toast({
        title: "Failed to save effect",
        description: String(error),
      });
    } finally {
      setIsSaving(false);
    }
  }, [currentProject, effectData, selectedEffect, setDirty, setOriginalEffect, toast]);

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

  const handleSaveAs = useCallback(async () => {
    if (!effectData || !currentProject) {
      return;
    }

    const trimmed = saveAsName.trim();
    if (!trimmed) {
      toast({
        title: "Enter a filename",
        description: "Please provide a name for the new effect.",
      });
      return;
    }

    const fileName = trimmed.toLowerCase().endsWith(".eff") ? trimmed : `${trimmed}.eff`;

    setIsSaving(true);
    try {
      await saveEffect(currentProject.id, fileName, effectData);
      setSelectedEffect(fileName);
      setEffectData(structuredClone(effectData));
      setDirty(false);
      setOriginalEffect(structuredClone(effectData));
      toast({
        title: "Effect saved",
        description: fileName,
      });
      setIsSaveAsOpen(false);
    } catch (error) {
      toast({
        title: "Failed to save effect",
        description: String(error),
      });
    } finally {
      setIsSaving(false);
    }
  }, [
    currentProject,
    effectData,
    saveAsName,
    setDirty,
    setEffectData,
    setOriginalEffect,
    setSelectedEffect,
    toast,
  ]);

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

  useEffect(() => {
    if (isSaveAsOpen) {
      setSaveAsName(normalizedSelectedName);
    }
  }, [isSaveAsOpen, normalizedSelectedName]);

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
            variant="outline"
            disabled={!effectData || !currentProject || isSaving}
            onClick={() => setIsSaveAsOpen(true)}
          >
            Save As
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
      <Dialog open={isSaveAsOpen} onOpenChange={setIsSaveAsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Effect As</DialogTitle>
            <DialogDescription>
              Create a new .eff file in the project effect folder.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={saveAsName}
            onChange={(event) => setSaveAsName(event.target.value)}
            placeholder="new-effect-name"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsSaveAsOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveAs} disabled={isSaving}>
              {isSaving ? "Saving" : "Save As"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
