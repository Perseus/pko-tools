import { describe, expect, it } from "vitest";
import { getMagicFlightPathForTest } from "../renderers/flight/FlightPathController";

describe("Magic flight path dispatch", () => {
  it("matches EffectObj.cpp MagicList entries 0 through 6", () => {
    for (let renderIdx = 0; renderIdx <= 6; renderIdx++) {
      expect(getMagicFlightPathForTest(renderIdx)).not.toBeNull();
    }
  });

  it("does not route Part_dist2 because the original MagicList array does not expose index 7", () => {
    expect(getMagicFlightPathForTest(7)).toBeNull();
  });
});
