export type ForgeRecipeGemInput = {
  itemId: number;
  level: number;
};

export type ForgeRecipeInputs = {
  weaponItemId: number;
  charType: number;
  gems: ForgeRecipeGemInput[];
};

export type ForgeRecipeParticleRow = {
  laneTier: number;
  baseEffectId: number;
  finalEffectId: number;
  dummyId: number;
  scale: number;
  parFile: string | null;
  enabled: boolean;
};

export type ResolvedForgeRecipe = {
  weaponItemId: number;
  weaponName: string;
  charType: number;
  totalLevel: number;
  effectLevel: number;
  alpha: number;
  category: number;
  refineEffectId: number | null;
  lightId: number | null;
  particleRows: ForgeRecipeParticleRow[];
  sourceTables: string[];
  warnings: string[];
};

export type ForgeGlowParticleOverride = {
  laneTier: number;
  enabled?: boolean;
  dummyId?: number;
  scale?: number;
  parFile?: string | null;
};

export type ForgeGlowRecipeOverrides = {
  alpha?: number;
  lightId?: number | null;
  particleRows: ForgeGlowParticleOverride[];
};

export type ForgeGlowVariant = {
  id: string;
  name: string;
  readonly: boolean;
  basedOnVariantId: string | null;
  overrides: ForgeGlowRecipeOverrides;
};

export type ForgeGlowDraft = {
  id: string;
  name: string;
  createdAt: string;
  modifiedAt: string;
  sourceRecipe: ResolvedForgeRecipe;
  baselineVariant: ForgeGlowVariant;
  variants: ForgeGlowVariant[];
  activeVariantId: string;
};

export type ForgeGlowDraftSummary = {
  id: string;
  name: string;
  weaponItemId: number;
  weaponName: string;
  variantCount: number;
  modifiedAt: string;
};

export type ForgeGlowExportResult = {
  outputDir: string;
  manifestPath: string;
  recipePath: string;
  exportedVariantIds: string[];
  warnings: string[];
};

export type EffectiveForgeGlowRow = ForgeRecipeParticleRow & {
  sourceRow: ForgeRecipeParticleRow;
};
