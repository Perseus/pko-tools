I've read the **Render State Parity Pipeline** document. This is a comprehensive three-phase plan to properly encode PKO building transparency types and blend modes through:

1. **Phase 1**: Property-driven blend state in `TOP/Effect.shader` (Unity)
2. **Phase 2**: `TOPMaterialReplacer.cs` parsing material suffixes to configure blend modes
3. **Phase 3**: Rust exporter updating `lmo.rs` and `scene_model.rs` to emit structured suffixes

The execution order is explicitly **Phase 1 → Phase 2 → Phase 3** to maintain backward compatibility.

**Before I begin implementation, I need to clarify:**

1. **Which phase(s) should I implement?** The document notes it's "consumer-first," so Unity changes before Rust exporter changes. Should I start with Phase 1 (shader), Phase 2 (material replacer), Phase 3 (Rust exporter), or all three?

2. **File access**: 
   - For Phase 1 & 2, I'd need to work on `pko-client/` files (Unity). What's the path to your pko-client repository?
   - For Phase 3, I'll work on `src-tauri/src/map/lmo.rs` and `scene_model.rs` (already in this repo).

3. **Current state**: Is the current `scene_model.rs` still using `__PKO_BLEND_ADD` for additive materials, or has some of this been partially implemented?

Once you clarify scope and paths, I'll create a detailed implementation plan for your approval.
