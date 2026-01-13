# Changelog

## [0.1.2] - 2025-01-13

### Features & Improvements

#### Import/Export Fixes

**Critical Bug Fixes:**
- **Fixed mesh index data type mismatch** - Import now correctly handles both U16 and U32 index formats, previously all mesh topology was broken during round-trip conversion
- **Fixed bone hierarchy import** - Parent relationships now use correct bone array positions instead of glTF node indices
- **Fixed inverse bind matrix matching** - IBMs now correctly match to bones via original node index tracking
- **Fixed animation frame count** - Frame calculation now includes endpoint (+1), fixing off-by-one frame loss
- **Fixed quaternion interpolation** - Animation now accounts for quaternion double cover (q and -q equivalence) ensuring shortest rotation path

**Multi-Part Model Support:**
- Fixed multi-part models (like Black Dragon with 2 mesh parts) - all parts now correctly export and import
- Bounding spheres now preserve their mesh association during round-trip conversion
- Model parts display correctly in metadata panel with their LGO file IDs

**Other Import/Export Improvements:**
- LAB version information now preserved during round-trip (was previously hardcoded)
- Dummy node IDs correctly extracted from glTF extras (was using node index instead)
- Vertex element sequence now properly populated during glTF import
- TextureInfo uses correct invalid type marker (0xFFFFFFFF instead of 0x7FFFFFFF)

#### Model Viewer

**New Debug Visualization:**
- **"Show Mesh Outlines" toggle** - Display colored wireframe overlay to distinguish mesh parts
- **Per-mesh visibility controls** - Toggle individual mesh parts on/off (appears when model has multiple parts)
- **Color-coded bounding spheres** - Spheres now colored by their associated mesh (8-color palette)
- **Scaled debug helpers** - Bone and dummy indicators now scale with model size (~1.5% of model dimensions)
- **Improved helper visibility** - Bones and dummies now render on top of mesh (no longer hidden behind geometry)

![Multi-mesh highlight showing colored wireframe overlays](changelog-assets/multi-mesh-highlight.png)

![Bounding spheres display with color-coding by mesh](changelog-assets/bounding-spheres-display.png)

![Bone info tooltip showing detailed bone information](changelog-assets/bone-info-tooltip.png)

**Character Metadata Panel:**
- New panel showing model information at top-left of viewer
- Displays: character name/ID, model ID, animation ID
- Shows skeleton info: bone count, frame count, dummy count
- Shows geometry info: vertex count, triangle count, material count
- Lists model parts with colored indicators
- Shows debug helper counts (bounding spheres, boxes)

#### Removed
- Removed "Ghost Mesh Opacity" slider (no longer needed since helpers render on top)

#### Known Issues
- Toggling debug helpers (bones, dummies, mesh outlines) in certain orders may cause rendering issues - will be fixed in next update

---

### Internal

#### Testing

**New Test Suites:**
- `model_088_roundtrip_test.rs` - Comprehensive LAB+LGO round-trip tests for Attendant model (38 bones, 888 vertices)
- `model_725_black_dragon_test.rs` - Multi-part model tests for Black Dragon (2 mesh parts, 50 bones)
- `hierarchy_tests.rs` - Bone hierarchy validation
- `index_space_tests.rs` - Index space consistency tests
- `skinning_tests.rs` - Skeletal skinning tests
- `byte_equality_test.rs` - Binary comparison tests
- `struct_comparison_test.rs` - Struct field comparison tests

**Test Fixtures Added:**
- Known-good LAB files: 0000.lab, 0001.lab, 0002.lab, 0003.lab, 0088.lab, 0725.lab
- Known-good LGO files: Multiple character model parts (0000-0003 series, 0088, 0725)
- Known-good glTF exports: 1.gltf through 4.gltf, 789.gltf
- Test textures: 0088000000.bmp, 0725000000.bmp

**Test Coverage:**
- LAB round-trip: bones, animation frames, dummies, inverse bind matrices
- LGO round-trip: vertices, indices, materials, textures, bounding spheres
- Mesh header bone fields, vertex element sequences, texture info fields
- Helper data (bounding spheres, boxes, dummies)

#### Tooling

**Claude Code Skills:**
- `tdd` - Test-Driven Development guidance for Rust backend and TypeScript frontend
- `pko-client-reference` - Reference guide for PKO game client source code validation
- `skill-creator` - Tools for creating new Claude Code skills

#### Code Quality
- Added PartialEq/Eq derives to ColorKeyType, TextureType, D3DVertexElement9 enums
- Made D3DVertexElement9 fields public for test access
- Made animation, character, mesh modules public for testing
- Added original_node_index field to LwBoneBaseInfo for IBM matching
- New `MeshHighlights.tsx` component for wireframe overlays
- New `Card` UI component
- Configurable helper size constants (BONE_HELPER_SCALE_PERCENT, etc.)