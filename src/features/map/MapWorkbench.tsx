import { modLabel } from "@/lib/platform";
import { useAtomValue } from "jotai";
import {
  KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { selectedMapAtom } from "@/store/map";
import MapPlacementBrowser from "./MapPlacementBrowser";
import MapChunkedWorkbench from "./MapChunkedWorkbench";
import { Maximize2, PanelRightOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MapPlacementRecord, MapSelectedTile } from "@/types/map";
import type { MapPlacementOverlayFilter, MapTileBounds } from "./mapWorkbenchView";

const PLACEMENT_PANEL_WIDTH_PX = 320;
const PLACEMENT_PANEL_EDGE_GAP_PX = 12;
const PLACEMENT_PANEL_SAFE_INSET_PX = PLACEMENT_PANEL_WIDTH_PX + PLACEMENT_PANEL_EDGE_GAP_PX;
const PLACEMENT_RAIL_WIDTH_PX = 48;
const PLACEMENT_RAIL_SAFE_INSET_PX = PLACEMENT_RAIL_WIDTH_PX + PLACEMENT_PANEL_EDGE_GAP_PX;

type PlacementFocusRequest = {
  placement: MapPlacementRecord;
  nonce: number;
};

type MapScopedPlacement = {
  mapName: string;
  placement: MapPlacementRecord;
};

type MapScopedFocusRequest = {
  mapName: string;
  request: PlacementFocusRequest;
};

type MapScopedTile = {
  mapName: string;
  tile: MapSelectedTile;
};

type MapScopedBounds = {
  mapName: string;
  bounds: MapTileBounds;
};

type MapScopedPlacementUiState = {
  mapName: string;
  panelOpen: boolean;
  panelMounted: boolean;
  toolsHidden: boolean;
};

export default function MapWorkbench() {
  const selectedMap = useAtomValue(selectedMapAtom);
  const [selectedPlacementState, setSelectedPlacementState] =
    useState<MapScopedPlacement | null>(null);
  const [selectedPlacementViewState, setSelectedPlacementViewState] =
    useState<MapScopedPlacement | null>(null);
  const [placementFocusRequestState, setPlacementFocusRequestState] =
    useState<MapScopedFocusRequest | null>(null);
  const [selectedTileState, setSelectedTileState] = useState<MapScopedTile | null>(null);
  const [visibleBoundsState, setVisibleBoundsState] = useState<MapScopedBounds | null>(null);
  const [placementFilterState, setPlacementFilterState] = useState<{
    mapName: string;
    filter: MapPlacementOverlayFilter;
  } | null>(null);
  const [placementUiState, setPlacementUiState] =
    useState<MapScopedPlacementUiState | null>(null);
  const placementFocusNonceRef = useRef(0);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const openPlacementPanelButtonRef = useRef<HTMLButtonElement | null>(null);
  const collapsePlacementPanelButtonRef = useRef<HTMLButtonElement | null>(null);
  const showPlacementToolsButtonRef = useRef<HTMLButtonElement | null>(null);
  const [stageWidth, setStageWidth] = useState<number | null>(null);
  const selectedMapName = selectedMap?.name ?? null;

  useLayoutEffect(() => {
    const element = stageRef.current;
    if (!element) {
      return;
    }

    const updateStageWidth = (width: number) => {
      setStageWidth((current) => (
        current === width ? current : width
      ));
    };

    updateStageWidth(element.clientWidth);

    if (typeof ResizeObserver === "undefined") {
      const handleResize = () => updateStageWidth(element.clientWidth);
      window.addEventListener("resize", handleResize);
      return () => window.removeEventListener("resize", handleResize);
    }

    const observer = new ResizeObserver((entries) => {
      const nextWidth = entries[0]?.contentRect.width;
      if (typeof nextWidth === "number" && Number.isFinite(nextWidth)) {
        updateStageWidth(Math.max(0, nextWidth));
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  function openPlacementPanel() {
    if (!selectedMapName) {
      return;
    }
    setPlacementUiState({
      mapName: selectedMapName,
      panelOpen: true,
      panelMounted: true,
      toolsHidden: false,
    });
    window.requestAnimationFrame(() => collapsePlacementPanelButtonRef.current?.focus());
  }

  function collapsePlacementPanel() {
    setPlacementUiState((current) =>
      selectedMapName
        ? {
            mapName: selectedMapName,
            panelOpen: false,
            panelMounted: current?.mapName === selectedMapName
              ? current.panelMounted
              : false,
            toolsHidden: current?.mapName === selectedMapName
              ? current.toolsHidden
              : false,
          }
        : null
    );
    window.requestAnimationFrame(() => openPlacementPanelButtonRef.current?.focus());
  }

  function maximizeMapEditor() {
    if (!selectedMapName) {
      return;
    }
    setPlacementUiState({
      mapName: selectedMapName,
      panelOpen: false,
      panelMounted: false,
      toolsHidden: true,
    });
    window.requestAnimationFrame(() => showPlacementToolsButtonRef.current?.focus());
  }

  function showPlacementTools() {
    if (!selectedMapName) {
      return;
    }
    setPlacementUiState({
      mapName: selectedMapName,
      panelOpen: false,
      panelMounted: false,
      toolsHidden: false,
    });
    window.requestAnimationFrame(() => openPlacementPanelButtonRef.current?.focus());
  }

  function handleWorkbenchKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape" || !placementPanelOpen) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    collapsePlacementPanel();
  }

  const scopedPlacement = useCallback((placement: MapPlacementRecord | null): MapScopedPlacement | null => {
    return selectedMapName && placement
      ? { mapName: selectedMapName, placement }
      : null;
  }, [selectedMapName]);

  const handleSelectedPlacementViewChange = useCallback((placement: MapPlacementRecord | null) => {
    setSelectedPlacementViewState(scopedPlacement(placement));
  }, [scopedPlacement]);

  const handleCanvasSelectPlacement = useCallback((placement: MapPlacementRecord | null) => {
    const scoped = scopedPlacement(placement);
    setSelectedPlacementState(scoped);
    setSelectedPlacementViewState(scoped);
  }, [scopedPlacement]);

  const handleSelectedTileChange = useCallback((tile: MapSelectedTile | null) => {
    setSelectedTileState(selectedMapName && tile
      ? { mapName: selectedMapName, tile }
      : null);
  }, [selectedMapName]);

  const handleViewportBoundsChange = useCallback((
    bounds: MapTileBounds | null,
    sourceMapName?: string | null,
  ) => {
    if (bounds && sourceMapName !== selectedMapName) {
      return;
    }
    setVisibleBoundsState(selectedMapName && bounds
      ? { mapName: selectedMapName, bounds }
      : null);
  }, [selectedMapName]);

  function selectPlacementFromBrowser(placement: MapPlacementRecord | null) {
    setSelectedPlacementState(scopedPlacement(placement));
    setSelectedPlacementViewState(scopedPlacement(placement));
    setPlacementFocusRequestState(selectedMapName && placement
      ? {
          mapName: selectedMapName,
          request: {
            placement,
            nonce: ++placementFocusNonceRef.current,
          },
        }
      : null);
  }

  const handlePlacementFilterChange = useCallback((filter: MapPlacementOverlayFilter) => {
    if (!selectedMapName) {
      setPlacementFilterState(null);
      return;
    }
    setPlacementFilterState({ mapName: selectedMapName, filter });
  }, [selectedMapName]);

  useEffect(() => {
    setSelectedPlacementState(null);
    setSelectedPlacementViewState(null);
    setPlacementFocusRequestState(null);
    setSelectedTileState(null);
    setVisibleBoundsState(null);
    setPlacementFilterState(null);
    setPlacementUiState(selectedMapName
      ? {
          mapName: selectedMapName,
          panelOpen: false,
          panelMounted: false,
          toolsHidden: false,
        }
      : null);
  }, [selectedMapName]);

  const placementFilter =
    placementFilterState && placementFilterState.mapName === selectedMapName
      ? placementFilterState.filter
      : null;
  const selectedPlacement =
    selectedPlacementState && selectedPlacementState.mapName === selectedMapName
      ? selectedPlacementState.placement
      : null;
  const selectedPlacementView =
    selectedPlacementViewState && selectedPlacementViewState.mapName === selectedMapName
      ? selectedPlacementViewState.placement
      : null;
  const placementFocusRequest =
    placementFocusRequestState && placementFocusRequestState.mapName === selectedMapName
      ? placementFocusRequestState.request
      : null;
  const selectedTile =
    selectedTileState && selectedTileState.mapName === selectedMapName
      ? selectedTileState.tile
      : null;
  const visibleBounds =
    visibleBoundsState && visibleBoundsState.mapName === selectedMapName
      ? visibleBoundsState.bounds
      : null;
  const activePlacementUiState =
    placementUiState && placementUiState.mapName === selectedMapName
      ? placementUiState
      : null;
  const placementPanelOpen = activePlacementUiState?.panelOpen ?? false;
  const placementPanelMounted = activePlacementUiState?.panelMounted ?? false;
  const placementToolsHidden = activePlacementUiState?.toolsHidden ?? false;

  const placementFilterActive = Boolean(
    placementFilter?.valid
    && (
      placementFilter.query.trim() !== ""
      || placementFilter.placementType !== "all"
      || (
        placementFilter.nearEnabled
        && (
          placementFilter.useVisibleBounds
          || (
            placementFilter.nearX != null
            && placementFilter.nearY != null
            && placementFilter.nearRadius != null
          )
        )
      )
    ),
  );
  const placementFilterFollowsView = Boolean(
    placementFilterActive
    && placementFilter?.nearEnabled
    && placementFilter.useVisibleBounds,
  );
  const placementFilterBadge = placementFilterFollowsView ? "View" : "Filter";
  const placementFilterTitle = placementFilterFollowsView
    ? "Placement browser filter follows the visible map view"
    : "Placement browser filter is active";
  const openPlacementPanelLabel = placementFilterActive
    ? `Open placements panel, ${placementFilterFollowsView ? "view filter active" : "filter active"}`
    : "Open placements panel";
  const placementPanelSafeInset = stageWidth && stageWidth > 0
    ? Math.min(
        PLACEMENT_PANEL_SAFE_INSET_PX,
        Math.max(
          PLACEMENT_RAIL_SAFE_INSET_PX,
          stageWidth - PLACEMENT_PANEL_EDGE_GAP_PX,
        ),
      )
    : PLACEMENT_PANEL_SAFE_INSET_PX;
  const rightOverlayInset = placementToolsHidden
    ? 0
    : placementPanelOpen
      ? placementPanelSafeInset
      : PLACEMENT_RAIL_SAFE_INSET_PX;
  const rightDockInset = placementToolsHidden
    ? 0
    : placementPanelOpen
      ? placementPanelSafeInset
      : PLACEMENT_RAIL_SAFE_INSET_PX;

  if (!selectedMap) {
    return (
      <div className="flex flex-col items-center justify-center h-full w-full gap-2 text-muted-foreground text-sm">
        <span>Select a map from the navigator to view it.</span>
        <span className="text-xs text-muted-foreground/60">
          Press <kbd className="rounded border px-1.5 py-0.5 font-mono text-[10px]">{modLabel}K</kbd> for actions
        </span>
      </div>
    );
  }

  return (
    <div
      data-testid="map-workbench-shell"
      className="relative h-full min-h-0 w-full min-w-0 overflow-hidden"
    >
      <div
        ref={stageRef}
        data-testid="map-workbench-stage"
        className="relative h-full min-h-0 w-full min-w-0 overflow-hidden p-3"
        onKeyDownCapture={handleWorkbenchKeyDown}
      >
        <div
          data-testid="map-workbench-canvas-pane"
          className="relative h-full min-h-0 w-full min-w-0 overflow-hidden rounded-lg border bg-muted/20"
        >
          <MapChunkedWorkbench
            selectedPlacement={selectedPlacement}
            onSelectPlacement={handleCanvasSelectPlacement}
            onSelectedTileChange={handleSelectedTileChange}
            onSelectedPlacementViewChange={handleSelectedPlacementViewChange}
            onViewportBoundsChange={handleViewportBoundsChange}
            placementFocusRequest={placementFocusRequest}
            placementFilter={placementFilter}
            rightOverlayInset={rightOverlayInset}
            rightDockInset={rightDockInset}
            showSelectedPlacementPreview={!placementPanelOpen}
            preferCollapsedInspector={placementPanelOpen}
          />
        </div>

        <div
          id="map-placement-browser-pane"
          data-testid="map-placement-browser-pane"
          aria-hidden={!placementPanelOpen}
          hidden={!placementPanelOpen}
          className={`absolute bottom-3 right-3 top-3 z-30 min-h-0 overflow-hidden transition-[width,opacity,transform] duration-150 ${
            placementPanelOpen
              ? "w-80 max-w-[calc(100%-1.5rem)] opacity-100 shadow-xl"
              : "pointer-events-none w-0 translate-x-2 opacity-0"
          }`}
        >
          {placementPanelMounted && (
            <MapPlacementBrowser
              onSelectPlacement={selectPlacementFromBrowser}
              selectedPlacement={selectedPlacementView}
              selectedTile={selectedTile}
              visibleBounds={visibleBounds}
              onPlacementFilterChange={handlePlacementFilterChange}
              onCollapse={collapsePlacementPanel}
              collapsed={!placementPanelOpen}
              collapseButtonRef={collapsePlacementPanelButtonRef}
            />
          )}
        </div>
        {!placementPanelOpen && !placementToolsHidden && (
          <div
            data-testid="map-placement-browser-rail"
            className="absolute bottom-3 right-3 top-3 z-20 flex min-h-0 w-12 flex-col items-center overflow-hidden rounded-lg border bg-background shadow-sm"
          >
            <Button
              ref={openPlacementPanelButtonRef}
              type="button"
              variant="ghost"
              size="icon"
              className="mt-2 h-11 w-10 flex-col gap-0.5 px-0 py-1 text-[10px] leading-none"
              aria-label={openPlacementPanelLabel}
              aria-controls="map-placement-browser-pane"
              aria-expanded={placementPanelOpen}
              title={openPlacementPanelLabel}
              onClick={openPlacementPanel}
            >
              <PanelRightOpen className="h-4 w-4" />
              <span
                data-testid="map-placement-rail-open-label"
                className="text-[10px] leading-none"
              >
                Panel
              </span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="mt-1 h-11 w-10 flex-col gap-0.5 px-0 py-1 text-[10px] leading-none"
              aria-label="Maximize map editor"
              title="Maximize map editor"
              onClick={maximizeMapEditor}
            >
              <Maximize2 className="h-4 w-4" />
              <span
                data-testid="map-placement-rail-focus-label"
                className="text-[10px] leading-none"
              >
                Focus
              </span>
            </Button>
            <div className="mt-3 rotate-180 [writing-mode:vertical-rl] text-xs font-medium text-muted-foreground">
              Placements
            </div>
            {(placementFilterActive || selectedPlacement) && (
              <div className="mb-3 mt-auto flex flex-col items-center gap-2">
                {placementFilterActive && (
                  <div
                    data-testid="map-placement-filter-indicator"
                    className="rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
                    title={placementFilterTitle}
                  >
                    {placementFilterBadge}
                  </div>
                )}
                {selectedPlacement && (
                  <div
                    className="h-2 w-2 rounded-full bg-primary"
                    title={selectedPlacement.display_name
                      ?? selectedPlacement.asset_name
                      ?? `${selectedPlacement.kind} ${selectedPlacement.obj_id}`}
                  />
                )}
              </div>
            )}
          </div>
        )}
        {placementToolsHidden && (
          <div
            data-testid="map-placement-tools-restore"
            className="absolute right-3 top-3 z-20"
          >
            <Button
              ref={showPlacementToolsButtonRef}
              type="button"
              variant="secondary"
              size="sm"
              className="h-9 gap-1.5 px-2.5 shadow-sm"
              aria-label="Placements, restore placement tools"
              aria-controls="map-placement-browser-pane"
              aria-expanded="false"
              title="Restore placement tools"
              onClick={showPlacementTools}
            >
              <PanelRightOpen className="h-4 w-4" />
              <span>Placements</span>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
