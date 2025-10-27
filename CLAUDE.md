# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Tauri-based desktop application for converting TOP/PKO game client assets. It enables importing, editing, and exporting character models, animations, and textures by converting proprietary game formats (`.lgo`, `.lab`, `.bmp`) to/from standard glTF format for use in 3D tools like Blender.

**Tech Stack:**
- **Frontend:** React + TypeScript + Vite + TailwindCSS
- **Backend:** Rust (Tauri v2)
- **3D Rendering:** Three.js (@react-three/fiber, @react-three/drei)
- **State Management:** Jotai
- **Package Manager:** pnpm (9.15.2+)

## Common Commands

### Development
```bash
# Install dependencies
pnpm install

# Run development server (starts Tauri app with hot-reload)
pnpm tauri dev

# Build TypeScript
pnpm build

# Lint (TypeScript compilation)
tsc --noEmit
```

### Rust Backend
```bash
# Build Rust code
cd src-tauri
cargo build

# Run Rust tests
cargo test

# Run specific test
cargo test test_name

# Check for compilation errors
cargo check
```

### Production Build
```bash
# Build production application
pnpm tauri build
```

## Architecture

### Frontend Structure

The React application uses a feature-based architecture:

- **`src/App.tsx`** - Root component with routing and global state initialization
- **`src/features/`** - Feature-specific components grouped by domain:
  - `character/` - Character model viewing, export/import controls
  - `item/` - Item asset handling (in development)
- **`src/pages/`** - Top-level page components (characters, items, project-creator)
- **`src/components/`** - Shared UI components
  - `ui/` - Radix UI primitives (shadcn/ui style)
  - `SideNav/` - Main navigation sidebar
  - `WorkspaceNavigator/` - Right-side panel for asset browsing
  - `StatusBar/` - Bottom status bar
- **`src/commands/`** - Tauri command wrappers (frontend → backend communication)
- **`src/store/`** - Jotai atoms for global state
- **`src/types/`** - TypeScript type definitions

**State Management:** Uses Jotai for global state (projects, characters, items). State atoms are defined in `src/store/` and consumed via `useAtom` hook.

**Routing:** React Router v7 handles navigation between workspaces (characters, items, project creator).

### Backend Structure (Rust)

The Tauri backend is organized into domain modules:

- **`src-tauri/src/lib.rs`** - Main entry point, defines all Tauri commands and app state
- **`src-tauri/src/main.rs`** - Binary entry point (delegates to lib.rs)
- **Module Organization:**
  - `character/` - Character model loading, glTF export/import, CharacterInfo.txt parsing
  - `animation/` - Animation file (`.lab`) parsing and glTF conversion
  - `mesh/` - Mesh file (`.lgo`) parsing, includes:
    - `model.rs` - Main LGOModel struct and glTF conversion logic
    - `core.rs` - Mesh geometry data structures
    - `texture.rs` - Texture and material handling
    - `helper.rs` - Helper objects (bounding spheres, attachment points)
  - `item/` - Item asset handling (in development)
  - `d3d/` - Direct3D format enums and structures (D3DFormat, D3DRenderStateType, etc.)
  - `math/` - Math utilities (LwMatrix44, LwVector3, LwSphere)
  - `projects/` - Project management (client folder selection, project persistence)
  - `db/` - Database utilities
  - `preferences/` - User preferences storage
  - `broadcast/` - Event broadcasting system

**Key Architecture Patterns:**

1. **Binary File Parsing:** Uses `binrw` crate for declarative binary format parsing with `#[binrw]` attributes
2. **glTF Conversion:** Character/mesh/animation modules each implement `to_gltf_*` and `from_gltf` methods
3. **Field Aggregation:** `GLTFFieldsToAggregate` struct accumulates glTF components (buffers, accessors, textures, etc.) as models are processed
4. **Tauri Commands:** All backend functions exposed to frontend via `#[tauri::command]` attribute in `*/commands.rs` files

### Data Flow

1. User selects client folder → scans for `CharacterInfo.txt` and asset files
2. Frontend loads character list via `get_character_list` command
3. User selects character → `load_character` command retrieves model data
4. **Export:** Rust reads `.lgo` + `.lab` files → converts to glTF JSON → frontend downloads file
5. **Import:** User selects glTF file → Rust parses glTF → writes `.lgo`, `.lab`, `.bmp` files to `imports/` folder

## Important Implementation Details

### File Format Versioning

The codebase handles multiple versions of proprietary formats:
- **LGO (mesh):** `EXP_OBJ_VERSION_1_0_0_5` (current)
- **Mesh data:** `MESH_VERSION0001`
- **Material/texture:** `MTLTEX_VERSION0002`

When modifying parsers, check version constants in `src-tauri/src/mesh/model.rs`.

### Character Model IDs

Character models use a complex ID scheme:
```
model_id = (model * 1000000) + (suit_id * 10000) + mesh_part_index
```

Characters can have multiple mesh parts (0-7). Animation files use 4-digit model IDs (`.lab`), while mesh files use 10-digit IDs (`.lgo`).

### glTF Custom Properties

Bone properties from `.lab` files (bounding spheres, helper points) are stored in glTF node extras as custom properties. Preserve these when re-exporting from Blender.

### Coordinate System

The game uses a right-handed coordinate system. Matrix transformations in `src-tauri/src/math/mod.rs` handle conversions between game and glTF coordinate spaces.

## Testing

- Rust tests are located in `#[cfg(test)]` modules within source files
- Some tests reference hardcoded paths in `/mnt/d/EA 1.0.1` and `./test_artifacts/` - update paths as needed
- Key test: `is_able_to_convert_lab_back_to_gltf` in `src-tauri/src/character/mod.rs`

## Known Limitations

- **Import:** Only supports single-mesh characters. Multi-mesh models or complex subsequences will fail
- **Alignment Issues:** Some models (e.g., Black Dragon wings) have scaling issues on export
- **Bounding Spheres:** May be slightly off; adjust via bone custom properties in Blender

## Development Notes

- Frontend uses path alias `@/` → `./src/`
- Tauri expects fixed port 1420 for dev server
- Sentry is configured for error tracking in production
- The app creates `exports/gltf/` and `imports/character/` directories at startup
