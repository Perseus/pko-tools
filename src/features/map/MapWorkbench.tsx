import { Canvas } from "@react-three/fiber";
import { OrbitControls, GizmoHelper, GizmoViewport } from "@react-three/drei";
import { useAtomValue, useAtom } from "jotai";
import { Suspense, useState } from "react";
import { mapGltfJsonAtom, mapLoadingAtom, mapMetadataAtom, mapViewConfigAtom, selectedMapAtom } from "@/store/map";
import { currentProjectAtom } from "@/store/project";
import MapTerrainViewer from "./MapTerrainViewer";
import { Loader2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { exportMapForUnity } from "@/commands/map";
import { toast } from "@/hooks/use-toast";

function MapViewToolbar() {
  const [viewConfig, setViewConfig] = useAtom(mapViewConfigAtom);
  const selectedMap = useAtomValue(selectedMapAtom);
  const currentProject = useAtomValue(currentProjectAtom);
  const [exporting, setExporting] = useState(false);

  const handleExportForUnity = async () => {
    if (!currentProject || !selectedMap) return;
    setExporting(true);
    try {
      const result = await exportMapForUnity(currentProject.id, selectedMap.name);
      toast({
        title: "Export complete",
        description: `Exported ${result.total_buildings_exported} buildings, ${result.total_placements} placements to ${result.output_dir}`,
      });
    } catch (e) {
      toast({
        title: "Export failed",
        description: String(e),
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

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
      {selectedMap && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={handleExportForUnity}
          disabled={exporting}
        >
          {exporting ? (
            <Loader2 className="h-3 w-3 animate-spin mr-1" />
          ) : (
            <Download className="h-3 w-3 mr-1" />
          )}
          Export for Unity
        </Button>
      )}
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
  const gltfJson = useAtomValue(mapGltfJsonAtom);
  const metadata = useAtomValue(mapMetadataAtom);
  const loading = useAtomValue(mapLoadingAtom);
  const viewConfig = useAtomValue(mapViewConfigAtom);

  // Compute initial camera position — edge of map looking across the terrain
  const mapScale = 5; // matches MAP_VISUAL_SCALE in terrain.rs
  const cameraPos: [number, number, number] = metadata
    ? [
        (metadata.width * mapScale) * 0.1,
        (metadata.width * mapScale) * 0.15,
        (metadata.height * mapScale) * 0.1,
      ]
    : [50, 40, 50];

  if (!gltfJson && !loading) {
    return (
      <div className="flex items-center justify-center h-full w-full text-muted-foreground text-sm">
        Select a map from the navigator to view it.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full w-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground text-sm">
          Loading terrain...
        </span>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <MapViewToolbar />
      <MapMetadataPanel />
      <Canvas
        camera={{
          position: cameraPos,
          fov: 45,
          near: 0.1,
          far: 50000,
        }}
        style={{ background: "linear-gradient(180deg, #b0c4de 0%, #dfe6ed 100%)" }}
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={[500, 1000, 500]} intensity={0.8} />

        <Suspense fallback={null}>
          {gltfJson && (
            <MapTerrainViewer gltfJson={gltfJson} viewConfig={viewConfig} />
          )}
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
      </Canvas>
    </div>
  );
}
