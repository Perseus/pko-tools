import { describe, expect, it, vi } from "vitest";
import React from "react";
import ReactThreeTestRenderer from "@react-three/test-renderer";
import * as THREE from "three";
import { LineSingleSystem } from "../renderers/particles/LineSingleSystem";
import { LineRoundSystem } from "../renderers/particles/LineRoundSystem";
import { DummySystem } from "../renderers/particles/DummySystem";
import {
  computeDummyMovementDelta,
  computeDummySpanFromPkoEndpoints,
  computeDummySpawnPosition,
  computeLineRoundVelocity,
  computeLineSingleDelta,
  computeLineSingleVelocity,
} from "../renderers/particles/dummyLineKinematics";
import type { ParSystem } from "@/types/effect-v2";

vi.mock("../renderers/particles/ParticleVisual", () => ({
  ParticleVisual: () => null,
}));

function system(overrides: Partial<ParSystem> = {}): ParSystem {
  return {
    type: 17,
    name: "line",
    particleCount: 1,
    textureName: "spark.tga",
    modelName: "",
    range: [1, 1, 1],
    frameCount: 1,
    frameSizes: [1],
    frameAngles: [[0, 0, 0]],
    frameColors: [[1, 1, 1, 1]],
    billboard: true,
    srcBlend: 5,
    destBlend: 2,
    life: 1,
    velocity: 1,
    direction: [0, 1, 0],
    acceleration: [0, 0, 0],
    step: 0,
    offset: [0, 0, 0],
    delayTime: 0,
    playTime: 1,
    usePath: false,
    path: null,
    shade: false,
    hitEffect: "",
    pointRanges: [],
    randomMode: 1,
    modelDir: false,
    mediaY: false,
    ...overrides,
  };
}

describe("computeDummySpanFromPkoEndpoints", () => {
  it("matches C++ GetDummyPosList direction, distance, and dummy2 origin", () => {
    const span = computeDummySpanFromPkoEndpoints(
      new THREE.Vector3(10, 20, 30),
      new THREE.Vector3(4, 8, 12),
    );

    expect(span).not.toBeNull();
    if (!span) throw new Error("expected nonzero dummy span");

    expect(span.start.toArray()).toEqual([4, 8, 12]);
    expect(span.distance).toBeCloseTo(Math.sqrt(504));
    expect(span.direction.x).toBeCloseTo(6 / Math.sqrt(504));
    expect(span.direction.y).toBeCloseTo(12 / Math.sqrt(504));
    expect(span.direction.z).toBeCloseTo(18 / Math.sqrt(504));
  });
});

describe("computeDummySpawnPosition", () => {
  it("matches C++ _CreateDummy discrete distance bucket selection", () => {
    const span = {
      start: new THREE.Vector3(1, 2, 3),
      direction: new THREE.Vector3(1, 0, 0),
      distance: 10,
    };

    const pos = computeDummySpawnPosition(span, 5, () => 0.6);

    expect(pos.toArray()).toEqual([7, 2, 3]);
  });
});

describe("dummy movement", () => {
  it("matches C++ _FrameMoveDummy velocity plus signed acceleration", () => {
    const delta = computeDummyMovementDelta(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, 0, 2),
      4,
      0.5,
      () => 0.25,
    );

    expect(delta.toArray()).toEqual([0, 2, 1]);
  });
});

describe("line dummy movement", () => {
  it("matches C++ _CreateLineSingle velocity over one lifetime", () => {
    const span = {
      start: new THREE.Vector3(1, 2, 3),
      direction: new THREE.Vector3(0, 1, 0),
      distance: 12,
    };

    expect(computeLineSingleVelocity(span, 3).toArray()).toEqual([0, 4, 0]);
    expect(computeLineSingleDelta(new THREE.Vector3(0, 4, 0), new THREE.Vector3(), 0.5).toArray()).toEqual([0, 2, 0]);
  });

  it("matches C++ _CreateLineRound double-speed velocity", () => {
    const span = {
      start: new THREE.Vector3(1, 2, 3),
      direction: new THREE.Vector3(0, 0, -1),
      distance: 12,
    };

    expect(computeLineRoundVelocity(span, 3).toArray()).toEqual([0, 0, -8]);
  });
});

describe("line dummy renderer gating", () => {
  it("matches GetDummyPosList failure by completing Dummy without rendering fallback particles", async () => {
    const onComplete = vi.fn();

    await ReactThreeTestRenderer.create(
      React.createElement(DummySystem, {
        system: system({ type: 16 }),
        index: 0,
        dummyLineSpan: null,
        onComplete,
      }),
    );

    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("matches GetDummyPosList failure by completing LineSingle without rendering fallback particles", async () => {
    const onComplete = vi.fn();

    await ReactThreeTestRenderer.create(
      React.createElement(LineSingleSystem, {
        system: system({ type: 17 }),
        index: 0,
        dummyLineSpan: null,
        onComplete,
      }),
    );

    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("matches SetItemDummy gating by completing LineRound when no dummy span is available", async () => {
    const onComplete = vi.fn();

    await ReactThreeTestRenderer.create(
      React.createElement(LineRoundSystem, {
        system: system({ type: 18 }),
        index: 0,
        dummyLineSpan: null,
        onComplete,
      }),
    );

    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
