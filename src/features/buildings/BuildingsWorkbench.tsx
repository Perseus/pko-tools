import { Canvas } from "@react-three/fiber";
import { OrbitControls, GizmoHelper, GizmoViewport } from "@react-three/drei";
import { useAtom, useAtomValue } from "jotai";
import { Suspense, useState } from "react";
import {
  activeBuildingWorkbenchAtom,
  buildingGltfJsonAtom,
  buildingLoadingAtom,
  selectedBuildingAtom,
} from "@/store/buildings";
import { currentProjectAtom } from "@/store/project";
import BuildingsModelViewer from "./BuildingsModelViewer";
import { Loader2, RotateCw, Maximize } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/hooks/use-toast";
import { rescaleBuilding, rotateBuilding } from "@/commands/buildings";

function BuildingInfoPanel() {
  const building = useAtomValue(selectedBuildingAtom);
  if (!building) return null;

  return (
    <div className="absolute bottom-8 left-2 z-10 bg-background/80 backdrop-blur-sm rounded-md border p-2 text-xs space-y-0.5">
      <div className="font-medium">{building.display_name}</div>
      <div className="text-muted-foreground">ID: {building.id}</div>
      <div className="text-muted-foreground">{building.filename}</div>
    </div>
  );
}

function WorkbenchToolbar() {
  const workbench = useAtomValue(activeBuildingWorkbenchAtom);
  const currentProject = useAtomValue(currentProjectAtom);
  const [, setGltfJson] = useAtom(buildingGltfJsonAtom);
  const [scaleFactor, setScaleFactor] = useState("1.0");
  const [rotX, setRotX] = useState("0");
  const [rotY, setRotY] = useState("0");
  const [rotZ, setRotZ] = useState("0");
  const [applying, setApplying] = useState(false);

  if (!workbench || !currentProject) return null;

  async function handleRescale() {
    if (!workbench || !currentProject) return;
    const factor = parseFloat(scaleFactor);
    if (isNaN(factor) || factor <= 0) {
      toast({ title: "Invalid scale factor", variant: "destructive" });
      return;
    }
    setApplying(true);
    try {
      const json = await rescaleBuilding(
        currentProject.id,
        workbench.lmo_path,
        factor
      );
      setGltfJson(json);
      toast({ title: `Rescaled by ${factor}x` });
    } catch (err) {
      toast({
        title: "Rescale failed",
        description: String(err),
        variant: "destructive",
      });
    } finally {
      setApplying(false);
    }
  }

  async function handleRotate() {
    if (!workbench || !currentProject) return;
    const x = parseFloat(rotX);
    const y = parseFloat(rotY);
    const z = parseFloat(rotZ);
    if ([x, y, z].some(isNaN)) {
      toast({ title: "Invalid rotation angles", variant: "destructive" });
      return;
    }
    setApplying(true);
    try {
      const json = await rotateBuilding(
        currentProject.id,
        workbench.lmo_path,
        x,
        y,
        z
      );
      setGltfJson(json);
      toast({ title: `Rotated (${x}, ${y}, ${z})°` });
    } catch (err) {
      toast({
        title: "Rotate failed",
        description: String(err),
        variant: "destructive",
      });
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="absolute top-2 left-2 right-2 z-10 bg-background/90 backdrop-blur-sm rounded-md border p-2 flex items-center gap-3 text-xs">
      <div className="flex items-center gap-1">
        <Maximize className="h-3 w-3" />
        <Input
          className="h-6 w-16 text-xs"
          value={scaleFactor}
          onChange={(e) => setScaleFactor(e.target.value)}
          placeholder="1.0"
        />
        <Button
          variant="outline"
          size="sm"
          className="h-6 text-xs px-2"
          onClick={handleRescale}
          disabled={applying}
        >
          Scale
        </Button>
      </div>
      <div className="w-px h-4 bg-border" />
      <div className="flex items-center gap-1">
        <RotateCw className="h-3 w-3" />
        <Input
          className="h-6 w-12 text-xs"
          value={rotX}
          onChange={(e) => setRotX(e.target.value)}
          placeholder="X°"
        />
        <Input
          className="h-6 w-12 text-xs"
          value={rotY}
          onChange={(e) => setRotY(e.target.value)}
          placeholder="Y°"
        />
        <Input
          className="h-6 w-12 text-xs"
          value={rotZ}
          onChange={(e) => setRotZ(e.target.value)}
          placeholder="Z°"
        />
        <Button
          variant="outline"
          size="sm"
          className="h-6 text-xs px-2"
          onClick={handleRotate}
          disabled={applying}
        >
          Rotate
        </Button>
      </div>
      {applying && <Loader2 className="h-3 w-3 animate-spin" />}
    </div>
  );
}

export default function BuildingsWorkbench() {
  const gltfJson = useAtomValue(buildingGltfJsonAtom);
  const loading = useAtomValue(buildingLoadingAtom);

  if (!gltfJson && !loading) {
    return (
      <div className="flex items-center justify-center h-full w-full text-muted-foreground text-sm">
        Select a building from the navigator to view it.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full w-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground text-sm">
          Loading building model...
        </span>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <WorkbenchToolbar />
      <BuildingInfoPanel />
      <Canvas
        camera={{
          position: [30, 25, 30],
          fov: 45,
          near: 0.01,
          far: 10000,
        }}
        style={{
          background: "linear-gradient(180deg, #b0c4de 0%, #dfe6ed 100%)",
        }}
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={[10, 20, 10]} intensity={0.8} />

        <Suspense fallback={null}>
          {gltfJson && <BuildingsModelViewer gltfJson={gltfJson} />}
        </Suspense>

        <OrbitControls makeDefault />

        <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
          <GizmoViewport />
        </GizmoHelper>

        <gridHelper args={[50, 50, "#888888", "#444444"]} />
      </Canvas>
    </div>
  );
}
