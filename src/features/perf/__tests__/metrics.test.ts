import {
  __resetPerfMetricsForTests,
  getPerfMetricsSnapshot,
  recordFrame,
  recordInvoke,
} from "@/features/perf/metrics";
import { describe, expect, it, beforeEach } from "vitest";

describe("perf metrics", () => {
  beforeEach(() => {
    __resetPerfMetricsForTests();
  });

  it("aggregates frame timings per surface", () => {
    recordFrame("characters", 16);
    recordFrame("characters", 20);
    recordFrame("characters", 24);

    const snapshot = getPerfMetricsSnapshot();
    const characters = snapshot.surfaces.characters;

    expect(characters.samples).toBe(3);
    expect(characters.avgFrameMs).toBeCloseTo(20, 5);
    expect(characters.fps).toBeCloseTo(50, 5);
    expect(characters.p95FrameMs).toBeGreaterThan(0);
  });

  it("aggregates invoke metrics and errors", () => {
    recordInvoke("load_character", 90, true);
    recordInvoke("load_character", 110, true);
    recordInvoke("load_character", 180, false);
    recordInvoke("load_map_terrain", 240, true);

    const snapshot = getPerfMetricsSnapshot();

    expect(snapshot.invokes.totalCount).toBe(4);
    expect(snapshot.invokes.errorCount).toBe(1);
    expect(snapshot.invokes.topCommands.length).toBeGreaterThan(0);
    expect(snapshot.invokes.topCommands[0].command).toBe("load_map_terrain");

    const characterEntry = snapshot.invokes.topCommands.find(
      (entry) => entry.command === "load_character",
    );
    expect(characterEntry).toBeDefined();
    expect(characterEntry?.count).toBe(3);
    expect(characterEntry?.errorCount).toBe(1);
  });
});
