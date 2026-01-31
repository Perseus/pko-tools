import { Button } from "@/components/ui/button";
import { SidebarContent, SidebarHeader } from "@/components/ui/sidebar";
import { listEffects, loadEffect } from "@/commands/effect";
import { effectDataAtom, selectedEffectAtom } from "@/store/effect";
import { currentProjectAtom } from "@/store/project";
import { Input } from "@/components/ui/input";
import { useAtom, useAtomValue } from "jotai";
import { useEffect, useMemo, useState } from "react";

export default function EffectNavigator() {
  const currentProject = useAtomValue(currentProjectAtom);
  const [, setSelectedEffect] = useAtom(selectedEffectAtom);
  const [, setEffectData] = useAtom(effectDataAtom);
  const [effectFiles, setEffectFiles] = useState<string[]>([]);
  const [query, setQuery] = useState("");

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

    setSelectedEffect(effectName);
    const data = await loadEffect(currentProject.id, effectName);
    setEffectData(data);
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
      </SidebarContent>
    </SidebarHeader>
  );
}
