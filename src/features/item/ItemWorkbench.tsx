import {
  itemEffectConfigAtom,
  itemGltfJsonAtom,
  itemLitInfoAtom,
  itemMetadataAtom,
  selectedItemAtom,
  forgeEffectPreviewAtom,
  itemCharTypeAtom,
  itemEffectCategoryAtom,
} from "@/store/item";
import { currentProjectAtom } from "@/store/project";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Suspense, useEffect, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { Environment, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { useControls, Leva } from "leva";
import ItemModelViewer from "./ItemModelViewer";
import { ItemMetadataPanel } from "./ItemMetadataPanel";
import { getForgeEffectPreview } from "@/commands/item";

const CHAR_TYPE_OPTIONS: Record<string, number> = {
  Lance: 0,
  Carsise: 1,
  Phyllis: 2,
  Ami: 3,
};

const EFFECT_CATEGORY_OPTIONS: Record<string, number> = {
  None: 0,
  "Category 1": 1,
  "Category 2": 2,
  "Category 3": 3,
  "Category 4": 4,
  "Category 5": 5,
  "Category 6": 6,
  "Category 7": 7,
  "Category 8": 8,
  "Category 9": 9,
  "Category 10": 10,
  "Category 11": 11,
  "Category 12": 12,
  "Category 13": 13,
  "Category 14": 14,
};

export default function ItemWorkbench() {
  const itemGltfJson = useAtomValue(itemGltfJsonAtom);
  const itemMetadata = useAtomValue(itemMetadataAtom);
  const litInfo = useAtomValue(itemLitInfoAtom);
  const currentProject = useAtomValue(currentProjectAtom);
  const selectedItem = useAtomValue(selectedItemAtom);
  const [effectConfig, setEffectConfig] = useAtom(itemEffectConfigAtom);
  const [charType, setCharType] = useAtom(itemCharTypeAtom);
  const [effectCategory, setEffectCategory] = useAtom(itemEffectCategoryAtom);
  const setForgePreview = useSetAtom(forgeEffectPreviewAtom);
  const forgePreview = useAtomValue(forgeEffectPreviewAtom);

  // Track a request counter to avoid stale responses
  const requestIdRef = useRef(0);

  useControls("Effects", {
    showLitGlow: {
      value: effectConfig.showLitGlow,
      label: "Show Glow",
      onChange: (v: boolean) =>
        setEffectConfig((prev) => ({ ...prev, showLitGlow: v })),
    },
    showEffects: {
      value: effectConfig.showEffects,
      label: "Show Effects",
      onChange: (v: boolean) =>
        setEffectConfig((prev) => ({ ...prev, showEffects: v })),
    },
    showParticles: {
      value: effectConfig.showParticles,
      label: "Show Particles",
      onChange: (v: boolean) =>
        setEffectConfig((prev) => ({ ...prev, showParticles: v })),
    },
    refineLevel: {
      value: effectConfig.refineLevel,
      min: 0,
      max: 12,
      step: 1,
      label: "Refine Level",
      onChange: (v: number) =>
        setEffectConfig((prev) => ({ ...prev, refineLevel: v })),
    },
  });

  useControls("Forge Preview", {
    charType: {
      value: Object.keys(CHAR_TYPE_OPTIONS).find(
        (k) => CHAR_TYPE_OPTIONS[k] === charType
      ) ?? "Lance",
      options: Object.keys(CHAR_TYPE_OPTIONS),
      label: "Character",
      onChange: (v: string) => setCharType(CHAR_TYPE_OPTIONS[v] ?? 0),
    },
    effectCategory: {
      value: Object.keys(EFFECT_CATEGORY_OPTIONS).find(
        (k) => EFFECT_CATEGORY_OPTIONS[k] === effectCategory
      ) ?? "None",
      options: Object.keys(EFFECT_CATEGORY_OPTIONS),
      label: "Effect Category",
      onChange: (v: string) =>
        setEffectCategory(EFFECT_CATEGORY_OPTIONS[v] ?? 0),
    },
  });

  // Load forge effect preview when parameters change
  useEffect(() => {
    const projectId = currentProject?.id;
    const itemType = selectedItem?.item_type;
    const refineLevel = effectConfig.refineLevel;

    if (!projectId || itemType == null || refineLevel === 0) {
      setForgePreview(null);
      return;
    }

    const reqId = ++requestIdRef.current;

    getForgeEffectPreview(
      projectId,
      itemType,
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
    selectedItem?.item_type,
    effectConfig.refineLevel,
    charType,
    effectCategory,
    setForgePreview,
  ]);

  return (
    <div className="h-full w-full relative">
      <Leva collapsed={false} />
      <ItemMetadataPanel metadata={itemMetadata} />
      <Canvas
        style={{ height: "100%", width: "100%" }}
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
            projectId={currentProject?.id ?? ""}
            forgePreview={forgePreview}
          />
        </Suspense>
        <OrbitControls />
        <gridHelper args={[20, 20, 20]} position-y={0.01} />
      </Canvas>
    </div>
  );
}
