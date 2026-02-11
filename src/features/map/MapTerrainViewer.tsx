import { useEffect, useMemo, useState } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { MapViewConfig } from "@/types/map";

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

function TerrainModel({
  gltfDataURI,
  viewConfig,
}: {
  gltfDataURI: string;
  viewConfig: MapViewConfig;
}) {
  const { scene } = useGLTF(gltfDataURI);

  // Extract object markers from child nodes
  const objectMarkers = useMemo(() => {
    const markers: {
      position: THREE.Vector3;
      type: number;
      id: number;
    }[] = [];

    scene.traverse((child) => {
      if (child.userData?.objectType !== undefined) {
        markers.push({
          position: child.position.clone(),
          type: child.userData.objectType,
          id: child.userData.objectId,
        });
      }
    });

    return markers;
  }, [scene]);

  return (
    <group>
      <primitive object={scene} />

      {/* Wireframe overlay */}
      {viewConfig.showWireframe &&
        scene.children.map((child, i) => {
          if (child instanceof THREE.Mesh) {
            return (
              <mesh key={`wire-${i}`} geometry={child.geometry}>
                <meshBasicMaterial
                  wireframe
                  color="#666666"
                  transparent
                  opacity={0.3}
                />
              </mesh>
            );
          }
          return null;
        })}

      {/* Object markers */}
      {viewConfig.showObjectMarkers &&
        objectMarkers.map((marker, i) => (
          <mesh key={`marker-${i}`} position={marker.position}>
            <sphereGeometry args={[0.5, 8, 6]} />
            <meshBasicMaterial
              color={marker.type === 0 ? "#22c55e" : "#f97316"}
              transparent
              opacity={0.7}
            />
          </mesh>
        ))}
    </group>
  );
}

export default function MapTerrainViewer({
  gltfJson,
  viewConfig,
}: {
  gltfJson: string;
  viewConfig: MapViewConfig;
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

  return <TerrainModel gltfDataURI={dataURI} viewConfig={viewConfig} />;
}
