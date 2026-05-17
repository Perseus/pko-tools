import { describe, expect, it } from "vitest";
import {
  filterForgeGlowWeaponOptions,
  formatGemOption,
  resolveForgeGlowGemOption,
} from "../ForgeGlowNavigator";
import type { Item } from "@/types/item";

function item(
  id: number,
  name: string,
  itemType: number,
  models: Partial<Pick<Item, "model_lance" | "model_carsise" | "model_phyllis" | "model_ami">> = {},
): Item {
  return {
    id,
    name,
    icon_name: "",
    model_ground: "0",
    model_lance: models.model_lance ?? "01010001",
    model_carsise: models.model_carsise ?? "02010001",
    model_phyllis: models.model_phyllis ?? "03010001",
    model_ami: models.model_ami ?? "04010001",
    item_type: itemType,
    display_effect: "0",
    bind_effect: "0",
    bind_effect_2: "0",
    description: "",
  };
}

describe("filterForgeGlowWeaponOptions", () => {
  it("only returns weapon item types with a model for the selected character", () => {
    const options = filterForgeGlowWeaponOptions(
      [
        item(5001, "Azure Sword", 1),
        item(7001, "Quest Token", 31),
        item(5002, "Ami Hidden Sword", 1, { model_ami: "0" }),
      ],
      "",
      3,
    );

    expect(options.map((option) => option.id)).toEqual([5001]);
  });

  it("searches inside the valid weapon list", () => {
    const options = filterForgeGlowWeaponOptions(
      [item(5001, "Azure Sword", 1), item(6001, "Training Bow", 3)],
      "bow",
      0,
    );

    expect(options.map((option) => option.id)).toEqual([6001]);
  });
});

describe("formatGemOption", () => {
  it("keeps the item id, gem name, and stone type visible", () => {
    expect(
      formatGemOption({
        itemId: 881,
        itemName: "Shining Gem of Rage",
        stoneInfoId: 7,
        stoneType: 3,
        equipPos: [1, 2, 3],
        hintFunc: "StoneHint",
      }),
    ).toBe("881 · Shining Gem of Rage · type 3");
  });
});

describe("resolveForgeGlowGemOption", () => {
  const gems = [
    {
      itemId: 881,
      itemName: "Mysterious Topaz Fragment",
      stoneInfoId: 7,
      stoneType: 3,
      equipPos: [1, 2, 3],
      hintFunc: "StoneHint",
    },
    {
      itemId: 882,
      itemName: "Mysterious Ruby Fragment",
      stoneInfoId: 8,
      stoneType: 4,
      equipPos: [1, 2, 3],
      hintFunc: "StoneHint",
    },
  ];

  it("resolves a selected gem from the stored item id", () => {
    expect(resolveForgeGlowGemOption(gems, "", "881")?.itemName).toBe(
      "Mysterious Topaz Fragment",
    );
  });

  it("resolves exact gem names typed or restored by the browser", () => {
    expect(
      resolveForgeGlowGemOption(gems, "Mysterious Topaz Fragment", "")?.itemId,
    ).toBe(881);
  });

  it("resolves the formatted dropdown label", () => {
    expect(
      resolveForgeGlowGemOption(
        gems,
        "881 · Mysterious Topaz Fragment · type 3",
        "",
      )?.itemId,
    ).toBe(881);
  });
});
