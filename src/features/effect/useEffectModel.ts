import { useEffect, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { loadEffectModel } from "@/commands/effect";

export interface EffectModelDummyPoint {
  id: number;
  matrix: THREE.Matrix4;
  position: THREE.Vector3;
  name: string;
}

export interface EffectModelResource {
  geometry: THREE.BufferGeometry | null;
  dummies: EffectModelDummyPoint[];
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
}

const resourceCache = new Map<string, EffectModelResource>();
const loader = new GLTFLoader();

export function extractEffectModelDummyPoints(scene: THREE.Object3D): EffectModelDummyPoint[] {
  scene.updateMatrixWorld(true);
  const sceneWorldInverse = new THREE.Matrix4().copy(scene.matrixWorld).invert();
  const dummies: EffectModelDummyPoint[] = [];

  scene.traverse((child) => {
    if (child.userData?.type !== "dummy") return;
    const matrix = new THREE.Matrix4().multiplyMatrices(sceneWorldInverse, child.matrixWorld);
    dummies.push({
      id: child.userData.id ?? 0,
      matrix,
      position: new THREE.Vector3().setFromMatrixPosition(matrix),
      name: child.name,
    });
  });

  return dummies;
}

function parseGltfJson(json: string): Promise<EffectModelResource> {
  const encoder = new TextEncoder();
  const data = encoder.encode(json);

  return new Promise((resolve, reject) => {
    loader.parse(
      data.buffer,
      "",
      (gltf) => {
        let found: THREE.BufferGeometry | null = null;
        gltf.scene.traverse((child) => {
          if (!found && (child as THREE.Mesh).isMesh) {
            found = (child as THREE.Mesh).geometry;
          }
        });
        resolve({
          geometry: found,
          dummies: extractEffectModelDummyPoints(gltf.scene),
          scene: gltf.scene,
          animations: gltf.animations ?? [],
        });
      },
      (err) => reject(err),
    );
  });
}

export function useEffectModelResource(
  modelName: string | undefined,
  projectId: string | undefined
): EffectModelResource | null {
  const [resource, setResource] = useState<EffectModelResource | null>(null);

  useEffect(() => {
    if (!modelName || !projectId) {
      setResource(null);
      return;
    }

    const cacheKey = `${projectId}:${modelName}`;
    const cached = resourceCache.get(cacheKey);
    if (cached) {
      setResource(cached);
      return;
    }

    let cancelled = false;
    setResource(null);

    loadEffectModel(projectId, modelName)
      .then((gltfJson) => {
        if (cancelled) return null;
        return parseGltfJson(gltfJson);
      })
      .then((loaded) => {
        if (cancelled || !loaded) return;
        resourceCache.set(cacheKey, loaded);
        setResource(loaded);
      })
      .catch(() => {
        if (!cancelled) {
          setResource(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [modelName, projectId]);

  return resource;
}

export function useEffectModel(
  modelName: string | undefined,
  projectId: string | undefined
): THREE.BufferGeometry | null {
  return useEffectModelResource(modelName, projectId)?.geometry ?? null;
}

export function useEffectModelDummies(
  modelName: string | undefined,
  projectId: string | undefined
): EffectModelDummyPoint[] {
  return useEffectModelResource(modelName, projectId)?.dummies ?? [];
}
