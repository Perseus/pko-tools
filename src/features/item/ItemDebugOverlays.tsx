import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { Html } from "@react-three/drei";

// ============================================================================
// SHARED CONSTANTS (duplicated from character module, no cross-feature imports)
// ============================================================================

const MESH_COLORS = [
  "#ffcc00", // yellow
  "#00ccff", // cyan
  "#ff6600", // orange
  "#cc00ff", // purple
  "#00ff66", // green
  "#ff0066", // pink
  "#6600ff", // blue
  "#66ff00", // lime
];

function getMeshColor(meshIndex: number): string {
  return MESH_COLORS[meshIndex % MESH_COLORS.length];
}

const BONE_HELPER_SCALE_PERCENT = 0.015;
const DUMMY_HELPER_SCALE_MULTIPLIER = 1.5;
const CLICK_TARGET_SCALE_MULTIPLIER = 2;
const DEFAULT_HELPER_SIZE = 0.02;

/**
 * Get a node's position relative to the scene root.
 * Click targets and overlays are siblings of <primitive object={scene}> inside
 * the rotated group, so positions must be in the scene's local space — NOT
 * world space — otherwise the group rotation gets applied twice.
 */
function getPositionRelativeToScene(
  node: THREE.Object3D,
  scene: THREE.Object3D
): THREE.Vector3 {
  node.updateWorldMatrix(true, false);
  scene.updateWorldMatrix(true, false);
  const sceneInverse = new THREE.Matrix4().copy(scene.matrixWorld).invert();
  const relativeMatrix = new THREE.Matrix4().multiplyMatrices(
    sceneInverse,
    node.matrixWorld
  );
  return new THREE.Vector3().setFromMatrixPosition(relativeMatrix);
}

function calculateHelperScale(scene: THREE.Object3D): number {
  const box = new THREE.Box3().setFromObject(scene);
  const size = new THREE.Vector3();
  box.getSize(size);
  const maxDimension = Math.max(size.x, size.y, size.z);
  if (maxDimension < 0.001 || !isFinite(maxDimension)) {
    return DEFAULT_HELPER_SIZE;
  }
  return maxDimension * BONE_HELPER_SCALE_PERCENT;
}

// ============================================================================
// EXTRACTION FUNCTIONS
// ============================================================================

export interface ItemBoundingSphereData {
  node: THREE.Object3D;
  radius: number;
  center: THREE.Vector3;
  id: number;
}

export function extractItemBoundingSpheres(
  scene: THREE.Object3D
): ItemBoundingSphereData[] {
  const spheres: ItemBoundingSphereData[] = [];

  scene.traverse((object) => {
    if (object.userData?.type === "bounding_sphere") {
      const { radius, center, id } = object.userData;
      if (radius === undefined || id === undefined || center === undefined)
        return;

      spheres.push({
        node: object,
        radius,
        center: new THREE.Vector3(center[0], center[1], center[2]),
        id,
      });
    }
  });

  return spheres.sort((a, b) => a.id - b.id);
}

export interface ItemDummyData {
  node: THREE.Object3D;
  id: number;
  name: string;
}

export function extractItemDummies(scene: THREE.Object3D): ItemDummyData[] {
  const dummies: ItemDummyData[] = [];

  scene.traverse((child) => {
    if (child.userData?.type === "dummy") {
      dummies.push({
        node: child,
        id: child.userData.id ?? 0,
        name: child.name,
      });
    }
  });

  return dummies;
}

export interface ItemMeshData {
  mesh: THREE.Mesh;
  index: number;
  name: string;
}

export function extractItemMeshes(scene: THREE.Object3D): ItemMeshData[] {
  const meshes: ItemMeshData[] = [];
  let discoveryIndex = 0;

  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    // Skip glow overlay and helper nodes
    if (
      object.name === "glow_overlay" ||
      object.userData?.glowOverlay === true ||
      object.userData?.isHelper === true
    )
      return;

    meshes.push({
      mesh: object,
      index: discoveryIndex,
      name: object.name || `Mesh ${discoveryIndex}`,
    });
    discoveryIndex++;
  });

  return meshes;
}

// ============================================================================
// BOUNDING SPHERE INDICATORS (static — no skeleton animation)
// ============================================================================

interface ItemBoundingSphereIndicatorsProps {
  spheres: ItemBoundingSphereData[];
  visible: boolean;
}

export function ItemBoundingSphereIndicators({
  spheres,
  visible,
}: ItemBoundingSphereIndicatorsProps) {
  if (!visible || spheres.length === 0) return null;

  return (
    <>
      {spheres.map(({ radius, center, id }) => (
        <mesh key={id} position={[center.x, center.y, center.z]}>
          <sphereGeometry args={[radius, 16, 16]} />
          <meshBasicMaterial
            color={getMeshColor(id)}
            wireframe
            opacity={0.6}
            transparent
            depthTest
            depthWrite={false}
          />
        </mesh>
      ))}
    </>
  );
}

// ============================================================================
// MESH HIGHLIGHTS (wireframe overlays)
// ============================================================================

const wireframeMap = new WeakMap<THREE.Mesh, THREE.LineSegments>();

interface ItemMeshHighlightsProps {
  meshes: ItemMeshData[];
  visible: boolean;
}

export function ItemMeshHighlights({
  meshes,
  visible,
}: ItemMeshHighlightsProps) {
  useEffect(() => {
    meshes.forEach(({ mesh, index }) => {
      let wireframe = wireframeMap.get(mesh);

      if (visible) {
        if (!wireframe) {
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
          mesh.add(wireframe);
          wireframeMap.set(mesh, wireframe);
        }
        wireframe.visible = true;
      } else if (wireframe) {
        wireframe.visible = false;
      }
    });
  }, [meshes, visible]);

  useEffect(() => {
    return () => {
      meshes.forEach(({ mesh }) => {
        const wireframe = wireframeMap.get(mesh);
        if (wireframe) {
          mesh.remove(wireframe);
          wireframe.geometry.dispose();
          (wireframe.material as THREE.Material).dispose();
          wireframeMap.delete(mesh);
        }
      });
    };
  }, [meshes]);

  return null;
}

// ============================================================================
// DUMMY HELPERS
// ============================================================================

// Materials (shared for performance)
let dummyMaterial: THREE.MeshBasicMaterial | null = null;
let pinnedMaterial: THREE.MeshBasicMaterial | null = null;

function getOrCreateMaterials() {
  if (!dummyMaterial) {
    dummyMaterial = new THREE.MeshBasicMaterial({
      color: 0xff00ff,
      depthTest: false,
      depthWrite: false,
    });
  }
  if (!pinnedMaterial) {
    pinnedMaterial = new THREE.MeshBasicMaterial({
      color: 0xffff00,
      depthTest: false,
      depthWrite: false,
    });
  }
  return { dummyMaterial, pinnedMaterial };
}

let unitBoxGeometry: THREE.BoxGeometry | null = null;

function getOrCreateBoxGeometry() {
  if (!unitBoxGeometry) {
    unitBoxGeometry = new THREE.BoxGeometry(1, 1, 1);
  }
  return unitBoxGeometry;
}

const dummyHelperMap = new WeakMap<THREE.Object3D, THREE.Mesh>();

interface ObjectInfo {
  object: THREE.Object3D;
}

interface ItemDummyHelpersProps {
  scene: THREE.Object3D;
  showDummies: boolean;
}

export function ItemDummyHelpers({
  scene,
  showDummies,
}: ItemDummyHelpersProps) {
  const [dummies, setDummies] = useState<THREE.Object3D[]>([]);
  const [hoveredObject, setHoveredObject] = useState<ObjectInfo | null>(null);
  const [pinnedObject, setPinnedObject] = useState<ObjectInfo | null>(null);

  const helperScale = useMemo(() => calculateHelperScale(scene), [scene]);

  useEffect(() => {
    const found: THREE.Object3D[] = [];
    scene.traverse((child) => {
      if (child.userData?.type === "dummy") {
        found.push(child);
      }
    });
    setDummies(found);
  }, [scene]);

  // Add/remove helpers as direct children of dummy nodes
  useEffect(() => {
    const { dummyMaterial: dMat, pinnedMaterial: pMat } =
      getOrCreateMaterials();
    const boxGeo = getOrCreateBoxGeometry();

    dummies.forEach((dummy) => {
      let helper = dummyHelperMap.get(dummy);
      const isPinned = pinnedObject?.object === dummy;

      if (showDummies) {
        if (!helper) {
          helper = new THREE.Mesh(boxGeo, dMat);
          helper.name = `helper_dummy_${dummy.name}`;
          helper.renderOrder = 1000;
          helper.userData.isHelper = true;
          helper.userData.helperType = "dummy";
          helper.userData.targetObject = dummy;
          helper.scale.setScalar(helperScale * DUMMY_HELPER_SCALE_MULTIPLIER);
          dummy.add(helper);
          dummyHelperMap.set(dummy, helper);
        }
        helper.visible = true;
        helper.material = isPinned ? pMat! : dMat!;
        helper.scale.setScalar(helperScale * DUMMY_HELPER_SCALE_MULTIPLIER);
      } else if (helper) {
        helper.visible = false;
      }
    });
  }, [dummies, showDummies, pinnedObject, helperScale]);

  useEffect(() => {
    return () => {
      dummies.forEach((dummy) => {
        const helper = dummyHelperMap.get(dummy);
        if (helper) {
          dummy.remove(helper);
          dummyHelperMap.delete(dummy);
        }
      });
    };
  }, [dummies]);

  const handleHover = (object: THREE.Object3D) => {
    if (!pinnedObject) {
      setHoveredObject({ object });
    }
  };

  const handleUnhover = () => {
    if (!pinnedObject) {
      setHoveredObject(null);
    }
  };

  const handleClick = (object: THREE.Object3D) => {
    if (pinnedObject?.object === object) {
      setPinnedObject(null);
      setHoveredObject(null);
    } else {
      setPinnedObject({ object });
      setHoveredObject(null);
    }
  };

  const handleClickAway = () => {
    setPinnedObject(null);
    setHoveredObject(null);
  };

  const displayedObject = pinnedObject || hoveredObject;

  return (
    <>
      {showDummies &&
        dummies.map((dummy, index) => (
          <DummyClickTarget
            key={`dummy-click-${index}`}
            dummy={dummy}
            scene={scene}
            scale={helperScale}
            onHover={() => handleHover(dummy)}
            onUnhover={handleUnhover}
            onClick={() => handleClick(dummy)}
          />
        ))}

      {pinnedObject && (
        <mesh onClick={handleClickAway} position={[0, 0, -1000]}>
          <planeGeometry args={[10000, 10000]} />
          <meshBasicMaterial transparent opacity={0} />
        </mesh>
      )}

      {displayedObject && (
        <ItemObjectInfoOverlay
          object={displayedObject.object}
          scene={scene}
          isPinned={!!pinnedObject}
        />
      )}
    </>
  );
}

// ============================================================================
// CLICK TARGETS + OVERLAY
// ============================================================================

interface DummyClickTargetProps {
  dummy: THREE.Object3D;
  scene: THREE.Object3D;
  scale: number;
  onHover: () => void;
  onUnhover: () => void;
  onClick: () => void;
}

function DummyClickTarget({
  dummy,
  scene,
  scale,
  onHover,
  onUnhover,
  onClick,
}: DummyClickTargetProps) {
  // Position relative to the scene root so the parent group rotation
  // isn't applied twice.
  const position = useMemo<[number, number, number]>(() => {
    const p = getPositionRelativeToScene(dummy, scene);
    return [p.x, p.y, p.z];
  }, [dummy, scene]);

  const clickTargetSize =
    scale * DUMMY_HELPER_SCALE_MULTIPLIER * CLICK_TARGET_SCALE_MULTIPLIER;

  return (
    <mesh
      position={position}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        onHover();
      }}
      onPointerOut={(e) => {
        e.stopPropagation();
        onUnhover();
      }}
    >
      <boxGeometry args={[clickTargetSize, clickTargetSize, clickTargetSize]} />
      <meshBasicMaterial transparent opacity={0} />
    </mesh>
  );
}

interface ItemObjectInfoOverlayProps {
  object: THREE.Object3D;
  scene: THREE.Object3D;
  isPinned: boolean;
}

function ItemObjectInfoOverlay({
  object,
  scene,
  isPinned,
}: ItemObjectInfoOverlayProps) {
  const localPos = useMemo(
    () => getPositionRelativeToScene(object, scene),
    [object, scene]
  );

  const name = object.name || "Unnamed";

  // When not pinned (hover only), disable pointer events on the overlay so it
  // doesn't steal focus from the click target and cause hover flicker.
  return (
    <Html
      position={[localPos.x, localPos.y, localPos.z]}
      style={{ pointerEvents: isPinned ? "auto" : "none" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "rgba(0, 0, 0, 0.95)",
          color: "#fff",
          padding: "16px",
          borderRadius: "8px",
          fontSize: "14px",
          fontFamily: "monospace",
          minWidth: "400px",
          maxWidth: "600px",
          border: isPinned ? "2px solid #ffff00" : "1px solid #666",
          userSelect: isPinned ? "text" : "none",
          cursor: isPinned ? "text" : "default",
          transform: "translateY(-100%) translateY(-12px)",
        }}
      >
        <div
          style={{
            marginBottom: "10px",
            fontWeight: "bold",
            fontSize: "16px",
            color: "#ffff00",
          }}
        >
          Dummy: {name} {isPinned && "(pinned)"}
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "160px 1fr",
            gap: "6px",
            fontSize: "13px",
          }}
        >
          <div style={{ color: "#888" }}>Type:</div>
          <div>{object.type}</div>

          <div style={{ color: "#888" }}>UUID:</div>
          <div style={{ fontSize: "12px", wordBreak: "break-all" }}>
            {object.uuid}
          </div>

          <div style={{ color: "#888" }}>Local Position:</div>
          <div style={{ wordWrap: "break-word" }}>
            [
            {object.position
              .toArray()
              .map((v) => v.toFixed(6))
              .join(", ")}
            ]
          </div>

          <div style={{ color: "#888" }}>World Position:</div>
          <div style={{ wordWrap: "break-word" }}>
            [
            {new THREE.Vector3()
              .setFromMatrixPosition(object.matrixWorld)
              .toArray()
              .map((v) => v.toFixed(6))
              .join(", ")}
            ]
          </div>

          <div style={{ color: "#888" }}>Local Rotation:</div>
          <div style={{ wordWrap: "break-word" }}>
            [
            {[object.rotation.x, object.rotation.y, object.rotation.z]
              .map((v) => v.toFixed(6))
              .join(", ")}
            ]
          </div>

          <div style={{ color: "#888" }}>Quaternion:</div>
          <div style={{ wordWrap: "break-word" }}>
            [
            {object.quaternion
              .toArray()
              .map((v) => v.toFixed(6))
              .join(", ")}
            ]
          </div>

          <div style={{ color: "#888" }}>Scale:</div>
          <div style={{ wordWrap: "break-word" }}>
            [
            {object.scale
              .toArray()
              .map((v) => v.toFixed(6))
              .join(", ")}
            ]
          </div>

          <div style={{ color: "#888" }}>Parent:</div>
          <div style={{ wordWrap: "break-word" }}>
            {object.parent?.name || "None"}
          </div>

          <div style={{ color: "#888" }}>Children:</div>
          <div style={{ wordWrap: "break-word" }}>
            {object.children.filter((c) => !c.userData?.isHelper).length > 0
              ? object.children
                  .filter((c) => !c.userData?.isHelper)
                  .map((c) => c.name || "Unnamed")
                  .join(", ")
              : "None"}
          </div>
        </div>

        {Object.keys(object.userData).length > 0 && (
          <div
            style={{
              marginTop: "10px",
              paddingTop: "10px",
              borderTop: "1px solid #444",
            }}
          >
            <div
              style={{ color: "#888", marginBottom: "6px", fontSize: "13px" }}
            >
              UserData:
            </div>
            <pre
              style={{
                margin: 0,
                fontSize: "12px",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
              }}
            >
              {JSON.stringify(object.userData, null, 2)}
            </pre>
          </div>
        )}

        <div
          style={{
            marginTop: "10px",
            fontSize: "11px",
            color: "#666",
            fontStyle: "italic",
          }}
        >
          {isPinned
            ? "Click the object again or click away to dismiss"
            : "Click to pin this info"}
        </div>
      </div>
    </Html>
  );
}
