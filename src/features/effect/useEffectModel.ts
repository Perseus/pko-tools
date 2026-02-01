import { useEffect, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { loadEffectModel } from "@/commands/effect";

const geometryCache = new Map<string, THREE.BufferGeometry>();
const loader = new GLTFLoader();

function parseGltfJson(json: string): Promise<THREE.BufferGeometry | null> {
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
        resolve(found);
      },
      (err) => reject(err),
    );
  });
}

export function useEffectModel(
  modelName: string | undefined,
  projectId: string | undefined
): THREE.BufferGeometry | null {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);

  useEffect(() => {
    if (!modelName || !projectId) {
      setGeometry(null);
      return;
    }

    const cacheKey = `${projectId}:${modelName}`;
    const cached = geometryCache.get(cacheKey);
    if (cached) {
      setGeometry(cached);
      return;
    }

    let cancelled = false;

    loadEffectModel(projectId, modelName)
      .then((gltfJson) => {
        if (cancelled) return null;
        return parseGltfJson(gltfJson);
      })
      .then((geo) => {
        if (cancelled || !geo) return;
        geometryCache.set(cacheKey, geo);
        setGeometry(geo);
      })
      .catch(() => {
        // Model failed to load — fall through to fallback geometry in renderer
      });

    return () => {
      cancelled = true;
    };
  }, [modelName, projectId]);

  return geometry;
}
