---
name: pko-client-reference
description: "Reference guide for PKO (Pirates King Online) game client source code. Use this skill when you need to understand: (1) Game 3D file format specifications (.lgo, .lmo, .lws, .lac files), (2) How the game engine uses character, mesh, animation, or map data, (3) Verify if current import/export code correctly handles game file structures, (4) Understand bone/skeleton hierarchies, texture mapping, or animation systems, (5) Debug or validate any aspect of the file conversion between PKO formats and glTF."
---

# PKO Client Reference

## Overview

This skill provides guidance for referencing the PKO game client source code located in `client-src/` (symlink to `/mnt/i/Work/Client2019`). The source code contains the authoritative implementation of how the game engine loads and uses 3D models, animations, textures, and other game assets.

## When to Reference Client Source

Reference the client source code when:

1. **File Format Questions**: Need to understand the binary format or structure of `.lgo`, `.lmo`, `.lws`, `.lac`, or other game files
2. **Data Usage Verification**: Want to see how the game engine actually uses specific fields or data structures
3. **Import/Export Validation**: Need to verify that the Rust implementation in `src-tauri/src/character/` correctly handles game data
4. **Bone/Skeleton Systems**: Understanding bone hierarchies, link points (dummy nodes), or animation binding
5. **Rendering Details**: How textures, materials, shaders, or vertex data are processed
6. **Animation Systems**: How poses, keyframes, and animation blending work

## Client Source Structure

The client source is organized into three main directories:

### Engine (`client-src/Engine/sdk/`)

Core 3D engine implementation with low-level file loading and rendering:

- **`include/`**: Header files defining data structures and APIs
  - `MPCharacter.h`: Character loading, bone system, pose/animation API
  - `MPMap.h`, `MPMapData.h`: Map loading and terrain
  - `MPModelEff.h`: Model effects and rendering
  - `lwModel.h`, `lwModelObject.h`: Core model data structures
  - `lwAnimCtrl.h`, `lwAnimKeySetPRS.h`: Animation control and keyframe systems
  - `lwSysCharacter.h`: Character system implementation

- **`src/`**: Implementation files (`.cpp`)
  - `MPCharacter.cpp`: Character loading logic
  - `lwModel.cpp`: Model file parsing
  - `lwAnimCtrl.cpp`, `lwAnimKeySetPRS.cpp`: Animation implementation
  - `MPMapData.cpp`: Map data structures

### Client (`client-src/Client/src/`)

Game client implementation with higher-level game logic:

- `Character.cpp`, `Character.h`: Game character class (extends CharacterModel)
- `CharacterModel.cpp`, `CharacterModel.h`: Character model management, part loading, item attachment
  - Defines link point IDs (LINK_ID_HEAD, LINK_ID_RIGHTHAND, etc.)
  - Character part system and equipment attachment
- `Actor.cpp`, `Actor.h`: Base actor class for game entities
- Various game-specific systems (inventory, skills, UI, etc.)

### Common (`client-src/Common/`)

Shared utilities and data structures used by both engine and client.

## Key Concepts

### Character Loading (MPChaLoadInfo)

Characters are loaded with:
- **Bone file**: Skeleton structure defining bone hierarchy
- **Part files**: Up to `LW_MAX_SUBSKIN_NUM` separate mesh parts (head, body, legs, etc.)
- **Pixel shader**: Optional shader for rendering effects

See `MPCharacter.h:38-52` for `MPChaLoadInfo` structure.

### Link Points (Dummy Nodes)

Characters have 16+ predefined link points for attaching items/effects:
- `dummy_0` through `dummy_15`: Attachment points (head, hands, chest, feet, etc.)
- Defined in `CharacterModel.h:46-66`

### File Loading Pattern

Most game files follow this pattern:
1. Engine defines low-level loading (`MPCharacter::Load()`, `lwModel::Load()`)
2. Files are loaded from the game's file system (usually in `character/`, `model/`, `animation/` folders)
3. Data is parsed into internal structures
4. Rendering system uses the loaded data

## Workflow

When you need to reference the client source:

1. **Identify the Question**: What specific aspect do you need to understand?
   - File format structure → Look at parsing code in `.cpp` files
   - Data field meanings → Check header files (`.h`) for structure definitions
   - Usage patterns → See how functions are called in client code

2. **Find Relevant Files**: 
   - Character/model loading: `MPCharacter.h/.cpp`, `CharacterModel.h/.cpp`
   - Animation: `lwAnimCtrl.h/.cpp`, `lwAnimKeySetPRS.h/.cpp`
   - Core data structures: `lwModel.h/.cpp`, `lwModelObject.h/.cpp`
   - Map/terrain: `MPMap.h/.cpp`, `MPMapData.cpp`

3. **Read the Implementation**:
   ```
   Use Read tool to examine the relevant source files
   Focus on structure definitions, file loading functions, and data processing
   ```

4. **Cross-Reference with Current Code**:
   - Compare client source implementation with Rust code in `src-tauri/src/character/`
   - Verify that binary formats, field sizes, and data interpretations match
   - Check that conversions to glTF preserve the intended structure

5. **Document Findings**: When you discover important details, consider noting them for future reference

## Common Reference Patterns

### Understanding a Binary Format

1. Find the load function (e.g., `MPCharacter::LoadBone()`)
2. Read how it opens and parses the file
3. Note byte order, data types, and structure layout
4. Verify Rust implementation matches

### Verifying Bone/Skeleton Handling

1. Check `MPCharacter::InitBone()` and `LoadBone()` in `MPCharacter.cpp`
2. See how bones are stored and accessed
3. Compare with `src-tauri/src/character/model.rs` bone parsing
4. Verify bone hierarchy and transformations match

### Understanding Animation System

1. Review `lwAnimCtrl.h` for animation control structures
2. Check `lwAnimKeySetPRS.h` for keyframe data (Position, Rotation, Scale)
3. See how poses are played with `PlayPose()` functions
4. Verify `src-tauri/src/character/animation.rs` handles animation data correctly

### Checking Link Point Usage

1. See `CharacterModel.h:46-66` for link point definitions
2. Check how items are attached with `AttachItem()` functions
3. Verify that equipment attachment in the tool uses correct link IDs

## Tips

- **Start with headers (`.h`)**: They define structures and APIs without implementation details
- **Then read implementation (`.cpp`)**: Shows actual data processing and file formats
- **Use grep/search**: The codebase is large; search for specific function names or data structures
- **Watch for macros**: Constants like `LW_MAX_SUBSKIN_NUM`, `LINK_ID_HEAD` define important limits
- **Check comments**: Some files have Chinese comments that explain functionality
- **Binary formats**: Look for `fread()`, `fopen()`, byte-by-byte parsing to understand file structures

## Example Usage

**User asks**: "How are character bones stored in the .lgo file?"

**Response**:
1. Read `client-src/Engine/sdk/src/MPCharacter.cpp` focusing on `LoadBone()` function
2. Identify the binary format for bone data
3. Compare with `src-tauri/src/character/model.rs` bone parsing
4. Verify that the Rust code correctly reads bone hierarchy, transformations, and indices

**User asks**: "What does the link_item_id field mean in character files?"

**Response**:
1. Read `client-src/Engine/sdk/include/MPCharacter.h` for `lwSceneItemLinkInfo` structure
2. Read `client-src/Client/src/CharacterModel.h` for link point definitions
3. See how `link_item_id` is used in attachment functions
4. Explain that it identifies which bone/dummy node an item attaches to

## Reference Files

For detailed code exploration, see:

- **references/key_files.md**: List of most important source files with descriptions
