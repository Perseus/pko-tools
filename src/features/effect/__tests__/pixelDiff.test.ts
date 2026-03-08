import { describe, expect, it } from "vitest";
import { diffImages, isWithinThreshold } from "./pixelDiff";

describe("diffImages", () => {
  it("returns zero mismatch for identical images", () => {
    const pixels = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]);
    const result = diffImages(pixels, pixels, 2, 1);
    expect(result.mismatchCount).toBe(0);
    expect(result.mismatchRatio).toBe(0);
    expect(result.maxDiff).toBe(0);
    expect(result.rmse).toBe(0);
    expect(result.totalPixels).toBe(2);
  });

  it("detects mismatched pixels", () => {
    const a = new Uint8Array([255, 0, 0, 255, 0, 0, 0, 255]);
    const b = new Uint8Array([0, 0, 0, 255, 0, 0, 0, 255]);
    const result = diffImages(a, b, 2, 1);
    expect(result.mismatchCount).toBe(1);
    expect(result.mismatchRatio).toBe(0.5);
    expect(result.maxDiff).toBe(255);
  });

  it("ignores differences within channel threshold", () => {
    const a = new Uint8Array([100, 100, 100, 255]);
    const b = new Uint8Array([101, 99, 100, 255]);
    const result = diffImages(a, b, 1, 1, 2);
    expect(result.mismatchCount).toBe(0);
  });

  it("detects differences beyond channel threshold", () => {
    const a = new Uint8Array([100, 100, 100, 255]);
    const b = new Uint8Array([104, 100, 100, 255]);
    const result = diffImages(a, b, 1, 1, 2);
    expect(result.mismatchCount).toBe(1);
    expect(result.maxDiff).toBe(4);
  });

  it("computes RMSE correctly", () => {
    // 2 pixels, each channel differs by 10
    const a = new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]);
    const b = new Uint8Array([10, 10, 10, 10, 10, 10, 10, 10]);
    const result = diffImages(a, b, 2, 1);
    // MSE = (10^2 * 8) / 8 = 100, RMSE = 10
    expect(result.rmse).toBeCloseTo(10, 5);
  });

  it("throws on buffer size mismatch", () => {
    const a = new Uint8Array(8);
    const b = new Uint8Array(12);
    expect(() => diffImages(a, b, 2, 1)).toThrow("Buffer size mismatch");
  });
});

describe("isWithinThreshold", () => {
  it("passes when mismatch ratio is below threshold", () => {
    expect(
      isWithinThreshold({
        mismatchCount: 1,
        mismatchRatio: 0.005,
        maxDiff: 10,
        rmse: 1,
        totalPixels: 200,
      }),
    ).toBe(true);
  });

  it("fails when mismatch ratio is above threshold", () => {
    expect(
      isWithinThreshold({
        mismatchCount: 10,
        mismatchRatio: 0.05,
        maxDiff: 100,
        rmse: 10,
        totalPixels: 200,
      }),
    ).toBe(false);
  });
});
