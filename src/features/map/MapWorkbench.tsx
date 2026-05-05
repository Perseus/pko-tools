import { Canvas } from "@react-three/fiber";
import { modLabel } from "@/lib/platform";
import { OrbitControls, GizmoHelper, GizmoViewport } from "@react-three/drei";
import { useAtomValue, useAtom } from "jotai";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { mapGltfJsonAtom, mapLoadingAtom, mapMetadataAtom, mapViewConfigAtom, selectedMapAtom } from "@/store/map";
import MapTerrainViewer from "./MapTerrainViewer";
import MapPlacementBrowser from "./MapPlacementBrowser";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { actionIds } from "@/features/actions/actionIds";
import { ContextualActionMenu } from "@/features/actions/ContextualActionMenu";
import { useRegisterActionRuntime } from "@/features/actions/ActionKernelProvider";
import { PerfFrameProbe, PerfOverlay } from "@/features/perf";
import { CanvasErrorBoundary } from "@/components/CanvasErrorBoundary";
import { MapPlacementRecord } from "@/types/map";
import { currentProjectAtom } from "@/store/project";
import { loadMapTerrain } from "@/commands/map";
import { toast } from "@/hooks/use-toast";
import { LatestOnly } from "@/lib/latestOnly";

const MAP_CONTEXT_ACTIONS = [
  actionIds.mapToggleObjectMarkers,
  actionIds.mapToggleWireframe,
  actionIds.mapExportGltf,
];

function MapViewToolbar() {
  const [viewConfig, setViewConfig] = useAtom(mapViewConfigAtom);

  const mapToggleObjectsActionRuntime = useMemo(
    () => ({
      run: () => {
        setViewConfig((prev) => ({
          ...prev,
          showObjectMarkers: !prev.showObjectMarkers,
        }));
      },
      isEnabled: () => true,
    }),
    [setViewConfig],
  );
  const mapToggleWireframeActionRuntime = useMemo(
    () => ({
      run: () => {
        setViewConfig((prev) => ({
          ...prev,
          showWireframe: !prev.showWireframe,
        }));
      },
      isEnabled: () => true,
    }),
    [setViewConfig],
  );

  useRegisterActionRuntime(actionIds.mapToggleObjectMarkers, mapToggleObjectsActionRuntime);
  useRegisterActionRuntime(actionIds.mapToggleWireframe, mapToggleWireframeActionRuntime);

  return (
    <div className="absolute top-2 left-2 z-10 flex gap-1">
      <Button
        variant={viewConfig.showObjectMarkers ? "default" : "outline"}
        size="sm"
        className="h-7 text-xs"
        onClick={() =>
          setViewConfig((prev) => ({
            ...prev,
            showObjectMarkers: !prev.showObjectMarkers,
          }))
        }
      >
        Objects
      </Button>
      <Button
        variant={viewConfig.showWireframe ? "default" : "outline"}
        size="sm"
        className="h-7 text-xs"
        onClick={() =>
          setViewConfig((prev) => ({
            ...prev,
            showWireframe: !prev.showWireframe,
          }))
        }
      >
        Wireframe
      </Button>
    </div>
  );
}

function MapMetadataPanel() {
  const metadata = useAtomValue(mapMetadataAtom);
  if (!metadata) return null;

  return (
    <div className="absolute bottom-8 left-2 z-10 bg-background/80 backdrop-blur-sm rounded-md border p-2 text-xs space-y-0.5">
      <div className="font-medium">{metadata.name}</div>
      <div className="text-muted-foreground">
        Size: {metadata.width} x {metadata.height}
      </div>
      <div className="text-muted-foreground">
        Sections: {metadata.non_empty_sections} / {metadata.total_sections}
      </div>
      <div className="text-muted-foreground">
        Tiles: {metadata.total_tiles.toLocaleString()}
      </div>
      {metadata.object_count > 0 && (
        <div className="text-muted-foreground">
          Objects: {metadata.object_count}
        </div>
      )}
    </div>
  );
}

export default function MapWorkbench() {
  const currentProject = useAtomValue(currentProjectAtom);
  const selectedMap = useAtomValue(selectedMapAtom);
  const [gltfJson, setMapGltfJson] = useAtom(mapGltfJsonAtom);
  const metadata = useAtomValue(mapMetadataAtom);
  const [loading, setMapLoading] = useAtom(mapLoadingAtom);
  const viewConfig = useAtomValue(mapViewConfigAtom);
  const [selectedPlacement, setSelectedPlacement] = useState<MapPlacementRecord | null>(null);
  const [mode, setMode] = useState<"placements" | "terrain">("placements");
  const terrainLoadGuard = useRef(new LatestOnly());

  useEffect(() => {
    setMode("placements");
    setSelectedPlacement(null);
  }, [selectedMap?.name]);

  async function handleLoadTerrain() {
    if (!currentProject || !selectedMap) {
      return;
    }

    const requestVersion = terrainLoadGuard.current.begin();
    setMode("terrain");
    setMapLoading(true);
    try {
      const nextGltf = await loadMapTerrain(currentProject.id, selectedMap.name);
      if (!terrainLoadGuard.current.isLatest(requestVersion)) {
        return;
      }
      setMapGltfJson(nextGltf);
    } catch (error) {
      if (terrainLoadGuard.current.isLatest(requestVersion)) {
        toast({
          title: "Failed to load terrain",
          description: String(error),
          variant: "destructive",
        });
      }
    } finally {
      if (terrainLoadGuard.current.isLatest(requestVersion)) {
        setMapLoading(false);
      }
    }
  }

  // Compute initial camera position — edge of map looking across the terrain
  const mapScale = 1; // 1 tile = 1 world unit (no scale factor)
  const cameraPos: [number, number, number] = metadata
    ? [
        (metadata.width * mapScale) * 0.1,
        (metadata.width * mapScale) * 0.15,
        (metadata.height * mapScale) * 0.1,
      ]
    : [50, 40, 50];

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
    <ContextualActionMenu
      actionIds={MAP_CONTEXT_ACTIONS}
      requireShiftKey
      className="relative h-full w-full"
    >
      <div className="flex h-full w-full gap-3 p-3">
        <div className="relative min-w-0 flex-1 overflow-hidden rounded-lg border bg-muted/20">
          <div className="absolute left-3 top-3 z-10 flex items-center gap-2">
            <Button
              variant={mode === "placements" ? "default" : "outline"}
              size="sm"
              className="h-8 text-xs"
              onClick={() => setMode("placements")}
            >
              Placements
            </Button>
            <Button
              variant={mode === "terrain" ? "default" : "outline"}
              size="sm"
              className="h-8 text-xs"
              onClick={() => {
                if (gltfJson) {
                  setMode("terrain");
                  return;
                }
                void handleLoadTerrain();
              }}
            >
              {loading && mode === "terrain" ? (
                <>
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                  Loading Terrain
                </>
              ) : (
                "3D Terrain"
              )}
            </Button>
          </div>

          {mode === "terrain" ? (
            <>
              <MapViewToolbar />
              <MapMetadataPanel />
              {loading && (
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-muted-foreground text-sm">
                    Loading terrain...
                  </span>
                </div>
              )}
              {!loading && !gltfJson && (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-center text-sm text-muted-foreground">
                  <div>Terrain is loaded on demand so huge maps stay usable.</div>
                  <Button size="sm" onClick={() => void handleLoadTerrain()}>
                    Load 3D Terrain
                  </Button>
                </div>
              )}
              {!loading && gltfJson && (
                <>
                  <CanvasErrorBoundary className="absolute inset-0 flex items-center justify-center">
                    <Canvas
                      camera={{
                        position: cameraPos,
                        fov: 45,
                        near: 0.1,
                        far: 50000,
                      }}
                      dpr={[1, 1.5]}
                      gl={{ powerPreference: "high-performance" }}
                      style={{ background: "linear-gradient(180deg, #b0c4de 0%, #dfe6ed 100%)" }}
                    >
                      <ambientLight intensity={0.6} />
                      <directionalLight position={[500, 1000, 500]} intensity={0.8} />

                      <Suspense fallback={null}>
                        <MapTerrainViewer
                          gltfJson={gltfJson}
                          viewConfig={viewConfig}
                          selectedPlacement={selectedPlacement}
                        />
                      </Suspense>

                      <OrbitControls
                        makeDefault
                        maxDistance={15000}
                        minDistance={1}
                        target={
                          metadata
                            ? [
                                (metadata.width * mapScale) / 2,
                                0,
                                (metadata.height * mapScale) / 2,
                              ]
                            : [0, 0, 0]
                        }
                      />

                      <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
                        <GizmoViewport />
                      </GizmoHelper>
                      <PerfFrameProbe surface="maps" />
                    </Canvas>
                  </CanvasErrorBoundary>
                  <PerfOverlay surface="maps" className="right-3 top-3" />
                </>
              )}
            </>
          ) : (
            <div className="h-full overflow-y-auto px-8 py-14">
              <div className="max-w-2xl">
                <h2 className="text-xl font-semibold">{selectedMap.display_name}</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  This lightweight explorer opens map placement data without loading the heavy 3D terrain scene.
                  Search, filter, and inspect `.obj` records on the right, then optionally load terrain only when you need spatial context.
                </p>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-lg border bg-background p-4">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Selected placement</div>
                    {selectedPlacement ? (
                      <div className="mt-2 space-y-1 text-sm">
                        <div className="font-medium">
                          {selectedPlacement.display_name ?? selectedPlacement.asset_name ?? `${selectedPlacement.kind} ${selectedPlacement.obj_id}`}
                        </div>
                        <div className="font-mono text-xs text-muted-foreground">
                          {selectedPlacement.asset_name ?? "unresolved"}
                        </div>
                        <div className="pt-2 font-mono text-xs text-muted-foreground">
                          idx {selectedPlacement.index} | id {selectedPlacement.obj_id} | yaw {selectedPlacement.yaw_angle}
                        </div>
                        <div className="font-mono text-xs text-muted-foreground">
                          x {selectedPlacement.world_x.toFixed(2)} | y {selectedPlacement.world_y.toFixed(2)} | z {selectedPlacement.world_z.toFixed(2)}
                        </div>
                      </div>
                    ) : (
                      <div className="mt-2 text-sm text-muted-foreground">
                        Pick a placement from the browser to inspect it here.
                      </div>
                    )}
                  </div>

                  <div className="rounded-lg border bg-background p-4">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">3D terrain</div>
                    <div className="mt-2 text-sm text-muted-foreground">
                      The original terrain renderer is still available, but it only loads on demand now.
                    </div>
                    <Button className="mt-4" size="sm" onClick={() => void handleLoadTerrain()}>
                      {gltfJson ? "Open Terrain View" : "Load Terrain On Demand"}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="h-full w-[24rem] shrink-0">
          <MapPlacementBrowser
            onSelectPlacement={setSelectedPlacement}
            selectedPlacement={selectedPlacement}
          />
        </div>
      </div>
    </ContextualActionMenu>
  );
}
