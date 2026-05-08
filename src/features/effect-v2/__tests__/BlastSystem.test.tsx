import { describe, expect, it, vi, afterEach } from "vitest";
import { act } from "react";
import ReactThreeTestRenderer from "@react-three/test-renderer";
import * as THREE from "three";
import { BlastSystem } from "../renderers/particles/BlastSystem";
import { TimeProvider, TimeSource } from "../TimeContext";
import type { ParSystem } from "@/types/effect-v2";

vi.mock("../renderers/particles/ParticleVisual", () => ({
  ParticleVisual: ({ particle }: { particle?: { index: number } }) => (
    <mesh name={`blast-particle-${particle?.index ?? -1}`}>
      <boxGeometry />
      <meshBasicMaterial />
    </mesh>
  ),
}));

function createBlastSystem(overrides: Partial<ParSystem> = {}): ParSystem {
  return {
    type: 3,
    name: "blast",
    particleCount: 1,
    textureName: "eff0083",
    modelName: "RectPlane",
    range: [0, 0, 0],
    frameCount: 2,
    frameSizes: [1, 2],
    frameAngles: [[0, 0, 0], [0, 0, 0]],
    frameColors: [[1, 1, 1, 1], [1, 1, 1, 1]],
    billboard: true,
    srcBlend: 3,
    destBlend: 2,
    life: 1,
    velocity: 1,
    direction: [1, 0, 0],
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
    minFilter: 1,
    magFilter: 1,
    ...overrides,
  };
}

describe("BlastSystem", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders and animates particle transforms from mutable lifecycle state", async () => {
    vi.spyOn(Math, "random").mockReturnValue(1);
    let now = 0;
    const timeSource: TimeSource = {
      getTime: () => now,
      playing: true,
      loop: false,
    };

    const renderer = await ReactThreeTestRenderer.create(
      <TimeProvider value={timeSource}>
        <BlastSystem
          system={createBlastSystem()}
          index={0}
          loop={false}
          emitterPositionRef={{ current: null }}
          sourceDirectionRef={{ current: null }}
        />
      </TimeProvider>,
    );

    await act(async () => {
      now = 0.1;
      await renderer.advanceFrames(2, 1 / 60);
    });

    const mesh = renderer.scene.findByProps({ name: "blast-particle-0" });
    const particleGroup = mesh.instance.parent as THREE.Group;

    expect(particleGroup.position.x).toBeLessThan(-0.05);
    expect(particleGroup.scale.x).toBeGreaterThan(1);

    const xAfterFirstStep = particleGroup.position.x;
    const scaleAfterFirstStep = particleGroup.scale.x;

    await act(async () => {
      now = 0.2;
      await renderer.advanceFrames(2, 1 / 60);
    });

    expect(particleGroup.position.x).toBeLessThan(xAfterFirstStep - 0.05);
    expect(particleGroup.scale.x).toBeGreaterThan(scaleAfterFirstStep);
  });
});
