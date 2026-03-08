import { describe, expect, it } from "vitest";
import {
  buildEffectSkeletonGraph,
  normalizeEffectReference,
} from "@/features/effect/effectSkeleton";
import {
  createEffectFixture,
  createSubEffectFixture,
} from "@/features/effect/__tests__/fixtures";

describe("effectSkeleton helpers", () => {
  it("normalizes effect references to lowercase basenames", () => {
    expect(normalizeEffectReference("Effects/Fire01.EFF")).toBe("fire01.eff");
    expect(normalizeEffectReference("spark")).toBeNull();
    expect(normalizeEffectReference("")).toBeNull();
  });

  it("builds a hierarchy with composed world transforms for the current effect only", () => {
    const root = createEffectFixture({
      subEffects: [
        createSubEffectFixture({
          effectName: "beam-core",
          frameCount: 1,
          frameTimes: [0.1],
          framePositions: [[1, 2, 3]],
          frameAngles: [[0, 0, 0]],
          frameSizes: [[2, 2, 2]],
          frameColors: [[1, 1, 1, 1]],
          rotaLoop: true,
          rotaLoopVec: [0, 0, 1, 2],
        }),
      ],
    });

    const graph = buildEffectSkeletonGraph({
      effectFile: root,
      effectName: "root.eff",
      currentTime: 0.5,
      isLooping: true,
    });

    const rootNode = graph.nodes[graph.rootId];
    const childNode = graph.nodes[`${graph.rootId}/sub:0`];

    expect(rootNode.kind).toBe("effect");
    expect(childNode.kind).toBe("subEffect");
    if (childNode.kind !== "subEffect") {
      throw new Error("expected child node to be a sub-effect");
    }
    expect(rootNode.childrenIds).toEqual([`${graph.rootId}/sub:0`]);
    expect(childNode.worldPosition[0]).toBeCloseTo(1, 5);
    expect(childNode.worldPosition[1]).toBeCloseTo(2, 5);
    expect(childNode.worldPosition[2]).toBeCloseTo(3, 5);
    expect(childNode.localRotation[2]).toBeCloseTo(1, 5);
  });
});
