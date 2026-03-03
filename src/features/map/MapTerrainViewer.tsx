import { useEffect, useMemo, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { MapViewConfig } from "@/types/map";
import { useGltfResource } from "@/hooks/use-gltf-resource";

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
        <ObjectMarkerInstances markers={objectMarkers} />}
    </group>
  );
}

const _markerMatrix = new THREE.Matrix4();

function ObjectMarkerInstances({
  markers,
}: {
  markers: { position: THREE.Vector3; type: number; id: number }[];
}) {
  const terrainMarkers = useMemo(
    () => markers.filter((marker) => marker.type === 0),
    [markers],
  );
  const objectMarkers = useMemo(
    () => markers.filter((marker) => marker.type !== 0),
    [markers],
  );

  const terrainRef = useRef<THREE.InstancedMesh>(null);
  const objectRef = useRef<THREE.InstancedMesh>(null);

  useEffect(() => {
    const mesh = terrainRef.current;
    if (!mesh) return;

    terrainMarkers.forEach((marker, index) => {
      _markerMatrix.makeTranslation(
        marker.position.x,
        marker.position.y,
        marker.position.z,
      );
      mesh.setMatrixAt(index, _markerMatrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [terrainMarkers]);

  useEffect(() => {
    const mesh = objectRef.current;
    if (!mesh) return;

    objectMarkers.forEach((marker, index) => {
      _markerMatrix.makeTranslation(
        marker.position.x,
        marker.position.y,
        marker.position.z,
      );
      mesh.setMatrixAt(index, _markerMatrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [objectMarkers]);

  return (
    <>
      {terrainMarkers.length > 0 && (
        <instancedMesh
          ref={terrainRef}
          args={[undefined, undefined, terrainMarkers.length]}
        >
          <sphereGeometry args={[0.5, 8, 6]} />
          <meshBasicMaterial color="#22c55e" transparent opacity={0.7} />
        </instancedMesh>
      )}
      {objectMarkers.length > 0 && (
        <instancedMesh
          ref={objectRef}
          args={[undefined, undefined, objectMarkers.length]}
        >
          <sphereGeometry args={[0.5, 8, 6]} />
          <meshBasicMaterial color="#f97316" transparent opacity={0.7} />
        </instancedMesh>
      )}
    </>
  );
}

export default function MapTerrainViewer({
  gltfJson,
  viewConfig,
}: {
  gltfJson: string;
  viewConfig: MapViewConfig;
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

  return <TerrainModel gltfDataURI={dataURI} viewConfig={viewConfig} />;
}
