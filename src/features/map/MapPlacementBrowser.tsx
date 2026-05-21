import { getMapPlacementSummary, queryMapPlacements } from "@/commands/map";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LatestOnly } from "@/lib/latestOnly";
import { currentProjectAtom } from "@/store/project";
import { selectedMapAtom } from "@/store/map";
import {
  MapPlacementPage,
  MapPlacementRecord,
  MapSelectedTile,
  MapPlacementSummary,
} from "@/types/map";
import { useAtomValue } from "jotai";
import { Loader2, LocateFixed, MousePointer2, PanelRightClose, Search, X } from "lucide-react";
import { type Ref, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { MapPlacementOverlayFilter, MapTileBounds } from "./mapWorkbenchView";
import MapPlacementBuildingPreview from "./MapPlacementBuildingPreview";

const PAGE_SIZE = 200;
const VISIBLE_BOUNDS_QUERY_DEBOUNCE_MS = 120;
type PlacementScopeMode = "all" | "view" | "point";

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedValue(value), delayMs);
    return () => window.clearTimeout(timeout);
  }, [delayMs, value]);

  return debouncedValue;
}

function placementDisplayName(placement: MapPlacementRecord): string {
  return placement.display_name ?? placement.asset_name ?? `${placement.kind} ${placement.obj_id}`;
}

function placementRowActionLabel(placement: MapPlacementRecord): string {
  return `Select placement ${placementDisplayName(placement)}, ${placement.kind} ${placement.obj_id} at x ${placement.world_x.toFixed(2)} y ${placement.world_y.toFixed(2)}`;
}

export default function MapPlacementBrowser({
  onSelectPlacement,
  selectedPlacement,
  selectedTile,
  visibleBounds,
  onPlacementFilterChange,
  onCollapse,
  collapsed = false,
  collapseButtonRef,
}: {
  onSelectPlacement: (placement: MapPlacementRecord | null) => void;
  selectedPlacement: MapPlacementRecord | null;
  selectedTile: MapSelectedTile | null;
  visibleBounds?: MapTileBounds | null;
  onPlacementFilterChange?: (filter: MapPlacementOverlayFilter) => void;
  onCollapse?: () => void;
  collapsed?: boolean;
  collapseButtonRef?: Ref<HTMLButtonElement>;
}) {
  const currentProject = useAtomValue(currentProjectAtom);
  const selectedMap = useAtomValue(selectedMapAtom);
  const [summary, setSummary] = useState<MapPlacementSummary | null>(null);
  const [pageData, setPageData] = useState<MapPlacementPage | null>(null);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [placementType, setPlacementType] = useState<"all" | "building" | "effect">("all");
  const [page, setPage] = useState(0);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [pageLoading, setPageLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [nearMode, setNearMode] = useState<PlacementScopeMode>("all");
  const [nearX, setNearX] = useState("");
  const [nearY, setNearY] = useState("");
  const [nearRadius, setNearRadius] = useState("50");
  const summaryGuard = useRef(new LatestOnly());
  const pageGuard = useRef(new LatestOnly());

  useEffect(() => {
    setSummary(null);
    setPageData(null);
    setQuery("");
    setPlacementType("all");
    setPage(0);
    setSelectedIndex(null);
    setNearMode("all");
    setNearX("");
    setNearY("");
    setNearRadius("50");
  }, [selectedMap?.name]);

  useEffect(() => {
    setSelectedIndex(selectedPlacement?.index ?? null);
  }, [selectedPlacement?.index]);

  useEffect(() => {
    async function loadSummary() {
      if (!currentProject || !selectedMap) {
        setSummary(null);
        return;
      }
      const version = summaryGuard.current.begin();
      setSummaryLoading(true);
      try {
        const nextSummary = await getMapPlacementSummary(currentProject.id, selectedMap.name);
        if (!summaryGuard.current.isLatest(version)) {
          return;
        }
        setSummary(nextSummary);
      } finally {
        if (summaryGuard.current.isLatest(version)) {
          setSummaryLoading(false);
        }
      }
    }

    void loadSummary();
    return () => summaryGuard.current.invalidate();
  }, [currentProject, selectedMap]);

  const parsedNearX = nearX.trim() === "" ? undefined : Number(nearX);
  const parsedNearY = nearY.trim() === "" ? undefined : Number(nearY);
  const parsedNearRadius = nearRadius.trim() === "" ? undefined : Number(nearRadius);
  const visibleQueryBounds = useMemo(
    () => normalizeVisibleBounds(visibleBounds),
    [visibleBounds?.minX, visibleBounds?.minY, visibleBounds?.maxX, visibleBounds?.maxY],
  );
  const queryVisibleBounds = useDebouncedValue(
    visibleQueryBounds,
    VISIBLE_BOUNDS_QUERY_DEBOUNCE_MS,
  );
  const queryVisibleBoundsKey = queryVisibleBounds
    ? `${queryVisibleBounds.minX}:${queryVisibleBounds.minY}:${queryVisibleBounds.maxX}:${queryVisibleBounds.maxY}`
    : "";
  const visibleBoundsKey = visibleQueryBounds
    ? `${visibleQueryBounds.minX}:${visibleQueryBounds.minY}:${visibleQueryBounds.maxX}:${visibleQueryBounds.maxY}`
    : "";
  const visibleBoundsLabel = visibleQueryBounds
    ? formatVisibleBoundsLabel(visibleQueryBounds)
    : null;
  const nearEnabled = nearMode !== "all";
  const activeVisibleBoundsKey = nearEnabled ? queryVisibleBoundsKey : "";
  const activeViewportMinX = nearEnabled ? queryVisibleBounds?.minX : undefined;
  const activeViewportMinY = nearEnabled ? queryVisibleBounds?.minY : undefined;
  const activeViewportMaxX = nearEnabled ? queryVisibleBounds?.maxX : undefined;
  const activeViewportMaxY = nearEnabled ? queryVisibleBounds?.maxY : undefined;
  const nearPointInputStarted = nearX.trim() !== "" || nearY.trim() !== "";
  const manualNearArgsValid = Number.isFinite(parsedNearX)
    && Number.isFinite(parsedNearY)
    && Number.isFinite(parsedNearRadius);
  const nearPointRefinementActive = nearEnabled && nearPointInputStarted && manualNearArgsValid;
  const nearPointDraftInvalid = nearEnabled && nearPointInputStarted && !manualNearArgsValid;
  const nearArgsValid = nearMode === "all"
    || (
      nearMode === "view"
        ? Boolean(visibleQueryBounds) && !nearPointDraftInvalid
        : manualNearArgsValid
    );
  const queryNearArgsValid = nearMode === "all"
    || (
      nearMode === "view"
        ? queryVisibleBoundsKey !== "" && queryVisibleBoundsKey === visibleBoundsKey && !nearPointDraftInvalid
        : manualNearArgsValid
    );
  const selectedTileLabel = selectedTile ? `${selectedTile.x}, ${selectedTile.y}` : null;
  const nearSearchHasChanges = nearMode !== "all"
    || nearX.trim() !== ""
    || nearY.trim() !== ""
    || nearRadius.trim() !== "50";
  const useVisibleBounds = nearEnabled && Boolean(visibleQueryBounds);

  useEffect(() => {
    onPlacementFilterChange?.({
      query: deferredQuery.trim(),
      placementType,
      nearEnabled,
      nearX: nearPointRefinementActive ? parsedNearX : undefined,
      nearY: nearPointRefinementActive ? parsedNearY : undefined,
      nearRadius: nearPointRefinementActive
        ? parsedNearRadius
        : undefined,
      useVisibleBounds,
      valid: nearArgsValid,
    });
  }, [
    deferredQuery,
    manualNearArgsValid,
    nearArgsValid,
    nearEnabled,
    nearMode,
    nearPointRefinementActive,
    onPlacementFilterChange,
    parsedNearRadius,
    parsedNearX,
    parsedNearY,
    placementType,
    useVisibleBounds,
  ]);

  useEffect(() => {
    if (collapsed) {
      return;
    }
    setPage(0);
  }, [
    collapsed,
    deferredQuery,
    nearMode,
    nearRadius,
    nearX,
    nearY,
    placementType,
    selectedMap?.name,
    activeVisibleBoundsKey,
  ]);

  function setNearSearchAnchor(x: number | string, y: number | string) {
    setNearMode(visibleQueryBounds ? "view" : "point");
    setNearX(String(x));
    setNearY(String(y));
  }

  useEffect(() => {
    if (collapsed) {
      pageGuard.current.invalidate();
      setPageLoading(false);
      return;
    }

    async function loadPage() {
      if (!currentProject || !selectedMap) {
        setPageData(null);
        return;
      }
      if (!queryNearArgsValid) {
        setPageLoading(false);
        setPageData({
          total: 0,
          offset: 0,
          limit: PAGE_SIZE,
          items: [],
        });
        return;
      }

      const version = pageGuard.current.begin();
      setPageLoading(true);
      try {
        const commonArgs = [
          currentProject.id,
          selectedMap.name,
          deferredQuery.trim() || undefined,
          placementType,
          nearPointRefinementActive ? parsedNearX : undefined,
          nearPointRefinementActive ? parsedNearY : undefined,
          nearPointRefinementActive ? parsedNearRadius : undefined,
          page * PAGE_SIZE,
          PAGE_SIZE,
        ] as const;
        const nextPage = activeViewportMinX != null
          && activeViewportMinY != null
          && activeViewportMaxX != null
          && activeViewportMaxY != null
          ? await queryMapPlacements(
            ...commonArgs,
            activeViewportMinX,
            activeViewportMinY,
            activeViewportMaxX,
            activeViewportMaxY,
          )
          : await queryMapPlacements(...commonArgs);
        if (!pageGuard.current.isLatest(version)) {
          return;
        }
        setPageData(nextPage);

      } finally {
        if (pageGuard.current.isLatest(version)) {
          setPageLoading(false);
        }
      }
    }

    void loadPage();
    return () => pageGuard.current.invalidate();
  }, [
    currentProject,
    deferredQuery,
    nearMode,
    nearPointRefinementActive,
    page,
    parsedNearRadius,
    parsedNearX,
    parsedNearY,
    placementType,
    queryNearArgsValid,
    selectedMap,
    activeViewportMinX,
    activeViewportMinY,
    activeViewportMaxX,
    activeViewportMaxY,
    collapsed,
  ]);

  const pageCount = useMemo(() => {
    if (!pageData) {
      return 0;
    }
    return Math.max(1, Math.ceil(pageData.total / PAGE_SIZE));
  }, [pageData]);
  const pageRangeLabel = pageData
    ? pageData.total === 0
      ? "0 of 0"
      : `${pageData.offset + 1}-${Math.min(pageData.offset + pageData.items.length, pageData.total)} of ${pageData.total}`
    : "No results";

  if (!selectedMap) {
    return null;
  }

  return (
    <div className="h-full rounded-lg border bg-background shadow-sm">
      <div className="flex h-full flex-col">
        <div className="border-b p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-semibold">Placements</div>
              <div className="text-xs text-muted-foreground">
                Streamed from the Rust parser in small pages
              </div>
            </div>
            <div className="flex items-center gap-1">
              {(summaryLoading || pageLoading) && (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              )}
              {onCollapse && (
                <Button
                  ref={collapseButtonRef}
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 gap-1 px-2 text-xs"
                  aria-label="Collapse placements panel"
                  aria-controls="map-placement-browser-pane"
                  aria-expanded={!collapsed}
                  title="Collapse placements panel"
                  onClick={onCollapse}
                >
                  <PanelRightClose className="h-3.5 w-3.5" />
                  <span>Collapse</span>
                </Button>
              )}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-[1fr_7rem] gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by id, name, file..."
                className="h-8 pl-7 text-xs"
              />
            </div>
            <Select
              value={placementType}
              onValueChange={(value) => setPlacementType(value as "all" | "building" | "effect")}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="building">Buildings</SelectItem>
                <SelectItem value="effect">Effects</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {selectedPlacement?.obj_type === 0 && (
            <MapPlacementBuildingPreview placement={selectedPlacement} />
          )}

          <div
            role="group"
            aria-labelledby="placement-search-area-label"
            className="mt-2 rounded border p-2"
          >
            <div className="space-y-2">
              <div id="placement-search-area-label" className="text-xs font-medium">Placement search area</div>
              <div
                data-testid="placement-search-area-tabs"
                className="grid w-full grid-cols-3 gap-1 rounded bg-muted/40 p-1"
              >
                <Button
                  type="button"
                  size="sm"
                  variant={nearMode === "all" ? "default" : "ghost"}
                  className="h-7 px-2 text-xs"
                  aria-label="Search whole map"
                  aria-pressed={nearMode === "all"}
                  onClick={() => setNearMode("all")}
                >
                  Whole map
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={nearMode === "view" ? "default" : "ghost"}
                  className="h-7 px-2 text-xs"
                  aria-label="Search visible map view"
                  aria-pressed={nearMode === "view"}
                  aria-disabled={!visibleQueryBounds}
                  title={visibleQueryBounds
                    ? "Follow the visible map view"
                    : "Pan or zoom the map to establish a visible view"}
                  onClick={() => {
                    setNearMode("view");
                    setNearX("");
                    setNearY("");
                  }}
                >
                  Visible view
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={nearMode === "point" ? "default" : "ghost"}
                  className="h-7 px-2 text-xs"
                  aria-label="Search point radius"
                  aria-pressed={nearMode === "point"}
                  onClick={() => setNearMode("point")}
                >
                  Point radius
                </Button>
              </div>
            </div>

            <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span>
                {nearMode === "all"
                  ? "Whole map"
                  : nearMode === "view"
                    ? visibleBoundsLabel
                      ? nearPointRefinementActive
                        ? `Visible view ${visibleBoundsLabel} + point radius`
                        : `Visible view ${visibleBoundsLabel}`
                      : "Visible view"
                    : visibleBoundsLabel
                      ? "Point radius inside visible view"
                      : "Point radius"}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 shrink-0 text-xs"
                aria-label="Clear near search"
                disabled={!nearSearchHasChanges}
                onClick={() => {
                  setNearMode("all");
                  setNearX("");
                  setNearY("");
                  setNearRadius("50");
                }}
              >
                <X className="h-3.5 w-3.5" />
                Clear
              </Button>
            </div>

            <div className="mt-2 grid grid-cols-3 gap-2">
              <label className="space-y-1">
                <span className="block text-[10px] font-medium uppercase text-muted-foreground">Point X</span>
                <Input
                  aria-label="Point X"
                  value={nearX}
                  onChange={(event) => setNearX(event.target.value)}
                  placeholder="x"
                  className="h-8 text-xs"
                  disabled={nearMode === "all"}
                />
              </label>
              <label className="space-y-1">
                <span className="block text-[10px] font-medium uppercase text-muted-foreground">Point Y</span>
                <Input
                  aria-label="Point Y"
                  value={nearY}
                  onChange={(event) => setNearY(event.target.value)}
                  placeholder="y"
                  className="h-8 text-xs"
                  disabled={nearMode === "all"}
                />
              </label>
              <label className="space-y-1">
                <span className="block text-[10px] font-medium uppercase text-muted-foreground">Point radius</span>
                <Input
                  aria-label="Point radius"
                  value={nearRadius}
                  onChange={(event) => setNearRadius(event.target.value)}
                  placeholder="radius"
                  className="h-8 text-xs"
                  disabled={nearMode === "all"}
                />
              </label>
            </div>

            {selectedTileLabel && (
              <div className="mt-2 truncate font-mono text-[11px] text-muted-foreground">
                Tile {selectedTileLabel}
              </div>
            )}

            {nearMode === "point" && visibleBoundsLabel && (
              <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                Visible view {visibleBoundsLabel}
              </div>
            )}

            <div className="mt-2 grid grid-cols-2 gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 justify-start px-2 text-xs"
                disabled={!selectedPlacement}
                aria-label="Use selected object"
                onClick={() => {
                  if (!selectedPlacement) {
                    return;
                  }
                  setNearSearchAnchor(
                    selectedPlacement.world_x.toFixed(2),
                    selectedPlacement.world_y.toFixed(2),
                  );
                }}
              >
                <LocateFixed className="h-3.5 w-3.5" />
                Selected object
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 justify-start px-2 text-xs"
                disabled={!selectedTile}
                aria-label={selectedTileLabel ? `Use selected tile ${selectedTileLabel}` : "Use selected tile"}
                onClick={() => {
                  if (!selectedTile) {
                    return;
                  }
                  setNearSearchAnchor(selectedTile.x, selectedTile.y);
                }}
              >
                <MousePointer2 className="h-3.5 w-3.5" />
                Selected tile
              </Button>
            </div>

            {nearMode === "view" && !visibleQueryBounds && (
              <div className="mt-2 text-[11px] text-destructive">
                Pan or zoom the map to establish a visible view.
              </div>
            )}

            {nearMode !== "all" && (nearMode === "point" || nearPointDraftInvalid) && !nearArgsValid && (
              <div className="mt-2 text-[11px] text-destructive">
                Enter numeric x, y, and radius values to search around a point.
              </div>
            )}
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <div className="rounded border px-2 py-1.5">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Total</div>
              <div className="font-medium">{summary?.total ?? "..."}</div>
            </div>
            <div className="rounded border px-2 py-1.5">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Buildings</div>
              <div className="font-medium">{summary?.building_count ?? "..."}</div>
            </div>
            <div className="rounded border px-2 py-1.5">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Effects</div>
              <div className="font-medium">{summary?.effect_count ?? "..."}</div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-b px-3 py-2 text-xs text-muted-foreground">
          <div>
            {pageRangeLabel}
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={page <= 0 || pageLoading}
              onClick={() => setPage((current) => Math.max(0, current - 1))}
            >
              Prev
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={!pageData || (page + 1) >= pageCount || pageLoading}
              onClick={() => setPage((current) => current + 1)}
            >
              Next
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {!pageLoading && pageData?.items.length === 0 && (
            <div className="p-4 text-sm text-muted-foreground">
              No placements matched this filter.
            </div>
          )}

          <div className="divide-y">
            {pageData?.items.map((placement) => {
              const isSelected = placement.index === selectedIndex;
              const actionLabel = placementRowActionLabel(placement);
              return (
                <button
                  key={placement.index}
                  type="button"
                  className={`w-full px-3 py-2 text-left transition-colors hover:bg-accent/60 ${
                    isSelected ? "bg-accent" : ""
                  }`}
                  onClick={() => {
                    setSelectedIndex(placement.index);
                    onSelectPlacement(placement);
                  }}
                  aria-label={actionLabel}
                  title={actionLabel}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {placementDisplayName(placement)}
                      </div>
                      <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                        {placement.asset_name ?? "unresolved"}
                      </div>
                    </div>
                    <div className="shrink-0 rounded border px-1.5 py-0.5 text-[11px] uppercase text-muted-foreground">
                      {placement.kind}
                    </div>
                  </div>
                  <div className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[11px] text-muted-foreground">
                    <div>idx {placement.index}</div>
                    <div>id {placement.obj_id}</div>
                    <div>x {placement.world_x.toFixed(2)}</div>
                    <div>y {placement.world_y.toFixed(2)}</div>
                    <div>z {placement.world_z.toFixed(2)}</div>
                    <div>{placement.distance != null ? `d ${placement.distance.toFixed(2)}` : `yaw ${placement.yaw_angle}`}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function normalizeVisibleBounds(bounds: MapTileBounds | null | undefined): MapTileBounds | null {
  if (!bounds) {
    return null;
  }

  const minX = Math.floor(Math.min(bounds.minX, bounds.maxX));
  const minY = Math.floor(Math.min(bounds.minY, bounds.maxY));
  const maxX = Math.ceil(Math.max(bounds.minX, bounds.maxX));
  const maxY = Math.ceil(Math.max(bounds.minY, bounds.maxY));
  if (![minX, minY, maxX, maxY].every(Number.isFinite) || minX >= maxX || minY >= maxY) {
    return null;
  }

  return { minX, minY, maxX, maxY };
}

function formatVisibleBoundsLabel(bounds: MapTileBounds): string {
  return `${bounds.minX}, ${bounds.minY} to ${bounds.maxX}, ${bounds.maxY}`;
}
