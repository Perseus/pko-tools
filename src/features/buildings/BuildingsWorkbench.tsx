import { Canvas } from "@react-three/fiber";
import { modLabel } from "@/lib/platform";
import { OrbitControls, GizmoHelper, GizmoViewport } from "@react-three/drei";
import { useAtom, useAtomValue } from "jotai";
import { Suspense, useMemo } from "react";
import {
  buildingGltfJsonAtom,
  buildingLoadingAtom,
  buildingMetadataAtom,
  buildingViewConfigAtom,
  selectedBuildingAtom,
} from "@/store/buildings";
import BuildingsModelViewer from "./BuildingsModelViewer";
import { BuildingMetadataPanel } from "./BuildingMetadataPanel";
import { Loader2 } from "lucide-react";
import { Leva } from "leva";
import { actionIds, useRegisterActionRuntime } from "@/features/actions";
import { ContextualActionMenu } from "@/features/actions/ContextualActionMenu";
import { PerfFrameProbe, PerfOverlay } from "@/features/perf";
import { CanvasErrorBoundary } from "@/components/CanvasErrorBoundary";

const BUILDING_CONTEXT_ACTIONS = [
  actionIds.buildingExportGltf,
  actionIds.buildingToggleMeshOutlines,
  actionIds.buildingToggleAnimation,
  actionIds.buildingToggleMetadata,
];

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
  const metadata = useAtomValue(buildingMetadataAtom);
  const [viewConfig, setViewConfig] = useAtom(buildingViewConfigAtom);

  // Action runtimes for keyboard/cmdk toggles — write to Jotai atom
  const meshOutlinesRuntime = useMemo(
    () => ({
      run: () =>
        setViewConfig((prev) => ({
          ...prev,
          showMeshOutlines: !prev.showMeshOutlines,
        })),
      isEnabled: () => Boolean(gltfJson),
      disabledReason: () =>
        gltfJson ? undefined : "No building loaded",
    }),
    [gltfJson, setViewConfig]
  );

  const animationRuntime = useMemo(
    () => ({
      run: () =>
        setViewConfig((prev) => ({
          ...prev,
          playAnimation: !prev.playAnimation,
        })),
      isEnabled: () => Boolean(gltfJson),
      disabledReason: () =>
        gltfJson ? undefined : "No building loaded",
    }),
    [gltfJson, setViewConfig]
  );

  const metadataRuntime = useMemo(
    () => ({
      run: () =>
        setViewConfig((prev) => ({
          ...prev,
          showMetadata: !prev.showMetadata,
        })),
      isEnabled: () => Boolean(gltfJson),
      disabledReason: () =>
        gltfJson ? undefined : "No building loaded",
    }),
    [gltfJson, setViewConfig]
  );

  useRegisterActionRuntime(actionIds.buildingToggleMeshOutlines, meshOutlinesRuntime);
  useRegisterActionRuntime(actionIds.buildingToggleAnimation, animationRuntime);
  useRegisterActionRuntime(actionIds.buildingToggleMetadata, metadataRuntime);

  if (!gltfJson && !loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full w-full gap-2 text-muted-foreground text-sm">
        <span>Select a building from the navigator to view it.</span>
        <span className="text-xs text-muted-foreground/60">
          Press <kbd className="rounded border px-1.5 py-0.5 font-mono text-[10px]">{modLabel}K</kbd> for actions
        </span>
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
    <div className="h-full w-full relative">
      <Leva collapsed={false} />
      <BuildingMetadataPanel
        metadata={metadata}
        visible={viewConfig.showMetadata}
      />
      <ContextualActionMenu
        actionIds={BUILDING_CONTEXT_ACTIONS}
        requireShiftKey
        className="h-full w-full"
      >
        <BuildingInfoPanel />
        <CanvasErrorBoundary className="absolute inset-0 flex items-center justify-center">
          <Canvas
            camera={{
              position: [30, 25, 30],
              fov: 45,
              near: 0.01,
              far: 10000,
            }}
            dpr={[1, 1.5]}
            gl={{ powerPreference: "high-performance" }}
            style={{
              background:
                "linear-gradient(180deg, #b0c4de 0%, #dfe6ed 100%)",
            }}
          >
            <ambientLight intensity={0.6} />
            <directionalLight position={[10, 20, 10]} intensity={0.8} />

            <Suspense fallback={null}>
              {gltfJson && (
                <BuildingsModelViewer
                  gltfJson={gltfJson}
                  showMeshOutlines={viewConfig.showMeshOutlines}
                  playAnimation={viewConfig.playAnimation}
                />
              )}
            </Suspense>

            <OrbitControls makeDefault />

            <GizmoHelper alignment="bottom-right" margin={[60, 60]}>
              <GizmoViewport />
            </GizmoHelper>

            <gridHelper args={[50, 50, "#888888", "#444444"]} />
            <PerfFrameProbe surface="buildings" />
          </Canvas>
        </CanvasErrorBoundary>
        <PerfOverlay surface="buildings" className="right-3 top-3" />
      </ContextualActionMenu>
    </div>
  );
}
