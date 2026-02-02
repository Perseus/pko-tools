import { useEffect, useMemo, useState } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { ItemLitInfo } from "@/types/item";
import { ItemEffectConfig } from "@/store/item";
import { ItemLitRenderer } from "./ItemLitRenderer";
import { ForgeEffectPreview } from "@/types/item";
import { ItemParticleRenderer } from "./ItemParticleRenderer";
import { ItemEffectRenderer } from "./ItemEffectRenderer";

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
  projectId,
  projectDir,
  forgePreview,
}: {
  gltfDataURI: string;
  litInfo: ItemLitInfo | null;
  effectConfig: ItemEffectConfig;
  projectId: string;
  projectDir: string;
  forgePreview: ForgeEffectPreview | null;
}) {
  const { scene } = useGLTF(gltfDataURI);

  // Find the glow overlay mesh and the main weapon mesh.
  // The glow overlay is a separate node named "glow_overlay" with
  // userData.glowOverlay === true (set via glTF node extras).
  const { glowMesh, weaponMesh, dummyPoints } = useMemo(() => {
    // Ensure world matrices are computed before extracting transforms.
    // GLTFLoader sets node.matrix but does NOT compute matrixWorld.
    scene.updateMatrixWorld(true);

    let glow: THREE.Mesh | null = null;
    let weapon: THREE.Mesh | null = null;
    const dummies: { id: number; matrix: THREE.Matrix4; name: string }[] = [];

    scene.traverse((child) => {
      // Check for glow overlay by node name or userData (both for reliability)
      const isGlowOverlay =
        child.name === "glow_overlay" ||
        child.userData?.glowOverlay === true;

      if (isGlowOverlay) {
        // Hide the glow overlay group/mesh — the glow shader renders on top
        child.visible = false;
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
          matrix: child.matrixWorld.clone(),
          name: child.name,
        });
      }
    });

    return { glowMesh: glow as THREE.Mesh | null, weaponMesh: weapon as THREE.Mesh | null, dummyPoints: dummies };
  }, [scene]);

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
            refineLevel={effectConfig.refineLevel}
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
      </group>
    </>
  );
}

export default function ItemModelViewer({
  gltfJson,
  litInfo,
  effectConfig,
  projectId,
  projectDir,
  forgePreview,
}: {
  gltfJson: string | null;
  litInfo: ItemLitInfo | null;
  effectConfig: ItemEffectConfig;
  projectId: string;
  projectDir: string;
  forgePreview: ForgeEffectPreview | null;
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
      projectId={projectId}
      projectDir={projectDir}
      forgePreview={forgePreview ?? null}
    />
  );
}
