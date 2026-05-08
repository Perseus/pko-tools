import React from "react";
import { act } from "react";
import ReactThreeTestRenderer from "@react-three/test-renderer";
import { describe, expect, it, vi } from "vitest";
import { ModelSystem } from "../renderers/particles/ModelSystem";
import { TimeProvider, TimeSource } from "../TimeContext";
import type { ParSystem } from "@/types/effect-v2";

vi.mock("../renderers/particles/ParticleVisual", () => ({
  ParticleVisual: () => (
    <mesh name="model-particle-visual">
      <planeGeometry />
      <meshBasicMaterial />
    </mesh>
  ),
}));

describe("ModelSystem", () => {
  it("renders built-in RectPlane MODEL particles after the lifecycle spawns them", async () => {
    let time = 0;
    const timeSource: TimeSource = {
      getTime: () => time,
      playing: true,
      loop: false,
    };

    const renderer = await ReactThreeTestRenderer.create(
      <TimeProvider value={timeSource}>
        <ModelSystem
          system={createSystem({
            name: "hdfds",
            modelName: "RectPlane",
            textureName: "glowglowa0023",
            delayTime: 0,
            playTime: 0,
            life: 2,
          })}
          index={0}
          loop={false}
        />
      </TimeProvider>,
    );

    time = 1 / 60;
    await act(async () => {
      await renderer.advanceFrames(2, 1 / 60);
    });

    expect(renderer.scene.findByProps({ name: "model-particle-visual" })).toBeTruthy();
  });
});

function createSystem(overrides: Partial<ParSystem> = {}): ParSystem {
  return {
    type: 5,
    name: "model",
    particleCount: 1,
    textureName: "",
    modelName: "RectPlane",
    range: [0, 0, 0],
    frameCount: 2,
    frameSizes: [5, 1],
    frameAngles: [[0, 0, 0], [0, 0, 0]],
    frameColors: [[1, 1, 1, 1], [1, 1, 1, 1]],
    billboard: true,
    srcBlend: 5,
    destBlend: 7,
    life: 2,
    velocity: 1,
    direction: [0, 0, 0],
    acceleration: [0, 0, 0],
    step: 0,
    offset: [0, 0, 0],
    delayTime: 0,
    playTime: 0,
    usePath: false,
    path: null,
    shade: false,
    hitEffect: "",
    pointRanges: [],
    randomMode: 2,
    modelDir: false,
    mediaY: false,
    ...overrides,
  };
}
