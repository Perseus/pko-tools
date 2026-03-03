import { useEffect } from "react";
import { useGLTF, useAnimations } from "@react-three/drei";
import * as THREE from "three";
import { useGltfResource } from "@/hooks/use-gltf-resource";

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
  const dataURI = useGltfResource(gltfJson);

  useEffect(() => {
    return () => {
      if (dataURI) {
        useGLTF.clear(dataURI);
      }
    };
  }, [dataURI]);

  if (!dataURI) return null;

  return <BuildingModel gltfDataURI={dataURI} />;
}
