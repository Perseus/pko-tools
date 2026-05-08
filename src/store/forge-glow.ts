import { atom } from "jotai";
import { ForgeGlowDraft, ForgeGlowDraftSummary } from "@/types/forge-glow";

export const forgeGlowDraftsAtom = atom<ForgeGlowDraftSummary[]>([]);
export const activeForgeGlowDraftAtom = atom<ForgeGlowDraft | null>(null);
export const selectedForgeGlowVariantIdAtom = atom<string>("baseline");
export const selectedForgeGlowLaneAtom = atom<number | "all">("all");
