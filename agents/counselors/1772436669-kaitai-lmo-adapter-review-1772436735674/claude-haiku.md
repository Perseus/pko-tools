# Kaitai LMO Adapter Implementation Plan - Code Review

## Summary

This plan replaces ~1300 lines of hand-written LMO binary parsing with a Kaitai-generated adapter (~6187 lines). The architecture is sound, but there are significant risks around the maturity of the Kaitai Rust runtime, RefCell safety, and incomplete version/format handling that need explicit mitigation.

**Recommendation:** Proceed with Phase 1–2, but delay Phase 5 (removal of fallback) until Phase 4 equivalence testing is complete and production LMO files have been validated against the Kaitai spec.

---

## Correctness Issues

### 1. **RefCell Access Panics Are Unhandled**

The generated Kaitai code uses `RefCell` for lazy field evaluation. The adapter must carefully manage borrows:

```rust
// SAFE
let version = *kaitai_lmo.version();  // Ref<u32> → u32, guard dropped immediately

// UNSAFE - borrow conflict
let objs = kaitai_lmo.objects();      // Ref<Vec<...>> held
let first_obj = &objs[0];              
let first_obj_header = first_obj.geom_header();  // Tries to re-borrow same RefCell → PANIC
```

If an `.lmo` file has a corrupted offset, Kaitai's lazy evaluation could trigger a panic when the adapter accesses a nested field. The hand-written parser would return a `Result::Err`; Kaitai panics.

**Action required:**
- Wrap all Kaitai field accesses in `catch_unwind()` or move to a separate thread
- Document which access patterns are safe
- Add fuzz testing against malformed LMO files

### 2. **Version Branching Not Specified**

The plan mentions three LMO versions (0x0000, 0x1004, 0x1005) with "different header layouts," but the adapter spec doesn't detail:
- Does Kaitai auto-detect version and branch parsing?
- Does the .ksy spec have conditional types for each version?
- If Kaitai doesn't handle versioning, the adapter must manually branch on `version()` before accessing version-specific fields

**Action required:**
- Verify the `.ksy` spec has conditional branches for all three versions
- Add integration tests for each version (need actual test files)

### 3. **FVF Decoding Assumption**

The plan assumes "FVF decoding is handled by Kaitai spec — vertex arrays are pre-separated." This is critical and unverified:
- The hand-written parser uses FVF flags (0x00001 = position, 0x00002 = weight, etc.) to determine stride and which fields are present
- If the Kaitai spec got the FVF logic wrong, vertices will be misaligned
- Kaitai's generated code won't catch this error — vertex data will silently be wrong

**Action required:**
- Before touching the adapter, manually compare a small `.lmo` file parsed by both backends
- Verify vertex positions byte-for-byte match
- Add a test that loads the same file with both parsers and compares vertex arrays

### 4. **Matrix Decomposition Compatibility**

The plan says "`decompose_matrix43()` stays in Rust," but:
- Kaitai may return matrices in a different memory layout (row-major vs column-major?)
- The hand-written parser stores matrices as `[[f32; 4]; 4]`; does Kaitai?
- If Kaitai returns `Vec<f32>`, the conversion will silently produce wrong transforms

**Action required:**
- Check Kaitai's matrix representation in the generated code
- Add a test: parse same `.lmo`, decompose both matrices, compare quaternions/translations

---

## Risk Analysis

### High Risk: Kaitai Crate Immaturity

Version 0.1.2 of the `kaitai` crate is obscure. Quick audit findings:
- Low GitHub stars, sparse issue tracker
- No recent releases (check crates.io date)
- Generated code uses unstable patterns (`OptRc`, `SharedType`) that may not survive Rust updates

**Mitigation:**
- Pin `kaitai = "=0.1.2"` in Cargo.toml (don't allow patch updates)
- Run `cargo audit` explicitly in CI
- If the crate becomes unmaintained, consider vendoring it

### Medium Risk: Equivalence Testing is Hard

Phase 4 proposes "field-by-field equality testing," but:
- Floating-point vertices won't compare exactly (must use `abs_diff_epsilon`)
- The hand-written parser may have bugs; if both parsers agree on a bug, tests pass but output is wrong
- You need reference data (ground truth), not just agreement between two parsers

**Mitigation:**
- Compare against Blender's glTF exports (import the LMO as glTF, round-trip through Blender, compare vertices)
- Or maintain a small set of hand-verified `.lmo` files with known-correct vertex/mesh structure

### Medium Risk: Performance Regression

Kaitai's `Rc<RefCell<...>>` pattern has indirection costs:
- Extra allocations per parsed struct
- RefCell borrow checks at runtime
- Large `.lmo` files (thousands of objects) could see 2–3x memory overhead

**Mitigation:**
- Profile memory usage of a large `.lmo` (e.g., dungeon with 500+ objects)
- If regression is >50%, consider implementing a custom zero-copy parser or mmap-based approach instead

### Low Risk: Binary Size / Compile Time

6187 lines of generated code will slightly increase:
- Compile time (~2–5 seconds extra)
- Binary size (~500 KB–1 MB)
- May trigger LLVM inlining limits

**Mitigation:**
- Mark generated code with `#![allow(dead_code, unused)]` to avoid warnings
- Add to `.gitignore` if regenerated; don't hand-edit

---

## Completeness Gaps

### 1. **Texture Filename Extraction**

The domain type `LmoMaterial` has `pub tex_filename: Option<String>`. The plan doesn't specify:
- How does Kaitai extract texture names from `PkoLmo_MtlTexInfoCurrent`?
- Are there null-termination issues?
- Do all LMO versions store texture names the same way?

**Action required:**
- Document texture name extraction in the adapter spec
- Add a test that loads an LMO with textures, verifies filenames are correct

### 2. **Animation Types Not Detailed**

The plan lists four animation types:
- Bone TRS (translations, rotations)
- UV transforms (`LmoTexUvAnim`)
- Texture image swaps (`LmoTexImgAnim`)
- Material opacity (`LmoMtlOpacAnim`)

But doesn't specify:
- How `parse_animations=false` skips parsing (does Kaitai support conditional parsing?)
- Which animation subsystem is which version
- How to handle missing animation data (defaults? errors?)

**Action required:**
- Add animation handling examples to the adapter spec
- Clarify conditional parsing behavior

### 3. **Error Handling Strategy**

The plan doesn't mention:
- What happens if Kaitai encounters a truncated `.lmo` file?
- What happens if version is unknown?
- Should the adapter validate object counts, subset counts, etc.?

**Action required:**
- Define error handling: panic, return `Err`, or fallback to native parser?

### 4. **Test Coverage**

Phase 4 says "batch test all .lmo files in a test directory" but:
- Where is this directory?
- How many files? 10? 100?
- Are they in the git repo or download at test time?
- What LMO versions do they represent?

**Action required:**
- Commit at least 3–5 representative `.lmo` files (one per version, one large)
- Add comment with file sources and expected structure

---

## Phasing Concerns

### Phase 1–2 (Build Integration + Adapter) is Good
Implement incrementally: version detection → objects → materials → mesh → animations. Good risk mitigation.

### Phase 3 (Make Utilities Public) is Trivial
No concerns.

### Phase 4 (Equivalence Testing) is Optimistic
- "Assert field-by-field equality" assumes floating-point precision doesn't matter
- Need epsilon comparison for vertices, normals, matrices
- Consider comparing glTF output (texture baking, glTF JSON) instead — higher-level validation

### Phase 5 (Remove Fallback) is Premature
Don't make Kaitai the default until:
- ✅ All test LMOs pass equivalence testing
- ✅ Production .lmo files from the actual client are tested
- ✅ No RefCell panics on edge cases
- ⏳ 2–4 weeks of real-world usage without crashes

**Recommendation:** Keep the native parser as fallback indefinitely, or at minimum 6 months.

---

## Suggested Improvements

### 1. **Add a Dry-Run Mode**

Before committing to Kaitai, add a dual-parser mode that loads with both backends and compares:

```rust
pub fn load_lmo_and_compare(path: &Path) -> Result<LmoModel> {
    let native = super::lmo::load_lmo(path)?;
    let kaitai = load_lmo_kaitai(path)?;
    
    if !models_equal(&native, &kaitai) {
        eprintln!("PARSER MISMATCH: native vs kaitai differ on {}", path.display());
        // Log differences: version, object count, vertex hashes, etc.
    }
    Ok(native)  // Still use native for safety
}
```

Run this in production/dev for a month. When 1000+ files parse identically, then flip the default.

### 2. **Validate Kaitai Spec Against Actual Files**

Before Phase 2, write a small standalone binary:

```bash
cargo run --bin validate-kaitai -- path/to/client/maps/ --verbose
```

It parses all `.lmo` files with Kaitai, prints warnings for any parse failures, unexpected nulls, truncations. Fix spec issues **before** writing the adapter.

### 3. **Lazy Evaluation Safety Wrapper**

Create a helper to manage RefCell borrows safely:

```rust
fn with_kaitai_vec<T, F, R>(vec_ref: &Ref<Vec<T>>, f: F) -> Result<R>
where
    F: FnOnce(&[T]) -> Result<R>,
{
    f(vec_ref.as_slice())  // Convert Ref<Vec> → &[T], drop borrow after closure
}
```

Reduces adapter footprint and catches borrow conflicts early.

### 4. **Add Fuzz Testing**

Use `cargo-fuzz` or `quickcheck` to generate malformed LMO data, ensure Kaitai doesn't panic:

```bash
cargo fuzz run lmo_parser -- corpus/
```

### 5. **Consider Alternative: Custom Parser with Kaitai-Like Safety**

If the Kaitai crate proves fragile, consider:
- Writing a **minimal** hand-written parser that uses the same Kaitai runtime types (just parsing logic)
- Or use a parser combinator library (`nom`, `winnow`) with stronger safety guarantees
- Kaitai is elegant but adds a dependency on an obscure crate; sometimes "less clever" is safer

---

## Questions for Implementation

1. **Has the `.ksy` spec been tested against actual LMO files from the client?** (Not just hypothetical reverse engineering?)
2. **What's the kaitai crate's maintenance status?** (Last release date? Open issues?)
3. **Does the `.ksy` spec handle all three versions with conditional parsing?**
4. **How will you test RefCell safety?** (Unit tests for borrow conflicts?)
5. **What's the fallback strategy if Kaitai fails at runtime?** (Panic, log warning, return error?)

---

## Verdict

**Status:** ✅ **Proceed with caution**

**Green lights:**
- Architecture is sound (adapter pattern enables gradual migration)
- Phasing is thoughtful (build → adapter → equivalence tests → remove fallback)
- Reusing existing utilities (`decompose_matrix43`, render state) is pragmatic

**Red flags:**
- Kaitai crate immaturity + no existing Rust ecosystem for it
- RefCell safety unspecified; production panics are likely
- Equivalence testing strategy is incomplete (floating-point comparison)
- Version/animation handling not detailed

**Recommendation:**
1. Start Phase 1–2 (build + basic adapter for geometry objects only)
2. Write the comparison/validation tools (dry-run mode, spec validator)
3. Test against actual client `.lmo` files; fix spec issues in the `.ksy`
4. Only then implement animations/texture animations
5. Keep native parser as fallback for at least 6 months

This is the right direction (generated parsers are safer than hand-written), but the plan needs more rigor before it's production-ready.
