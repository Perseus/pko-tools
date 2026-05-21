import {
  EffectiveForgeGlowRow,
  ForgeGlowDraft,
  ForgeGlowParticleOverride,
  ForgeGlowVariant,
  ForgeRecipeParticleRow,
} from "@/types/forge-glow";
import type { ForgeEffectPreview, ItemLitEntry, ItemLitInfo } from "@/types/item";

export type ForgeGlowEffectFileKind = "par" | "eff";

export type ForgeGlowDummyOption = {
  id: number;
  name: string;
};

export type ForgeGlowLitRecipe = {
  lightId: number | null;
  texture: string;
  opacity: number | null;
  blendMode: string;
  animation: string;
  summary: string;
  steps: string[];
};

export function getForgeGlowEffectFileKind(fileName: string): ForgeGlowEffectFileKind | null {
  const normalized = fileName.trim().toLowerCase();
  if (normalized.endsWith(".par")) return "par";
  if (normalized.endsWith(".eff")) return "eff";
  return null;
}

export function stripForgeGlowEffectFileExtension(fileName: string): string {
  return fileName.trim().replace(/\.(par|eff)$/i, "");
}

export function parseForgeGlowScaleInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "." || trimmed === "-" || trimmed === "-.") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function filterForgeGlowEffectFileOptions(
  fileNames: string[],
  query: string,
  limit = 24,
): string[] {
  const normalizedQuery = query.trim().toLowerCase();
  const seen = new Set<string>();
  return fileNames
    .filter((fileName) => getForgeGlowEffectFileKind(fileName) !== null)
    .filter((fileName) => {
      const key = fileName.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return !normalizedQuery || key.includes(normalizedQuery);
    })
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }))
    .slice(0, limit);
}

export function describeForgeGlowBlendMode(transpType: number): string {
  switch (transpType) {
    case 0:
      return "Alpha filter";
    case 1:
      return "Additive";
    case 2:
      return "SrcColor + One";
    case 3:
      return "SrcColor + InvSrcColor";
    case 4:
      return "SrcAlpha + DstAlpha";
    case 5:
      return "Subtractive";
    default:
      return `Blend ${transpType}`;
  }
}

export function describeForgeGlowLitAnimation(animType: number): string {
  switch (animType) {
    case 0:
      return "Static";
    case 1:
      return "120f UV rotation";
    case 2:
      return "120f UV scroll";
    case 3:
      return "360f V scroll";
    case 4:
      return "360f U scroll";
    case 5:
      return "360f UV scroll";
    case 6:
      return "360f UV scroll + rotation";
    case 7:
      return "360f UV scroll + reverse rotation";
    case 8:
      return "720f UV rotation";
    default:
      return `Animation ${animType}`;
  }
}

export function buildForgeGlowLitRecipe(
  lightId: number | null,
  litEntry: ItemLitEntry | null,
): ForgeGlowLitRecipe {
  const texture = litEntry?.file || "No lit texture selected";
  const opacity = litEntry?.opacity ?? null;
  const blendMode = litEntry ? describeForgeGlowBlendMode(litEntry.transp_type) : "No blend mode";
  const animation = litEntry ? describeForgeGlowLitAnimation(litEntry.anim_type) : "No animation";
  const lightText = lightId == null ? "no light id" : `light ${lightId}`;

  return {
    lightId,
    texture,
    opacity,
    blendMode,
    animation,
    summary: litEntry
      ? `PKO renders ${lightText} by applying ${texture} to item subset 1.`
      : `PKO will not render a lit glow for ${lightText}.`,
    steps: [
      `Resolve: ItemRefineEffectInfo light id selects an item.lit record.`,
      `Texture: lit tier selects ${texture}; its pixels determine the visible color.`,
      `Render: subset 1 uses ${blendMode}${opacity === null ? "" : ` at opacity ${opacity}`} with ${animation}.`,
    ],
  };
}

export function formatForgeGlowDummyOption(dummy: ForgeGlowDummyOption): string {
  const name = dummy.name.trim();
  return name ? `D${dummy.id} - ${name}` : `D${dummy.id}`;
}

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

function customRowFromOverride(
  override: ForgeGlowParticleOverride,
): EffectiveForgeGlowRow {
  const row: ForgeRecipeParticleRow = {
    laneTier: override.laneTier,
    baseEffectId: 0,
    finalEffectId: 0,
    dummyId: override.dummyId ?? 0,
    scale: override.scale ?? 1,
    parFile: override.parFile ?? null,
    enabled: override.enabled ?? true,
  };

  return {
    ...row,
    sourceRow: row,
    isCustom: true,
  };
}

export function getEffectiveForgeGlowRows(
  draft: ForgeGlowDraft,
  variantId: string,
): EffectiveForgeGlowRow[] {
  const variant = getForgeGlowVariant(draft, variantId);
  const sourceLaneTiers = new Set(
    draft.sourceRecipe.particleRows.map((row) => row.laneTier),
  );
  const sourceRows = draft.sourceRecipe.particleRows.map((row) =>
    applyRowOverride(
      row,
      variant.overrides.particleRows.find(
        (override) => override.laneTier === row.laneTier,
      ),
    ),
  );
  const customRows = variant.overrides.particleRows
    .filter((override) => !sourceLaneTiers.has(override.laneTier))
    .map(customRowFromOverride);

  return [...sourceRows, ...customRows].sort(
    (left, right) => left.laneTier - right.laneTier,
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

export function addForgeGlowCustomParticleRow(
  variant: ForgeGlowVariant,
  defaults: Partial<ForgeGlowParticleOverride> = {},
  reservedLaneTiers: number[] = [],
): ForgeGlowVariant {
  const usedLaneTiers = new Set(
    [
      ...variant.overrides.particleRows.map((row) => row.laneTier),
      ...reservedLaneTiers,
    ],
  );
  let laneTier = 0;
  while (usedLaneTiers.has(laneTier)) laneTier += 1;

  return upsertForgeGlowParticleOverride(variant, laneTier, {
    enabled: true,
    dummyId: defaults.dummyId ?? 0,
    scale: defaults.scale ?? 1,
    parFile: defaults.parFile ?? null,
    ...defaults,
  });
}

export function removeForgeGlowParticleOverride(
  variant: ForgeGlowVariant,
  laneTier: number,
): ForgeGlowVariant {
  return {
    ...variant,
    overrides: {
      ...variant.overrides,
      particleRows: variant.overrides.particleRows.filter(
        (row) => row.laneTier !== laneTier,
      ),
    },
  };
}

export function buildForgeGlowPreview(
  draft: ForgeGlowDraft,
  variantId: string,
): ForgeEffectPreview {
  const variant = getForgeGlowVariant(draft, variantId);
  const rows = getEffectiveForgeGlowRows(draft, variantId);

  return {
    lit_id: variant.overrides.lightId ?? draft.sourceRecipe.lightId,
    lit_entry: null,
    effect_level: draft.sourceRecipe.effectLevel,
    alpha: variant.overrides.alpha ?? draft.sourceRecipe.alpha,
    particles: rows
      .filter((row) => row.enabled && row.parFile)
      .map((row) => ({
        par_file: row.parFile ?? "",
        dummy_id: row.dummyId,
        scale: row.scale,
        effect_id: row.finalEffectId,
      })),
  };
}

export function selectForgeGlowLitEntry(
  litInfo: ItemLitInfo | null,
  effectLevel: number,
): ItemLitEntry | null {
  if (!litInfo || litInfo.lits.length === 0) return null;
  const tier = Math.max(0, Math.min(effectLevel, litInfo.lits.length - 1));
  return litInfo.lits[tier] ?? litInfo.lits[0] ?? null;
}
