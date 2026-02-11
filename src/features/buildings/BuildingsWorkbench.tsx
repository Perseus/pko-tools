import { Canvas } from "@react-three/fiber";
import { OrbitControls, GizmoHelper, GizmoViewport } from "@react-three/drei";
import { useAtomValue } from "jotai";
import { Suspense } from "react";
import { buildingGltfJsonAtom, buildingLoadingAtom, selectedBuildingAtom } from "@/store/buildings";
import BuildingsModelViewer from "./BuildingsModelViewer";
import { Loader2 } from "lucide-react";

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
