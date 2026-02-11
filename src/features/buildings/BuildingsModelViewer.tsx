import { useEffect, useState } from "react";
import { useGLTF, useAnimations } from "@react-three/drei";
import * as THREE from "three";

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

function BuildingModel({ gltfDataURI }: { gltfDataURI: string }) {
  const { scene, animations } = useGLTF(gltfDataURI);
  const { actions } = useAnimations(animations, scene);

  useEffect(() => {
    if (animations.length > 0) {
      const action = actions[animations[0].name];
      if (action) {
        action.reset().setLoop(THREE.LoopRepeat, Infinity).play();
      }
    }
    return () => {
      Object.values(actions).forEach((a) => a?.stop());
    };
  }, [animations, actions]);

  return <primitive object={scene} />;
}

export default function BuildingsModelViewer({
  gltfJson,
}: {
  gltfJson: string;
}) {
  const [dataURI, setDataURI] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    jsonToDataURI(gltfJson).then((uri) => {
      if (!cancelled) setDataURI(uri);
    });
    return () => {
      cancelled = true;
    };
  }, [gltfJson]);

  if (!dataURI) return null;

  return <BuildingModel gltfDataURI={dataURI} />;
}
