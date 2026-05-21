import { describe, expect, it } from "vitest";
import {
  buildForgeGlowPreview,
  buildForgeGlowLitRecipe,
  addForgeGlowCustomParticleRow,
  filterForgeGlowEffectFileOptions,
  formatForgeGlowDummyOption,
  getEffectiveForgeGlowRows,
  getForgeGlowEffectFileKind,
  parseForgeGlowScaleInput,
  removeForgeGlowParticleOverride,
  selectForgeGlowLitEntry,
  stripForgeGlowEffectFileExtension,
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
      weaponModelId: "01010001",
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

  it("surfaces custom variant particle rows when the recipe has no source rows", () => {
    const nextDraft = draft();
    nextDraft.sourceRecipe.particleRows = [];
    nextDraft.variants[0].overrides.particleRows = [];
    nextDraft.variants[0] = addForgeGlowCustomParticleRow(nextDraft.variants[0], {
      dummyId: 2,
      scale: 0.8,
      parFile: "custom.eff",
    });

    const rows = getEffectiveForgeGlowRows(nextDraft, "variant-a");

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      isCustom: true,
      enabled: true,
      dummyId: 2,
      scale: 0.8,
      parFile: "custom.eff",
      finalEffectId: 0,
    });
  });

  it("removes custom particle rows from variants", () => {
    const variant = addForgeGlowCustomParticleRow(draft().variants[0], {
      parFile: "custom.par",
    });

    const next = removeForgeGlowParticleOverride(variant, 1);

    expect(next.overrides.particleRows.some((row) => row.laneTier === 1)).toBe(false);
  });

  it("builds an item-viewer forge preview from effective rows", () => {
    const nextDraft = draft();
    nextDraft.variants[0].overrides.particleRows[0].enabled = true;
    const preview = buildForgeGlowPreview(nextDraft, "variant-a");

    expect(preview.alpha).toBe(0.5);
    expect(preview.effect_level).toBe(2);
    expect(preview.particles).toEqual([
      {
        par_file: "custom.par",
        dummy_id: 7,
        scale: 1.25,
        effect_id: 102,
      },
    ]);
  });

  it("selects the lit glow entry for the forge effect tier", () => {
    const entry = selectForgeGlowLitEntry(
      {
        item_id: 20,
        descriptor: "forge",
        file: "glow",
        lits: [
          { id: 1, file: "tier0.tga", anim_type: 1, transp_type: 1, opacity: 0.25 },
          { id: 2, file: "tier1.tga", anim_type: 2, transp_type: 1, opacity: 0.5 },
          { id: 3, file: "tier2.tga", anim_type: 3, transp_type: 1, opacity: 0.75 },
        ],
      },
      2,
    );

    expect(entry?.file).toBe("tier2.tga");
  });

  it("recognizes top-level particle and effect files for forge glow rows", () => {
    expect(getForgeGlowEffectFileKind("glow.par")).toBe("par");
    expect(getForgeGlowEffectFileKind("glow.eff")).toBe("eff");
    expect(getForgeGlowEffectFileKind("glow.txt")).toBeNull();
    expect(stripForgeGlowEffectFileExtension("glow.eff")).toBe("glow");
  });

  it("keeps decimal scale edits parseable without forcing invalid partial text", () => {
    expect(parseForgeGlowScaleInput("0.25")).toBe(0.25);
    expect(parseForgeGlowScaleInput("1.")).toBe(1);
    expect(parseForgeGlowScaleInput(".")).toBeNull();
    expect(parseForgeGlowScaleInput("")).toBeNull();
  });

  it("filters renderable forge glow row files from par and eff catalogs", () => {
    expect(
      filterForgeGlowEffectFileOptions(
        ["spark.par", "spark.eff", "notes.txt", "SPARK.PAR", "aura.eff"],
        "spark",
      ),
    ).toEqual(["spark.eff", "spark.par"]);
  });

  it("describes the native lit recipe that drives the glow overlay", () => {
    const recipe = buildForgeGlowLitRecipe(4, {
      id: 3,
      file: "green.tga",
      anim_type: 6,
      transp_type: 1,
      opacity: 0.78,
    });

    expect(recipe.summary).toContain("light 4");
    expect(recipe.texture).toBe("green.tga");
    expect(recipe.blendMode).toBe("Additive");
    expect(recipe.steps).toHaveLength(3);
  });

  it("formats discovered weapon dummies as selectable anchors", () => {
    expect(formatForgeGlowDummyOption({ id: 2, name: "Dummy2" })).toBe("D2 - Dummy2");
    expect(formatForgeGlowDummyOption({ id: 4, name: "" })).toBe("D4");
  });
});
