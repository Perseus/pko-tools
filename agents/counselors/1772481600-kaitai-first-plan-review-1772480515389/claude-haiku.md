Now I'll create a comprehensive written review of the "Kaitai First" plan.

---

## COMPREHENSIVE REVIEW: PKO Developer Tooling — Kaitai First

I've reviewed the plan against the current codebase and identified critical issues, hidden dependencies, and ordering problems. This is a complex, high-risk undertaking.

### **EXECUTIVE SUMMARY**

**Risk Level: HIGH**

This plan is **technically sound in vision but severely underestimates scope** on 3 fronts:
1. **PR 8 (LMO extraction)** is riskier than stated — `scene_model.rs` has deeply integrated logic, not just type references
2. **PR 9 (LGO adapter)** cannot reuse `convert_geometry_chunk()` without significant refactoring
3. **Kaitai codegen scaling** is uncertain — 3 new formats (.obj, EFF, LAB) plus bugfix patches compound risk

**Recommendation: Break into smaller phases.** Deliver LMO/LGO path first with comprehensive tests, then tackle map/effect/animation in phase 2.

---

## 1. COMPLETENESS ANALYSIS

### Missing Steps:

#### **PR 1 — Serialize Infrastructure**
- ✅ Adding `#[derive(Serialize)]` to math types is straightforward
- ⚠️ **Missing:** `cgmath::Serialize` feature activation hasn't been tested. Check if `cgmath` v0.18.0 supports it (may need version bump)
- ⚠️ **Missing:** Handling of NaN/Inf in JSON serialization is deferred to PR 11, but math types may fail serialize if not handled
- ✅ Making `LwBox`, `LwPlane` pub(crate) is safe (internal visibility)

#### **PR 2 — Sync & Generate**
- ⚠️ **Missing:** Clarity on **where** `pnpm kaitai:sync` is defined. Looking at `package.json` is needed — doesn't exist yet?
- ⚠️ **Missing:** `pko_obj.ksy` schema authoring is **underestimated**. The plan says "44-byte header + section index + 20-byte records" but the actual format may have version branching (all other formats do). Need C++ source reference.
- ⚠️ **Missing:** Post-generation patching strategy. Plan says "apply patches, commit" but:
  - What are the patches? (lmo_loader.rs has workarounds for 3 known Kaitai bugs)
  - How are they tracked for regeneration?
  - What's the patch workflow if .ksy changes?

#### **PR 3-5 (OBJ, MAP, EFF Adapters)**
- ✅ Parity tests look complete
- ⚠️ **Missing:** How does `parity_test` work? Are there fixtures in the repo? I see `tests/` mentioned but not found.
- ⚠️ **Missing:** LAB bone name null-termination and key_type 3 handling — are there edge cases unaccounted for in the basic parity test?

#### **PR 6 — LAB Adapter**
- ⚠️ **Major:** The plan says "Native NOT deleted yet (BinWrite dependency)" but **doesn't explain what BinWrite is needed for**. Looking at `animation/character.rs`, I see `BinWrite impl` for `LwBoneKeyInfo`. Is this for:
  - Round-trip testing? (write out LAB, then read back)
  - glTF export? (no, glTF uses different structs)
  - Re-export to LAB format?
  - **Plan must clarify dependency before PR 6 can be completed**

#### **PR 8 — LMO Type Extraction**
- ✅ Moving 10 domain structs to `lmo_types.rs` is clear
- ⚠️ **Missing:** What about helper functions like `decompose_matrix43`, `extract_matrix44` (used in `lmo_loader.rs`)? Do these move too?
- ⚠️ **Missing:** Renderer state constants like `D3DRS_ALPHATESTENABLE`, `TRANSP_FILTER` — where do they live after extraction?

#### **PR 9 — LGO Adapter**
- ⚠️ **Critical missing detail:** Plan says "LGO = u32 version + LMO GeometryChunk" and "can reuse convert_geometry_chunk()". But character models use **4 files**:
  - `model.rs` (defines `CharacterGeometricModel`, `CharacterMeshInfo`, texture types)
  - `mesh.rs` (defines `CharacterMeshInfo` again? Or shares via mod?)
  - `texture.rs` (defines `CharMaterialTextureInfo`, `TextureInfo`)
  - `animation.rs` (defines keyframe structures)
  
  **These are NOT the same types as LMO.** The reuse would require:
  - Adapter converts Kaitai LGO → `CharacterGeometricModel`
  - But `convert_geometry_chunk()` converts Kaitai geometry → `LmoGeomObject`
  - These are different domain types. **Cannot reuse directly.**

#### **PR 10-12**
- ✅ CLI inspector, snapshot tests, skills/docs are well-scoped

---

## 2. ORDERING & DEPENDENCY ANALYSIS

### Graph Issues:

**Current Graph:**
```
PR 1 → PR 2 → PR 3 (OBJ)
              → PR 4 (MAP)
              → PR 5 (EFF)
              → PR 6 (LAB) → PR 7 (LAB delete)
              → PR 8 (LMO delete) → PR 9 (LGO)
       All adapters → PR 10 (CLI) → PR 11 (Golden) → PR 12 (Skills)
```

**Problems:**

1. **PR 8 blocks PR 9 unnecessarily.** The plan requires LMO native deletion before LGO adapter can be written. But:
   - LGO adapter doesn't depend on LMO types (different domain layer)
   - LGO adapter depends only on Kaitai LGO schema + character types
   - **Recommendation:** Run PR 8 and PR 9 in parallel, or start PR 9 before completing PR 8 deletion

2. **PR 6 is incomplete (BinWrite):** LAB native parser deletion is split across PR 6 and PR 7, but the exact dependency isn't clear. This blocks PR 7 and makes the adapter incomplete. Should be resolved in PR 6.

3. **PR 3-5 should not block PR 10.** Each adapter stands alone. CLI can be written once ONE adapter is complete (start with OBJ since it's simplest). **Suggestion:**
   ```
   PR 1 → PR 2 → PR 3 (OBJ) → PR 10.draft (CLI with OBJ only)
                  PR 4 (MAP) → PR 10.extend
                  PR 5 (EFF) → PR 10.extend
                  PR 6 (LAB) → PR 10.extend
                  PR 8 (LMO) → PR 9 (LGO parallel to PR 8 deletion)
          All complete → PR 11 (Golden) → PR 12 (Skills)
   ```

4. **PR 10 (CLI) timing is wrong.** The plan says "All adapters → PR 10" but this serializes work. CLI can be written incrementally, one format at a time.

---

## 3. RISK ANALYSIS

### Highest Risks (Ordered):

#### **RISK 1: LMO Extraction (PR 8) — LIKELIHOOD: MODERATE, IMPACT: HIGH**

Current state:
- `lmo.rs`: 2,579 lines (per plan)
- `scene_model.rs`: 30+ references to `lmo::LmoMaterial`, `lmo::LmoSubset`, `lmo::LmoAnimData`

**The problem is NOT just type references.** I found:

```rust
// scene_model.rs uses lmo types to CONSTRUCT buildings
let mat = lmo::LmoMaterial { ... };  // line 1143, 1277, 1614, 1776, etc.
let subset = lmo::LmoSubset { ... };
let anim_data = lmo::LmoAnimData { ... };
```

These aren't just imports — `scene_model.rs` actively builds `LmoMaterial` and `LmoSubset` structures. This means:

1. **Extract must be complete.** All constructors, helper methods, constants (like `D3DRS_ALPHATESTENABLE`) must move with the types, or `scene_model.rs` won't compile.
2. **Hidden dependencies:** Looking at `lmo.rs` lines 95-100, there are domain-specific helper functions. Do all of these need extraction?
3. **Serialize changes impact this.** PR 1 adds `#[derive(Serialize)]` to math types. If `LmoMaterial` or `LmoSubset` contains math types, Serialize derive may fail if the field visibility changes.

**Mitigation:**
- Create a detailed audit of all `lmo::*` references in `scene_model.rs` before starting PR 8
- Verify that extracted types compile in isolation
- Add a compilation gate: `cargo build -p pko_tools_lib` must pass with lmo.rs deleted before PR 8 is merged

#### **RISK 2: Kaitai Codegen Scaling to 3 Formats (PR 2) — LIKELIHOOD: HIGH, IMPACT: MODERATE**

Known bugs in Kaitai Rust codegen (from plan):
- `*_io.size()` spurious deref → must patch
- u32::MAX literal overflow → must patch
- Arithmetic type mismatches → must patch
- Missing struct for renamed types → must patch

Current state:
- LMO: 1 format, patches already applied (lmo_loader.rs workarounds visible)
- Adding: OBJ (new), EFF (existing .ksy), LAB (existing .ksy but not synced)

**Scaling risk:**
- Each format may have different codegen failures
- LAB `.ksy` is in `pko-map-lab` repo only — syncing may introduce version skew
- **Where are the patched .rs files stored?** If they're in `gen/kaitai/mod.rs` (which doesn't exist yet), how are they version-controlled?

**Mitigation:**
- Generate .rs for all 4 formats early (PR 2), test compilation
- Document each patch with a comment explaining the Kaitai bug
- Create a `gen/kaitai/PATCHES.md` file explaining all required patches and how to reapply them

#### **RISK 3: LGO Adapter Cannot Reuse convert_geometry_chunk() (PR 9) — LIKELIHOOD: HIGH, IMPACT: HIGH**

**This is the biggest gap in the plan.**

Current facts:
- `convert_geometry_chunk()` converts `PkoLmo_GeometryChunk` (Kaitai) → `LmoGeomObject` (domain type)
- LGO format is: u32 version + geometry chunk (per plan)
- But character models use `CharacterGeometricModel`, not `LmoGeomObject`

**The types are incompatible:**

```rust
// LMO domain type (scene buildings)
pub struct LmoGeomObject {
    pub id: u32,
    pub parent_id: u32,
    pub obj_type: u32,
    pub mat_local: LwMatrix43,  // 4x3 matrix
    pub materials: Vec<LmoMaterial>,
    pub vertices: Vec<LwVector3>,
    pub animation: Option<LmoAnimData>,
}

// LGO domain type (character models) — from character/model.rs
pub struct CharacterGeometricModel {
    pub version: u32,
    pub id: u32,
    pub parent_id: u32,
    pub mat_local: LwMatrix44,  // 4x4 matrix (different!)
    pub materials: Vec<CharMaterialTextureInfo>,  // different type!
    pub mesh_info: CharacterMeshInfo,
    pub helper_dummies: Vec<HelperData>,
}
```

**Differences:**
- Matrix format: 4x3 vs 4x4
- Material type: `LmoMaterial` vs `CharMaterialTextureInfo`
- No animation in character geometry (stored separately in `.lab`)

**Fix required:**
- Cannot reuse `convert_geometry_chunk()` directly
- Must write a separate adapter: `convert_character_geometry_chunk()` that maps to `CharacterGeometricModel`
- Or: Create a shared geometry conversion trait (more complex)

**Plan is off by ~50% effort for LGO adapter.**

#### **RISK 4: Ordering — BinWrite Dependency in LAB (PR 6-7) — LIKELIHOOD: MODERATE, IMPACT: MODERATE**

LAB native parser deletion is split:
- PR 6: Write Kaitai adapter (read-only)
- PR 7: Delete native `BinRead` impl (but keep `BinWrite`)

**Why split?** Plan says "BinWrite dependency" but doesn't explain:
- Is BinWrite used for exporting LAB back to binary?
- Is it used for testing (round-trip)?
- Can BinWrite be removed after glTF export is completed?

**If BinWrite is not used in production**, it's tech debt and should be deleted in PR 7. If it IS used, the plan needs to clarify where.

---

## 4. KAITAI CODEGEN VIABILITY

**Question: Will this scale to 5 formats (LMO, LGO, MAP, OBJ, LAB, EFF)?**

**Answer: Uncertain. High risk.**

Evidence:
- LMO already has 3 known workarounds (lmo_loader.rs lines 160-200)
- Plan acknowledges 4 classes of codegen bugs but doesn't quantify frequency
- No schema complexity ranking (which formats will trigger which bugs?)

**Necessary action (PR 2):**
1. Generate all 5 `.rs` files
2. Attempt to compile each
3. Document every compilation error and the exact Kaitai codegen bug
4. Create a patch for each
5. **Only then** commit to the approach

If bugs are more frequent than ~1 per format, consider:
- Writing manual Kaitai adapters (no codegen) for complex formats
- Contributing fixes to Kaitai compiler instead of patching

---

## 5. NATIVE DELETION SAFETY

### Per-Format Analysis:

| Format | Delete Scope | Hidden Deps? | Risk |
|--------|--------------|--------------|------|
| OBJ    | parse_obj_file() ~130 lines | None apparent | LOW |
| MAP    | parse_map() ~105 lines | scene_obj dependency | LOW-MODERATE |
| EFF    | read_from() helpers ~200 lines, keep write_to() | None apparent | LOW |
| LAB    | BinRead impl ~235 lines, keep BinWrite | **Unclear** | MODERATE |
| LMO    | Entire lmo.rs 2,579 lines | **scene_model.rs integration** | HIGH |

### Specific Concerns:

**MAP format:** `terrain.rs` calls `parse_obj_file()` from `scene_obj.rs`. If you delete `parse_obj_file()` in PR 3 before MAP is migrated, terrain.rs breaks. **Mitigation:** Delete OBJ last, after MAP is fully migrated. **Reorder:** Do MAP in PR 3, OBJ in PR 4.

**LGO format:** Not explicitly discussed in deletion section, but implies deletion only after adapter is proven (PR 9). But character export (line 336 in `character/mod.rs`) calls `CharacterGeometricModel::from_file()`, which uses `BinRead`. This is NOT deleted in the plan — **LGO native parser stays because it's used for import, not just export.** Plan may be incomplete here.

---

## 6. LMO TYPE EXTRACTION (PR 8) — DETAILED SAFETY ANALYSIS

**Question: Is extraction to `lmo_types.rs` safe?**

**Answer: Needs more detail. Likely safe if done carefully.**

#### Current dependencies on lmo types in scene_model.rs:

From grep output, I see 40+ references:
- Lines 419, 437: `lmo::LmoMaterial`, `lmo::TRANSP_FILTER`
- Lines 1143-2810: Constructing `lmo::LmoMaterial` and `lmo::LmoSubset` in 15+ places
- Line 2286: `lmo::LmoAnimData`
- Line 3206: `lmo::load_lmo()`

#### Safety checklist:

- ✅ **Types move:** `LmoMaterial`, `LmoSubset`, `LmoAnimData`, etc. to `lmo_types.rs`
- ❓ **Functions move:** `decompose_matrix43()`, `extract_matrix44()` — do these stay in `lmo_loader.rs` or move to `lmo_types.rs`?
- ❓ **Constants move:** `D3DRS_ALPHATESTENABLE`, `TRANSP_FILTER`, etc. — where do these go? Should stay public.
- ✅ **Imports update:** `scene_model.rs` updates `use lmo::*` → `use lmo_types::*` + `use lmo_loader::*` for helper functions
- ✅ **lmo_loader.rs survives:** Still exists, contains adapter logic
- ❌ **lmo.rs deleted:** This is where BinRead impl and native parsing live

#### Specific risks:

1. **`load_lmo()` call on line 3206:** If this is a test-only call, ensure test is updated to use the Kaitai backend
2. **Render state constants:** Are these used outside of LMO context? (e.g., in item rendering). If so, they need a public module.

**Recommendation:** Before PR 8, create `lmo_types.rs` as a separate file (not deleting lmo.rs yet). Verify that:
```rust
use map::lmo_types::*;
use map::lmo_loader::*;
// scene_model.rs compiles
cargo build -p pko_tools_lib
```

---

## 7. LGO ADAPTER (PR 9) — FEASIBILITY ANALYSIS

**Question: Can the character LGO parser actually be adapted to use Kaitai?**

**Answer: Yes, but requires more work than stated.**

#### Current LGO parsing (character/model.rs):

```rust
pub struct CharacterGeometricModel {
    pub version: u32,
    pub id: u32,
    pub parent_id: u32,
    pub mat_local: LwMatrix44,
    pub materials: Vec<CharMaterialTextureInfo>,
    pub mesh_info: CharacterMeshInfo,
    pub helper_dummies: Vec<HelperData>,
}

impl CharacterGeometricModel {
    pub fn from_file(file_path: PathBuf) -> anyhow::Result<Self> {
        // Uses BinRead to parse binary
    }
}
```

#### Required Kaitai schema:

The plan says LGO = u32 version + LMO geometry chunk. But `pko_lgo.ksy` already exists (in formats/). Need to verify:
- Does it correctly parse LGO header version?
- Does it reuse the geometry chunk from pko_lmo.ksy?

#### Adapter implementation:

```rust
pub fn lgo_to_character_geom(data: &[u8]) -> Result<CharacterGeometricModel> {
    let reader = BytesReader::from(data.to_vec());
    let pko_lgo = PkoLgo::read_into(&reader, ...)?;
    
    // Read version
    let version = *pko_lgo.version();
    
    // Read geometry chunk — BUT THIS IS DIFFERENT FROM convert_geometry_chunk!
    let geom_chunk = pko_lgo.geometry_chunk();
    
    // Convert to CharacterGeometricModel (NOT LmoGeomObject)
    let id = ...;
    let materials = convert_character_materials(geom_chunk)?;
    let mesh_info = convert_character_mesh(geom_chunk)?;
    let helper_dummies = convert_character_helpers(geom_chunk)?;
    
    Ok(CharacterGeometricModel { version, id, ..., materials, mesh_info, helper_dummies })
}
```

#### Why can't reuse convert_geometry_chunk()?

`convert_geometry_chunk()` is designed to parse LMO geometry into `LmoGeomObject`:
- Extracts materials as `Vec<LmoMaterial>`
- Extracts mesh as `LmoGeomObject { vertices, normals, texcoords, ... }`

But character models need:
- Materials as `Vec<CharMaterialTextureInfo>` (different schema)
- Mesh as `CharacterMeshInfo` (wraps `CharacterInfoMeshHeader` + element layout)
- Helpers as `Vec<HelperData>` (separate structure)

**These are fundamentally different transformations.**

#### Required work:

1. Create `character/lgo_loader.rs` (similar to `map/lmo_loader.rs`)
2. Implement geometry chunk parsing for character format:
   - `convert_character_materials()`
   - `convert_character_mesh()`
   - `convert_character_helpers()`
3. Parity test: Compare Kaitai adapter output vs. native BinRead for all .lgo files
4. Ensure BinWrite is NOT needed for character export (verify glTF export path)

**Effort estimate:** This is ~2 PRs of work, not 1.

---

## 8. INCREMENTAL DELIVERY & TESTING

**Question: Does each PR stand alone with its own tests?**

**Answer: Mostly yes, but some PRs have weak test plans.**

### Test Strategy per PR:

| PR | Adapter Tests | Parity Tests | Native Deletion Validation | Standalone? |
|----|---------------|--------------|------|
| 1  | N/A (infra)   | Serialize JSON schema | cargo build | ✅ |
| 2  | N/A (codegen) | Compile .rs files | N/A | ⚠️ (codegen unvalidated) |
| 3  | OBJ adapter   | Exhaustive .obj files | parse_obj_file() removed | ✅ |
| 4  | MAP adapter   | 2 fixture maps | parse_map() removed | ✅ |
| 5  | EFF adapter   | All fixture .eff files | read_from() removed | ✅ |
| 6  | LAB adapter   | Exhaustive .lab files | **BinRead only** | ⚠️ (incomplete) |
| 7  | N/A           | N/A | Delete BinRead impl | ⚠️ (depends on PR 6) |
| 8  | N/A (refactor)| scene_model.rs compiles | lmo.rs deleted | ⚠️ (complex) |
| 9  | LGO adapter   | Exhaustive .lgo files | **Not deleted** | ✅ (but scope underestimated) |
| 10 | CLI binary    | Integration tests | N/A | ✅ |
| 11 | Golden snapshots | insta tests | N/A | ✅ |
| 12 | Docs/Skills   | Manual validation | N/A | ✅ |

### Gaps:

1. **PR 2** — How are patched .rs files validated? Need a test that:
   ```
   cargo build --features "kaitai_gen"
   cargo clippy --features "kaitai_gen"
   ```
   Both must pass.

2. **PR 6** — LAB adapter test is vague ("exhaustive over all .lab files"). Need:
   - Parse .lab with Kaitai adapter
   - Verify bone hierarchy (parent IDs, names)
   - Verify keyframe counts and types
   - Compare against native parser output (round-trip: LAB → domain → compare)

3. **PR 8** — Complex refactor. Need:
   - Separate compile-check: `cargo build` after lmo.rs is deleted
   - Run all scene_model.rs tests in isolation
   - Parity test: load_lmo_kaitai() must produce identical output to load_lmo()

4. **PR 9** — Plan says "exhaustive over .lgo files" but doesn't specify:
   - Do you compare against native BinRead output?
   - Do you round-trip (read LGO → write LGO via Kaitai → read again)?
   - Recommend parity test like LAB

---

## CRITICAL ORDERING MISTAKES

### Current PR Graph Has 3 Problems:

1. **PR 8 blocks PR 9 unnecessarily**
   - LGO adapter doesn't use LMO types
   - Can start PR 9 immediately after pko_lgo.ksy is in PR 2
   - **Action:** Make PR 9 parallel to PR 8, or start before PR 8 deletion

2. **MAP deletion depends on OBJ deletion**
   - `terrain.rs:18` imports `parse_obj_file` from `scene_obj`
   - If you delete parse_obj_file in PR 3 (OBJ), PR 4 (MAP) breaks
   - **Action:** Reorder to MAP first (PR 3), OBJ second (PR 4). Or delete OBJ last.

3. **PR 10 is serialized when it can be parallel**
   - CLI can write a basic `match file_ext { "obj" => ... }` in PR 3.5
   - Then extend with MAP, EFF, LAB as they're completed
   - **Action:** Start CLI earlier, extend incrementally

---

## SUMMARY OF RECOMMENDATIONS

### Before Starting:

1. ✅ **Audit LMO dependencies** — Create a detailed list of all types, functions, and constants that must move to `lmo_types.rs`
2. ✅ **Generate all Kaitai .rs files** — Test compilation, document patches
3. ✅ **Verify .ksy schemas exist** — Ensure pko_lab.ksy, pko_eff.ksy, pko_obj.ksy are complete
4. ✅ **Clarify LAB BinWrite usage** — Explain why BinWrite is kept in PR 7

### Ordering Changes:

```
REVISED DEPENDENCY GRAPH:

PR 1: Serialize Infrastructure
  ↓
PR 2: Sync .ksy + Generate .rs (all 5 formats)
  ↓
PR 3: OBJ Adapter + Test + Delete
  ↓
PR 4: MAP Adapter + Test + Delete
  ↓
PR 5: EFF Adapter + Test + Delete
  ↓
PR 6: LAB Adapter + Test + **CLARIFY BinWrite**
  ↓
PR 7: LAB Native Delete (once PR 6 resolves BinWrite)
  ├→ PR 8: LMO Type Extraction (parallel with PR 7)
  │   ↓
  │   PR 8b: LMO Native Delete
  │
  └→ PR 9: LGO Adapter + Test (can start after PR 2)
      ↓ (but best after PR 8 to avoid collision)

All Adapters Complete → PR 10: CLI Inspector (incremental, start with OBJ)
  ↓
PR 11: Golden Reference Tests
  ↓
PR 12: Skills + Docs
```

### High-Risk Items Requiring Pre-Work:

1. **LGO Adapter (PR 9):** Write separate geometry converters, don't attempt to reuse convert_geometry_chunk()
2. **LMO Extraction (PR 8):** Audit all lmo:: references in scene_model.rs before starting
3. **Codegen Patching (PR 2):** Generate all .rs, document patches, verify compilation

### Success Criteria:

- Each PR has its own test suite that passes in isolation
- Native parsers deleted only after Kaitai adapter shows parity
- No cross-format dependencies (e.g., MAP doesn't depend on OBJ deletion)
- All cli

ppy warnings resolved

---

That's my detailed review. The plan is ambitious but feasible with revisions. The biggest gaps are the underestimated LGO adapter scope and the unresolved LMO extraction dependencies. I'd recommend addressing these before coding begins.
