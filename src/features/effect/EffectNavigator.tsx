import { Button } from "@/components/ui/button";
import { SidebarContent, SidebarHeader } from "@/components/ui/sidebar";
import { listEffects, loadEffect } from "@/commands/effect";
import {
  effectDataAtom,
  effectDirtyAtom,
  selectedEffectAtom,
  selectedFrameIndexAtom,
  selectedSubEffectIndexAtom,
} from "@/store/effect";
import { currentProjectAtom } from "@/store/project";
import { Input } from "@/components/ui/input";
import { useAtom, useAtomValue } from "jotai";
import React from "react";
import { useEffect, useMemo, useState } from "react";

export default function EffectNavigator() {
  const currentProject = useAtomValue(currentProjectAtom);
  const [, setSelectedEffect] = useAtom(selectedEffectAtom);
  const [, setEffectData] = useAtom(effectDataAtom);
  const [isDirty, setDirty] = useAtom(effectDirtyAtom);
  const [, setSelectedSubEffect] = useAtom(selectedSubEffectIndexAtom);
  const [, setSelectedFrame] = useAtom(selectedFrameIndexAtom);
  const [effectFiles, setEffectFiles] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [pendingEffect, setPendingEffect] = useState<string | null>(null);

  useEffect(() => {
    async function fetchEffects() {
      if (!currentProject) {
        setEffectFiles([]);
        return;
      }

      const files = await listEffects(currentProject.id);
      setEffectFiles(files);
    }

    fetchEffects();
  }, [currentProject]);

  const filteredEffects = useMemo(() => {
    if (!query) {
      return effectFiles;
    }

    return effectFiles.filter((name) =>
      name.toLowerCase().includes(query.toLowerCase())
    );
  }, [effectFiles, query]);

  async function selectEffect(effectName: string) {
    if (!currentProject) {
      return;
    }

    if (isDirty) {
      setPendingEffect(effectName);
      return;
    }

    await loadEffectData(effectName);
  }

  async function loadEffectData(effectName: string) {
    if (!currentProject) {
      return;
    }

    setSelectedEffect(effectName);
    const data = await loadEffect(currentProject.id, effectName);
    setEffectData(data);
    setSelectedSubEffect(data.subEffects.length > 0 ? 0 : null);
    setSelectedFrame(0);
    setDirty(false);
    setPendingEffect(null);
  }

  async function confirmDiscard() {
    if (!pendingEffect) {
      return;
    }

    await loadEffectData(pendingEffect);
  }

  function cancelDiscard() {
    setPendingEffect(null);
  }

  return (
    <SidebarHeader>
      <SidebarContent>
        <span className="text-md font-semibold">Effects</span>
        <span className="text-xs text-muted-foreground">Search</span>
        <Input
          id="effect-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="mt-2 flex max-h-96 flex-col gap-1 overflow-auto">
          {filteredEffects.length === 0 ? (
            <div className="text-xs text-muted-foreground">No effects found.</div>
          ) : (
            filteredEffects.map((name) => (
              <Button
                key={name}
                variant="link"
                className="justify-start text-sm"
                onClick={() => selectEffect(name)}
              >
                {name}
              </Button>
            ))
          )}
        </div>
        {pendingEffect && (
          <div className="mt-3 rounded-lg border border-border bg-background/80 p-3 text-xs">
            <div className="font-semibold text-foreground">Discard changes?</div>
            <div className="mt-1 text-muted-foreground">
              You have unsaved edits. Switch to {pendingEffect} anyway?
            </div>
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="destructive" onClick={confirmDiscard}>
                Discard
              </Button>
              <Button size="sm" variant="outline" onClick={cancelDiscard}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </SidebarContent>
    </SidebarHeader>
  );
}
