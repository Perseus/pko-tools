# Key Source Files Reference

This document lists the most important source files in the PKO client codebase for understanding game file formats and data structures.

## Character System

### Engine Layer

**`client-src/Engine/sdk/include/MPCharacter.h`**
- Core character class extending `lwMatrixCtrl`
- `MPChaLoadInfo` structure: defines character loading parameters (bone file, part files, pixel shader)
- Character loading API: `InitBone()`, `LoadBone()`, `Load()`, `LoadPart()`, `DestroyPart()`
- Animation API: `PlayPose()`, pose control, keyframe processing
- Link item system: attachment points for equipment and effects
- Constants: `LW_MAX_SUBSKIN_NUM` (max character parts), `LW_MAX_LINK_ITEM_NUM` (max attached items)

**`client-src/Engine/sdk/src/MPCharacter.cpp`**
- Implementation of character loading logic
- Binary file parsing for bones and character parts
- Bone hierarchy construction
- Animation blending and pose playback
- Equipment attachment implementation

### Client Layer

**`client-src/Client/src/CharacterModel.h`**
- Higher-level character model management
- Link point ID definitions (lines 46-66):
  - `LINK_ID_BASE` (0): Base/root
  - `LINK_ID_HEAD` (1): Head attachment
  - `LINK_ID_RIGHTHAND` (9): Right hand (weapons)
  - `LINK_ID_LEFTHAND` (6): Left hand (shields)
  - Full body link points for equipment
- `ItemLinkInfo` structure: item attachment metadata
- Character part management interface

**`client-src/Client/src/CharacterModel.cpp`**
- Character model creation and destruction
- Part swapping (changing equipment/appearance)
- Item attachment logic
- Effect attachment to link points

**`client-src/Client/src/Character.h` / `Character.cpp`**
- Game character class (extends CharacterModel)
- High-level game logic for characters
- Character actions, states, and behaviors

## Model System

**`client-src/Engine/sdk/include/lwModel.h`**
- Base model class definition
- Model data structures
- Mesh data organization

**`client-src/Engine/sdk/src/lwModel.cpp`**
- Model file loading (`.lmo` files)
- Vertex data parsing
- Texture coordinate handling
- Material/texture references

**`client-src/Engine/sdk/include/lwModelObject.h`**
**`client-src/Engine/sdk/src/lwModelObject.h`**
- Model object implementation
- Sub-object hierarchy
- Mesh organization within models

## Animation System

**`client-src/Engine/sdk/include/lwAnimCtrl.h`**
- Animation controller interface
- Animation playback control
- Animation blending and transitions

**`client-src/Engine/sdk/src/lwAnimCtrl.cpp`**
- Animation controller implementation
- Frame interpolation
- Animation state management

**`client-src/Engine/sdk/include/lwAnimKeySetPRS.h`**
- Keyframe data structures
- PRS (Position, Rotation, Scale) keyframe sets
- Animation data format

**`client-src/Engine/sdk/src/lwAnimKeySetPRS.cpp`**
- Keyframe data parsing
- Interpolation between keyframes
- Animation curve evaluation

**`client-src/Engine/sdk/include/lwSysCharacter.h`**
**`client-src/Engine/sdk/src/lwSysCharacter.cpp`**
- Character animation system integration
- Pose management
- Character-specific animation handling

## Map System

**`client-src/Engine/sdk/include/MPMap.h`**
- Map class definition
- Terrain and scene management

**`client-src/Engine/sdk/src/MPMap.cpp`**
- Map file loading
- Terrain rendering setup

**`client-src/Engine/sdk/include/MPMapData.h`**
**`client-src/Engine/sdk/src/MPMapData.cpp`**
- Map data structures
- Terrain data organization
- Scene object placement

## Scene Items and Effects

**`client-src/Engine/sdk/include/MPSceneItem.h`**
- Base scene item class
- Scene object interface
- Transformation and rendering

**`client-src/Engine/sdk/include/MPModelEff.h`**
**`client-src/Engine/sdk/src/MPModelEff.cpp`**
- Model effects system
- Visual effects attached to models

## Rendering and Shaders

**`client-src/Engine/sdk/include/MPRender.h`**
**`client-src/Engine/sdk/src/MPRender.cpp`**
- Rendering system interface
- Material and texture handling
- Shader application

**`client-src/Engine/sdk/include/ShaderLoad.h`**
**`client-src/Engine/sdk/src/ShaderLoad.cpp`**
- Shader loading and compilation
- Pixel shader management

## Utility and Math

**`client-src/Engine/sdk/include/lwMath.h`**
**`client-src/Engine/sdk/src/MPMath.cpp`**
- 3D math utilities
- Matrix operations
- Vector math
- Quaternions

**`client-src/Engine/sdk/include/MPColorValue.h`**
**`client-src/Engine/sdk/src/MPColorValue.cpp`**
- Color representation
- Color format conversions

## Data Streaming

**`client-src/Engine/sdk/include/MPDataStream.h`**
**`client-src/Engine/sdk/src/MPDataStream.cpp`**
- Binary data stream reading
- File I/O abstraction
- Memory management for loaded data

## Resource Management

**`client-src/Engine/sdk/include/MPResManger.h`**
**`client-src/Engine/sdk/src/MPResManger.cpp`**
- Resource manager for game assets
- Asset loading and caching
- Resource lifetime management

## Important Constants and Limits

From various headers:

- `LW_MAX_SUBSKIN_NUM`: Maximum number of character parts (body, head, legs, etc.)
- `LW_MAX_LINK_ITEM_NUM`: Maximum number of items that can be attached to a character
- `LINK_ID_NUM`: Total number of link points (24)
- Link point indices 0-15: Predefined attachment points (head, hands, feet, etc.)

## File Format Notes

Based on the source code structure:

- **`.lgo` files**: Character bone/skeleton files (loaded by `LoadBone()`)
- **`.lmo` files**: Model mesh files (loaded by `lwModel::Load()`)
- **`.lws` files**: Scene/skin files, referenced in character loading
- **`.lac` files**: Animation/action files (referenced in pose playback)

## Reading Strategy

1. **For structures**: Start with header files (`.h`) in `Engine/sdk/include/`
2. **For file formats**: Read implementation files (`.cpp`) in `Engine/sdk/src/`
3. **For usage patterns**: Check client code in `Client/src/`
4. **For data flow**: Follow function calls from high-level (Client) to low-level (Engine)

## Cross-Referencing with PKO Tools

When working on the Rust implementation in `src-tauri/src/`:

| Rust Module | Relevant Client Files |
|-------------|----------------------|
| `character/model.rs` | `MPCharacter.cpp`, `lwModel.cpp` |
| `character/mesh.rs` | `lwModel.cpp`, `lwModelObject.cpp` |
| `character/animation.rs` | `lwAnimCtrl.cpp`, `lwAnimKeySetPRS.cpp` |
| `character/texture.rs` | `MPRender.cpp`, texture loading code |
| `mesh/` | `lwModel.cpp`, mesh data structures |
| `animation/` | Animation system files |

Always verify that:
- Binary format byte order matches
- Data structure sizes and layouts match
- Field interpretations are correct
- Coordinate systems align
- Matrix/quaternion conventions match
