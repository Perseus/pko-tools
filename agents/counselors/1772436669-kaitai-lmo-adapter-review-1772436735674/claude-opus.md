Now I have a thorough understanding of both the plan and the codebase. Let me write my review.

---

# Review: Kaitai LMO Adapter Plan

## Verdict

The plan is structurally sound and well-reasoned, but has **one critical risk** (the kaitai runtime crate), **several semantic gaps** in the adapter mapping, and a **header detection divergence** between the .ksy spec and the hand-written parser that will produce different results on edge-case v0 files.

---

## Critical: The `kaitai` Crate is Unfit for Production

This is the plan's biggest problem. The [kaitai crate](https://lib.rs/crates/kaitai) (0.1.2):

- **Published August 2021** — hasn't been updated in ~4.5 years
- Self-describes as *"still very much a work in progress; it has a very limited feature set"*
- Depends on `thiserror` v1.0 (you're likely on v2.x in your workspace, causing potential resolution conflicts)
- Has 3,712 all-time downloads — essentially unused in production
- Is a **different project** from the [official Kaitai Struct Rust target](https://github.com/kaitai-io/kaitai_struct_compiler) which was merged upstream in Sept 2024

The generated code in `gen/kaitai/pko_lmo.rs` uses `kaitai::*` types (`KStruct`, `KStream`, `BytesReader`, `SharedType`, `OptRc`, `KResult`, `KError`). These are runtime types from the `kaitai` crate. If this crate has bugs in `BytesReader` (stream seeking, sub-stream creation for `size:`-limited fields) they will silently corrupt parsing output and you'll be debugging the runtime, not your spec.

**Recommendation:** Before committing to this adapter approach, verify:
1. Which Kaitai compiler version generated `pko_lmo.rs`? The official compiler's Rust target (merged Sept 2024) may use a *different* runtime crate than `kaitai = 0.1.2`. Check if it expects `kaitai-struct-runtime` or similar.
2. Run `cargo build` with `kaitai = "0.1.2"` now and see if the generated 6187-line file actually compiles. Don't assume it does — the compiler target may have moved past what 0.1.2's runtime supports.
3. If it doesn't compile or has runtime issues, consider vendoring the runtime (it's only ~350 lines of code) so you control it.

---

## Header Detection Divergence (Will Cause Mismatches)

The .ksy spec and the hand-written parser disagree on how to detect legacy vs. modern headers for v0 files.

**Hand-written parser** (`lmo.rs:1030-1051`): Uses **strict equality** — `92 + sum_of_sizes == chunk_payload_size`. Prefers modern; falls back to legacy only if modern fails and legacy matches exactly.

**.ksy spec** (`geom_obj_info_header`, line 450-454): Uses **`<=` inequality** — `sum_of_sizes <= chunk_payload_size`. Prefers modern (same), but the looser check could match on files where the strict check would reject both.

This means for some v0 files where the sizes happen to sum to less than (but not equal to) the payload, the .ksy will pick modern header while the Rust parser might pick neither (and presumably error). The equivalence tests in Phase 4 will catch this — but only if your test corpus includes v0 files. **Ensure you test with at least the full set from a real PKO client, not just the common 0x1005 files.**

---

## Adapter Mapping Gaps

The plan says "Kaitai spec handles FVF decoding — vertex arrays are pre-separated." This is true but understates the work:

### 1. Material format detection is complex in the .ksy

The `material_section` type uses `format_hint` (lines 196) which maps through `effective_version` → `format_hint` (0/1/1000). The adapter must correctly extract render states from three different Kaitai struct types:

- `PkoLmo_MtlTexInfo0000` → `rs_set` is `render_state_set_2_8` (16 `render_state_value` entries, representing 2×8 sets)
- `PkoLmo_MtlTexInfo0001` → same old-format rs_set
- `PkoLmo_MtlTexInfoCurrent` → `rs_set` is 8× `render_state_atom`

For V0000/V0001, the hand-written parser applies special overrides: `ALPHAREF` is forced to 129 and `ALPHAFUNC` to `D3DCMP_GREATER` (matching the C++ engine). The Kaitai spec only parses raw bytes — **the adapter must replicate this override logic**. This isn't mentioned in the plan.

### 2. V0001 transparency remap is missing

`lmo.rs:343-344`: When `mtl_ver == V0001 && transp_type == 2`, it remaps to `TRANSP_SUBTRACTIVE (5)`. The plan doesn't mention this. The Kaitai spec just reads the raw value. The adapter needs this remap.

### 3. Texture filename extraction

The Kaitai types (`tex_info_current`, `tex_info_0000`, `tex_info_0001`) store `file_name` as a `size: 64` raw byte field. The hand-written parser uses `read_cstr_fixed` which null-terminates. The adapter must:
- Convert the raw 64 bytes to a string
- Trim at first null byte
- Only extract from texture stage 0

### 4. `legacy_extra_mtl_possible` in material section

The .ksy has a `legacy_extra_mtl_possible` heuristic (line 198) that conditionally reads an extra `material` block. I don't see the hand-written parser doing this. This could be a .ksy-only path, or a spec bug. Either way, the adapter must handle this field if Kaitai populated it — or verify it never fires on real files.

### 5. Teximg animation for v0 files

The .ksy `anim_data_teximg` type (lines 1179-1194) handles v0 as a raw `legacy_payload` blob (`size-eos: true`). The hand-written parser for v0 files doesn't seem to read teximg data at all (the current `read_teximg_block` assumes current-format `lwTexInfo`). The adapter needs to handle this — either skip v0 teximg entries or implement the legacy parsing.

---

## RefCell/Rc Pitfalls

The generated code is hostile to work with:

1. **Every field access returns `Ref<'_, T>`** — you can't hold two `Ref`s from the same `RefCell` simultaneously. Code like `let v = obj.version(); let o = obj.objects();` is fine (different RefCells), but accessing a lazy instance while another borrow from the same struct is alive will panic.

2. **`OptRc<T>` is `Option<Rc<T>>`** — every field dereference is `some_field.as_ref().unwrap()` plus `.borrow()` from the RefCell. The adapter will be visually noisy. I'd recommend a pattern like:

   ```rust
   // Helper to reduce boilerplate
   fn rc_ref<T>(opt: &OptRc<T>) -> &T {
       opt.as_ref().expect("kaitai field not parsed")
   }
   ```

3. **Lazy evaluation via `Cell<bool>` flags** — instance fields (like `is_model_info_tree`, `header_kind`, `effective_version`) are computed on first access and may trigger I/O seeks. If you call them from a context where another borrow is active on the same `_io` RefCell, you'll get a panic. **The adapter should pre-read all needed fields into local variables before processing child objects.**

4. **`Rc` means no `Send`/`Sync`** — `PkoLmo` cannot be sent across threads. This is fine if parsing is done synchronously per-file, but if you ever want to parallelize LMO loading with rayon, the Kaitai path won't work without a wrapping boundary.

---

## Phasing Assessment

The phases are sensible. One adjustment:

**Phase 4 (Equivalence testing) should start earlier.** Don't wait until the full adapter is written. Instead:
- After Phase 2 is partially done (e.g., just mesh data), write a test that compares just vertices/normals/indices between the two backends.
- This gives you fast feedback on whether the .ksy is producing the same bytes. If you find a structural mismatch in mesh parsing, you don't want to discover it after writing the entire adapter.

**Phase 5 is premature.** Making Kaitai the default backend after one round of testing is risky. I'd add an intermediate phase: run both backends in production for a while and log any divergences, before retiring native.

---

## Alternative Worth Considering

Given:
- The kaitai crate is abandoned/experimental
- The generated code is 6187 lines of RefCell/Rc boilerplate
- The adapter will be ~400-600 lines of careful field extraction
- The hand-written parser is 1300 lines and already works

**The ROI of this adapter is questionable for LMO specifically.** The hand-written parser has had its bugs found and fixed (the blendInfo bug). The Kaitai spec is useful as *documentation*, but converting through 6187 lines of generated code to get back to the same domain types adds a maintenance burden and a fragile dependency.

A better use of the .ksy spec might be:
1. **Use it as a reference** to audit the hand-written parser for remaining bugs
2. **Use it for new formats** where no hand-written parser exists yet
3. **Generate a Python/JS parser** for test oracle comparison (Kaitai's Python/JS targets are much more mature)

If you still want to proceed, I'd strongly recommend **vendoring the kaitai runtime** rather than depending on the crate, and adding an `#[allow(dead_code)]` with a comment explaining the generated code won't be cleaned up.

---

## Summary

| Area | Assessment |
|---|---|
| Architecture | Good — adapter pattern is clean, env-var switching is solid |
| kaitai crate dependency | **Red flag** — abandoned, experimental, potential compile/runtime issues |
| .ksy spec quality | High — thorough, handles all 3 versions, but has <= vs == divergence |
| Adapter completeness | Missing: V0001 transp remap, old-format render state overrides, null-term filenames |
| RefCell ergonomics | Manageable with helper functions, but panic risk is real |
| Equivalence testing | Phase 4 should start incrementally during Phase 2 |
| Overall recommendation | Vendor the runtime, test incrementally, don't rush to make Kaitai the default |

Sources:
- [kaitai crate on lib.rs](https://lib.rs/crates/kaitai)
- [kaitai crate versions on crates.io](https://crates.io/crates/kaitai/versions)
- [Kaitai Struct Compiler - Rust support](https://github.com/kaitai-io/kaitai_struct_compiler/issues?q=rust)
