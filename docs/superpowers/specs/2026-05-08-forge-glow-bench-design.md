# Forge Glow Bench Design

## Objective

Build a separate Forge Glow Bench for inspecting, remixing, previewing, and sandbox-exporting PKO refine/weapon glow recipes. This is not part of the existing item tab and is not a raw `.eff` or `.par` editor in v0.

The first version focuses on the workflow:

1. Resolve the real PKO forge/refine glow data for a weapon and gem/refine setup.
2. Show the resolved recipe and table provenance clearly.
3. Fork editable variants from the resolved baseline.
4. Preview variants with the current v2 effect renderer.
5. Export a non-destructive sandbox package with recipe JSON, copied/generated assets, and table-patch intent.

## Scope

### In Scope

- New dedicated route/workbench for forge glow inspection and remixing.
- Weapon/item selection, character type selection, and forge/refine input selection.
- Resolve the actual PKO data chain:
  - `ItemInfo`
  - `StoneInfo`
  - `ItemRefineInfo`
  - `ItemRefineEffectInfo`
  - `SceneEffectInfo`
  - referenced `.par` / `.eff` assets
  - lit/light data
- Save pko-tools-owned draft files.
- Support multiple named variants per draft.
- Always include an immutable baseline variant.
- Recipe-level editing only:
  - enable/disable particle rows
  - swap referenced `.par`/effect asset at the recipe row level
  - dummy ID
  - scale
  - alpha
  - category/refine/gem inputs
  - light/lit selection where applicable
- Preview weapon model plus active glow variant.
- Export sandbox packages without mutating live client files.

### Out Of Scope For v0

- Direct live patching of PKO client table files.
- Raw `.eff` sub-effect keyframe editing.
- Raw `.par` particle-system editing.
- Full refine progression authoring across every level/category as one operation.
- Replacing the existing item tab forge preview.

## Product Model

The bench is built around a resolved recipe, not around a generic item viewer.

```ts
type ResolvedForgeRecipe = {
  source: ForgeRecipeSource;
  inputs: ForgeRecipeInputs;
  result: ForgeRecipeResult;
  provenance: ForgeRecipeProvenance;
};

type ForgeGlowDraft = {
  id: string;
  name: string;
  createdAt: string;
  modifiedAt: string;
  sourceRecipe: ResolvedForgeRecipe;
  baselineVariant: ForgeGlowVariant;
  variants: ForgeGlowVariant[];
  activeVariantId: string;
};

type ForgeGlowVariant = {
  id: string;
  name: string;
  readonly: boolean;
  basedOnVariantId: string | null;
  overrides: ForgeGlowRecipeOverrides;
};
```

The baseline variant is read-only and mirrors the original PKO resolution exactly. Custom variants are named editable copies that store only recipe-level overrides.

## UI Flow

### Resolve

The user selects a weapon, character type, and forge/refine inputs. The bench calls the resolver and displays the exact table path used to produce the glow.

### Inspect

The resolved recipe panel shows:

- weapon item ID/name
- character type
- gem inputs and resolved stone types
- total refine/gem level
- effect level
- alpha
- category
- `ItemRefineInfo` values
- selected `ItemRefineEffectInfo` ID
- light/lit entry
- particle rows:
  - lane/tier
  - base effect ID
  - final scene effect ID
  - dummy ID
  - scale
  - `.par` file

### Fork Variant

The user creates a new variant from baseline or from another variant. The variant starts as a copy and records only changes from its parent/baseline.

### Remix

The user edits recipe-level fields. Every changed field is marked as an override compared with baseline, so the bench can always explain what changed.

### Preview

The central preview renders the weapon and active glow variant. Preview uses the current effect-v2 renderer path for effect/particle playback, not the legacy item-tab effect renderer. The preview should support:

- active variant selection
- baseline quick switch or overlay comparison
- row visibility toggles
- playback reset/play/loop controls using v2 semantics

### Export

The export action writes a non-destructive package containing baseline plus selected custom variants.

Recommended output:

```text
<client>/pko-tools/exports/forge-glows/<draft-name>/
  recipe.json
  manifest.json
  assets/
    effects/*.par
    effects/*.eff
  table-patches/
    ItemRefineInfo.patch.json
    ItemRefineEffectInfo.patch.json
    SceneEffectInfo.patch.json
```

Patch files are declarative intent. They explain what table rows/assets would need to exist or change to apply the selected variant, but no live table file is modified by v0.

## Architecture

### Frontend

Add a new feature area:

```text
src/features/forge-glow/
  ForgeGlowBench.tsx
  ForgeGlowNavigator.tsx
  ForgeGlowResolverPanel.tsx
  ForgeGlowRecipePanel.tsx
  ForgeGlowVariantPanel.tsx
  ForgeGlowPreview.tsx
  ForgeGlowExportPanel.tsx
```

Add route and sidebar entries for the new bench. The existing item tab remains unchanged except for possible extraction of reusable item-model helpers if needed.

Suggested atoms:

```ts
forgeGlowDraftAtom
forgeGlowDraftListAtom
forgeGlowResolvedRecipeAtom
forgeGlowActiveVariantIdAtom
forgeGlowExportStateAtom
```

The preview should render the active variant through effect-v2 components wherever possible:

- item/weapon model loading can reuse existing item model helpers
- particle/effect playback should use `ParticleEffectRenderer` / `EffectRenderer` style v2 rendering
- old item-tab renderer code should not become the foundation for the new bench

### Backend

Add a forge-glow module rather than expanding `item/workbench.rs`:

```text
src-tauri/src/forge_glow/
  mod.rs
  model.rs
  commands.rs
  resolver.rs
  storage.rs
  export.rs
```

Initial commands:

```text
resolve_forge_glow_recipe(projectId, weaponItemId, charType, gems)
save_forge_glow_draft(projectId, draft)
list_forge_glow_drafts(projectId)
load_forge_glow_draft(projectId, draftId)
delete_forge_glow_draft(projectId, draftId)
export_forge_glow_package(projectId, draftId, variantIds)
```

`resolve_forge_glow_recipe` can initially wrap the existing `trace_forge_combination` logic, but should return richer provenance and asset references so the UI does not reverse-engineer table meaning.

Draft storage:

```text
<client>/pko-tools/forge-glows/drafts/<draft-id>.json
```

## Data Contracts

The existing `ForgeTraceResult` is a useful base but should be expanded for the bench. The bench needs stable IDs and provenance labels, not just preview data.

Required additions:

- table source paths or table names
- source row IDs for each resolved value
- asset refs for every `.par` and nested `.eff`
- baseline row data before overrides
- export-safe normalized filenames
- validation warnings for missing assets or unresolved rows

## Error Handling

The bench should surface partial resolution instead of failing the whole view when possible.

Examples:

- Missing `StoneInfo` for a gem: show unresolved gem and block variant creation until fixed.
- Missing `SceneEffectInfo` for final effect ID: show the row with a missing asset warning.
- Missing `.par`/`.eff`: keep the recipe row visible and show preview as incomplete.
- Export collision: require overwrite confirmation or create a timestamped package.

No export command should mutate live client files.

## Testing

Backend tests:

- resolver matches current `trace_forge_combination` output for representative weapons/gems
- draft save/load round trip
- variant override serialization
- export package contains baseline, selected variants, manifest, assets, and table-patch intent
- export does not write outside `pko-tools/exports/forge-glows`

Frontend tests:

- route renders without an active draft
- resolving a weapon populates baseline recipe
- creating a variant copies baseline and marks overrides
- toggling a row changes preview recipe state
- export panel calls the export command with selected variants

Manual checks:

- Resolve a known weapon/gem setup from the current item tab and confirm the same particles/lit/alpha appear.
- Preview baseline and custom variant against the same weapon.
- Export a package and inspect `manifest.json` plus patch intent files.

## Acceptance Criteria

- Forge Glow Bench is available as its own route/workbench.
- A real weapon/gem/refine setup can be resolved into a visible baseline recipe.
- Baseline is immutable and always included in drafts and exports.
- A draft can contain multiple named variants.
- Variants can override recipe-level rows/fields without editing raw `.eff` or `.par` internals.
- Preview uses the current v2 effect renderer path for glow effects.
- Export creates a sandbox package with baseline, selected variants, assets, manifest, and table-patch intent.
- No live PKO client table or asset file is modified by v0.

## Implementation Notes

- Start with resolver and draft model before UI polish.
- Keep renderer reuse explicit: if an effect cannot render through v2, treat that as a renderer gap rather than adding item-tab-specific rendering.
- Extract shared item model/dummy display helpers only when needed by the new route.
- Keep patch intent files declarative and readable; applying patches is a future feature.
