import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearEffectTextureCacheForTest,
  decodeEffectTextureCached,
  emulateD3dA8R8G8B8,
  resolveEffectTextureCandidates,
} from "../useEffectTexture";

const { invokeTimedMock } = vi.hoisted(() => ({
  invokeTimedMock: vi.fn(),
}));

vi.mock("@/commands/invokeTimed", () => ({
  invokeTimed: (...args: unknown[]) => invokeTimedMock(...args),
}));

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

describe("decodeEffectTextureCached", () => {
  beforeEach(() => {
    clearEffectTextureCacheForTest();
    invokeTimedMock.mockReset();
  });

  it("dedupes concurrent decode_texture requests for the same path", async () => {
    invokeTimedMock.mockResolvedValue({
      width: 1,
      height: 1,
      data: btoa(String.fromCharCode(10, 20, 30, 40)),
    });

    const [first, second] = await Promise.all([
      decodeEffectTextureCached("/project/texture/effect/eff0281.tga"),
      decodeEffectTextureCached("/PROJECT/texture/effect/EFF0281.TGA"),
    ]);

    expect(Array.from(first.bytes)).toEqual([10, 20, 30, 40]);
    expect(second).toBe(first);
    expect(invokeTimedMock).toHaveBeenCalledTimes(1);
    expect(invokeTimedMock).toHaveBeenCalledWith("decode_texture", {
      path: "/project/texture/effect/eff0281.tga",
    });
  });

  it("returns decoded bytes from cache after the first request resolves", async () => {
    invokeTimedMock.mockResolvedValue({
      width: 1,
      height: 1,
      data: btoa(String.fromCharCode(1, 2, 3, 4)),
    });

    await decodeEffectTextureCached("/project/texture/effect/zap1b.tga");
    const second = await decodeEffectTextureCached("/project/texture/effect/zap1b.tga");

    expect(Array.from(second.bytes)).toEqual([1, 2, 3, 4]);
    expect(invokeTimedMock).toHaveBeenCalledTimes(1);
  });
});
