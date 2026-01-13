import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// Color palette for different meshes (easily distinguishable colors)
export const MESH_COLORS = [
  '#ffcc00', // yellow (mesh 0)
  '#00ccff', // cyan (mesh 1)
  '#ff6600', // orange (mesh 2)
  '#cc00ff', // purple (mesh 3)
  '#00ff66', // green (mesh 4)
  '#ff0066', // pink (mesh 5)
  '#6600ff', // blue (mesh 6)
  '#66ff00', // lime (mesh 7)
];

export function getMeshColor(meshIndex: number): string {
  return MESH_COLORS[meshIndex % MESH_COLORS.length];
}

export interface BoundingSphereData {
  node: THREE.Object3D;
  radius: number;
  center: THREE.Vector3;
  id: number;
  meshIndex: number;
}

/**
 * Extracts bounding sphere nodes from a loaded glTF scene.
 * Bounding spheres are identified by their name pattern and extras metadata.
 */
export function extractBoundingSpheres(scene: THREE.Group): BoundingSphereData[] {
  const spheres: BoundingSphereData[] = [];

  scene.traverse((object) => {
    if (object.name.startsWith('BoundingSphere') && object.userData) {
      const { radius, center, id, type, mesh_index } = object.userData;

      if (type !== 'bounding_sphere') {
        console.warn(`BoundingSphere node "${object.name}" has wrong type: ${type}`);
        return;
      }

      if (radius === undefined || id === undefined || center === undefined) {
        console.warn(`BoundingSphere node "${object.name}" missing radius, center, or id`);
        return;
      }

      spheres.push({
        node: object,
        radius,
        center: new THREE.Vector3(center[0], center[1], center[2]),
        id,
        meshIndex: mesh_index ?? 0 // default to mesh 0 for legacy files
      });
    }
  });

  return spheres.sort((a, b) => a.id - b.id);
}

interface BoundingSphereIndicatorsProps {
  spheres: BoundingSphereData[];
  visible: boolean;
  scene: THREE.Group;
  visibleMeshIndices?: Set<number>; // Optional filter: only show spheres for these mesh indices
}

/**
 * Renders visual indicators for bounding spheres in the character model.
 * Spheres are rendered as wireframes and update with character animations.
 * Color-coded by mesh index they belong to.
 */
export function BoundingSphereIndicators({ spheres, visible, scene, visibleMeshIndices }: BoundingSphereIndicatorsProps) {
  if (!visible || spheres.length === 0) {
    return null;
  }

  // Find the skeleton in the scene
  let skeleton: THREE.Skeleton | null = null;
  scene.traverse((object) => {
    if (object instanceof THREE.SkinnedMesh && object.skeleton) {
      skeleton = object.skeleton;
    }
  });

  // Build a map of dummies by ID
  const dummiesById = new Map<number, THREE.Object3D>();
  scene.traverse((object) => {
    if (object.userData?.dummy === true && object.userData?.id !== undefined) {
      dummiesById.set(object.userData.id, object);
    }
  });

  // Filter spheres by visible mesh indices if specified
  const filteredSpheres = visibleMeshIndices 
    ? spheres.filter(s => visibleMeshIndices.has(s.meshIndex))
    : spheres;

  return (
    <>
      {filteredSpheres.map(({ node, radius, center, id, meshIndex }) => (
        <BoundingSphere
          key={id}
          node={node}
          radius={radius}
          center={center}
          id={id}
          meshIndex={meshIndex}
          skeleton={skeleton}
          dummiesById={dummiesById}
        />
      ))}
    </>
  );
}

interface BoundingSphereProps {
  node: THREE.Object3D;
  radius: number;
  center: THREE.Vector3;
  id: number;
  meshIndex: number;
  skeleton: THREE.Skeleton | null;
  dummiesById: Map<number, THREE.Object3D>;
}

/**
 * Individual bounding sphere visualization.
 * Implements the transform calculation from animation-helpers.md:
 * 1. Find dummy with matching ID
 * 2. Get boneMatrix from skeleton.boneMatrices (already includes inverse bind)
 * 3. dummyWorld = dummyLocal * boneMatrix
 * 4. sphereWorld = dummyWorld * translate(sphere.center)
 * 
 * Color is determined by the mesh index the sphere belongs to.
 */
function BoundingSphere({ node, radius, center, id, meshIndex, skeleton, dummiesById }: BoundingSphereProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const debugOnce = useRef(false);

  useFrame(() => {
    if (!meshRef.current) return;

    if (!skeleton) {
      if (!debugOnce.current) {
        console.log('BoundingSphere: skeleton is null');
        debugOnce.current = true;
      }
      return;
    }

    // Find the dummy node with matching ID
    const dummyNode = dummiesById.get(id);
    if (!dummyNode) {
      if (!debugOnce.current) {
        console.log(`BoundingSphere: dummy with id ${id} not found for`, node.name);
        debugOnce.current = true;
      }
      return;
    }

    // Find the parent bone of the dummy
    let parentBone: THREE.Bone | null = null;
    let current = dummyNode.parent;
    while (current) {
      if (current instanceof THREE.Bone) {
        parentBone = current;
        break;
      }
      current = current.parent;
    }

    if (!parentBone) {
      if (!debugOnce.current) {
        console.log(`BoundingSphere: parentBone not found for dummy`, dummyNode.name);
        debugOnce.current = true;
      }
      return;
    }

    // Find the bone index in the skeleton
    const boneIndex = skeleton.bones.indexOf(parentBone);
    if (boneIndex === -1) {
      if (!debugOnce.current) {
        console.log('BoundingSphere: bone not in skeleton', parentBone.name);
        debugOnce.current = true;
      }
      return;
    }

    // Update skeleton to compute boneMatrices for current frame
    skeleton.update();

    // Get bone matrix from skeleton.boneMatrices (already includes inverse bind)
    // boneMatrices is a Float32Array with 16 floats per matrix
    const boneMatrix = new THREE.Matrix4().fromArray(skeleton.boneMatrices, boneIndex * 16);

    // Get dummy's local matrix
    dummyNode.updateMatrix();
    const dummyLocal = dummyNode.matrix.clone();

    // Compute: dummyWorld = dummyLocal * boneMatrix
    const dummyWorld = new THREE.Matrix4().multiplyMatrices(dummyLocal, boneMatrix);

    // Apply sphere center offset: sphereWorld = dummyWorld * translate(center)
    const centerMatrix = new THREE.Matrix4().makeTranslation(center.x, center.y, center.z);
    const sphereWorld = new THREE.Matrix4().multiplyMatrices(dummyWorld, centerMatrix);

    if (!debugOnce.current) {
      console.log('BoundingSphere calculation:', {
        nodeName: node.name,
        dummyName: dummyNode.name,
        boneName: parentBone.name,
        boneIndex,
        center: center.toArray(),
        finalPosition: new THREE.Vector3().setFromMatrixPosition(sphereWorld).toArray()
      });
      debugOnce.current = true;
    }

    // Update mesh position and rotation
    meshRef.current.position.setFromMatrixPosition(sphereWorld);
    meshRef.current.quaternion.setFromRotationMatrix(sphereWorld);
  });

  const color = getMeshColor(meshIndex);

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[radius, 16, 16]} />
      <meshBasicMaterial
        color={color}
        wireframe
        opacity={0.6}
        transparent
        depthTest={true}
        depthWrite={false}
      />
    </mesh>
  );
}
