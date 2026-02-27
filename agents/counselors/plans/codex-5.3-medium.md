I can’t fully execute the prompt’s implementation in this session because the filesystem is `read-only` (no edits allowed), and this task requires code changes in both Rust and Unity projects.

I did verify target files and current state:

- Unity shader exists at [TOP_Effect.shader](/Users/anirudh/gamedev/client-unity/pko-client/Assets/_Project/Rendering/Shaders/TOP_Effect.shader) and is still hardcoded `Blend One One`, no `_SrcBlend/_DstBlend/_Opacity/_Cutoff` flow yet.
- Unity replacer exists at [TOPMaterialReplacer.cs](/Users/anirudh/gamedev/client-unity/pko-client/Assets/_Project/Rendering/Runtime/TOPMaterialReplacer.cs) and still only handles `__PKO_BLEND_ADD`.
- Rust constants are currently only types 0/1 in [lmo.rs](/Users/anirudh/gamedev/pko-tools/src-tauri/src/map/lmo.rs).
- Rust material naming/alpha logic in [scene_model.rs](/Users/anirudh/gamedev/pko-tools/src-tauri/src/map/scene_model.rs) still uses `__PKO_BLEND_ADD` and additive→`Opaque` behavior.
- There is already an unstaged local edit in [scene_model.rs](/Users/anirudh/gamedev/pko-tools/src-tauri/src/map/scene_model.rs) (alpha cutoff change).

If you rerun with write access, I’ll implement all three phases from the prompt end-to-end and run verification (`cargo test`, `cargo clippy`) immediately.
