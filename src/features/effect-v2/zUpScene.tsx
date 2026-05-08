import { useLayoutEffect } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";

export const PKO_Z_UP = new THREE.Vector3(0, 0, 1);
export const PKO_Z_UP_GRID_ROTATION: [number, number, number] = [
  Math.PI / 2,
  0,
  0,
];
export const GLTF_Y_UP_TO_PKO_Z_UP_ROTATION: [number, number, number] = [
  Math.PI / 2,
  0,
  0,
];

export function applyPkoZUpCamera(camera: THREE.Camera): void {
  camera.up.copy(PKO_Z_UP);
  camera.updateMatrixWorld();
}

export function PkoZUpCamera() {
  const camera = useThree((state) => state.camera);

  useLayoutEffect(() => {
    applyPkoZUpCamera(camera);
  }, [camera]);

  return null;
}
