import { useEffect, useMemo, useState } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { ItemLitInfo, WorkbenchDummy } from "@/types/item";
import { ItemEffectConfig, ItemDebugConfig } from "@/store/item";
import { ItemLitRenderer } from "./ItemLitRenderer";
import { ForgeEffectPreview } from "@/types/item";
import { ItemParticleRenderer } from "./ItemParticleRenderer";
import { ItemEffectRenderer } from "./ItemEffectRenderer";
import {
  extractItemBoundingSpheres,
  extractItemMeshes,
  ItemBoundingSphereIndicators,
  ItemMeshHighlights,
  ItemDummyHelpers,
  ItemWorkbenchDummyHelpers,
} from "./ItemDebugOverlays";

function jsonToDataURI(json: string): Promise<string> {
  return new Promise((resolve, reject) => {
    try {
      if (!json) {
        reject(new Error("No JSON provided"));
        return;
      }
      const blob = new Blob([json], { type: "application/json" });
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (error) => reject(error);
      reader.readAsDataURL(blob);
    } catch (error) {
      reject(error);
    }
  });
}

/** Extract dummy point matrices from the glTF scene userData */
export function extractDummyPoints(
  scene: THREE.Object3D
): { id: number; matrix: THREE.Matrix4; name: string }[] {
  const dummies: { id: number; matrix: THREE.Matrix4; name: string }[] = [];

  scene.traverse((child) => {
    if (child.userData && child.userData.type === "dummy") {
      dummies.push({
        id: child.userData.id ?? 0,
        matrix: child.matrixWorld.clone(),
        name: child.name,
      });
    }
  });

  return dummies;
}

function ItemModel({
  gltfDataURI,
  litInfo,
  effectConfig,
  debugConfig,
  projectId,
  projectDir,
  forgePreview,
  workbenchDummies,
}: {
  gltfDataURI: string;
  litInfo: ItemLitInfo | null;
  effectConfig: ItemEffectConfig;
  debugConfig: ItemDebugConfig;
  projectId: string;
  projectDir: string;
  forgePreview: ForgeEffectPreview | null;
  workbenchDummies: WorkbenchDummy[] | null;
}) {
  const { scene } = useGLTF(gltfDataURI);

  // Find the glow overlay mesh and the main weapon mesh.
  // The glow overlay is a separate node named "glow_overlay" with
  // userData.glowOverlay === true (set via glTF node extras).
  const { glowMesh, glowNode, weaponMesh, sceneDummyPoints } = useMemo(() => {
    // Ensure world matrices are computed before extracting transforms.
    // GLTFLoader sets node.matrix but does NOT compute matrixWorld.
    scene.updateMatrixWorld(true);

    let glow: THREE.Mesh | null = null;
    let glowParent: THREE.Object3D | null = null;
    let weapon: THREE.Mesh | null = null;
    const dummies: { id: number; matrix: THREE.Matrix4; name: string }[] = [];

    // Compute the scene's inverse world matrix so we can express dummy
    // transforms relative to the scene root.  Effects/particles are siblings
    // of <primitive object={scene}> inside the rotated group, so using world
    // matrices would double-apply the group rotation.
    const sceneWorldInverse = new THREE.Matrix4().copy(scene.matrixWorld).invert();

    scene.traverse((child) => {
      // Check for glow overlay by node name or userData (both for reliability)
      const isGlowOverlay =
        child.name === "glow_overlay" ||
        child.userData?.glowOverlay === true;

      if (isGlowOverlay) {
        // Hide the glow overlay group/mesh — the glow shader renders on top
        child.visible = false;
        if (!glowParent) glowParent = child;
        // Find the actual mesh inside (the node may be a Group containing a Mesh)
        if (child instanceof THREE.Mesh && !glow) {
          glow = child;
        } else {
          child.traverse((desc) => {
            if (desc instanceof THREE.Mesh && !glow) {
              glow = desc;
            }
          });
        }
      } else if (child instanceof THREE.Mesh && !weapon) {
        weapon = child;
      }

      if (child.userData?.type === "dummy") {
        dummies.push({
          id: child.userData.id ?? 0,
          matrix: new THREE.Matrix4().multiplyMatrices(
            sceneWorldInverse,
            child.matrixWorld
          ),
          name: child.name,
        });
      }
    });

    return {
      glowMesh: glow as THREE.Mesh | null,
      glowNode: glowParent as THREE.Object3D | null,
      weaponMesh: weapon as THREE.Mesh | null,
      sceneDummyPoints: dummies,
    };
  }, [scene]);

  const dummyPoints = useMemo(() => {
    if (!workbenchDummies) return sceneDummyPoints;
    return workbenchDummies.map((dummy) => ({
      id: dummy.id,
      name: dummy.label || `Dummy${dummy.id}`,
      matrix: new THREE.Matrix4().makeTranslation(
        dummy.position[0],
        dummy.position[1],
        dummy.position[2]
      ),
    }));
  }, [sceneDummyPoints, workbenchDummies]);

  // Extract debug data
  const boundingSpheres = useMemo(
    () => extractItemBoundingSpheres(scene),
    [scene]
  );
  const itemMeshes = useMemo(() => extractItemMeshes(scene), [scene]);

  // Toggle glow overlay visibility for debug
  useEffect(() => {
    if (!glowNode) return;

    if (debugConfig.showGlowOverlay) {
      glowNode.visible = true;
      // Apply semi-transparent green debug material to glow meshes
      glowNode.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          if (!child.userData._originalMaterial) {
            child.userData._originalMaterial = child.material;
          }
          child.material = new THREE.MeshBasicMaterial({
            color: 0x00ff00,
            transparent: true,
            opacity: 0.4,
            wireframe: false,
            depthWrite: false,
            side: THREE.DoubleSide,
          });
        }
      });
    } else {
      glowNode.visible = false;
      // Restore original materials
      glowNode.traverse((child) => {
        if (
          child instanceof THREE.Mesh &&
          child.userData._originalMaterial
        ) {
          child.material = child.userData._originalMaterial;
        }
      });
    }
  }, [glowNode, debugConfig.showGlowOverlay]);

  // Determine which lit entry to use based on forge preview or refine level.
  // When a forge preview is active (non-null), its lit_entry is authoritative —
  // if the preview says no glow (lit_entry: null), we respect that instead of
  // falling through to litInfo.
  const activeLitEntry = useMemo(() => {
    if (forgePreview) {
      return forgePreview.lit_entry ?? null;
    }
    if (!litInfo || litInfo.lits.length === 0) return null;
    // Select lit entry by refine tier: levels 1-4 → tier 0, 5-8 → tier 1, 9-12 → tier 2, etc.
    const tier = effectConfig.refineLevel > 0
      ? Math.min(Math.floor((effectConfig.refineLevel - 1) / 4), litInfo.lits.length - 1)
      : 0;
    return litInfo.lits[tier] ?? litInfo.lits[0];
  }, [litInfo, forgePreview, effectConfig.refineLevel]);

  // Use glow overlay geometry if available, otherwise fall back to weapon mesh
  const glowGeometryMesh = glowMesh ?? weaponMesh;

  return (
    <>
      <group rotation={[-Math.PI / 2, 0, 0]}>
        <primitive object={scene} />
        {effectConfig.showLitGlow && activeLitEntry && glowGeometryMesh && effectConfig.refineLevel > 0 && (
          <ItemLitRenderer
            litEntry={activeLitEntry}
            glowMesh={glowGeometryMesh}
            projectDir={projectDir}
          />
        )}
        {effectConfig.showParticles && forgePreview && forgePreview.particles.length > 0 && (
          <ItemParticleRenderer
            particles={forgePreview.particles}
            dummyPoints={dummyPoints}
            projectId={projectId}
            alpha={forgePreview.alpha}
          />
        )}
        {effectConfig.showEffects && forgePreview && forgePreview.particles.length > 0 && (
          <ItemEffectRenderer
            particles={forgePreview.particles}
            dummyPoints={dummyPoints}
            projectId={projectId}
            projectDir={projectDir}
            forgeAlpha={forgePreview.alpha}
          />
        )}
        <ItemBoundingSphereIndicators
          spheres={boundingSpheres}
          visible={debugConfig.showBoundingSpheres}
        />
        <ItemMeshHighlights
          meshes={itemMeshes}
          visible={debugConfig.showWireframe}
        />
        {workbenchDummies ? (
          <ItemWorkbenchDummyHelpers
            scene={scene}
            dummies={workbenchDummies}
            showDummies={debugConfig.showDummies}
          />
        ) : (
          <ItemDummyHelpers
            scene={scene}
            showDummies={debugConfig.showDummies}
          />
        )}
      </group>
    </>
  );
}

export default function ItemModelViewer({
  gltfJson,
  litInfo,
  effectConfig,
  debugConfig,
  projectId,
  projectDir,
  forgePreview,
  workbenchDummies,
}: {
  gltfJson: string | null;
  litInfo: ItemLitInfo | null;
  effectConfig: ItemEffectConfig;
  debugConfig: ItemDebugConfig;
  projectId: string;
  projectDir: string;
  forgePreview: ForgeEffectPreview | null;
  workbenchDummies: WorkbenchDummy[] | null;
}) {
  const [gltfDataURI, setGltfDataURI] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (!gltfJson) {
        setGltfDataURI(null);
        return;
      }
      setGltfDataURI(null);
      const uri = await jsonToDataURI(gltfJson);
      setGltfDataURI(uri);
    })();
  }, [gltfJson]);

  if (!gltfDataURI) {
    return null;
  }

  return (
    <ItemModel
      gltfDataURI={gltfDataURI}
      litInfo={litInfo}
      effectConfig={effectConfig}
      debugConfig={debugConfig}
      projectId={projectId}
      projectDir={projectDir}
      forgePreview={forgePreview ?? null}
      workbenchDummies={workbenchDummies}
    />
  );
}
