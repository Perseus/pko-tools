# Animation Helpers: Bounding Spheres and Dummies

This note captures a critical detail from the original client that affects helper alignment.

## Key Insight
Bounding spheres are updated at runtime using **dummy RTM matrices that already include the bone inverse bind**. If you use bone world matrices alone, helpers tilt/offset relative to the skinned mesh.

**Engine behavior (simplified):**
1. Build bone runtime matrices for the current frame.
2. Multiply each bone RTM by its **inverse bind**.
3. For each dummy:
   - `dummy_rtm = dummy_local * bone_rtm` (bone is the dummy's parent bone)
4. For each bounding sphere:
   - `sphere_mat = dummy_rtm`
   - center is transformed by `sphere_mat` (and parent/world matrices where applicable)

This is why helpers looked correct only after applying `boneWorld * inverseBind` in the viewer.

## Why This Matters
- The **mesh** is rendered in skinned space.
- Helper objects (dummies, bounding spheres) are evaluated in **the same bone space that includes inverse bind**.
- Without inverse bind, helpers drift/tilt even when bones and mesh look correct.

## Implementation Requirements

### 1. Backend: glTF Export Changes

#### a) Include sphere center in BoundingSphere node extras
In `src-tauri/src/character/model.rs`:

```rust
extras: Some(RawValue::from_string(format!(
    r#"{{"radius":{},"center":[{},{},{}],"type":"bounding_sphere","id":{}}}"#,
    bsphere.sphere.r,
    bsphere.sphere.c.0.x,  // LwVector3 is a tuple struct
    bsphere.sphere.c.0.y,
    bsphere.sphere.c.0.z,
    bsphere.id
)).unwrap())
```

#### b) Tag bones with bone_id in extras
In `src-tauri/src/animation/character.rs` (bone node creation):

```rust
let bone_extras = RawValue::from_string(
    format!(r#"{{"bone_id":{}}}"#, base_info.id)
).unwrap();

let node = Node {
    // ... other fields
    extras: Some(bone_extras),
    // ...
};
```

#### c) Tag dummies and use matrix directly (no decomposition)
In `src-tauri/src/animation/character.rs` (dummy node creation):

```rust
let dummy_extras = RawValue::from_string(
    format!(r#"{{"dummy":true,"id":{},"parent_bone_id":{}}}"#,
        dummy_info.id,
        dummy_info.parent_bone_id
    )
).unwrap();

let node = Node {
    camera: None,
    children: None,
    matrix: Some(dummy_info.mat.to_slice()),  // Use matrix directly
    rotation: None,      // Don't decompose
    scale: None,         // Don't decompose
    translation: None,   // Don't decompose
    // ... other fields
    extras: Some(dummy_extras),
};
```

**Why matrix directly?** The dummy matrix contains the full transform relative to its parent bone. Decomposing to translation/rotation/scale can lose precision or introduce gimbal lock issues.

### 2. Frontend: Three.js Implementation

#### a) Extract metadata from glTF
```typescript
// Extract bounding sphere data
const spheres: BoundingSphereData[] = [];
scene.traverse((object) => {
  if (object.name.startsWith('BoundingSphere') && object.userData) {
    const { radius, center, id, type } = object.userData;
    if (type === 'bounding_sphere' && radius && center && id !== undefined) {
      spheres.push({
        node: object,
        radius,
        center: new THREE.Vector3(center[0], center[1], center[2]),
        id
      });
    }
  }
});

// Build dummy lookup by ID
const dummiesById = new Map<number, THREE.Object3D>();
scene.traverse((object) => {
  if (object.userData?.dummy === true && object.userData?.id !== undefined) {
    dummiesById.set(object.userData.id, object);
  }
});
```

#### b) Runtime transform calculation
**Critical:** Use `skeleton.boneMatrices`, NOT manual `boneWorld * inverseBind`.

```typescript
function BoundingSphere({ node, radius, center, id, skeleton, dummiesById }) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame(() => {
    if (!meshRef.current || !skeleton) return;

    // 1. Find dummy node by matching ID (NOT by scene graph parent)
    const dummyNode = dummiesById.get(id);
    if (!dummyNode) return;

    // 2. Find dummy's parent bone
    let parentBone: THREE.Bone | null = null;
    let current = dummyNode.parent;
    while (current) {
      if (current instanceof THREE.Bone) {
        parentBone = current;
        break;
      }
      current = current.parent;
    }
    if (!parentBone) return;

    // 3. Get bone index
    const boneIndex = skeleton.bones.indexOf(parentBone);
    if (boneIndex === -1) return;

    // 4. Update skeleton and get bone matrix
    skeleton.update();
    // skeleton.boneMatrices contains bone transforms with inverse bind already applied
    const boneMatrix = new THREE.Matrix4().fromArray(
      skeleton.boneMatrices,
      boneIndex * 16
    );

    // 5. Get dummy's local transform
    dummyNode.updateMatrix();
    const dummyLocal = dummyNode.matrix.clone();

    // 6. Compute: dummyWorld = dummyLocal * boneMatrix
    const dummyWorld = new THREE.Matrix4().multiplyMatrices(dummyLocal, boneMatrix);

    // 7. Apply sphere center offset
    const centerMatrix = new THREE.Matrix4().makeTranslation(
      center.x, center.y, center.z
    );
    const sphereWorld = new THREE.Matrix4().multiplyMatrices(dummyWorld, centerMatrix);

    // 8. Update visualization mesh
    meshRef.current.position.setFromMatrixPosition(sphereWorld);
    meshRef.current.quaternion.setFromRotationMatrix(sphereWorld);
  });

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[radius, 16, 16]} />
      {/* ... material */}
    </mesh>
  );
}
```

#### c) Coordinate space considerations
**Important:** The spheres must be rendered in the **same coordinate space** as the skinned mesh.

If the character is inside a rotated group:
```tsx
<group rotation={[-Math.PI / 2, 0, 0]}>
  <primitive object={scene} />
  <BoundingSphereIndicators
    spheres={spheres}
    scene={scene}
    visible={true}
  />
</group>
```

**Why?** The skeleton's boneMatrices are in the skeleton's local space. If you render the spheres outside this group, they'll be in the wrong orientation.

### 3. Key Implementation Gotchas

1. **Don't use the BoundingSphere node's parent**: BoundingSphere nodes are exported at the scene root, not as children of dummies. Match by ID instead.

2. **Don't manually compute `boneWorld * inverseBind`**: Use `skeleton.boneMatrices` which Three.js computes for skinning. This ensures your helpers match the mesh exactly.

3. **Matrix multiplication order matters**: `dummyLocal * boneMatrix`, NOT `boneMatrix * dummyLocal`. The dummy transform is applied in bone space.

4. **Coordinate space alignment**: Render helpers in the same parent group as the skinned mesh to avoid orientation mismatches.

5. **Update skeleton every frame**: Call `skeleton.update()` before reading `boneMatrices` to ensure transforms match the current animation frame.

## Related Source References
- `top-client/corsairs-online-public/source/Client/engine/sdk/src/lwAnimCtrl.cpp`
  - `_UpdateFrameDataBoneDummy()` computes `dummy_rtm = dummy_local * bone_rtm`
- `top-client/corsairs-online-public/source/Client/engine/sdk/src/lwAnimCtrlObj.cpp`
  - bounding sphere matrices are overwritten with dummy RTM

## Implementation Files
- Backend: `src-tauri/src/character/model.rs` (sphere export)
- Backend: `src-tauri/src/animation/character.rs` (bone/dummy metadata)
- Frontend: `src/features/character/BoundingSphereIndicators.tsx` (visualization)
- Frontend: `src/features/character/CharacterWorkbench.tsx` (coordinate space setup)
