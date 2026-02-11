import {
  itemEffectConfigAtom,
  itemGltfJsonAtom,
  itemLitInfoAtom,
  itemMetadataAtom,
  selectedItemAtom,
  forgeEffectPreviewAtom,
  itemCharTypeAtom,
  itemEffectCategoryAtom,
  itemCategoryAvailabilityAtom,
  itemDebugConfigAtom,
} from "@/store/item";
import { currentProjectAtom } from "@/store/project";
import { isWorkbenchModeAtom, activeWorkbenchAtom, dummyPlacementModeAtom, editingDummyAtom } from "@/store/workbench";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { Environment, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import ItemModelViewer from "./ItemModelViewer";
import { ItemMetadataPanel } from "./ItemMetadataPanel";
import { ForgeCategorySelector } from "./ForgeCategorySelector";
import { ForgeEffectInfoPanel } from "./ForgeEffectInfoPanel";
import { ItemViewerToolbar } from "./ItemViewerToolbar";
import { DecompileTablesPanel } from "./DecompileTablesPanel";
import { DummyPlacementOverlay } from "./DummyPlacementOverlay";
import {
  getForgeEffectPreview,
  getItemCategoryAvailability,
} from "@/commands/item";
import { WorkbenchDummy } from "@/types/item";

export default function ItemWorkbench() {
  const itemGltfJson = useAtomValue(itemGltfJsonAtom);
  const itemMetadata = useAtomValue(itemMetadataAtom);
  const litInfo = useAtomValue(itemLitInfoAtom);
  const currentProject = useAtomValue(currentProjectAtom);
  const selectedItem = useAtomValue(selectedItemAtom);
  const effectConfig = useAtomValue(itemEffectConfigAtom);
  const debugConfig = useAtomValue(itemDebugConfigAtom);
  const charType = useAtomValue(itemCharTypeAtom);
  const [effectCategory, setEffectCategory] = useAtom(itemEffectCategoryAtom);
  const setForgePreview = useSetAtom(forgeEffectPreviewAtom);
  const forgePreview = useAtomValue(forgeEffectPreviewAtom);
  const [categoryAvailability, setCategoryAvailability] = useAtom(
    itemCategoryAvailabilityAtom
  );
  const [showTables, setShowTables] = useState(false);
  const isWorkbenchMode = useAtomValue(isWorkbenchModeAtom);
  const [workbench, setWorkbench] = useAtom(activeWorkbenchAtom);
  const placementMode = useAtomValue(dummyPlacementModeAtom);
  const editingDummy = useAtomValue(editingDummyAtom);

  // Track a request counter to avoid stale responses
  const requestIdRef = useRef(0);

  // Load category availability when item changes
  useEffect(() => {
    const projectId = currentProject?.id;
    const itemId = selectedItem?.id;

    // Reset category selection and availability on item change
    setEffectCategory(0);
    setCategoryAvailability(null);

    if (!projectId || itemId == null) return;

    let cancelled = false;

    getItemCategoryAvailability(projectId, itemId)
      .then((result) => {
        if (!cancelled) setCategoryAvailability(result);
      })
      .catch(() => {
        if (!cancelled) setCategoryAvailability(null);
      });

    return () => {
      cancelled = true;
    };
  }, [currentProject?.id, selectedItem?.id, setEffectCategory, setCategoryAvailability]);

  // Load forge effect preview when parameters change.
  // Clear stale preview immediately so rendering uses fresh data.
  useEffect(() => {
    const projectId = currentProject?.id;
    const itemId = selectedItem?.id;
    const refineLevel = effectConfig.refineLevel;

    if (!projectId || itemId == null || refineLevel === 0) {
      setForgePreview(null);
      return;
    }

    // Clear old preview so stale lit_entry/particles don't linger
    setForgePreview(null);

    const reqId = ++requestIdRef.current;

    getForgeEffectPreview(
      projectId,
      itemId,
      refineLevel,
      charType,
      effectCategory
    )
      .then((preview) => {
        if (reqId === requestIdRef.current) {
          setForgePreview(preview);
        }
      })
      .catch(() => {
        if (reqId === requestIdRef.current) {
          setForgePreview(null);
        }
      });
  }, [
    currentProject?.id,
    selectedItem?.id,
    effectConfig.refineLevel,
    charType,
    effectCategory,
    setForgePreview,
  ]);

  const handleDummyPlaced = useCallback(
    (position: [number, number, number]) => {
      if (!workbench || !currentProject) return;

      let newDummies: WorkbenchDummy[];

      if (editingDummy != null) {
        // Relocate the selected dummy to the clicked position
        newDummies = workbench.dummies.map((d) =>
          d.id === editingDummy ? { ...d, position } : d
        );
      } else {
        // Create a new dummy at the clicked position
        const nextId =
          workbench.dummies.length > 0
            ? Math.max(...workbench.dummies.map((d) => d.id)) + 1
            : 0;
        newDummies = [
          ...workbench.dummies,
          { id: nextId, label: `Dummy ${nextId}`, position },
        ];
      }

      setWorkbench({ ...workbench, dummies: newDummies });
    },
    [workbench, currentProject, setWorkbench, editingDummy]
  );

  return (
    <div className="h-full w-full flex flex-col">
      <ItemViewerToolbar showTables={showTables} onToggleTables={() => setShowTables((v) => !v)} />
      <div className="flex-1 flex relative">
        <div className="flex-1 relative">
          {!isWorkbenchMode && <ItemMetadataPanel metadata={itemMetadata} />}
          {!isWorkbenchMode && (
            <ForgeCategorySelector
              categories={categoryAvailability?.categories ?? null}
              selected={effectCategory}
              onSelect={setEffectCategory}
            />
          )}
          {!isWorkbenchMode && (
            <ForgeEffectInfoPanel
              preview={forgePreview}
              effectConfig={effectConfig}
              effectCategory={effectCategory}
            />
          )}
          {!isWorkbenchMode && <DecompileTablesPanel open={showTables} />}
          <Canvas
            style={{
              height: "100%",
              width: "100%",
              cursor: placementMode ? "crosshair" : undefined,
            }}
            shadows
            camera={{ position: [3, 4, 4], fov: 35 }}
          >
            <ambientLight intensity={1} />
            <directionalLight position={[5, 5, 5]} castShadow />
            <Environment background>
              <mesh scale={100}>
                <sphereGeometry args={[1, 16, 16]} />
                <meshBasicMaterial color="#393939" side={THREE.BackSide} />
              </mesh>
            </Environment>
            <Suspense fallback={null}>
              <ItemModelViewer
                gltfJson={itemGltfJson}
                litInfo={litInfo}
                effectConfig={effectConfig}
                debugConfig={debugConfig}
                projectId={currentProject?.id ?? ""}
                projectDir={currentProject?.projectDirectory ?? ""}
                forgePreview={forgePreview}
                workbenchDummies={isWorkbenchMode ? workbench?.dummies ?? [] : null}
              />
            </Suspense>
            {isWorkbenchMode && (
              <DummyPlacementOverlay onPlace={handleDummyPlaced} />
            )}
            <OrbitControls />
            <gridHelper args={[20, 20, 20]} position-y={0.01} />
          </Canvas>
        </div>
      </div>
    </div>
  );
}
