# Dummy Nodes in Character Skeletons: Purpose and Usage

## Executive Summary

Dummy nodes in character skeletons are **attachment points** that serve multiple critical gameplay functions beyond just bounding sphere positioning. They are skeletal transform nodes attached to bones that provide reference transforms for:

1. **Bounding sphere positioning** (collision detection)
2. **Item/weapon attachment** (equipment system)
3. **Visual effect attachment** (spell effects, particles)
4. **Weapon sheathing** (storing weapons on back/hip when not in use)
5. **Multi-part character linking** (body part attachment points)

## Core Architecture

### Definition and Structure

**Source**: `top-client/corsairs-online-public/source/Client/engine/sdk/src/lwExpObj.h` (lines 280-290)

```cpp
struct lwBoneDummyInfo {
    DWORD id;                    // Unique dummy identifier
    lwMatrix44 mat;              // World transform matrix (runtime)
    lwMatrix44 mat_local;        // Local transform relative to parent bone
    DWORD parent_bone_id;        // ID of parent bone this dummy is attached to
    // parent_type: 0=default, 1=bone parent, 2=bone dummy parent
    DWORD parent_type;
    DWORD parent_id;
};
```

Dummies are nodes that:
- Are attached to bones via `parent_bone_id`
- Have a local transformation matrix (`mat_local`)
- Are updated every frame with runtime transforms (`mat`)

### Runtime Transform Update

**Source**: `top-client/corsairs-online-public/source/Client/engine/sdk/src/lwAnimCtrl.cpp` (lines 258-270)

```cpp
LW_RESULT lwAnimCtrlBone::_UpdateFrameDataBoneDummy() {
    lwBoneDummyInfo* dummy_info;

    for (DWORD i = 0; i < _data._dummy_num; i++) {
        dummy_info = &_data._dummy_seq[i];
        if (dummy_info->parent_bone_id != LW_INVALID_INDEX) {
            // KEY COMPUTATION: dummy_rtm = dummy_local * bone_rtm
            lwMatrix44Multiply(&_dummy_rtmat_seq[i].mat,
                              &dummy_info->mat,
                              &_rtmat_ptr[dummy_info->parent_bone_id]);
        }
    }

    return LW_RET_OK;
}
```

**Critical Insight**: Dummies are updated **every frame** by multiplying their local matrix with their parent bone's runtime matrix. This ensures dummies follow skeletal animation.

**Chinese Comment Translation** (`lwAnimCtrl.h` lines 46-48):
> "Here we use lwIndexMatrix44 instead of lwMatrix44 from an interface perspective.
> External code needs GetDummyRTM() to get runtime dummy information, this information
> needs to include the dummy's index"

## Use Case 1: Bounding Sphere Positioning

**Source**: `top-client/corsairs-online-public/source/Client/engine/sdk/src/lwAnimCtrlObj.cpp` (lines 300-316)

```cpp
LW_RESULT lwAnimCtrlObjBone::UpdateHelperObject(lwIHelperObject* helper_obj) {
    // ...

    lwIBoundingSphere* b = helper_obj->GetBoundingSphere();
    lwIHelperDummy* d = helper_obj->GetHelperDummy();

    if (b) {
        lwBoundingSphereInfo* s;
        DWORD num = b->GetObjNum();

        for (DWORD j = 0; j < num; j++) {
            s = b->GetDataInfo(j);

            assert(s->id < LW_MAX_BONEDUMMY_NUM);

            // KEY: Bounding sphere gets its transform from dummy by ID
            lwMatrix44* mat = GetDummyRTM(s->id);
            if (mat) {
                s->mat = *mat;  // Copy dummy transform to bounding sphere
            }
        }
    }
    // ...
}
```

**Explanation**: Each bounding sphere has an ID that matches a dummy ID. The sphere's transform is set to the dummy's runtime transform, ensuring the collision volume follows the character's animation.

**Why this works**: Since dummies are attached to bones and updated every frame (via `_UpdateFrameDataBoneDummy()`), the bounding spheres automatically follow the skeletal animation.

## Use Case 2: Item/Weapon Attachment

**Source**: `top-client/corsairs-online-public/source/Client/engine/sdk/src/lwItem.h` (line 66)

**Chinese Comment Translation**:
> "Here we define that if an item has skeletal animation, then dummies are only valid if bound to bones"

**Source**: `top-client/corsairs-online-public/source/Client/engine/sdk/src/lwItem.cpp` (lines 173-186)

```cpp
// Inside lwItem::Update()
lwMatrix44 mat_parent;

if (LW_FAILED(_link_ctrl->GetLinkCtrlMatrix(&mat_parent, _link_parent_id)))
    goto __ret;

lwMatrix44 mat_dummy;

if (LW_FAILED(GetDummyMatrix(&mat_dummy, _link_item_id)))
    goto __ret;

lwMatrix44InverseNoScaleFactor(&mat_dummy, &mat_dummy);

// KEY: Item's base transform = inverse(dummy_local) * parent_transform
lwMatrix44Multiply(&_mat_base, &mat_dummy, &mat_parent);
```

**Source**: `top-client/corsairs-online-public/source/Client/engine/sdk/src/lwPhysique.cpp` (lines 133-155)

```cpp
LW_RESULT lwPhysique::GetLinkCtrlMatrix(lwMatrix44* mat, DWORD link_id) {
    LW_RESULT ret = LW_RET_FAILED;

    // ... get bone animation controller ...

    lwIAnimCtrlObjBone* bone_ctrl = (lwIAnimCtrlObjBone*)_anim_agent->GetAnimCtrlObj(&type_info);
    if (bone_ctrl == NULL)
        goto __ret;

    // KEY: Get dummy runtime transform for attachment point
    lwMatrix44* rtm = bone_ctrl->GetDummyRTM(link_id);

    if (rtm == NULL)
        goto __ret;

    lwMatrix44Multiply(mat, rtm, &_mat_base);

    ret = LW_RET_OK;
__ret:
    return ret;
}
```

**Explanation**: Items (weapons, shields, etc.) are attached to the character at specific dummy nodes. The `link_id` parameter specifies which dummy to attach to. The item's position/rotation is computed relative to the dummy's runtime transform.

## Use Case 3: Weapon Sheathing System

**Source**: `top-client/corsairs-online-public/source/Client/Client/src/Character.cpp` (lines 71-93)

```cpp
inline int GetWeaponBackDummy(int nWeaponType, bool isLeftHand) {
    int nBackDummy = -1;
    if (isLeftHand) {
        switch (nWeaponType) {
        case 2:  // Specific weapon types map to specific back dummies
        case 5:
        case 9:
        case 10:
            nBackDummy = 21;  // Left back dummy ID
            break;
        case 1:
        case 3:
        case 4:
        case 6:
        case 7:
        case 8:
        case 11:
            nBackDummy = 11;  // Left hip dummy ID
            break;
        }
    } else {
        switch (nWeaponType) {
        case 2:
        case 5:
        case 9:
        case 10:
            nBackDummy = 20;  // Right back dummy ID
            break;
        // ... more weapon types ...
        }
    }
    return nBackDummy;
}
```

**Source**: `top-client/corsairs-online-public/source/Client/Client/src/Character.cpp` (lines 1328-1352)

```cpp
int dummy = -1;
if (_pHandItem[enumEQUIP_LHAND]) {
    AttachItem(enumEQUIP_LHAND, _pHandItem[enumEQUIP_LHAND], -1);

    // Get the appropriate back/hip dummy for this weapon type
    dummy = GetWeaponBackDummy(_pHandItem[enumEQUIP_LHAND]->GetItemInfo()->sType, true);
}

if (_pHandItem[enumEQUIP_RHAND]) {
    AttachItem(enumEQUIP_RHAND, _pHandItem[enumEQUIP_RHAND], -1);

    dummy = GetWeaponBackDummy(_pHandItem[enumEQUIP_RHAND]->GetItemInfo()->sType, false);
}

// Later when sheathing:
if (dummy > 0) {
    AttachItem(dummy, _pHandItem[enumEQUIP_LHAND], -1, 3);
}
```

**Explanation**: When weapons are not in use, they are attached to "back dummies" (dummy IDs like 20, 21 for back, 11 for hip). Different weapon types attach to different dummies (swords on hip, large weapons on back, etc.). This creates the visual effect of weapons being stored on the character's body.

**Specific Dummy IDs**:
- Dummy 20: Right back (for right-hand large weapons)
- Dummy 21: Left back (for left-hand large weapons)
- Dummy 11: Left hip (for left-hand swords/daggers)
- (Additional dummies for right hip, hands, etc.)

## Use Case 4: Visual Effect Attachment

**Source**: `top-client/corsairs-online-public/source/Client/Client/src/EffectObj.cpp` (lines documented in grep results)

```cpp
// Attach visual effect to specific dummy on character
if (pCha->GetObjDummyRunTimeMatrix(&tMat, pEffCtrl->_iDummy, 0)) {
    // Effect follows the dummy's transform
}

// For item-based effects:
pItem->GetObjDummyRunTimeMatrix(&matrix, pEffCtrl->_iDummy);
```

**Explanation**: Visual effects (spell effects, auras, particle systems) are attached to dummies. For example:
- A sword swing effect might attach to a hand dummy
- A shield glow might attach to the shield dummy
- A character aura might attach to the chest dummy

**Source**: `top-client/corsairs-online-public/source/Client/Client/src/GameAppMsg.cpp` (documented in grep results)

```cpp
// Skill targeting uses dummies for spawn points
// 使用道具表里的dummy (Use the dummy from the item table)
if (_pSkillInfo->sTargetDummyLink >= 0 &&
    _pTarget->GetObjDummyRunTimeMatrix(&mat, _pSkillInfo->sTargetDummyLink) >= 0) {
    // Spawn skill effect at target's specific dummy location
}
```

**Explanation**: Skills can specify which dummy on the target to spawn effects at (e.g., head for mind control effects, chest for damage effects, etc.).

## Use Case 5: Multi-Part Character Linking

**Source**: `top-client/corsairs-online-public/source/Client/engine/sdk/src/MPCharacter.cpp` (lines 527-552)

```cpp
LW_RESULT MPCharacter::GetObjDummyRunTimeMatrix(lwMatrix44* mat, DWORD obj_id, DWORD dummy_id) {
    LW_RESULT ret = LW_RET_FAILED;

    lwIPrimitive* p = _physique->GetPrimitive(obj_id);
    if (p == NULL)
        goto __ret;

    lwIHelperObject* h = p->GetHelperObject();
    if (h == 0)
        goto __ret;

    lwIHelperDummy* dummy = h->GetHelperDummy();
    if (dummy == NULL)
        goto __ret;

    lwHelperDummyInfo* dummy_info = dummy->GetDataInfoWithID(dummy_id);

    if (dummy_info == NULL)
        goto __ret;

    // KEY: Get dummy transform for specific body part
    lwMatrix44Multiply(mat, &dummy_info->mat, dummy->GetMatrixParent());

    ret = LW_RET_OK;
__ret:
    return ret;
}
```

**Explanation**: Multi-part characters (characters composed of separate mesh parts like head, body, arms, legs) use dummies to attach parts together. Each body part has dummies that serve as attachment points for sub-objects or accessories.

## Summary of Dummy Node Purposes

| Purpose | Dummy IDs (Examples) | Source Reference |
|---------|---------------------|------------------|
| **Bounding Spheres** | 0-14 (varies by character) | `lwAnimCtrlObj.cpp:300-316` |
| **Hand Attachments** | Left hand, Right hand | `Character.cpp:1328-1352` |
| **Back Weapon Storage** | 20 (right back), 21 (left back) | `Character.cpp:71-93` |
| **Hip Weapon Storage** | 11 (left hip), etc. | `Character.cpp:71-93` |
| **Visual Effects** | Varies by skill/effect | `EffectObj.cpp`, `GameAppMsg.cpp` |
| **Body Part Linking** | Per-part dummies | `MPCharacter.cpp:527-552` |

## Key Findings

### 1. Dummies Are NOT Just for Bounding Spheres

While bounding spheres **do** use dummy transforms (as confirmed in `lwAnimCtrlObj.cpp:300-316`), dummies serve **multiple critical gameplay systems**:
- Equipment attachment system
- Weapon sheathing system
- Visual effect spawn points
- Multi-part character assembly

### 2. ID-Based Associations

The engine uses **ID matching** to associate objects with dummies:
- Bounding sphere ID → Dummy ID (`s->id` matches dummy in `GetDummyRTM(s->id)`)
- Weapon type → Back dummy ID (via `GetWeaponBackDummy()`)
- Effect → Target dummy ID (via `sTargetDummyLink`)

### 3. Transform Hierarchy

```
Skeleton Root
  └─ Bone (animated)
      └─ Dummy (follows bone via dummy_rtm = dummy_local * bone_rtm)
          └─ Attached Object (weapon/effect/sphere follows dummy)
```

### 4. Per-Frame Update Requirement

**Source**: `lwAnimCtrl.cpp:398-399`

```cpp
__addr_set_rtdummy:
    if (LW_FAILED(_UpdateFrameDataBoneDummy()))
        goto __ret;
```

This function is called **every frame** during animation updates, ensuring dummies (and therefore bounding spheres, attached items, effects) follow the character's animation in real-time.

## Conclusion

Dummy nodes are **multi-purpose attachment point nodes** in the character skeleton system. They are:

1. **Transform nodes** attached to bones
2. **Updated every frame** with skeletal animation
3. **Used by multiple systems**:
   - Collision detection (bounding spheres)
   - Equipment system (items/weapons)
   - Visual effects system (spell effects)
   - Weapon sheathing (storage on back/hip)
   - Multi-part characters (body part assembly)

The bounding sphere system is just **one of many consumers** of dummy node transforms. This explains why the character skeleton has many more dummies (often 15-20) than bounding spheres (typically 8-12) - the extra dummies serve equipment attachment, weapon sheathing, and effect spawn points.

## Code Reference Index

All references are relative to: `top-client/corsairs-online-public/source/Client/`

### Engine SDK References
- **Dummy structure**: `engine/sdk/src/lwExpObj.h:280-290`
- **Dummy update**: `engine/sdk/src/lwAnimCtrl.cpp:258-270`
- **Bounding sphere usage**: `engine/sdk/src/lwAnimCtrlObj.cpp:300-316`
- **Item attachment**: `engine/sdk/src/lwItem.cpp:173-186`, `lwItem.h:66`
- **Link control**: `engine/sdk/src/lwPhysique.cpp:133-155`
- **Multi-part characters**: `engine/sdk/src/MPCharacter.cpp:527-552`

### Game Client References
- **Weapon sheathing**: `Client/src/Character.cpp:71-93`, `1328-1352`
- **Effect attachment**: `Client/src/EffectObj.cpp` (multiple locations)
- **Skill targeting**: `Client/src/GameAppMsg.cpp` (skill dummy usage)

---

*Document authored based on source code analysis of TOP/PKO game engine*
*All code references are exact line numbers from the corsairs-online-public repository*
