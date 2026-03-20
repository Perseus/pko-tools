import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SidebarContent, SidebarHeader } from "@/components/ui/sidebar";
import { ScrollAreaVirtualizable } from "@/components/ui/scroll-area-virtualizable";
import { loadMagicSingleTable, loadMagicGroupTable } from "@/commands/effect-v2";
import { listEffects, listParFiles } from "@/commands/effect";
import { magicSingleTableAtom, selectedMagicEffectAtom, effectV2SelectionAtom } from "@/store/effect-v2";
import { currentProjectAtom } from "@/store/project";
import { EffectV2ViewMode, MagicGroupTable } from "@/types/effect-v2";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { LatestOnly } from "@/lib/latestOnly";
import { Wand2, Sparkles, Flame, Layers } from "lucide-react";

interface ListItem {
  id: string;
  label: string;
  icon: React.ReactNode;
}

const VIEW_MODE_LABELS: Record<EffectV2ViewMode, string> = {
  magic_group: "MagicGroup",
  magic_one: "MagicOne",
  effect: "Effects",
  particle: "Particles",
};

const VIEW_MODE_ICONS: Record<EffectV2ViewMode, React.ReactNode> = {
  magic_group: <Layers className="h-3.5 w-3.5 shrink-0" />,
  magic_one: <Wand2 className="h-3.5 w-3.5 shrink-0" />,
  effect: <Sparkles className="h-3.5 w-3.5 shrink-0" />,
  particle: <Flame className="h-3.5 w-3.5 shrink-0" />,
};

export default function EffectV2Navigator() {
  const currentProject = useAtomValue(currentProjectAtom);
  const [table, setTable] = useAtom(magicSingleTableAtom);
  const setSelectedEffect = useSetAtom(selectedMagicEffectAtom);
  const setSelection = useSetAtom(effectV2SelectionAtom);
  const [viewMode, setViewMode] = useState<EffectV2ViewMode>("magic_one");
  const [query, setQuery] = useState("");
  const loadGuard = useRef(new LatestOnly());
  const parentRef = React.useRef<HTMLDivElement>(null);

  // File lists for effect/particle modes
  const [effFileList, setEffFileList] = useState<string[]>([]);
  const [parFileList, setParFileList] = useState<string[]>([]);
  const [groupTable, setGroupTable] = useState<MagicGroupTable | null>(null);

  // Load MagicSingle table (used by magic_one and magic_group modes for cross-linking)
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

  // Load file lists / tables when switching modes
  useEffect(() => {
    if (!currentProject) return;

    if (viewMode === "effect" && effFileList.length === 0) {
      listEffects(currentProject.id).then(setEffFileList).catch(console.error);
    }
    if (viewMode === "particle" && parFileList.length === 0) {
      listParFiles(currentProject.id).then(setParFileList).catch(console.error);
    }
    if (viewMode === "magic_group" && !groupTable) {
      loadMagicGroupTable(currentProject.id).then(setGroupTable).catch(console.error);
    }
  }, [viewMode, currentProject]);

  // Build list items based on view mode
  const allItems: ListItem[] = useMemo(() => {
    switch (viewMode) {
      case "magic_one":
        return (table?.entries ?? []).map((e) => ({
          id: String(e.id),
          label: `${e.id}: ${e.name}`,
          icon: VIEW_MODE_ICONS.magic_one,
        }));
      case "magic_group":
        return (groupTable?.entries ?? []).map((e) => ({
          id: String(e.id),
          label: `${e.id}: ${e.name}`,
          icon: VIEW_MODE_ICONS.magic_group,
        }));
      case "effect":
        return effFileList.map((f) => ({
          id: f,
          label: f,
          icon: VIEW_MODE_ICONS.effect,
        }));
      case "particle":
        return parFileList.map((f) => ({
          id: f,
          label: f,
          icon: VIEW_MODE_ICONS.particle,
        }));
    }
  }, [viewMode, table, effFileList, parFileList, groupTable]);

  const filteredItems = useMemo(() => {
    if (!query) return allItems;
    const q = query.toLowerCase();
    return allItems.filter((item) => item.label.toLowerCase().includes(q));
  }, [allItems, query]);

  const rowVirtualizer = useVirtualizer({
    count: filteredItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40,
  });

  function handleSelect(item: ListItem) {
    switch (viewMode) {
      case "magic_one": {
        const entry = table?.entries.find((e) => String(e.id) === item.id);
        if (entry) {
          setSelectedEffect(entry);
          setSelection({ type: "magic_one", entry });
        }
        break;
      }
      case "magic_group": {
        const entry = groupTable?.entries.find((e) => String(e.id) === item.id);
        if (entry) {
          setSelectedEffect(null);
          setSelection({ type: "magic_group", entry });
        }
        break;
      }
      case "effect":
        setSelectedEffect(null);
        setSelection({ type: "effect", fileName: item.id });
        break;
      case "particle":
        setSelectedEffect(null);
        setSelection({ type: "particle", fileName: item.id });
        break;
    }
  }

  // Allow external code to switch view mode (for cross-linking)
  useEffect(() => {
    (window as any).__effectV2SetViewMode = setViewMode;
    return () => { delete (window as any).__effectV2SetViewMode; };
  }, []);

  const countLabel = viewMode === "magic_group" ? "groups" :
    viewMode === "magic_one" ? "entries" :
    viewMode === "effect" ? "effects" : "particles";

  return (
    <SidebarHeader>
      <SidebarContent>
        <span className="text-md font-semibold">Effects V2</span>

        <select
          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          value={viewMode}
          onChange={(e) => {
            setViewMode(e.target.value as EffectV2ViewMode);
            setQuery("");
          }}
        >
          {(Object.keys(VIEW_MODE_LABELS) as EffectV2ViewMode[]).map((mode) => (
            <option key={mode} value={mode}>
              {VIEW_MODE_LABELS[mode]}
            </option>
          ))}
        </select>

        <Input
          id="effect-v2-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search..."
        />
        <div className="text-xs text-muted-foreground">
          {filteredItems.length} {countLabel}
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
              const item = filteredItems[virtualRow.index];
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
                    className="text-sm w-full justify-start truncate gap-2"
                    variant="link"
                    onClick={() => handleSelect(item)}
                  >
                    {item.icon}
                    {item.label}
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
