# How the Engine Knows Which Dummy to Use for What

## Executive Summary

The engine uses **three discovery mechanisms** to determine which dummy serves which purpose:

1. **Hardcoded Convention** (Character skeleton standard IDs 0-15)
2. **Data-Driven Configuration** (Items and skills specify dummy IDs in database tables)
3. **Algorithmic Mapping** (Code logic maps game state → dummy ID)

There is **no central registry or enum** - different systems use different discovery methods.

---

## Discovery Mechanism 1: Hardcoded Skeleton Convention

### Standard Character Dummy Layout

**Source**: `CharacterModel.h` (lines 25-42)

```cpp
/*
	dummy_0		脚基座     (foot base)
	dummy_1		头顶       (head top)
	dummy_2		胸部       (chest)
	dummy_3		丹田       (pelvis/dantian)
	dummy_4		左肩       (left shoulder)
	dummy_5		左臂       (left arm)
	dummy_6		左手       (left hand)
	dummy_7		右肩       (right shoulder)
	dummy_8		右臂       (right arm)
	dummy_9		右手       (right hand)
	dummy_10	左腿       (left thigh)
	dummy_11	左膝       (left calf)
	dummy_12	左脚       (left foot)
	dummy_13	右腿       (right thigh)
	dummy_14	右膝       (right calf)
	dummy_15	右脚       (right foot)
*/

enum {
	LINK_ID_BASE = 0,
	LINK_ID_HEAD = 1,
	LINK_ID_CHEST = 2,
	LINK_ID_PELVIS = 3,
	LINK_ID_LEFTCLAVICLE = 4,
	LINK_ID_LEFTARM = 5,
	LINK_ID_LEFTHAND = 6,
	LINK_ID_RIGHTCLAVICLE = 7,
	LINK_ID_RIGHTARM = 8,
	LINK_ID_RIGHTHAND = 9,
	LINK_ID_LEFTTHIGH = 10,
	LINK_ID_LEFTCALF = 11,
	LINK_ID_LEFTFOOT = 12,
	LINK_ID_RIGHTTHIGH = 13,
	LINK_ID_RIGHTCALF = 14,
	LINK_ID_RIGHTFOOT = 15,

	LINK_ID_NUM = 24,  // Total slots (allows extension to 24)
};
```

**Key Points**:
- IDs 0-15 are **standardized across all characters**
- The enum provides **semantic names** for hardcoded IDs
- Character artists must follow this convention when creating models
- Code can safely assume dummy_6 is always the left hand

**Example Usage**:
```cpp
// Attaching a weapon to the right hand
AttachItem(LINK_ID_RIGHTHAND, weapon_item, -1);
// Internally uses dummy_9 (right hand)
```

### Extended Dummy IDs (16-23)

**Source**: `CharacterModel.h` line 62
```cpp
LINK_ID_NUM = 24,  // Total capacity
```

The enum reserves 24 slots but only defines 16. This leaves IDs 16-23 **undefined by convention** but available for:
- Weapon sheathing positions (discovered via next mechanism)
- Character-specific attachment points
- Special effect spawn points

---

## Discovery Mechanism 2: Data-Driven Configuration

### Item Database: Effect Dummy Assignments

**Source**: `ItemRecord.h` (lines 175-176)

```cpp
struct CItemRecord {
    // ... other fields ...

    short sEffect[defITEM_BIND_EFFECT_NUM][2];  // Weapon bound effects and corresponding dummy
    //           ^effect pairs (up to 8)
    //                                      ^[effect_id, dummy_id]

    short sItemEffect[2];      // Item appearance effect
    short sAreaEffect[2];      // Effect when placed on ground
    short sUseItemEffect[2];   // Effect when used
};
```

**How It Works**:
- Each item in the item database can specify up to **8 effect-dummy pairs**
- Format: `[effect_id, dummy_id]`
- Example: `[flame_effect_id, 6]` → attach flame to dummy 6 (left hand)

**Example Scenario**:
```
ItemRecord for "Flaming Sword":
  sEffect[0] = [1234, 6]   // Flame effect 1234 on dummy 6 (left hand)
  sEffect[1] = [1235, 9]   // Spark effect 1235 on dummy 9 (right hand)
  sEffect[2] = [0, 0]      // Unused slot
```

When the player equips this sword:
1. Engine reads `sEffect` array from ItemRecord
2. For each non-zero pair:
   - Spawn effect with ID `sEffect[i][0]`
   - Attach to dummy `sEffect[i][1]`

**Database-Driven Discovery**:
- Item designers choose which dummy in the **item database**
- No code changes needed to add new visual effects
- Different items can use different dummies for the same type of effect

### Skill Database: Action & Target Dummy Assignments

**Source**: `SkillRecord.h` (discovered in grep results)

```cpp
struct CSkillRecord {
    // ... skill properties ...

    short sActionDummyLink[defSKILL_ACTION_EFFECT];  // Caster character link points
    short sActionEffect[defSKILL_ACTION_EFFECT];     // Caster character effects
    short sActionEffectType[defSKILL_ACTION_EFFECT]; // Effect scaling type

    short sItemDummyLink;                // Caster item link point
    short sItemEffect1[defSKILL_ITEM_EFFECT];  // Caster item effect + timing
    short sItemEffect2[defSKILL_ITEM_EFFECT];

    short sSkyEffectActionDummyLink;     // Flying effect spawn point (character dummy)
    short sSkyEffectItemDummyLink;       // Flying effect spawn point (item dummy)
    short sSkyEffect;                    // Flying effect ID

    short sTargetDummyLink;              // Hit target link point
    short sTargetEffectID;               // Hit effect ID

    short sAgroundEffectID;              // AOE ground effect
    short sWaterEffectID;                // AOE water surface effect
};
```

**How It Works**:
Skills specify **multiple dummy contexts**:

1. **Caster dummies** (`sActionDummyLink`): Where to spawn effects on the caster
   - Example: `[2]` → chest dummy for casting animation glow

2. **Item dummies** (`sItemDummyLink`): Where to spawn weapon effects
   - Example: `6` → left hand for magic staff glow

3. **Projectile spawn dummies** (`sSkyEffectActionDummyLink`):
   - Example: `6` → left hand to shoot fireball from hand
   - Example: `0` → feet to spawn ground slam shockwave

4. **Target impact dummies** (`sTargetDummyLink`):
   - Example: `1` → head for mind control effect
   - Example: `2` → chest for damage burst

**Example from Source** (`GameAppMsg.cpp`):
```cpp
// 使用道具表里的dummy (Use the dummy from the item table)
if (_pSkillInfo->sTargetDummyLink >= 0 &&
    _pTarget->GetObjDummyRunTimeMatrix(&mat, _pSkillInfo->sTargetDummyLink) >= 0) {
    // Spawn skill effect at target's specific dummy location
}
```

**Database-Driven Discovery**:
- Skill designers choose dummies in the **skill database**
- Same skill can target different dummies based on skill configuration
- Allows per-skill customization without code changes

---

## Discovery Mechanism 3: Algorithmic Mapping

### Weapon Sheathing: Type → Back Dummy Mapping

**Source**: `Character.cpp` (lines 71-115)

```cpp
inline int GetWeaponBackDummy(int nWeaponType, bool isLeftHand) {
    int nBackDummy = -1;
    if (isLeftHand) {
        switch (nWeaponType) {
        case 2:   // Glave (large sword)
        case 5:   // Falchion (sabre)
        case 9:   // Cosh (club)
        case 10:  // Sinker (hammer)
            nBackDummy = 21;  // Left back storage
            break;
        case 1:   // Sword
        case 3:   // Bow
        case 11:  // Shield
            nBackDummy = 22;  // Left side storage
            break;
        case 4:   // Harquebus (gun)
        case 7:   // Stylet (dagger)
        case 8:   // Moneybag
            nBackDummy = 23;  // Left hip storage
            break;
        }
    } else {
        switch (nWeaponType) {
        case 1:   // Sword
        case 2:   // Glave
        case 5:   // Falchion
        case 9:   // Cosh
        case 10:  // Sinker
            nBackDummy = 21;  // Right back storage
            break;
        case 3:   // Bow
        case 11:  // Shield
        case 18:  // (unknown type)
        case 19:  // (unknown type)
            nBackDummy = 22;  // Right side storage
            break;
        case 4:   // Harquebus
        case 7:   // Stylet
        case 8:   // Moneybag
            nBackDummy = 23;  // Right hip storage
            break;
        }
    }
    return nBackDummy;
}
```

**How It Works**:
- **Input**: Weapon type ID + which hand (left/right)
- **Output**: Back dummy ID (20-23 range)
- **Logic**: Algorithm maps weapon categories to storage locations

**Weapon Storage Dummy IDs**:
| Dummy ID | Location | Weapon Types |
|----------|----------|--------------|
| 20 | Right back | Large weapons (right) |
| 21 | Left back OR right back | Large weapons (context-dependent) |
| 22 | Side storage | Medium weapons (bows, shields) |
| 23 | Hip storage | Small weapons (daggers, guns) |

**Why Algorithmic**:
- Weapon types are defined in `EItemType` enum (ItemRecord.h lines 31-74)
- Storage location is **inferred from weapon category**
- Artists don't configure this per-item; it's **automatic based on type**

**Usage Example** (`Character.cpp` lines 1328-1352):
```cpp
int dummy = -1;
if (_pHandItem[enumEQUIP_LHAND]) {
    AttachItem(enumEQUIP_LHAND, _pHandItem[enumEQUIP_LHAND], -1);

    // Get storage dummy for this weapon type
    dummy = GetWeaponBackDummy(
        _pHandItem[enumEQUIP_LHAND]->GetItemInfo()->sType,  // Weapon type
        true  // Left hand
    );

    if (dummy > 0) {
        // Attach weapon to storage dummy (sheathe it)
        AttachItem(dummy, _pHandItem[enumEQUIP_LHAND], -1, 3);
    }
}
```

### Multi-Part Character Dummy Mapping

**Source**: `CharacterModel.h` (lines 259-277)

```cpp
inline int CCharacterModel::GetBoatPart(int dummy) {
    switch (dummy) {
    case 0:
    case 1:
        return 1;  // Bow section
        break;
    case 2:
    case 3:
    case 7:
        return 0;  // Hull section
        break;
    case 4:
    case 5:
    case 6:
        return 2;  // Stern section
    default:
        return 0;
    }
}
```

**How It Works**:
- Ships (warships) have **multiple body parts** (hull, bow, stern)
- Each dummy maps to a **body part index**
- Algorithm determines which part a dummy belongs to

**Why Algorithmic**:
- Ship models have consistent dummy-to-part mapping
- Avoids storing redundant data per-ship
- Centralized logic for multi-part attachments

---

## Discovery Summary Table

| System | Discovery Method | Configuration Location | Example |
|--------|------------------|------------------------|---------|
| **Equipment Slots** | Hardcoded Convention | `CharacterModel.h` enum | Dummy 9 = Right Hand |
| **Bounding Spheres** | ID Matching | Animation file + Hardcoded | Sphere ID 1 → Dummy 1 |
| **Item Effects** | Database Configuration | ItemRecord.sEffect | Flame effect → Dummy 6 |
| **Skill Effects** | Database Configuration | SkillRecord.sActionDummyLink | Fireball → Dummy 6 |
| **Skill Targets** | Database Configuration | SkillRecord.sTargetDummyLink | Mind control → Dummy 1 |
| **Weapon Sheathing** | Algorithmic Mapping | GetWeaponBackDummy() | Large sword → Dummy 21 |
| **Ship Parts** | Algorithmic Mapping | GetBoatPart() | Dummy 4 → Stern part |

---

## Why Multiple Discovery Methods?

### 1. Hardcoded Convention (Dummies 0-15)
**Pros**:
- **Fast lookup**: Direct array indexing
- **Type-safe**: Enum prevents typos
- **Standard across models**: All characters compatible
- **No database overhead**: No file loading

**Cons**:
- **Inflexible**: Changing requires code recompilation
- **Limited**: Only 16 standard positions

**Best For**: Core character attachment points that never change

### 2. Database Configuration (Items & Skills)
**Pros**:
- **Designer-friendly**: No code changes needed
- **Per-asset customization**: Each item/skill can choose dummies
- **Rapid iteration**: Change dummy IDs without rebuild
- **Unlimited combinations**: Mix and match effects/dummies

**Cons**:
- **No type checking**: Designer can specify invalid dummy ID
- **Harder to debug**: Effect-dummy relationship buried in data
- **File loading overhead**: Must parse database

**Best For**: Visual effects and attachments that vary per-item/skill

### 3. Algorithmic Mapping (Weapon Sheathing)
**Pros**:
- **Automatic behavior**: No manual configuration per weapon
- **Consistent logic**: All weapons of a type behave identically
- **Maintainable**: One place to change category rules

**Cons**:
- **Less flexible**: Can't override per-weapon
- **Hidden logic**: Rules not visible in data
- **Requires code understanding**: Non-programmers can't change

**Best For**: Systematic behaviors with clear categories

---

## How Artists Know Which Dummy ID to Use

### For Standard Character Dummies (0-15):
1. **Reference the enum** in `CharacterModel.h`
2. **Follow naming convention**: `dummy_6` in 3DS Max = `LINK_ID_LEFTHAND`
3. **Check existing characters**: Copy dummy layout from template

### For Extended Dummies (16+):
1. **Weapon storage dummies (20-23)**:
   - **Not artist-configured**: Automatically assigned by `GetWeaponBackDummy()`
   - Artists must create dummies 20-23 on character skeleton
   - Exact placement is art-directed (e.g., dummy 21 = "between shoulder blades")

2. **Bounding sphere dummies**:
   - **Match bounding sphere IDs**: Sphere 0 → Dummy 0, Sphere 1 → Dummy 1, etc.
   - Artists place bounding spheres in 3DS Max
   - Exporter assigns IDs sequentially
   - Engine matches sphere.id == dummy.id

3. **Effect spawn points (item/skill database)**:
   - **Designer-specified**: Database entry says "use dummy 6"
   - Artists ensure dummy 6 exists and is correctly positioned
   - If missing, effect spawns at origin (0,0,0)

### Workflow Example: Adding a New Weapon

1. **Artist**: Creates weapon model, designates attachment point as "dummy_6" (left hand)
2. **Artist**: Adds sheathed position geometry aligned with dummy 21 (back)
3. **Code**: `GetWeaponBackDummy()` auto-assigns dummy 21 for this weapon type
4. **Designer**: Adds weapon glow effect to database: `sEffect = [glow_id, 6]`
5. **Runtime**:
   - When equipped: Attach weapon to dummy 6 (left hand)
   - When sheathed: Attach weapon to dummy 21 (back)
   - Glow effect: Spawns at dummy 6

---

## Code References

### Hardcoded Convention
- **Enum definition**: `CharacterModel.h:44-63`
- **Chinese comments**: `CharacterModel.h:25-42`
- **Usage example**: `CharacterModel.h:203-209` (AttachItem interface)

### Database Configuration
- **Item effects**: `ItemRecord.h:175-176`
- **Skill caster dummies**: `SkillRecord.h` (sActionDummyLink)
- **Skill target dummies**: `SkillRecord.h` (sTargetDummyLink)
- **Usage example**: `GameAppMsg.cpp` (skill target dummy usage)

### Algorithmic Mapping
- **Weapon sheathing**: `Character.cpp:71-115`
- **Ship part mapping**: `CharacterModel.h:259-277`
- **Usage example**: `Character.cpp:1328-1352`

---

## Conclusion

The engine does **not** have a single central registry for dummy purposes. Instead, it uses a **layered discovery system**:

1. **Convention layer** (0-15): Standard skeleton IDs everyone knows
2. **Configuration layer** (items/skills): Database-driven per-asset customization
3. **Algorithm layer** (sheathing/multi-part): Code logic infers dummy from context

This hybrid approach balances:
- **Performance** (hardcoded standard IDs)
- **Flexibility** (database configuration)
- **Automation** (algorithmic mapping)

The discovery method depends on **who needs to know**:
- **Programmers**: Use enums and algorithms
- **Artists**: Follow standard IDs 0-15, create extended IDs 16-23
- **Designers**: Configure item/skill dummy IDs in database

This is why the same character skeleton can serve **multiple purposes simultaneously** - different systems discover "their" dummies through different mechanisms, all coexisting on the same skeleton.
