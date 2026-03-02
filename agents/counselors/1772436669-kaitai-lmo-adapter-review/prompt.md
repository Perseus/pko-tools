# Review Request

## Question

Review the implementation plan for a Kaitai LMO adapter in the pko-tools Rust project. The plan replaces a hand-written binary parser (~1300 lines) with an adapter that converts Kaitai-generated Rust code (6187 lines) into existing domain types. Please review for correctness, completeness, risks, and suggest improvements.

## Plan Under Review

### Kaitai LMO Adapter: Replace Hand-Written Parser

#### Context

The LMO parser in `src-tauri/src/map/lmo.rs` is ~1300 lines of hand-written cursor-based binary parsing — the most complex parser in pko-tools and the one most prone to subtle bugs (e.g., the `lwBlendInfo` size bug that corrupted 17/565 buildings). PR #37 already scaffolded:

- `.ksy` specs for all PKO binary formats (`formats/pko_lmo.ksy` — 1,226 lines, 50+ types)
- Generated Rust code at `gen/kaitai/pko_lmo.rs` (6,187 lines)
- Backend selection in `lmo_loader.rs` with `PKO_LMO_PARSER=kaitai` env var
- A stub `load_lmo_kaitai()` that falls back to the native parser

The goal: implement the adapter converting `PkoLmo` parsed structs into `LmoModel` domain types so both backends produce identical output and we can eventually deprecate the hand-written parser.

#### Architecture

```
.lmo file bytes
      │
      ▼
  BytesReader (kaitai runtime)
      │
      ▼
  PkoLmo::read()  ← generated code, parse-on-access via RefCell
      │
      ▼
  kaitai_to_lmo() ← NEW adapter function
      │
      ▼
  LmoModel { version, geom_objects: Vec<LmoGeomObject> }  ← existing domain types
      │
      ▼
  build_gltf_from_lmo / build_glb_from_lmo / load_scene_models / terrain.rs
```

#### Phase 1: Wire the kaitai crate into the build
- Add `kaitai = "0.1.2"` to Cargo.toml
- Add `mod gen;` or path-based module to lib.rs
- Add `use crate::gen::kaitai::pko_lmo::*;` to lmo_loader.rs

#### Phase 2: Implement the adapter (`kaitai_to_lmo`)
Convert Kaitai's `PkoLmo` struct tree into `LmoModel`:
- PkoLmo → LmoModel (version, iterate objects)
- PkoLmo_ObjectEntry → filter by obj_type == 1 (geometry)
- PkoLmo_GeometryChunk → LmoGeomObject (header, materials, mesh, anim)
- PkoLmo_MaterialSection → Vec<LmoMaterial>
- PkoLmo_MeshSection → vertices, normals, texcoords, colors, indices, subsets
- PkoLmo_AnimSection → LmoAnimData + texture/opacity anims (when parse_animations=true)

Key details:
- Matrix decomposition reuses existing `decompose_matrix43()` from lmo.rs (make it pub(crate))
- Render state extraction maps PkoLmo_RenderStateAtom to MaterialRenderState
- FVF decoding is handled by Kaitai spec — vertex arrays are pre-separated
- Blend info skip is correct in .ksy (20 bytes per vertex)

#### Phase 3: Make shared utilities accessible
- Make `decompose_matrix43` pub(crate)
- Make MaterialRenderState and D3D constants pub(crate)

#### Phase 4: Equivalence testing
Parse the same .lmo files with both backends, assert field-by-field equality. Also batch test all .lmo files in a test directory.

#### Phase 5: Remove fallback and update default
Remove WARN_ONCE fallback. Consider making Kaitai the default backend once tests pass.

#### Files Modified
| File | Action |
|---|---|
| src-tauri/Cargo.toml | Add kaitai = "0.1.2" dependency |
| src-tauri/src/lib.rs | Add mod gen or path-based module |
| src-tauri/src/map/lmo.rs | Make decompose_matrix43, render state constants pub(crate) |
| src-tauri/src/map/lmo_loader.rs | Implement kaitai_to_lmo() adapter + equivalence tests |

#### Risks
- kaitai crate version mismatch with generated code
- RefCell access patterns (lazy evaluation) may cause runtime panics
- Version branches (0x0000, 0x1004, 0x1005) must be handled in adapter

## Existing Code Context

### lmo_loader.rs (current scaffold)
```rust
use std::path::Path;
use std::sync::Once;
use anyhow::Result;
use super::lmo::LmoModel;

const ENV_LMO_PARSER: &str = "PKO_LMO_PARSER";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LmoParserBackend {
    Native,
    Kaitai,
}

fn parse_lmo_backend(raw: Option<&str>) -> LmoParserBackend {
    match raw.map(|v| v.trim().to_ascii_lowercase()) {
        Some(v) if v == "kaitai" || v == "ksy" => LmoParserBackend::Kaitai,
        _ => LmoParserBackend::Native,
    }
}

pub fn load_lmo(path: &Path) -> Result<LmoModel> {
    match selected_lmo_backend() {
        LmoParserBackend::Native => super::lmo::load_lmo(path),
        LmoParserBackend::Kaitai => load_lmo_kaitai(path, true),
    }
}

fn load_lmo_kaitai(path: &Path, parse_animations: bool) -> Result<LmoModel> {
    static WARN_ONCE: Once = Once::new();
    WARN_ONCE.call_once(|| {
        eprintln!("PKO_LMO_PARSER=kaitai selected, but Kaitai adapter is scaffold-only; falling back to native parser");
    });
    if parse_animations {
        super::lmo::load_lmo(path)
    } else {
        super::lmo::load_lmo_no_animation(path)
    }
}
```

### Domain types (from lmo.rs)
```rust
pub struct LmoModel { pub version: u32, pub geom_objects: Vec<LmoGeomObject> }
pub struct LmoGeomObject {
    pub id: u32, pub parent_id: u32, pub obj_type: u32, pub mat_local: [[f32;4];4],
    pub vertices: Vec<[f32;3]>, pub normals: Vec<[f32;3]>, pub texcoords: Vec<[f32;2]>,
    pub vertex_colors: Vec<u32>, pub indices: Vec<u32>, pub subsets: Vec<LmoSubset>,
    pub materials: Vec<LmoMaterial>, pub animation: Option<LmoAnimData>,
    pub texuv_anims: Vec<LmoTexUvAnim>, pub teximg_anims: Vec<LmoTexImgAnim>,
    pub mtlopac_anims: Vec<LmoMtlOpacAnim>,
}
pub struct LmoSubset { pub primitive_num: u32, pub start_index: u32, pub vertex_num: u32, pub min_index: u32 }
pub struct LmoMaterial {
    pub diffuse: [f32;4], pub ambient: [f32;4], pub emissive: [f32;4], pub opacity: f32,
    pub transp_type: u32, pub alpha_test_enabled: bool, pub alpha_ref: u8,
    pub src_blend: Option<u32>, pub dest_blend: Option<u32>, pub cull_mode: Option<u32>,
    pub tex_filename: Option<String>,
}
pub struct LmoAnimData { pub frame_num: u32, pub translations: Vec<[f32;3]>, pub rotations: Vec<[f32;4]> }
pub struct LmoTexUvAnim { pub subset: usize, pub stage: usize, pub frame_num: u32, pub matrices: Vec<[[f32;4];4]> }
pub struct LmoTexImgAnim { pub subset: usize, pub stage: usize, pub textures: Vec<String> }
pub struct LmoMtlOpacAnim { pub subset: usize, pub keyframes: Vec<LmoOpacityKeyframe> }
pub struct LmoOpacityKeyframe { pub frame: u32, pub opacity: f32 }
```

### Kaitai generated code pattern (from pko_lmo.rs)
```rust
extern crate kaitai;
use kaitai::*;
use std::cell::{Ref, Cell, RefCell};
use std::rc::{Rc, Weak};

pub struct PkoLmo {
    pub _root: SharedType<PkoLmo>,
    pub _parent: SharedType<PkoLmo>,
    pub _self: SharedType<Self>,
    version: RefCell<u32>,
    obj_num: RefCell<u32>,
    objects: RefCell<Vec<OptRc<PkoLmo_ObjectEntry>>>,
    _io: RefCell<BytesReader>,
    // ... lazy-evaluated instance fields with Cell<bool> flags
}

// All field access returns Ref<'_, T>
impl PkoLmo {
    pub fn version(&self) -> Ref<'_, u32> { self.version.borrow() }
    pub fn objects(&self) -> Ref<'_, Vec<OptRc<PkoLmo_ObjectEntry>>> { self.objects.borrow() }
}
```

There are 65+ struct types in the generated code including:
PkoLmo_GeometryChunk, PkoLmo_GeomObjInfoHeader, PkoLmo_MaterialSection, PkoLmo_MeshSection,
PkoLmo_AnimSection, PkoLmo_AnimDataMatrix, PkoLmo_AnimDataTexuv, PkoLmo_AnimDataTeximg,
PkoLmo_AnimDataMtlOpacity, PkoLmo_SubsetInfo, PkoLmo_MtlTexInfoCurrent, etc.

### Build pipeline (build.rs)
- Calls `ksc --target rust --outdir gen/kaitai` for each .ksy file
- Controlled by PKO_KAITAI_BUILD and KSC_BIN env vars
- Generated mod.rs already exists with all 4 modules

### Key complexity areas
1. Three LMO versions (0x0000, 0x1004, 0x1005) with different header layouts
2. FVF flag-driven vertex layout (position, normal, texcoord, vertex colors, blend info)
3. Material format versions (V0000, V0001, Current) with different render state and texture info sizes
4. Matrix decomposition (3x4 → translation + quaternion) is algorithmic, stays in Rust
5. Multiple animation subsystems: bone TRS, UV transforms, texture image swaps, material opacity

## Instructions
You are providing an independent review. Be critical and thorough.
- Analyze the plan for correctness and completeness
- Identify risks, tradeoffs, and blind spots
- Flag any issues with the Kaitai Rust runtime (kaitai crate 0.1.2) — it's not widely used
- Consider the RefCell/Rc access patterns and potential pitfalls
- Evaluate whether the phasing makes sense
- Suggest alternatives if you see better approaches
- Be direct and opinionated — don't hedge
- Structure your response with clear headings
