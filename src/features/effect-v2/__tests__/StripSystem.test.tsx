import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import ReactThreeTestRenderer from "@react-three/test-renderer";
import * as THREE from "three";
import { StripSystem } from "../renderers/particles/StripSystem";
import { TimeProvider, TimeSource } from "../TimeContext";
import type { ParSystem } from "@/types/effect-v2";

vi.mock("../renderers/particles/ParticleVisual", () => ({
  ParticleVisual: ({ particle }: { particle?: { index: number } }) => (
    <mesh name={`strip-particle-${particle?.index ?? -1}`}>
      <boxGeometry />
      <meshBasicMaterial />
    </mesh>
  ),
}));

function createStripSystem(overrides: Partial<ParSystem> = {}): ParSystem {
  return {
    type: 6,
    name: "temp",
    particleCount: 1,
    textureName: "eff0139",
    modelName: "01000011.eff",
    range: [0, 0, 0],
    frameCount: 2,
    frameSizes: [1, 1],
    frameAngles: [[0, 0, 0], [0, 0, 0]],
    frameColors: [[1, 1, 1, 1], [1, 1, 1, 1]],
    billboard: false,
    srcBlend: 5,
    destBlend: 2,
    minFilter: 1,
    magFilter: 1,
    life: 4.5,
    velocity: 2.8,
    direction: [1.23, 1.25, 3.48],
    acceleration: [0, 0, 0],
    step: 0,
    offset: [0, 0, 2],
    delayTime: 0,
    playTime: 2.6,
    usePath: true,
    path: {
      velocity: 1,
      points: [[0, 0, 0], [10, 0, 0]],
      directions: [[1, 0, 0]],
      distances: [10],
    },
    shade: false,
    hitEffect: "",
    pointRanges: [],
    randomMode: 2,
    modelDir: false,
    mediaY: false,
    ...overrides,
  };
}

describe("StripSystem", () => {
  it("keeps the rendered nested .eff group pinned to the current path-shifted particle position", async () => {
    let now = 0;
    const timeSource: TimeSource = {
      getTime: () => now,
      playing: true,
      loop: true,
    };

    const renderer = await ReactThreeTestRenderer.create(
      <TimeProvider value={timeSource}>
        <StripSystem
          system={createStripSystem()}
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

    const mesh = renderer.scene.findByProps({ name: "strip-particle-0" });
    const particleGroup = mesh.instance.parent as THREE.Group;
    const firstX = particleGroup.position.x;

    await act(async () => {
      now = 0.25;
      await renderer.advanceFrames(2, 1 / 60);
    });

    expect(particleGroup.position.x).toBeGreaterThan(firstX + 0.05);
  });

  it("does not advance CEffPath while delayTime is still gating the system", async () => {
    let now = 0;
    const timeSource: TimeSource = {
      getTime: () => now,
      playing: true,
      loop: true,
    };

    const renderer = await ReactThreeTestRenderer.create(
      <TimeProvider value={timeSource}>
        <StripSystem
          system={createStripSystem({ delayTime: 0.2 })}
          index={1}
          loop
          emitterPositionRef={{ current: null }}
          sourceDirectionRef={{ current: null }}
        />
      </TimeProvider>,
    );

    await act(async () => {
      now = 0.21;
      await renderer.advanceFrames(2, 1 / 60);
    });

    const mesh = renderer.scene.findByProps({ name: "strip-particle-0" });
    const particleGroup = mesh.instance.parent as THREE.Group;

    expect(particleGroup.position.x).toBeLessThan(0.1);
  });
});
