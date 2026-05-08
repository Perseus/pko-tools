import { describe, expect, it } from "vitest";
import {
  getEffectiveForgeGlowRows,
  upsertForgeGlowParticleOverride,
} from "../forgeGlowDraft";
import { ForgeGlowDraft, ForgeGlowVariant } from "@/types/forge-glow";

function draft(): ForgeGlowDraft {
  return {
    id: "draft",
    name: "Draft",
    createdAt: "1",
    modifiedAt: "1",
    activeVariantId: "variant-a",
    baselineVariant: {
      id: "baseline",
      name: "Baseline",
      readonly: true,
      basedOnVariantId: null,
      overrides: { particleRows: [] },
    },
    variants: [
      {
        id: "variant-a",
        name: "Variant A",
        readonly: false,
        basedOnVariantId: "baseline",
        overrides: {
          alpha: 0.5,
          particleRows: [
            {
              laneTier: 0,
              enabled: false,
              dummyId: 7,
              scale: 1.25,
              parFile: "custom.par",
            },
          ],
        },
      },
    ],
    sourceRecipe: {
      weaponItemId: 1000,
      weaponName: "Sword",
      charType: 0,
      totalLevel: 9,
      effectLevel: 2,
      alpha: 0.75,
      category: 1,
      refineEffectId: 50,
      lightId: 20,
      sourceTables: [],
      warnings: [],
      particleRows: [
        {
          laneTier: 0,
          baseEffectId: 10,
          finalEffectId: 102,
          dummyId: 1,
          scale: 1,
          parFile: "base.par",
          enabled: true,
        },
      ],
    },
  };
}

describe("forge glow draft helpers", () => {
  it("applies particle row overrides without mutating baseline rows", () => {
    const rows = getEffectiveForgeGlowRows(draft(), "variant-a");

    expect(rows[0]).toMatchObject({
      enabled: false,
      dummyId: 7,
      scale: 1.25,
      parFile: "custom.par",
    });
    expect(rows[0].sourceRow).toMatchObject({
      enabled: true,
      dummyId: 1,
      scale: 1,
      parFile: "base.par",
    });
  });

  it("upserts lane overrides", () => {
    const variant: ForgeGlowVariant = draft().variants[0];
    const next = upsertForgeGlowParticleOverride(variant, 1, {
      scale: 2,
    });

    expect(next.overrides.particleRows).toHaveLength(2);
    expect(next.overrides.particleRows[1]).toMatchObject({
      laneTier: 1,
      scale: 2,
    });
  });
});
