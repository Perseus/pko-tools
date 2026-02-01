/// <reference types="@react-three/fiber" />
import { effectBindingAtom, boundBoneMatrixAtom } from "@/store/effect";
import { useAtom, useAtomValue } from "jotai";
import React from "react";
import { useEffect, useRef } from "react";
import { useFrame, useLoader } from "@react-three/fiber";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const GHOST_OPACITY = 0.35;

/**
 * Renders the bound character as a semi-transparent ghost mesh in the effect viewport.
 * Writes the selected bone's world matrix to boundBoneMatrixAtom each frame.
 */
export default function CharacterPreview() {
  const binding = useAtomValue(effectBindingAtom);

  if (!binding.gltfDataUri || binding.status !== "loaded") {
    return null;
  }

  return <CharacterGhost dataUri={binding.gltfDataUri} />;
}

function CharacterGhost({ dataUri }: { dataUri: string }) {
  const gltf = useLoader(GLTFLoader, dataUri);
  const groupRef = useRef<THREE.Group>(null);
  const binding = useAtomValue(effectBindingAtom);
  const [, setBoneMatrix] = useAtom(boundBoneMatrixAtom);
  const boneRef = useRef<THREE.Object3D | null>(null);

  // Make all materials semi-transparent
  useEffect(() => {
    if (!gltf.scene) return;

    gltf.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh && obj.material) {
        const materials = Array.isArray(obj.material)
          ? obj.material
          : [obj.material];
        for (const mat of materials) {
          if (mat instanceof THREE.Material) {
            mat.transparent = true;
            mat.opacity = GHOST_OPACITY;
            mat.depthWrite = false;
          }
        }
      }
    });
  }, [gltf.scene]);

  // Find the selected bone object
  useEffect(() => {
    if (!binding.boundBoneName || !gltf.scene) {
      boneRef.current = null;
      setBoneMatrix(null);
      return;
    }
    let found: THREE.Object3D | null = null;
    gltf.scene.traverse((obj) => {
      if (obj.name === binding.boundBoneName) {
        found = obj;
      }
    });
    boneRef.current = found;
    if (!found) {
      setBoneMatrix(null);
    }
  }, [binding.boundBoneName, gltf.scene, setBoneMatrix]);

  // Write bone world matrix every frame (for EffectMeshRenderer to read)
  useFrame(() => {
    const bone = boneRef.current;
    if (!bone) return;
    bone.updateWorldMatrix(true, false);
    const elements = new Float32Array(16);
    elements.set(bone.matrixWorld.elements);
    setBoneMatrix(elements);
  });

  return (
    <group ref={groupRef} rotation={[-Math.PI / 2, 0, 0]}>
      <primitive object={gltf.scene} />
      {boneRef.current && <BoneIndicator bone={boneRef.current} />}
    </group>
  );
}

/** Small wireframe sphere at the selected bone's position. */
function BoneIndicator({ bone }: { bone: THREE.Object3D }) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    if (!meshRef.current || !bone) return;
    const worldPos = new THREE.Vector3();
    bone.getWorldPosition(worldPos);
    meshRef.current.position.copy(worldPos);
  });

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[0.15, 12, 12]} />
      <meshBasicMaterial
        color="#3b82f6"
        wireframe
        transparent
        opacity={0.8}
      />
    </mesh>
  );
}
