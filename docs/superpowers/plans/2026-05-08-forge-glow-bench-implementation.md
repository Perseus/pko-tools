# Forge Glow Bench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the v0 Forge Glow Bench as a separate inspector/remixer for resolved refine/weapon glow recipes with non-destructive draft storage and sandbox package export.

**Architecture:** Add a focused `forge_glow` backend module that wraps the existing forge trace resolver, persists draft JSON, and exports sandbox packages. Add a dedicated frontend route and feature folder with a resolver panel, recipe/variant editor, and preview that reuses existing item model loading plus effect-v2 particle/effect rendering.

**Tech Stack:** Rust/Tauri commands, serde JSON draft files, React + TypeScript, Jotai, React Three Fiber, existing pko-tools item/effect-v2 command wrappers.

---

## File Structure

- Create `src-tauri/src/forge_glow/model.rs`: shared resolver, draft, variant, override, export response structs.
- Create `src-tauri/src/forge_glow/resolver.rs`: resolve recipe by reusing the existing item forge trace logic.
- Create `src-tauri/src/forge_glow/storage.rs`: draft path helpers plus save/load/list/delete.
- Create `src-tauri/src/forge_glow/export.rs`: sandbox package export with recipe, manifest, patch intent, and copied referenced assets.
- Create `src-tauri/src/forge_glow/commands.rs`: Tauri command wrappers.
- Create `src-tauri/src/forge_glow/mod.rs`: module exports.
- Modify `src-tauri/src/lib.rs`: register module and Tauri commands.
- Modify `src-tauri/src/item/commands.rs`: expose a shared internal forge trace helper for the new resolver.
- Create `src/commands/forgeGlow.ts`: frontend command wrappers.
- Create `src/types/forgeGlow.ts`: frontend data contracts matching Rust structs.
- Create `src/store/forgeGlow.ts`: atoms for drafts, active draft, active variant, resolver/export state.
- Create `src/features/forge-glow/ForgeGlowBench.tsx`: route workbench shell.
- Create `src/features/forge-glow/ForgeGlowNavigator.tsx`: draft list and saved draft selection.
- Create `src/features/forge-glow/ForgeGlowResolverPanel.tsx`: weapon/char/gem input controls.
- Create `src/features/forge-glow/ForgeGlowRecipePanel.tsx`: baseline recipe and row override editor.
- Create `src/features/forge-glow/ForgeGlowPreview.tsx`: weapon plus active variant preview.
- Create `src/features/forge-glow/ForgeGlowExportPanel.tsx`: sandbox export controls.
- Create `src/pages/forge-glow/index.tsx`: route page.
- Modify `src/App.tsx`, `src/components/SideNav/SideNav.tsx`, `src/components/WorkspaceNavigator/WorkspaceNavigator.tsx`, and `src/features/actions/ActionKernelProvider.tsx`: add navigation surface.

## Task 1: Backend Data Model And Storage

**Files:**
- Create: `src-tauri/src/forge_glow/model.rs`
- Create: `src-tauri/src/forge_glow/storage.rs`
- Create: `src-tauri/src/forge_glow/mod.rs`

- [ ] **Step 1: Write storage/model tests**

Add `#[cfg(test)]` tests in `storage.rs` for `sanitize_slug`, `draft_path`, and draft JSON round trip:

```rust
#[test]
fn sanitize_slug_keeps_exports_path_safe() {
    assert_eq!(sanitize_slug("Fire Glow: +9/Blue"), "fire-glow-9-blue");
}

#[test]
fn save_and_load_draft_round_trips() {
    let dir = tempfile::tempdir().unwrap();
    let draft = crate::forge_glow::model::ForgeGlowDraft::new_for_test("draft-1", "Sword Glow");
    save_draft(dir.path(), &draft).unwrap();
    let loaded = load_draft(dir.path(), "draft-1").unwrap();
    assert_eq!(loaded.id, "draft-1");
    assert_eq!(loaded.name, "Sword Glow");
}
```

- [ ] **Step 2: Run tests and verify failure**

Run: `cd src-tauri && cargo test forge_glow`

Expected: compile failure because the module and structs do not exist.

- [ ] **Step 3: Implement model/storage**

Define serializable structs for `ForgeGlowDraft`, `ForgeGlowVariant`, `ForgeGlowRecipeOverrides`, `ResolvedForgeRecipe`, particle rows, and export responses. Implement `save_draft`, `load_draft`, `list_drafts`, `delete_draft`, and path helpers under `<client>/pko-tools/forge-glows/drafts`.

- [ ] **Step 4: Run tests and commit**

Run: `cd src-tauri && cargo test forge_glow`

Expected: tests pass.

Commit:

```bash
git add src-tauri/src/forge_glow
git commit -m "feat: add forge glow draft storage"
```

## Task 2: Backend Resolver And Export Commands

**Files:**
- Create: `src-tauri/src/forge_glow/resolver.rs`
- Create: `src-tauri/src/forge_glow/export.rs`
- Create: `src-tauri/src/forge_glow/commands.rs`
- Modify: `src-tauri/src/forge_glow/mod.rs`
- Modify: `src-tauri/src/item/commands.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write resolver/export tests**

Add tests that construct a minimal `ForgeGlowDraft` with baseline and one custom variant and assert `build_patch_intent` includes both baseline and selected variants. Add a path safety test that export output stays inside `pko-tools/exports/forge-glows`.

- [ ] **Step 2: Run tests and verify failure**

Run: `cd src-tauri && cargo test forge_glow`

Expected: failure because resolver/export helpers are missing.

- [ ] **Step 3: Implement resolver wrapper**

Extract the core of `trace_forge_combination` into an internal helper in `item::commands` so both the existing command and forge-glow resolver can call it. The forge-glow resolver returns `ResolvedForgeRecipe` with source labels, inputs, result, provenance, and particle rows.

- [ ] **Step 4: Implement export package**

Write `recipe.json`, `manifest.json`, and `table-patches/*.patch.json`. Copy referenced `.par` assets from `<client>/effect/` or `<client>/scripts/effect/` if found; record missing assets as warnings instead of failing the whole export.

- [ ] **Step 5: Register commands and commit**

Run: `cd src-tauri && cargo test forge_glow && cargo check`

Expected: tests pass and Rust checks cleanly.

Commit:

```bash
git add src-tauri/src/forge_glow src-tauri/src/item/commands.rs src-tauri/src/lib.rs
git commit -m "feat: add forge glow resolver export commands"
```

## Task 3: Frontend Types, Commands, Store, And Navigation

**Files:**
- Create: `src/types/forgeGlow.ts`
- Create: `src/commands/forgeGlow.ts`
- Create: `src/store/forgeGlow.ts`
- Create: `src/pages/forge-glow/index.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/SideNav/SideNav.tsx`
- Modify: `src/components/WorkspaceNavigator/WorkspaceNavigator.tsx`
- Modify: `src/features/actions/actionIds.ts`
- Modify: `src/features/actions/ActionKernelProvider.tsx`

- [ ] **Step 1: Write frontend command tests**

Create `src/features/forge-glow/__tests__/forgeGlowCommands.test.ts` that mocks invoke and verifies `resolveForgeGlowRecipe`, `saveForgeGlowDraft`, and `exportForgeGlowPackage` pass the expected command names and parameters.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm test:run src/features/forge-glow/__tests__/forgeGlowCommands.test.ts`

Expected: failure because command wrappers do not exist.

- [ ] **Step 3: Add types, wrappers, atoms, and route shell**

Implement exact TypeScript contracts matching Rust serde field names. Add a lazy-loaded `/forge-glow` route and sidebar entry named `Forge Glow`.

- [ ] **Step 4: Run tests and commit**

Run: `pnpm test:run src/features/forge-glow/__tests__/forgeGlowCommands.test.ts && pnpm build`

Expected: command tests pass and TypeScript builds.

Commit:

```bash
git add src/types/forgeGlow.ts src/commands/forgeGlow.ts src/store/forgeGlow.ts src/pages/forge-glow src/App.tsx src/components/SideNav/SideNav.tsx src/components/WorkspaceNavigator/WorkspaceNavigator.tsx src/features/actions
git commit -m "feat: add forge glow route contracts"
```

## Task 4: Workbench UI And Preview

**Files:**
- Create: `src/features/forge-glow/ForgeGlowBench.tsx`
- Create: `src/features/forge-glow/ForgeGlowNavigator.tsx`
- Create: `src/features/forge-glow/ForgeGlowResolverPanel.tsx`
- Create: `src/features/forge-glow/ForgeGlowRecipePanel.tsx`
- Create: `src/features/forge-glow/ForgeGlowPreview.tsx`
- Create: `src/features/forge-glow/ForgeGlowExportPanel.tsx`

- [ ] **Step 1: Write UI tests**

Create `src/features/forge-glow/__tests__/ForgeGlowBench.test.tsx` that renders the bench with mocked commands and asserts resolver controls, baseline label, variant controls, and export controls exist.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm test:run src/features/forge-glow/__tests__/ForgeGlowBench.test.tsx`

Expected: failure because components do not exist.

- [ ] **Step 3: Implement v0 UI**

Build a dense operational layout: resolver/input panel on the left, 3D preview in the center, resolved recipe and variants on the right, export controls below the recipe. Avoid decorative landing-page patterns. Use existing buttons/inputs and lucide icons.

- [ ] **Step 4: Run tests and commit**

Run: `pnpm test:run src/features/forge-glow/__tests__/ForgeGlowBench.test.tsx && pnpm build`

Expected: tests pass and TypeScript builds.

Commit:

```bash
git add src/features/forge-glow src/pages/forge-glow src/types/forgeGlow.ts src/store/forgeGlow.ts
git commit -m "feat: build forge glow bench ui"
```

## Task 5: Final Verification

**Files:**
- Verify only

- [ ] **Step 1: Run backend checks**

Run: `cd src-tauri && cargo test forge_glow && cargo check`

Expected: all pass.

- [ ] **Step 2: Run frontend checks**

Run: `pnpm test:run src/features/forge-glow && pnpm build`

Expected: all pass.

- [ ] **Step 3: Summarize limitations**

Document in the final response that v0 exports sandbox package intent only and does not live-patch PKO tables.

## Self-Review

- Spec coverage: resolver, drafts, variants, immutable baseline, recipe-level overrides, preview, and sandbox export are covered.
- Placeholder scan: no `TBD`, `TODO`, or unspecified implementation steps remain.
- Type consistency: Rust and TypeScript contracts use the same forge-glow terms: `ResolvedForgeRecipe`, `ForgeGlowDraft`, `ForgeGlowVariant`, `ForgeGlowRecipeOverrides`.
