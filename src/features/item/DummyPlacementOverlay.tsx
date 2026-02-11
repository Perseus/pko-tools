import { useRef, useEffect, useCallback } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useAtomValue } from "jotai";
import { dummyPlacementModeAtom } from "@/store/workbench";

interface DummyPlacementOverlayProps {
  onPlace: (position: [number, number, number]) => void;
}

/**
 * Three.js overlay for click-to-place dummy mode.
 * Raycasts against all scene meshes (the actual model surface) so dummies
 * are placed directly on the model geometry in model-local coordinates.
 */
export function DummyPlacementOverlay({ onPlace }: DummyPlacementOverlayProps) {
  const placementMode = useAtomValue(dummyPlacementModeAtom);
  const ghostRef = useRef<THREE.Mesh>(null);
  const raycasterRef = useRef(new THREE.Raycaster());
  const { scene, camera, gl, pointer } = useThree();

  // Raycast against scene meshes, skipping the ghost cube
  const raycastScene = useCallback(() => {
    raycasterRef.current.setFromCamera(pointer, camera);
    const intersects = raycasterRef.current.intersectObjects(
      scene.children,
      true
    );
    for (const hit of intersects) {
      if (hit.object === ghostRef.current) continue;
      return hit.point;
    }
    return null;
  }, [scene, camera, pointer]);

  // Update ghost position each frame by raycasting under the cursor
  useFrame(() => {
    if (!placementMode || !ghostRef.current) return;
    const point = raycastScene();
    if (point) {
      ghostRef.current.position.copy(point);
      ghostRef.current.visible = true;
    } else {
      ghostRef.current.visible = false;
    }
  });

  // Listen for clicks on the canvas to place dummies
  useEffect(() => {
    if (!placementMode) return;
    const canvas = gl.domElement;
    function handleClick() {
      const point = raycastScene();
      if (!point) return;
      // Convert from viewer Y-up space to LGO Z-up space
      // Viewer rotation={[-PI/2, 0, 0]} maps LGO (x,y,z) → Viewer (x,z,-y)
      // Inverse: Viewer (x,y,z) → LGO (x, -z, y)
      onPlace([point.x, -point.z, point.y]);
    }
    canvas.addEventListener("click", handleClick);
    return () => canvas.removeEventListener("click", handleClick);
  }, [placementMode, gl, raycastScene, onPlace]);

  if (!placementMode) return null;

  return (
    <mesh ref={ghostRef} visible={false}>
      <boxGeometry args={[0.06, 0.06, 0.06]} />
      <meshBasicMaterial color="#ffff00" transparent opacity={0.5} />
    </mesh>
  );
}
