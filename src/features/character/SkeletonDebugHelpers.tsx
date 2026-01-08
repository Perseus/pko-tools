import React, { useRef, useState } from 'react';
import { useFrame, ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { Html } from '@react-three/drei';

interface ObjectInfo {
  object: THREE.Object3D;
  type: 'bone' | 'dummy';
}

interface SkeletonDebugHelpersProps {
  scene: THREE.Group;
  showBones: boolean;
  showDummies: boolean;
}

export function SkeletonDebugHelpers({ scene, showBones, showDummies }: SkeletonDebugHelpersProps) {
  const [bones, setBones] = useState<THREE.Bone[]>([]);
  const [dummies, setDummies] = useState<THREE.Object3D[]>([]);
  const [hoveredObject, setHoveredObject] = useState<ObjectInfo | null>(null);
  const [pinnedObject, setPinnedObject] = useState<ObjectInfo | null>(null);

  // Extract bones and dummies once on mount
  React.useEffect(() => {
    const foundBones: THREE.Bone[] = [];
    const foundDummies: THREE.Object3D[] = [];

    scene.traverse((object) => {
      // Check if it's a bone (but not a dummy)
      if (object.type === 'Bone' && !object.userData?.dummy) {
        foundBones.push(object as THREE.Bone);
      }

      // Check if it's a dummy
      if (object.userData?.dummy === true) {
        foundDummies.push(object);
      }
    });

    setBones(foundBones);
    setDummies(foundDummies);
  }, [scene]);

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
      // Unpin if clicking the same object
      setPinnedObject(null);
      setHoveredObject(null);
    } else {
      // Pin the new object
      setPinnedObject({ object, type });
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
      {showBones && bones.map((bone, index) => (
        <BoneHelper
          key={`bone-${index}`}
          bone={bone}
          onHover={() => handleHover(bone, 'bone')}
          onUnhover={handleUnhover}
          onClick={() => handleClick(bone, 'bone')}
          isPinned={pinnedObject?.object === bone}
        />
      ))}
      {showDummies && dummies.map((dummy, index) => (
        <DummyHelper
          key={`dummy-${index}`}
          dummy={dummy}
          onHover={() => handleHover(dummy, 'dummy')}
          onUnhover={handleUnhover}
          onClick={() => handleClick(dummy, 'dummy')}
          isPinned={pinnedObject?.object === dummy}
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

interface BoneHelperProps {
  bone: THREE.Bone;
  onHover: () => void;
  onUnhover: () => void;
  onClick: () => void;
  isPinned: boolean;
}

function BoneHelper({ bone, onHover, onUnhover, onClick, isPinned }: BoneHelperProps) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    if (!meshRef.current) return;

    // Update position to match bone's world position
    bone.updateWorldMatrix(true, false);
    meshRef.current.position.setFromMatrixPosition(bone.matrixWorld);
  });

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    onClick();
  };

  const handlePointerOver = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    onHover();
  };

  const handlePointerOut = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    onUnhover();
  };

  return (
    <mesh
      ref={meshRef}
      onClick={handleClick}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
    >
      <sphereGeometry args={[0.02, 8, 8]} />
      <meshBasicMaterial color={isPinned ? "#ffff00" : "#00ff00"} transparent opacity={0.7} />
    </mesh>
  );
}

interface DummyHelperProps {
  dummy: THREE.Object3D;
  onHover: () => void;
  onUnhover: () => void;
  onClick: () => void;
  isPinned: boolean;
}

function DummyHelper({ dummy, onHover, onUnhover, onClick, isPinned }: DummyHelperProps) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    if (!meshRef.current) return;

    // Update position to match dummy's world position
    dummy.updateWorldMatrix(true, false);
    meshRef.current.position.setFromMatrixPosition(dummy.matrixWorld);
  });

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    onClick();
  };

  const handlePointerOver = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    onHover();
  };

  const handlePointerOut = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    onUnhover();
  };

  return (
    <mesh
      ref={meshRef}
      onClick={handleClick}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
    >
      <boxGeometry args={[0.03, 0.03, 0.03]} />
      <meshBasicMaterial color={isPinned ? "#ffff00" : "#ff00ff"} transparent opacity={0.7} />
    </mesh>
  );
}

interface ObjectInfoOverlayProps {
  object: THREE.Object3D;
  type: 'bone' | 'dummy';
  isPinned: boolean;
}

function ObjectInfoOverlay({ object, type, isPinned }: ObjectInfoOverlayProps) {
  object.updateWorldMatrix(true, false);

  const worldPos = new THREE.Vector3().setFromMatrixPosition(object.matrixWorld);
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
          <div style={{ wordWrap: 'break-word' }}>{object.children.length > 0 ? object.children.map(c => c.name || 'Unnamed').join(', ') : 'None'}</div>
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
