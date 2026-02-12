# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Workflow

When asked to implement something, always create a written plan first and get user approval before writing code. Never jump straight into implementation.

## Languages & Linting

Primary languages: Rust (main backend/tools), TypeScript (web frontend/tools). Always run `cargo clippy` after Rust changes and fix warnings. Run all tests before considering a task complete.

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

## 3D/Engine Conventions

This project involves PKO (Pirate King Online) game engine files. Coordinate systems differ between PKO/glTF (right-handed) and Unity (left-handed) — always account for coordinate handedness conversions when working with 3D positions, especially Z-axis flipping and terrain height offsets.

## Debugging

When fixing visual/rendering bugs, verify the fix actually resolves the visual issue — don't assume the first hypothesis is correct. Common pitfalls: emissive factors preserved without their textures, wrong atlas regions/sprite coordinates, texture encoding mismatches (PKO-encoded vs standard BMP/DDS).

## Import/Export Pipeline

When working on import/export pipelines (GLB, glTF, PKO models), always verify binary size matches expected format by checking FVF flags, vertex color data inclusion, and texture path resolution (character folder vs items folder depending on model type).

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

## Item Import Pipeline (`src-tauri/src/item/model.rs`)

The item import converts glTF/GLB files into PKO `.lgo` + `.bmp` files. Key functions and concepts:

### Core Functions
- **`import_item_from_gltf()`** — Main import: reads glTF, merges meshes, writes LGO + BMP files. Accepts `scale_factor: f32` to resize vertices.
- **`build_gltf_from_lgo()`** — Preview: reads an LGO back and generates glTF JSON for the 3D viewer. Used by `load_model_preview` command.
- **`build_item_primitives_split()`** — Shared by both export viewer and preview. Converts LGO mesh data into glTF primitives, splitting main mesh from glow overlay. Takes `has_overlay: bool` — pass `true` for PKO items, `false` for imported models.
- **`build_single_material()`** — Builds a glTF PBR material from a `CharMaterialTextureInfo`. Searches for textures in `texture/item/`, `texture/character/`, `texture/` subdirectories.
- **`extract_material_colors()`** — Extracts diffuse and emissive colors from PKO material data for glTF output.

### Multi-Mesh Merging
External GLB files (e.g., from Blender/Sketchfab) often have multiple mesh nodes. The import merges ALL non-overlay mesh nodes into a single LGO mesh:
- Collects all mesh node indices (skipping nodes tagged `"glowOverlay"` in extras)
- Reads vertices from each mesh's first primitive via `read_prim_vertices()` (stride-aware)
- Offsets indices from subsequent meshes by cumulative vertex count
- If vertex color counts don't match vertex count after merging, vertex colors are discarded

### Glow Overlay (Subset 1 Convention)
In PKO items, subset index 1 is the glow overlay used for forge effects. `build_item_primitives_split` sets it to alpha=0 (invisible) when `has_overlay=true`. For imported models without overlays, pass `has_overlay=false` to avoid hiding legitimate geometry.

### Material/Texture Gotchas
- **Emissive texture loss**: PKO format can't store emissive textures. If a source glTF has `emissive_factor=[1,1,1]` + `emissive_texture`, the import zeros out emissive to prevent white wash-out (the texture modulated where glow appeared, but we lose that).
- **Preview emissive**: `build_gltf_from_lgo` zeros out emissive on all preview materials to avoid wash-out from LGO files with stored white emissive.
- **BMP encoding**: Import writes standard BMPs (not PKO-encoded). The load-side `decode_pko_texture` handles both formats.
- **Texture search**: `build_single_material` searches `project_dir/{texture/item, texture/character, texture}/` for textures. For import preview, pass the import directory (e.g., `imports/item/`) as `project_dir`.

### Scale
- PKO items are small: a typical sword is ~2.7 units tall (Y range ~-0.4 to 2.4)
- External models are often much larger (Blender meters vs PKO units)
- `import_item_from_gltf` accepts `scale_factor` parameter, applied to all vertex positions after reading
- The import wizard UI has a scale factor input at `src/features/import/steps/ConfigurationStep.tsx`

### Import Data Flow (End-to-End)
1. UI: `ConfigurationStep` collects modelId, filePath, scaleFactor
2. UI: `ProcessingStep` calls `importItemFromGltf(modelId, filePath, scaleFactor)`
3. TS: `src/commands/item.ts` invokes Tauri command `import_item_from_gltf`
4. Rust: `src-tauri/src/item/commands.rs` resolves project dir, calls `model::import_item_from_gltf`
5. Rust: `src-tauri/src/item/model.rs` reads glTF, merges meshes, scales vertices, writes LGO + BMPs
6. UI: `ResultStep` shows output files with "View Model" button
7. "View Model": calls `load_model_preview(lgo_path)` → `build_gltf_from_lgo` → sets glTF atom → navigates to viewer

### LwVector3 Access Pattern
`LwVector3` is a newtype wrapper: access fields via `v.0.x`, `v.0.y`, `v.0.z` (not `v.x`).

## Known Limitations

- **Import:** Only supports single-mesh characters. Multi-mesh models or complex subsequences will fail
- **Item Import:** Multi-mesh GLB files are merged into one LGO mesh. Overlay detection is by node extras (`"glowOverlay"`), not automatic.
- **Alignment Issues:** Some models (e.g., Black Dragon wings) have scaling issues on export
- **Bounding Spheres:** May be slightly off; adjust via bone custom properties in Blender

## Development Notes

- Frontend uses path alias `@/` → `./src/`
- Frontend uses `react-router` (NOT `react-router-dom`) for routing
- Tauri expects fixed port 1420 for dev server
- Sentry is configured for error tracking in production
- The app creates `exports/gltf/` and `imports/character/` directories at startup
- Cargo commands must run from `src-tauri/` directory (or use `cd src-tauri &&`)
