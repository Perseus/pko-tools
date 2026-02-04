import { saveEffect, saveParticles, loadParticles } from "@/commands/effect";
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
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Redo2, Save, Undo2, Video } from "lucide-react";
import React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import EffectViewport from "@/features/effect/EffectViewport";
import SubEffectList from "@/features/effect/SubEffectList";
import KeyframeTimeline from "@/features/effect/KeyframeTimeline";
import KeyframeProperties from "@/features/effect/KeyframeProperties";
import SubEffectProperties from "@/features/effect/SubEffectProperties";
import EffectProperties from "@/features/effect/EffectProperties";
import ParticleSystemEditor from "@/features/effect/particle/ParticleSystemEditor";
import CharacterBinder from "@/features/effect/CharacterBinder";
import StripEffectEditor from "@/features/effect/StripEffectEditor";
import PathEditor from "@/features/effect/PathEditor";
import EffectLibrary from "@/features/effect/EffectLibrary";
import CurveEditor from "@/features/effect/CurveEditor";
import TextureBrowser from "@/features/effect/TextureBrowser";
import ExportDialog from "@/features/effect/ExportDialog";
import { useEffectHistory } from "@/features/effect/useEffectHistory";
import { particleDataAtom, particleOriginalAtom } from "@/store/particle";
import type { ParticleController } from "@/types/particle";

export default function EffectWorkbench() {
  const [effectData, setEffectData] = useAtom(effectDataAtom);
  const [selectedEffect, setSelectedEffect] = useAtom(selectedEffectAtom);
  const currentProject = useAtomValue(currentProjectAtom);
  const [isDirty, setDirty] = useAtom(effectDirtyAtom);
  const [originalEffect, setOriginalEffect] = useAtom(effectOriginalAtom);
  const [isSaving, setIsSaving] = useState(false);
  const [isSaveAsOpen, setIsSaveAsOpen] = useState(false);
  const [saveAsName, setSaveAsName] = useState("");
  const [isExportOpen, setIsExportOpen] = useState(false);
  const { toast } = useToast();
  const { undo, redo, canUndo, canRedo } = useEffectHistory();
  const [particleData, setParticleData] = useAtom(particleDataAtom);
  const [particleOriginal, setParticleOriginal] = useAtom(particleOriginalAtom);

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
      if (particleData) {
        await saveParticles(currentProject.id, selectedEffect, particleData);
        setParticleOriginal(structuredClone(particleData));
      }
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
  }, [currentProject, effectData, particleData, selectedEffect, setDirty, setOriginalEffect, setParticleOriginal, toast]);

  const handleDiscard = useCallback(() => {
    if (!originalEffect) {
      return;
    }

    setEffectData(structuredClone(originalEffect));
    if (particleOriginal) {
      setParticleData(structuredClone(particleOriginal));
    } else {
      setParticleData(null);
    }
    setDirty(false);
    toast({
      title: "Changes discarded",
      description: selectedEffect ?? "",
    });
  }, [originalEffect, particleOriginal, selectedEffect, setDirty, setEffectData, setParticleData, toast]);

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
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "s") {
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
      if (mod && event.key.toLowerCase() === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
      }
      if (mod && event.key.toLowerCase() === "z" && event.shiftKey) {
        event.preventDefault();
        redo();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSave, isDirty, isSaving, selectedEffect, toast, undo, redo]);

  // Load particles sidecar when effect changes
  useEffect(() => {
    if (!selectedEffect || !currentProject) {
      return;
    }

    let cancelled = false;
    loadParticles(currentProject.id, selectedEffect).then((result) => {
      if (cancelled) return;
      if (result) {
        const data = result as ParticleController;
        setParticleData(data);
        setParticleOriginal(structuredClone(data));
      }
    }).catch(() => {
      // Silently ignore — particles file may not exist
    });

    return () => { cancelled = true; };
  }, [selectedEffect, currentProject, setParticleData, setParticleOriginal]);

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
            variant="ghost"
            disabled={!canUndo}
            onClick={undo}
            title="Undo (Cmd+Z)"
          >
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!canRedo}
            onClick={redo}
            title="Redo (Cmd+Shift+Z)"
          >
            <Redo2 className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!isDirty || !originalEffect || isSaving}
            onClick={handleDiscard}
            title="Revert all changes to the last saved state"
          >
            Discard
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!effectData || !currentProject || isSaving}
            onClick={() => setIsSaveAsOpen(true)}
            title="Save a copy with a new filename"
          >
            Save As
          </Button>
          <Button
            size="sm"
            variant={isDirty ? "default" : "secondary"}
            disabled={!effectData || !selectedEffect || !currentProject || isSaving}
            onClick={handleSave}
            title="Save effect (.eff) and particle data (.par JSON)"
          >
            <Save />
            {isSaving ? "Saving" : isDirty ? "Save Changes" : "Save"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={!effectData}
            onClick={() => setIsExportOpen(true)}
            title="Record effect preview to video"
          >
            <Video className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <div className="grid flex-1 grid-cols-1 gap-4 xl:grid-cols-[220px_minmax(0,1fr)_320px]">
        <SubEffectList />
        <div className="flex min-h-[400px] flex-col gap-4">
          <EffectViewport />
          <KeyframeTimeline />
          <CurveEditor />
        </div>
        <Tabs defaultValue="sub-effect" className="flex flex-col overflow-hidden">
          <TabsList className="w-full shrink-0">
            <TabsTrigger value="sub-effect" title="Edit properties of the selected sub-effect layer">Sub-Effect</TabsTrigger>
            <TabsTrigger value="keyframe" title="Edit position, rotation, scale, and color for the current keyframe">Keyframe</TabsTrigger>
            <TabsTrigger value="effect" title="Global effect settings: technique, path, sound, rotation">Effect</TabsTrigger>
            <TabsTrigger value="tools" title="Particle systems, strip effects, skeleton binding, library">Tools</TabsTrigger>
          </TabsList>
          <TabsContent value="sub-effect" className="flex-1 overflow-y-auto mt-0">
            <SubEffectProperties />
          </TabsContent>
          <TabsContent value="keyframe" className="flex-1 overflow-y-auto mt-0">
            <KeyframeProperties />
          </TabsContent>
          <TabsContent value="effect" className="flex-1 overflow-y-auto mt-0 space-y-4">
            <EffectProperties />
            <PathEditor />
          </TabsContent>
          <TabsContent value="tools" className="flex-1 overflow-y-auto mt-0 space-y-4">
            <ParticleSystemEditor />
            <StripEffectEditor />
            <TextureBrowser />
            <CharacterBinder />
            <EffectLibrary />
          </TabsContent>
        </Tabs>
      </div>
      <ExportDialog
        open={isExportOpen}
        onOpenChange={setIsExportOpen}
        duration={effectData?.subEffects[0]?.length ?? 2}
      />
      <Dialog open={isSaveAsOpen} onOpenChange={setIsSaveAsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Effect As</DialogTitle>
            <DialogDescription>
              Create a new .eff file in the project effect folder.
              <span className="mt-1 block text-xs text-muted-foreground/70">
                .eff files contain effect definitions (keyframes, blend modes, geometry). Particle data (.par) is saved separately as a JSON sidecar.
              </span>
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
