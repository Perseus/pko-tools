import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import ReactThreeTestRenderer from "@react-three/test-renderer";
import * as THREE from "three";
import { SnowSystem } from "../renderers/particles/SnowSystem";
import { TimeProvider, TimeSource } from "../TimeContext";
import type { ParSystem } from "@/types/effect-v2";

vi.mock("../renderers/particles/ParticleVisual", () => ({
  ParticleVisual: ({ particle }: { particle?: { index: number } }) => (
    <mesh name={`snow-particle-${particle?.index ?? -1}`}>
      <boxGeometry />
      <meshBasicMaterial />
    </mesh>
  ),
}));

function createSnowSystem(overrides: Partial<ParSystem> = {}): ParSystem {
  return {
    type: 1,
    name: "temp2",
    particleCount: 1,
    textureName: "eff0232",
    modelName: "RectPlane",
    range: [0, 0, 0],
    frameCount: 3,
    frameSizes: [0, 0.5, 0.2],
    frameAngles: [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
    frameColors: [[1, 1, 1, 1], [0.75, 1, 1, 1], [0.65, 1, 1, 0]],
    billboard: true,
    srcBlend: 5,
    destBlend: 2,
    life: 2.3,
    velocity: 2,
    direction: [0, 0, 1],
    acceleration: [0, 0, 0],
    step: 0.01,
    offset: [0, 0, 0],
    delayTime: 0,
    playTime: 0,
    usePath: false,
    path: null,
    shade: false,
    hitEffect: "",
    pointRanges: [],
    randomMode: 1,
    modelDir: false,
    mediaY: false,
    minFilter: 1,
    magFilter: 1,
    ...overrides,
  };
}

describe("SnowSystem", () => {
  it("renders moving live particles from mutable lifecycle state", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    let now = 0;
    const timeSource: TimeSource = {
      getTime: () => now,
      playing: true,
      loop: true,
    };

    const renderer = await ReactThreeTestRenderer.create(
      <TimeProvider value={timeSource}>
        <SnowSystem
          system={createSnowSystem()}
          index={1}
          loop
          emitterPositionRef={{ current: null }}
          sourceDirectionRef={{ current: null }}
        />
      </TimeProvider>,
    );

    await act(async () => {
      now = 0.1;
      await renderer.advanceFrames(2, 1 / 60);
    });

    const mesh = renderer.scene.findByProps({ name: "snow-particle-0" });
    const particleGroup = mesh.instance.parent as THREE.Group;

    expect(particleGroup.position.z).toBeGreaterThan(0.05);
    expect(particleGroup.scale.x).toBeGreaterThan(0);

    const zAfterFirstStep = particleGroup.position.z;
    await act(async () => {
      now = 0.2;
      await renderer.advanceFrames(2, 1 / 60);
    });

    expect(particleGroup.position.z).toBeGreaterThan(zAfterFirstStep + 0.05);
  });
});
