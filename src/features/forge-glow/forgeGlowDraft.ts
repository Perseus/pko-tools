import {
  EffectiveForgeGlowRow,
  ForgeGlowDraft,
  ForgeGlowParticleOverride,
  ForgeGlowVariant,
  ForgeRecipeParticleRow,
} from "@/types/forge-glow";

export function getForgeGlowVariants(draft: ForgeGlowDraft): ForgeGlowVariant[] {
  return [draft.baselineVariant, ...draft.variants];
}

export function getForgeGlowVariant(
  draft: ForgeGlowDraft,
  variantId: string,
): ForgeGlowVariant {
  return (
    getForgeGlowVariants(draft).find((variant) => variant.id === variantId) ??
    draft.baselineVariant
  );
}

function applyRowOverride(
  row: ForgeRecipeParticleRow,
  override: ForgeGlowParticleOverride | undefined,
): EffectiveForgeGlowRow {
  return {
    ...row,
    sourceRow: row,
    enabled: override?.enabled ?? row.enabled,
    dummyId: override?.dummyId ?? row.dummyId,
    scale: override?.scale ?? row.scale,
    parFile: override?.parFile === undefined ? row.parFile : override.parFile,
  };
}

export function getEffectiveForgeGlowRows(
  draft: ForgeGlowDraft,
  variantId: string,
): EffectiveForgeGlowRow[] {
  const variant = getForgeGlowVariant(draft, variantId);
  return draft.sourceRecipe.particleRows.map((row) =>
    applyRowOverride(
      row,
      variant.overrides.particleRows.find(
        (override) => override.laneTier === row.laneTier,
      ),
    ),
  );
}

export function createForgeGlowVariant(draft: ForgeGlowDraft): ForgeGlowVariant {
  const nextNumber = draft.variants.length + 1;
  return {
    id: `variant-${Date.now()}`,
    name: `Variant ${nextNumber}`,
    readonly: false,
    basedOnVariantId: draft.activeVariantId,
    overrides: {
      alpha: undefined,
      lightId: undefined,
      particleRows: [],
    },
  };
}

export function updateForgeGlowVariant(
  draft: ForgeGlowDraft,
  variantId: string,
  updater: (variant: ForgeGlowVariant) => ForgeGlowVariant,
): ForgeGlowDraft {
  return {
    ...draft,
    variants: draft.variants.map((variant) =>
      variant.id === variantId ? updater(variant) : variant,
    ),
  };
}

export function upsertForgeGlowParticleOverride(
  variant: ForgeGlowVariant,
  laneTier: number,
  patch: Partial<ForgeGlowParticleOverride>,
): ForgeGlowVariant {
  const existing = variant.overrides.particleRows.find(
    (row) => row.laneTier === laneTier,
  );
  const nextOverride: ForgeGlowParticleOverride = {
    laneTier,
    ...(existing ?? {}),
    ...patch,
  };

  return {
    ...variant,
    overrides: {
      ...variant.overrides,
      particleRows: existing
        ? variant.overrides.particleRows.map((row) =>
            row.laneTier === laneTier ? nextOverride : row,
          )
        : [...variant.overrides.particleRows, nextOverride],
    },
  };
}
