import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SidebarContent, SidebarHeader } from "@/components/ui/sidebar";
import { ScrollAreaVirtualizable } from "@/components/ui/scroll-area-virtualizable";
import { loadMagicSingleTable } from "@/commands/effect-v2";
import { magicSingleTableAtom, selectedMagicEffectAtom } from "@/store/effect-v2";
import { currentProjectAtom } from "@/store/project";
import { MagicSingleEntry } from "@/types/effect-v2";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { LatestOnly } from "@/lib/latestOnly";

export default function EffectV2Navigator() {
  const currentProject = useAtomValue(currentProjectAtom);
  const [table, setTable] = useAtom(magicSingleTableAtom);
  const setSelectedEffect = useSetAtom(selectedMagicEffectAtom);
  const [query, setQuery] = useState("");
  const loadGuard = useRef(new LatestOnly());
  const parentRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function fetchTable() {
      const ver = loadGuard.current.begin();
      if (!currentProject) {
        setTable(null);
        return;
      }
      try {
        const result = await loadMagicSingleTable(currentProject.id);
        if (!loadGuard.current.isLatest(ver)) return;
        setTable(result);
      } catch (err) {
        if (loadGuard.current.isLatest(ver)) {
          console.error("Failed to load MagicSingleinfo:", err);
          setTable(null);
        }
      }
    }
    fetchTable();
    return () => {
      loadGuard.current.invalidate();
    };
  }, [currentProject]);

  const entries = table?.entries ?? [];

  const filteredEntries = useMemo(() => {
    if (!query) return entries;
    const q = query.toLowerCase();
    return entries.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.id.toString().includes(q) ||
        e.models.some((m) => m.toLowerCase().includes(q))
    );
  }, [entries, query]);

  const rowVirtualizer = useVirtualizer({
    count: filteredEntries.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
  });

  function selectEffect(entry: MagicSingleEntry) {
    setSelectedEffect(entry);
  }

  return (
    <SidebarHeader>
      <SidebarContent>
        <span className="text-md font-semibold">Effects V2</span>
        <label className="text-xs text-muted-foreground">Search</label>
        <Input
          id="effect-v2-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Name, ID, or .eff file..."
        />
        <div className="text-xs text-muted-foreground">
          {filteredEntries.length} effects
        </div>

        <ScrollAreaVirtualizable
          className="h-96 w-full border overflow-auto"
          ref={parentRef}
        >
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const entry = filteredEntries[virtualRow.index];
              return (
                <div
                  key={virtualRow.index}
                  style={{
                    position: "absolute",
                    top: virtualRow.start,
                    left: 0,
                    width: "100%",
                    height: virtualRow.size,
                  }}
                >
                  <Button
                    className="text-sm w-full justify-start truncate"
                    variant="link"
                    onClick={() => selectEffect(entry)}
                  >
                    {entry.id}: {entry.name}
                  </Button>
                </div>
              );
            })}
          </div>
        </ScrollAreaVirtualizable>
      </SidebarContent>
    </SidebarHeader>
  );
}
