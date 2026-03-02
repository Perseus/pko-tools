I now have enough context to write a thorough review. Let me compile it.

---

## Review: Kaitai LMO Adapter Plan

### TL;DR

The plan is structurally sound but significantly underestimates implementation complexity. Three issues are blockers: the generated code doesn't exist, the `kaitai` crate 0.1.2 likely can't support critical `.ksy` features, and the adapter omits a semantically critical step (mesh-level alpha promotion). Fix these before writing any code.

---

### Critical Issues

**1. The generated code doesn't exist and the build is fragile**

`gen/kaitai/pko_lmo.rs` is not checked in. The build.rs generates it by calling `ksc`, which panics if ksc is unavailable and generated files are absent. This means:

- No one can build the project without ksc installed, or without first committing generated files
- CI breaks immediately the moment you add `use crate::gen::kaitai::pko_lmo::*`
- The "6,187 lines" cited in the plan haven't actually been reviewed in context — they're a build artifact

**Decision required before Phase 1:** Commit the generated `.rs` files to git (checking in generated code is standard for Kaitai projects and avoids the ksc-at-build-time dependency). The current build.rs has the right fallback structure (`ensure_generated_outputs_exist`) — use it.

---

**2. The `kaitai` crate 0.1.2 almost certainly can't handle the `.ksy` features in use**

The plan flags "kaitai crate version mismatch" as a risk but doesn't examine what it means concretely. The `pko_lmo.ksy` uses:

- **`pos:` instances** — random-access reads (`descriptor_magic` at pos 8, `legacy_mtl_size_probe` at computed offsets in `geom_obj_info_header`). The Kaitai Rust runtime 0.1.2 has minimal or no `pos:` support
- **`size-eos: true`** — read-until-end-of-substream in `material_section.payload`. Support is spotty in Rust runtime
- **`params:` on types** — parameterized types (`geometry_chunk`, `material_section`, etc. all take `file_version` as a param). This is supported but adds complexity
- **Multi-level `if:` on instances** — `is_model_info_tree`, `legacy_plausible`, `modern_plausible` are computed instances that gate entire parse paths

This needs to be verified by actually compiling the generated code with `kaitai = "0.1.2"` before committing to Phase 2. If it doesn't compile, the entire plan needs revision.

---

**3. Mesh-level alpha render state promotion is missing from the adapter plan**

The hand-written parser has a critical semantic step that the plan does not mention at all. After parsing mesh and materials separately, `read_geom_object` (lmo.rs:1157–1168) promotes mesh-level alpha render states to all materials:

```rust
if mesh_alpha.normalized_alpha_enabled() {
    let mesh_alpha_ref = mesh_alpha.effective_alpha_ref();
    for mat in &mut materials {
        if !mat.alpha_test_enabled { mat.alpha_test_enabled = true; }
        if mat.alpha_ref == 0 { mat.alpha_ref = mesh_alpha_ref; }
    }
}
```

This was almost certainly the root cause of original alpha-transparency bugs. An adapter that omits this will produce silent output divergence on any LMO file with mesh-level alpha render states. This logic must be explicitly implemented in `kaitai_to_lmo()`.

---

### Significant Issues

**4. Header plausibility check semantics differ between `.ksy` and hand-written parser**

The `.ksy` uses `<=` for plausibility (`sum(sizes) <= chunk_payload_size`, `geom_obj_info_header` instances `legacy_plausible`/`modern_plausible`). The hand-written parser uses exact equality (`== chunk_payload_size`, lmo.rs:1035, 1045). The hand-written version is intentionally stricter to avoid false positives when data bytes happen to look like small size values. This will cause divergence on any file where the sections don't sum exactly to the chunk size (e.g., files with trailing padding). The plan should note this and decide which semantics are correct.

**5. V0001 transp_type remapping is not mentioned**

The hand-written parser remaps `transp_type = 2 → TRANSP_SUBTRACTIVE (5)` for V0001 format materials (lmo.rs:343–346), matching the original C++ engine behavior. The adapter plan's material section mapping doesn't mention this. If the `.ksy` doesn't encode this remap (likely — it's a semantic fixup, not a structural one), the adapter must do it explicitly.

**6. `is_model_info_tree` is a whole unaddressed code path**

The `.ksy` spec has a conditional branch: if the bytes at offset 8 spell "lwModelInfo", the file is an "lwModelInfo tree" with an entirely different layout (`model_nodes` instead of `objects`). The hand-written parser ignores this case (it reads the header table assuming the standard layout). The plan says nothing about it. The adapter needs to either:
- Explicitly reject `is_model_info_tree` files with an error (matching the native parser's implicit behavior), or
- Handle them — which is a much bigger scope than described

**7. `Ref<'_, T>` access patterns are worse than the plan implies**

Every field access in the generated code returns a borrow guard (`Ref<'_, T>`), not an owned value. For nested types: `pko_lmo.objects()` returns `Ref<'_, Vec<OptRc<PkoLmo_ObjectEntry>>>`. Each `OptRc<T>` is `Option<Rc<T>>`. To access a field on a geometry chunk nested 3 levels deep, you'd need:

```rust
let objects = pko_lmo.objects();
let entry_rc = objects[i].as_ref().unwrap(); // OptRc → &Rc
let chunk = entry_rc.body_geometry(); // returns Ref<'_, Option<...>>
```

Ref lifetime constraints mean you can't return intermediate borrows from helper functions without lifetime gymnastics. The practical solution is to `.clone()` everything out of the kaitai structs into owned types as early as possible. The adapter function is better thought of as: "drain kaitai structs into owned primitives immediately, then do the interpretation." This should be stated explicitly in the plan.

**8. The `material_section.legacy_extra_mtl_seq` has no equivalent in the hand-written parser**

The `.ksy` spec has `legacy_extra_mtl_seq` in `material_section`: an extra array of `material` structs present when `legacy_extra_mtl_possible` is true. The hand-written parser has no corresponding code path. Either this is dead format that was never emitted (fine to ignore), or it will cause the kaitai backend to parse differently on affected files. The plan should account for this.

---

### Design Issues

**9. Phase 3 underestimates what needs to be pub(crate)**

The plan says "make `decompose_matrix43` pub(crate)" and "make `MaterialRenderState` and D3D constants pub(crate)." But `MaterialRenderState` has methods (`normalized_alpha_enabled`, `effective_alpha_ref`) that encode the alpha semantics. Making the struct public doesn't help if the adapter has to duplicate the logic. Better: extract `MaterialRenderState` + its methods into a shared submodule (`map::render_state`) that both the native parser and adapter use.

**10. Equivalence testing needs to be designed, not just described**

Phase 4 says "parse the same .lmo files with both backends, assert field-by-field equality." But:
- The test infrastructure uses hardcoded paths (`/mnt/d/EA 1.0.1`) that don't exist on all machines
- `LmoGeomObject` doesn't derive `PartialEq` — you'd need to add it or write a custom comparator
- Float equality on vertex positions requires epsilon comparison
- The "batch test all .lmo files" goal needs a test fixture directory to be committed, or a configurable path via env var

This needs a concrete design, not just a description.

**11. No fallback if the kaitai crate proves incompatible**

If Phase 1 or early Phase 2 reveals that `kaitai = "0.1.2"` can't compile the generated code, the plan has no alternative. Consider a parallel track: if the kaitai crate doesn't work, implement the adapter using a hand-rolled `BytesReader` wrapper on the raw kaitai-generated *parse logic* (not the runtime) — i.e., take the `.ksy` as a spec and re-implement the parse tree using the existing cursor-based infrastructure. This is more work but avoids depending on an immature crate.

---

### What the Plan Gets Right

- **Phased rollout via env var** — correct. Don't switch the default until equivalence tests pass on the full corpus.
- **Keeping `decompose_matrix43` in Rust** — correct. This is algorithmic logic, not format parsing; it belongs in domain code.
- **The overall architecture** (bytes → kaitai parse tree → adapter → domain types → existing pipeline) is sound. The adapter boundary is the right place to draw the line.
- **The `lwBlendInfo` fix note** — correctly calls out that the `.ksy` handles the 20-byte blend info correctly.

---

### Suggested Changes to the Plan

1. **Add a Phase 0: Verify the kaitai crate compiles with generated code.** Add `kaitai = "0.1.2"` to Cargo.toml, commit the generated files, attempt `cargo check`. If it fails, pivot before investing in the adapter.

2. **Commit the generated `.rs` files to git** and set `PKO_KAITAI_BUILD=0` as the default in CI. The build.rs already has the right structure for this.

3. **Add "mesh alpha promotion" to the Phase 2 adapter spec** as an explicit step after building materials and mesh data.

4. **Add "V0001 transp_type remap" to the Phase 2 material mapping.**

5. **Extract `MaterialRenderState` to a shared module** instead of making it pub(crate) from `lmo.rs`.

6. **Add `PartialEq` derives** to all domain types (`LmoModel`, `LmoGeomObject`, `LmoMaterial`, etc.) as part of Phase 3, to enable the equivalence assertions in Phase 4.

7. **Phase 4 equivalence test design:** Add a committed test fixture with a small representative set of real `.lmo` files covering version 0x0000, 0x1004, and 0x1005. Make the batch test path configurable via env var (`PKO_LMO_CORPUS_DIR`) so it can run on machines that have the client.
