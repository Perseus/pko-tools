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
  MapPlacementSummary,
} from "@/types/map";
import { useAtomValue } from "jotai";
import { Loader2, Search } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

const PAGE_SIZE = 200;

export default function MapPlacementBrowser({
  onSelectPlacement,
  selectedPlacement,
}: {
  onSelectPlacement: (placement: MapPlacementRecord | null) => void;
  selectedPlacement: MapPlacementRecord | null;
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
  const [nearEnabled, setNearEnabled] = useState(false);
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
    setNearEnabled(false);
    setNearX("");
    setNearY("");
    setNearRadius("50");
    onSelectPlacement(null);
  }, [selectedMap?.name, onSelectPlacement]);

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

  useEffect(() => {
    setPage(0);
  }, [deferredQuery, nearEnabled, nearRadius, nearX, nearY, placementType, selectedMap?.name]);

  const parsedNearX = nearX.trim() === "" ? undefined : Number(nearX);
  const parsedNearY = nearY.trim() === "" ? undefined : Number(nearY);
  const parsedNearRadius = nearRadius.trim() === "" ? undefined : Number(nearRadius);
  const nearArgsValid = !nearEnabled || (
    Number.isFinite(parsedNearX) &&
    Number.isFinite(parsedNearY) &&
    Number.isFinite(parsedNearRadius)
  );

  useEffect(() => {
    async function loadPage() {
      if (!currentProject || !selectedMap) {
        setPageData(null);
        return;
      }
      if (!nearArgsValid) {
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
        const nextPage = await queryMapPlacements(
          currentProject.id,
          selectedMap.name,
          deferredQuery.trim() || undefined,
          placementType,
          nearEnabled ? parsedNearX : undefined,
          nearEnabled ? parsedNearY : undefined,
          nearEnabled ? parsedNearRadius : undefined,
          page * PAGE_SIZE,
          PAGE_SIZE,
        );
        if (!pageGuard.current.isLatest(version)) {
          return;
        }
        setPageData(nextPage);

        const stillSelected = nextPage.items.find((item) => item.index === selectedIndex);
        if (!stillSelected) {
          setSelectedIndex(null);
          onSelectPlacement(null);
        }
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
    nearArgsValid,
    nearEnabled,
    onSelectPlacement,
    page,
    parsedNearRadius,
    parsedNearX,
    parsedNearY,
    placementType,
    selectedIndex,
    selectedMap,
  ]);

  const pageCount = useMemo(() => {
    if (!pageData) {
      return 0;
    }
    return Math.max(1, Math.ceil(pageData.total / PAGE_SIZE));
  }, [pageData]);

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
            {(summaryLoading || pageLoading) && (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            )}
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

          <div className="mt-2 rounded border p-2">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-medium">Near search</label>
              <Button
                type="button"
                size="sm"
                variant={nearEnabled ? "default" : "outline"}
                className="h-7 text-xs"
                onClick={() => setNearEnabled((current) => !current)}
              >
                {nearEnabled ? "Enabled" : "Off"}
              </Button>
            </div>

            <div className="mt-2 grid grid-cols-3 gap-2">
              <Input
                value={nearX}
                onChange={(event) => setNearX(event.target.value)}
                placeholder="x"
                className="h-8 text-xs"
                disabled={!nearEnabled}
              />
              <Input
                value={nearY}
                onChange={(event) => setNearY(event.target.value)}
                placeholder="y"
                className="h-8 text-xs"
                disabled={!nearEnabled}
              />
              <Input
                value={nearRadius}
                onChange={(event) => setNearRadius(event.target.value)}
                placeholder="radius"
                className="h-8 text-xs"
                disabled={!nearEnabled}
              />
            </div>

            <div className="mt-2 flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={!selectedPlacement}
                onClick={() => {
                  if (!selectedPlacement) {
                    return;
                  }
                  setNearEnabled(true);
                  setNearX(selectedPlacement.world_x.toFixed(2));
                  setNearY(selectedPlacement.world_y.toFixed(2));
                }}
              >
                Use Selected
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => {
                  setNearEnabled(false);
                  setNearX("");
                  setNearY("");
                  setNearRadius("50");
                }}
              >
                Clear
              </Button>
            </div>

            {nearEnabled && !nearArgsValid && (
              <div className="mt-2 text-[11px] text-destructive">
                Enter numeric x, y, and radius values to run a near search.
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
            {pageData
              ? `${pageData.offset + 1}-${Math.min(pageData.offset + pageData.items.length, pageData.total)} of ${pageData.total}`
              : "No results"}
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
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {placement.display_name ?? placement.asset_name ?? `${placement.kind} ${placement.obj_id}`}
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
