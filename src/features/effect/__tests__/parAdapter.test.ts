import { describe, expect, it } from "vitest";
import {
  adaptParFile,
  adaptStrips,
  deriveParName,
  type RustParFile,
} from "@/features/effect/parAdapter";

describe("deriveParName", () => {
  it("converts .eff to .par", () => {
    expect(deriveParName("01000005.eff")).toBe("01000005.par");
  });

  it("strips parenthetical suffix", () => {
    expect(deriveParName("01000005(0).eff")).toBe("01000005.par");
    expect(deriveParName("fire_01(3).eff")).toBe("fire_01.par");
  });

  it("handles names without parenthetical", () => {
    expect(deriveParName("fire_01.eff")).toBe("fire_01.par");
  });

  it("is case-insensitive for .eff extension", () => {
    expect(deriveParName("Test.EFF")).toBe("Test.par");
  });
});

describe("adaptParFile", () => {
  const minimalParFile: RustParFile = {
    version: 15,
    name: "test_par",
    length: 2.5,
    systems: [
      {
        type: 2,
        name: "fire_sys",
        particleCount: 20,
        textureName: "fire.dds",
        modelName: "",
        range: [1, 1, 1],
        frameCount: 2,
        frameSizes: [1.0, 0.5],
        frameAngles: [[0, 0, 0], [0, 0, 1]],
        frameColors: [[1, 1, 0, 1], [1, 0, 0, 0]],
        billboard: true,
        srcBlend: 5,
        destBlend: 2,
        minFilter: 2,
        magFilter: 2,
        life: 1.5,
        velocity: 3.0,
        direction: [0, 1, 0],
        acceleration: [0, -1, 0],
        step: 0.05,
        modelRangeFlag: true,
        modelRangeName: "virtual_box",
        offset: [0, 0.5, 0],
        delayTime: 0.1,
        playTime: 5.0,
        usePath: false,
        path: null,
        shade: false,
        hitEffect: "hit_spark",
        pointRanges: [[1, 0, 0], [0, 1, 0]],
        randomMode: 3,
        modelDir: false,
        mediaY: true,
      },
    ],
    strips: [],
    models: [],
  };

  it("maps top-level fields", () => {
    const result = adaptParFile(minimalParFile);
    expect(result.name).toBe("test_par");
    expect(result.length).toBe(2.5);
    expect(result.systems).toHaveLength(1);
  });

  it("maps renamed fields correctly", () => {
    const sys = adaptParFile(minimalParFile).systems[0];
    // modelRangeFlag → modelRange
    expect(sys.modelRange).toBe(true);
    // modelRangeName → virtualModel
    expect(sys.virtualModel).toBe("virtual_box");
    // pointRanges → pointRange
    expect(sys.pointRange).toEqual([[1, 0, 0], [0, 1, 0]]);
    // randomMode → random
    expect(sys.random).toBe(3);
  });

  it("preserves identity fields", () => {
    const sys = adaptParFile(minimalParFile).systems[0];
    expect(sys.type).toBe(2);
    expect(sys.name).toBe("fire_sys");
    expect(sys.textureName).toBe("fire.dds");
    expect(sys.billboard).toBe(true);
    expect(sys.life).toBe(1.5);
    expect(sys.velocity).toBe(3.0);
    expect(sys.hitEffect).toBe("hit_spark");
    expect(sys.delayTime).toBe(0.1);
    expect(sys.playTime).toBe(5.0);
    expect(sys.mediaY).toBe(true);
  });
});

describe("adaptStrips", () => {
  it("maps strip fields with renamed textureName → texName", () => {
    const strips = adaptStrips([
      {
        maxLen: 15,
        dummy: [0, 1],
        color: [1, 0.5, 0, 0.8],
        life: 2.0,
        step: 0.1,
        textureName: "trail.dds",
        srcBlend: 5,
        destBlend: 6,
      },
    ]);

    expect(strips).toHaveLength(1);
    expect(strips[0].texName).toBe("trail.dds");
    expect(strips[0].maxLen).toBe(15);
    expect(strips[0].color).toEqual([1, 0.5, 0, 0.8]);
    expect(strips[0].srcBlend).toBe(5);
  });
});
