import { describe, expect, it } from "vitest";
import {
  timeToX,
  valueToY,
  xToTime,
  yToValue,
  CHANNELS,
  computeValueRange,
} from "@/features/effect/CurveEditor";
import { createSubEffectFixture } from "./fixtures";

describe("CurveEditor coordinate mapping", () => {
  it("timeToX maps seconds to SVG x coordinate", () => {
    expect(timeToX(0, 0, 1, 500)).toBe(0);
    expect(timeToX(0.5, 0, 1, 500)).toBe(250);
    expect(timeToX(1, 0, 1, 500)).toBe(500);
  });

  it("valueToY maps value to SVG y (inverted)", () => {
    // Higher values → lower Y (top of SVG)
    expect(valueToY(10, 0, 10, 200)).toBe(0);   // max → top
    expect(valueToY(0, 0, 10, 200)).toBe(200);   // min → bottom
    expect(valueToY(5, 0, 10, 200)).toBe(100);   // mid → middle
  });

  it("xToTime is the inverse of timeToX", () => {
    const viewStart = 0;
    const viewEnd = 2;
    const svgWidth = 400;
    const time = 0.75;

    const x = timeToX(time, viewStart, viewEnd, svgWidth);
    const recovered = xToTime(x, viewStart, viewEnd, svgWidth);
    expect(recovered).toBeCloseTo(time, 6);
  });

  it("yToValue is the inverse of valueToY", () => {
    const min = -5;
    const max = 15;
    const svgHeight = 300;
    const value = 7.5;

    const y = valueToY(value, min, max, svgHeight);
    const recovered = yToValue(y, min, max, svgHeight);
    expect(recovered).toBeCloseTo(value, 6);
  });

  it("handles zero-range gracefully", () => {
    expect(valueToY(5, 5, 5, 200)).toBe(100); // center
    expect(timeToX(0, 0, 0, 500)).toBe(0);
  });
});

describe("CurveEditor channels", () => {
  it("has 13 channels defined", () => {
    expect(CHANNELS).toHaveLength(13);
  });

  it("getValue/setValue round-trips for position.x", () => {
    const ch = CHANNELS.find((c) => c.id === "position.x")!;
    const sub = createSubEffectFixture();
    const updated = ch.setValue(sub, 0, 42);
    expect(ch.getValue(updated, 0)).toBe(42);
    // Other frame untouched
    expect(ch.getValue(updated, 1)).toBe(ch.getValue(sub, 1));
  });

  it("getValue/setValue round-trips for color.a", () => {
    const ch = CHANNELS.find((c) => c.id === "color.a")!;
    const sub = createSubEffectFixture();
    const updated = ch.setValue(sub, 0, 0.5);
    expect(ch.getValue(updated, 0)).toBe(0.5);
  });

  it("color setValue clamps to 0-1", () => {
    const ch = CHANNELS.find((c) => c.id === "color.r")!;
    const sub = createSubEffectFixture();
    const overMax = ch.setValue(sub, 0, 5);
    expect(ch.getValue(overMax, 0)).toBe(1);
    const underMin = ch.setValue(sub, 0, -2);
    expect(ch.getValue(underMin, 0)).toBe(0);
  });

  it("all channels produce valid getValue results", () => {
    const sub = createSubEffectFixture();
    for (const ch of CHANNELS) {
      for (let i = 0; i < sub.frameCount; i++) {
        const value = ch.getValue(sub, i);
        expect(typeof value).toBe("number");
        expect(isFinite(value)).toBe(true);
      }
    }
  });
});

describe("computeValueRange", () => {
  it("returns min/max with padding", () => {
    const sub = createSubEffectFixture({
      frameCount: 2,
      framePositions: [[0, 0, 0], [10, 0, 0]],
    });
    const ch = CHANNELS.filter((c) => c.id === "position.x");
    const [min, max] = computeValueRange(sub, ch);
    expect(min).toBeLessThan(0);
    expect(max).toBeGreaterThan(10);
  });

  it("handles single-value range", () => {
    const sub = createSubEffectFixture({
      frameCount: 2,
      framePositions: [[5, 0, 0], [5, 0, 0]],
    });
    const ch = CHANNELS.filter((c) => c.id === "position.x");
    const [min, max] = computeValueRange(sub, ch);
    expect(min).toBeLessThan(5);
    expect(max).toBeGreaterThan(5);
  });

  it("returns default range for empty channels", () => {
    const sub = createSubEffectFixture({ frameCount: 0 });
    const [min, max] = computeValueRange(sub, CHANNELS);
    expect(min).toBe(-1);
    expect(max).toBe(1);
  });
});
