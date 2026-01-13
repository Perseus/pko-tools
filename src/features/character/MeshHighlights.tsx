import { useEffect } from 'react';
import * as THREE from 'three';
import { getMeshColor } from './BoundingSphereIndicators';

export interface MeshInfo {
  mesh: THREE.Mesh | THREE.SkinnedMesh;
  index: number;
  name: string;
}

/**
 * Extracts all meshes from a glTF scene with their indices.
 * Mesh index is determined by the mesh name (e.g., "0725000000" -> mesh 0, "0725000001" -> mesh 1)
 * or by order of discovery if names don't indicate index.
 */
export function extractMeshes(scene: THREE.Group): MeshInfo[] {
  const meshes: MeshInfo[] = [];
  let discoveryIndex = 0;

  scene.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.SkinnedMesh) {
      // Try to extract mesh index from name (last digit of model ID like "0725000001")
      const nameMatch = object.name.match(/\d{10}$/);
      let index = discoveryIndex;
      
      if (nameMatch) {
        // Extract last digit as mesh index (e.g., "0725000001" -> 1)
        const lastDigit = parseInt(nameMatch[0].slice(-1), 10);
        if (!isNaN(lastDigit)) {
          index = lastDigit;
        }
      }

      meshes.push({
        mesh: object,
        index,
        name: object.name || `Mesh ${discoveryIndex}`
      });
      
      discoveryIndex++;
    }
  });

  // Sort by index for consistent ordering
  return meshes.sort((a, b) => a.index - b.index);
}

/**
 * Get unique mesh indices from the scene
 */
export function getUniqueMeshIndices(meshes: MeshInfo[]): number[] {
  const indices = new Set(meshes.map(m => m.index));
  return Array.from(indices).sort((a, b) => a - b);
}

interface MeshHighlightsProps {
  scene: THREE.Group;
  visible: boolean;
  visibleMeshIndices: Set<number>;
}

// Store wireframe objects so we can clean them up
const wireframeMap = new WeakMap<THREE.Mesh | THREE.SkinnedMesh, THREE.LineSegments>();

/**
 * Renders wireframe overlays on meshes to visually distinguish different mesh parts.
 * Each mesh part gets a unique color matching the bounding sphere colors.
 * 
 * This component directly adds wireframe children to the mesh objects so they
 * inherit the correct transformations automatically.
 */
export function MeshHighlights({ scene, visible, visibleMeshIndices }: MeshHighlightsProps) {
  useEffect(() => {
    const meshes: MeshInfo[] = [];
    let discoveryIndex = 0;

    // Find all meshes
    scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.SkinnedMesh) {
        const nameMatch = object.name.match(/\d{10}$/);
        let index = discoveryIndex;
        
        if (nameMatch) {
          const lastDigit = parseInt(nameMatch[0].slice(-1), 10);
          if (!isNaN(lastDigit)) {
            index = lastDigit;
          }
        }

        meshes.push({ mesh: object, index, name: object.name || `Mesh ${discoveryIndex}` });
        discoveryIndex++;
      }
    });

    // Add or update wireframes
    meshes.forEach(({ mesh, index }) => {
      const shouldShow = visible && visibleMeshIndices.has(index);
      let wireframe = wireframeMap.get(mesh);

      if (shouldShow) {
        if (!wireframe) {
          // Create new wireframe
          const edges = new THREE.EdgesGeometry(mesh.geometry, 30);
          const material = new THREE.LineBasicMaterial({
            color: getMeshColor(index),
            linewidth: 2,
            depthTest: false,
            depthWrite: false,
          });
          wireframe = new THREE.LineSegments(edges, material);
          wireframe.renderOrder = 999;
          wireframe.name = `wireframe_${mesh.name}`;
          
          // Add as child of mesh so it inherits transforms
          mesh.add(wireframe);
          wireframeMap.set(mesh, wireframe);
        }
        wireframe.visible = true;
      } else if (wireframe) {
        wireframe.visible = false;
      }
    });

    // No cleanup here - we handle visibility toggle only
  }, [scene, visible, visibleMeshIndices]);
  
  // Separate cleanup effect that only runs when scene changes or unmount
  useEffect(() => {
    return () => {
      // Clean up all wireframes for this scene
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.SkinnedMesh) {
          const wireframe = wireframeMap.get(object);
          if (wireframe) {
            object.remove(wireframe);
            wireframe.geometry.dispose();
            (wireframe.material as THREE.Material).dispose();
            wireframeMap.delete(object);
          }
        }
      });
    };
  }, [scene]);

  // This component doesn't render anything directly - it adds wireframes to the scene
  return null;
}

/**
 * Generates legend info for mesh colors
 */
export function getMeshColorLegend(meshCount: number): Array<{ index: number; color: string; label: string }> {
  return Array.from({ length: meshCount }, (_, i) => ({
    index: i,
    color: getMeshColor(i),
    label: `Mesh ${i}`
  }));
}
