import React, { useEffect, useState, useMemo } from 'react';
import * as THREE from 'three';
import { Html } from '@react-three/drei';

// ============================================================================
// HELPER SIZE CONFIGURATION
// ============================================================================
// These constants control the size of bone/dummy helpers relative to model size

/** Bone helper size as percentage of model's largest dimension (0.015 = 1.5%) */
export const BONE_HELPER_SCALE_PERCENT = 0.015;

/** Dummy helper size multiplier relative to bone size (1.5 = 50% larger than bones) */
export const DUMMY_HELPER_SCALE_MULTIPLIER = 1.5;

/** Click target size multiplier relative to visual helper (2 = 2x larger for easier clicking) */
export const CLICK_TARGET_SCALE_MULTIPLIER = 2;

/** Fallback helper size when model bounds can't be determined */
export const DEFAULT_HELPER_SIZE = 0.02;

// ============================================================================

interface ObjectInfo {
  object: THREE.Object3D;
  type: 'bone' | 'dummy';
}

interface SkeletonDebugHelpersProps {
  scene: THREE.Group;
  showBones: boolean;
  showDummies: boolean;
}

// Store helper meshes so we can clean them up
const boneHelperMap = new WeakMap<THREE.Bone, THREE.Mesh>();
const dummyHelperMap = new WeakMap<THREE.Object3D, THREE.Mesh>();

// Materials (shared for performance)
let boneMaterial: THREE.MeshBasicMaterial | null = null;
let dummyMaterial: THREE.MeshBasicMaterial | null = null;
let pinnedMaterial: THREE.MeshBasicMaterial | null = null;

function getOrCreateMaterials() {
  if (!boneMaterial) {
    boneMaterial = new THREE.MeshBasicMaterial({ 
      color: 0x00ff00, 
      depthTest: false,
      depthWrite: false,
    });
  }
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
  return { boneMaterial, dummyMaterial, pinnedMaterial };
}

// Unit geometries (will be scaled based on model size)
let unitSphereGeometry: THREE.SphereGeometry | null = null;
let unitBoxGeometry: THREE.BoxGeometry | null = null;

function getOrCreateGeometries() {
  if (!unitSphereGeometry) {
    // Unit sphere with radius 1
    unitSphereGeometry = new THREE.SphereGeometry(1, 8, 8);
  }
  if (!unitBoxGeometry) {
    // Unit box with size 1
    unitBoxGeometry = new THREE.BoxGeometry(1, 1, 1);
  }
  return { unitSphereGeometry, unitBoxGeometry };
}

/**
 * Calculate appropriate helper size based on model bounding box.
 * Returns a scale factor based on BONE_HELPER_SCALE_PERCENT of the model's largest dimension.
 */
function calculateHelperScale(scene: THREE.Group): number {
  const box = new THREE.Box3().setFromObject(scene);
  const size = new THREE.Vector3();
  box.getSize(size);
  
  // Use the largest dimension
  const maxDimension = Math.max(size.x, size.y, size.z);
  
  // If model is very small or invalid, use default
  if (maxDimension < 0.001 || !isFinite(maxDimension)) {
    return DEFAULT_HELPER_SIZE;
  }
  
  return maxDimension * BONE_HELPER_SCALE_PERCENT;
}

export function SkeletonDebugHelpers({ scene, showBones, showDummies }: SkeletonDebugHelpersProps) {
  const [bones, setBones] = useState<THREE.Bone[]>([]);
  const [dummies, setDummies] = useState<THREE.Object3D[]>([]);
  const [hoveredObject, setHoveredObject] = useState<ObjectInfo | null>(null);
  const [pinnedObject, setPinnedObject] = useState<ObjectInfo | null>(null);
  
  // Calculate helper scale based on model size
  const helperScale = useMemo(() => calculateHelperScale(scene), [scene]);

  // Extract bones and dummies once on mount
  useEffect(() => {
    const foundBones: THREE.Bone[] = [];
    const foundDummies: THREE.Object3D[] = [];

    scene.traverse((object) => {
      if (object.type === 'Bone' && !object.userData?.dummy) {
        foundBones.push(object as THREE.Bone);
      }
      if (object.userData?.dummy === true) {
        foundDummies.push(object);
      }
    });

    setBones(foundBones);
    setDummies(foundDummies);
  }, [scene]);

  // Add/remove bone helpers directly as children
  useEffect(() => {
    const { boneMaterial, pinnedMaterial } = getOrCreateMaterials();
    const { unitSphereGeometry } = getOrCreateGeometries();

    bones.forEach((bone) => {
      let helper = boneHelperMap.get(bone);
      const isPinned = pinnedObject?.object === bone;

      if (showBones) {
        if (!helper) {
          helper = new THREE.Mesh(unitSphereGeometry, boneMaterial);
          helper.name = `helper_bone_${bone.name}`;
          helper.renderOrder = 1000;
          helper.userData.isHelper = true;
          helper.userData.helperType = 'bone';
          helper.userData.targetObject = bone;
          helper.scale.setScalar(helperScale);
          bone.add(helper);
          boneHelperMap.set(bone, helper);
        }
        helper.visible = true;
        helper.material = isPinned ? pinnedMaterial! : boneMaterial!;
        helper.scale.setScalar(helperScale); // Update scale in case model changed
      } else if (helper) {
        helper.visible = false;
      }
    });

    // No cleanup here - we handle visibility toggle, cleanup happens when bones array changes
  }, [bones, showBones, pinnedObject, helperScale]);
  
  // Separate cleanup effect that only runs when bones array changes or unmount
  useEffect(() => {
    return () => {
      bones.forEach((bone) => {
        const helper = boneHelperMap.get(bone);
        if (helper) {
          bone.remove(helper);
          boneHelperMap.delete(bone);
        }
      });
    };
  }, [bones]);

  // Add/remove dummy helpers directly as children
  useEffect(() => {
    const { dummyMaterial, pinnedMaterial } = getOrCreateMaterials();
    const { unitBoxGeometry } = getOrCreateGeometries();

    dummies.forEach((dummy) => {
      let helper = dummyHelperMap.get(dummy);
      const isPinned = pinnedObject?.object === dummy;

      if (showDummies) {
        if (!helper) {
          helper = new THREE.Mesh(unitBoxGeometry, dummyMaterial);
          helper.name = `helper_dummy_${dummy.name}`;
          helper.renderOrder = 1000;
          helper.userData.isHelper = true;
          helper.userData.helperType = 'dummy';
          helper.userData.targetObject = dummy;
          helper.scale.setScalar(helperScale * DUMMY_HELPER_SCALE_MULTIPLIER);
          dummy.add(helper);
          dummyHelperMap.set(dummy, helper);
        }
        helper.visible = true;
        helper.material = isPinned ? pinnedMaterial! : dummyMaterial!;
        helper.scale.setScalar(helperScale * DUMMY_HELPER_SCALE_MULTIPLIER);
      } else if (helper) {
        helper.visible = false;
      }
    });

    // No cleanup here - we handle visibility toggle, cleanup happens when dummies array changes
  }, [dummies, showDummies, pinnedObject, helperScale]);
  
  // Separate cleanup effect that only runs when dummies array changes or unmount
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



  const handleHover = (object: THREE.Object3D, type: 'bone' | 'dummy') => {
    if (!pinnedObject) {
      setHoveredObject({ object, type });
    }
  };

  const handleUnhover = () => {
    if (!pinnedObject) {
      setHoveredObject(null);
    }
  };

  const handleClick = (object: THREE.Object3D, type: 'bone' | 'dummy') => {
    if (pinnedObject?.object === object) {
      setPinnedObject(null);
      setHoveredObject(null);
    } else {
      setPinnedObject({ object, type });
      setHoveredObject(null);
    }
  };

  const handleClickAway = () => {
    setPinnedObject(null);
    setHoveredObject(null);
  };

  const displayedObject = pinnedObject || hoveredObject;

  // Render interactive overlays for click/hover detection
  return (
    <>
      {showBones && bones.map((bone, index) => (
        <BoneClickTarget
          key={`bone-click-${index}`}
          bone={bone}
          scale={helperScale}
          onHover={() => handleHover(bone, 'bone')}
          onUnhover={handleUnhover}
          onClick={() => handleClick(bone, 'bone')}
        />
      ))}
      {showDummies && dummies.map((dummy, index) => (
        <DummyClickTarget
          key={`dummy-click-${index}`}
          dummy={dummy}
          scale={helperScale}
          onHover={() => handleHover(dummy, 'dummy')}
          onUnhover={handleUnhover}
          onClick={() => handleClick(dummy, 'dummy')}
        />
      ))}

      {/* Click-away listener */}
      {pinnedObject && (
        <mesh onClick={handleClickAway} position={[0, 0, -1000]}>
          <planeGeometry args={[10000, 10000]} />
          <meshBasicMaterial transparent opacity={0} />
        </mesh>
      )}

      {/* Info overlay */}
      {displayedObject && (
        <ObjectInfoOverlay object={displayedObject.object} type={displayedObject.type} isPinned={!!pinnedObject} />
      )}
    </>
  );
}

// Invisible click targets that follow bone positions
interface BoneClickTargetProps {
  bone: THREE.Bone;
  scale: number;
  onHover: () => void;
  onUnhover: () => void;
  onClick: () => void;
}

function BoneClickTarget({ bone, scale, onHover, onUnhover, onClick }: BoneClickTargetProps) {
  const [position, setPosition] = useState<[number, number, number]>([0, 0, 0]);

  useEffect(() => {
    const updatePosition = () => {
      bone.updateWorldMatrix(true, false);
      const worldPos = new THREE.Vector3().setFromMatrixPosition(bone.matrixWorld);
      setPosition([worldPos.x, worldPos.y, worldPos.z]);
    };

    updatePosition();
    const interval = setInterval(updatePosition, 16); // ~60fps
    return () => clearInterval(interval);
  }, [bone]);

  // Click target is larger than visual helper for easier clicking
  const clickTargetSize = scale * CLICK_TARGET_SCALE_MULTIPLIER;

  return (
    <mesh
      position={position}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onPointerOver={(e) => { e.stopPropagation(); onHover(); }}
      onPointerOut={(e) => { e.stopPropagation(); onUnhover(); }}
    >
      <sphereGeometry args={[clickTargetSize, 8, 8]} />
      <meshBasicMaterial transparent opacity={0} />
    </mesh>
  );
}

interface DummyClickTargetProps {
  dummy: THREE.Object3D;
  scale: number;
  onHover: () => void;
  onUnhover: () => void;
  onClick: () => void;
}

function DummyClickTarget({ dummy, scale, onHover, onUnhover, onClick }: DummyClickTargetProps) {
  const [position, setPosition] = useState<[number, number, number]>([0, 0, 0]);

  useEffect(() => {
    const updatePosition = () => {
      dummy.updateWorldMatrix(true, false);
      const worldPos = new THREE.Vector3().setFromMatrixPosition(dummy.matrixWorld);
      setPosition([worldPos.x, worldPos.y, worldPos.z]);
    };

    updatePosition();
    const interval = setInterval(updatePosition, 16);
    return () => clearInterval(interval);
  }, [dummy]);

  // Click target is larger than visual helper for easier clicking
  const clickTargetSize = scale * DUMMY_HELPER_SCALE_MULTIPLIER * CLICK_TARGET_SCALE_MULTIPLIER;

  return (
    <mesh
      position={position}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onPointerOver={(e) => { e.stopPropagation(); onHover(); }}
      onPointerOut={(e) => { e.stopPropagation(); onUnhover(); }}
    >
      <boxGeometry args={[clickTargetSize, clickTargetSize, clickTargetSize]} />
      <meshBasicMaterial transparent opacity={0} />
    </mesh>
  );
}

interface ObjectInfoOverlayProps {
  object: THREE.Object3D;
  type: 'bone' | 'dummy';
  isPinned: boolean;
}

function ObjectInfoOverlay({ object, type, isPinned }: ObjectInfoOverlayProps) {
  const [worldPos, setWorldPos] = useState(new THREE.Vector3());

  useEffect(() => {
    const updatePosition = () => {
      object.updateWorldMatrix(true, false);
      setWorldPos(new THREE.Vector3().setFromMatrixPosition(object.matrixWorld));
    };

    updatePosition();
    const interval = setInterval(updatePosition, 16);
    return () => clearInterval(interval);
  }, [object]);

  const name = object.name || 'Unnamed';
  const typeName = type === 'bone' ? 'Bone' : 'Dummy';

  return (
    <Html position={[worldPos.x, worldPos.y, worldPos.z]} style={{ pointerEvents: 'auto' }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'rgba(0, 0, 0, 0.95)',
          color: '#fff',
          padding: '16px',
          borderRadius: '8px',
          fontSize: '14px',
          fontFamily: 'monospace',
          minWidth: '400px',
          maxWidth: '600px',
          border: isPinned ? '2px solid #ffff00' : '1px solid #666',
          userSelect: 'text',
          cursor: 'text',
        }}
      >
        <div style={{ marginBottom: '10px', fontWeight: 'bold', fontSize: '16px', color: '#ffff00' }}>
          {typeName}: {name} {isPinned && '📌'}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: '6px', fontSize: '13px' }}>
          <div style={{ color: '#888' }}>Type:</div>
          <div>{object.type}</div>

          <div style={{ color: '#888' }}>UUID:</div>
          <div style={{ fontSize: '12px', wordBreak: 'break-all' }}>{object.uuid}</div>

          <div style={{ color: '#888' }}>Local Position:</div>
          <div style={{ wordWrap: 'break-word' }}>[{object.position.toArray().map(v => v.toFixed(6)).join(', ')}]</div>

          <div style={{ color: '#888' }}>World Position:</div>
          <div style={{ wordWrap: 'break-word' }}>[{worldPos.toArray().map(v => v.toFixed(6)).join(', ')}]</div>

          <div style={{ color: '#888' }}>Local Rotation:</div>
          <div style={{ wordWrap: 'break-word' }}>[{[object.rotation.x, object.rotation.y, object.rotation.z].map(v => v.toFixed(6)).join(', ')}]</div>

          <div style={{ color: '#888' }}>Quaternion:</div>
          <div style={{ wordWrap: 'break-word' }}>[{object.quaternion.toArray().map(v => v.toFixed(6)).join(', ')}]</div>

          <div style={{ color: '#888' }}>Scale:</div>
          <div style={{ wordWrap: 'break-word' }}>[{object.scale.toArray().map(v => v.toFixed(6)).join(', ')}]</div>

          <div style={{ color: '#888' }}>Parent:</div>
          <div style={{ wordWrap: 'break-word' }}>{object.parent?.name || 'None'}</div>

          <div style={{ color: '#888' }}>Children:</div>
          <div style={{ wordWrap: 'break-word' }}>{object.children.filter(c => !c.userData?.isHelper).length > 0 ? object.children.filter(c => !c.userData?.isHelper).map(c => c.name || 'Unnamed').join(', ') : 'None'}</div>
        </div>

        {Object.keys(object.userData).length > 0 && (
          <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #444' }}>
            <div style={{ color: '#888', marginBottom: '6px', fontSize: '13px' }}>UserData:</div>
            <pre style={{ margin: 0, fontSize: '12px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {JSON.stringify(object.userData, null, 2)}
            </pre>
          </div>
        )}

        <div style={{ marginTop: '10px', fontSize: '11px', color: '#666', fontStyle: 'italic' }}>
          {isPinned ? 'Click the object again or click away to dismiss' : 'Click to pin this info'}
        </div>
      </div>
    </Html>
  );
}
