import { describe, it, expect } from "vitest";
import { EffectV2Selection, EffectV2ViewMode, MagicGroupEntry, MagicSingleEntry } from "@/types/effect-v2";

const mockMagicOne: MagicSingleEntry = {
  id: 10,
  data_name: "fireball",
  name: "Fireball",
  models: ["fireball.eff"],
  velocity: 10,
  particles: [],
  dummies: [-1, -1, -1, -1, -1, -1, -1, -1],
  render_idx: 1,
  lightId: 0,
  result_effect: "fire_hit",
};

const mockMagicGroup: MagicGroupEntry = {
  id: 5,
  data_name: "combo",
  name: "Fire Combo",
  typeIds: [10, 11, -1, -1, -1, -1, -1, -1],
  counts: [2, 1, 0, 0, 0, 0, 0, 0],
  totalCount: 3,
  renderIdx: -1,
};

describe("EffectV2Selection", () => {
  it("creates magic_one selection", () => {
    const sel: EffectV2Selection = { type: "magic_one", entry: mockMagicOne };
    expect(sel.type).toBe("magic_one");
    expect(sel.entry.id).toBe(10);
    expect(sel.entry.name).toBe("Fireball");
  });

  it("creates magic_group selection", () => {
    const sel: EffectV2Selection = { type: "magic_group", entry: mockMagicGroup };
    expect(sel.type).toBe("magic_group");
    expect(sel.entry.typeIds[0]).toBe(10);
    expect(sel.entry.totalCount).toBe(3);
  });

  it("creates effect selection", () => {
    const sel: EffectV2Selection = { type: "effect", fileName: "fireball.eff" };
    expect(sel.type).toBe("effect");
    expect(sel.fileName).toBe("fireball.eff");
  });

  it("creates particle selection", () => {
    const sel: EffectV2Selection = { type: "particle", fileName: "fire_hit.par" };
    expect(sel.type).toBe("particle");
    expect(sel.fileName).toBe("fire_hit.par");
  });

  it("discriminates types correctly in switch", () => {
    const selections: EffectV2Selection[] = [
      { type: "magic_one", entry: mockMagicOne },
      { type: "magic_group", entry: mockMagicGroup },
      { type: "effect", fileName: "test.eff" },
      { type: "particle", fileName: "test.par" },
    ];

    const types = selections.map((sel) => {
      switch (sel.type) {
        case "magic_one": return `magic_one:${sel.entry.id}`;
        case "magic_group": return `magic_group:${sel.entry.id}`;
        case "effect": return `effect:${sel.fileName}`;
        case "particle": return `particle:${sel.fileName}`;
      }
    });

    expect(types).toEqual([
      "magic_one:10",
      "magic_group:5",
      "effect:test.eff",
      "particle:test.par",
    ]);
  });
});

describe("EffectV2ViewMode", () => {
  it("supports all four modes", () => {
    const modes: EffectV2ViewMode[] = ["magic_group", "magic_one", "effect", "particle"];
    expect(modes).toHaveLength(4);
  });
});

describe("MagicGroupEntry", () => {
  it("filters active typeIds (non -1)", () => {
    const active = mockMagicGroup.typeIds.filter((id) => id >= 0);
    expect(active).toEqual([10, 11]);
  });

  it("expands phases from typeIds + counts", () => {
    const phases: number[] = [];
    for (let i = 0; i < mockMagicGroup.typeIds.length; i++) {
      if (mockMagicGroup.typeIds[i] < 0) continue;
      for (let j = 0; j < mockMagicGroup.counts[i]; j++) {
        phases.push(mockMagicGroup.typeIds[i]);
      }
    }
    expect(phases).toEqual([10, 10, 11]);
    expect(phases.length).toBe(mockMagicGroup.totalCount);
  });
});
