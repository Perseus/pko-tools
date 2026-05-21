import { currentProjectAtom } from "@/store/project";
import { useAtom, useAtomValue } from "jotai";
import { useVirtualizer, Virtualizer } from "@tanstack/react-virtual";
import React, { useEffect, useRef, useState } from "react";
import { ScrollAreaVirtualizable } from "@/components/ui/scroll-area-virtualizable";
import { SidebarHeader } from "@/components/ui/sidebar";
import { MapEntry } from "@/types/map";
import { getMapList } from "@/commands/map";
import { mapStagedEditStateAtom, selectedMapAtom } from "@/store/map";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Map as MapIcon,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { LatestOnly } from "@/lib/latestOnly";

type MapNavigatorProps = {
  compact?: boolean;
  overlay?: boolean;
  onExpand?: () => void;
  onCollapse?: () => void;
};

function formatMapSidecars(map: MapEntry): string {
  const sidecars = [
    map.has_obj ? "OBJ" : null,
    map.has_rbo ? "RBO" : null,
  ].filter(Boolean);

  if (sidecars.length === 0) {
    return "no OBJ or RBO sidecars";
  }

  if (sidecars.length === 1) {
    return `${sidecars[0]} available`;
  }

  return `${sidecars.slice(0, -1).join(", ")} and ${sidecars.at(-1)} available`;
}

function formatMapRowActionLabel(map: MapEntry): string {
  return `Open map ${map.display_name}, ${map.width} by ${map.height}, ${formatMapSidecars(map)}`;
}

export default function MapNavigator({
  compact = false,
  overlay = false,
  onExpand,
  onCollapse,
}: MapNavigatorProps = {}) {
  const [maps, setMaps] = useState<MapEntry[]>([]);
  const [filteredMaps, setFilteredMaps] = useState<MapEntry[]>([]);
  const currentProject = useAtomValue(currentProjectAtom);
  const [stagedEditState, setStagedEditState] = useAtom(mapStagedEditStateAtom);
  const [query, setQuery] = useState("");
  const [selectedMap, setSelectedMap] = useAtom(selectedMapAtom);
  const [pendingMapSwitch, setPendingMapSwitch] = useState<MapEntry | null>(null);
  const listRequestGuard = useRef(new LatestOnly());

  useEffect(() => {
    async function fetchMaps() {
      const requestVersion = listRequestGuard.current.begin();
      if (!currentProject) {
        setMaps([]);
        return;
      }

      const mapList = await getMapList(currentProject.id);
      if (!listRequestGuard.current.isLatest(requestVersion)) {
        return;
      }
      setMaps(mapList);
    }
    fetchMaps();

    return () => {
      listRequestGuard.current.invalidate();
    };
  }, [currentProject]);

  useEffect(() => {
    setFilteredMaps(
      maps.filter((m) =>
        m.name.toLowerCase().includes(query.toLowerCase()) ||
        m.display_name.toLowerCase().includes(query.toLowerCase())
      )
    );
  }, [query, maps]);

  const parentRef = React.useRef(null);
  const rowVirtualizer: Virtualizer<Element, Element> = useVirtualizer({
    count: filteredMaps.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 48,
    overscan: 5,
  });

  const selectedMapHasStagedEdits = Boolean(
    stagedEditState
    && selectedMap
    && stagedEditState.mapName === selectedMap.name
    && stagedEditState.count > 0,
  );

  function selectMap(map: MapEntry) {
    if (
      selectedMapHasStagedEdits
      && selectedMap?.name !== map.name
    ) {
      setPendingMapSwitch(map);
      return;
    }

    loadMapData(map);
  }

  function loadMapData(map: MapEntry, options: { discardStagedEdits?: boolean } = {}) {
    if (!currentProject) return;
    setPendingMapSwitch(null);
    if (options.discardStagedEdits) {
      setStagedEditState(null);
    }
    setSelectedMap(map);
  }

  function confirmDiscardAndSwitchMap() {
    if (!pendingMapSwitch) {
      return;
    }

    loadMapData(pendingMapSwitch, { discardStagedEdits: true });
  }

  function cancelPendingMapSwitch() {
    setPendingMapSwitch(null);
  }

  useEffect(() => {
    if (!selectedMapHasStagedEdits) {
      setPendingMapSwitch(null);
    }
  }, [selectedMapHasStagedEdits]);

  function handleNavigatorKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (!overlay || event.key !== "Escape" || !onCollapse) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onCollapse();
  }

  if (compact) {
    const selectedMapName = selectedMap?.display_name ?? "Maps";
    const stagedEditSummary = selectedMapHasStagedEdits && stagedEditState
      ? `${stagedEditState.summary} staged`
      : null;
    const railLabel = selectedMap
      ? `Maps navigator. Selected map ${selectedMap.display_name}. ${maps.length} maps loaded.${stagedEditSummary ? ` ${stagedEditSummary}.` : ""}`
      : `Maps navigator. ${maps.length} maps loaded.`;
    const openLabel = selectedMap
      ? `Open maps navigator, selected map ${selectedMap.display_name}${stagedEditSummary ? `, ${stagedEditSummary}` : ""}`
      : "Open maps navigator";

    return (
      <div
        data-testid="map-navigator-rail"
        role="navigation"
        aria-label={railLabel}
        className="flex h-full w-12 shrink-0 flex-col items-center gap-2 border-l bg-sidebar p-2 text-sidebar-foreground"
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-10 w-10 flex-col gap-0.5 px-0 py-1 text-[10px] leading-none"
          aria-label={openLabel}
          aria-controls="map-navigator-panel"
          aria-expanded="false"
          title={openLabel}
          onClick={onExpand}
        >
          <PanelRightOpen className="h-4 w-4" />
          <span
            data-testid="map-navigator-rail-open-label"
            className="text-[10px] leading-none"
          >
            Open
          </span>
        </Button>
        <div
          className="flex h-8 w-8 items-center justify-center rounded border border-sidebar-border bg-sidebar-accent text-sidebar-foreground"
          aria-hidden="true"
        >
          <MapIcon className="h-4 w-4" />
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
          <div
            className="max-h-full overflow-hidden text-[11px] font-medium leading-none text-sidebar-foreground/80"
            style={{ writingMode: "vertical-rl" }}
          >
            {selectedMapName}
          </div>
        </div>
        <div
          className="text-[10px] tabular-nums text-muted-foreground"
          aria-label={`${maps.length} maps loaded`}
        >
          {maps.length}
        </div>
        {stagedEditSummary && stagedEditState && (
          <div
            data-testid="map-navigator-staged-edit-badge"
            className="flex h-5 min-w-5 items-center justify-center rounded border border-amber-300 bg-amber-50 px-1 text-[10px] font-semibold tabular-nums text-amber-950"
            aria-label={stagedEditSummary}
            title={stagedEditSummary}
          >
            {stagedEditState.count}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      id="map-navigator-panel"
      data-testid="map-navigator-panel"
      role="navigation"
      aria-label="Maps navigator"
      onKeyDownCapture={handleNavigatorKeyDown}
      className={overlay
        ? "fixed bottom-0 right-0 top-0 z-40 flex min-h-0 w-72 max-w-[calc(100vw-3rem)] flex-col border-l bg-sidebar text-sidebar-foreground shadow-xl"
        : "flex h-full min-h-0 flex-col"}
    >
      <SidebarHeader className="p-2 border-b">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">Maps</h3>
            <span className="text-xs text-muted-foreground">
              {maps.length} maps
            </span>
          </div>
          {selectedMap && onCollapse && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 gap-1 px-2 text-xs"
              aria-label="Collapse maps navigator"
              title="Collapse maps navigator"
              onClick={onCollapse}
            >
              <PanelRightClose className="h-3.5 w-3.5" />
              <span>Collapse</span>
            </Button>
          )}
        </div>
        <Input
          placeholder="Search maps..."
          className="h-7 text-xs"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {pendingMapSwitch && selectedMap && stagedEditState && (
          <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-950">
            <div className="font-semibold">Discard staged edits?</div>
            <div className="mt-1">
              You have {stagedEditState.summary} staged for {selectedMap.display_name}.
            </div>
            <div className="mt-1 text-amber-800">
              Switch to {pendingMapSwitch.display_name} anyway?
            </div>
            <div className="mt-2 flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="destructive"
                className="h-7 text-xs"
                onClick={confirmDiscardAndSwitchMap}
              >
                Discard
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={cancelPendingMapSwitch}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </SidebarHeader>

      <ScrollAreaVirtualizable ref={parentRef} className="flex-1">
        <div
          className="relative w-full"
          style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const map = filteredMaps[virtualRow.index];
            const isSelected = selectedMap?.name === map.name;
            const mapRowLabel = formatMapRowActionLabel(map);

            return (
              <button
                type="button"
                key={map.name}
                className={`absolute left-0 top-0 w-full px-2 py-1.5 text-left text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                  isSelected ? "bg-accent" : ""
                }`}
                style={{
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                onClick={() => selectMap(map)}
                aria-current={isSelected ? "true" : undefined}
                aria-label={mapRowLabel}
                title={mapRowLabel}
              >
                <div className="font-medium truncate">{map.display_name}</div>
                <div className="text-muted-foreground flex gap-2">
                  <span>{map.width}x{map.height}</span>
                  {map.has_obj && <span>obj</span>}
                  {map.has_rbo && <span>rbo</span>}
                </div>
              </button>
            );
          })}
        </div>
      </ScrollAreaVirtualizable>
    </div>
  );
}
