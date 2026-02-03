import { Item, ItemLitInfo, ItemMetadata, ModelVariant, ForgeEffectPreview, ItemCategoryAvailability } from "@/types/item";
import { atom } from "jotai";

export const selectedItemAtom = atom<Item | null>(null);
export const itemGltfJsonAtom = atom<string | null>(null);
export const itemMetadataAtom = atom<ItemMetadata | null>(null);
export const itemLitInfoAtom = atom<ItemLitInfo | null>(null);
export const selectedModelVariantAtom = atom<ModelVariant>("ground");
export const itemLoadingAtom = atom<boolean>(false);

export type ItemEffectConfig = {
  showLitGlow: boolean;
  showEffects: boolean;
  showParticles: boolean;
  refineLevel: number;
};

export const itemEffectConfigAtom = atom<ItemEffectConfig>({
  showLitGlow: true,
  showEffects: true,
  showParticles: true,
  refineLevel: 0,
});

export type ItemDebugConfig = {
  showBoundingSpheres: boolean;
  showWireframe: boolean;
  showDummies: boolean;
  showGlowOverlay: boolean;
};

export const itemDebugConfigAtom = atom<ItemDebugConfig>({
  showBoundingSpheres: false,
  showWireframe: false,
  showDummies: false,
  showGlowOverlay: false,
});

export const forgeEffectPreviewAtom = atom<ForgeEffectPreview | null>(null);
export const itemCharTypeAtom = atom<number>(0);
export const itemEffectCategoryAtom = atom<number>(0);
export const itemCategoryAvailabilityAtom = atom<ItemCategoryAvailability | null>(null);
