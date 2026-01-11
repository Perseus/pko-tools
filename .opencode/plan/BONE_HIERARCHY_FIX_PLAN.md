# Bone Hierarchy Fix Plan: glTF Import → LAB/LGO Export Pipeline

## Table of Contents
1. [Executive Summary](#executive-summary)
2. [How The Game Engine Works](#how-the-game-engine-works)
3. [Critical Bugs Identified](#critical-bugs-identified)
4. [Detailed Fix Plan](#detailed-fix-plan)
5. [Implementation Plan](#implementation-plan)
6. [Testing Strategy](#testing-strategy)
7. [Validation Criteria](#validation-criteria)

---

## Executive Summary

The bone hierarchy is completely broken because the code mixes three different index spaces without proper conversion:

1. **glTF Node Index** - Position in glTF nodes array
2. **Skin Joint Index** - Position in skin's joints array  
3. **LAB Bone Array Index** - Position in final LAB bones array

The game engine expects `parent_id` and `bone_index_seq` to reference **array positions**, but the current code stores **node indices** instead. This causes:
- Wrong parent transforms applied during hierarchy building
- Mesh vertices referencing wrong bones during skinning
- Complete skeletal deformation failure

---

## How The Game Engine Works

### Game Engine Source Analysis

Based on examination of `/mnt/i/Work/Client2019` source code:

#### 1. LAB File Loading (`lwExpObj.cpp:607-697`)

```cpp
fread(&_header, sizeof(lwBoneInfoHeader), 1, fp);           // Line 619
fread(_base_seq, sizeof(lwBoneBaseInfo), _bone_num, fp);    // Line 626
fread(_invmat_seq, sizeof(lwMatrix44), _bone_num, fp);      // Line 627
fread(_dummy_seq, sizeof(lwBoneDummyInfo), _dummy_num, fp); // Line 628
// Then animation keyframes (pos_seq + quat_seq for each bone)
```

**Binary Structure:**
```
┌─────────────────────────────────────────────────┐
│ version: u32                                    │
│ lwBoneInfoHeader (bone_num, frame_num, etc.)   │
│ base_seq: [lwBoneBaseInfo; bone_num]           │
│ invmat_seq: [lwMatrix44; bone_num]             │
│ dummy_seq: [lwBoneDummyInfo; dummy_num]        │
│ key_seq: [animation data per bone]             │
└─────────────────────────────────────────────────┘
```

#### 2. Bone Hierarchy Building (`lwAnimCtrl.cpp:81-116`)

```cpp
// Step 1: Build hierarchy by multiplying child by parent transform
for(i = 0; i < bone_num; i++) {
    GetValue(&out_buf[i], i, frame);  // Get local transform
    
    parent_id = _base_seq[i].parent_id;
    
    if(parent_id == LW_INVALID_INDEX) {
        // Root bone - keep as is
    } else {
        // ⚠️ CRITICAL: Uses parent_id as ARRAY INDEX
        lwMatrix44Multiply(&out_buf[i], &out_buf[i], &out_buf[parent_id]);
    }
}

// Step 2: Apply inverse bind matrices AFTER hierarchy
for(i = 0; i < bone_num; i++) {
    lwMatrix44Multiply(&out_buf[i], &_invmat_seq[i], &out_buf[i]);
}
```

**Critical Insights:**
- `parent_id` **MUST** be an array index into `out_buf[]` and `_base_seq[]`
- Parents **MUST** come before children in the array (depth-first order)
- The algorithm processes sequentially from index 0 to n-1
- If `parent_id` contains a wrong index, wrong transform is applied

#### 3. Mesh-to-Bone Mapping (`lwAnimCtrlObj.cpp:298-301`)

```cpp
for(DWORD i = 0; i < mesh_info->bone_index_num; i++) {
    // ⚠️ CRITICAL: Uses bone_index_seq as ARRAY INDEX into skeleton
    o_ctrl_obj->_bone_rtm_seq[i] = bone_rtm[mesh_info->bone_index_seq[i]];
}
```

**Data Flow:**
```
Vertex → blend_seq[v].index[j]           // Mesh bone index (0 to bone_index_num-1)
       → bone_index_seq[...]             // Maps to LAB bone array index
       → bone_rtm[...]                   // Skeleton bone transform
       → Final skinned vertex position
```

---

## Critical Bugs Identified

### 🔴 BUG #1: Parent ID Uses Node Index Instead of Bone Array Position

**Location:** `src-tauri/src/animation/character.rs:1461-1465`

**Current Code:**
```rust
bones.iter_mut().for_each(|bone| {
    if let Some(parent_node_vec_idx) = child_node_index_to_parent_node_index.get(&bone.id) {
        bone.parent_id = *parent_node_vec_idx;  // ❌ WRONG! Node index!
    }
});
```

**What's Wrong:**
- `bone.id` = `node.index()` (glTF node index)
- `parent_node_vec_idx` = parent's **node index**
- `bone.parent_id` is set to **node index** (should be array position)

**Why It's Wrong:**

The game engine does:
```cpp
lwMatrix44Multiply(&out_buf[i], &out_buf[i], &out_buf[parent_id]);
                                              ^^^^^^^^^^^^^^^^
                                              Array index lookup!
```

If `parent_id` contains a node index:
- It accesses the wrong bone's transform
- May access out-of-bounds memory
- Hierarchy is completely scrambled

**Example Failure:**
```
glTF Scene:
  Node 0: Root bone
  Node 1: Mesh (not a bone)
  Node 2: Spine bone (child of Root)
  Node 3: Head bone (child of Spine)

Extracted bones array:
  bones[0] = Root (node 0, parent_id = INVALID) ✓
  bones[1] = Spine (node 2, parent_id = 0)      ✓ Lucky - happens to be correct
  bones[2] = Head (node 3, parent_id = 2)       ❌ Should be 1 (Spine's array pos)

Game engine processing bones[2]:
  out_buf[2] = local_transform * out_buf[2]  // Multiplies by ITSELF!
  ❌ Should be: out_buf[2] = local_transform * out_buf[1]
```

**The Fix:**

```rust
// Step 1: Track bone array positions during extraction
let mut node_index_to_bone_array_pos = HashMap::<u32, u32>::new();
for (array_pos, bone) in bones.iter().enumerate() {
    node_index_to_bone_array_pos.insert(bone.id, array_pos as u32);
}

// Step 2: Convert parent node indices to parent array positions
bones.iter_mut().for_each(|bone| {
    if let Some(parent_node_idx) = child_node_index_to_parent_node_index.get(&bone.id) {
        if let Some(parent_array_pos) = node_index_to_bone_array_pos.get(parent_node_idx) {
            bone.parent_id = *parent_array_pos;  // ✓ Correct array position
        } else {
            eprintln!("Warning: Bone {} has non-bone parent", bone.name);
            bone.parent_id = LW_INVALID_INDEX;
        }
    }
});
```

---

### 🔴 BUG #2: Parent ID Remap Uses Wrong Mapping

**Location:** `src-tauri/src/animation/character.rs:1490-1495`

**Current Code:**
```rust
reordered_bones.iter_mut().for_each(|bone| {
    if bone.parent_id != LW_INVALID_INDEX {
        let new_parent_id = orig_bone_id_to_new_id.get(&bone.parent_id).unwrap();
        bone.parent_id = *new_parent_id;
    }
});
```

**What's Wrong:**
- `bone.parent_id` contains a **node index** (from Bug #1)
- `orig_bone_id_to_new_id` maps **bone.id (node index) → new position**
- Lookup accidentally works sometimes but fails in other cases

**Why It's Wrong:**

The code conflates:
- **Bone IDs** (node indices before reordering)
- **Parent IDs** (should be array positions but are currently node indices)

**Example Failure:**
```
Before reorder:
  bones[0] = id=5 (node 5), parent_id=2 (should be array pos 1, but is node idx 2)
  bones[1] = id=7 (node 7), parent_id=INVALID
  
After reorder:
  orig_bone_id_to_new_id = {5→0, 7→1}
  
Remap parent_id:
  orig_bone_id_to_new_id.get(&2) = None ❌ PANIC! "unwrap() on None"
```

**The Fix:**

```rust
// Create mapping: old array position → new array position
let mut old_pos_to_new_pos = HashMap::<u32, u32>::new();
for (new_pos, entry) in ideal_order.iter().enumerate() {
    old_pos_to_new_pos.insert(entry.0, new_pos as u32);
}

// Update parent IDs to reflect new positions
reordered_bones.iter_mut().for_each(|bone| {
    if bone.parent_id != LW_INVALID_INDEX {
        bone.parent_id = *old_pos_to_new_pos.get(&bone.parent_id)
            .expect("Parent bone should have been reordered");
    }
});

// Validate depth-first ordering
for (idx, bone) in reordered_bones.iter().enumerate() {
    if bone.parent_id != LW_INVALID_INDEX {
        assert!(bone.parent_id < idx as u32, 
                "Parent should come before child in array");
    }
}
```

---

### 🔴 BUG #3: bone_index_seq Contains Wrong Values

**Location:** `src-tauri/src/character/mesh.rs:1327-1334`

**Current Code:**
```rust
let bone_index_seq = hierarchy_with_only_joints_with_weight
    .iter()
    .enumerate()
    .map(|(bone_index_seq_idx, (bone_idx, (skin_bone_idx, _)))| {
        skin_bone_idx_to_bone_seq_idx.insert(*skin_bone_idx, bone_index_seq_idx as u32);
        *bone_idx as u32  // ❌ Returns enumerate index (0, 1, 2, ...)
    })
    .collect::<Vec<u32>>();
```

**What's Wrong:**
- `bone_idx` is the **enumerate index** (loop counter)
- Code returns 0, 1, 2, 3... regardless of which bones are used
- Doesn't reference LAB bone array at all!

**Why It's Wrong:**

The game engine does:
```cpp
bone_rtm_seq[i] = bone_rtm[mesh_info->bone_index_seq[i]];
                            ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                            Must be LAB bone array index!
```

**Example Failure:**
```
LAB bones (after reordering):
  bones[0] = "Root"
  bones[1] = "Spine"  
  bones[2] = "Head"
  bones[3] = "Arm_L"
  bones[4] = "Arm_R"

Mesh uses only: Spine, Head, Arm_L

Current code produces:
  bone_index_seq = [0, 1, 2]  // Just enumerate indices!
  
Game engine does:
  mesh_bone[0] = bone_rtm[0] = Root  ❌ Should be Spine (bones[1])
  mesh_bone[1] = bone_rtm[1] = Spine ❌ Should be Head (bones[2])
  mesh_bone[2] = bone_rtm[2] = Head  ❌ Should be Arm_L (bones[3])
  
Result: Completely wrong skinning!
```

**The Fix:**

```rust
// Pass LAB bone data to mesh import
pub fn from_gltf(
    doc: &gltf::Document,
    buffers: &Vec<gltf::buffer::Data>,
    images: &Vec<gltf::image::Data>,
    lab_bone_data: &LwBoneFile,  // ← Add this
) -> anyhow::Result<Self>

// Build bone_index_seq correctly
let skin = doc.skins().nth(0).unwrap();
let mut bone_index_seq = Vec::new();

for (skin_joint_idx, joint) in skin.joints().enumerate() {
    if !joints_with_weight.contains(&(skin_joint_idx as u8)) {
        continue;  // Skip unused bones
    }
    
    // Find this joint's position in LAB bone array
    let lab_bone_idx = lab_bone_data._base_seq
        .iter()
        .position(|b| b.original_node_index == joint.index() as u32)
        .expect("Joint not found in LAB bones") as u32;
    
    bone_index_seq.push(lab_bone_idx);  // ✓ LAB array index!
}
```

---

### 🔴 BUG #4: Inconsistent Hierarchy Algorithms

**Location:** 
- LAB: `src-tauri/src/animation/character.rs:1331-1372`
- LGO: `src-tauri/src/character/mesh.rs:1122-1141`

**What's Wrong:**
- LAB builds hierarchy from `bones` vector (extracted from `gltf.nodes()`)
- LGO builds hierarchy from `skin.joints()` directly
- Two different algorithms, two different bone sets

**Why It's Wrong:**

LAB and LGO must reference the **same skeleton**. If they differ:
- Bone counts don't match
- `bone_index_seq[i]` references wrong or non-existent bones
- Skinning fails

**Example Failure:**
```
glTF file:
  Nodes: [Root, Mesh, Helper, Spine, Head]
  skin.joints(): [Root, Spine, Head]

LAB (from gltf.nodes()):
  bones[0] = Root
  bones[1] = Helper  ← Not in skin!
  bones[2] = Spine
  bones[3] = Head
  Total: 4 bones

LGO (from skin.joints()):
  Expects 3 bones: [Root, Spine, Head]
  bone_index_seq = [0, 1, 2]
  
Mismatch! LGO references bones[0,1,2] but LAB has different bones.
```

**The Fix:**

Use `skin.joints()` as the **single source of truth** for both LAB and LGO:

```rust
// In LwBoneFile::from_gltf - REPLACE node loop with:
let skin = gltf.skins().nth(0)
    .ok_or(anyhow::anyhow!("No skin found"))?;

for joint in skin.joints() {
    // Skip dummies
    if is_dummy(joint) { continue; }
    
    let bone = LwBoneBaseInfo {
        id: joint.index() as u32,
        parent_id: LW_INVALID_INDEX,
        name: joint.name().unwrap().to_string(),
        original_node_index: joint.index() as u32,
    };
    bones.push(bone);
}

// Both LAB and LGO now use the same bone set
```

---

### 🔴 BUG #5: Inverse Bind Matrix Ordering

**Location:** `src-tauri/src/animation/character.rs:1518-1531`

**Current Code:**
```rust
for (i, joint) in skin.joints().enumerate() {
    let ibm = LwMatrix44::read_options(&mut reader, ...)?;
    let node_idx = orig_bone_id_to_new_id.get(&(joint.index() as u32)).unwrap();
    ibm_data[*node_idx as usize] = ibm;
}
```

**What's Wrong:**
- Reads IBMs in `skin.joints()` order
- Tries to map node index → new bone position
- If bones were extracted differently than `skin.joints()`, mapping fails

**Why It's Wrong:**

The LAB file requires:
```
invmat_seq[i] must correspond to base_seq[i]
```

If the mapping is incorrect, skinning deformations are wrong.

**The Fix:**

```rust
// Read all IBMs into a map first
let mut ibm_by_node_index = HashMap::<u32, LwMatrix44>::new();
for joint in skin.joints() {
    let ibm = LwMatrix44::read_options(&mut reader, ...)?;
    ibm_by_node_index.insert(joint.index() as u32, ibm);
}

// After bones are reordered, assign IBMs by node matching
let mut ibm_data = vec![LwMatrix44::identity(); bones.len()];
for (final_pos, bone) in bones.iter().enumerate() {
    let node_idx = bone.original_node_index;
    ibm_data[final_pos] = *ibm_by_node_index.get(&node_idx)
        .ok_or(anyhow::anyhow!("No IBM for bone {}", bone.name))?;
}
```

---

## Detailed Fix Plan

### Phase 1: Add original_node_index Field

**File:** `src-tauri/src/animation/character.rs:88-105`

**Change:**
```rust
#[derive(Debug, Clone, BinRead, BinWrite)]
pub struct LwBoneBaseInfo {
    #[br(map = |s: [u8; LW_MAX_NAME]| /* ... */)]
    #[bw(map = |s: &String| /* ... */)]
    pub name: String,
    
    pub id: u32,
    pub parent_id: u32,
    
    // ADD THIS FIELD - not written to file, used during processing
    #[br(ignore)]
    #[bw(ignore)]
    pub original_node_index: u32,
}
```

**Purpose:** Track which glTF node each bone came from, for IBM matching.

---

### Phase 2: Use skin.joints() as Single Source

**File:** `src-tauri/src/animation/character.rs:1414-1458`

**Replace bone extraction with:**
```rust
let skin = gltf.skins().nth(0)
    .ok_or(anyhow::anyhow!("No skin found in glTF file"))?;

let mut node_index_to_bone_array_pos = HashMap::<u32, u32>::new();

for joint in skin.joints() {
    // Skip dummies
    if let Some(extras) = joint.extras() {
        if extras.get().contains("dummy") {
            continue;
        }
    }
    
    let array_pos = bones.len() as u32;
    let bone = LwBoneBaseInfo {
        id: joint.index() as u32,
        parent_id: LW_INVALID_INDEX,
        name: joint.name().unwrap_or("unnamed").to_string(),
        original_node_index: joint.index() as u32,
    };
    
    bones.push(bone);
    bone_idx_to_vec_idx.insert(joint.index() as u32, array_pos);
    node_index_to_bone_array_pos.insert(joint.index() as u32, array_pos);
    idx_to_node.insert(joint.index() as u32, joint.clone());
}
```

---

### Phase 3: Fix Parent ID Assignment

**File:** `src-tauri/src/animation/character.rs:1460-1465`

**Replace with:**
```rust
// Build parent relationships from glTF hierarchy
for bone in bones.iter_mut() {
    let node = idx_to_node.get(&bone.original_node_index).unwrap();
    
    // Find parent joint
    let parent_joint = skin.joints().find(|j| {
        j.children().any(|c| c.index() == node.index())
    });
    
    if let Some(parent) = parent_joint {
        // Convert node index → array position
        if let Some(parent_pos) = node_index_to_bone_array_pos.get(&(parent.index() as u32)) {
            bone.parent_id = *parent_pos;
        } else {
            eprintln!("Warning: Parent not in skeleton");
            bone.parent_id = LW_INVALID_INDEX;
        }
    }
}
```

---

### Phase 4: Fix Parent Remap After Reordering

**File:** `src-tauri/src/animation/character.rs:1490-1495`

**Replace with:**
```rust
// Map old array positions → new array positions
let mut old_pos_to_new_pos = HashMap::<u32, u32>::new();
for (new_pos, entry) in ideal_order.iter().enumerate() {
    old_pos_to_new_pos.insert(entry.0, new_pos as u32);
}

// Update parent IDs
reordered_bones.iter_mut().for_each(|bone| {
    if bone.parent_id != LW_INVALID_INDEX {
        bone.parent_id = *old_pos_to_new_pos.get(&bone.parent_id)
            .expect("Parent should be reordered");
    }
});

// Validate
for (idx, bone) in reordered_bones.iter().enumerate() {
    if bone.parent_id != LW_INVALID_INDEX {
        assert!(bone.parent_id < idx as u32,
                "Bone {} '{}': parent_id {} should be < {}",
                bone.id, bone.name, bone.parent_id, idx);
    }
}
```

---

### Phase 5: Fix Inverse Bind Matrix Assignment

**File:** `src-tauri/src/animation/character.rs:1518-1531`

**Replace with:**
```rust
// Read all IBMs into map
let mut ibm_by_node_index = HashMap::<u32, LwMatrix44>::new();
for joint in skin.joints() {
    let ibm = LwMatrix44::read_options(&mut reader, binrw::Endian::Little, ())?;
    
    if let Some(extras) = joint.extras() {
        if extras.get().contains("dummy") {
            // Handle dummies
            let dummy_idx = dummy_idx_to_bone_idx.get(&(joint.index() as u32)).unwrap();
            let transform = LwMatrix44(Matrix4::from(joint.transform().matrix()));
            dummies[*dummy_idx as usize].mat = transform;
            continue;
        }
    }
    
    ibm_by_node_index.insert(joint.index() as u32, ibm);
}

// Assign IBMs after reordering
let mut ibm_data = vec![LwMatrix44::identity(); bones.len()];
for (final_pos, bone) in bones.iter().enumerate() {
    ibm_data[final_pos] = *ibm_by_node_index.get(&bone.original_node_index)
        .ok_or(anyhow::anyhow!("No IBM for bone '{}'", bone.name))?;
}
```

---

### Phase 6: Pass LAB Data to Mesh Import

**File:** `src-tauri/src/character/mesh.rs:1143`

**Change signature:**
```rust
pub fn from_gltf(
    doc: &gltf::Document,
    buffers: &Vec<gltf::buffer::Data>,
    images: &Vec<gltf::image::Data>,
    lab_bone_data: &LwBoneFile,  // ← ADD
) -> anyhow::Result<Self>
```

**File:** `src-tauri/src/character/mod.rs:243`

**Update call:**
```rust
let bone_file = LwBoneFile::from_gltf(&gltf, &buffers, &images)?;
let mesh = CharacterMeshInfo::from_gltf(&gltf, &buffers, &images, &bone_file)?;
```

---

### Phase 7: Fix bone_index_seq Calculation

**File:** `src-tauri/src/character/mesh.rs:1306-1358`

**Replace joint remapping with:**
```rust
let skin = doc.skins().nth(0).unwrap();
let mut bone_index_seq = Vec::new();
let mut skin_bone_idx_to_mesh_bone_idx = HashMap::new();

// Find which bones have weights
let mut joints_with_weight = HashSet::new();
joint_seq.iter().for_each(|packed| {
    let bytes = packed.to_le_bytes();
    bytes.iter().for_each(|&idx| {
        joints_with_weight.insert(idx);
    });
});

// Build bone_index_seq
for (skin_idx, joint) in skin.joints().enumerate() {
    if !joints_with_weight.contains(&(skin_idx as u8)) {
        continue;
    }
    
    let node_idx = joint.index() as u32;
    
    // Find LAB bone array index
    let lab_idx = lab_bone_data._base_seq
        .iter()
        .position(|b| b.original_node_index == node_idx)
        .ok_or(anyhow::anyhow!("Joint {} not in LAB", node_idx))? as u32;
    
    let mesh_bone_idx = bone_index_seq.len() as u32;
    skin_bone_idx_to_mesh_bone_idx.insert(skin_idx as u32, mesh_bone_idx);
    bone_index_seq.push(lab_idx);
}

// Remap vertex indices
joint_seq.iter_mut().for_each(|packed| {
    let mut bytes = packed.to_le_bytes();
    bytes.iter_mut().for_each(|skin_idx| {
        let mesh_idx = skin_bone_idx_to_mesh_bone_idx[&(*skin_idx as u32)];
        *skin_idx = mesh_idx as u8;
    });
    *packed = u32::from_le_bytes(bytes);
});

// Build blend_seq
for (i, joint) in joint_seq.iter().enumerate() {
    mesh.blend_seq.push(CharacterMeshBlendInfo {
        indexd: *joint,
        weight: weight_seq[i],
    });
}

mesh.bone_index_seq = bone_index_seq;
```

---

### Phase 8: Remove Duplicate Code

**File:** `src-tauri/src/character/mesh.rs:1094-1141`

**Delete:**
- `fn add_node_to_hierarchy`
- `fn get_reordered_bone_hierarchy`

These are no longer needed.

---

## Implementation Plan

### Order of Changes

1. **Phase 1:** Add `original_node_index` field (non-breaking change)
2. **Phase 2:** Switch to `skin.joints()` source (may break existing exports)
3. **Phase 3:** Fix parent ID assignment (fixes Bug #1)
4. **Phase 4:** Fix parent remap (fixes Bug #2)
5. **Phase 5:** Fix IBM assignment (fixes Bug #5)
6. **Phase 6:** Pass LAB data to mesh (setup for Bug #3 fix)
7. **Phase 7:** Fix bone_index_seq (fixes Bug #3)
8. **Phase 8:** Clean up duplicate code (fixes Bug #4)

### File Modification Summary

| File | Lines Changed | Purpose |
|------|---------------|---------|
| `src-tauri/src/animation/character.rs` | ~200 lines | All LAB fixes |
| `src-tauri/src/character/mesh.rs` | ~100 lines | LGO bone_index_seq fix |
| `src-tauri/src/character/mod.rs` | ~2 lines | Pass LAB to mesh |

---

## Testing Strategy

### Test Cases

#### Test 1: Simple Linear Hierarchy
```
Root → Spine → Head
```
- Verify `parent_id` values: Head.parent = 1, Spine.parent = 0
- Verify `bone_index_seq` maps correctly
- Verify hierarchy builds correctly in game

#### Test 2: Branching Hierarchy
```
Root → Spine → Head
            └→ Arm_L → Hand_L
            └→ Arm_R → Hand_R
```
- Verify depth-first ordering
- Verify all children have `parent_id < own_index`
- Verify siblings are in correct order

#### Test 3: Non-Sequential Node Indices
```
Node 0: Root
Node 5: Spine
Node 12: Head
```
- Verify `parent_id` uses array positions (0,1,2) not node indices (0,5,12)
- Verify skinning works correctly

#### Test 4: Partial Bone Usage
```
Skeleton: 10 bones
Mesh uses: 4 bones (Spine, Head, Arm_L, Arm_R)
```
- Verify `bone_index_seq.len() == 4`
- Verify `bone_index_seq` values are valid LAB indices
- Verify unused bones don't affect mesh

#### Test 5: Round-Trip Export/Import
```
Original LAB/LGO → glTF → New LAB/LGO
```
- Verify bone count matches
- Verify hierarchy matches
- Verify skinning matches

### Validation Commands

```bash
# Run Rust tests
cd src-tauri && cargo test

# Test glTF import
pnpm tauri dev
# In UI: Import glTF → Check console for warnings

# Validate LAB structure
# Add debug output in code to print:
# - Bone count
# - Parent IDs
# - bone_index_seq values
```

---

## Validation Criteria

### LAB File Must Have:
- ✅ All bones from `skin.joints()`
- ✅ Bones in depth-first order (parent before children)
- ✅ `bone.id` sequential: 0, 1, 2, ..., n-1
- ✅ `bone.parent_id` either INVALID or < bone's own id
- ✅ `bone.parent_id` correctly references parent array position
- ✅ `invmat_seq[i]` matches `base_seq[i]`

### LGO File Must Have:
- ✅ `bone_index_num` ≤ LAB bone count
- ✅ All `bone_index_seq` values < LAB bone count
- ✅ `bone_index_seq[i]` references correct LAB bone
- ✅ `blend_seq[v].index[j]` < `bone_index_num`

### Runtime Behavior:
- ✅ Hierarchy builds correctly: `world[i] = local[i] * world[parent_id[i]]`
- ✅ Skinning references correct bones
- ✅ Character deforms correctly with animations
- ✅ No crashes or out-of-bounds access

---

## Potential Risks

### Breaking Changes
- Existing glTF files exported with old code may not re-import correctly
- Any manual edits to glTF files might break

### Edge Cases to Handle
- Empty `skin.joints()` array
- Joints without names
- Multiple skins in one glTF file
- Circular parent relationships (should be impossible but validate anyway)

### Performance
- Adding HashMaps adds memory overhead
- Should be negligible for typical models (< 100 bones)

---

## Questions Before Implementation

1. **Dummy bones:** Should dummies be in `_base_seq` or kept separate in `_dummy_seq`?

2. **Multiple skins:** Should we support multiple skins or assume one per character?

3. **Multiple roots:** Can there be multiple root bones, or always exactly one?

4. **Bone naming:** Use names to match bones, or is there a better identifier?

5. **Test files:** Do you have failing glTF files to test with?

6. **Backwards compatibility:** Need to support old LAB/LGO files?

---

## Next Steps

Once you approve this plan:

1. Create a feature branch: `fix/bone-hierarchy`
2. Implement changes in order (Phase 1 → Phase 8)
3. Add unit tests for each fix
4. Test with real glTF files
5. Create PR with detailed change description

---

**Document Version:** 1.0  
**Date:** 2026-01-11  
**Author:** Analysis of glTF import pipeline bugs
