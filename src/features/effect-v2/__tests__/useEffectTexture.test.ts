import { describe, expect, it } from "vitest";
import {
  emulateD3dA8R8G8B8,
  resolveEffectTextureCandidates,
} from "../useEffectTexture";

describe("resolveEffectTextureCandidates", () => {
  it("preserves explicit DDS texture names so punch-through alpha reaches the decoder", () => {
    const candidates = resolveEffectTextureCandidates("flare.dds", "/project");

    expect(candidates[0]).toBe("/project/texture/effect/flare.dds");
    expect(candidates).not.toContain("/project/texture/effect/flare.dds.tga");
  });

  it("keeps legacy extensionless effect texture lookup first", () => {
    expect(resolveEffectTextureCandidates("spark", "/project").slice(0, 4)).toEqual([
      "/project/texture/effect/spark.tga",
      "/project/texture/effect/spark.dds",
      "/project/texture/effect/spark.png",
      "/project/texture/effect/spark.bmp",
    ]);
  });
});

describe("emulateD3dA8R8G8B8", () => {
  it("preserves the client effect texture alpha upload format", () => {
    const converted = emulateD3dA8R8G8B8(new Uint8Array([
      0, 0, 0, 15,
      255, 128, 16, 255,
    ]));

    expect(Array.from(converted)).toEqual([
      0, 0, 0, 15,
      255, 128, 16, 255,
    ]);
  });
});
